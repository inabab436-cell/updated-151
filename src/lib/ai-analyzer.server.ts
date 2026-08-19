/**
 * Server-only product-analysis layer.
 *
 * Sends a batch of uploaded files (images + PDFs + docs) to an OpenAI-compatible
 * chat completions endpoint and returns a normalized product catalog.
 *
 * All configuration lives in this file so the project remains portable:
 *   - AI_BASE_URL   : chat completions endpoint (OpenAI-compatible)
 *   - AI_API_KEY    : bearer key read from env
 *   - AI_AUTH_HEADER: header name used to pass the key
 *   - DEFAULT_MODEL : model id
 *   - SYSTEM_PROMPT : Arabic analyst prompt (the business logic of the analyzer)
 *
 * By default this points at the Lovable AI Gateway. To move off Lovable,
 * change AI_BASE_URL / AI_AUTH_HEADER / DEFAULT_MODEL and provide the matching
 * API key via env — no other code changes are required.
 */

const AI_BASE_URL =
  process.env.CUPAI_APP_AI_BASE_URL || "https://ai.gateway.lovable.dev/v1";
const AI_AUTH_HEADER =
  process.env.CUPAI_APP_AI_AUTH_HEADER || "Lovable-API-Key";
const AI_API_KEY_ENV =
  process.env.CUPAI_APP_AI_KEY_ENV || "LOVABLE_API_KEY";
const DEFAULT_MODEL =
  process.env.CUPAI_APP_AI_MODEL || "google/gemini-2.5-flash";

import {
  STAGING_ACTIONS,
  STAGING_ACTIONS_LIST,
  isValidStagingAction,
  type StagingAction,
} from "./staging-action";

export interface AnalysisFileInput {
  /** Immutable uploaded_files.id used to preserve provenance across mixed batches. */
  sourceRef?: string;
  fileName: string;
  mimeType: string;
  /** Public/signed URL that the model can fetch, OR a data: URL. */
  url: string;
}

export interface AnalyzedVariant {
  color?: string | null;
  size?: string | null;
  price?: number | null;
  image_url?: string | null;
}

/**
 * Every classifiable item carries an AI-authored `decision`.
 * The application NEVER matches, dedups, or detects conflicts itself —
 * it just executes what the AI returns.
 *
 *  action:
 *    - "new"    → create a brand new record.
 *    - "merge"  → merge this incoming item into `target_id`.
 *    - "skip"   → ignore this item entirely.
 *  target_id : id of the matched existing record (null when action="new").
 *  conflicts : field-level conflicts. Set `resolution` = "existing" |
 *              "incoming" | "custom" (with `resolved_value`) when the AI is
 *              confident; omit `resolution` to hand the choice to the user.
 *  reason    : short Arabic justification.
 */
export interface AnalyzedDecision {
  action: "new" | "merge" | "skip";
  target_id?: string | null;
  reason?: string | null;
  conflicts?: Array<{
    field: string;
    existing_value?: unknown;
    incoming_value?: unknown;
    resolution?: "existing" | "incoming" | "custom" | null;
    resolved_value?: unknown;
  }> | null;
}

export interface AnalyzedProduct {
  name: string;
  description?: string | null;
  category?: string | null;
  price?: number | null;
  currency?: string | null;
  colors?: string[];
  sizes?: string[];
  variants?: AnalyzedVariant[];
  images?: Array<string | { source_ref?: string | null; source_file_name?: string | null }>;
  extra?: Record<string, unknown> | null;
  source_file_names?: string[];
  source_file_refs?: string[];
  image_file_ids?: string[];
  internal_description?: string | null;
  visual_features?: Record<string, unknown> | null;
  vision_hash?: string | null;
  warnings?: string[];
  decision?: AnalyzedDecision | null;
}

export interface AnalyzedPolicy {
  kind: string;
  title: string;
  content: string;
  source_file_names?: string[];
  source_file_refs?: string[];
  decision?: AnalyzedDecision | null;
}

export interface AnalyzedShipping {
  country?: string | null;
  region?: string | null;
  price?: number | null;
  currency?: string | null;
  eta?: string | null;
  notes?: string | null;
  source_file_names?: string[];
  source_file_refs?: string[];
  decision?: AnalyzedDecision | null;
}

export interface AnalyzedContact {
  kind: string;
  label?: string | null;
  value: string;
  source_file_names?: string[];
  source_file_refs?: string[];
  decision?: AnalyzedDecision | null;
}

export interface AnalyzedAddress {
  value: string;
  label?: string | null;
  source_file_names?: string[];
  source_file_refs?: string[];
  decision?: AnalyzedDecision | null;
}

export interface AnalyzedExtractedText {
  title: string;
  content: string;
  suggested_kind?: string | null;
  source_file_names?: string[];
  source_file_refs?: string[];
  decision?: AnalyzedDecision | null;
}

export interface AnalyzedUnclassified {
  file_name?: string | null;
  reason?: string | null;
  excerpt?: string | null;
}

/** Snapshot of the merchant's existing catalog handed to the AI as context. */
export interface ExistingCatalogSnapshot {
  products?: Array<{
    id: string;
    name: string | null;
    category: string | null;
    price: number | null;
    currency: string | null;
    description?: string | null;
  }>;
  policies?: Array<{
    id: string;
    kind: string | null;
    title: string | null;
    content_excerpt?: string | null;
  }>;
  shipping?: Array<{
    id: string;
    country: string | null;
    region: string | null;
    price: number | null;
    currency: string | null;
  }>;
  contacts?: Array<{
    id: string;
    kind: string | null;
    value: string | null;
  }>;
}

export interface AnalysisResult {
  products: AnalyzedProduct[];
  policies: AnalyzedPolicy[];
  shipping: AnalyzedShipping[];
  contacts: AnalyzedContact[];
  addresses: AnalyzedAddress[];
  extracted_text_data: AnalyzedExtractedText[];
  unclassified: AnalyzedUnclassified[];
  categories: string[];
  global_warnings: string[];
  /**
   * Per-file audit trail: what the system did BEFORE the AI made any
   * decision. The AI receives the same info inline; this field lets
   * callers persist/display it. The system never drops a file — every
   * uploaded file appears here.
   */
  file_processing_audit?: AnalysisFileAudit[];
}

export interface AnalysisFileAudit {
  file_name: string;
  mime_type: string;
  extraction: "image" | "pdf" | "xlsx" | "docx" | "csv" | "text" | "json" | "html" | "best_effort" | "failed";
  sent_to_model: boolean;
  bytes?: number;
  chars_sent?: number;
  truncated?: boolean;
  note?: string;
  failure_reason?: string;
}

