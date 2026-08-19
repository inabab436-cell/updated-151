/**
 * Product vision layer — deep visual analysis of product images.
 *
 * WHEN IT RUNS
 *   - On upload: right after staging_products rows are inserted for a
 *     batch. Runs asynchronously per-row; failures are recorded on the
 *     row (status='failed') and never block the merchant.
 *   - On product update after approval: when product_images changes,
 *     approve_product_row marks products.internal_description_status
 *     as 'stale'; a background sweep (regenerateStaleProducts) refreshes
 *     them against the new image set.
 *
 * WHAT IT PRODUCES
 *   - internal_description: a long, precise Arabic paragraph describing
 *     the fine visual details of the product (design, material, colors,
 *     patterns, cut, silhouette, distinguishing details).
 *   - visual_features: structured JSON companion for scored matching.
 *   - internal_description_hash: stable hash of the ordered image set
 *     the description was computed from. Regenerate only when it changes.
 *
 * WHY INTERNAL
 *   - Never exposed to customers. Used exclusively for:
 *       * dedupe / merge decisions on staging,
 *       * matching customer-sent images against approved products.
 */

import { getSupabaseAdmin } from "@/integrations/supabase/client.server";
import { UPLOAD_BUCKET } from "@/lib/storage.server";

const AI_BASE_URL =
  process.env.CUPAI_APP_AI_BASE_URL || "https://ai.gateway.lovable.dev/v1";
const AI_AUTH_HEADER =
  process.env.CUPAI_APP_AI_AUTH_HEADER || "Lovable-API-Key";
const AI_API_KEY_ENV =
  process.env.CUPAI_APP_AI_KEY_ENV || "LOVABLE_API_KEY";
const VISION_MODEL =
  process.env.CUPAI_APP_VISION_MODEL || "google/gemini-2.5-flash";

/** Exported for tests: the internal-description contract lives in this prompt. */
export const VISION_SYSTEM_PROMPT = `You are a computer vision expert specialized in analyzing commercial product images.
You will be provided with all images of a single product (they may represent different colors/sizes of the same product).

Your task is twofold:
1) For each individual image: provide an accurate visual description specific to that image only (the exact color shown in that image, and any details unique to it, even if the other images of the same product are different).
2) Provide one comprehensive description of the product as a whole that combines all details shared across all images (cut, overall design, construction), plus a list of the differences between the images (different colors/sizes).

PURPOSE OF THESE DESCRIPTIONS (read carefully):
- They are INTERNAL ONLY: used for visual matching, deduplication and finding the right product. They are NOT marketing copy and NOT a text to be read to a customer.
- Therefore write them as a precise, neutral visual inventory of what is visible.

MANDATORY DESCRIPTION RULES:
- Describe everything that can be extracted from the image: garment/product type, overall shape, cut and fit as it appears, colors and their exact shades and where each shade sits, design details, collar/neckline, sleeves and their length and ending, pockets, zippers, buttons and other hardware, prints, embroidery and patterns with their placement and size, seams, hems, stitching and finishing, drawstrings, cuffs, waistband, closures, lining if visible, the visible appearance and texture of the fabric (matte/shiny, smooth/ribbed/knit/woven, thickness as it LOOKS), proportions, and any other useful distinguishing detail.
- NO praise and NO evaluation. Forbidden in every form: beautiful, elegant, premium, high quality, luxurious, comfortable, cosy, warm, breathable, lightweight, trendy, stylish, perfect, "suitable for", or any judgement, rating or recommendation. Also forbidden in Arabic: جميل، أنيق، راقي، فخم، ممتاز، مريح، دافئ، يدفي، خفيف، جودة عالية، بريميوم، مثالي، شيك. Only observable facts.
- NO INFERENCE about how the product feels or performs. Never write that the fabric looks/seems warm, comfortable, soft, breathable or light, and never use hedging verbs such as "يوحي بأنه" / "يبدو أنه" to smuggle such a claim in. Thickness is described only as visible appearance (for example: a thick knit with deep vertical ribs), with no conclusion about warmth or comfort.
- NEVER invent anything that is not clearly visible. In particular do not state the fiber/material type (cotton, wool, leather, polyester…), the quality, the comfort, the warmth, or the weight unless it is unmistakably identifiable from the image or written on a visible label. When it is not certain, describe the APPEARANCE only (for example: a knitted surface with visible vertical ribbing) and say nothing about what the fiber is.
- Do not mention prices, sizes you cannot see, availability, or the store.
- Language: write in plain, neutral, standard Arabic descriptive wording. Do not use any regional dialect, sales tone, or fashion-catalogue jargon, so the same text can later be reused with other dialects and languages.

Return only a JSON object in the following format:
{
  "product_internal_description": "A long Arabic paragraph (200–500 words) describing the product as a whole, following the mandatory rules above...",
  "product_visual_features": {
    "category": string,
    "materials": [string],
    "silhouette": string,
    "distinguishing_details": [string],
    "confidence": 0.0
  },
  "images": [
    {
      "source_file_name": "The original file name of this specific image",
      "image_internal_description": "A precise Arabic description (50–150 words) specific to this image only — the exact color shown in it, and any differences from the other images of the same product",
      "image_visual_features": {
        "primary_color": string,
        "secondary_colors": [string],
        "condition": "new|used|unknown"
      }
    }
  ]
}
Do not return anything outside this object. Do not mention prices.
"materials" holds only what is visually certain; leave it as an empty array when the fiber cannot be identified from the image.

ABSOLUTE BRAND-IDENTITY RULE (highest priority, no exceptions):
- Completely ignore any brand identity in the images, even when a brand name, logo, monogram, wordmark, emblem, tag, label, or printed text is clearly visible.
- Never write a brand name, sub-brand, designer name, manufacturer, store name, model name, collection name, or slogan in ANY field of the output.
- Never transcribe, translate, spell, hint at, abbreviate, or paraphrase visible brand text or logos. Do not say things like "a well-known brand", "a luxury label", or "logo of X".
- If a logo or brand text is visually present, describe it only as an abstract visual element (for example: "a small embroidered emblem in the center of the chest", "printed text in a contrasting color on the front") without identifying or reproducing it.
- Restrict all descriptions strictly to objective visual attributes: color, shape, cut/silhouette, pattern, texture, stitching, hardware, finish, proportions, and similar visible characteristics.`;

