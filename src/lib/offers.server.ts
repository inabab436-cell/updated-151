/**
 * OFFERS & DISCOUNTS — single source for the agent.
 *
 * Every read is evaluated against the REAL current time, on every customer
 * message. An offer is live only inside its own window; the moment it ends it
 * is treated exactly like a product that ran out: the agent never brings it up
 * again on its own.
 *
 * Two blocks are produced:
 *   LIVE OFFERS  — full detail, safe to sell with.
 *   PAST OFFERS  — recency bucket ONLY (no dates, no values), used solely when
 *                  the customer asks about offers, so the agent can say that
 *                  there was one recently without inventing a timing.
 *
 * Server-only (service-role client). Never import from client code.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type OfferScope = "all" | "product";
export type DiscountType = "percent" | "amount";
/** How many times ONE customer may benefit from the offer. */
export type UsageLimitType = "once_per_customer" | "per_order";

/** Timezone used to decide "today" / "yesterday" for the agent wording. */
export const OFFER_TZ = "Africa/Cairo";

export interface OfferRow {
  id: string;
  title: string;
  description: string | null;
  scope: OfferScope;
  product_id: string | null;
  discount_type: DiscountType;
  discount_value: number;
  coupon_code: string | null;
  min_order_total: number | null;
  /** Max number of customers that can use the offer. null = unlimited. */
  max_redemptions: number | null;
  /** TOTAL number of times the offer was used (a customer may count twice). */
  redemption_count: number;
  /** Unique customers who benefited — this is what max_redemptions limits. */
  beneficiary_count: number;
  /** Once per customer, or on every order. */
  usage_limit_type: UsageLimitType;
  starts_at: string;
  ends_at: string | null;
  is_active: boolean;
  notify_enabled: boolean;
  notify_message: string | null;
  notified_at: string | null;
}

/** How long ago a finished offer ended. */
export type PastBucket =
  | "minutes"
  | "hours"
  | "today"
  | "yesterday"
  | "days"
  | "last_week"
  | "long_ago";

