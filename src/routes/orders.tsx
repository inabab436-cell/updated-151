import { Fragment, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, ClipboardList, Truck, PackageCheck, Package, Settings2, Info, XCircle, Trash2, BadgeCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { PageShell, PageHero, SurfaceCard } from "@/components/layout/page-shell";
import {
  listOrders,
  updateOrderStatus,
  cancelOrder,
  confirmOrderPayment,

  getOrderStatusMessages,
  setOrderStatusMessages,
  type OrderRow,
} from "@/lib/orders.functions";
import { PAYMENT_REQUIRED_MESSAGE, canStartFulfillment } from "@/lib/order-status-gate";

export const Route = createFileRoute("/orders")({
  head: () => ({
    meta: [
      { title: "الطلبات · cupai" },
      { name: "description", content: "إدارة الطلبات ومتابعة حالة الشحن والتسليم." },
    ],
  }),
  component: OrdersPage,
});

function statusLabel(s: string): string {
  switch (s) {
    case "new": return "جديد";
    case "prepared": return "تم تجهيز الأوردر";
    case "shipped": return "تم الشحن";
    case "delivered": return "تم التسليم";
    case "cancelled": return "ملغى";
    default: return s;
  }
}

function statusClass(s: string): string {
  switch (s) {
    case "new": return "bg-primary/10 text-primary";
    case "prepared": return "bg-violet-500/10 text-violet-600";
    case "shipped": return "bg-blue-500/10 text-blue-600";
    case "delivered": return "bg-emerald-500/10 text-emerald-600";
    case "cancelled": return "bg-destructive/10 text-destructive";
    default: return "bg-muted text-muted-foreground";
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });
  } catch { return iso; }
}

