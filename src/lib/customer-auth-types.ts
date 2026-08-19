/**
 * Client-safe shared types for the CUSTOMER (storefront) auth flow.
 *
 * These are used by the storefront/chat UI. They are intentionally SEPARATE
 * from `auth-types.ts` (which powers the merchant login). Nothing in this
 * file may import server-only modules or read secrets.
 */

export interface CustomerOtpSendResult {
  ok: boolean;
  status: "sent" | "cooldown" | "blocked" | "error";
  message: string;
  /** Seconds until the user may request another code. */
  retryAfterSeconds?: number;
  /** ISO timestamp until which the email is blocked. */
  blockedUntil?: string;
  /** How many send requests remain in the current 30-minute window. */
  remainingSends?: number;
  /** TEST MODE ONLY: email sending is bypassed for customer registration. */
  testMode?: boolean;
  /** TEST MODE ONLY: the generated code, returned so login can auto-complete. */
  devCode?: string;
}

export interface CustomerOtpVerifyResult {
  ok: boolean;
  status: "verified" | "invalid" | "expired" | "blocked" | "error";
  message: string;
  attemptsRemaining?: number;
  blockedUntil?: string;
  /** On success: the resolved customer id (already logged in via cookie). */
  customerId?: string;
  email?: string;
}

export interface CustomerSessionInfo {
  loggedIn: boolean;
  email: string | null;
  customerId: string | null;
  merchantId: string | null;
  sessionId: string | null;
  expiresAt: string | null;
}

export const CUSTOMER_CODE_TTL_MINUTES = 30;
export const CUSTOMER_SEND_COOLDOWN_SECONDS = 60;
export const CUSTOMER_MAX_ATTEMPTS = 5;
export const CUSTOMER_MAX_SENDS_PER_WINDOW = 5;
export const CUSTOMER_BLOCK_MINUTES = 30;
export const CUSTOMER_RATE_WINDOW_MINUTES = 30;
/**
 * Customer sessions are effectively permanent: as long as the customer's
 * account exists and they do not sign out, the session stays valid and is
 * renewed on every visit.
 */
export const CUSTOMER_SESSION_DAYS = 3650;
