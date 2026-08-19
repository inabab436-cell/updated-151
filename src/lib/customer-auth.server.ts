/**
 * Server-only engine for CUSTOMER passwordless auth (Email OTP + sessions).
 *
 * Fully independent of the merchant auth system:
 *  - uses its own tables (`customer_otp_codes`, `customer_otp_blocks`,
 *    `customer_sessions`);
 *  - uses its own cookie name (`cupai_cs`);
 *  - never touches `auth.users`, `email_otp_codes`, `email_otp_blocks`
 *    or the merchant `cupai_session` cookie.
 *
 * Rate limits (per merchant + email):
 *  - OTP TTL: 30 min
 *  - resend cooldown: 60 s
 *  - max wrong attempts: 5   → 30-minute block
 *  - max sends per 30-minute window: 5   → 30-minute block
 *
 * MUST NOT be imported from client/browser code.
 */

import { createHash, createHmac, randomBytes, randomInt } from "crypto";
import {
  deleteCookie,
  getCookie,
  getRequestHeader,
  getRequestIP,
  setCookie,
} from "@tanstack/react-start/server";

import { getSupabaseAdmin } from "@/integrations/supabase/client.server";
import { sendEmail } from "@/lib/resend.server";
import { CUSTOMER_OTP_TEST_MODE } from "@/lib/customer-auth-testmode";
import {
  CUSTOMER_BLOCK_MINUTES,
  CUSTOMER_CODE_TTL_MINUTES,
  CUSTOMER_MAX_ATTEMPTS,
  CUSTOMER_MAX_SENDS_PER_WINDOW,
  CUSTOMER_RATE_WINDOW_MINUTES,
  CUSTOMER_SEND_COOLDOWN_SECONDS,
  CUSTOMER_SESSION_DAYS,
  type CustomerOtpSendResult,
  type CustomerOtpVerifyResult,
} from "@/lib/customer-auth-types";

const CODE_TTL_MS = CUSTOMER_CODE_TTL_MINUTES * 60 * 1000;
const SEND_COOLDOWN_MS = CUSTOMER_SEND_COOLDOWN_SECONDS * 1000;
const WINDOW_MS = CUSTOMER_RATE_WINDOW_MINUTES * 60 * 1000;
const BLOCK_MS = CUSTOMER_BLOCK_MINUTES * 60 * 1000;
const SESSION_TTL_MS = CUSTOMER_SESSION_DAYS * 24 * 60 * 60 * 1000;

export const CUSTOMER_COOKIE_NAME = "cupai_cs";
const FROM = "cupai <onboarding@resend.dev>";

function pepper(): string {
  const secret = process.env.CUPAI_APP_SESSION_SECRET;
  if (!secret) {
    throw new Error("Missing required environment variable: CUPAI_APP_SESSION_SECRET");
  }
  return secret;
}

function hashCode(code: string): string {
  return createHmac("sha256", pepper()).update(code).digest("hex");
}

function hashSessionToken(token: string): string {
  // HMAC keeps the token unforgeable even if the DB leaks.
  return createHmac("sha256", pepper()).update(`session:${token}`).digest("hex");
}

function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function readCookieFromHeader(request: Request | undefined, name: string): string | null {
  const raw = request?.headers.get("cookie") ?? "";
  const found = raw
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!found) return null;
  const value = decodeURIComponent(found.slice(name.length + 1));
  return value || null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function secondsUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 1000));
}

function subjectForCustomer(): string {
  return "Your verification code";
}

function emailText(code: string, brandName: string): string {
  return `Your ${brandName} verification code is ${code}. It is valid for ${CUSTOMER_CODE_TTL_MINUTES} minutes. If you did not request this, you can ignore this email.`;
}

