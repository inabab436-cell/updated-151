import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Send, ArrowRight, User2, Bot, UserCircle2, Paperclip, X, Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getStorefront } from "@/lib/storefront.functions";
import { getChatConfig } from "@/lib/chat-config.functions";
import { uploadChatImage } from "@/lib/chat-upload.functions";
import {
  CustomerLoginPanel,
  useCustomerSession,
} from "@/components/customer/customer-login";


export const Route = createFileRoute("/chat/$slug")({
  validateSearch: (s: Record<string, unknown>) => ({
    mode: (s.mode === "new" ? "new" : "continue") as "new" | "continue",
  }),
  head: ({ params }) => ({
    meta: [
      { title: `محادثة — ${params.slug}` },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ChatPage,
});

type ChatAttachment = {
  kind?: string;
  url: string;
  mime?: string | null;
  name?: string | null;
  source?: string | null;
};

type ChatMessage = {
  id?: string;
  role: "user" | "assistant" | string;
  content: string;
  created_at?: string;
  attachments?: ChatAttachment[] | null;
};

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("تعذر قراءة الملف."));
    reader.readAsDataURL(file);
  });
}


const VISITOR_KEY = (slug: string) => `cupai_visitor_${slug}`;

function readVisitorId(slug: string): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(VISITOR_KEY(slug)); } catch { return null; }
}
function writeVisitorId(slug: string, id: string) {
  try { window.localStorage.setItem(VISITOR_KEY(slug), id); } catch {}
}

/** Fetch a persistent visitor id from the server (httpOnly cookie backed). */
async function fetchServerVisitorId(slug: string): Promise<string | null> {
  try {
    const local = readVisitorId(slug);
    const url = local ? `/api/visitor?fallback=${encodeURIComponent(local)}` : "/api/visitor";
    const res = await fetch(url, {
      method: "GET",
      credentials: "same-origin",
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { visitor_id?: string };
    return j.visitor_id ?? null;
  } catch {
    return null;
  }
}

function useResolvedVisitorId(slug: string) {
  const [visitorId, setVisitorId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const localVid = readVisitorId(slug);
      let vid = await fetchServerVisitorId(slug);
      if (!vid) vid = localVid;
      if (cancelled) return;
      if (vid) writeVisitorId(slug, vid);
      setVisitorId(vid);
    })();
    return () => { cancelled = true; };
  }, [slug]);

  return visitorId;
}