const SYSTEM_PROMPT = `أنت محلل بيانات شامل لبراند عربي. مهمتك في هذه المرحلة: الاستخراج والتصنيف فقط —
بدون أي قرار مطابقة أو دمج أو مقارنة مع أي سجل موجود. هذه مسؤولية مراحل لاحقة.

المدخلات: ملفات من كل الأنواع (صور، PDF، Excel، Word، نصوص).

مسؤولياتك:

1) صنّف كل جزء من كل ملف إلى واحدة من الفئات التالية بالضبط:
   A) products              — منتج معروض للبيع
   B) policies               — سياسة (شحن/استرجاع/شروط/خصوصية/ضمان)
   C) shipping                — جدول أسعار/مناطق شحن
   D) contacts                 — رقم/إيميل/حساب تواصل اجتماعي/رابط
   E) addresses                 — عنوان فعلي (فرع/مخزن/مكتب)
   F) extracted_text_data        — بيانات نصية واضحة ومفيدة لكن لا تنتمي لأي فئة
   من A-E (لا يوجد لها مكان مخصص في النظام حالياً)
   G) unclassified                — محتوى لا يخدم متجر التاجر ولا يضيف أي معرفة
   قابلة للاستخدام عن نشاطه التجاري — يُتجاهل تماماً،
   ولا يُستخرج منه أي بيانات من الفئات الأخرى.

1-ب) قرار "unclassified" قرار دلالي بحت (فهم المعنى والسياق والغرض من المحتوى).
   يُمنع منعاً باتاً اتخاذه — أو تجنّبه — بناءً على وجود أو غياب كلمات أو عبارات
   أو أنماط نصية محددة، أو على اسم الملف، أو على نوعه، أو على مجرد كونه صورة.
   الطريقة الإلزامية قبل الحكم على أي محتوى:
     (1) افهم ما هو هذا المحتوى فعلياً: ما الذي يمثّله؟ ما الغرض منه؟ لمن كُتب أو صُوِّر؟
     (2) اسأل نفسك السؤال الحاسم: هل يستطيع تاجر أن يستخدم هذا المحتوى في متجره —
         كمنتج يُعرض، أو سياسة، أو شحن، أو وسيلة تواصل، أو عنوان، أو معرفة نصية
         مفيدة عن نشاطه (مثل تعليمات عناية، جدول مقاسات، شرح خامة، أسئلة شائعة)؟
     (3) إن كان الجواب نعم ولو جزئياً → صنّفه في A-F ولا تضعه في G إطلاقاً.
     (4) إن كان الجواب لا بعد فهم كامل للمحتوى → G.
   أمثلة إرشادية للفهم فقط (وليست قائمة مطابقة ولا يجوز استخدامها ككلمات مفتاحية):
   سيرة ذاتية، صورة شخصية أو عائلية، لقطة شاشة لمحادثة خاصة لا علاقة لها بالبيع،
   ميم أو صورة ترفيهية، إعلان توظيف، فاتورة كهرباء، مستند حكومي شخصي،
   صورة عشوائية لمكان أو طعام لا يُباع في المتجر، ملف فارغ أو نص بلا معنى مفهوم.
   بالمقابل: صورة منتج بخلفية سيئة أو إضاءة رديئة أو بلا نص تبقى منتجاً (A) وليست G،
   وملف تنظيمي داخلي يحمل معرفة مفيدة عن النشاط يبقى (F) وليس G.
   الشك يُفسَّر لصالح عدم الإهمال: إذا ترددت بين G وأي فئة أخرى فاختر الفئة الأخرى.
   في حقل reason اشرح دلالياً لماذا لا يمكن استخدام المحتوى في المتجر — لا تكتفِ
   بوصف نوع الملف — وفي excerpt ضع مقتطفاً أو وصفاً موجزاً لما رأيته فعلاً.
   لكل عنصر في G قدّر مستوى ثقتك في القرار (high/medium/low)؛ إن لم تكن ثقتك high
   فلا تُهمله: صنّفه في F مع توضيح، لأن الإهمال الخاطئ خسارة بيانات لا يمكن تداركها.

2) لكل عنصر من A-F استخرج بياناته الخام فقط (بدون أي حكم مطابقة):

   - products:  name, description, category, price, currency, colors, sizes,
     variants[], images[] (كل صورة بكائن source_ref وsource_file_name), source_file_names, source_file_refs
   - policies:  kind, title, content, source_file_names, source_file_refs
   - shipping:  country, region, price, currency, eta, notes, source_file_names, source_file_refs
   - contacts:  kind, label, value, source_file_names, source_file_refs
   - addresses: value (نص العنوان كامل), label, source_file_names, source_file_refs
   - extracted_text_data: title, content, suggested_kind (تخمينك لطبيعة البيانات
     دي كنص حر), source_file_names, source_file_refs

3) لا تعتمد على تطابق نصي حرفي — استخدم فهمك الدلالي الكامل للمحتوى والصور والسياق.

4) OCR للصور، ونص المستندات، وأسماء الملفات — كلها مصادر بيانات صالحة.

5) اللغة: عربية. لا تخترع بيانات. الحقول المفقودة = null أو "".

6) لكل ملف source_ref ثابت ظاهر بجوار محتواه. لكل عنصر أضف source_file_refs بالقيم الدقيقة للملفات التي جاء منها فعلاً، وsource_file_names للأسماء المقابلة.
7) المصدر ملكية صارمة: لا تنسب صورة أو ملفاً لعنصر لم يُستخرج منه. لا تبدّل الصور بين المنتجات، ولا تنقل مصدر سياسة إلى منتج أو العكس. عند الشك اترك المصدر غير منسوب بدلاً من التخمين.
8) في products.images أعد فقط كائنات الصور التي تخص المنتج فعلاً بالشكل {source_ref, source_file_name}. لا تستخدم اسم الملف وحده كهوية.

المخرجات JSON فقط بالمخطط التالي حرفياً:
{
"categories": string[],
"global_warnings": string[],
"products": [{ "name": string, "description": string, "category": string,
"price": number|null, "currency": string|null, "colors": string[], "sizes": string[],
"variants": [{"color":string|null,"size":string|null,"price":number|null,"image_url":string|null}],
"images": [{"source_ref":string,"source_file_name":string}], "source_file_names": string[], "source_file_refs": string[], "warnings": string[] }],
"policies": [{ "kind": "shipping|return|terms|privacy|refund|warranty|other",
"title": string, "content": string, "source_file_names": string[], "source_file_refs": string[] }],
"shipping": [{ "country": string|null, "region": string|null, "price": number|null,
"currency": string|null, "eta": string|null, "notes": string|null,
"source_file_names": string[], "source_file_refs": string[] }],
"contacts": [{ "kind": "phone|email|whatsapp|instagram|facebook|tiktok|twitter|
snapchat|telegram|website|other", "label": string|null, "value": string,
"source_file_names": string[], "source_file_refs": string[] }],
"addresses": [{ "value": string, "label": string|null, "source_file_names": string[], "source_file_refs": string[] }],
"extracted_text_data": [{ "title": string, "content": string,
"suggested_kind": string, "source_file_names": string[], "source_file_refs": string[] }],
"unclassified": [{ "file_name": string|null, "reason": string|null, "excerpt": string|null }]
}`;