export interface OffersSnapshot {
  live: OfferRow[];
  /** Ended offers with only a recency bucket attached. */
  past: Array<{ bucket: PastBucket }>;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function mapOfferRow(r: Record<string, unknown>): OfferRow {
  return {
    id: String(r.id),
    title: String(r.title ?? "").trim(),
    description: (r.description as string | null) ?? null,
    scope: r.scope === "all" ? "all" : "product",
    product_id: (r.product_id as string | null) ?? null,
    discount_type: r.discount_type === "amount" ? "amount" : "percent",
    discount_value: num(r.discount_value),
    coupon_code: (r.coupon_code as string | null) ?? null,
    min_order_total: r.min_order_total == null ? null : num(r.min_order_total),
    max_redemptions: r.max_redemptions == null ? null : num(r.max_redemptions),
    redemption_count: num(r.redemption_count),
    beneficiary_count: r.beneficiary_count == null ? num(r.redemption_count) : num(r.beneficiary_count),
    usage_limit_type: r.usage_limit_type === "once_per_customer" ? "once_per_customer" : "per_order",
    starts_at: String(r.starts_at ?? new Date().toISOString()),
    ends_at: (r.ends_at as string | null) ?? null,
    is_active: r.is_active !== false,
    notify_enabled: r.notify_enabled === true,
    notify_message: (r.notify_message as string | null) ?? null,
    notified_at: (r.notified_at as string | null) ?? null,
  };
}

/** True when the offer used up its allowed number of UNIQUE customers. */
export function isSoldOut(o: OfferRow): boolean {
  return (
    o.max_redemptions != null && o.max_redemptions > 0 && o.beneficiary_count >= o.max_redemptions
  );
}

/**
 * True when this exact customer can still benefit. With "once per customer" a
 * customer who already benefited is out, even while the offer itself is live.
 */
export function isAvailableForCustomer(o: OfferRow, alreadyUsed: boolean): boolean {
  if (o.usage_limit_type === "once_per_customer" && alreadyUsed) return false;
  return true;
}

/** True while the offer is running right now. */
export function isLive(o: OfferRow, now: number = Date.now()): boolean {
  if (!o.is_active) return false;
  if (isSoldOut(o)) return false;
  const start = Date.parse(o.starts_at);
  if (Number.isFinite(start) && start > now) return false;
  if (o.ends_at) {
    const end = Date.parse(o.ends_at);
    if (Number.isFinite(end) && end <= now) return false;
  }
  return true;
}

/** An offer that already ran and is now finished (not one that never started). */
export function hasEnded(o: OfferRow, now: number = Date.now()): boolean {
  const start = Date.parse(o.starts_at);
  if (Number.isFinite(start) && start > now) return false;
  if (!o.is_active) return true;
  if (isSoldOut(o)) return true;
  if (!o.ends_at) return false;
  const end = Date.parse(o.ends_at);
  return Number.isFinite(end) && end <= now;
}

/** Calendar day (YYYY-MM-DD) of an instant in the offer timezone. */
function dayKey(ms: number, tz: string = OFFER_TZ): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/** Whole calendar days between two instants, in the offer timezone. */
function calendarDaysBetween(end: number, now: number, tz: string = OFFER_TZ): number {
  const a = Date.parse(`${dayKey(end, tz)}T00:00:00Z`);
  const b = Date.parse(`${dayKey(now, tz)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Real elapsed time since the offer ended, bucketed honestly: an offer that
 * ended minutes ago can never be described as "yesterday".
 */
export function pastBucket(o: OfferRow, now: number = Date.now(), tz: string = OFFER_TZ): PastBucket {
  const endRaw = o.ends_at ? Date.parse(o.ends_at) : NaN;
  const end = Number.isFinite(endRaw) ? endRaw : Date.parse(o.starts_at);
  if (!Number.isFinite(end)) return "long_ago";
  const minutes = (now - end) / 60_000;
  const days = calendarDaysBetween(end, now, tz);
  if (days <= 0) return minutes < 60 ? "minutes" : minutes < 360 ? "hours" : "today";
  if (days === 1) return "yesterday";
  if (days <= 4) return "days";
  if (days <= 14) return "last_week";
  return "long_ago";
}

/** Reads the merchant's offers and splits them by the real current time. */
export async function loadOffers(
  admin: SupabaseClient,
  userId: string | null,
  now: number = Date.now(),
  /** Identity of the customer this snapshot is built for, when known. */
  customerKey: string | null = null,
): Promise<OffersSnapshot> {
  const empty: OffersSnapshot = { live: [], past: [] };
  if (!userId) return empty;
  try {
    const { data } = await admin
      .from("offers")
      .select(
        "id, title, description, scope, product_id, discount_type, discount_value, coupon_code, min_order_total, max_redemptions, redemption_count, beneficiary_count, usage_limit_type, starts_at, ends_at, is_active, notify_enabled, notify_message, notified_at",
      )
      .eq("user_id", userId);
    const rows = ((data ?? []) as Record<string, unknown>[]).map(mapOfferRow);

    // "Once per customer": drop the offers this exact customer already used.
    const used = new Set<string>();
    if (customerKey && rows.length) {
      const { data: reds } = await admin
        .from("offer_redemptions")
        .select("offer_id")
        .eq("customer_key", customerKey)
        .in("offer_id", rows.map((r) => r.id));
      for (const r of ((reds ?? []) as any[])) used.add(String(r.offer_id));
    }

    return {
      live: rows.filter((o) => isLive(o, now) && isAvailableForCustomer(o, used.has(o.id))),
      past: rows
        .filter((o) => hasEnded(o, now))
        .map((o) => ({ bucket: pastBucket(o, now) })),
    };
  } catch {
    return empty;
  }
}

function discountText(o: OfferRow, currency: string | null): string {
  if (o.discount_type === "percent") return `خصم ${o.discount_value}%`;
  return `خصم ${o.discount_value} ${currency ?? ""}`.trim();
}

/**
 * The prompt block. Every offer is written as EXPLICIT FIELDS, never as a
 * marketing sentence, so the agent can never read a product-level minimum as a
 * basket total. Eligibility itself is decided by the offer engine
 * (calculate_offer_price), not by the agent.
 */
export function buildOffersBlock(
  snapshot: OffersSnapshot,
  productNameById: Map<string, string>,
  currency: string | null,
): string {
  const lines: string[] = [];
  const cur = currency ? ` ${currency}` : "";

  if (snapshot.live.length === 0) {
    lines.push(
      "لا يوجد أي عرض أو خصم شغّال دلوقتي. أي سعر تقوله هو السعر الأساسي بدون أي خصم، وممنوع منعًا باتًا تلمّح لوجود عرض أو خصم أو تعد بواحد جاي.",
    );
  } else {
    for (const o of snapshot.live) {
      let scopeLine: string;
      if (o.scope === "all") {
        scopeLine = "كل المنتجات بدون استثناء";
      } else {
        const name = o.product_id ? productNameById.get(o.product_id) : null;
        if (!name) continue; // product deleted → the offer does not exist
        scopeLine = `${name} فقط (product_id: ${o.product_id})`;
      }
      const storeWide = o.scope === "all";
      const f: string[] = [];
      f.push(`  - اسم العرض: ${o.title || "عرض"}`);
      f.push(`  - الخصم: ${discountText(o, currency)}`);
      f.push(`  - النطاق: ${scopeLine}`);
      f.push(
        `  - الحد الأدنى: ${
          o.min_order_total == null ? "لا يوجد" : `${o.min_order_total}${cur}`
        }`,
      );
      f.push(
        `  - الحد الأدنى محسوب على: ${
          storeWide ? "إجمالي الطلب (العرض على كل المنتجات)" : "قيمة المنتج المشمول بالعرض وحده"
        }`,
      );
      f.push(
        `  - هل المنتجات الأخرى تُحتسب في الحد الأدنى؟ ${storeWide ? "نعم — كل المنتجات مشمولة" : "لا"}`,
      );
      f.push(`  - هل الخصم يطبق على المنتجات الأخرى؟ ${storeWide ? "نعم" : "لا"}`);
      if (o.description) {
        f.push(`  - تفاصيل: ${String(o.description).replace(/\s+/g, " ").trim()}`);
      }
      if (o.coupon_code) f.push(`  - كود الخصم: ${o.coupon_code}`);
      if (o.max_redemptions != null && o.max_redemptions > 0) {
        f.push(
          `  - عدد محدود: ${o.max_redemptions} عميل، استفاد منه ${o.beneficiary_count}`,
        );
      }
      f.push(
        `  - تكرار الاستفادة: ${
          o.usage_limit_type === "once_per_customer" ? "مرة واحدة لكل عميل" : "على كل طلب للعميل"
        }`,
      );
      if (o.ends_at) f.push(`  - ينتهي في: ${o.ends_at}`);
      lines.push(`- العرض (offer_id: ${o.id}):\n${f.join("\n")}`);
    }
    lines.push(
      "أي منتج غير مذكور في عرض بالأعلى ليس عليه أي خصم — ممنوع تقول أو تلمّح إن عليه عرض.",
    );
    lines.push(
      "قاعدة إلزامية: ممنوع جمع أسعار منتجات غير مؤهلة مع المنتج المؤهل للوصول إلى الحد الأدنى للعرض، وممنوع اقتراح إضافة منتجات غير مؤهلة بغرض استيفاء شرط العرض. الحد الأدنى في العرض المرتبط بمنتج معيّن هو شرط على قيمة هذا المنتج وحده، وليس على إجمالي السلة.",
    );
    lines.push(
      "ممنوع تحسب أي خصم بنفسك أو تستنتج الأهلية من صياغة العرض: استدعِ الأداة calculate_offer_price بالمنتجات والكميات، واقرأ النتيجة كما هي (applies / reason / discount_amount / total). لو الأداة قالت إن العرض لا ينطبق، بلّغ العميل بذلك بوضوح ولا تعده بأي خصم.",
    );
    lines.push(
      "إلزامي: طالما فيه عرض شغّال، استدعِ calculate_offer_price قبل أي رد فيه سعر أو إجمالي، وقبل أي إجابة عن سؤال «في خصم؟»، وبعد أي تعديل في المنتجات أو الكميات. لو العميل لم يحدد الكمية اعتبرها 1 واستدعِ الأداة فورًا — ممنوع تطلب منه بيانات إضافية بدل ما تستدعيها، وممنوع ترد بسعر قبل ما تشوف نتيجتها.",
    );

  }


  if (snapshot.past.length) {
    const b = snapshot.past
      .map((p) => p.bucket)
      .sort((a, z) => rank(a) - rank(z))[0] as PastBucket;
    lines.push(
      `عروض منتهية: العرض الأخير ${bucketArabic(b)}. ` +
        "دي معلومة داخلية: ممنوع تفتح سيرة العروض المنتهية من نفسك نهائيًا، بالظبط زي منتج خلص. " +
        "لو العميل هو اللي سأل عن العروض، قول بنفس المدة دي بالظبط إن العرض خلص — ممنوع تكبّر المدة أو تصغّرها (عرض خلص من دقايق ممنوع تقول عنه امبارح). " +
        "والمتجر بيعمل عروض باستمرار وهتبلّغه أول ما ينزل عرض جديد. " +
        "لو المدة (من زمان) ممنوع تقول يوم أو أسبوع — اكتفِ بإننا بنعمل عروض باستمرار.",
    );
  }

  return (
    "\n\nOFFERS & DISCOUNTS (live, evaluated against the real current time for this exact message):\n" +
    lines.join("\n") +
    "\n"
  );
}

function rank(b: PastBucket): number {
  const order: PastBucket[] = [
    "minutes",
    "hours",
    "today",
    "yesterday",
    "days",
    "last_week",
    "long_ago",
  ];
  const i = order.indexOf(b);
  return i < 0 ? order.length : i;
}

function bucketArabic(b: PastBucket): string {
  switch (b) {
    case "minutes":
      return "خلص من شوية";
    case "hours":
      return "خلص من كام ساعة";
    case "today":
      return "خلص النهارده";
    case "yesterday":
      return "خلص امبارح";
    case "days":
      return "خلص من كام يوم";
    case "last_week":
      return "خلص الأسبوع اللي فات";
    default:
      return "خلص من زمان — بدون ذكر أي مدة";
  }
}

/** Default broadcast wording, editable by the merchant. Every field is filled automatically. */
export const DEFAULT_OFFER_BROADCAST =
  "عندنا عرض جديد يا فندم: [اسم العرض] — [قيمة الخصم] على [المنتج]. يبدأ [تاريخ البداية] وينتهي [تاريخ الانتهاء]. [كود الخصم][الحد الأدنى][عدد المستفيدين] تحب أرشحلك حاجة؟";

/** Placeholders shown to the merchant in the UI. */
export const OFFER_PLACEHOLDERS = [
  "[اسم العرض]",
  "[قيمة الخصم]",
  "[المنتج]",
  "[تاريخ البداية]",
  "[تاريخ الانتهاء]",
  "[كود الخصم]",
  "[الحد الأدنى]",
  "[عدد المستفيدين]",
  "[تفاصيل العرض]",
] as const;

function arDateTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("ar-EG", {
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function buildBroadcastMessage(
  template: string | null,
  o: OfferRow,
  currency: string | null,
  productName?: string | null,
): string {
  const base = String(template ?? "").trim() || DEFAULT_OFFER_BROADCAST;
  const end = arDateTime(o.ends_at) ?? "إشعار آخر";
  const start = arDateTime(o.starts_at) ?? "دلوقتي";
  const product = o.scope === "all" ? "كل المنتجات" : productName?.trim() || "المنتج";
  const coupon = o.coupon_code ? `استخدم كود: ${o.coupon_code}.` : "";
  const minOrder =
    o.min_order_total != null
      ? `العرض يبدأ من طلب قيمته ${o.min_order_total} ${currency ?? ""}.`.replace(/\s+/g, " ")
      : "";
  const remaining =
    o.max_redemptions != null && o.max_redemptions > 0
      ? `العرض لأول ${o.max_redemptions} عميل بس.`
      : "";
  return base
    .replaceAll("[اسم العرض]", o.title || "عرض")
    .replaceAll("[قيمة الخصم]", discountText(o, currency))
    .replaceAll("[المنتج]", product)
    .replaceAll("[تاريخ البداية]", start)
    .replaceAll("[تاريخ الانتهاء]", end)
    .replaceAll("[كود الخصم]", coupon)
    .replaceAll("[الحد الأدنى]", minOrder)
    .replaceAll("[عدد المستفيدين]", remaining)
    .replaceAll("[تفاصيل العرض]", String(o.description ?? "").trim())
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}
