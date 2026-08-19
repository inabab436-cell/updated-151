/**
 * SHIPPING LOOKUP (server-only)
 * =============================
 *
 * The shipping table (`shipping_rates`, read live in `loadMerchantData`) is the
 * ONE source of truth for governorates/areas, prices and delivery times.
 *
 * The store-knowledge block already lists every recorded zone, but leaving the
 * lookup itself to the model meant a spelling variant, a city name or a newly
 * added governorate could be "missed" — and the agent fell back to the
 * catch-all "هنتأكد ونقولك" loop instead of reading the row that was right
 * there.
 *
 * This module performs the lookup DETERMINISTICALLY, in code, on every message
 * that talks about a place, and injects the resolved answer into the agent's
 * context BEFORE the reply is generated:
 *
 *   - zone found      → the exact price/eta the agent MUST state now.
 *   - place recorded nowhere → say plainly it is not covered, once.
 *   - no place named  → ask which area, from the live list.
 *
 * Nothing here is hard-coded per merchant: every governorate/area name comes
 * from the table itself, so a row added a second ago is visible immediately
 * with no prompt change.
 */
import {
  EGYPT_GOVERNORATES,
  detectGovernorate,
  matchShippingZone,
  type ShippingZone,
} from "@/lib/order-input-validation";
import { normalizeText } from "@/lib/order-data-verification";
import { safeSlice } from "@/lib/safe-slice";

function zoneLabel(z: ShippingZone): string {
  return [z.country, z.region].filter(Boolean).join(" / ") || "-";
}

function zoneLine(z: ShippingZone): string {
  return [
    `المنطقة: ${zoneLabel(z)}`,
    z.price != null ? `سعر الشحن: ${z.price} ${z.currency ?? ""}`.trim() : "سعر الشحن: غير مسجّل",
    z.eta ? `مدة التوصيل: ${z.eta}` : "مدة التوصيل: غير مسجّلة",
  ].join(" | ");
}

/**
 * Does the customer's text name a place at all? Any governorate we know, or
 * any region/country name that exists in the merchant's own table (dynamic).
 */
function namedPlace(zones: ShippingZone[], text: string): string | null {
  const hay = normalizeText(text);
  if (!hay) return null;
  for (const z of zones) {
    for (const part of [z.region ?? "", z.country ?? ""]) {
      const p = normalizeText(part);
      if (p && p.length >= 3 && hay.includes(p)) return part;
    }
  }
  const gov = detectGovernorate(text);
  if (gov) return gov;
  for (const g of EGYPT_GOVERNORATES) {
    const n = normalizeText(g);
    if (n && hay.includes(n)) return g;
  }
  return null;
}

export interface ShippingLookupInput {
  zones: ShippingZone[];
  /** Current customer message first, then earlier customer messages. */
  texts: Array<string | null | undefined>;
}

/**
 * Builds the SHIPPING LOOKUP block that is appended to the fresh store
 * snapshot. Always returns the full live table; adds a resolved verdict when
 * the customer named a place.
 */
export function buildShippingLookupBlock(input: ShippingLookupInput): string {
  const zones = (input.zones ?? []).filter(Boolean);
  const texts = (input.texts ?? []).filter(Boolean) as string[];
  const current = texts[0] ?? "";

  if (zones.length === 0) {
    return (
      "\n\n## SHIPPING LOOKUP (live table — read for this exact message)\n" +
      "جدول الشحن فاضي: مفيش أي منطقة أو سعر شحن أو مدة توصيل مسجّلة دلوقتي.\n" +
      "قول للعميل بصراحة إن أسعار الشحن لسه مش متسجّلة، وبلّغها كنقص معلومات مرة واحدة فقط. ممنوع تخترع سعر أو مدة."
    );
  }

  const table = zones.map((z) => `- ${zoneLine(z)}`).join("\n");
  const names = zones.map(zoneLabel).join("، ");

  const match = matchShippingZone(zones, texts);
  const place = namedPlace(zones, current) ?? (texts.length ? namedPlace(zones, texts.join(" ")) : null);

  let verdict: string;
  if (match.zone) {
    const z = match.zone;
    verdict =
      `النتيجة: الشحن لمنطقة العميل موجود في الجدول → ${zoneLine(z)}\n` +
      "إلزامي: جاوب دلوقتي بالسعر والمدة دول بالنص من السطر ده. " +
      "ممنوع منعًا باتًا تقول «هنتأكد» أو «هنراجع ونقولك» أو أي وعد بالرجوع، وممنوع تسأل العميل عن منطقته تاني، " +
      "وممنوع تستخدم سعر أو مدة منطقة تانية.";
  } else if (match.conflict || (place && !match.zone)) {
    verdict =
      `النتيجة: العميل ذكر «${place ?? match.addressGovernorate ?? "-"}» وهي مش موجودة في جدول الشحن.\n` +
      "إلزامي: قول للعميل بوضوح ومرة واحدة إن المنطقة دي مش ضمن مناطق الشحن المسجّلة حاليًا، واعرض عليه المناطق المتاحة فوق. " +
      "ممنوع تقول «هنتأكد ونقولك» أو تكرر نفس الجملة في كل رد، وممنوع تخترع سعر أو مدة، وممنوع تستخدم سعر منطقة تانية.";
  } else {
    verdict =
      "النتيجة: العميل لسه ما حددش منطقته.\n" +
      `إلزامي: اسأله سؤال واحد قصير عن محافظته/منطقته من المناطق المسجّلة (${safeSlice(names, 0, 800)})، ` +
      "من غير أي وعد بالمراجعة أو التأكد.";
  }

  return (
    "\n\n## SHIPPING LOOKUP (live table — read for this exact message)\n" +
    "ده استعلام مباشر من جدول الشحن الحالي، وهو المصدر الوحيد لمناطق الشحن وأسعارها ومددها. " +
    "أي منطقة اتضافت للجدول بتظهر هنا فورًا؛ ممنوع تعتمد على الذاكرة أو على أي كلام قديم في المحادثة.\n" +
    "كل مناطق الشحن المسجّلة الآن:\n" +
    table +
    "\n" +
    verdict
  );
}