interface ContentPart {
  type: "text" | "image_url" | "file";
  text?: string;
  image_url?: { url: string };
  file?: { filename: string; file_data: string };
}

/**
 * Per-file text-extraction cap. Kept generous so the model sees the whole
 * document in almost every real case; huge files are truncated with a note
 * (the model is told what happened — the system never silently drops).
 */
const MAX_TEXT_CHARS_PER_FILE = 200_000;

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function isImageMime(mime: string, ext: string) {
  if (mime.startsWith("image/")) return true;
  return ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic", "heif"].includes(ext);
}

function isPdfMime(mime: string, ext: string) {
  return mime === "application/pdf" || ext === "pdf";
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.arrayBuffer();
}

async function extractXlsx(buf: ArrayBuffer): Promise<string> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
  const chunks: string[] = [];
  for (const name of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
    chunks.push(`# Sheet: ${name}\n${csv}`);
  }
  return chunks.join("\n\n");
}

async function extractDocx(buf: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return result.value ?? "";
}

function decodeText(buf: ArrayBuffer): string {
  // Try UTF-8 strict first, fall back to lossy decoding rather than dropping.
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface ExtractedFile {
  input: AnalysisFileInput;
  audit: AnalysisFileAudit;
  /** Present when the file was extracted to text. */
  text?: string;
  /** "image" | "pdf" pass-through, "text" for extracted text, "failed" otherwise. */
  kind: "image" | "pdf" | "text" | "failed";
}

async function processFile(f: AnalysisFileInput): Promise<ExtractedFile> {
  const ext = extOf(f.fileName);
  const mime = (f.mimeType || "").toLowerCase();

  if (isImageMime(mime, ext)) {
    return {
      input: f,
      kind: "image",
      audit: { file_name: f.fileName, mime_type: mime, extraction: "image", sent_to_model: true },
    };
  }
  if (isPdfMime(mime, ext)) {
    return {
      input: f,
      kind: "pdf",
      audit: { file_name: f.fileName, mime_type: mime, extraction: "pdf", sent_to_model: true },
    };
  }

  // Everything else: extract text (best effort — never silently drop).
  try {
    const buf = await fetchBytes(f.url);
    const bytes = buf.byteLength;
    let text = "";
    let extraction: AnalysisFileAudit["extraction"] = "best_effort";
    let note: string | undefined;

    if (
      mime.includes("spreadsheetml") ||
      mime.includes("excel") ||
      ext === "xlsx" ||
      ext === "xlsm" ||
      ext === "xls"
    ) {
      text = await extractXlsx(buf);
      extraction = "xlsx";
    } else if (
      mime.includes("wordprocessingml") ||
      mime.includes("msword") ||
      ext === "docx"
    ) {
      text = await extractDocx(buf);
      extraction = "docx";
    } else if (mime === "text/csv" || ext === "csv" || ext === "tsv") {
      text = decodeText(buf);
      extraction = "csv";
    } else if (mime === "application/json" || ext === "json") {
      text = decodeText(buf);
      extraction = "json";
    } else if (mime.includes("html") || ext === "html" || ext === "htm") {
      text = stripHtml(decodeText(buf));
      extraction = "html";
    } else if (mime.startsWith("text/") || ext === "txt" || ext === "md" || ext === "log") {
      text = decodeText(buf);
      extraction = "text";
    } else {
      // Unknown type — try text decode as a best-effort attempt. The AI decides
      // whether the content is useful. No whitelist, no silent drop.
      text = decodeText(buf);
      extraction = "best_effort";
      note = "نوع الملف غير معروف — تم استخراج نص بأفضل جهد وإرساله للنموذج للحكم على قيمته.";
    }

    const truncated = text.length > MAX_TEXT_CHARS_PER_FILE;
    const sent = truncated ? text.slice(0, MAX_TEXT_CHARS_PER_FILE) : text;

    return {
      input: f,
      kind: "text",
      text: sent,
      audit: {
        file_name: f.fileName,
        mime_type: mime,
        extraction,
        sent_to_model: true,
        bytes,
        chars_sent: sent.length,
        truncated,
        note,
      },
    };
  } catch (err) {
    // Extraction failed — do NOT drop. Send file metadata + failure reason to
    // the model so IT decides how to handle it, and record it in the audit.
    const reason = err instanceof Error ? err.message : String(err);
    return {
      input: f,
      kind: "failed",
      audit: {
        file_name: f.fileName,
        mime_type: mime,
        extraction: "failed",
        sent_to_model: true,
        failure_reason: reason,
      },
    };
  }
}

async function buildContent(
  files: AnalysisFileInput[],
  extraInstructions: string | null,
  existing: ExistingCatalogSnapshot | null,
): Promise<{ parts: ContentPart[]; audit: AnalysisFileAudit[] }> {
  const processed = await Promise.all(files.map((f) => processFile(f)));
  const audit = processed.map((p) => p.audit);

  const parts: ContentPart[] = [
    {
      type: "text",
      text:
        "حلل جميع الملفات المرفقة كدفعة واحدة وأخرج JSON فقط حسب المخطط المطلوب.\n" +
        `عدد الملفات: ${files.length}.\n` +
        (extraInstructions
          ? `تعليمات إضافية من صاحب المتجر:\n${extraInstructions}\n`
          : "") +
        "قائمة الملفات وحالة معالجتها (audit — لم يُحذف أي ملف بصمت، القرار عليك):\n" +
        processed
          .map((p, i) => {
            const a = p.audit;
            const base = `${i + 1}. source_ref=${p.input.sourceRef ?? `input-${i + 1}`} | file_name=${a.file_name} (mime=${a.mime_type || "unknown"}, extraction=${a.extraction}, sent=${a.sent_to_model})`;
            const extras = [
              a.bytes != null ? `bytes=${a.bytes}` : null,
              a.chars_sent != null ? `chars=${a.chars_sent}` : null,
              a.truncated ? "truncated=true" : null,
              a.failure_reason ? `failure=${a.failure_reason}` : null,
              a.note ? `note=${a.note}` : null,
            ].filter(Boolean);
            return extras.length ? `${base} — ${extras.join(", ")}` : base;
          })
          .join("\n") +
        "\n\nexisting_context (السجلات الموجودة حالياً — استخدم id منها في decision.target_id عند merge/update):\n" +
        JSON.stringify(existing ?? {}, null, 2).slice(0, 120_000),
    },
  ];

  for (const p of processed) {
    const f = p.input;
    if (p.kind === "image") {
      parts.push({ type: "text", text: `SOURCE_BOUNDARY source_ref=${f.sourceRef ?? "unknown"} file_name=${f.fileName}. الصورة التالية تخص هذا المصدر وحده.` });
      parts.push({ type: "image_url", image_url: { url: f.url } });
    } else if (p.kind === "pdf") {
      parts.push({ type: "text", text: `SOURCE_BOUNDARY source_ref=${f.sourceRef ?? "unknown"} file_name=${f.fileName}. الملف التالي يخص هذا المصدر وحده.` });
      parts.push({ type: "file", file: { filename: f.fileName, file_data: f.url } });
    } else if (p.kind === "text") {
      const header =
        `\n\n===== source_ref=${f.sourceRef ?? "unknown"} | محتوى الملف: ${f.fileName} =====\n` +
        `mime: ${p.audit.mime_type}\n` +
        `extraction: ${p.audit.extraction}${p.audit.truncated ? " (truncated)" : ""}\n` +
        (p.audit.note ? `note: ${p.audit.note}\n` : "") +
        `--- BEGIN CONTENT ---\n`;
      parts.push({ type: "text", text: `${header}${p.text ?? ""}\n--- END CONTENT ---` });
    } else {
      // failed — still surfaced to the model with metadata; AI decides.
      parts.push({
        type: "text",
        text:
          `\n\n===== source_ref=${f.sourceRef ?? "unknown"} | ملف تعذّر استخراج محتواه: ${f.fileName} =====\n` +
          `mime: ${p.audit.mime_type}\n` +
          `failure_reason: ${p.audit.failure_reason ?? "unknown"}\n` +
          `لم يُحذف؛ القرار لك بناءً على البيانات الوصفية المتاحة.`,
      });
    }
  }

  return { parts, audit };
}


function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
  }
  return trimmed;
}

