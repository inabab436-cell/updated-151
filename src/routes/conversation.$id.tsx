import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Bot, Check, Moon, Send, User2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  confirmPaymentAndResumeAgent,
  getConversationDetail,
  sendMerchantReply,
  setConversationAgent,
} from "@/lib/conversations.functions";

export const Route = createFileRoute("/conversation/$id")({
  // `?m=<messageId>` deep-links to the exact message a customer asked about
  // (used by the missing-information notification customer list).
  // `?q=<messageId>` additionally highlights the original question when the
  // deep-link is coming from an auto follow-up recipients notification.
  validateSearch: (
    s: Record<string, unknown>,
  ): { m?: string; q?: string } => ({
    m: typeof s.m === "string" && s.m ? s.m : undefined,
    q: typeof s.q === "string" && s.q ? s.q : undefined,
  }),
  head: () => ({
    meta: [
      { title: "محادثة · cupai" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ConversationPage,
});

function ConversationPage() {
  const { id } = Route.useParams();
  const { m: focusMessageId, q: originalMessageId } =
    Route.useSearch() as { m?: string; q?: string };
  const focusRef = useRef<HTMLDivElement | null>(null);
  const qc = useQueryClient();
  const [reply, setReply] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const detail = useQuery({
    queryKey: ["conversation", id],
    queryFn: () => getConversationDetail({ data: { id } }),
    refetchInterval: 5000,
  });

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => setConversationAgent({ data: { id, enabled } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversation", id] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e: any) => toast.error(e?.message || "تعذر تحديث الوكيل"),
  });

  const send = useMutation({
    mutationFn: (content: string) => sendMerchantReply({ data: { id, content } }),
    onSuccess: () => {
      setReply("");
      qc.invalidateQueries({ queryKey: ["conversation", id] });
    },
    onError: (e: any) => toast.error(e?.message || "تعذر الإرسال"),
  });

  useEffect(() => {
    if (focusMessageId) {
      focusRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [detail.data?.messages.length, focusMessageId]);

  const d = detail.data;
  const title =
    d?.customer_name?.trim() ||
    (d?.visitor_number ? `زائر #${d.visitor_number}` : "زائر");
  const agentOn = d?.agent_enabled ?? true;
  const globallyDisabled = d?.agent_globally_disabled ?? false;
  const awaitingPayment = d?.awaiting_payment ?? false;

  const resumePayment = useMutation({
    mutationFn: () => confirmPaymentAndResumeAgent({ data: { id } }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["conversation", id] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      if (res?.ok === false) {
        const lines = (res.shortages ?? [])
          .map(
            (s: any) =>
              `${[s.product_name, s.color, s.size].filter(Boolean).join(" - ")}: المطلوب ${s.requested} / المتاح ${s.available}`,
          )
          .join(" • ");
        toast.error(
          res.error === "insufficient_stock"
            ? `الكمية غير متاحة الآن، لم يتم الخصم ولم يتم تأكيد الدفع. ${lines}`
            : "تعذر تأكيد الدفع — راجع الطلب المرتبط بالمحادثة.",
        );
        return;
      }
      toast.success("تم تأكيد الدفع وخصم الكميات — عاد الوكيل للرد في هذه المحادثة.");
    },
    onError: (e: any) => toast.error(e?.message || "تعذر تأكيد الدفع."),
  });



  return (
    <div dir="rtl" className="min-h-screen bg-gradient-surface flex flex-col">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <Button asChild variant="ghost" size="sm">
              <Link to="/dashboard">
                <ArrowRight className="ml-1 h-4 w-4" />
                رجوع
              </Link>
            </Button>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{title}</div>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <span className={agentOn ? "text-emerald-600" : "text-muted-foreground"}>
              الوكيل الذكي
            </span>
            <Switch
              checked={agentOn}
              disabled={toggle.isPending || !d}
              onCheckedChange={(v) => toggle.mutate(!!v)}
            />
          </label>
        </div>
        {globallyDisabled && (
          <div className="border-t bg-amber-100 text-amber-900">
            <div className="mx-auto w-full max-w-3xl px-4 py-2 text-xs">
              الوكيل الذكي معطّل على مستوى المتجر بالكامل — لن يتم إرسال ردود آلية.
            </div>
          </div>
        )}
        {awaitingPayment && (
          <div className="border-t border-amber-500/40 bg-amber-500/10">
            <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-1 items-start gap-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                <Moon className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  الوكيل نائم 😴 في هذه المحادثة بانتظار استكمال العميل للدفع.
                  <br />
                  بعد الضغط على «تأكيد الدفع» سيعود الوكيل للاستمرار في هذه المحادثة.
                </span>
              </div>
              <div className="flex flex-col items-stretch gap-1">
                <Button size="sm" disabled={resumePayment.isPending} onClick={() => resumePayment.mutate()}>
                  <Check className="ml-1 h-4 w-4" />
                  تأكيد الدفع
                </Button>
                <span className="text-[10px] leading-tight text-muted-foreground">
                  بعد الانتهاء من استكمال الدفع اضغط على هذا الزر
                </span>
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-4">
        {detail.isError && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {(detail.error as Error)?.message || "تعذر تحميل المحادثة."}
          </div>
        )}

        <div className="flex-1 space-y-3 overflow-y-auto py-2">
          {(d?.messages ?? []).length === 0 && !detail.isLoading && (
            <div className="grid place-items-center py-12 text-center text-sm text-muted-foreground">
              لا توجد رسائل بعد.
            </div>
          )}
          {(d?.messages ?? []).map((m) => {
            const isUser = m.role === "user";
            const isFocused = !!focusMessageId && m.id === focusMessageId;
            const isOriginal = !!originalMessageId && m.id === originalMessageId;
            const isFollowup = !!m.is_auto_followup;
            const wrapperRing = isFocused
              ? "rounded-xl ring-2 ring-primary/60 bg-primary/5 p-1"
              : isOriginal
                ? "rounded-xl ring-2 ring-amber-400/70 bg-amber-500/5 p-1"
                : "";
            return (
              <div
                key={m.id}
                ref={isFocused ? focusRef : undefined}
                className={`flex ${isUser ? "justify-start" : "justify-end"} ${wrapperRing}`}
              >
                <div className={`flex max-w-[85%] items-start gap-2 ${isUser ? "" : "flex-row-reverse"}`}>
                  <div className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs ${
                    isUser ? "bg-muted text-foreground" : "bg-primary text-primary-foreground"
                  }`}>
                    {isUser ? <User2 className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                  </div>
                  <div className="flex flex-col gap-1">
                    {isFollowup && (
                      <span className="self-end rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                        متابعة تلقائية — معلومة أُضيفت لاحقًا
                      </span>
                    )}
                    {isOriginal && (
                      <span className="self-start rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                        السؤال الأصلي
                      </span>
                    )}
                    <div className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed shadow-sm ${
                      isUser
                        ? "bg-background border border-border/60 text-foreground rounded-tr-sm"
                        : isFollowup
                          ? "bg-emerald-600 text-white rounded-tl-sm"
                          : "bg-primary text-primary-foreground rounded-tl-sm"
                    }`}>
                      {m.content}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <div className="sticky bottom-0 mt-2 border-t bg-background/80 py-3 backdrop-blur">
          <div className="flex items-end gap-2">
            <Textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (reply.trim()) send.mutate(reply.trim());
                }
              }}
              placeholder={agentOn ? "رد يدوي (سيظهر كرسالة من المتجر)…" : "الوكيل مغلق — اكتب ردك…"}
              rows={2}
              className="min-h-[52px] resize-none"
              disabled={send.isPending}
            />
            <Button
              onClick={() => reply.trim() && send.mutate(reply.trim())}
              disabled={send.isPending || !reply.trim()}
              className="gap-1"
            >
              <Send className="h-4 w-4" />
              إرسال
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
