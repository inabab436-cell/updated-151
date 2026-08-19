/**
 * Global test setup.
 *
 * Provides deterministic default env vars required by the modules under
 * test (session pepper, AI keys, Supabase URL). Individual tests may
 * override these via `vi.stubEnv`.
 */
import { beforeEach, vi } from "vitest";

process.env.CUPAI_APP_SESSION_SECRET ||= "test-session-secret-please-change";
process.env.LOVABLE_API_KEY ||= "test-lovable-api-key";
process.env.CUPAI_APP_SB_URL ||= "https://example.supabase.co";
process.env.CUPAI_APP_SB_ANON ||= "test-anon-key";
process.env.CUPAI_APP_SB_SERVICE ||= "test-service-key";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