function emptyResult(warning?: string): AnalysisResult {
  return {
    products: [], policies: [], shipping: [], contacts: [],
    addresses: [], extracted_text_data: [], unclassified: [],
    categories: [],
    global_warnings: warning ? [warning] : [],
  };
}

function safeParseAnalysis(raw: string): AnalysisResult {
  const cleaned = stripJsonFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return emptyResult("تعذّر تحليل مخرجات الذكاء الاصطناعي.");
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return emptyResult("تعذّر تحليل مخرجات الذكاء الاصطناعي.");
    }
  }

  const obj = (parsed ?? {}) as Record<string, unknown>;
  const arr = <T,>(k: string): T[] => (Array.isArray(obj[k]) ? (obj[k] as T[]) : []);
  const categories = arr<string>("categories").filter((x) => typeof x === "string");
  const global_warnings = arr<string>("global_warnings").filter((x) => typeof x === "string");
  return {
    products: arr<AnalyzedProduct>("products"),
    policies: arr<AnalyzedPolicy>("policies"),
    shipping: arr<AnalyzedShipping>("shipping"),
    contacts: arr<AnalyzedContact>("contacts"),
    addresses: arr<AnalyzedAddress>("addresses"),
    extracted_text_data: arr<AnalyzedExtractedText>("extracted_text_data"),
    unclassified: arr<AnalyzedUnclassified>("unclassified"),
    categories,
    global_warnings,
  };
}

