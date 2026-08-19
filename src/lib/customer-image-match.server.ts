/**
 * Customer image → approved product matching.
 *
 * When a customer attaches an image in chat, this module:
 *   1. Loads the merchant's approved products (id, name, category,
 *      visual_features, internal_description). internal_description is
 *      NEVER shown to the customer or leaked back through the model's
 *      reply — it is used only as identification signal for matching.
 *   2. Asks the vision model (Gemini) to pick the single best matching
 *      product from that candidate list, or `none` when nothing is
 *      similar enough. The model returns a confidence in [0,1].
 *   3. Returns the top match only if its confidence is above the
 *      rejection threshold; otherwise returns null.
 *
 * Server-only. Never import from client code.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const AI_BASE_URL =
  process.env.CUPAI_APP_AI_BASE_URL || "https://ai.gateway.lovable.dev/v1";
const AI_AUTH_HEADER =
  process.env.CUPAI_APP_AI_AUTH_HEADER || "Lovable-API-Key";
const VISION_MODEL =
  process.env.CUPAI_APP_VISION_MODEL || "google/gemini-2.5-flash";

/** Same item/model: safe to describe as an available match. */
export const MATCH_ACCEPT_THRESHOLD = 0.72;
/** Visually close alternative: offer it, but never claim it is the same item. */
export const SIMILAR_ACCEPT_THRESHOLD = 0.42;

/** Hard cap on candidates we pass to the model in one call. */
const MAX_CANDIDATES = 30;

export interface CustomerImageMatch {
  product_id: string;
  product_name: string;
  confidence: number;
  reason: string;
  match_kind: "exact" | "similar";
}

interface Candidate {
  id: string;
  /** Kept only to label the accepted match in the returned value — never sent to the model. */
  name: string;
  category: string | null;
  description: string | null;
  visual_features: unknown;
  internal_description: string | null;
  image_urls: string[];
}


/**
 * Load approved products for a merchant's user.
 *
 * Prefer internal vision metadata when present, but do not depend on it:
 * product images uploaded from the website editor may not have had their
 * internal description regenerated yet. In that case we still pass signed
 * reference images to the vision model so customer-sent images can be matched.
 */
