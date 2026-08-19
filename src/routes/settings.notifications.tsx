import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import logo from "@/assets/cupai-logo.png.asset.json";
import {
  getEmailNotificationSettings,
  updateEmailNotificationSettings,
  type EmailNotificationSettings,
} from "@/lib/email-notifications.functions";

export const Route = createFileRoute("/settings/notifications")({
  head: () => ({
    meta: [
      { title: "إعدادات الإشعارات · cupai" },
      {
        name: "description",
        content: "تحكم في إشعارات البريد الإلكتروني التي تصل إلى حسابك.",
      },
    ],
  }),
  component: NotificationSettingsPage,
});

const OPTIONS: Array<{ key: keyof EmailNotificationSettings; title: string; desc: string }> = [
  {
    key: "new_order",
    title: "إشعار عند وصول أوردر جديد",
    desc: "سيتم إعلامك عبر البريد الإلكتروني كلما تم تسجيل طلب جديد في متجرك.",
  },
  {
    key: "missing_information",
    title: "إشعار عند وجود معلومة ناقصة مطلوبة",
    desc: "سيتم إعلامك عندما يسأل أحد العملاء عن معلومة غير متوفرة لدى الوكيل الذكي.",
  },
];

function NotificationSettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["email-notification-settings"],
    queryFn: () => getEmailNotificationSettings(),
  });

  const [state, setState] = useState<EmailNotificationSettings>({
    new_order: true,
    missing_information: true,
  });

  useEffect(() => {
    if (q.data) {
      setState({
        new_order: q.data.new_order,
        missing_information: q.data.missing_information,
      });
    }
  }, [q.data]);

  const m = useMutation({
    mutationFn: (next: EmailNotificationSettings) =>
      updateEmailNotificationSettings({ data: next }),
    onSuccess: () => {
      toast.success("تم حفظ الإعدادات.");
      qc.invalidateQueries({ queryKey: ["email-notification-settings"] });
    },
    onError: (e: any) => toast.error(e?.message || "تعذر حفظ الإعدادات."),
  });

  function toggle(key: keyof EmailNotificationSettings, value: boolean) {
    const next = { ...state, [key]: value };
    setState(next);
    m.mutate(next);
  }

  function toggleAll(value: boolean) {
    const next: EmailNotificationSettings = {
      new_order: value,
      missing_information: value,
    };
    setState(next);
    m.mutate(next);
  }

  const allOn = state.new_order && state.missing_information;

  return (
    <div dir="rtl" className="min-h-screen bg-gradient-surface">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <img src={logo.url} alt="cupai" className="h-8 w-8 rounded-lg shadow-card" />
            <span className="text-sm font-semibold tracking-tight">cupai</span>
          </Link>
          <Button asChild variant="ghost" size="sm">
            <Link to="/dashboard">
              <ArrowLeft className="ml-1 h-4 w-4" />
              لوحة التحكم
            </Link>
          </Button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-10">
        <section>
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-gradient-brand p-2.5 text-primary-foreground shadow-glow">
              <Bell className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">إعدادات الإشعارات</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                فعّل أو عطّل كل نوع إشعار بشكل مستقل.
              </p>
            </div>
          </div>
        </section>

        <section className="flex items-center gap-2 rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm text-primary">
          <MailCheck className="h-4 w-4 shrink-0" />
          <p>
            ستصل الرسائل إلى البريد الإلكتروني المسجل
            {q.data?.email ? (
              <>
                {" "}
                (<span className="font-semibold">{q.data.email}</span>)
              </>
            ) : null}
            .
          </p>
        </section>

        <section className="rounded-2xl border border-border/60 bg-background/80 shadow-card backdrop-blur">
          <div className="flex items-center justify-between border-b border-border/60 p-4">
            <div>
              <div className="text-sm font-semibold">تفعيل الكل</div>
              <div className="text-xs text-muted-foreground">
                تشغيل أو إيقاف كل الإشعارات دفعة واحدة.
              </div>
            </div>
            <Switch
              checked={allOn}
              disabled={q.isLoading || m.isPending}
              onCheckedChange={(v) => toggleAll(!!v)}
            />
          </div>

          <ul className="divide-y divide-border/60">
            {OPTIONS.map((opt) => (
              <li key={opt.key} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{opt.title}</div>
                  <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {opt.desc}
                  </div>
                </div>
                <Switch
                  checked={state[opt.key]}
                  disabled={q.isLoading || m.isPending}
                  onCheckedChange={(v) => toggle(opt.key, !!v)}
                />
              </li>
            ))}
          </ul>

          {(q.isLoading || m.isPending) && (
            <div className="flex items-center gap-2 border-t border-border/60 p-3 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {q.isLoading ? "جاري التحميل…" : "جاري الحفظ…"}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