export async function analyzeBatch(
  files: AnalysisFileInput[],
  opts: {
    model?: string | null;
    extraInstructions?: string | null;
    existing?: ExistingCatalogSnapshot | null;
  } = {},
): Promise<AnalysisResult> {
  const apiKey = process.env[AI_API_KEY_ENV];
  if (!apiKey) throw new Error(`Missing ${AI_API_KEY_ENV}`);
  if (files.length === 0) return emptyResult("لا توجد ملفات للتحليل.");


  const model = opts.model || DEFAULT_MODEL;
  const { parts, audit } = await buildContent(
    files,
    opts.extraInstructions ?? null,
    opts.existing ?? null,
  );
  const body = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: parts },
    ],
    response_format: { type: "json_object" as const },
    temperature: 0.2,
  };

  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [AI_AUTH_HEADER]: apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    if (res.status === 429) {
      throw new Error("تم تجاوز حد الاستخدام. حاول لاحقاً.");
    }
    if (res.status === 402) {
      throw new Error("رصيد الذكاء الاصطناعي غير كافٍ. يرجى إضافة رصيد.");
    }
    throw new Error(`AI ${res.status}: ${txt.slice(0, 500)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  const result = safeParseAnalysis(content);
  result.file_processing_audit = audit;
  return result;
}

// ---------------------------------------------------------------------------
// Guided retry — asks the AI to pick a valid action from the unified enum
// for items whose original `decision.action` was outside the enum.
//
// This is the ONLY mechanism used to correct an invalid action. The
// application never invents a default. See `staging-action.ts` for the
// architectural rule.
// ---------------------------------------------------------------------------

export interface InvalidActionItem {
  kind: "product" | "policy" | "shipping" | "contact";
  idx: number;
  rejected_action: unknown;
  /** Minimal snapshot the model needs to redecide (name/title/value/etc.). */
  snapshot: Record<string, unknown>;
}

export interface CorrectedAction {
  kind: "product" | "policy" | "shipping" | "contact";
  idx: number;
  action: StagingAction | null;
}

export async function retryActionDecisions(
  invalid: InvalidActionItem[],
  opts: { model?: string | null } = {},
): Promise<CorrectedAction[]> {
  if (invalid.length === 0) return [];
  const apiKey = process.env[AI_API_KEY_ENV];
  if (!apiKey) throw new Error(`Missing ${AI_API_KEY_ENV}`);

  const model = opts.model || DEFAULT_MODEL;
  const userMessage =
    `Invalid action value(s) were emitted for the items below.\n` +
    `You MUST choose exactly one value from this enum for each item: [${STAGING_ACTIONS_LIST}].\n` +
    `No other value is acceptable. Return JSON ONLY with this exact shape:\n` +
    `{ "fixes": [ { "kind": "product|policy|shipping|contact", "idx": <number>, "action": "<one of ${STAGING_ACTIONS_LIST}>" } ] }\n\n` +
    `Items:\n${JSON.stringify(invalid, null, 2).slice(0, 60_000)}`;

  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [AI_AUTH_HEADER]: apiKey,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are correcting your own previous output. Only respond with JSON matching the requested schema.",
        },
        { role: "user", content: userMessage },
      ],
      response_format: { type: "json_object" as const },
      temperature: 0,
    }),
  });
  if (!res.ok) {
    // Do NOT invent a default — surface an empty fix list so the caller
    // treats the items as still-invalid and can either retry again or
    // fall through to `needs_ai_review`.
    return [];
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = json.choices?.[0]?.message?.content ?? "";
  const cleaned = stripJsonFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  const fixes = (parsed as { fixes?: unknown })?.fixes;
  if (!Array.isArray(fixes)) return [];
  const out: CorrectedAction[] = [];
  for (const f of fixes) {
    if (!f || typeof f !== "object") continue;
    const kind = (f as any).kind;
    const idx = (f as any).idx;
    const action = (f as any).action;
    if (
      (kind === "product" ||
        kind === "policy" ||
        kind === "shipping" ||
        kind === "contact") &&
      typeof idx === "number"
    ) {
      out.push({
        kind,
        idx,
        action: isValidStagingAction(action) ? action : null,
      });
    }
  }
  return out;
}

// Re-export for callers so they don't need a separate import path.
export { STAGING_ACTIONS, isValidStagingAction };
export type { StagingAction };

// ===========================================================================
// Map → Reduce matching pipeline
// ---------------------------------------------------------------------------
// Rule (enforced): the AI is the sole decision-maker for matching, merging,
// and conflict detection. Every incoming item is compared against ALL existing
// records of its own data type. That full set is split into batches; EACH
// batch is presented to the AI with the strong decision fields intact
// (no truncation, no ".limit", no partial snapshot). The reducer picks the
// final decision when multiple batches propose matches — and the picker is
// itself the AI, never the code.
// ===========================================================================

export type MatchKind = "product" | "policy" | "shipping" | "contact" | "address" | "extracted_text_data";

/**
 * Identity verdict — STAGE 1 of matching. Answers only "is this the SAME
 * real-world item as the target?" and how sure the AI is. Handling of new
 * data / conflicts (STAGE 2) is expressed by `action` + `conflicts`.
 */
export interface IdentityVerdict {
  same_item: boolean | null;
  confidence: "high" | "medium" | "low" | null;
  evidence: string | null;
}

export interface PerItemBatchDecision {
  index: number; // index into the incoming array for this kind
  action: string | null; // raw — validated downstream via isValidStagingAction
  target_id?: string | null;
  reason?: string | null;
  conflicts?: unknown;
  identity?: IdentityVerdict | null;
}

function parseIdentity(raw: unknown): IdentityVerdict | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const same = r.same_item ?? r.same_product;
  const conf = String(r.confidence ?? "").toLowerCase();
  return {
    same_item: typeof same === "boolean" ? same : null,
    confidence:
      conf === "high" || conf === "medium" || conf === "low"
        ? (conf as "high" | "medium" | "low")
        : null,
    evidence: typeof r.evidence === "string" ? r.evidence : null,
  };
}


function kindFieldGuide(kind: MatchKind): string {
  switch (kind) {
    case "product":
      return [
        "Products — المطابقة بصرية بحتة. الحقول الوحيدة المتاحة للمقارنة هي:",
        "  • internal_description (الوصف البصري الداخلي العميق),",
        "  • visual_features (السمات البصرية المستخرجة من الصور).",
        "لا توجد أسماء منتجات ولا فئات ولا أسعار ولا أوصاف تسويقية في البيانات المعروضة، ولا يجوز افتراضها أو استنتاجها.",
        "",
        "قواعد إلزامية للمنتجات:",
        "  1. قارن internal_description و visual_features الواردة مع كل مرشح موجود قبل أي قرار.",
        "  2. المطابقة دلالية وليست حرفية: صياغة مختلفة لنفس الخامة/اللون/القصّة/النقشة/التفاصيل = نفس المنتج → merge بثقة high.",
        "     اختلاف زاوية التصوير أو الإضاءة أو الخلفية أو ترتيب الصور لا يعني منتجاً مختلفاً.",
        "  3. الاختلاف في تفصيل ثانوي واحد (مثل ظل لون أو صياغة) لا يلغي التطابق إن كانت بقية السمات البصرية الجوهرية متطابقة.",
        "  4. لا تعتبرهما منتجين مختلفين إلا عند اختلاف بصري جوهري (خامة أو شكل أو نقشة أو لون أساسي مختلف فعلاً) → action:\"new\".",
        "  5. تجاهل تماماً أي علامة تجارية أو شعار أو نص مكتوب على المنتج؛ لا تُستخدم كإشارة مطابقة ولا كإشارة اختلاف.",
        "  6. إذا كان أحد الطرفين بلا internal_description و بلا visual_features فلا دليل بصري → لا تدّعِ التطابق.",
        "  7. لا تكشف internal_description في أي إخراج؛ هو للمطابقة الداخلية فقط.",
      ].join("\n");

    case "policy":
      return [
        "Policies — strong match fields:",
        "  • kind, title, FULL content (never assume truncated — inspect the whole text).",
      ].join("\n");
    case "shipping":
      return [
        "Shipping — strong match fields:",
        "  • country, region, price + currency, eta, notes.",
      ].join("\n");
    case "contact":
      return [
        "Contacts — strong match fields (phones/emails/social handles/URLs only — NOT addresses):",
        "  • kind, value (the actual phone/email/handle/url), label.",
      ].join("\n");
    case "address":
      return [
        "Addresses — strong match fields (physical/postal addresses only):",
        "  • value (full address string: street, building, district, city, region, country, postal code),",
        "  • label (branch/office/warehouse name). Semantic equivalence wins over exact string match.",
      ].join("\n");
    case "extracted_text_data":
      return [
        "Extracted Text Data — نص حر مفيد لا ينتمي لأي فئة قائمة (منتج/سياسة/شحن/تواصل/عنوان).",
        "Strong match fields:",
        "  • title (العنوان القصير للمقطع النصي),",
        "  • content (النص الكامل — افحصه كاملاً ولا تفترض أنه مقصوص),",
        "  • suggested_category / suggested_kind (تلميح تصنيفي، إرشادي فقط).",
        "التطابق قائم على التكافؤ الدلالي للمحتوى؛ اختلاف الصياغة مع نفس المعنى = نفس السجل.",
      ].join("\n");
  }
}

const MAP_SYSTEM_PROMPT = `أنت وحدك من يقرر المطابقة والدمج وكشف التعارض. لا يوجد أي منطق في الكود يقوم بذلك.
ستُستدعى مرة واحدة لكل دُفعة من السجلات الموجودة من نفس نوع البيانات فقط (منتجات مع منتجات، سياسات مع سياسات، شحن مع شحن، تواصل مع تواصل).
الدفعة الحالية موثوقة وكاملة بالنسبة للسجلات المعروضة فيها؛ إن لم تجد تطابقاً هنا فأصدر action:"new" لهذه الدفعة بالتحديد.
لا تعتبر أن هناك سجلات مخفية خارج ما هو معروض؛ التطبيق يضمن أن جميع السجلات من نفس النوع سيتم عرضها عبر دفعات لاحقة، وسيتم جمع القرارات بواسطتك أيضاً في مرحلة الاختزال (reduce).

اعمل على مرحلتين منفصلتين لكل عنصر:
المرحلة 1 — تحديد الهوية فقط: هل هذا العنصر هو نفسه سجل موجود؟ استخدم كل الأدلة المتاحة (النص، الصور، الوصف البصري الداخلي الدقيق، الخصائص المشتركة). أعد النتيجة في الحقل identity: { same_item, confidence: "high"|"medium"|"low", evidence }.
المرحلة 2 — التعامل بعد تحديد الهوية: لا تبدأ فيها إلا بعد حسم الهوية.
  • إذا كانت الهوية نفسها بثقة high: العنصر الوارد هو بيانات جديدة لنفس السجل وليس سجلاً جديداً → action "merge" مع target_id.
    - صنّف البيانات الواردة إلى ثلاث فئات ولا تلغِ الدمج بسبب اختلاف جزئي:
      (أ) إضافات آمنة تُدمج مباشرة ولا تُسجَّل كتعارض إطلاقاً: صور جديدة، ألوان جديدة، مقاسات جديدة، تشكيلات جديدة،
          جداول مقاسات أو معلومات نصية إضافية قادمة من ملفات PDF أو نصية، وأي معلومة جديدة تُضاف دون حذف القديم.
      (ب) تعارضات تحتاج قرار التاجر: اختلاف في قيمة واحدة لا يمكن أن تتعايش مع القديمة (السعر، العملة، الخامة، الفئة، الاسم…)
          → سجّلها في conflicts مع existing_value و incoming_value، ولا تختر قيمة نيابة عن التاجر (resolution:null).
      (ج) بيانات لا يمكن تأكيدها: لون مذكور في نص فقط دون صورة تثبته بصرياً — لا تعتبره لوناً مؤكداً ولا تعتبره تعارضاً؛
          إن وُجدت صورة في نفس الدفعة تطابق وصف هذا اللون فاربطها به.
    - الاختلاف في حقل واحد لا يمنع دمج بقية البيانات الآمنة أبداً.
  • إذا كانت الهوية نفسها لكن الثقة medium أو low: لا تدمج تلقائياً → أبقِ identity كما هو مع target_id المرشّح، واترك القرار للمراجعة البشرية.
  • إذا لم تكن نفس الهوية: action "new" و identity.same_item=false.`;

function buildMapUserMessage(
  kind: MatchKind,
  incoming: unknown[],
  existingBatch: unknown[],
  extraInstructions: string | null,
): string {
  return [
    kindFieldGuide(kind),
    "",
    "المطلوب: لكل عنصر في incoming أعد قراراً واحداً بنفس الشكل التالي:",
    `{ "decisions": [ { "index": <رقم موضعه في incoming>, "identity": { "same_item": true|false, "confidence": "high"|"medium"|"low", "evidence": "…" }, "action": "new"|"merge"|"skip", "target_id": <id من existing إن merge وإلا null>, "reason": "…", "conflicts": [ { "field": "…", "existing_value": …, "incoming_value": …, "resolution": "existing"|"incoming"|"custom"|null, "resolved_value": … } ] } ] }`,

    "",
    extraInstructions ? `تعليمات إضافية: ${extraInstructions}` : "",
    "",
    "existing_batch (نفس نوع البيانات فقط — كامل وغير مبتور):",
    JSON.stringify(existingBatch, null, 2),
    "",
    "incoming (العناصر الجديدة الجاري تصنيفها):",
    JSON.stringify(incoming, null, 2),
  ].join("\n");
}

async function callChatJson(
  systemPrompt: string,
  userMessage: string,
  model: string,
): Promise<string> {
  const apiKey = process.env[AI_API_KEY_ENV];
  if (!apiKey) throw new Error(`Missing ${AI_API_KEY_ENV}`);
  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [AI_AUTH_HEADER]: apiKey,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      response_format: { type: "json_object" as const },
      temperature: 0,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    if (res.status === 429) throw new Error("تم تجاوز حد الاستخدام. حاول لاحقاً.");
    if (res.status === 402) throw new Error("رصيد الذكاء الاصطناعي غير كافٍ.");
    throw new Error(`AI ${res.status}: ${txt.slice(0, 500)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return json.choices?.[0]?.message?.content ?? "";
}

function parseDecisionsResponse(raw: string): PerItemBatchDecision[] {
  const cleaned = stripJsonFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return [];
    try { parsed = JSON.parse(m[0]); } catch { return []; }
  }
  const list = (parsed as { decisions?: unknown })?.decisions;
  if (!Array.isArray(list)) return [];
  const out: PerItemBatchDecision[] = [];
  for (const d of list) {
    if (!d || typeof d !== "object") continue;
    const idx = (d as any).index;
    if (typeof idx !== "number") continue;
    out.push({
      index: idx,
      action: (d as any).action ?? null,
      target_id: (d as any).target_id ?? null,
      reason: (d as any).reason ?? null,
      conflicts: (d as any).conflicts ?? null,
      identity: parseIdentity((d as any).identity),

    });
  }
  return out;
}

