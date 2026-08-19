/**
 * Public auth server functions for cupai (signup, OTP verification, login,
 * password reset). These are intentionally public endpoints — they ARE the
 * authentication surface — and are protected by the OTP rate-limiting rules.
 *
 * Server-only modules are loaded with dynamic import() inside handlers so this
 * client-reachable module never bundles server-only code or secrets.
 */

import { createServerFn } from "@tanstack/react-start";

import type {
  LoginResult,
  OtpSendResult,
  OtpVerifyResult,
  SessionInfo,
  SetupStatus,
} from "@/lib/auth-types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

function invalid(message: string): never {
  throw new Error(message);
}

// ---------------------------------------------------------------------------
// SIGNUP
// ---------------------------------------------------------------------------

export const signUpStart = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { email: string; password: string; confirmPassword: string }) => {
      if (!data || typeof data.email !== "string") invalid("Invalid request.");
      const email = data.email.trim().toLowerCase();
      if (!EMAIL_RE.test(email)) invalid("Please enter a valid email address.");
      if (typeof data.password !== "string" || data.password.length < MIN_PASSWORD)
        invalid(`Password must be at least ${MIN_PASSWORD} characters.`);
      if (data.password !== data.confirmPassword)
        invalid("Passwords do not match.");
      return { email, password: data.password };
    },
  )
  .handler(async ({ data }): Promise<OtpSendResult> => {
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendOtp, findUserIdByEmail } = await import("@/lib/otp.server");
    const admin = getSupabaseAdmin();

    const existingId = await findUserIdByEmail(data.email);
    if (existingId) {
      const { data: existing } = await admin.auth.admin.getUserById(existingId);
      if (existing?.user?.email_confirmed_at) {
        return {
          ok: false,
          status: "error",
          message: "An account with this email already exists. Please log in.",
        };
      }
      // Unconfirmed account from a previous attempt — refresh the password.
      await admin.auth.admin.updateUserById(existingId, {
        password: data.password,
      });
    } else {
      const { error } = await admin.auth.admin.createUser({
        email: data.email,
        password: data.password,
        email_confirm: false,
      });
      if (error) {
        return {
          ok: false,
          status: "error",
          message: "Could not create the account. Please try again.",
        };
      }
    }

    return sendOtp(data.email, "signup");
  });

export const resendSignupOtp = createServerFn({ method: "POST" })
  .inputValidator((data: { email: string }) => {
    const email = (data?.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) invalid("Please enter a valid email address.");
    return { email };
  })
  .handler(async ({ data }): Promise<OtpSendResult> => {
    const { sendOtp } = await import("@/lib/otp.server");
    return sendOtp(data.email, "signup");
  });

export const verifySignupOtp = createServerFn({ method: "POST" })
  .inputValidator((data: { email: string; code: string }) => {
    const email = (data?.email ?? "").trim().toLowerCase();
    const code = (data?.code ?? "").trim();
    if (!EMAIL_RE.test(email)) invalid("Please enter a valid email address.");
    if (!/^\d{6}$/.test(code)) invalid("Enter the 6-digit code.");
    return { email, code };
  })
  .handler(async ({ data }): Promise<OtpVerifyResult> => {
    const { verifyOtp, findUserIdByEmail } = await import("@/lib/otp.server");
    const result = await verifyOtp(data.email, "signup", data.code);
    if (!result.ok) return result;

    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = getSupabaseAdmin();
    const userId = await findUserIdByEmail(data.email);
    if (userId) {
      await admin.auth.admin.updateUserById(userId, { email_confirm: true });
      // First-time signup: seed the profile with setup_completed = false so
      // the login/welcome flow can branch on it later.
      const { ensureProfile } = await import("@/lib/profile.server");
      await ensureProfile(userId);
    }
    return {
      ok: true,
      status: "verified",
      message: "Your email has been verified. You can now log in.",
    };
  });

// ---------------------------------------------------------------------------
// PASSWORD RESET
// ---------------------------------------------------------------------------

export const requestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((data: { email: string }) => {
    const email = (data?.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) invalid("Please enter a valid email address.");
    return { email };
  })
  .handler(async ({ data }): Promise<OtpSendResult> => {
    const { sendOtp, findUserIdByEmail } = await import("@/lib/otp.server");
    const userId = await findUserIdByEmail(data.email);
    if (!userId) {
      // Do not reveal whether the email exists.
      return {
        ok: true,
        status: "sent",
        message: "If an account exists for this email, a code has been sent.",
        retryAfterSeconds: 60,
      };
    }
    return sendOtp(data.email, "password_reset");
  });

export const resendPasswordResetOtp = createServerFn({ method: "POST" })
  .inputValidator((data: { email: string }) => {
    const email = (data?.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) invalid("Please enter a valid email address.");
    return { email };
  })
  .handler(async ({ data }): Promise<OtpSendResult> => {
    const { sendOtp, findUserIdByEmail } = await import("@/lib/otp.server");
    const userId = await findUserIdByEmail(data.email);
    if (!userId) {
      return {
        ok: true,
        status: "sent",
        message: "If an account exists for this email, a code has been sent.",
        retryAfterSeconds: 60,
      };
    }
    return sendOtp(data.email, "password_reset");
  });

