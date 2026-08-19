import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgePercent, Clock, Info, Loader2, Plus, Repeat, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

import { PageShell } from "@/components/dashboard/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_OFFER_BROADCAST,
  deleteOffer,
  listOffers,
  saveOffer,
  type OfferDTO,
  type OfferInput,
} from "@/lib/offers.functions";
import { listWebsiteProducts } from "@/lib/website-products.functions";

export const Route = createFileRoute("/offers")({
  head: () => ({
    meta: [
      { title: "العروض والخصومات · cupai" },
      {
        name: "description",
        content: "أنشئ عروضاً وخصومات على منتج بعينه أو على كل المنتجات، بمدة زمنية حقيقية.",
      },
      { property: "og:title", content: "العروض والخصومات · cupai" },
      {
        property: "og:description",
        content: "عروض وخصومات مرتبطة بمدة حقيقية، والوكيل الذكي متصل بها لحظياً.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OffersPage,
});

const pad = (n: number) => String(n).padStart(2, "0");

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "2026-08-06T14:30" → ["2026-08-06", "14:30"] */
function splitLocal(v: string | null | undefined): [string, string] {
  const s = String(v ?? "");
  const [d = "", t = ""] = s.split("T");
  return [d, t.slice(0, 5)];
}

/** Rebuilds the combined value; an empty date clears the whole field. */
function joinLocal(date: string, time: string): string {
  if (!date) return "";
  return `${date}T${time || "00:00"}`;
}

/**
 * Converts the local "YYYY-MM-DDTHH:mm" the merchant typed into an absolute
 * ISO instant. Without this the server would read the value as UTC and the
 * saved time would shift by the merchant's timezone offset.
 */
function localToIso(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

type FormState = OfferInput & { id?: string | null };

function emptyForm(): FormState {
  return {
    id: null,
    title: "",
    description: "",
    scope: "product",
    product_id: null,
    discount_type: "percent",
    discount_value: 10,
    coupon_code: "",
    min_order_total: null,
    max_redemptions: null,
    usage_limit_type: "per_order",
    starts_at: toLocalInput(new Date().toISOString()),
    ends_at: "",
    is_active: true,
    notify_enabled: false,
    notify_message: DEFAULT_OFFER_BROADCAST,
  };
}

const STATE_LABEL: Record<OfferDTO["state"], string> = {
  live: "شغّال الآن",
  scheduled: "لم يبدأ بعد",
  ended: "منتهي",
};

/** Small helper text under a field. */
function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] leading-relaxed text-muted-foreground">{children}</p>;
}

/** Date + time in two separate controls — easier on mobile than datetime-local. */
function DateTimeField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
}) {
  const [date, time] = splitLocal(value);
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Input type="date" value={date} onChange={(e) => onChange(joinLocal(e.target.value, time))} />
          <span className="text-[10px] text-muted-foreground">اليوم</span>
        </div>
        <div className="space-y-1">
          <Input
            type="time"
            step={60}
            value={time}
            disabled={!date}
            onChange={(e) => onChange(joinLocal(date, e.target.value))}
          />
          <span className="text-[10px] text-muted-foreground">الساعة</span>
        </div>
      </div>
      {hint ? <Hint>{hint}</Hint> : null}
    </div>
  );
}

