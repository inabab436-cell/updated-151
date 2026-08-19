/**
 * Server-only helpers for the `user_profiles` table.
 *
 * Stores per-user onboarding state (currently `setup_completed`). MUST NOT be
 * imported from client/browser code. All operations use the service-role
 * client and are safe to call from trusted server handlers.
 *
 * If the underlying table does not exist yet, reads default to
 * `setup_completed = false` so the welcome flow still works — see the SQL
 * migration proposed in the chat.
 */

import { getSupabaseAdmin } from "@/integrations/supabase/client.server";

const TABLE = "user_profiles";

export async function getSetupCompleted(userId: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from(TABLE)
    .select("setup_completed")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    // Table missing or transient error — treat as not-yet-completed.
    return false;
  }
  return Boolean(data?.setup_completed);
}

/** Ensure a profile row exists for the user with setup_completed=false. */
export async function ensureProfile(userId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  await admin
    .from(TABLE)
    .upsert(
      { user_id: userId, setup_completed: false },
      { onConflict: "user_id", ignoreDuplicates: true },
    );
}

export async function markSetupCompleted(userId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  await admin
    .from(TABLE)
    .upsert(
      { user_id: userId, setup_completed: true },
      { onConflict: "user_id" },
    );
}
