// Exposes the chat endpoint used by the browser. Database and AI credentials
// stay on the server.
import { createServerFn } from "@tanstack/react-start";

export interface ChatConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  chatAiUrl: string;
}

export const getChatConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<ChatConfig> => {
    const supabaseUrl = process.env.CUPAI_APP_SB_URL;
    const supabaseAnonKey = process.env.CUPAI_APP_SB_ANON;
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Chat config missing (CUPAI_APP_SB_URL / CUPAI_APP_SB_ANON).");
    }
    return {
      supabaseUrl,
      supabaseAnonKey,
      chatAiUrl: "/api/chat-ai",
    };
  },
);
