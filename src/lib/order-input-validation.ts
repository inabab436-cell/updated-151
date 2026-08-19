/**
 * ORDER INPUT VALIDATION
 * ======================
 *
 * Deterministic, testable guards for the three identity fields the agent
 * sends to `create_order`, plus shipping-zone inference.
 *
 * The agent owns the conversation, but it must never be able to push an order
 * through with a one-word name, a broken phone number, or an address that is
 * just a governorate. These rules are enforced in code so they cannot be
 * talked around.
 *
 * Pure module — no database, no imports from server-only code.
 */
import { normalizeDigits, normalizeText } from "@/lib/order-data-verification";

// ---------------------------------------------------------------------------
// Name
// ---------------------------------------------------------------------------

/** Honorifics / fillers that do not count as a real part of the name. */
const NAME_FILLERS = new Set([
  "استاذ", "أستاذ", "مستر", "mr", "mrs", "ms", "dr", "دكتور", "مهندس", "م",
  "الاستاذ", "حضرة", "سيد", "سيدة", "انا", "أنا", "اسمي", "الاسم", "اسمى",
  "my", "name", "is", "i", "am",
]);

export interface FieldCheck {
  ok: boolean;
  /** Machine-readable reason, used to tell the agent what to ask for. */
  reason?: string;
}

/**
 * A human name must be two to four alphabetic parts (اسم ثنائي أو ثلاثي).
 * Digits, symbols, emoji and single-word names are rejected.
 */
export function validateCustomerName(raw: string): FieldCheck {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: false, reason: "empty" };
  if (/\d/.test(normalizeDigits(value))) return { ok: false, reason: "contains_digits" };
  if (/[^\p{L}\s'’.-]/u.test(value)) return { ok: false, reason: "contains_symbols" };

  const parts = normalizeText(value)
    .split(" ")
    .filter((p) => p.length > 0 && !NAME_FILLERS.has(p));
  const real = parts.filter((p) => p.length >= 2);
  if (real.length < 2) return { ok: false, reason: "single_word" };
  if (real.length > 4) return { ok: false, reason: "too_many_words" };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Phone (Egypt)
// ---------------------------------------------------------------------------

/**
 * Returns the canonical local form (01XXXXXXXXX) of a valid Egyptian mobile
 * number, or null when the number is incomplete/invalid.
 * Accepts 01…, 201…, +201…, 0020… and spaced/dashed variants.
 */
export function normalizeEgyptianPhone(raw: string): string | null {
  let d = normalizeDigits(String(raw ?? "")).replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("0020")) d = d.slice(4);
  else if (d.startsWith("20") && d.length >= 12) d = d.slice(2);
  if (d.length === 10 && /^1[0125]/.test(d)) d = `0${d}`;
  return /^01[0125]\d{8}$/.test(d) ? d : null;
}

/** True only for a valid Egyptian mobile number. */
export function isEgyptianPhone(raw: string): boolean {
  return validateEgyptianPhone(raw).ok;
}

/** The four real Egyptian mobile operator prefixes. */
const MOBILE_PREFIXES = ["010", "011", "012", "015"];

/**
 * Validates BOTH properties of an Egyptian mobile at the same time: the exact
 * length (11 digits in local form) AND a real operator prefix. A number is
 * rejected when either one fails, and the reason says which one — so a
 * 11-digit number with a non-existent prefix (013/014/016/017/018/019) is
 * never accepted just because the digit count looks right, and a wrong-prefix
 * number is never reported as merely "incomplete".
 */
export function validateEgyptianPhone(raw: string): FieldCheck {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: false, reason: "empty" };
  const normalized = normalizeEgyptianPhone(value);
  if (!normalized) {
    // Reduce to the local form as far as possible, so the prefix can be
    // inspected independently of how the customer wrote the number.
    let d = normalizeDigits(value).replace(/\D/g, "");
    if (d.startsWith("0020")) d = d.slice(4);
    else if (d.startsWith("20") && d.length >= 12) d = d.slice(2);
    if (/^1[0-9]/.test(d)) d = `0${d}`;

    const looksMobile = d.startsWith("01");
    const hasRealPrefix = MOBILE_PREFIXES.some((p) => d.startsWith(p));

    if (looksMobile && !hasRealPrefix) return { ok: false, reason: "bad_prefix" };
    if (hasRealPrefix && d.length > 11) return { ok: false, reason: "too_long" };
    if (hasRealPrefix && d.length < 11) return { ok: false, reason: "too_short" };
    return { ok: false, reason: d.length < 11 ? "too_short" : "not_egyptian_mobile" };
  }
  // Repeated-digit dummies (01111111111 is a real prefix but not a real number).
  if (/^01[0125](\d)\1{7}$/.test(normalized)) return { ok: false, reason: "dummy" };
  return { ok: true };
}



// ---------------------------------------------------------------------------
// Address
// ---------------------------------------------------------------------------

