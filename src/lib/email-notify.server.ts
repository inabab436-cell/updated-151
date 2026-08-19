/**
 * Server-only helper that sends an email notification to the merchant's
 * registered account email, gated by their per-event preference.
 * Failures never throw — email delivery is best-effort.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/resend.server";

export type MerchantEmailEvent = "new_order" | "missing_information";

const FROM = "cupai <onboarding@resend.dev>";

interface NotifyInput {
  admin: SupabaseClient;
  merchantId: string;
  event: MerchantEmailEvent;
  subject: string;
  html: string;
}

export async function notifyMerchantByEmail(input: NotifyInput): Promise<void> {
  try {
    const { data: merchant } = await input.admin
      .from("merchants")
      .select("user_id")
      .eq("id", input.merchantId)
      .maybeSingle();
    const userId = (merchant as { user_id?: string } | null)?.user_id;
    if (!userId) return;

    const { data: settings } = await input.admin
      .from("email_notification_settings")
      .select("new_order, missing_information")
      .eq("user_id", userId)
      .maybeSingle();
    // Default: enabled when no row exists yet.
    const enabled =
      settings == null
        ? true
        : Boolean((settings as Record<string, unknown>)[input.event] ?? true);
    if (!enabled) return;

    const { data: userRes, error: userErr } = await (
      input.admin as unknown as {
        auth: { admin: { getUserById: (id: string) => Promise<{ data: { user: { email?: string } | null }; error: unknown }> } };
      }
    ).auth.admin.getUserById(userId);
    if (userErr) {
      console.error("[email-notify] getUserById failed", userErr);
      return;
    }
    const email = userRes?.user?.email;
    if (!email) return;

    await sendEmail({
      from: FROM,
      to: email,
      subject: input.subject,
      html: input.html,
    });
  } catch (err) {
    console.error("[email-notify] send failed", err);
  }
}

export function orderEmail(orderNumber: string, conversationId: string): {
  subject: string;
  html: string;
} {
  return {
    subject: `طلب جديد ${orderNumber} · cupai`,
    html: `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.7">
      <h2>طلب جديد وصل إلى متجرك</h2>
      <p>رقم الطلب: <strong>${escapeHtml(orderNumber)}</strong></p>
      <p>يمكنك مراجعة تفاصيل الطلب من لوحة التحكم.</p>
      <p style="color:#666;font-size:12px">معرّف المحادثة: ${escapeHtml(conversationId)}</p>
    </div>`,
  };
}

export function missingInfoEmail(question: string, product: string | null): {
  subject: string;
  html: string;
} {
  return {
    subject: "معلومة ناقصة يحتاجها العملاء · cupai",
    html: `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.7">
      <h2>عميل سأل عن معلومة غير متوفرة</h2>
      <p><strong>السؤال:</strong> ${escapeHtml(question)}</p>
      ${product ? `<p><strong>المنتج:</strong> ${escapeHtml(product)}</p>` : ""}
      <p>أضف هذه المعلومة من لوحة التحكم لتصبح متاحة للوكيل الذكي.</p>
    </div>`,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
