/**
 * Live order tracking timeline shown to the customer.
 *
 * It is driven ONLY by the same order row the brand owner updates from their
 * dashboard (status + the *_at timestamps), so there is a single source of
 * truth and no separate tracking system.
 */
import { BadgeCheck, CheckCircle2, Circle, Clock, Package, PackageCheck, Truck, XCircle } from "lucide-react";

import type { CustomerOrderDetail } from "@/lib/customer-orders.functions";

export interface TimelineStep {
  key: string;
  label: string;
  at: string | null;
  done: boolean;
  current: boolean;
  icon: typeof Circle;
}

function fmt(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "";
  }
}

export function buildTimeline(order: CustomerOrderDetail): TimelineStep[] {
  const cancelled = order.status === "cancelled";
  const paid = order.payment_status !== "pending";
  const prepared = Boolean(order.prepared_at) || ["prepared", "shipped", "delivered"].includes(order.status);
  const shipped = Boolean(order.shipped_at) || ["shipped", "delivered"].includes(order.status);
  const delivered = Boolean(order.delivered_at) || order.status === "delivered";

  const raw: Array<Omit<TimelineStep, "current">> = [
    { key: "created", label: "تم إنشاء الأوردر", at: order.created_at, done: true, icon: CheckCircle2 },
    {
      key: "paid",
      label: paid ? "تم تأكيد الدفع" : "بانتظار إتمام الدفع",
      at: order.payment_confirmed_at,
      done: paid,
      icon: paid ? BadgeCheck : Clock,
    },
    { key: "prepared", label: "تم تجهيز الأوردر", at: order.prepared_at, done: prepared, icon: Package },
    { key: "shipped", label: "تم الشحن", at: order.shipped_at, done: shipped, icon: Truck },
    { key: "delivered", label: "تم التسليم", at: order.delivered_at, done: delivered, icon: PackageCheck },
  ];

  if (cancelled) {
    return [
      ...raw.slice(0, 1).map((s) => ({ ...s, current: false })),
      { key: "cancelled", label: "تم إلغاء الأوردر", at: null, done: true, current: true, icon: XCircle },
    ];
  }

  const lastDone = raw.reduce((idx, s, i) => (s.done ? i : idx), 0);
  return raw.map((s, i) => ({ ...s, current: i === lastDone }));
}

export function OrderTimeline({ order }: { order: CustomerOrderDetail }) {
  const steps = buildTimeline(order);
  const cancelled = order.status === "cancelled";

  return (
    <ol className="relative mt-3 space-y-3 border-r border-border/70 pr-4">
      {steps.map((s) => {
        const Icon = s.icon;
        return (
          <li key={s.key} className="relative">
            <span
              className={`absolute -right-[26px] grid h-5 w-5 place-items-center rounded-full ring-2 ring-background ${
                cancelled && s.key === "cancelled"
                  ? "bg-destructive text-destructive-foreground"
                  : s.done
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              <Icon className="h-3 w-3" />
            </span>
            <div
              className={`text-sm ${
                s.current ? "font-semibold text-foreground" : s.done ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {s.label}
              {s.current && !cancelled && (
                <span className="mr-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                  الحالة الحالية
                </span>
              )}
            </div>
            {s.at && <div className="text-[11px] text-muted-foreground">{fmt(s.at)}</div>}
          </li>
        );
      })}
    </ol>
  );
}
