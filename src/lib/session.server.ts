/**
 * Server-only session configuration for cupai.
 *
 * Uses TanStack Start's encrypted cookie sessions. The encryption password is
 * read from the CUPAI_APP_SESSION_SECRET environment variable at call time and
 * is never hardcoded. MUST NOT be imported from client/browser code.
 */

export interface AppSessionData {
  userId: string;
  email: string;
}

export function getSessionConfig() {
  const password = process.env.CUPAI_APP_SESSION_SECRET;
  if (!password) {
    throw new Error("Missing required environment variable: CUPAI_APP_SESSION_SECRET");
  }
  return {
    password,
    name: "cupai_session",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  } as const;
}