/**
 * MAP: run the AI over ONE batch of existing records of the same kind.
 * Returns per-incoming-item decisions scoped to this batch only.
 */
export async function analyzeAgainstExistingBatch(
  kind: MatchKind,
  incoming: unknown[],
  existingBatch: unknown[],
  opts: { model?: string | null; extraInstructions?: string | null } = {},
): Promise<PerItemBatchDecision[]> {
  if (incoming.length === 0) return [];
  const model = opts.model || DEFAULT_MODEL;
  const raw = await callChatJson(
    MAP_SYSTEM_PROMPT,
    buildMapUserMessage(kind, incoming, existingBatch, opts.extraInstructions ?? null),
    model,
  );
  return parseDecisionsResponse(raw);
}

const REDUCE_SYSTEM_PROMPT = `أنت وحدك من يحسم التعارض بين قرارات المطابقة السابقة. الكود لا يقوم بأي حسم من تلقاء نفسه.
ستُعرض عليك عنصر واحد وارد + جميع القرارات التي اقترحتها دفعات المطابقة السابقة (كل قرار مع لقطة السجل المستهدف كاملة).
احسم أولاً الهوية (هل العنصر الوارد هو نفس أحد السجلات المرشحة؟ وبأي درجة ثقة) ثم اختر بعدها طريقة التعامل.
اختر قراراً نهائياً واحداً فقط بنفس شكل قرار المطابقة (identity, action, target_id, conflicts, reason). لا تخترع سجلاً جديداً لم يظهر ضمن الخيارات.
إذا لم تكن الثقة عالية في أنها نفس الهوية فلا تدمج؛ أعد identity بثقة medium/low واترك الحسم للمراجعة البشرية.`;

