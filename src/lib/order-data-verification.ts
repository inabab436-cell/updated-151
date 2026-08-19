/**
 * Anti-hallucination guard for `create_order`.
 *
 * The agent is the sole owner of business decisions, but it must NEVER invent
 * customer data. Every identity field it sends has to be traceable to either:
 *   * something the customer actually typed in this conversation, or
 *   * the registered customer profile stored in the database.
 *
 * These helpers are pure so they can be tested without a database.
 */

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Arabic-Indic digits → ASCII. */
export function normalizeDigits(input: string): string {
  return String(input ?? "").replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
}

/** Lowercase, strip diacritics/punctuation, unify alef/ya/ta-marbuta, collapse spaces. */
export function normalizeText(input: string): string {
  return normalizeDigits(input)
    .toLocaleLowerCase("ar")
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Phone-like digit runs found in text.
 *
 * Keep the broad 7+ digit fallback, but also retain incomplete Egyptian mobile
 * attempts beginning with `01`. Those short attempts still need to reach the
 * same-turn validation guard so the model cannot answer by reciting the full
 * length/prefix rule instead of naming the one actual problem.
 */
export function extractPhones(input: string): string[] {
  const out: string[] = [];
  const re = /01\d{2,}|\d{7,}/g;
  let m: RegExpExecArray | null;
  const normalized = normalizeDigits(input).replace(/[\s\-().+]/g, "");
  while ((m = re.exec(normalized))) out.push(m[0]);
  return out;
}

/** Obvious placeholder / dummy values the model sometimes fabricates. */
const DUMMY_TEXT =
  /^(?:test|testing|n\/?a|none|unknown|xxx+|عميل|العميل|زبون|مجهول|غير\s*معروف|غير\s*محدد|لا\s*يوجد|اسم\s*العميل|العنوان|رقم\s*العميل)$/i;

export function isDummyText(value: string): boolean {
  const n = normalizeText(value);
  if (!n || n.length < 2) return true;
  return DUMMY_TEXT.test(n);
}

export function isDummyPhone(value: string): boolean {
  const digits = normalizeDigits(value).replace(/\D/g, "");
  if (digits.length < 8) return true;
  if (/^(\d)\1+$/.test(digits)) return true; // 0000000000, 1111111111
  if (/^(?:0?123456789|01234567890?)$/.test(digits)) return true;
  return false;
}

export interface OrderIdentityProfile {
  name?: string | null;
  phone?: string | null;
  address?: string | null;
}

export interface VerifyOrderIdentityInput {
  name: string;
  phone: string;
  address: string;
  /** Raw text of every message the CUSTOMER sent in this conversation. */
  customerMessages: Array<string | null | undefined>;
  profile?: OrderIdentityProfile | null;
}

export interface VerifyOrderIdentityResult {
  ok: boolean;
  /** Field names that could not be traced to the customer or the profile. */
  unverified: string[];
}

function haystack(input: VerifyOrderIdentityInput): string {
  return normalizeText((input.customerMessages ?? []).filter(Boolean).join(" \n "));
}

function nameVerified(input: VerifyOrderIdentityInput, hay: string): boolean {
  if (isDummyText(input.name)) return false;
  const name = normalizeText(input.name);
  const profileName = normalizeText(input.profile?.name ?? "");
  if (profileName && profileName === name) return true;
  if (name.length >= 2 && hay.includes(name)) return true;
  // Every word of the name must have been typed by the customer.
  const tokens = name.split(" ").filter((t) => t.length >= 2);
  return tokens.length > 0 && tokens.every((t) => hay.includes(t));
}

function phoneVerified(input: VerifyOrderIdentityInput, input_hay: string): boolean {
  if (isDummyPhone(input.phone)) return false;
  const digits = normalizeDigits(input.phone).replace(/\D/g, "");
  const tail = digits.slice(-8);
  const profileDigits = normalizeDigits(input.profile?.phone ?? "").replace(/\D/g, "");
  if (profileDigits && profileDigits.slice(-8) === tail) return true;
  return input_hay.replace(/\s+/g, "").includes(tail);
}

function addressVerified(input: VerifyOrderIdentityInput, hay: string): boolean {
  if (isDummyText(input.address)) return false;
  const address = normalizeText(input.address);
  const profileAddress = normalizeText(input.profile?.address ?? "");
  if (profileAddress && (profileAddress === address || profileAddress.includes(address))) return true;
  if (hay.includes(address)) return true;
  const tokens = Array.from(new Set(address.split(" ").filter((t) => t.length >= 3)));
  if (tokens.length === 0) return false;
  const found = tokens.filter((t) => hay.includes(t)).length;
  // The address must be mostly grounded in what the customer typed.
  return found / tokens.length >= 0.7;
}

/**
 * Returns ok:false with the list of fields the agent could not have known,
 * so the caller can refuse the order and force the agent to ask the customer.
 */
export function verifyOrderIdentity(
  input: VerifyOrderIdentityInput,
): VerifyOrderIdentityResult {
  const hay = haystack(input);
  const unverified: string[] = [];
  if (!nameVerified(input, hay)) unverified.push("customer_name");
  if (!phoneVerified(input, hay)) unverified.push("customer_phone");
  if (!addressVerified(input, hay)) unverified.push("customer_address");
  return { ok: unverified.length === 0, unverified };
}

// ---------------------------------------------------------------------------
// Payment method grounding
// ---------------------------------------------------------------------------
//
// Intentionally NOT here: payment methods are never matched by keywords or
// tokens. The chosen method is resolved by understanding the customer's
// meaning — see `src/lib/payment-method-resolution.server.ts`.
