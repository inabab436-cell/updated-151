import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CreditCard, Info, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import logo from "@/assets/cupai-logo.png.asset.json";
import {
  createPaymentMethod,
  deletePaymentMethod,
  listPaymentMethods,
  updatePaymentMethod,
  type PaymentBehavior,
  type PaymentDetailType,
  type PaymentMethod,
} from "@/lib/payment-methods.functions";

export const Route = createFileRoute("/settings/payment-methods")({
  head: () => ({
    meta: [
      { title: "طرق الدفع · cupai" },
      {
        name: "description",
        content: "اختر خيارات الدفع التي تقبلها وحدّد سلوك الوكيل الذكي مع كل طريقة.",
      },
      { property: "og:title", content: "طرق الدفع · cupai" },
      {
        property: "og:description",
        content: "اختر خيارات الدفع التي تقبلها وحدّد سلوك الوكيل الذكي مع كل طريقة.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PaymentMethodsPage,
});

function BehaviorBadge({ behavior }: { behavior: PaymentBehavior }) {
  const auto = behavior === "auto";
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        auto
          ? "bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/25"
          : "bg-orange-500/10 text-orange-600 ring-1 ring-orange-500/25"
      }`}
    >
      {auto ? "تلقائي" : "يدوي"}
    </span>
  );
}

function behaviorHint(behavior: PaymentBehavior) {
  return behavior === "auto"
    ? "يستمر الوكيل في المحادثة بشكل طبيعي."
    : "يتوقف الوكيل بعد الطلب وينتظر من فريقك تأكيد الدفع.";
}

const BEHAVIOR_CARDS: Array<{ value: PaymentBehavior; title: string; desc: string }> = [
  {
    value: "auto",
    title: "تلقائي",
    desc: "يستمر الوكيل في الرد على العميل بشكل طبيعي بعد الطلب.",
  },
  {
    value: "manual",
    title: "يدوي",
    desc: "يتوقف الوكيل مباشرة بعد الطلب ويظهر إشعار في لوحة التحكم لتأكيد الدفع بنفسك.",
  },
];

const DETAIL_LABELS: Record<PaymentDetailType, string> = {
  none: "لا يوجد",
  phone: "رقم الهاتف",
  url: "الرابط",
  text: "نص حر",
};

const DETAIL_PLACEHOLDERS: Record<Exclude<PaymentDetailType, "none">, string> = {
  phone: "مثال: 010xxxxxxxx",
  url: "مثال: رابط الدفع الخاص بك",
  text: "أي تفاصيل يحتاجها العميل لإتمام الدفع، مثل رقم الحساب أو عنوان الدفع أو رابط الدفع",
};

const NAME_PLACEHOLDER =
  "مثال: دفع عند الاستلام · Vodafone Cash · Orange Cash · Etisalat Cash · InstaPay";

interface FormState {
  name: string;
  behavior: PaymentBehavior;
  detailType: PaymentDetailType;
  detailValue: string;
  instructions: string;
  paymentTemplate: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  behavior: "auto",
  detailType: "none",
  detailValue: "",
  instructions: "",
  paymentTemplate: "",
};

function PaymentMethodsPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["payment-methods"],
    queryFn: () => listPaymentMethods(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["payment-methods"] });

  const update = useMutation({
    mutationFn: (v: { id: string; enabled?: boolean; behavior?: PaymentBehavior }) =>
      updatePaymentMethod({ data: v }),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e?.message || "تعذر حفظ التغيير."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deletePaymentMethod({ data: { id } }),
    onSuccess: () => {
      toast.success("تم حذف طريقة الدفع.");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message || "تعذر الحذف."),
  });

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  };

  const openEdit = (m: PaymentMethod) => {
    setEditingId(m.id);
    setForm({
      name: m.name,
      behavior: m.behavior,
      detailType: m.detail_type ?? "none",
      detailValue: m.detail_value ?? "",
      instructions: m.instructions ?? "",
      paymentTemplate: m.payment_template ?? "",
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        behavior: form.behavior,
        detail_type: form.detailType,
        detail_value: form.detailValue.trim(),
        instructions: form.instructions.trim(),
        payment_template: form.paymentTemplate.trim(),
      };
      if (editingId) {
        return updatePaymentMethod({ data: { id: editingId, ...payload } });
      }
      return createPaymentMethod({ data: payload });
    },
    onSuccess: () => {
      toast.success(editingId ? "تم حفظ التعديلات." : "تمت إضافة طريقة الدفع.");
      setOpen(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message || "تعذر الحفظ."),
  });

  const methods = q.data ?? [];

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
        <section className="flex items-start gap-3">
          <div className="rounded-xl bg-gradient-brand p-2.5 text-primary-foreground shadow-glow">
            <CreditCard className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">طرق الدفع</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              اختر خيارات الدفع التي تقبلها. كل خيار منها يغيّر طريقة تصرف الوكيل مع العملاء.
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-border/60 bg-background/80 shadow-card backdrop-blur">
          {q.isLoading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              جاري التحميل…
            </div>
          ) : methods.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">لا توجد طرق دفع بعد.</div>
          ) : (
            <ul className="divide-y divide-border/60">
              {methods.map((m) => (
                <li key={m.id} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-semibold">{m.name}</span>
                      <BehaviorBadge behavior={m.behavior} />
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Switch
                        checked={m.enabled}
                        disabled={update.isPending}
                        onCheckedChange={(v) => update.mutate({ id: m.id, enabled: !!v })}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground"
                        onClick={() => openEdit(m)}
                        aria-label={`تعديل ${m.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(m.id)}
                        aria-label={`حذف ${m.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    {behaviorHint(m.behavior)}
                  </p>
                  {m.detail_type !== "none" && m.detail_value ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {DETAIL_LABELS[m.detail_type]}: {m.detail_value}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <Button onClick={openCreate} className="w-full sm:w-auto">
          <Plus className="ml-1 h-4 w-4" />
          إضافة طريقة جديدة
        </Button>

        <section className="flex items-start gap-2 rounded-2xl border border-border/60 bg-muted/40 p-4 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            أي طريقة يتم تعيينها كيدوية تعني أن الوكيل سيسلّم المحادثة إليك بعد كل طلب يتم استخدام
            هذه الطريقة فيه.
          </p>
        </section>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader className="text-right">
            <DialogTitle>
              {editingId ? "تعديل طريقة الدفع" : "إضافة طريقة دفع جديدة"}
            </DialogTitle>
            <DialogDescription>
              حدّد اسم الطريقة وسلوك الوكيل والتفاصيل التي سيرسلها للعميل.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="pm-name">اسم الطريقة</Label>
              <Input
                id="pm-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder={NAME_PLACEHOLDER}
              />
            </div>

            <div className="space-y-2">
              <Label>نوع السلوك</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {BEHAVIOR_CARDS.map((c) => {
                  const active = form.behavior === c.value;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => set("behavior", c.value)}
                      aria-pressed={active}
                      className={`rounded-xl border p-3 text-right transition ${
                        active
                          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                          : "border-border/60 hover:bg-muted/40"
                      }`}
                    >
                      <span className="block text-sm font-semibold">{c.title}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                        {c.desc}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label>نوع التفاصيل</Label>
              <Select
                value={form.detailType}
                onValueChange={(v) => {
                  set("detailType", v as PaymentDetailType);
                  if (v === "none") set("detailValue", "");
                }}
              >
                <SelectTrigger dir="rtl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  {(Object.keys(DETAIL_LABELS) as PaymentDetailType[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {DETAIL_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pm-instructions">تعليمات خاصة بطريقة الدفع</Label>
              <Textarea
                id="pm-instructions"
                rows={4}
                value={form.instructions}
                onChange={(e) => set("instructions", e.target.value)}
                placeholder="مثال: اشرح للعميل طريقة الدفع وخطوات إتمامها..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pm-template">نموذج رسالة الدفع</Label>
              <Textarea
                id="pm-template"
                rows={4}
                value={form.paymentTemplate}
                onChange={(e) => set("paymentTemplate", e.target.value)}
                placeholder={
                  form.behavior === "manual"
                    ? "تمام، تم تأكيد الاوردر يا فندم. [تفاصيل الدفع]. من فضلك أبعت لينا لقطة شاشة للتحويل عشان يتم تأكيد الدفع."
                    : "تم تأكيد الاوردر يا فندم. وهيوصل لحضرتك في خلال [مدة التوصيل]."
                }
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                الرسالة التي يرسلها الوكيل للعميل عند اختيار هذه الطريقة. اتركها فارغة لاستخدام
                الصياغة الافتراضية. يمكنك استخدام: [تفاصيل الدفع] · [مدة التوصيل] · [رقم الطلب].
              </p>
            </div>

            {form.detailType !== "none" && (
              <div className="space-y-2">
                <Label htmlFor="pm-detail">{DETAIL_LABELS[form.detailType]}</Label>
                <Input
                  id="pm-detail"
                  type={form.detailType === "phone" ? "tel" : form.detailType === "url" ? "url" : "text"}
                  inputMode={form.detailType === "phone" ? "tel" : undefined}
                  value={form.detailValue}
                  onChange={(e) => set("detailValue", e.target.value)}
                  placeholder={DETAIL_PLACEHOLDERS[form.detailType]}
                />
              </div>
            )}

            <p className="text-xs leading-relaxed text-muted-foreground">
              هذه هي بالضبط المعلومات التي سيرسلها الوكيل إلى العميل عندما تختار هذه الطريقة.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:justify-start">
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending || form.name.trim().length < 2}
            >
              {save.isPending && <Loader2 className="ml-1 h-4 w-4 animate-spin" />}
              حفظ
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