function buildReduceUserMessage(
  kind: MatchKind,
  incomingItem: unknown,
  candidates: Array<{ decision: PerItemBatchDecision; existing: unknown }>,
): string {
  return [
    kindFieldGuide(kind),
    "",
    "incoming_item:",
    JSON.stringify(incomingItem, null, 2),
    "",
    "candidate_decisions (كل عنصر يحوي القرار المقترح + لقطة السجل الموجود المرتبط به):",
    JSON.stringify(candidates, null, 2),
    "",
    "المطلوب: JSON بهذا الشكل بالضبط:",
    `{ "final": { "identity": { "same_item": true|false, "confidence": "high"|"medium"|"low", "evidence": "…" }, "action": "new"|"merge"|"skip", "target_id": <id>|null, "reason": "…", "conflicts": [ … ] } }`,
  ].join("\n");
}

/**
 * REDUCE: when multiple batches propose non-`new` decisions for the same
 * incoming item, hand the choice back to the AI. When only one non-`new`
 * decision exists the caller can use it directly; when all decisions are
 * `new` the caller finalises as `new` without another AI round-trip.
 */
export async function reduceDecisions(
  kind: MatchKind,
  incomingItem: unknown,
  candidates: Array<{ decision: PerItemBatchDecision; existing: unknown }>,
  opts: { model?: string | null } = {},
): Promise<{
  action: string | null;
  target_id: string | null;
  reason: string | null;
  conflicts: unknown;
  identity: IdentityVerdict | null;
}> {
  if (candidates.length === 0) {
    return { action: "new", target_id: null, reason: null, conflicts: null, identity: null };
  }
  const model = opts.model || DEFAULT_MODEL;
  const raw = await callChatJson(
    REDUCE_SYSTEM_PROMPT,
    buildReduceUserMessage(kind, incomingItem, candidates),
    model,
  );
  const cleaned = stripJsonFences(raw);
  let parsed: unknown;
  try { parsed = JSON.parse(cleaned); } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return { action: null, target_id: null, reason: null, conflicts: null, identity: null };
    try { parsed = JSON.parse(m[0]); } catch {
      return { action: null, target_id: null, reason: null, conflicts: null, identity: null };
    }
  }
  const f = (parsed as { final?: unknown })?.final as any;
  if (!f || typeof f !== "object") {
    return { action: null, target_id: null, reason: null, conflicts: null, identity: null };
  }
  return {
    action: f.action ?? null,
    target_id: f.target_id ?? null,
    reason: f.reason ?? null,
    conflicts: f.conflicts ?? null,
    identity: parseIdentity(f.identity),
  };
}

// ===========================================================================
// POST-IDENTITY CONFLICT DETECTION
// ---------------------------------------------------------------------------
// Runs AFTER identity/matching is settled and ONLY for items that matched
// something. Identity for products is decided visually (names, prices and
// other textual fields are hidden from the matcher), so conflicts must be
// detected in a separate pass that DOES see the full data of both sides.
//
// Two conflict origins are produced in the SAME pass:
//   • "existing" → incoming value vs the stored record it matched.
//   • "batch"    → incoming value vs another item of THIS upload that was
//                  matched to the same record.
// The AI is still the sole decision-maker; it never picks a value.
// ===========================================================================

export interface DetectedConflict {
  field: string;
  existing_value: unknown;
  incoming_value: unknown;
  origin: "existing" | "batch";
  resolution: null;
  resolved_value: null;
}

const CONFLICT_SYSTEM_PROMPT = `أنت وحدك من يكشف التعارضات بعد أن تكون الهوية قد حُسمت مسبقاً. الكود لا يكتشف أي تعارض بنفسه.
الهوية محسومة: العنصر الوارد هو نفسه السجل الموجود المعروض عليك، ولا يجوز لك إعادة النظر فيها أو اقتراح أنهما مختلفان.
مهمتك الوحيدة: مقارنة بيانات العنصر الوارد مع (1) السجل الموجود، و(2) العناصر الأخرى من نفس الدفعة المرتبطة بنفس السجل — في نفس الوقت.

قواعد إلزامية:
1) إضافات آمنة لا تُسجَّل كتعارض إطلاقاً: صور جديدة، ألوان جديدة، مقاسات جديدة، تشكيلات جديدة، جداول مقاسات، نصوص إضافية، وأي معلومة تُضاف دون حذف القديم.
2) تعارض حقيقي = قيمة واحدة لا يمكن أن تتعايش مع القيمة الأخرى (السعر، العملة، الخامة، الفئة، الاسم، المخزون…) واختلفت فعلاً.
3) قيمة واردة فارغة أو غير موجودة أو صفر بلا معنى ليست تعارضاً — تُترك القيمة القديمة بصمت.
4) لا تختر قيمة نيابة عن التاجر إطلاقاً: أعد resolution = null دائماً.
5) origin = "existing" عند المقارنة مع السجل المخزَّن، و "batch" عند المقارنة مع عنصر آخر من نفس الدفعة.
6) لا تخترع حقولاً غير موجودة في البيانات المعروضة.`;

/**
 * Detect field-level conflicts for ONE already-matched incoming item,
 * against the stored record and against sibling items of the same upload
 * batch that matched the same record — in a single pass.
 */
export async function detectConflicts(
  kind: MatchKind,
  incomingItem: unknown,
  existingRecord: unknown | null,
  batchSiblings: unknown[],
  opts: { model?: string | null } = {},
): Promise<DetectedConflict[]> {
  if (!existingRecord && batchSiblings.length === 0) return [];
  const model = opts.model || DEFAULT_MODEL;
  const raw = await callChatJson(
    CONFLICT_SYSTEM_PROMPT,
    [
      `نوع البيانات: ${kind}`,
      "",
      "incoming_item (العنصر الوارد بكل بياناته):",
      JSON.stringify(incomingItem, null, 2),
      "",
      "existing_record (السجل المخزَّن الذي طابقه — قد يكون null):",
      JSON.stringify(existingRecord ?? null, null, 2),
      "",
      "batch_siblings (عناصر أخرى من نفس الدفعة طابقت نفس السجل):",
      JSON.stringify(batchSiblings, null, 2),
      "",
      "المطلوب: JSON بهذا الشكل بالضبط:",
      `{ "conflicts": [ { "field": "…", "existing_value": …, "incoming_value": …, "origin": "existing"|"batch" } ] }`,
    ].join("\n"),
    model,
  );
  const cleaned = stripJsonFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return [];
    try { parsed = JSON.parse(m[0]); } catch { return []; }
  }
  const list = (parsed as { conflicts?: unknown })?.conflicts;
  if (!Array.isArray(list)) return [];
  const out: DetectedConflict[] = [];
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const field = (c as any).field;
    if (typeof field !== "string" || !field.trim()) continue;
    out.push({
      field: field.trim(),
      existing_value: (c as any).existing_value ?? null,
      incoming_value: (c as any).incoming_value ?? null,
      origin: (c as any).origin === "batch" ? "batch" : "existing",
      resolution: null,
      resolved_value: null,
    });
  }
  return out;
}