export async function loadMatchCandidates(
  admin: SupabaseClient,
  userId: string,
): Promise<Candidate[]> {
  const { data, error } = await admin
    .from("products")
    .select("id, name, category, description, visual_features, internal_description")
    .eq("user_id", userId);
  if (error) return [];
  const rows = (data ?? []) as any[];

  const out: Candidate[] = [];
  for (const r of rows) {
    const vf = r.visual_features;
    const idesc =
      typeof r.internal_description === "string" ? r.internal_description : null;
    const hasVf = vf && typeof vf === "object";
    // Matching signal is exclusively Vision output: skip products that have
    // neither an internal visual description nor visual features.
    if (!hasVf && !idesc) continue;
    out.push({
      id: String(r.id),
      name: String(r.name ?? ""),
      category: (r.category as string | null) ?? null,
      description: typeof r.description === "string" ? r.description : null,
      visual_features: vf ?? null,
      internal_description: idesc,
      image_urls: [],
    });
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}


/**
 * Ask the vision model to pick the best candidate for a customer image.
 * Returns null when the model refuses (no candidates, low confidence,
 * or API failure). Never throws — failures degrade to "no match".
 */
export async function matchCustomerImage(params: {
  admin: SupabaseClient;
  lovableApiKey: string;
  userId: string;
  imageUrl: string;
}): Promise<CustomerImageMatch | null> {
  const { admin, lovableApiKey, userId, imageUrl } = params;
  if (!lovableApiKey || !imageUrl || !userId) return null;

  let candidates: Candidate[] = [];
  try {
    candidates = await loadMatchCandidates(admin, userId);
  } catch {
    return null;
  }
  if (candidates.length === 0) return null;

  // Matching signal is EXCLUSIVELY the Vision-generated internal visual
  // description and visual_features. Product names, categories, public
  // descriptions and any other textual field are deliberately excluded.
  const catalog = candidates.map((c) => ({
    product_id: c.id,
    visual_features: c.visual_features,
    internal_description: c.internal_description,
  }));

  const system = `أنت خبير مطابقة بصرية.
أمامك صورة أرسلها العميل، وقائمة مرشحين لكل منهم product_id ووصف داخلي بصري (internal_description) وسمات بصرية (visual_features) مولّدة من تحليل الصور.
مهمتك: اختر أفضل مرشح بصرياً وحدد هل هو نفس المنتج/الموديل (exact)، أم منتج قريب يصلح كبديل (similar)، أو ارفض المطابقة.
اعتمد حصرياً على internal_description و visual_features في المقارنة. لا توجد أسماء منتجات أو فئات أو أوصاف تسويقية، ولا يجوز الاعتماد على أي نص آخر.
تجاهل تماماً أي علامة تجارية أو شعار أو نص علامة يظهر في صورة العميل، ولا تستخدمه كإشارة مطابقة، ولا تذكره في الإخراج. قارن فقط الخامة واللون والشكل والنقشة والملمس والتفاصيل البصرية.
لا تخترع product_id غير موجود في القائمة. لا تكشف الوصف الداخلي في أي إخراج. لا تُرجع سوى JSON صالح.
أعِد كائن JSON بهذا الشكل بالضبط:
{"product_id":"<id من القائمة أو null>","confidence":0.0,"match_kind":"exact|similar|none","reason":"سبب قصير جداً بالعربية"}
exact يعني نفس التصميم والموديل بتفاصيله الأساسية، حتى لو اختلف لون بسيط. similar يعني فئة وتصميم متقاربان لكن ليس نفس المنتج. اجعل confidence بين 0 و1. إن لم يوجد حتى بديل قريب، أعِد {"product_id":null,"confidence":0,"match_kind":"none","reason":"لا تطابق واضح"}.`;

  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text:
        "الصورة التالية هي صورة العميل المطلوب مطابقتها مع مرشح من القائمة فقط.",
    },
    { type: "image_url", image_url: { url: imageUrl } },
    {
      type: "text",
      text:
        "قائمة المرشحين (JSON) — تحتوي فقط على internal_description و visual_features. اختر product_id من هذه القائمة فقط:\n" +
        JSON.stringify({ candidates: catalog }).slice(0, 60000),
    },
  ];


  const userMsg = {
    role: "user",
    content,
  };

  let json: any;
  try {
    const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [AI_AUTH_HEADER]: lovableApiKey,
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [{ role: "system", content: system }, userMsg],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) return null;
    json = await res.json();
  } catch {
    return null;
  }

  const raw = json?.choices?.[0]?.message?.content;
  if (typeof raw !== "string") return null;
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Sometimes the model wraps JSON in ```json fences.
    const m = /\{[\s\S]*\}/.exec(raw);
    if (!m) return null;
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  const pid = parsed?.product_id;
  const conf =
    typeof parsed?.confidence === "number" ? parsed.confidence : Number(parsed?.confidence);
  const reason = typeof parsed?.reason === "string" ? parsed.reason : "";
  const requestedKind = parsed?.match_kind === "exact" ? "exact" : "similar";
  if (!pid || typeof pid !== "string") return null;
  if (!Number.isFinite(conf) || conf < SIMILAR_ACCEPT_THRESHOLD) return null;
  const hit = candidates.find((c) => c.id === pid);
  if (!hit) return null;
  const matchKind = requestedKind === "exact" && conf >= MATCH_ACCEPT_THRESHOLD
    ? "exact"
    : "similar";
  return {
    product_id: hit.id,
    product_name: hit.name,
    confidence: conf,
    reason: reason.slice(0, 200),
    match_kind: matchKind,
  };
}