const SYSTEM_PROMPT = VISION_SYSTEM_PROMPT;

const MAX_IMAGES_PER_CALL = 20;

/**
 * Trim a list of images down to `max` while making sure every colour (group)
 * is represented before any single colour gets a second image.
 *
 * Round-robin over the groups in their original order: one image per group,
 * then a second per group, and so on. Items keep their relative order inside
 * each group, and the final list is re-ordered back to the input order so the
 * hash stays stable for an unchanged image set.
 */
export function pickBalancedByGroup<T>(
  items: T[],
  groupOf: (item: T) => string,
  max: number,
): T[] {
  if (items.length <= max) return items.slice();
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const k = groupOf(it) || "__none__";
    const arr = groups.get(k) ?? [];
    arr.push(it);
    groups.set(k, arr);
  }
  const picked = new Set<T>();
  const lists = Array.from(groups.values());
  let round = 0;
  while (picked.size < max) {
    let added = false;
    for (const list of lists) {
      if (round >= list.length) continue;
      picked.add(list[round]);
      added = true;
      if (picked.size >= max) break;
    }
    if (!added) break;
    round++;
  }
  return items.filter((it) => picked.has(it));
}

/** Stable hash of the ordered image path list — SHA-256 hex. */
export async function hashImagePaths(paths: string[]): Promise<string> {
  const enc = new TextEncoder().encode(paths.join("\n"));
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Resolve uploaded_files ids to image entries (id, path, file name). */
interface ResolvedImage {
  id: string | null;
  path: string;
  fileName: string;
  /** Merchant-entered colour label; null means this is a general product image. */
  colorLabel?: string | null;
}

interface ProductResolvedImage extends ResolvedImage {
  colorId: string;
  colorLabel: string | null;
}

function basename(p: string): string {
  const s = String(p ?? "");
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return i >= 0 ? s.slice(i + 1) : s;
}

async function resolveImageFiles(
  admin: ReturnType<typeof getSupabaseAdmin>,
  fileIds: string[],
): Promise<ResolvedImage[]> {
  if (fileIds.length === 0) return [];
  const { data } = await admin
    .from("uploaded_files")
    .select("id, storage_path, mime_type, file_name")
    .in("id", fileIds);
  const byId = new Map<string, ResolvedImage>();
  for (const f of data ?? []) {
    const path = String((f as any).storage_path ?? "");
    if (!path) continue;
    if (!/^image\//i.test(String((f as any).mime_type ?? ""))) continue;
    byId.set(String((f as any).id), {
      id: String((f as any).id),
      path,
      fileName: String((f as any).file_name ?? basename(path)),
    });
  }
  return fileIds
    .map((id) => byId.get(String(id)))
    .filter((v): v is ResolvedImage => !!v)
    .slice(0, MAX_IMAGES_PER_CALL);
}

interface SignedImage extends ResolvedImage {
  url: string;
}

async function signImages(
  admin: ReturnType<typeof getSupabaseAdmin>,
  imgs: ResolvedImage[],
  bucket: string,
): Promise<SignedImage[]> {
  const out: SignedImage[] = [];
  for (const img of imgs) {
    const { data, error } = await admin.storage
      .from(bucket)
      .createSignedUrl(img.path, 60 * 30);
    if (!error && data?.signedUrl) out.push({ ...img, url: data.signedUrl });
  }
  return out;
}

export interface PerImageDescription {
  /** uploaded_files.id (or product_images.id for the regenerate path); may be null when the file wasn't matched. */
  image_id: string | null;
  /** Original file name of this image, echoed back by the model / derived from storage. */
  source_file_name: string;
  internal_description: string;
  visual_features: Record<string, unknown>;
}

interface VisionOutput {
  /** Product-level description (unchanged shape kept for backward compat). */
  internal_description: string;
  visual_features: Record<string, unknown>;
  /** Per-image descriptions, one per input image, aligned via source_file_name. */
  images: PerImageDescription[];
}

async function callVision(imgs: SignedImage[]): Promise<VisionOutput> {
  const apiKey = process.env[AI_API_KEY_ENV];
  if (!apiKey) throw new Error(`Missing ${AI_API_KEY_ENV}`);

  const parts: Array<Record<string, unknown>> = [
    {
      type: "text",
      text:
        "حلّل صور المنتج التالية وأعِد الكائن المطلوب فقط. قواعد الألوان: الصورة العامة غير المرتبطة بلون يجب أن يصف نصها الداخلي المنتج نفسه من دون ذكر أي لون. الصورة المرتبطة باسم لون يجب أن يذكر وصفها لونها المرئي. وصف المنتج الشامل يصف التصميم والخامة والشكل المشترك، ويذكر اختلافات الألوان فقط عند وجود صور مرتبطة بألوان. الملفات بالترتيب:\n" +
        imgs.map((f, i) => `${i + 1}) ${f.fileName} | الارتباط: ${f.colorLabel ? `لون ${f.colorLabel}` : "صورة عامة بلا لون"}`).join("\n"),
    },
  ];
  for (const f of imgs) {
    parts.push({
      type: "text",
      text: f.colorLabel
        ? `صورة: ${f.fileName} — مرتبطة بلون: ${f.colorLabel}. اذكر اللون في وصف هذه الصورة.`
        : `صورة: ${f.fileName} — صورة عامة. لا تذكر أي لون في وصف هذه الصورة.`,
    });
    parts.push({ type: "image_url", image_url: { url: f.url } });
  }

  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [AI_AUTH_HEADER]: apiKey,
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: parts },
      ],
      response_format: { type: "json_object" as const },
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`vision ${res.status}: ${txt.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : {};
  }

  // Product-level fields (support new schema and legacy fallback so an old
  // response shape doesn't break anything mid-rollout).
  const description = String(
    parsed?.product_internal_description ?? parsed?.internal_description ?? "",
  ).trim();
  const features =
    (parsed?.product_visual_features && typeof parsed.product_visual_features === "object"
      ? (parsed.product_visual_features as Record<string, unknown>)
      : parsed?.visual_features && typeof parsed.visual_features === "object"
        ? (parsed.visual_features as Record<string, unknown>)
        : {}) as Record<string, unknown>;
  if (!description) throw new Error("vision returned empty description");

  // Per-image results. Match model output back to input images by
  // source_file_name (case-insensitive, basename-tolerant). Anything
  // unmatched is appended positionally so nothing is silently dropped.
  const rawImages: any[] = Array.isArray(parsed?.images) ? parsed.images : [];
  const byName = new Map<string, SignedImage>();
  for (const img of imgs) {
    byName.set(img.fileName.toLowerCase(), img);
    byName.set(basename(img.fileName).toLowerCase(), img);
  }
  const used = new Set<string>();
  const perImage: PerImageDescription[] = [];
  for (let i = 0; i < rawImages.length; i++) {
    const r = rawImages[i] ?? {};
    const name = String(r?.source_file_name ?? "").trim();
    const match =
      byName.get(name.toLowerCase()) ??
      byName.get(basename(name).toLowerCase()) ??
      imgs[i];
    if (match) used.add(match.path);
    perImage.push({
      image_id: match?.id ?? null,
      source_file_name: name || match?.fileName || `image_${i + 1}`,
      internal_description: String(r?.image_internal_description ?? "").trim(),
      visual_features:
        r?.image_visual_features && typeof r.image_visual_features === "object"
          ? (r.image_visual_features as Record<string, unknown>)
          : {},
    });
  }
  // Ensure every input image has an entry (even if the model omitted it).
  for (const img of imgs) {
    if (used.has(img.path)) continue;
    perImage.push({
      image_id: img.id,
      source_file_name: img.fileName,
      internal_description: "",
      visual_features: {},
    });
  }

  return {
    internal_description: description,
    visual_features: features,
    images: perImage,
  };
}

// ---------------------------------------------------------------------------
// Public: pure description for a set of uploaded image files.
//
// Used by the matching pipeline (phase 3): incoming products are described
// BEFORE any staging row exists, so the AI can compare the incoming visual
// description against the internal descriptions of existing products.
// Writes nothing to the database; the caller persists the result on the
// staging row it creates (together with the returned hash).
// ---------------------------------------------------------------------------

export interface DescribedImages {
  internal_description: string;
  visual_features: Record<string, unknown>;
  hash: string;
}

export async function describeImageFileIds(
  fileIds: string[],
): Promise<DescribedImages | null> {
  const admin = getSupabaseAdmin();
  const files = await resolveImageFiles(admin, fileIds ?? []);
  if (files.length === 0) return null;
  const hash = await hashImagePaths(files.map((f) => f.path));
  const signed = await signImages(admin, files, UPLOAD_BUCKET);
  if (signed.length === 0) return null;
  const out = await callVision(signed);
  return { ...out, hash };
}

/** Describe many incoming image sets with bounded concurrency (default 3). */
export async function describeManyImageSets(
  sets: Array<{ key: string; fileIds: string[] }>,
  concurrency = 3,
): Promise<Map<string, DescribedImages>> {
  const out = new Map<string, DescribedImages>();
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, sets.length)) },
    async () => {
      while (true) {
        const i = cursor++;
        if (i >= sets.length) return;
        const s = sets[i];
        try {
          const d = await describeImageFileIds(s.fileIds);
          if (d) out.set(s.key, d);
        } catch {
          // vision failure must never abort the matching pipeline.
        }
      }
    },
  );
  await Promise.all(workers);
  return out;
}

// ---------------------------------------------------------------------------
// Public: generate description for one staging row.
// ---------------------------------------------------------------------------

export async function generateStagingDescription(args: {
  userId: string;
  stagingId: string;
  imageFileIds: string[];
}): Promise<void> {
  const admin = getSupabaseAdmin();
  const files = await resolveImageFiles(admin, args.imageFileIds ?? []);
  if (files.length === 0) {
    await admin
      .from("staging_products")
      .update({
        internal_description_status: "failed",
        internal_description_updated_at: new Date().toISOString(),
      })
      .eq("id", args.stagingId)
      .eq("user_id", args.userId);
    return;
  }
  const hash = await hashImagePaths(files.map((f) => f.path));

  // Skip if already ready with same hash.
  const { data: existing } = await admin
    .from("staging_products")
    .select("internal_description_hash, internal_description_status")
    .eq("id", args.stagingId)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (
    existing?.internal_description_status === "ready" &&
    existing?.internal_description_hash === hash
  ) {
    return;
  }

  await admin
    .from("staging_products")
    .update({ internal_description_status: "generating" })
    .eq("id", args.stagingId)
    .eq("user_id", args.userId);

  try {
    const signed = await signImages(admin, files, UPLOAD_BUCKET);
    if (signed.length === 0) throw new Error("no signable image urls");
    const out = await callVision(signed);
    // Persist per-image descriptions in the temporary staging column
    // (added in db/2026-08-05_per_image_visual_description.sql).
    const imageDescs = out.images.map((img) => ({
      image_id: img.image_id,
      source_file_name: img.source_file_name,
      internal_description: img.internal_description,
      visual_features: img.visual_features,
    }));
    await admin
      .from("staging_products")
      .update({
        internal_description: out.internal_description,
        internal_description_hash: hash,
        internal_description_status: "ready",
        internal_description_updated_at: new Date().toISOString(),
        visual_features: out.visual_features,
        image_internal_descriptions: imageDescs,
      })
      .eq("id", args.stagingId)
      .eq("user_id", args.userId);
  } catch (e) {
    await admin
      .from("staging_products")
      .update({
        internal_description_status: "failed",
        internal_description_updated_at: new Date().toISOString(),
        visual_features: {
          error: (e as Error).message?.slice(0, 400) ?? "vision_failed",
        },
      })
      .eq("id", args.stagingId)
      .eq("user_id", args.userId);
  }
}

/**
 * Fire-and-forget batch trigger. Iterates rows sequentially so we don't
 * hammer the AI gateway; each row's failure is contained to its own row.
 * Callers should NOT await this on the request path — use `void`.
 */
export async function generateStagingDescriptionsForRows(
  userId: string,
  rows: Array<{ id: string; image_file_ids: string[] | null | undefined }>,
): Promise<void> {
  for (const r of rows) {
    const ids = Array.isArray(r.image_file_ids) ? r.image_file_ids : [];
    if (ids.length === 0) continue;
    try {
      await generateStagingDescription({
        userId,
        stagingId: r.id,
        imageFileIds: ids,
      });
    } catch {
      // never let one row break the loop.
    }
  }
}

// ---------------------------------------------------------------------------
// Public: refresh description for an approved product (called from a
// background sweep when internal_description_status='stale').
// ---------------------------------------------------------------------------

export async function regenerateProductDescription(args: {
  userId: string;
  productId: string;
}): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data: imgs } = await admin
    .from("product_images")
    .select("id, url, position, color_id")
    .eq("product_id", args.productId)
    .order("position", { ascending: true });
  const colorIds = Array.from(new Set(
    (imgs ?? []).map((r: any) => r?.color_id ? String(r.color_id) : "").filter(Boolean),
  ));
  const colorLabelById = new Map<string, string>();
  if (colorIds.length > 0) {
    const { data: colors } = await admin
      .from("product_colors")
      .select("id, label")
      .in("id", colorIds);
    for (const color of colors ?? []) {
      colorLabelById.set(String((color as any).id), String((color as any).label ?? "").trim());
    }
  }
  const all: ProductResolvedImage[] = ((imgs ?? []) as any[])
    .map((r: any): ProductResolvedImage | null => {
      const path = String(r?.url ?? "");
      if (!path) return null;
      return {
        id: r?.id != null ? String(r.id) : null,
        path,
        fileName: basename(path),
        colorId: r?.color_id != null ? String(r.color_id) : "",
        colorLabel: r?.color_id != null
          ? colorLabelById.get(String(r.color_id)) ?? null
          : null,
      };
    })
    .filter((v: ProductResolvedImage | null): v is ProductResolvedImage => v !== null);
  // Cap at the per-call limit, but keep at least one image per colour.
  const files: ResolvedImage[] = pickBalancedByGroup(
    all,
    (i: ProductResolvedImage) => i.colorId,
    MAX_IMAGES_PER_CALL,
  ).map(({ id, path, fileName, colorLabel }: ProductResolvedImage) => ({
    id,
    path,
    fileName,
    colorLabel,
  }));
  if (files.length === 0) {
    await admin
      .from("products")
      .update({ internal_description_status: "failed" })
      .eq("id", args.productId)
      .eq("user_id", args.userId);
    return;
  }
  const hash = await hashImagePaths(files.map((f) => f.path));
  await admin
    .from("products")
    .update({ internal_description_status: "generating" })
    .eq("id", args.productId)
    .eq("user_id", args.userId);
  try {
    const signed = await signImages(admin, files, UPLOAD_BUCKET);
    if (signed.length === 0) throw new Error("no signable image urls");
    const out = await callVision(signed);
    for (const image of out.images) {
      if (!image.image_id) continue;
      await admin
        .from("product_images")
        .update({
          internal_description: image.internal_description || null,
          visual_features: image.visual_features,
        })
        .eq("id", image.image_id)
        .eq("product_id", args.productId)
        .eq("user_id", args.userId);
    }
    await admin
      .from("products")
      .update({
        internal_description: out.internal_description,
        internal_description_hash: hash,
        internal_description_status: "ready",
        internal_description_updated_at: new Date().toISOString(),
        visual_features: out.visual_features,
      })
      .eq("id", args.productId)
      .eq("user_id", args.userId);
  } catch (e) {
    await admin
      .from("products")
      .update({
        internal_description_status: "failed",
        internal_description_updated_at: new Date().toISOString(),
        visual_features: {
          error: (e as Error).message?.slice(0, 400) ?? "vision_failed",
        },
      })
      .eq("id", args.productId)
      .eq("user_id", args.userId);
  }
}

/**
 * Background sweep: refresh every approved product whose description was
 * invalidated (status='stale') by an approval that replaced its images.
 *
 * Fire-and-forget from the approval path (`void regenerateStaleProducts(...)`);
 * bounded so one sweep can never run unboundedly long.
 */
export async function regenerateStaleProducts(
  userId: string,
  limit = 20,
): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("products")
    .select("id")
    .eq("user_id", userId)
    .in("internal_description_status", ["stale", "pending"])
    .limit(limit);
  for (const row of data ?? []) {
    try {
      await regenerateProductDescription({
        userId,
        productId: String((row as any).id),
      });
    } catch {
      // one product's failure must never abort the sweep.
    }
  }
}

/**
 * FRESHNESS GUARD — run BEFORE any analysis snapshot is taken.
 *
 * The matcher only ever sees `internal_description` / `visual_features`.
 * Those are produced once from a product's image set, so any later edit the
 * merchant makes (adding, removing, reordering or replacing images) leaves
 * the matcher reading a version of the product that no longer exists.
 *
 * This pass recomputes each product's current image-set hash and refreshes
 * every product whose stored description was computed from a different set
 * (plus anything already flagged stale/pending/missing). After it resolves,
 * the snapshot handed to the AI reflects the latest saved state of every
 * record. It changes no matching, conflict or merge logic — only the
 * recency of the data those steps read.
 */
export async function ensureFreshProductDescriptions(
  userId: string,
  limit = 60,
): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data: products } = await admin
    .from("products")
    .select("id, internal_description, internal_description_hash, internal_description_status")
    .eq("user_id", userId)
    .limit(500);
  const rows = products ?? [];
  if (rows.length === 0) return;

  const ids = rows.map((r: any) => String(r.id));
  const { data: imgs } = await admin
    .from("product_images")
    .select("product_id, url, position, color_id")
    .in("product_id", ids)
    .order("position", { ascending: true });

  // Group all images per product first, then apply the same colour-balanced
  // trimming used by regenerateProductDescription so the hashes line up.
  const rawByProduct = new Map<string, { url: string; colorId: string }[]>();
  for (const im of imgs ?? []) {
    const pid = String((im as any).product_id);
    const url = String((im as any).url ?? "");
    if (!url) continue;
    const list = rawByProduct.get(pid) ?? [];
    list.push({ url, colorId: (im as any).color_id != null ? String((im as any).color_id) : "" });
    rawByProduct.set(pid, list);
  }
  const byProduct = new Map<string, string[]>();
  for (const [pid, list] of rawByProduct) {
    byProduct.set(
      pid,
      pickBalancedByGroup(list, (i) => i.colorId, MAX_IMAGES_PER_CALL).map((i) => i.url),
    );
  }

  const staleIds: string[] = [];
  for (const r of rows as any[]) {
    const pid = String(r.id);
    const paths = byProduct.get(pid) ?? [];
    if (paths.length === 0) continue; // nothing to look at — leave as is
    const status = String(r.internal_description_status ?? "");
    if (status === "generating") continue; // already in flight
    const currentHash = await hashImagePaths(paths);
    const drifted = String(r.internal_description_hash ?? "") !== currentHash;
    const missing = !r.internal_description || status === "stale" || status === "pending";
    if (drifted || missing) staleIds.push(pid);
    if (staleIds.length >= limit) break;
  }

  for (const productId of staleIds) {
    try {
      await regenerateProductDescription({ userId, productId });
    } catch {
      // never let one product block the freshness pass
    }
  }
}