export const EGYPT_GOVERNORATES: string[] = [
  "القاهرة", "الجيزة", "الاسكندرية", "الإسكندرية", "القليوبية", "الشرقية",
  "الدقهلية", "الغربية", "المنوفية", "البحيرة", "كفر الشيخ", "دمياط",
  "بورسعيد", "الاسماعيلية", "الإسماعيلية", "السويس", "شمال سيناء",
  "جنوب سيناء", "البحر الاحمر", "البحر الأحمر", "مطروح", "الفيوم",
  "بني سويف", "المنيا", "اسيوط", "أسيوط", "سوهاج", "قنا", "الاقصر",
  "الأقصر", "اسوان", "أسوان", "الوادي الجديد",
];

/** Common city/area words that stand in for a governorate in daily speech. */
const CITY_ALIASES: Record<string, string> = {
  مصر: "القاهرة",
  "مصر الجديدة": "القاهرة",
  المعادي: "القاهرة",
  "مدينة نصر": "القاهرة",
  حلوان: "القاهرة",
  "6 اكتوبر": "الجيزة",
  "السادس من اكتوبر": "الجيزة",
  "الشيخ زايد": "الجيزة",
  الهرم: "الجيزة",
  فيصل: "الجيزة",
  الدقي: "الجيزة",
  المهندسين: "الجيزة",
  اسكندرية: "الإسكندرية",
  المنصورة: "الدقهلية",
  طنطا: "الغربية",
  الزقازيق: "الشرقية",
  "شبرا الخيمة": "القليوبية",
  بنها: "القليوبية",
  دمنهور: "البحيرة",
  الغردقة: "البحر الأحمر",
  "شرم الشيخ": "جنوب سيناء",
};

/** Words that indicate a street / building level detail. */
const STREET_HINTS = [
  "شارع", "ش", "شركه", "برج", "عماره", "عمارة", "عقار", "مبني", "مبنى",
  "طريق", "ميدان", "خلف", "امام", "بجوار", "جوار", "بجانب", "محطه", "محطة",
  "منطقه", "منطقة", "حي", "قريه", "قرية", "مركز", "مدينه", "مدينة", "مجاوره",
  "مجاورة", "بلوك", "شقه", "شقة", "الدور", "كومباوند", "تقسيم", "زمام",
  "street", "st", "road", "block", "building",
];

export interface AddressCheck extends FieldCheck {
  /** The governorate detected inside the address, if any. */
  governorate?: string | null;
  /** Which parts are still missing, for the agent to ask about. */
  missing: string[];
}

export function detectGovernorate(raw: string): string | null {
  const text = normalizeText(raw);
  if (!text) return null;
  for (const g of EGYPT_GOVERNORATES) {
    if (text.includes(normalizeText(g))) return g;
  }
  for (const [alias, gov] of Object.entries(CITY_ALIASES)) {
    if (text.includes(normalizeText(alias))) return gov;
  }
  return null;
}

/**
 * A deliverable address needs the governorate PLUS an area/district PLUS a
 * street or an equally clear landmark. Building/flat number and landmark are
 * optional and are never required.
 */
export function validateAddress(raw: string): AddressCheck {
  const value = String(raw ?? "").trim();
  const missing: string[] = [];
  if (!value) return { ok: false, reason: "empty", governorate: null, missing: ["governorate", "area", "street"] };

  const governorate = detectGovernorate(value);
  const normalized = normalizeText(value);
  const words = normalized.split(" ").filter(Boolean);
  const govWords = governorate ? normalizeText(governorate).split(" ").length : 0;
  const rest = words.length - govWords;

  if (!governorate) missing.push("governorate");

  const hasStreetHint = STREET_HINTS.some((h) => words.includes(normalizeText(h)));
  // A street/landmark line, or at least three extra descriptive words.
  const hasDetail = hasStreetHint || rest >= 3;
  const hasArea = rest >= 1;

  if (!hasArea) missing.push("area");
  if (!hasDetail) missing.push("street_or_landmark");

  return {
    ok: missing.length === 0,
    reason: missing.length ? "incomplete_address" : undefined,
    governorate,
    missing,
  };
}

// ---------------------------------------------------------------------------
// Shipping zone inference
// ---------------------------------------------------------------------------

export interface ShippingZone {
  country: string | null;
  region: string | null;
  price: number | null;
  currency: string | null;
  eta?: string | null;
}

export interface ShippingMatch {
  zone: ShippingZone | null;
  /** true when only one zone exists, so it applies to everyone. */
  fallbackSingleZone?: boolean;
  /**
   * true when the customer's address points at a governorate the merchant has
   * NO recorded zone for. The caller must never fall back to another zone's
   * price or ETA in this case — that is how a Cairo address ends up charged
   * the Alexandria rate.
   */
  conflict?: boolean;
  /** The governorate detected in the address, when there is one. */
  addressGovernorate?: string | null;
}

const GENERIC_ZONE_WORDS = new Set([
  "محافظه", "محافظة", "محافظات", "المحافظات", "مدينه", "مدينة", "منطقه", "منطقة",
  "قسم", "governorate", "city", "كل", "جميع", "كافه", "كافة", "باقي", "اي", "أي",
  "all", "any", "egypt", "مصر",
]);

