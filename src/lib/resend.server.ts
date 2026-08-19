/**
 * Server-only email helper for cupai.
 *
 * Emails are sent through Lovable's BUILT-IN email service (authenticated with
 * the platform-managed LOVABLE_API_KEY) — no third-party key such as
 * CUPAI_APP_RESEND_KEY is needed any more. The public `sendEmail` signature is
 * unchanged so every caller keeps working.
 *
 * This module MUST NOT be imported from client/browser code.
 */

import { sendLovableEmail } from "@lovable.dev/email-js";

/** Sender used when a caller does not pass one. */
const DEFAULT_FROM = "cupai <notify@cupai.app>";

function getApiKey(): string {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) {
    throw new Error("Missing required environment variable: LOVABLE_API_KEY");
  }
  return key;
}

export interface SendEmailInput {
  from?: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
}

export interface SendEmailResult {
  id: string;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Plain-text fallback derived from the HTML body. */
function toText(html: string | undefined, text: string | undefined): string {
  if (text && text.trim()) return text;
  return String(html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Send an email through Lovable's built-in email service. Server-side only. */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const recipients = Array.isArray(input.to) ? input.to : [input.to];
  const results: string[] = [];

  for (const to of recipients.filter((r) => r && r.trim())) {
    const res = await sendLovableEmail(
      {
        to,
        from: input.from?.trim() || DEFAULT_FROM,
        subject: input.subject,
        html: input.html ?? "",
        text: toText(input.html, input.text),
        reply_to: first(input.replyTo),
      },
      { apiKey: getApiKey() },
    );
    if (!res.success) {
      throw new Error(`Email send failed${res.status ? ` [${res.status}]` : ""}`);
    }
    results.push(res.message_id ?? "");
  }

  return { id: results[0] ?? "" };
}
