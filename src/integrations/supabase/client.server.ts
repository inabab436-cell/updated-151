import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase clients for cupai.
 *
 * This module MUST NOT be imported from client/browser code. All credentials
 * are read from environment variables at call time and are never hardcoded.
 *
 * - `getSupabaseAdmin()` uses the service role key (CUPAI_APP_SB_SERVICE) and
 *   BYPASSES Row Level Security. Use it only in trusted server-side code for
 *   operations that require full privileges.
 * - `getSupabaseAnonServer()` uses the anon/public key (CUPAI_APP_SB_ANON) and
 *   respects RLS. Use it for public, non-privileged server-side reads.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const noPersistAuth = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    storage: undefined,
  },
} as const;

let adminClient: SupabaseClient | null = null;
let anonServerClient: SupabaseClient | null = null;

/** Full-privilege client (service role). Server-side only. Bypasses RLS. */
export function getSupabaseAdmin(): SupabaseClient {
  if (!adminClient) {
    adminClient = createClient(
      requireEnv("CUPAI_APP_SB_URL"),
      requireEnv("CUPAI_APP_SB_SERVICE"),
      noPersistAuth,
    );
  }
  return adminClient;
}

/** Anon-key client for server-side public reads. Respects RLS. */
export function getSupabaseAnonServer(): SupabaseClient {
  if (!anonServerClient) {
    anonServerClient = createClient(
      requireEnv("CUPAI_APP_SB_URL"),
      requireEnv("CUPAI_APP_SB_ANON"),
      noPersistAuth,
    );
  }
  return anonServerClient;
}