// ===========================================================================
// Internal Batch Consolidation
// ---------------------------------------------------------------------------
// Runs AFTER extraction and BEFORE any comparison against the merchant's
// existing database records. Operates on items of a single data type at a
// time and consolidates duplicates *within* the same upload batch only.
// The AI is the sole decision-maker — the code never merges items itself.
// ===========================================================================

export interface ConsolidationConflict {
  field: string;
  values: Array<{ value: unknown; from_index: number }>;
}

export interface ConsolidatedItem {
  merged_from_indices: number[];
  item: Record<string, unknown>;
  conflicts: ConsolidationConflict[];
  /** Identity stage: how sure the AI is that the merged sources are one item. */
  confidence: "high" | "medium" | "low" | null;
  identity_evidence: string | null;
}

const CONSOLIDATE_SYSTEM_PROMPT = `You are responsible for consolidating duplicate items within the same upload batch only. No comparison has yet been made against the merchant's existing database records. That is the responsibility of a separate later stage.

Input: a list of items of the same data type, all coming from the same current upload operation.

Requirements:
1) Compare each item only with the other items in the same list.
1a) When data_type=product, identity is visual-only: use internal_description and visual_features exclusively. Never use names, categories, prices, descriptions, file names, brands, logos, or other textual fields to decide product identity.
2) Work in two separate stages. STAGE 1 — identity only: decide whether two or more items describe the SAME real-world item, using every available signal (text, images, the deep internal visual description, and shared attributes). The same item is very often split across several files of this same upload: one file with the images, a PDF with the sizes, a text file with the description or the colors, another file with extra data. Several files/sources for one item are NOT separate duplicates — they are one item. Report "confidence" ("high"|"medium"|"low") and "identity_evidence" for every consolidated entry. STAGE 2 — only after identity is settled: merge the data and record differences. If your confidence is not "high", do NOT merge: emit the items separately (one entry each) with their own confidence so they go to human review.
3) If you find two (or more) items that actually represent the same thing (the same product with different images/colors, the same duplicated policy, the same tracking number, etc.), consolidate them into a single item. Classify the data exactly as the later existing-records stage does: (a) ADDITIONS that always merge and are never conflicts — new images, new colors, new sizes, new variants, size charts and any extra text coming from PDF/text files, and any information that can be added without deleting older data; (b) CONFLICTS — a single value that cannot coexist with the other (price, currency, material, category, name): record it in \`conflicts\` and never choose a value yourself; (c) DATA THAT CANNOT BE CONFIRMED — a color mentioned only in text with no image proving it: do not treat it as a confirmed color and do not treat it as a conflict; if an image in this same batch matches that color's visual description, link it to that color. A difference in one field must never cancel the merge of the safe data.
4) Items that do not match any other item must remain unchanged.
5) Do not invent any new data that does not already exist in the input items.
6) Provenance is immutable. Preserve source_file_refs, source_file_names, image_file_ids and images on their original items. When—and only when—items are confidently consolidated, output the exact union of those source arrays. Never move, substitute, infer, or rename a source/image.

JSON output only:
{
  "consolidated": [
    {
      "merged_from_indices": [<indices of the original items that were consolidated>],
      "confidence": "high" | "medium" | "low",
      "identity_evidence": string,
      "item": { ... same shape as the original item for this data type ... },
      "conflicts": [
        {
          "field": string,
          "values": [
            {
              "value": any,
              "from_index": number
            }
          ]
        }
      ]
    }
  ]
}`;

function buildConsolidateUserMessage(
  kind: MatchKind,
  incoming: unknown[],
): string {
  return [
    kindFieldGuide(kind),
    "",
    `data_type: ${kind}`,
    "items (نفس النوع فقط — الفهرس هنا هو from_index):",
    JSON.stringify(incoming, null, 2),
  ].join("\n");
}

function parseConsolidationResponse(raw: string): ConsolidatedItem[] {
  const cleaned = stripJsonFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return [];
    try { parsed = JSON.parse(m[0]); } catch { return []; }
  }
  const list = (parsed as { consolidated?: unknown })?.consolidated;
  if (!Array.isArray(list)) return [];
  const out: ConsolidatedItem[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const merged = Array.isArray(e.merged_from_indices)
      ? (e.merged_from_indices as unknown[]).filter(
          (n): n is number => typeof n === "number",
        )
      : [];
    const item =
      e.item && typeof e.item === "object"
        ? (e.item as Record<string, unknown>)
        : {};
    const rawConflicts = Array.isArray(e.conflicts) ? e.conflicts : [];
    const conflicts: ConsolidationConflict[] = [];
    for (const c of rawConflicts) {
      if (!c || typeof c !== "object") continue;
      const cc = c as Record<string, unknown>;
      if (typeof cc.field !== "string") continue;
      const vals = Array.isArray(cc.values) ? cc.values : [];
      const values: ConsolidationConflict["values"] = [];
      for (const v of vals) {
        if (!v || typeof v !== "object") continue;
        const vv = v as Record<string, unknown>;
        if (typeof vv.from_index !== "number") continue;
        values.push({ value: vv.value, from_index: vv.from_index });
      }
      conflicts.push({ field: cc.field, values });
    }
    const rawConf = String((e as Record<string, unknown>).confidence ?? "").toLowerCase();
    out.push({
      merged_from_indices: merged,
      item,
      conflicts,
      confidence:
        rawConf === "high" || rawConf === "medium" || rawConf === "low"
          ? (rawConf as "high" | "medium" | "low")
          : null,
      identity_evidence:
        typeof (e as Record<string, unknown>).identity_evidence === "string"
          ? ((e as Record<string, unknown>).identity_evidence as string)
          : null,
    });
  }
  return out;
}

/**
 * Consolidate duplicate items *within* the same upload batch, before any
 * comparison against the merchant's existing catalog. Same-type only.
 */
export async function consolidateIncomingBatch(
  kind: MatchKind,
  incoming: unknown[],
  opts: { model?: string | null } = {},
): Promise<ConsolidatedItem[]> {
  if (incoming.length === 0) return [];
  const model = opts.model || DEFAULT_MODEL;
  const raw = await callChatJson(
    CONSOLIDATE_SYSTEM_PROMPT,
    buildConsolidateUserMessage(kind, incoming),
    model,
  );
  return parseConsolidationResponse(raw);
}

