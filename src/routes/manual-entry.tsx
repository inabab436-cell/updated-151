import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { Sparkles, Loader2, CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageShell, PageHero, SurfaceCard } from "@/components/layout/page-shell";
import { submitManualEntry } from "@/lib/manual-entry.functions";

const searchSchema = z.object({
  n: z.string().uuid().optional(),
  t: z.string().uuid().optional(),
});

export const Route = createFileRoute("/manual-entry")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "الإدخال اليدوي · cupai" },
      {
        name: "description",
        content:
          "أضف أي معلومة عن متجرك يدوياً وسيتم تصنيفها وحفظها تلقائياً في قاعدة معرفة الوكيل.",
      },
    ],
  }),
  component: ManualEntryPage,
});

function ManualEntryPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [text, setText] = useState("");

  const submit = useMutation({
    mutationFn: () =>
      submitManualEntry({
        data: {
          text: text.trim(),
          notificationId: search.n ?? null,
          topicId: search.t ?? null,
        },
      }),
    onSuccess: (res) => {
      toast.success("تم حفظ المعلومة في قاعدة المعرفة.");
      setText("");
      qc.invalidateQueries({ queryKey: ["notifications"] });
      if (res.resolvedNotificationId) {
        // Return to the dashboard where the notification is now resolved.
        void navigate({ to: "/dashboard" });
      }
    },
    onError: (e: any) => toast.error(e?.message || "تعذر حفظ المعلومة."),
  });

  const fromNotification = Boolean(search.n || search.t);
  const disabled = text.trim().length === 0 || submit.isPending;

  return (
    <PageShell dir="rtl" backTo="/dashboard" backLabel="لوحة التحكم">
      <PageHero
        eyebrow="قاعدة المعرفة"
        title="الإدخال اليدوي"
        description="اكتب أي معلومة عن متجرك بحرية، وسنقوم بفهمها وتصنيفها وحفظها تلقائياً في المكان المناسب لتكون جاهزة لاستخدامها من قِبل الوكيل عند الرد على العملاء."
        icon={<Sparkles className="h-5 w-5" />}
      />

      <SurfaceCard className="space-y-4">
        {fromNotification && (
          <div className="flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-primary">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              بعد حفظ المعلومة سيتم تحديد الإشعار المرتبط بها كتم حله تلقائياً.
            </p>
          </div>
        )}
        <label className="block space-y-2">
          <span className="text-sm font-medium text-foreground">
            المعلومة الجديدة
          </span>
          <textarea
            className="w-full min-h-[220px] rounded-xl border border-border/60 bg-background/80 p-3 text-sm shadow-inner focus:outline-none focus:ring-2 focus:ring-primary/40"
            placeholder="اكتب هنا أي معلومة تخص متجرك: تفاصيل منتج، سعر، مقاس، قاعدة شحن، سياسة إرجاع، أو أي شيء آخر…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            dir="rtl"
            disabled={submit.isPending}
          />
          <span className="block text-[11px] text-muted-foreground">
            يمكن الكتابة بأي لغة. سيتم فهم المحتوى وتصنيفه تلقائياً.
          </span>
        </label>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            onClick={() => submit.mutate()}
            disabled={disabled}
            className="gap-2"
          >
            {submit.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            حفظ المعلومة
          </Button>
        </div>
      </SurfaceCard>
    </PageShell>
  );
}
