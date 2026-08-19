/**
 * Server-only helpers for the cupai-uploads bucket.
 */
import { getSupabaseAdmin } from "@/integrations/supabase/client.server";

export const UPLOAD_BUCKET = "cupai-uploads";

export async function uploadOriginalFile(args: {
  userId: string;
  fileName: string;
  mimeType: string;
  bytes: ArrayBuffer;
}): Promise<{ path: string }> {
  const admin = getSupabaseAdmin();
  const safeName = args.fileName.replace(/[^\w.\-]+/g, "_");
  const path = `${args.userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
  const { error } = await admin.storage
    .from(UPLOAD_BUCKET)
    .upload(path, args.bytes, {
      contentType: args.mimeType,
      upsert: false,
    });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return { path };
}

export async function createSignedUrl(
  path: string,
  expiresIn = 60 * 30,
): Promise<string> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.storage
    .from(UPLOAD_BUCKET)
    .createSignedUrl(path, expiresIn);
  if (error || !data) throw new Error(`Signed URL failed: ${error?.message}`);
  return data.signedUrl;
}
