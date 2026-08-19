/**
 * Smart single-image product analysis (merchant-facing suggestions).
 *
 * Used by the "add / edit product" dialogs: the merchant uploads ONE image
 * and presses «تحليل». The model returns the basic product data the merchant
 * sees, with two hard rules that the generic batch analyzer does not enforce:
 *
 *   1. The colour of the item NEVER leaks into the product name or the
 *      description. It is returned separately in `color` so the UI can put it
 *      in the colour field and attach the image to that colour.
 *   2. The material (الخامة) is returned as its own field.
 *
 * Everything returned here is a SUGGESTION only — nothing is written to the
 * database; the merchant reviews and edits before saving.
 */

const AI_BASE_URL =
  process.env.CUPAI_APP_AI_BASE_URL || "https://ai.gateway.lovable.dev/v1";
const AI_AUTH_HEADER =
  process.env.CUPAI_APP_AI_AUTH_HEADER || "Lovable-API-Key";
const AI_API_KEY_ENV =
  process.env.CUPAI_APP_AI_KEY_ENV || "LOVABLE_API_KEY";
const VISION_MODEL =
  process.env.CUPAI_APP_VISION_MODEL || "google/gemini-2.5-flash";

export interface ImageProductSuggestion {
  name: string | null;
  /** Colour-free description shown to the merchant. */
  description: string | null;
  material: string | null;
  category: string | null;
  price: number | null;
  currency: string | null;
  /** The single colour visible in THIS image (goes to the colour field). */
  color: string | null;
  hex: string | null;
  sizes: string[];
}

const EMPTY: ImageProductSuggestion = {
  name: null, description: null, material: null, category: null,
  price: null, currency: null, color: null, hex: null, sizes: [],
};

const SYSTEM_PROMPT = `أنت خبير رؤية حاسوبية متخصص في صور المنتجات التجارية.
تحلّل صورة واحدة فقط لمنتج واحد، وتعيد بيانات المنتج الأساسية لصاحب المتجر.

قواعد إلزامية:
1) اللون: استخرج لون المنتج الظاهر في هذه الصورة تحديداً، وضعه في الحقل "color" فقط (اسم لون عربي مختصر مثل: أسود، أحمر خمري، بيج). لا تذكر اللون إطلاقاً داخل "name" ولا داخل "description".
2) الوصف: وصف عربي تسويقي قصير (١-٣ جمل) للتصميم والقَصّة والاستخدام، بدون أي ذكر للون وبدون ذكر السعر.
3) العلامة التجارية (مهم جداً): افحص الصورة بدقة عالية بحثاً عن اسم العلامة التجارية أينما ظهر: الشعار (اللوجو)، المونوغرام، النص المطبوع أو المطرّز، التاغ، الليبل، الملصق، علبة المنتج، الكعب/النعل، الأزرار، السحاب، أو أي كتابة صغيرة. اقرأ النص كما هو مكتوب حرفياً (بالإنجليزية إن كان مكتوباً بالإنجليزية) وضعه في الحقل "brand". إن قرأت جزءاً فقط اكتب ما قرأته. لا تخمّن ولا تخترع علامة غير ظاهرة — إن لم يظهر أي أثر لعلامة اجعل "brand" = null.
4) الاسم: اسم منتج عربي مختصر بدون ذكر اللون. إن وُجدت علامة تجارية مقروءة فابدأ الاسم باسم العلامة كما هو مكتوب ثم نوع المنتج (مثال: "Nike تيشيرت رياضي").
5) الخامة: استخرج الخامة/القماش إن أمكن تمييزها بصرياً (قطن، جلد، دنيم، كتان، بوليستر…) في الحقل "material"، وإلا اتركها null.
6) المقاسات: أعد فقط المقاسات المكتوبة أو الظاهرة فعلاً في الصورة، وإلا مصفوفة فارغة.
7) السعر: فقط إن كان مكتوباً في الصورة، وإلا null.

أعد JSON فقط بهذه الصيغة:
{"name":string|null,"brand":string|null,"description":string|null,"material":string|null,"category":string|null,
"price":number|null,"currency":string|null,"color":string|null,"hex":string|null,"sizes":string[]}`;

function clean(v: unknown, max = 400): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

/** Remove a colour word from a free-text field, as a safety net. */
function stripColor(text: string | null, color: string | null): string | null {
  if (!text || !color) return text;
  const c = color.trim();
  if (c.length < 2) return text;
  const out = text
    .replace(new RegExp(`\\s*(باللون|بلون|لونه|لون)?\\s*${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "gi"), " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,،])/g, "$1")
    .trim();
  return out || text;
}

/**
 * Analyze one image URL (public or signed) and return merchant-facing
 * suggestions. Never throws for model/parse issues — returns empty fields so
 * the merchant can still type everything manually.
 */
export async function suggestProductFromImage(
  imageUrl: string,
): Promise<ImageProductSuggestion> {
  const apiKey = process.env[AI_API_KEY_ENV];
  if (!apiKey) return EMPTY;

  let res: Response;
  try {
    res = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", [AI_AUTH_HEADER]: apiKey },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "حلّل هذه الصورة وأعد JSON فقط." },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    });
  } catch {
    return EMPTY;
  }
  if (!res.ok) return EMPTY;

  let parsed: Record<string, unknown>;
  try {
    const json = (await res.json()) as any;
    const raw = String(json?.choices?.[0]?.message?.content ?? "");
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return EMPTY;
    parsed = JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return EMPTY;
  }

  const color = clean(parsed.color, 60);
  const priceRaw = parsed.price;
  const sizes = Array.isArray(parsed.sizes)
    ? Array.from(
        new Set(
          parsed.sizes
            .map((s) => (typeof s === "string" ? s.trim() : ""))
            .filter(Boolean),
        ),
      ).slice(0, 30)
    : [];

  // Brand read from the image (logo / tag / print). Prefix it onto the name
  // when the model didn't already include it.
  const brand = clean(parsed.brand, 80);
  let nameOut = stripColor(clean(parsed.name, 200), color);
  if (brand && nameOut && !nameOut.toLowerCase().includes(brand.toLowerCase())) {
    nameOut = `${brand} ${nameOut}`.slice(0, 200);
  } else if (brand && !nameOut) {
    nameOut = brand;
  }

  return {
    name: nameOut,
    description: stripColor(clean(parsed.description, 2000), color),
    material: clean(parsed.material, 120),
    category: clean(parsed.category, 120),
    price:
      typeof priceRaw === "number" && Number.isFinite(priceRaw) ? priceRaw : null,
    currency: clean(parsed.currency, 8),
    color,
    hex: clean(parsed.hex, 16),
    sizes,
  };
}