export const resetPassword = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      email: string;
      code: string;
      password: string;
      confirmPassword: string;
    }) => {
      const email = (data?.email ?? "").trim().toLowerCase();
      const code = (data?.code ?? "").trim();
      if (!EMAIL_RE.test(email)) invalid("Please enter a valid email address.");
      if (!/^\d{6}$/.test(code)) invalid("Enter the 6-digit code.");
      if (typeof data.password !== "string" || data.password.length < MIN_PASSWORD)
        invalid(`Password must be at least ${MIN_PASSWORD} characters.`);
      if (data.password !== data.confirmPassword)
        invalid("Passwords do not match.");
      return { email, code, password: data.password };
    },
  )
  .handler(async ({ data }): Promise<OtpVerifyResult> => {
    const { verifyOtp, findUserIdByEmail } = await import("@/lib/otp.server");
    const result = await verifyOtp(data.email, "password_reset", data.code);
    if (!result.ok) return result;

    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = getSupabaseAdmin();
    const userId = await findUserIdByEmail(data.email);
    if (!userId) {
      return {
        ok: false,
        status: "error",
        message: "Could not reset the password. Please try again.",
      };
    }
    await admin.auth.admin.updateUserById(userId, { password: data.password });
    return {
      ok: true,
      status: "verified",
      message: "Your password has been reset. You can now log in.",
    };
  });

// ---------------------------------------------------------------------------
// LOGIN / SESSION
// ---------------------------------------------------------------------------

export const login = createServerFn({ method: "POST" })
  .inputValidator((data: { email: string; password: string }) => {
    const email = (data?.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) invalid("Please enter a valid email address.");
    if (typeof data.password !== "string" || data.password.length === 0)
      invalid("Please enter your password.");
    return { email, password: data.password };
  })
  .handler(async ({ data }): Promise<LoginResult> => {
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(
      process.env.CUPAI_APP_SB_URL!,
      process.env.CUPAI_APP_SB_ANON!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: signIn, error } = await anon.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });
    if (error || !signIn.user) {
      return { ok: false, message: "Invalid email or password." };
    }
    if (!signIn.user.email_confirmed_at) {
      return {
        ok: false,
        message: "Please verify your email before logging in.",
      };
    }

    const { updateSession } = await import("@tanstack/react-start/server");
    const { getSessionConfig } = await import("@/lib/session.server");
    await updateSession(getSessionConfig(), {
      userId: signIn.user.id,
      email: signIn.user.email ?? data.email,
    });

    // Branch on onboarding status: /welcome for first-time users, /dashboard
    // once they've completed the initial agent setup.
    const { getSetupCompleted, ensureProfile } = await import(
      "@/lib/profile.server"
    );
    await ensureProfile(signIn.user.id);
    const setupCompleted = await getSetupCompleted(signIn.user.id);

    return {
      ok: true,
      message: "Logged in.",
      email: signIn.user.email ?? data.email,
      setupCompleted,
      nextRoute: setupCompleted ? "/dashboard" : "/welcome",
    };
  });

export const getSetupStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<SetupStatus> => {
    const { getSession } = await import("@tanstack/react-start/server");
    const { getSessionConfig } = await import("@/lib/session.server");
    const session = await getSession<{ userId: string; email: string }>(
      getSessionConfig(),
    );
    if (!session.data?.userId) return { setupCompleted: false };
    const { getSetupCompleted } = await import("@/lib/profile.server");
    return { setupCompleted: await getSetupCompleted(session.data.userId) };
  },
);

export const completeSetup = createServerFn({ method: "POST" }).handler(
  async (): Promise<SetupStatus> => {
    const { getSession } = await import("@tanstack/react-start/server");
    const { getSessionConfig } = await import("@/lib/session.server");
    const session = await getSession<{ userId: string; email: string }>(
      getSessionConfig(),
    );
    if (!session.data?.userId) {
      throw new Error("You must be logged in.");
    }
    const { markSetupCompleted } = await import("@/lib/profile.server");
    await markSetupCompleted(session.data.userId);
    return { setupCompleted: true };
  },
);

export const getSessionInfo = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionInfo> => {
    const { getSession } = await import("@tanstack/react-start/server");
    const { getSessionConfig } = await import("@/lib/session.server");
    const session = await getSession<{ userId: string; email: string }>(
      getSessionConfig(),
    );
    return { email: session.data?.email ?? null };
  },
);

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const { clearSession } = await import("@tanstack/react-start/server");
  const { getSessionConfig } = await import("@/lib/session.server");
  await clearSession(getSessionConfig());
  return { ok: true };
});