/** Drops the Arabic definite article so "الاسكندريه" and "اسكندريه" match. */
function stripAl(token: string): string {
  return token.startsWith("ال") && token.length > 4 ? token.slice(2) : token;
}

function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(" ")
    .filter(Boolean)
    .map(stripAl);
}

function zoneTokens(zone: ShippingZone): string[] {
  const parts = [zone.region ?? "", zone.country ?? ""].join(" ");
  return tokenize(parts).filter((t) => t.length >= 3 && !GENERIC_ZONE_WORDS.has(t));
}

/** Tokens taken from the zone's own region column — these identify the zone. */
function regionTokens(zone: ShippingZone): string[] {
  return tokenize(zone.region ?? "").filter(
    (t) => t.length >= 3 && !GENERIC_ZONE_WORDS.has(t),
  );
}

/**
 * A zone that covers everywhere ("كل المحافظات", "جميع مصر", empty region).
 * A zone whose region simply is not a governorate name we recognise (a city,
 * a district, a custom zone name) is NOT generic — treating it as generic is
 * what made a customer in one area get another area's price and delivery time.
 */
function isGenericZone(zone: ShippingZone): boolean {
  return regionTokens(zone).length === 0;
}

/**
 * The governorate a zone stands for, or null when the zone names something we
 * cannot resolve to a governorate. Only the region names a governorate; the
 * country column would alias "مصر" to القاهرة and mislabel every zone.
 */
function zoneGovernorate(zone: ShippingZone): string | null {
  return detectGovernorate(zone.region ?? "");
}

/**
 * Direct text match: the customer's own words contain the zone's region name
 * (city, district or custom zone name), even when that name is not a
 * governorate. The most specific match (most matching region tokens) wins.
 */
function matchByRegionText(list: ShippingZone[], text: string): ShippingZone | null {
  const words = new Set(tokenize(text));
  if (words.size === 0) return null;
  let best: { zone: ShippingZone; score: number } | null = null;
  for (const zone of list) {
    const tokens = regionTokens(zone);
    if (tokens.length === 0) continue;
    const score = tokens.filter((t) => words.has(t)).length;
    if (score > 0 && (!best || score > best.score)) best = { zone, score };
  }
  return best?.zone ?? null;
}

/**
 * Finds the shipping zone for the customer from the address and anything they
 * said earlier in the conversation. Never guesses: when nothing matches, the
 * caller must ask the customer.
 */
export function matchShippingZone(
  zones: ShippingZone[],
  texts: Array<string | null | undefined>,
): ShippingMatch {
  const list = (zones ?? []).filter(Boolean);
  if (list.length === 0) return { zone: null };
  const all = (texts ?? []).filter(Boolean) as string[];
  const hay = normalizeText(all.join(" \n "));
  if (!hay) return list.length === 1 ? { zone: list[0], fallbackSingleZone: true } : { zone: null };

  const addressText = all[0] ?? "";
  const addressGov = detectGovernorate(addressText) ?? detectGovernorate(hay);

  // 1) The address itself names a recorded zone (region column matched
  //    literally). This works for districts and custom zone names too.
  const direct = matchByRegionText(list, addressText);
  if (direct) return { zone: direct, addressGovernorate: addressGov ?? null };

  // 2) The address names a governorate that a recorded zone covers.
  if (addressGov) {
    const exact = list.find((z) => {
      const g = zoneGovernorate(z);
      return g != null && normalizeText(g) === normalizeText(addressGov);
    });
    if (exact) return { zone: exact, addressGovernorate: addressGov };

    const generic = list.find(isGenericZone);
    if (generic) return { zone: generic, addressGovernorate: addressGov };

    // Every recorded zone resolves to a DIFFERENT governorate → no rate exists.
    const allResolved = list.every((z) => zoneGovernorate(z) != null);
    if (allResolved) return { zone: null, conflict: true, addressGovernorate: addressGov };
    // Some zones are named after cities/districts we cannot resolve: we must
    // not guess in either direction — ask the customer which zone they are in.
    return { zone: null, addressGovernorate: addressGov };
  }

  // 3) Nothing in the address; fall back to anything else the customer said.
  const fromHistory = matchByRegionText(list, hay);
  if (fromHistory) return { zone: fromHistory };

  const generic = list.find(isGenericZone);
  if (generic) return { zone: generic, fallbackSingleZone: list.length === 1 };

  let best: { zone: ShippingZone; score: number } | null = null;
  for (const zone of list) {
    const tokens = zoneTokens(zone);
    if (tokens.length === 0) continue;
    const region = regionTokens(zone);
    let score = 0;
    for (const t of tokens) {
      if (hay.split(" ").map(stripAl).includes(t)) score += region.includes(t) ? 2 : 1;
    }
    if (score > 0 && (!best || score > best.score)) best = { zone, score };
  }
  if (best) return { zone: best.zone };
  if (list.length === 1) return { zone: list[0], fallbackSingleZone: true };
  return { zone: null };
}


