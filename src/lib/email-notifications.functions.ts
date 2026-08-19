/**
 * Merchant email-notification preferences: read + update.
 * The recipient email is always the merchant's registered account email
 * (from auth) — never entered by the user in the UI.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export interface EmailNotificationSettings {
  new_order: boolean;
  missing_information: boolean;
}

export interface EmailNotificationSettingsView extends EmailNotificationSettings {
  email: string;
}

const DEFAULTS: EmailNotificationSettings = {
  new_order: true,
  missing_information: true,
};

export const getEmailNotificationSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<EmailNotificationSettingsView> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId, email } = await requireUserId();
    const admin = getSupabaseAdmin();
    const { data } = await admin
      .from("email_notification_settings")
      .select("new_order, missing_information")
      .eq("user_id", userId)
      .maybeSingle();
    return {
      email: email || "",
      new_order: data?.new_order ?? DEFAULTS.new_order,
      missing_information: data?.missing_information ?? DEFAULTS.missing_information,
    };
  },
);

const updateSchema = z.object({
  new_order: z.boolean(),
  missing_information: z.boolean(),
});

export const updateEmailNotificationSettings = createServerFn({ method: "POST" })
  .inputValidator((v: EmailNotificationSettings) => updateSchema.parse(v))
  .handler(async ({ data }): Promise<EmailNotificationSettings> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from("email_notification_settings")
      .upsert(
        {
          user_id: userId,
          new_order: data.new_order,
          missing_information: data.missing_information,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);
    return data;
  });
