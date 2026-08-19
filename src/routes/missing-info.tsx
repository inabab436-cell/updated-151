import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, HelpCircle, Users, Loader2, Sparkles, MailCheck, CheckCircle2, CircleDashed,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import logo from "@/assets/cupai-logo.png.asset.json";
import {
  listMissingInfoTopics, type MissingInfoOverviewRow,
} from "@/lib/missing-info.functions";

export const Route = createFileRoute("/missing-info")({
  head: () => ({
    meta: [
      { title: "المعلومات الناقصة · cupai" },
      {
        name: "description",
        content:
          "كل المعلومات التي لم يجدها الوكيل الذكي، من سأل عنها، وما تم إضافته من إجابات.",
      },
      { property: "og:title", content: "المعلومات الناقصة · cupai" },
      {
        property: "og:description",
        content: "تابع أسئلة العملاء التي لم يجد لها الوكيل إجابة، وأضف المعلومة مرة واحدة.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MissingInfoPage,
});

function formatTime(iso: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

/**
 * Fields that map to a dedicated management page in the app — same mapping and
 * behaviour that used to live on the dashboard notification card.
 */
const FIELD_INTERFACE: Record<string, { to: "/products" | "/shipping" | "/policies"; label: string }> = {
  price:        { to: "/products", label: "الذهاب إلى المخزون" },
  size:         { to: "/products", label: "الذهاب إلى المخزون" },
  color:        { to: "/products", label: "الذهاب إلى المخزون" },
  availability: { to: "/products", label: "الذهاب إلى المخزون" },
  shipping:     { to: "/shipping", label: "الذهاب إلى جدول الشحن" },
  policy:       { to: "/policies", label: "الذهاب إلى السياسات" },
};

function MissingInfoPage() {
  const q = useQuery({
    queryKey: ["missing-info-topics"],
    queryFn: () => listMissingInfoTopics(),
    refetchInterval: 20000,
  });

  const rows: MissingInfoOverviewRow[] = q.data ?? [];
  const open = rows.filter((r) => r.status !== "resolved");
  const resolved = rows.filter((r) => r.status === "resolved");

  return (
    <div dir="rtl" className="min-h-screen bg-gradient-surface">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/dashboard" className="flex items-center gap-2">
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

      <main className="mx-auto w-full max-w-5xl space-y-8 px-4 py-10">
        <section>
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
            <HelpCircle className="h-3.5 w-3.5" />
            المعلومات الناقصة
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            كل المعلومات الناقصة في مكان واحد
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            هنا تُسجَّل كل معلومة لم يجدها الوكيل الذكي في قاعدة بياناتك: العملاء الذين
            سألوا عنها، والمعلومة التي أضفتها إن تمت إضافتها، والعملاء الذين رجع إليهم
            الوكيل بالرد بعد الإضافة. أي معلومة تضيفها تُحفظ بشكل دائم في قاعدة البيانات
            ويستخدمها الوكيل مباشرة مع العملاء.
          </p>
        </section>

        {q.isError && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {(q.error as Error)?.message || "تعذر تحميل المعلومات الناقصة."}
          </div>
        )}

        {q.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            جارٍ التحميل…
          </div>
        )}

        {!q.isLoading && rows.length === 0 && !q.isError && (
          <div className="rounded-2xl border border-border/60 bg-background/80 p-8 text-center text-sm text-muted-foreground shadow-card backdrop-blur">
            لا توجد معلومات ناقصة حتى الآن.
          </div>
        )}

        <TopicGroup
          title="لم تتم إضافتها بعد"
          Icon={CircleDashed}
          rows={open}
          emptyText={rows.length ? "كل المعلومات الناقصة تمت إضافتها." : ""}
        />
        <TopicGroup
          title="تمت إضافتها"
          Icon={CheckCircle2}
          rows={resolved}
          emptyText={rows.length ? "لم تُضف أي معلومة بعد." : ""}
        />
      </main>
    </div>
  );
}

function TopicGroup({
  title, Icon, rows, emptyText,
}: {
  title: string;
  Icon: React.ComponentType<{ className?: string }>;
  rows: MissingInfoOverviewRow[];
  emptyText: string;
}) {
  if (rows.length === 0 && !emptyText) return null;
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          <Icon className="h-4 w-4" />
          {title}
        </h2>
        <span className="text-xs text-muted-foreground">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-background/70 p-4 text-xs text-muted-foreground">
          {emptyText}
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((t) => (
            <TopicCard key={t.id} topic={t} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TopicCard({ topic }: { topic: MissingInfoOverviewRow }) {
  const [showAskers, setShowAskers] = useState(false);
  const [showFollowups, setShowFollowups] = useState(false);
  const added = topic.status === "resolved";
  const iface = topic.missing_field ? FIELD_INTERFACE[topic.missing_field] : undefined;
  const manualSearch: Record<string, string> = { t: topic.id };
  if (topic.notification_id) manualSearch.n = topic.notification_id;

  return (
    <li className="rounded-2xl border border-border/60 bg-background/80 p-4 shadow-card backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            added
              ? "bg-emerald-500/10 text-emerald-700"
              : "bg-blue-500/10 text-blue-700"
          }`}
        >
          {added ? <CheckCircle2 className="h-3 w-3" /> : <CircleDashed className="h-3 w-3" />}
          {added ? "تمت إضافة المعلومة" : "لم تُضف بعد"}
        </span>
        {topic.product && (
          <span className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground">
            {topic.product}
          </span>
        )}
        <span className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground">
          {topic.missing_field}
        </span>
        {topic.alert_count > 1 && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
            تنبيه متكرر ×{topic.alert_count}
          </span>
        )}
        <span className="ms-auto text-[11px] text-muted-foreground">
          آخر سؤال: {formatTime(topic.last_asked_at)}
        </span>
      </div>

      <p className="mt-2 text-sm font-semibold leading-relaxed text-foreground">
        {topic.canonical_question}
      </p>

      {/* Customers who asked */}
      <div className="mt-2">
        <button
          type="button"
          onClick={() => setShowAskers((v) => !v)}
          className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-2 py-0.5 text-[11px] font-medium hover:bg-muted"
        >
          <Users className="h-3 w-3" />
          {topic.customer_count} عميل سألوا
        </button>
        {showAskers && (
          <div className="mt-2 rounded-lg border border-border/60 bg-background/70 p-2">
            {topic.askers.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">لا يوجد عملاء.</div>
            ) : (
              <ul className="space-y-1">
                {topic.askers.map((a) => (
                  <li key={a.conversation_id}>
                    <Link
                      to="/conversation/$id"
                      params={{ id: a.conversation_id }}
                      search={a.message_id ? { m: a.message_id } : {}}
                      className="block rounded-md px-2 py-1 text-[11px] hover:bg-muted"
                    >
                      <span className="font-medium">{a.customer_name?.trim() || "عميل"}</span>
                      {a.question_text && (
                        <span className="text-muted-foreground"> — {a.question_text}</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* The information that was added */}
      {added && (topic.resolved_answer || topic.resolved_title) && (
        <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
          <div className="text-[11px] font-semibold text-emerald-700">
            المعلومة المضافة{topic.resolved_at ? ` · ${formatTime(topic.resolved_at)}` : ""}
          </div>
          {topic.resolved_title && (
            <div className="mt-1 text-xs font-medium text-foreground">{topic.resolved_title}</div>
          )}
          {topic.resolved_answer && (
            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
              {topic.resolved_answer}
            </p>
          )}
        </div>
      )}
      {added && !topic.resolved_answer && !topic.resolved_title && (
        <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-[11px] text-emerald-700">
          تمت إضافة المعلومة وحُفظت في قاعدة المعرفة التي يستخدمها الوكيل.
        </div>
      )}

      {/* Customers the agent went back to */}
      {(topic.followed_up.length > 0 || topic.followup_skipped.length > 0) && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowFollowups((v) => !v)}
            className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-500/20"
          >
            <MailCheck className="h-3 w-3" />
            {topic.followed_up.length > 0
              ? `${topic.followed_up.length} عميل تم الرد عليه`
              : "لا يوجد عملاء بحاجة للرد"}
          </button>
          {showFollowups && (
            <div className="mt-2 rounded-lg border border-border/60 bg-background/70 p-2">
              <ul className="space-y-1">
                {topic.followed_up.map((r) => {
                  const search: Record<string, string> = {};
                  if (r.followup_message_id) search.m = r.followup_message_id;
                  if (r.original_message_id) search.q = r.original_message_id;
                  return (
                    <li key={r.conversation_id}>
                      <Link
                        to="/conversation/$id"
                        params={{ id: r.conversation_id }}
                        search={search}
                        className="block rounded-md px-2 py-1 text-[11px] hover:bg-muted"
                      >
                        <span className="font-medium">{r.customer_name?.trim() || "عميل"}</span>
                        {r.question_text && (
                          <span className="text-muted-foreground"> — {r.question_text}</span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {topic.followup_skipped.length > 0 && (
                <div className="mt-2 border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
                  تم تجاوز {topic.followup_skipped.length} محادثة (لم تعد المعلومة مطلوبة).
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Actions — same behaviour that used to live on the notification card */}
      {!added && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild size="sm" className="gap-1">
            <Link to="/manual-entry" search={manualSearch}>
              <Sparkles className="h-3.5 w-3.5" />
              إدخال يدوي
            </Link>
          </Button>
          {iface && (
            <Button asChild size="sm" variant="outline" className="gap-1">
              <Link to={iface.to}>
                <ArrowLeft className="h-3.5 w-3.5 rotate-180" />
                {iface.label}
              </Link>
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