/** Ticks every second so the live screens keep moving. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function twoDigits(n: number) {
  return String(Math.max(0, Math.floor(n))).padStart(2, "0");
}

/** Live screen: remaining time of the offer, updated every second. */
function LiveTimeScreen({ offer, now }: { offer: OfferDTO; now: number }) {
  const endMs = offer.ends_at ? Date.parse(offer.ends_at) : NaN;
  const startMs = Date.parse(offer.starts_at);
  const target = Number.isFinite(startMs) && startMs > now ? startMs : endMs;
  const label =
    Number.isFinite(startMs) && startMs > now
      ? "يبدأ بعد"
      : Number.isFinite(endMs)
        ? "ينتهي بعد"
        : "مدة العرض";

  let body = "بدون نهاية";
  if (Number.isFinite(target)) {
    const diff = Math.max(0, target - now);
    const days = Math.floor(diff / 86_400_000);
    const hours = Math.floor((diff % 86_400_000) / 3_600_000);
    const minutes = Math.floor((diff % 3_600_000) / 60_000);
    const seconds = Math.floor((diff % 60_000) / 1000);
    body =
      diff === 0
        ? "انتهى"
        : `${days > 0 ? `${days} يوم · ` : ""}${twoDigits(hours)}:${twoDigits(minutes)}:${twoDigits(seconds)}`;
  }

  return (
    <div className="flex-1 rounded-xl border border-border/60 bg-muted/40 p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Clock className="h-3.5 w-3.5" />
        {label}
      </div>
      <div dir="ltr" className="mt-1 text-lg font-semibold tabular-nums">
        {body}
      </div>
    </div>
  );
}

/** Live screen: number of customers who benefited, refreshed continuously. */
function LiveCustomersScreen({ offer }: { offer: OfferDTO }) {
  const count = offer.beneficiaries.length || offer.redemption_count;
  return (
    <div className="flex-1 rounded-xl border border-border/60 bg-muted/40 p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Users className="h-3.5 w-3.5" />
        المستفيدون الآن
      </div>
      <div dir="ltr" className="mt-1 text-lg font-semibold tabular-nums">
        {count}
        {offer.max_redemptions ? ` / ${offer.max_redemptions}` : ""}
      </div>
    </div>
  );
}

/**
 * Total uses. Hidden for "once per customer", where uses can never differ
 * from the number of beneficiaries.
 */
function LiveUsesScreen({ offer }: { offer: OfferDTO }) {
  if (offer.usage_limit_type === "once_per_customer") return null;
  return (
    <div className="flex-1 rounded-xl border border-border/60 bg-muted/40 p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Repeat className="h-3.5 w-3.5" />
        مرات الاستخدام
      </div>
      <div dir="ltr" className="mt-1 text-lg font-semibold tabular-nums">
        {offer.use_count}
      </div>
    </div>
  );
}


/** Client-side preview of the exact message customers will receive. */
function previewMessage(f: FormState, productName: string | null): string {
  const fmt = (v?: string | null) => {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString("ar-EG", {
      day: "numeric",
      month: "long",
      hour: "numeric",
      minute: "2-digit",
    });
  };
  const discount =
    f.discount_type === "percent" ? `خصم ${f.discount_value}%` : `خصم ${f.discount_value}`;
  return String(f.notify_message ?? "")
    .replaceAll("[اسم العرض]", f.title || "عرض")
    .replaceAll("[قيمة الخصم]", discount)
    .replaceAll("[المنتج]", f.scope === "all" ? "كل المنتجات" : productName || "المنتج")
    .replaceAll("[تاريخ البداية]", fmt(f.starts_at) ?? "دلوقتي")
    .replaceAll("[تاريخ الانتهاء]", fmt(f.ends_at) ?? "إشعار آخر")
    .replaceAll("[كود الخصم]", f.coupon_code ? `استخدم كود: ${f.coupon_code}.` : "")
    .replaceAll(
      "[الحد الأدنى]",
      f.min_order_total != null ? `العرض يبدأ من طلب قيمته ${f.min_order_total}.` : "",
    )
    .replaceAll(
      "[عدد المستفيدين]",
      f.max_redemptions ? `العرض لأول ${f.max_redemptions} عميل بس.` : "",
    )
    .replaceAll("[تفاصيل العرض]", String(f.description ?? "").trim())
    .replace(/\s+/g, " ")
    .trim();
}