function ChatPage() {
  const { slug } = Route.useParams();
  const search = Route.useSearch() as { mode?: "new" | "continue" };
  const mode: "new" | "continue" = search.mode === "new" ? "new" : "continue";

  const storefront = useQuery({
    queryKey: ["storefront", slug],
    queryFn: () => getStorefront({ data: { slug } }),
  });
  const config = useQuery({
    queryKey: ["chat-config"],
    queryFn: () => getChatConfig(),
    staleTime: Infinity,
  });

  const merchantId = storefront.data?.merchantId ?? null;
  const brandName = storefront.data?.brandName || slug;

  const visitorId = useResolvedVisitorId(slug);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Tracked internally only — never surfaced to the customer in any way.
  const [, setNeedsHuman] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingFile, setPendingFile] = useState<{ file: File; preview: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [initErr, setInitErr] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const chatAiUrl = config.data?.chatAiUrl ?? null;
  const anonKey = config.data?.supabaseAnonKey ?? null;

  const session = useCustomerSession();
  const loggedIn = !!session.data?.loggedIn;
  const customerEmail = session.data?.email ?? null;

  const callEdge = useMemo(() => {
    if (!chatAiUrl || !anonKey) return null;
    return async (body: Record<string, unknown>) => {
      const res = await fetch(chatAiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": anonKey,
          "Authorization": `Bearer ${anonKey}`,
        },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
      return json as {
        conversation_id: string | null;
        needs_human?: boolean;
        messages?: ChatMessage[];
        reply?: string | null;
      };
    };
  }, [chatAiUrl, anonKey]);

  // Initialize conversation. `mode=new` opens a NEW conversation for the
  // SAME visitor — it never rotates the visitor id.
  useEffect(() => {
    if (!callEdge || !merchantId || !loggedIn) return;
    let cancelled = false;
    (async () => {
      try {
        // 1) Resolve a stable visitor id. Prefer the server-issued httpOnly
        //    cookie; fall back to localStorage; server will also stamp a
        //    cookie on the /api/chat-ai response so future calls keep it.
        const vid = visitorId;
        if (cancelled) return;

        const action = mode === "new" ? "start" : "fetch";
        const r = await callEdge({
          action,
          merchant_id: merchantId,
          visitor_id: vid ?? undefined,
        });
        if (cancelled) return;
        setConversationId(r.conversation_id);
        setMessages(r.messages ?? []);
        setNeedsHuman(!!r.needs_human);
      } catch (e: any) {
        if (!cancelled) setInitErr(e?.message || "تعذر بدء المحادثة.");
      }
    })();
    return () => { cancelled = true; };
  }, [callEdge, merchantId, mode, slug, loggedIn, visitorId]);

  // Poll every 4s for new messages (agent replies / handoff updates).
  useEffect(() => {
    if (!callEdge || !conversationId || !loggedIn) return;
    const t = setInterval(async () => {
      try {
        const r = await callEdge({ action: "fetch", conversation_id: conversationId });
        setMessages(r.messages ?? []);
        setNeedsHuman(!!r.needs_human);
      } catch { /* ignore transient errors */ }
    }, 4000);
    return () => clearInterval(t);
  }, [callEdge, conversationId, loggedIn]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  function pickFile(file: File | null | undefined) {
    setUploadErr(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setUploadErr("الصور فقط مسموح بها.");
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setUploadErr("حجم الصورة يتجاوز 8 ميجابايت.");
      return;
    }
    setPendingFile({ file, preview: URL.createObjectURL(file) });
  }

  function clearPendingFile() {
    setPendingFile((prev) => {
      if (prev) URL.revokeObjectURL(prev.preview);
      return null;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function send() {
    if (!callEdge || !visitorId || !merchantId) return;
    const text = input.trim();
    const attaching = pendingFile;
    if (!text && !attaching) return;

    setUploadErr(null);
    setInput("");
    setSending(true);

    let attachments: ChatAttachment[] | undefined;
    if (attaching) {
      setUploading(true);
      try {
        const dataUrl = await readFileAsDataUrl(attaching.file);
        const uploaded = await uploadChatImage({
          data: {
            merchantId,
            conversationId: conversationId ?? null,
            fileName: attaching.file.name,
            dataUrl,
          },
        });
        attachments = [uploaded];
      } catch (e: any) {
        setUploadErr(e?.message || "تعذر رفع الصورة.");
        setInput(text);
        setSending(false);
        setUploading(false);
        return;
      } finally {
        setUploading(false);
      }
      clearPendingFile();
    }

    // Optimistic user bubble
    setMessages((m) => [...m, {
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
      attachments: attachments ?? null,
    }]);
    try {
      const r = await callEdge({
        action: "send",
        conversation_id: conversationId ?? undefined,
        merchant_id: merchantId,
        visitor_id: visitorId,
        message: text,
        attachments,
      });
      if (r.conversation_id && r.conversation_id !== conversationId) {
        setConversationId(r.conversation_id);
      }
      if (r.messages) setMessages(r.messages);
      setNeedsHuman(!!r.needs_human);
    } catch {
      // Network/agent errors are silent to the customer — no error bubble.
    } finally {
      setSending(false);
    }
  }


  const disabled = sending || !callEdge || !merchantId || !loggedIn;
  const notFound = storefront.data && !storefront.data.found;

  return (
    <div dir="rtl" className="min-h-screen bg-gradient-surface flex flex-col">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            {storefront.data?.logoUrl ? (
              <img src={storefront.data.logoUrl} alt={brandName} className="h-9 w-9 rounded-full object-cover" />
            ) : (
              <div className="grid h-9 w-9 place-items-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
                {String(brandName).slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="truncate">
              <div className="text-sm font-semibold truncate">{brandName}</div>
              <div className="text-[11px] text-muted-foreground">محادثة مباشرة</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {loggedIn && (
              <Button asChild variant="ghost" size="sm" title={customerEmail ?? ""}>
                <Link to="/c/$slug/account" params={{ slug }}>
                  <UserCircle2 className="ml-1 h-4 w-4" />
                  حسابي
                </Link>
              </Button>
            )}
            <Button asChild variant="ghost" size="sm">
              <Link to="/c/$slug" params={{ slug }}>
                <ArrowRight className="ml-1 h-4 w-4" />
                العودة للمتجر
              </Link>
            </Button>
          </div>
        </div>
        {/* No handoff/escalation banner is ever shown to the customer:
            the experience must stay a single, seamless conversation. */}
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-4">
        {notFound && (
          <div className="rounded-xl border bg-background/80 p-6 text-center text-sm text-muted-foreground">
            المتجر غير موجود.
          </div>
        )}

        {!notFound && merchantId && !loggedIn && !session.isLoading && (
          <div className="mx-auto w-full max-w-md py-6">
            <CustomerLoginPanel
              merchantId={merchantId}
              visitorId={visitorId}
              brandName={brandName}
              onSuccess={() => session.refetch()}
            />
            <p className="mt-3 text-center text-xs text-muted-foreground">
              يجب تسجيل الدخول لعرض المحادثات والوصول إلى الطلبات.
            </p>
          </div>
        )}

        {initErr && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {initErr}
          </div>
        )}

        {loggedIn && (
        <div className="flex-1 space-y-3 overflow-y-auto py-2">
          {messages.length === 0 && !initErr && (
            <div className="grid place-items-center py-12 text-center text-sm text-muted-foreground">
              ابدأ المحادثة بكتابة رسالتك في الأسفل.
            </div>
          )}
          {messages.map((m, i) => (
            <MessageBubble
              key={m.id ?? i}
              role={m.role}
              content={m.content}
              attachments={m.attachments}
            />
          ))}
          <div ref={bottomRef} />
        </div>
        )}

        {loggedIn && (
        <div className="sticky bottom-0 mt-2 border-t bg-background/80 py-3 backdrop-blur">
          {pendingFile && (
            <div className="mb-2 flex items-center gap-2 rounded-xl border border-border/60 bg-background/70 p-2">
              <img
                src={pendingFile.preview}
                alt="معاينة الصورة المرفقة"
                className="h-14 w-14 rounded-lg object-cover"
              />
              <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {pendingFile.file.name}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={clearPendingFile}
                disabled={uploading}
                aria-label="إزالة الصورة"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
          {uploadErr && (
            <div className="mb-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {uploadErr}
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-[52px] w-[52px] shrink-0"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || uploading}
              aria-label="إرفاق صورة"
              title="إرفاق صورة"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
            </Button>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="اكتب رسالتك..."
              rows={2}
              className="min-h-[52px] resize-none"
              disabled={disabled}
            />
            <Button
              onClick={send}
              disabled={disabled || uploading || (!input.trim() && !pendingFile)}
              className="gap-1"
            >
              <Send className="h-4 w-4" />
              إرسال
            </Button>
          </div>
        </div>
        )}

      </main>
    </div>
  );
}

const BUBBLE_THEME = {
  userBubble: "bg-primary text-primary-foreground rounded-tr-sm",
  userAvatar: "bg-primary text-primary-foreground",
  assistantBubble:
    "bg-background border border-border/60 text-foreground rounded-tl-sm",
  assistantAvatar: "bg-muted text-foreground",
};

function MessageBubble({
  role, content, attachments,
}: {
  role: string;
  content: string;
  attachments?: ChatAttachment[] | null;
}) {
  const isUser = role === "user";
  const theme = BUBBLE_THEME;
  const media = (attachments ?? []).filter((a) => a && typeof a.url === "string");
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`flex max-w-[85%] items-start gap-2 ${isUser ? "flex-row-reverse" : ""}`}>
        <div className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs ${
          isUser ? theme.userAvatar : theme.assistantAvatar
        }`}>
          {isUser ? <User2 className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
        </div>
        <div className={`space-y-2 rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed shadow-sm ${
          isUser ? theme.userBubble : theme.assistantBubble
        }`}>
          {media.length > 0 && (
            <div className={`grid gap-2 ${media.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
              {media.map((a, i) => (
                <a key={a.url + i} href={a.url} target="_blank" rel="noreferrer">
                  <img
                    src={a.url}
                    alt={a.name || "صورة مرفقة"}
                    loading="lazy"
                    className="max-h-56 w-full rounded-xl object-cover"
                  />
                </a>
              ))}
            </div>
          )}
          {content && <div>{content}</div>}
        </div>
      </div>
    </div>
  );
}

