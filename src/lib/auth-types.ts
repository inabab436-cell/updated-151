/**
 * Client-safe shared types for the cupai auth / OTP flows.
 *
 * This file contains ONLY types and plain constants. It is imported by both
 * client components and server code, so it must never import server-only
 * modules or read secrets.
 */

export type OtpPurpose = "signup" | "password_reset";

/** Result of requesting (sending) an OTP code. */
export interface OtpSendResult {
  ok: boolean;
  status: "sent" | "cooldown" | "blocked" | "error";
  message: string;
  /** Seconds until the user may request another code (cooldown). */
  retryAfterSeconds?: number;
  /** ISO timestamp until which the email is blocked (send/attempt block). */
  blockedUntil?: string;
  /** How many send requests remain in the current 30-minute window. */
  remainingSends?: number;
}

/** Result of verifying an OTP code. */
export interface OtpVerifyResult {
  ok: boolean;
  status: "verified" | "invalid" | "expired" | "blocked" | "error";
  message: string;
  /** Remaining verification attempts before the email is blocked. */
  attemptsRemaining?: number;
  /** ISO timestamp until which the email is blocked. */
  blockedUntil?: string;
}

export interface LoginResult {
  ok: boolean;
  message: string;
  email?: string;
  /** Whether the user has already completed the initial agent setup. */
  setupCompleted?: boolean;
  /** Route the client should navigate to next. */
  nextRoute?: "/welcome" | "/dashboard";
}

export interface SetupStatus {
  setupCompleted: boolean;
}

export interface SessionInfo {
  email: string | null;
}

/** Per-purpose limits (kept here so the UI can display them). */
export const SEND_LIMITS: Record<OtpPurpose, number> = {
  signup: 5,
  password_reset: 3,
};

export const ATTEMPT_LIMITS: Record<OtpPurpose, number> = {
  signup: 5,
  password_reset: 3,
};

/** OTP is valid for 10 minutes. */
export const CODE_TTL_MINUTES = 10;
/** Minimum wait between two send requests to the same email. */
export const SEND_COOLDOWN_SECONDS = 60;
/** Rolling window and block duration. */
export const RATE_WINDOW_MINUTES = 30;
export const BLOCK_MINUTES = 30;

export const SPAM_FOLDER_NOTICE =
  "The message may arrive in the spam folder, so please check it.";
