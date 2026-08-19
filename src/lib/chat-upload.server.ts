/**
 * Server-only helpers for chat attachments (customer <-> agent media).
 *
 * Files land in the private `chat-attachments` bucket under
 * `<merchant_user_id>/<conversation_id>/<uuid>.<ext>` and are served through
 * long-lived signed URLs. Uploads are unauthenticated (public storefront chat)
 * so they are strictly limited by MIME type and size.
 */
import { getSupabaseAdmin } from "@/integrations/supabase/client.server";

export const CHAT_BUCKET = "chat-attachments";
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8 MB
export const SIGNED_URL_TTL = 60 * 60 * 24 * 365; // 1 year

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
};

export interface ChatAttachment {
  kind: "image";
  url: string;
  storage_path: string;
  mime: string;
  name: string | null;
  size: number;
  source: "customer" | "agent";
  product_id: string | null;
}

/** Decode a `data:<mime>;base64,...` payload (or a bare base64 string). */
export function decodeDataUrl(raw: string): { mime: string | null; bytes: Uint8Array } {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(raw.trim());
  const mime = match ? match[1] : null;
  const b64 = (match ? match[2] : raw).replace(/\s+/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { mime, bytes };
}

export function assertAllowedImage(mime: string, size: number): string {
  const ext = ALLOWED_MIME[mime.toLowerCase()];
  if (!ext) throw new Error("نوع الملف غير مدعوم. الصور فقط (JPG, PNG, WEBP, GIF).");
  if (size <= 0) throw new Error("الملف فارغ.");
  if (size > MAX_ATTACHMENT_BYTES) throw new Error("حجم الصورة يتجاوز 8 ميجابايت.");
  return ext;
}

function safeSegment(value: string | null | undefined, fallback: string): string {
  const cleaned = (value ?? "").replace(/[^\w-]+/g, "");
  return cleaned || fallback;
}

export async function uploadChatImage(args: {
  merchantId: string;
  conversationId?: string | null;
  fileName?: string | null;
  dataUrl: string;
  source?: "customer" | "agent";
}): Promise<ChatAttachment> {
  const { mime, bytes } = decodeDataUrl(args.dataUrl);
  const mimeType = mime ?? "image/jpeg";
  const ext = assertAllowedImage(mimeType, bytes.byteLength);

  const admin = getSupabaseAdmin();
  const merchant = safeSegment(args.merchantId, "unknown");
  const convo = safeSegment(args.conversationId, "pending");
  const id = crypto.randomUUID();
  const path = `${merchant}/${convo}/${id}.${ext}`;

  const { error } = await admin.storage.from(CHAT_BUCKET).upload(path, bytes, {
    contentType: mimeType,
    upsert: false,
  });
  if (error) throw new Error(`تعذر رفع الصورة: ${error.message}`);

  const { data, error: signErr } = await admin.storage
    .from(CHAT_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);
  if (signErr || !data) throw new Error(`تعذر إنشاء رابط الصورة: ${signErr?.message ?? ""}`);

  return {
    kind: "image",
    url: data.signedUrl,
    storage_path: path,
    mime: mimeType,
    name: args.fileName ? args.fileName.slice(0, 120) : null,
    size: bytes.byteLength,
    source: args.source ?? "customer",
    product_id: null,
  };
}