function OffersPage() {
  const qc = useQueryClient();
  const now = useNow();
  const offers = useQuery({
    queryKey: ["offers"],
    queryFn: () => listOffers(),
    // Keeps the live beneficiaries screen in sync as payments get confirmed.
    refetchInterval: 10_000,
  });
  const products = useQuery({
    queryKey: ["website-products"],
    queryFn: () => listWebsiteProducts(),
  });

  const [form, setForm] = useState<FormState>(emptyForm);
  const [open, setOpen] = useState(false);

  const save = useMutation({
    mutationFn: (input: OfferInput) => saveOffer({ data: input }),
    onSuccess: (r) => {
      toast.success(
        r.notified > 0 ? `تم حفظ العرض وإرسال الرسالة إلى ${r.notified} محادثة.` : "تم حفظ العرض.",
      );
      setForm(emptyForm());
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["offers"] });
    },
    onError: (e: any) => toast.error(e?.message || "تعذر حفظ العرض."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteOffer({ data: { id } }),
    onSuccess: () => {
      toast.success("تم حذف العرض.");
      qc.invalidateQueries({ queryKey: ["offers"] });
    },
    onError: (e: any) => toast.error(e?.message || "تعذر حذف العرض."),
  });

  const productOptions = useMemo(
    () => (products.data ?? []).map((p) => ({ id: p.id, name: p.name })),
    [products.data],
  );

  const selectedProductName = useMemo(
    () => productOptions.find((p) => p.id === form.product_id)?.name ?? null,
    [productOptions, form.product_id],
  );

  function edit(o: OfferDTO) {
    setForm({
      id: o.id,
      title: o.title,
      description: o.description ?? "",
      scope: o.scope,
      product_id: o.product_id,
      discount_type: o.discount_type,
      discount_value: o.discount_value,
      coupon_code: o.coupon_code ?? "",
      min_order_total: o.min_order_total,
      max_redemptions: o.max_redemptions,
      usage_limit_type: o.usage_limit_type,
      starts_at: toLocalInput(o.starts_at),
      ends_at: toLocalInput(o.ends_at),
      is_active: o.is_active,
      notify_enabled: o.notify_enabled,
      notify_message: o.notify_message ?? DEFAULT_OFFER_BROADCAST,
    });
    setOpen(true);
  }

  return (
    <PageShell
      title="العروض والخصومات"
      description="عرض خاص بمنتج واحد أو عرض شامل لكل المنتجات، مرتبط بمدة زمنية حقيقية أو بعدد مستفيدين — وينتهي تلقائياً بأول شرط يتحقق."
      icon={<BadgePercent className="h-5 w-5" />}
      actions={
        <Button
          onClick={() => {
            setForm(emptyForm());
            setOpen((v) => !v);
          }}
        >
          <Plus className="ml-1 h-4 w-4" />
          عرض جديد
        </Button>
      }
    >
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm leading-relaxed">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">كيف يُحسب الحد الأدنى؟</span>{" "}
          في العرض الخاص بمنتج واحد، الحد الأدنى شرط على قيمة هذا المنتج وحده — أسعار المنتجات
          الأخرى لا تُضاف إليه، والخصم لا يُطبَّق عليها. مثال: خصم 60% على فستان بحد أدنى 1000
          جنيه لا ينطبق على فستان بـ120 جنيه، ولا ينطبق حتى لو أضاف العميل سويت شيرت بـ850 جنيه.
          أما العرض الشامل لكل المنتجات فالحد الأدنى فيه محسوب على إجمالي الطلب. الوكيل لا يجتهد
          في ذلك: محرّك العروض هو الذي يحسب الأهلية والخصم، والوكيل يبلّغ العميل بالنتيجة كما هي.
        </p>
      </div>

      {open && (
        <section className="space-y-4 rounded-2xl border border-border/60 bg-background/80 p-4 shadow-card backdrop-blur">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>اسم العرض</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="تخفيضات نهاية الأسبوع"
              />
              
            </div>
            <div className="space-y-1.5">
              <Label>العرض على إيه؟</Label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.scope}
                onChange={(e) =>
                  setForm({ ...form, scope: e.target.value as OfferInput["scope"] })
                }
              >
                <option value="product">منتج واحد محدد</option>
                <option value="all">كل المنتجات</option>
              </select>
              
            </div>

            {form.scope === "product" && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>المنتج</Label>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.product_id ?? ""}
                  onChange={(e) => setForm({ ...form, product_id: e.target.value || null })}
                >
                  <option value="">اختر المنتج…</option>
                  {productOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                
              </div>
            )}

            <div className="space-y-1.5">
              <Label>نوع الخصم</Label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.discount_type}
                onChange={(e) =>
                  setForm({ ...form, discount_type: e.target.value as OfferInput["discount_type"] })
                }
              >
                <option value="percent">نسبة مئوية % (مثال: 20% من السعر)</option>
                <option value="amount">مبلغ ثابت (مثال: 50 يتخصموا من السعر)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>قيمة الخصم</Label>
              <Input
                type="number"
                min={0}
                value={form.discount_value}
                onChange={(e) => setForm({ ...form, discount_value: Number(e.target.value) })}
              />
              <Hint>
                {form.discount_type === "percent"
                  ? "نسبة من السعر بين 1 و100."
                  : "مبلغ يُخصم من السعر."}
              </Hint>
            </div>

            <DateTimeField
              label="بداية العرض"
              hint="اتركه فارغاً ليبدأ العرض فوراً."
              value={String(form.starts_at ?? "")}
              onChange={(v) => setForm({ ...form, starts_at: v })}
            />
            <DateTimeField
              label="نهاية العرض"
              hint="اتركه فارغاً لعرض بلا نهاية."
              value={String(form.ends_at ?? "")}
              onChange={(v) => setForm({ ...form, ends_at: v })}
            />

            <div className="space-y-1.5">
              <Label>عدد المستفيدين من العرض (اختياري)</Label>
              <Input
                type="number"
                min={1}
                step={1}
                placeholder="مثال: 50 عميل"
                value={form.max_redemptions ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    max_redemptions: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
              <Hint>ينتهي العرض فور اكتمال هذا العدد.</Hint>
            </div>

            <div className="space-y-1.5">
              <Label>عدد مرات الاستفادة</Label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.usage_limit_type ?? "per_order"}
                onChange={(e) =>
                  setForm({
                    ...form,
                    usage_limit_type: e.target.value as OfferInput["usage_limit_type"],
                  })
                }
              >
                <option value="once_per_customer">مرة واحدة لكل عميل</option>
                <option value="per_order">مع كل طلب</option>
              </select>
              <Hint>
                {form.usage_limit_type === "once_per_customer"
                  ? "كل عميل يستفيد مرة واحدة فقط، ولا يُطبَّق الخصم على طلباته التالية."
                  : "الخصم يُطبَّق على كل طلب للعميل طوال مدة العرض."}
              </Hint>
            </div>

            <div className="space-y-1.5">
              <Label>كود الخصم (اختياري)</Label>
              <Input
                value={form.coupon_code ?? ""}
                onChange={(e) => setForm({ ...form, coupon_code: e.target.value })}
                placeholder="SALE20"
              />
              
            </div>

            <div className="space-y-1.5">
              <Label>أقل قيمة للطلب علشان الخصم يشتغل (اختياري)</Label>
              <Input
                type="number"
                min={0}
                placeholder="مثال: 300"
                value={form.min_order_total ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    min_order_total: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
              <Hint>قيمة مالية للطلب، وليست عدد عملاء.</Hint>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label>تفاصيل أو شروط إضافية (اختياري)</Label>
              <Textarea
                rows={2}
                value={form.description ?? ""}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="شروط أو تفاصيل إضافية يعرفها الوكيل الذكي."
              />
              
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-border/60 p-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">إرسال رسالة تلقائية لكل العملاء</div>
                <div className="text-xs text-muted-foreground">
                  عند التعطيل لا تُرسل أي رسالة، ويظل العرض والخصم يعملان بشكل طبيعي.
                </div>
              </div>
              <Switch
                checked={!!form.notify_enabled}
                onCheckedChange={(v) => setForm({ ...form, notify_enabled: !!v })}
              />
            </div>
            {form.notify_enabled && (
              <div className="space-y-1.5">
                <Label>صيغة الرسالة</Label>
                <Textarea
                  rows={3}
                  value={form.notify_message ?? ""}
                  onChange={(e) => setForm({ ...form, notify_message: e.target.value })}
                />
                <Hint>
                  تُملأ الكلمات بين الأقواس تلقائياً:
                  <br />
                  [اسم العرض] · [قيمة الخصم] · [المنتج] · [تاريخ البداية] · [تاريخ الانتهاء] · [كود
                  الخصم] · [الحد الأدنى] · [عدد المستفيدين] · [تفاصيل العرض]
                </Hint>
                <div className="rounded-lg bg-muted/60 p-3">
                  <div className="mb-1 text-[11px] font-semibold text-muted-foreground">
                    شكل الرسالة اللي هتوصل للعميل
                  </div>
                  <p className="text-sm leading-relaxed">
                    {previewMessage(form, selectedProductName) || "—"}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Switch
                checked={form.is_active !== false}
                onCheckedChange={(v) => setForm({ ...form, is_active: !!v })}
              />
              <span className="text-sm">العرض مفعّل</span>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                إلغاء
              </Button>
              <Button
                disabled={save.isPending}
                onClick={() =>
                  save.mutate({
                    ...form,
                    starts_at: localToIso(form.starts_at),
                    ends_at: localToIso(form.ends_at),
                  })
                }
              >
                {save.isPending && <Loader2 className="ml-1 h-4 w-4 animate-spin" />}
                حفظ العرض
              </Button>
            </div>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-border/60 bg-background/80 shadow-card backdrop-blur">
        {offers.isLoading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            جاري التحميل…
          </div>
        ) : (offers.data ?? []).length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            لا توجد عروض حتى الآن. أضف عرضاً على منتج محدد أو على كل المنتجات.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {(offers.data ?? []).map((o) => (
              <li key={o.id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{o.title}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] ${
                          o.state === "live"
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {STATE_LABEL[o.state]}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {o.scope === "all" ? "كل المنتجات" : o.product_name ?? "منتج محذوف"} ·{" "}
                      {o.discount_type === "percent"
                        ? `خصم ${o.discount_value}%`
                        : `خصم ${o.discount_value}`}
                      {o.ends_at
                        ? ` · ينتهي ${new Date(o.ends_at).toLocaleString("ar-EG")}`
                        : " · بدون نهاية"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {o.notify_enabled ? "الرسالة التلقائية مفعّلة" : "الرسالة التلقائية معطّلة"}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => edit(o)}>
                      تعديل
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => remove.mutate(o.id)}
                      disabled={remove.isPending}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>

                <div className="flex gap-2">
                  <LiveTimeScreen offer={o} now={now} />
                  <LiveCustomersScreen offer={o} />
                  <LiveUsesScreen offer={o} />
                </div>

                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold text-muted-foreground">
                    المستفيدون من العرض
                  </div>
                  {o.beneficiaries.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      لم يستفد أي عميل بعد. يُحتسب العميل بعد تأكيد دفع طلبه فقط.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {o.beneficiaries.map((b) =>
                        b.conversation_id ? (
                          <li key={b.id}>
                            <Link
                              to="/conversation/$id"
                              params={{ id: b.conversation_id }}
                              className="block rounded-lg border border-border/60 px-3 py-2 text-xs hover:bg-muted/60"
                            >
                              استفاد عميل بالخصم الآن، وقيمة الطلب الخاص به{" "}
                              {b.order_total ?? 0}
                            </Link>
                          </li>
                        ) : (
                          <li
                            key={b.id}
                            className="rounded-lg border border-border/60 px-3 py-2 text-xs"
                          >
                            استفاد عميل بالخصم الآن، وقيمة الطلب الخاص به {b.order_total ?? 0}
                          </li>
                        ),
                      )}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