function fmtMoney(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/**
 * Order value = what the customer pays (products − discount + shipping).
 * When a discount was applied, a small line under the value states it, as
 * either an amount or a percentage of the products total.
 */
function OrderValue({ order }: { order: OrderRow }) {
  const currency =
    (order.items.find((i) => (i.currency ?? "").trim())?.currency ?? "").trim();
  const itemsTotal = order.items.reduce((sum, i) => {
    const line =
      i.line_total ?? (Number(i.unit_price ?? i.price ?? 0) * Number(i.quantity ?? 0));
    const n = Number(line);
    return Number.isFinite(n) ? sum + n : sum;
  }, 0);
  const subtotal = Number(order.subtotal_price ?? itemsTotal) || 0;
  const total = order.total_price != null ? Number(order.total_price) : null;
  const discount = Number(order.discount_amount ?? 0) || 0;

  if (total == null && subtotal <= 0) return <span className="text-muted-foreground">—</span>;
  const value = total ?? subtotal;
  const percent = discount > 0 && subtotal > 0 ? Math.round((discount / subtotal) * 100) : 0;

  return (
    <div className="leading-tight">
      <div className="font-semibold">
        {fmtMoney(value)} {currency}
      </div>
      {discount > 0 && (
        <div className="text-[11px] text-emerald-700">
          بعد خصم {fmtMoney(discount)} {currency}
          {percent > 0 ? ` (${percent}%)` : ""}
        </div>
      )}
    </div>
  );
}



function OrdersPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["orders"], queryFn: () => listOrders() });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const statusMut = useMutation({
    mutationFn: (v: { id: string; status: "prepared" | "shipped" | "delivered" }) =>
      updateOrderStatus({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      toast.success("تم تحديث حالة الطلب.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "فشل التحديث."),
  });

  const cancelMut = useMutation({
    mutationFn: (v: { id: string }) => cancelOrder({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      toast.success("تم إلغاء الطلب وإرجاع الكميات للمخزون.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "فشل الإلغاء."),
  });

  const payMut = useMutation({
    mutationFn: (v: { id: string }) => confirmOrderPayment({ data: v }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      if (res.ok === false) {
        const lines = (res.shortages ?? [])
          .map(
            (s: any) =>
              `${s.product_name ?? ""}${s.color ? ` - ${s.color}` : ""}${s.size ? ` - ${s.size}` : ""}: المطلوب ${s.requested} / المتاح ${s.available}`,
          )
          .join(" • ");
        toast.error(`الكمية غير متاحة الآن، لم يتم الخصم. ${lines}`);
        return;
      }
      toast.success(
        res.alreadyConfirmed
          ? "الدفع مؤكد بالفعل — لم يتم خصم أي كمية إضافية."
          : "تم تأكيد الدفع وخصم الكميات من المخزون.",
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "فشل تأكيد الدفع."),
  });

  /** Fulfilment (تجهيز/شحن/تسليم) is blocked until the payment is confirmed. */
  const guardedStatus = (o: OrderRow, status: "prepared" | "shipped" | "delivered") => {
    if (!canStartFulfillment(o.payment_status)) {
      toast.error(PAYMENT_REQUIRED_MESSAGE);
      return;
    }
    statusMut.mutate({ id: o.id, status });
  };

  const rows: OrderRow[] = q.data ?? [];

  return (
    <PageShell>
      <PageHero
        eyebrow="إدارة الطلبات"
        icon={<ClipboardList className="h-3.5 w-3.5" />}
        title="كل"
        highlight="الطلبات"
        description="تابع الطلبات، وسّع أي طلب لعرض تفاصيله، وحدّث الحالة ليصل إشعار للعميل تلقائياً."
      />

      <SurfaceCard className="flex items-start gap-2 p-4 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p>
          الطلبات بطريقة دفع <span className="font-semibold text-foreground">تلقائية</span> يتم خصم كمياتها من المخزون فور إنشاء الطلب.
          أما الطلبات بطريقة دفع <span className="font-semibold text-foreground">يدوية</span> فلا يتم خصم أي كمية إلا بعد ضغطك على
          <span className="font-semibold text-foreground"> «تأكيد الدفع»</span>، وعندها يتم التحقق من المخزون الحقيقي ثم الخصم.
          لو حابب ترجّع الكميات للمخزون مرة أخرى، اضغط زر <span className="font-semibold text-foreground">«ملغي»</span> بجانب الطلب.
        </p>
      </SurfaceCard>


      <StatusMessagesEditor />

      {q.isLoading ? (
        <SurfaceCard className="p-10 text-center text-sm text-muted-foreground">جاري التحميل...</SurfaceCard>
      ) : rows.length === 0 ? (
        <SurfaceCard className="p-12 text-center">
          <p className="text-sm text-muted-foreground">لا توجد طلبات بعد.</p>
        </SurfaceCard>
      ) : (
        <SurfaceCard>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="w-8 px-3 py-3"></th>
                  <th className="px-4 py-3">رقم الطلب</th>
                  <th className="px-4 py-3">العميل</th>
                  <th className="px-4 py-3">الهاتف</th>
                  <th className="px-4 py-3">العنوان</th>
                  <th className="px-4 py-3">قيمة الطلب</th>
                  <th className="px-4 py-3">الحالة</th>
                  <th className="px-4 py-3">الدفع</th>
                  <th className="px-4 py-3">التاريخ</th>

                  <th className="px-4 py-3">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((o) => {
                  const open = !!expanded[o.id];
                  return (
                    <Fragment key={o.id}>
                      <tr className="hover:bg-muted/20">
                        <td className="px-3 py-3">
                          <button
                            onClick={() => setExpanded((s) => ({ ...s, [o.id]: !s[o.id] }))}
                            className="grid h-7 w-7 place-items-center rounded-lg border border-border/60 bg-background hover:bg-muted"
                            aria-label={open ? "طي" : "توسيع"}
                          >
                            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          </button>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{o.order_number ?? o.id.slice(0, 8)}</td>
                        <td className="px-4 py-3 font-medium">{o.customer_name ?? "—"}</td>
                        <td className="px-4 py-3 font-mono text-xs" dir="ltr">{o.customer_phone ?? "—"}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground max-w-[220px] truncate" title={o.customer_address ?? ""}>
                          {o.customer_address ?? "—"}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <OrderValue order={o} />
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusClass(o.status)}`}>
                            {statusLabel(o.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              o.payment_status === "pending"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-emerald-100 text-emerald-800"
                            }`}
                            title={o.payment_method ?? ""}
                          >
                            {o.payment_status === "pending" ? "بانتظار الدفع" : "مدفوع"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(o.created_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {o.payment_status === "pending" && o.status !== "cancelled" && (
                              <Button
                                size="sm"
                                disabled={payMut.isPending}
                                onClick={() => payMut.mutate({ id: o.id })}
                              >
                                <BadgeCheck className="ml-1 h-3.5 w-3.5" /> تأكيد الدفع
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                o.status === "prepared" ||
                                o.status === "shipped" ||
                                o.status === "delivered" ||
                                o.status === "cancelled" ||
                                statusMut.isPending
                              }
                              onClick={() => guardedStatus(o, "prepared")}
                            >
                              <Package className="ml-1 h-3.5 w-3.5" /> تجهيز
                            </Button>
                            <Button
                              size="sm"

                              variant="outline"
                              disabled={o.status === "shipped" || o.status === "delivered" || statusMut.isPending}
                              onClick={() => guardedStatus(o, "shipped")}
                            >
                              <Truck className="ml-1 h-3.5 w-3.5" /> شحن
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={o.status === "delivered" || statusMut.isPending}
                              onClick={() => guardedStatus(o, "delivered")}
                            >
                              <PackageCheck className="ml-1 h-3.5 w-3.5" /> تسليم
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-destructive hover:text-destructive"
                              disabled={o.status === "cancelled" || cancelMut.isPending}
                              onClick={() => cancelMut.mutate({ id: o.id })}
                            >
                              <XCircle className="ml-1 h-3.5 w-3.5" /> ملغي
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-muted/10">
                          <td></td>
                          <td colSpan={8} className="px-4 py-4">
                            <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                              تفاصيل المنتجات
                            </div>
                            <div className="overflow-x-auto rounded-lg border border-border/60 bg-background">
                              <table className="w-full text-right text-xs">
                                <thead className="bg-muted/40 text-[10px] uppercase text-muted-foreground">
                                  <tr>
                                    <th className="px-3 py-2">المنتج</th>
                                    <th className="px-3 py-2">اللون</th>
                                    <th className="px-3 py-2">المقاس</th>
                                    <th className="px-3 py-2">الكمية</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border/60">
                                  {o.items.length === 0 ? (
                                    <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">لا توجد منتجات.</td></tr>
                                  ) : o.items.map((it, i) => (
                                    <tr key={i}>
                                      <td className="px-3 py-2 font-medium">{it.product_name ?? "—"}</td>
                                      <td className="px-3 py-2">{it.color ?? "—"}</td>
                                      <td className="px-3 py-2">{it.size ?? "—"}</td>
                                      <td className="px-3 py-2">{it.quantity ?? "—"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                              <div>
                                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">ملاحظات العميل</div>
                                <div className="mt-1 rounded-lg border border-border/60 bg-background p-3 text-xs leading-relaxed whitespace-pre-wrap">
                                  {o.notes?.trim() ? o.notes : <span className="text-muted-foreground">لا توجد ملاحظات.</span>}
                                </div>
                              </div>
                              <div className="text-xs text-muted-foreground space-y-1">
                                <div>تاريخ التجهيز: <span className="font-medium text-foreground">{fmtDate(o.prepared_at)}</span></div>
                                <div>تاريخ الشحن: <span className="font-medium text-foreground">{fmtDate(o.shipped_at)}</span></div>
                                <div>تاريخ التسليم: <span className="font-medium text-foreground">{fmtDate(o.delivered_at)}</span></div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SurfaceCard>
      )}
    </PageShell>
  );
}

function StatusMessagesEditor() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["order-status-messages"], queryFn: () => getOrderStatusMessages() });
  const [prepared, setPrepared] = useState("");
  const [shipped, setShipped] = useState("");
  const [delivered, setDelivered] = useState("");
  const [preparedEnabled, setPreparedEnabled] = useState(true);
  const [shippedEnabled, setShippedEnabled] = useState(true);
  const [deliveredEnabled, setDeliveredEnabled] = useState(true);

  useEffect(() => {
    if (q.data) {
      setPrepared(q.data.prepared);
      setShipped(q.data.shipped);
      setDelivered(q.data.delivered);
      setPreparedEnabled(q.data.preparedEnabled);
      setShippedEnabled(q.data.shippedEnabled);
      setDeliveredEnabled(q.data.deliveredEnabled);
    }
  }, [q.data]);

  const saveMut = useMutation({
    mutationFn: (v: {
      prepared: string;
      shipped: string;
      delivered: string;
      preparedEnabled: boolean;
      shippedEnabled: boolean;
      deliveredEnabled: boolean;
    }) => setOrderStatusMessages({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["order-status-messages"] });
      toast.success("تم حفظ رسائل الحالة.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "فشل الحفظ."),
  });

  const save = (
    over?: Partial<{
      prepared: string;
      shipped: string;
      delivered: string;
      preparedEnabled: boolean;
      shippedEnabled: boolean;
      deliveredEnabled: boolean;
    }>,
  ) =>
    saveMut.mutate({
      prepared,
      shipped,
      delivered,
      preparedEnabled,
      shippedEnabled,
      deliveredEnabled,
      ...over,
    });

  return (
    <SurfaceCard className="space-y-5 p-5">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Settings2 className="h-4 w-4 text-primary" />
          الرسائل التلقائية لحالات الأوردر
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          تحكم في الرسائل التي يتم إرسالها تلقائيًا للعميل عند تحديث حالة الأوردر. يمكنك تعديلها أو حذفها أو إيقاف إرسالها بالكامل.
        </p>
      </div>

      <MessageBlock
        title="رسالة عند تجهيز الأوردر"
        value={prepared}
        onChange={setPrepared}
        enabled={preparedEnabled}
        onToggle={(v) => {
          setPreparedEnabled(v);
          save({ preparedEnabled: v });
        }}
        onDelete={() => {
          setPrepared("");
          save({ prepared: "" });
        }}
        rows={2}
        pending={saveMut.isPending}
      />

      <MessageBlock
        title="رسالة عند تم الشحن"
        value={shipped}
        onChange={setShipped}
        enabled={shippedEnabled}
        onToggle={(v) => {
          setShippedEnabled(v);
          save({ shippedEnabled: v });
        }}
        onDelete={() => {
          setShipped("");
          save({ shipped: "" });
        }}
        rows={2}
        pending={saveMut.isPending}
      />

      <MessageBlock
        title="رسالة عند تم التسليم"
        value={delivered}
        onChange={setDelivered}
        enabled={deliveredEnabled}
        onToggle={(v) => {
          setDeliveredEnabled(v);
          save({ deliveredEnabled: v });
        }}
        onDelete={() => {
          setDelivered("");
          save({ delivered: "" });
        }}
        rows={3}
        pending={saveMut.isPending}
      />

      <Button onClick={() => save()} disabled={saveMut.isPending || q.isLoading}>
        حفظ التعديلات
      </Button>
    </SurfaceCard>
  );
}

function MessageBlock(props: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  onDelete: () => void;
  rows: number;
  pending: boolean;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-border/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-xs font-medium">{props.title}</label>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              {props.enabled ? "الإرسال مفعّل" : "الإرسال متوقف"}
            </span>
            <Switch checked={props.enabled} onCheckedChange={props.onToggle} disabled={props.pending} />
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={props.pending || !props.value.trim()}
            onClick={props.onDelete}
          >
            <Trash2 className="ml-1 h-3.5 w-3.5" /> حذف
          </Button>
        </div>
      </div>
      <Textarea
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        rows={props.rows}
        disabled={!props.enabled}
        placeholder="لا توجد رسالة — لن يتم إرسال أي شيء للعميل."
      />
      {(!props.enabled || !props.value.trim()) && (
        <p className="text-[11px] text-muted-foreground">لن يتم إرسال أي رسالة للعميل عند هذه الحالة.</p>
      )}
    </div>
  );
}
