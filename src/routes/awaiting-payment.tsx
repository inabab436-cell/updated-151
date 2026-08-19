import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, BedDouble, Check, Moon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  listConversations,
  confirmPaymentAndResumeAgent,
} from "@/lib/conversations.functions";

export const Route = createFileRoute("/awaiting-payment")({
  head: () => ({
    meta: [
      { title: "بانتظار استكمال الدفع · cupai" },
      {
        name: "description",
        content: "العملاء الذين اختاروا طريقة دفع يدوية وينتظرون تأكيد الدفع من فريقك.",
      },
      { property: "og:title", content: "بانتظار استكمال الدفع · cupai" },
      {
        property: "og:description",
        content: "تابع العملاء الذين ينتظرون تأكيد الدفع واستأنف الوكيل الذكي بضغطة واحدة.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AwaitingPaymentPage,
});

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("ar-EG", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function AwaitingPaymentPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["conversations"],
    queryFn: () => listConversations(),
    refetchInterval: 15000,
  });

  const resume = useMutation({
    mutationFn: (id: string) => confirmPaymentAndResumeAgent({ data: { id } }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
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
      toast.success("تم تأكيد الدفع وخصم الكميات — عاد الوكيل للرد على هذه المحادثة.");
    },
    onError: (e: any) => toast.error(e?.message || "تعذر استئناف الوكيل."),
  });

  const rows = (q.data ?? []).filter((c) => c.awaiting_payment);

  return (
    <div dir="rtl" className="min-h-screen bg-gradient-surface">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Moon className="h-4 w-4 text-amber-500" />
            عملاء بانتظار استكمال الدفع
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/dashboard">
              <ArrowRight className="ml-1 h-4 w-4" />
              لوحة التحكم
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8">
        <section>
          <h1 className="text-2xl font-bold tracking-tight">
            بانتظار استكمال الدفع
            <span className="ms-2 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white align-middle">
              {rows.length}
            </span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            هؤلاء العملاء أتموا الطلب واختاروا طريقة دفع يدوية، والوكيل نائم 😴 في محادثاتهم
            حتى تؤكد استلام الدفع.
          </p>
        </section>

        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 shadow-card backdrop-blur-sm">
          <p className="mb-3 flex items-start gap-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
            <BedDouble className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              الوكيل نائم 😴 في هذه المحادثات ولا يرد على العميل حتى تؤكد الدفع.
              <br />
              بعد الضغط على «تأكيد الدفع» سيعود الوكيل للاستمرار في هذه المحادثة.
            </span>
          </p>

          {q.isError && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {(q.error as Error)?.message || "تعذر تحميل المحادثات."}
            </div>
          )}

          {!q.isLoading && rows.length === 0 && !q.isError ? (
            <div className="grid place-items-center rounded-xl border border-dashed border-border/60 py-10 text-center text-xs text-muted-foreground">
              لا يوجد عملاء بانتظار استكمال الدفع حالياً.
            </div>
          ) : (
            <ul className="space-y-2">
              {rows.map((c) => {
                const displayName =
                  (c.customer_name && c.customer_name.trim()) ||
                  (c.visitor_number ? `زائر #${c.visitor_number}` : "زائر");
                return (
                  <li
                    key={c.id}
                    className="rounded-xl border border-border/60 bg-background/70 p-3"
                  >
                    <div className="flex flex-wrap items-start gap-3">
                      <Link
                        to="/conversation/$id"
                        params={{ id: c.id }}
                        className="min-w-0 flex-1 rounded-lg -m-1 p-1 hover:bg-muted/40"
                      >
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold">{displayName}</span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                            <Moon className="h-3 w-3" />
                            الوكيل نائم
                          </span>
                          <span className="ms-auto text-[11px] text-muted-foreground">
                            {formatTime(c.last_message_at ?? c.created_at)}
                          </span>
                        </div>
                        {c.last_message_preview && (
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground line-clamp-2">
                            {c.last_message_preview}
                          </p>
                        )}
                      </Link>
                      <div className="flex flex-col items-stretch gap-1">
                        <Button
                          size="sm"
                          disabled={resume.isPending}
                          onClick={() => resume.mutate(c.id)}
                        >
                          <Check className="ml-1 h-4 w-4" />
                          تأكيد الدفع
                        </Button>
                        <span className="text-[10px] leading-tight text-muted-foreground">
                          بعد الانتهاء من استكمال الدفع اضغط على هذا الزر
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
