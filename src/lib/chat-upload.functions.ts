// Public (unauthenticated) upload endpoint for storefront chat attachments.
// Validation, storage credentials and signing stay on the server.
import { createServerFn } from "@tanstack/react-start";

import type { ChatAttachment } from "@/lib/chat-upload.server";

export interface UploadChatImageInput {
  merchantId: string;
  conversationId?: string | null;
  fileName?: string | null;
  dataUrl: string;
}

export const uploadChatImage = createServerFn({ method: "POST" })
  .inputValidator((input: UploadChatImageInput) => {
    if (!input || typeof input.merchantId !== "string" || !input.merchantId) {
      throw new Error("معرّف المتجر مفقود.");
    }
    if (typeof input.dataUrl !== "string" || !input.dataUrl.startsWith("data:image/")) {
      throw new Error("الصور فقط مسموح بها.");
    }
    return input;
  })
  .handler(async ({ data }): Promise<ChatAttachment> => {
    const { uploadChatImage: upload } = await import("@/lib/chat-upload.server");
    return upload({
      merchantId: data.merchantId,
      conversationId: data.conversationId ?? null,
      fileName: data.fileName ?? null,
      dataUrl: data.dataUrl,
      source: "customer",
    });
  });