function emailHtml(code: string, brandName: string): string {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f172a">
    <h2 style="margin:0 0 12px">${brandName}</h2>
    <p style="margin:0 0 16px;font-size:15px">Use the code below to sign in.</p>
    <div style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f1f5f9;border-radius:8px;padding:16px;text-align:center;margin:0 0 16px">${code}</div>
    <p style="margin:0 0 8px;font-size:13px;color:#475569">This code is valid for ${CUSTOMER_CODE_TTL_MINUTES} minutes.</p>
    <p style="margin:0;font-size:13px;color:#475569">If you did not request this, you can safely ignore this email.</p>
  </div>`;
}

type Admin = ReturnType<typeof getSupabaseAdmin>;

async function getActiveBlock(
  admin: Admin,
  merchantId: string,
  email: string,
): Promise<string | null> {
  const nowIso = new Date().toISOString();
  const { data } = await admin
    .from("customer_otp_blocks")
    .select("blocked_until")
    .eq("merchant_id", merchantId)
    .eq("email", email)
    .gt("blocked_until", nowIso)
    .order("blocked_until", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.blocked_until as string | undefined) ?? null;
}

async function resolveMerchantName(admin: Admin, merchantId: string): Promise<string> {
  const { data } = await admin
    .from("merchants")
    .select("brand_name, brand_slug")
    .eq("id", merchantId)
    .maybeSingle();
  return (
    (data?.brand_name as string | undefined) ||
    (data?.brand_slug as string | undefined) ||
    "cupai"
  );
}

/** Send an OTP code to a customer email, scoped to a single merchant. */
export async function sendCustomerOtp(
  merchantId: string,
  rawEmail: string,
): Promise<CustomerOtpSendResult> {
  const admin = getSupabaseAdmin();
  const email = normalizeEmail(rawEmail);
  if (!email.includes("@")) {
    return { ok: false, status: "error", message: "يرجى إدخال بريد إلكتروني صالح." };
  }

  const block = await getActiveBlock(admin, merchantId, email);
  if (block) {
    return {
      ok: false,
      status: "blocked",
      message: "تم حظر إرسال الرموز لهذا البريد مؤقتًا. حاول لاحقًا.",
      blockedUntil: block,
      retryAfterSeconds: secondsUntil(block),
    };
  }

  const windowStartIso = new Date(Date.now() - WINDOW_MS).toISOString();

  const { data: recent } = await admin
    .from("customer_otp_codes")
    .select("created_at")
    .eq("merchant_id", merchantId)
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!CUSTOMER_OTP_TEST_MODE && recent?.created_at) {
    const elapsed = Date.now() - new Date(recent.created_at as string).getTime();
    if (elapsed < SEND_COOLDOWN_MS) {
      const retry = Math.ceil((SEND_COOLDOWN_MS - elapsed) / 1000);
      return {
        ok: false,
        status: "cooldown",
        message: `يرجى الانتظار ${retry} ثانية قبل طلب رمز جديد.`,
        retryAfterSeconds: retry,
      };
    }
  }

  const { count } = await admin
    .from("customer_otp_codes")
    .select("id", { count: "exact", head: true })
    .eq("merchant_id", merchantId)
    .eq("email", email)
    .gte("created_at", windowStartIso);
  const sendsSoFar = count ?? 0;
  if (!CUSTOMER_OTP_TEST_MODE && sendsSoFar >= CUSTOMER_MAX_SENDS_PER_WINDOW) {
    const blockedUntil = new Date(Date.now() + BLOCK_MS).toISOString();
    await admin.from("customer_otp_blocks").insert({
      merchant_id: merchantId,
      email,
      reason: "too_many_sends",
      blocked_until: blockedUntil,
    });
    return {
      ok: false,
      status: "blocked",
      message: "تجاوزت الحدّ الأقصى لطلبات الرمز. المحاولة متاحة بعد 30 دقيقة.",
      blockedUntil,
      retryAfterSeconds: secondsUntil(blockedUntil),
    };
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  const { error: insertError } = await admin.from("customer_otp_codes").insert({
    merchant_id: merchantId,
    email,
    code_hash: hashCode(code),
    expires_at: expiresAt,
    attempts: 0,
  });
  if (insertError) {
    return { ok: false, status: "error", message: "تعذّر إنشاء رمز التحقق. حاول مجددًا." };
  }

  const brandName = await resolveMerchantName(admin, merchantId);

  // TEST MODE: skip the email entirely and hand the code back to the client
  // so registration can complete. Flip CUSTOMER_OTP_TEST_MODE to false to
  // restore normal email verification.
  if (CUSTOMER_OTP_TEST_MODE) {
    return {
      ok: true,
      status: "sent",
      message: "وضع الاختبار: تم تخطي التحقق بالبريد.",
      retryAfterSeconds: 0,
      remainingSends: CUSTOMER_MAX_SENDS_PER_WINDOW,
      testMode: true,
      devCode: code,
    };
  }

  try {
    await sendEmail({
      from: FROM,
      to: email,
      subject: subjectForCustomer(),
      html: emailHtml(code, brandName),
      text: emailText(code, brandName),
    });
  } catch {
    return { ok: false, status: "error", message: "تعذّر إرسال البريد. حاول بعد قليل." };
  }

  const remainingSends = Math.max(0, CUSTOMER_MAX_SENDS_PER_WINDOW - sendsSoFar - 1);
  return {
    ok: true,
    status: "sent",
    message: "تم إرسال رمز التحقق إلى بريدك.",
    retryAfterSeconds: CUSTOMER_SEND_COOLDOWN_SECONDS,
    remainingSends,
  };
}

/** Resolve or create the canonical customer row for (merchant, email). */
async function upsertCustomerByEmail(
  admin: Admin,
  merchantId: string,
  email: string,
  visitorId?: string | null,
): Promise<string> {
  const { data: existing } = await admin
    .from("customers")
    .select("id, email_verified")
    .eq("merchant_id", merchantId)
    .ilike("email", email)
    .maybeSingle();
  if (existing?.id) {
    const patch: Record<string, unknown> = {
      email,
      email_verified: true,
      last_seen: new Date().toISOString(),
    };
    if (visitorId) patch.visitor_id = visitorId;
    await admin
      .from("customers")
      .update(patch)
      .eq("id", existing.id as string);
    return existing.id as string;
  }

  // Try upgrading the visitor-only row for this browser first.
  if (visitorId) {
    const { data: shell } = await admin
      .from("customers")
      .select("id")
      .eq("merchant_id", merchantId)
      .eq("visitor_id", visitorId)
      .is("email", null)
      .maybeSingle();
    if (shell?.id) {
      await admin
        .from("customers")
        .update({
          email,
          email_verified: true,
          last_seen: new Date().toISOString(),
        })
        .eq("id", shell.id as string);
      return shell.id as string;
    }
  }

  const { data: created, error } = await admin
    .from("customers")
    .insert({
      merchant_id: merchantId,
      email,
      email_verified: true,
      visitor_id: visitorId ?? null,
      last_seen: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !created?.id) {
    throw new Error(error?.message || "Could not create customer row.");
  }
  return created.id as string;
}

/** Verify an OTP code, log the customer in, and set the session cookie. */
export async function verifyCustomerOtpAndLogin(
  merchantId: string,
  rawEmail: string,
  code: string,
  visitorId?: string | null,
): Promise<CustomerOtpVerifyResult> {
  const admin = getSupabaseAdmin();
  const email = normalizeEmail(rawEmail);

  const block = await getActiveBlock(admin, merchantId, email);
  if (block) {
    return {
      ok: false,
      status: "blocked",
      message: "لقد تجاوزت الحدّ الأقصى للمحاولات. حاول لاحقًا.",
      blockedUntil: block,
      attemptsRemaining: 0,
    };
  }

  const { data: row } = await admin
    .from("customer_otp_codes")
    .select("id, code_hash, expires_at, attempts")
    .eq("merchant_id", merchantId)
    .eq("email", email)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) {
    return {
      ok: false,
      status: "expired",
      message: "لا يوجد رمز نشط. قد يكون انتهى — يرجى طلب رمز جديد.",
    };
  }

  if (new Date(row.expires_at as string).getTime() < Date.now()) {
    return {
      ok: false,
      status: "expired",
      message: "انتهت صلاحية هذا الرمز. يرجى طلب رمز جديد.",
    };
  }

  if (hashCode(code) !== (row.code_hash as string)) {
    const attempts = (row.attempts as number) + 1;
    if (attempts >= CUSTOMER_MAX_ATTEMPTS) {
      const blockedUntil = new Date(Date.now() + BLOCK_MS).toISOString();
      await admin
        .from("customer_otp_codes")
        .update({ attempts, consumed_at: new Date().toISOString() })
        .eq("id", row.id);
      await admin.from("customer_otp_blocks").insert({
        merchant_id: merchantId,
        email,
        reason: "too_many_attempts",
        blocked_until: blockedUntil,
      });
      return {
        ok: false,
        status: "blocked",
        message: "لقد تجاوزت الحدّ الأقصى للمحاولات. المحاولة متاحة بعد 30 دقيقة.",
        blockedUntil,
        attemptsRemaining: 0,
      };
    }
    await admin
      .from("customer_otp_codes")
      .update({ attempts })
      .eq("id", row.id);
    const remaining = CUSTOMER_MAX_ATTEMPTS - attempts;
    return {
      ok: false,
      status: "invalid",
      message: `الرمز غير صحيح. تبقّى ${remaining} محاولة.`,
      attemptsRemaining: remaining,
    };
  }

  await admin
    .from("customer_otp_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id);

  const customerId = await upsertCustomerByEmail(admin, merchantId, email, visitorId ?? null);

  // Issue a session.
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const userAgent = getRequestHeader("user-agent") ?? null;
  let ip: string | null = null;
  try { ip = getRequestIP({ xForwardedFor: true }) ?? null; } catch { ip = null; }

  const { error: sErr } = await admin.from("customer_sessions").insert({
    merchant_id: merchantId,
    customer_id: customerId,
    token_hash: hashSessionToken(token),
    status: "active",
    expires_at: expiresAt,
    user_agent: userAgent,
    ip,
  });
  if (sErr) {
    return { ok: false, status: "error", message: "تعذّر إنشاء الجلسة." };
  }

  setCookie(CUSTOMER_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });

  return {
    ok: true,
    status: "verified",
    message: "تم تسجيل الدخول.",
    customerId,
    email,
  };
}

/** Resolve the current customer session from the httpOnly cookie. */
export async function getCurrentCustomerSession(): Promise<
  | null
  | {
      sessionId: string;
      customerId: string;
      merchantId: string;
      email: string;
      expiresAt: string;
    }
> {
  const token = getCookie(CUSTOMER_COOKIE_NAME);
  return getCustomerSessionByToken(token ?? null);
}

export async function getCustomerSessionFromRequest(request: Request): Promise<
  | null
  | {
      sessionId: string;
      customerId: string;
      merchantId: string;
      email: string;
      expiresAt: string;
    }
> {
  return getCustomerSessionByToken(readCookieFromHeader(request, CUSTOMER_COOKIE_NAME));
}

async function getCustomerSessionByToken(token: string | null): Promise<
  | null
  | {
      sessionId: string;
      customerId: string;
      merchantId: string;
      email: string;
      expiresAt: string;
    }
> {
  if (!token) return null;
  const admin = getSupabaseAdmin();
  const { data: session } = await admin
    .from("customer_sessions")
    .select("id, customer_id, merchant_id, status, expires_at")
    .eq("token_hash", hashSessionToken(token))
    .maybeSingle();
  if (!session) return null;
  if ((session.status as string) !== "active") return null;
  if (new Date(session.expires_at as string).getTime() < Date.now()) {
    await admin
      .from("customer_sessions")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("id", session.id as string);
    return null;
  }

  const { data: customer } = await admin
    .from("customers")
    .select("email")
    .eq("id", session.customer_id as string)
    .maybeSingle();

  // Touch last_seen_at and roll the expiry forward (best-effort) so an active
  // customer never gets logged out while their account exists.
  await admin
    .from("customer_sessions")
    .update({
      last_seen_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    })
    .eq("id", session.id as string);


  return {
    sessionId: session.id as string,
    customerId: session.customer_id as string,
    merchantId: session.merchant_id as string,
    email: (customer?.email as string | undefined) ?? "",
    expiresAt: session.expires_at as string,
  };
}

/** Revoke the current session and clear the cookie. */
export async function logoutCurrentCustomer(): Promise<void> {
  const token = getCookie(CUSTOMER_COOKIE_NAME);
  if (token) {
    const admin = getSupabaseAdmin();
    await admin
      .from("customer_sessions")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("token_hash", hashSessionToken(token))
      .eq("status", "active");
  }
  deleteCookie(CUSTOMER_COOKIE_NAME, { path: "/" });
}

/** Revoke ALL active sessions for the current customer and clear the cookie. */
export async function logoutAllCustomerSessions(): Promise<number> {
  const current = await getCurrentCustomerSession();
  if (!current) {
    deleteCookie(CUSTOMER_COOKIE_NAME, { path: "/" });
    return 0;
  }
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("customer_sessions")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("customer_id", current.customerId)
    .eq("status", "active")
    .select("id");
  deleteCookie(CUSTOMER_COOKIE_NAME, { path: "/" });
  if (error) return 0;
  return data?.length ?? 0;
}

/** Sha-256 hash used only as a stable public identifier (never a secret). */
export function publicHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}