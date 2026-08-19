import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowRight,
  CreditCard,
  LogOut,
  MessageSquare,
  Package,
  ShoppingCart,
  UserCircle2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { CustomerLoginPanel, useCustomerSession } from "@/components/customer/customer-login";
import { OrderTimeline } from "@/components/customer/order-timeline";
import { getStorefront } from "@/lib/storefront.functions";
import {
  listCustomerConversations,
  logoutCustomer,
} from "@/lib/customer-auth.functions";
import {
  getCustomerDraft,
  listCustomerOrdersDetailed,
  type CustomerOrderDetail,
} from "@/lib/customer-orders.functions";

export const Route = createFileRoute("/c/$slug/account")({
  head: ({ params }) => ({
    meta: [
      { title: `حسابي — ${params.slug}` },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AccountPage,
});

function AccountPage() {
  const { slug } = Route.useParams();
  const qc = useQueryClient();

  const storefront = useQuery({
    queryKey: ["storefront", slug],
    queryFn: () => getStorefront({ data: { slug } }),
  });
  const session = useCustomerSession();

  const merchantId = storefront.data?.merchantId ?? null;
  const brandName = storefront.data?.brandName || slug;

  const convFn = useServerFn(listCustomerConversations);
  const ordersFn = useServerFn(listCustomerOrdersDetailed);
  const draftFn = useServerFn(getCustomerDraft);
  const logoutFn = useServerFn(logoutCustomer);

  const conversations = useQuery({
    queryKey: ["customer-conversations"],
    queryFn: () => convFn(),
    enabled: !!session.data?.loggedIn,
  });
  const orders = useQuery({
    queryKey: ["customer-orders"],
    queryFn: () => ordersFn(),
    enabled: !!session.data?.loggedIn,
    // Live tracking: the customer always sees the latest status the brand
    // owner set from their dashboard.
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  });
  const draft = useQuery({
    queryKey: ["customer-draft"],
    queryFn: () => draftFn(),
    enabled: !!session.data?.loggedIn,
    refetchOnWindowFocus: true,
  });

  const allOrders: CustomerOrderDetail[] = orders.data ?? [];
  const awaitingPayment = allOrders.filter(
    (o) => o.payment_status === "pending" && o.status !== "cancelled",
  );
  const confirmedOrders = allOrders.filter(
    (o) => !(o.payment_status === "pending" && o.status !== "cancelled"),
  );

  const doLogout = useMutation({
    mutationFn: async () => logoutFn(),
    onSuccess: () => {
      toast.success("تم تسجيل الخروج.");
      qc.invalidateQueries({ queryKey: ["customer-session"] });
    },
  });

  return (
    <div dir="rtl" className="min-h-screen bg-gradient-surface">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <UserCircle2 className="h-5 w-5" /> حسابي — {brandName}
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/c/$slug" params={{ slug }}>
              <ArrowRight className="ml-1 h-4 w-4" /> العودة للمتجر
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
        {!merchantId ? (
          <div className="rounded-2xl border bg-background p-6 text-sm text-muted-foreground">
            المتجر غير موجود.
          </div>
        ) : session.isLoading ? (
          <div className="rounded-2xl border bg-background p-6 text-sm text-muted-foreground">
            جارٍ التحميل…
          </div>
        ) : !session.data?.loggedIn ? (
          <CustomerLoginPanel
            merchantId={merchantId}
            brandName={brandName}
            onSuccess={() => {
              qc.invalidateQueries({ queryKey: ["customer-session"] });
            }}
          />
        ) : (
          <>
            <section className="rounded-2xl border bg-background p-5 shadow-card">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">مرحبًا بك 👋</div>
                  <div dir="ltr" className="text-base font-medium">
                    {session.data.email}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => doLogout.mutate()}
                  disabled={doLogout.isPending}
                >
                  <LogOut className="ml-1 h-4 w-4" /> تسجيل الخروج
                </Button>
              </div>
            </section>


            <section className="rounded-2xl border bg-background p-5 shadow-card">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <MessageSquare className="h-4 w-4" /> المحادثات السابقة
              </div>
              {conversations.isLoading ? (
                <div className="text-sm text-muted-foreground">جارٍ التحميل…</div>
              ) : (conversations.data ?? []).length === 0 ? (
                <div className="text-sm text-muted-foreground">لا توجد محادثات سابقة.</div>
              ) : (
                <ul className="divide-y">
                  {(conversations.data ?? []).map((c) => (
                    <li key={c.id} className="flex items-start justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm">
                          {c.last_message ?? "— لا توجد رسائل —"}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {new Date(c.updated_at).toLocaleString()} · {c.message_count} رسالة
                        </div>
                      </div>
                      <Button asChild size="sm" variant="outline">
                        <Link to="/chat/$slug" params={{ slug }} search={{ mode: "continue" }}>
                          فتح
                        </Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* 1) Incomplete orders (cart started, never submitted) */}
            <section className="rounded-2xl border bg-background p-5 shadow-card">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <ShoppingCart className="h-4 w-4" /> أوردرات غير مكتملة
              </div>
              {draft.isLoading ? (
                <div className="text-sm text-muted-foreground">جارٍ التحميل…</div>
              ) : !draft.data ? (
                <div className="text-sm text-muted-foreground">لا توجد أوردرات غير مكتملة.</div>
              ) : (
                <div className="rounded-xl border border-amber-300/60 bg-amber-50/60 p-4">
                  <div className="text-xs text-muted-foreground">
                    آخر تحديث: {new Date(draft.data.updated_at).toLocaleString("ar-EG")}
                  </div>
                  <ul className="mt-2 space-y-1 text-sm">
                    {draft.data.items.map((l, i) => (
                      <li key={i} className="flex items-center justify-between gap-3">
                        <span>
                          {l.name}
                          {l.color || l.size ? (
                            <span className="text-xs text-muted-foreground">
                              {" "}
                              ({[l.color, l.size].filter(Boolean).join(" / ")})
                            </span>
                          ) : null}
                        </span>
                        <span className="text-xs text-muted-foreground">× {l.quantity}</span>
                      </li>
                    ))}
                  </ul>
                  <Button asChild size="sm" className="mt-3">
                    <Link to="/c/$slug" params={{ slug }} hash="cart">
                      استكمال الطلب
                    </Link>
                  </Button>
                </div>
              )}
            </section>

            {/* 2) Orders waiting for the payment to be completed */}
            {awaitingPayment.length > 0 && (
              <section className="rounded-2xl border bg-background p-5 shadow-card">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <CreditCard className="h-4 w-4" /> بانتظار إتمام الدفع
                </div>
                <div className="space-y-4">
                  {awaitingPayment.map((o) => (
                    <OrderCard key={o.id} order={o} slug={slug} awaiting />
                  ))}
                </div>
              </section>
            )}

            {/* 3) Confirmed orders + live tracking */}
            <section className="rounded-2xl border bg-background p-5 shadow-card">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Package className="h-4 w-4" /> الأوردرات المؤكدة
              </div>
              {orders.isLoading ? (
                <div className="text-sm text-muted-foreground">جارٍ التحميل…</div>
              ) : confirmedOrders.length === 0 ? (
                <div className="text-sm text-muted-foreground">لا توجد أوردرات مؤكدة.</div>
              ) : (
                <div className="space-y-4">
                  {confirmedOrders.map((o) => (
                    <OrderCard key={o.id} order={o} slug={slug} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function money(n: number | null, currency: string | null): string {
  if (n == null) return "—";
  return `${n} ${currency ?? ""}`.trim();
}

function OrderCard({
  order,
  slug,
  awaiting = false,
}: {
  order: CustomerOrderDetail;
  slug: string;
  awaiting?: boolean;
}) {
  return (
    <article className="rounded-xl border bg-background p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-mono text-sm font-semibold">
          #{order.order_number ?? order.id.slice(0, 8)}
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            awaiting
              ? "bg-amber-100 text-amber-800"
              : order.status === "cancelled"
                ? "bg-destructive/10 text-destructive"
                : "bg-primary/10 text-primary"
          }`}
        >
          {awaiting ? "بانتظار إتمام الدفع" : order.status === "cancelled" ? "ملغي" : "مؤكد"}
        </span>
      </header>

      <ul className="mt-3 space-y-1 text-sm">
        {order.items.length === 0 ? (
          <li className="text-muted-foreground">لا توجد تفاصيل منتجات.</li>
        ) : (
          order.items.map((it, i) => (
            <li key={i} className="flex items-start justify-between gap-3">
              <span>
                {it.product_name ?? "—"}
                {it.color || it.size ? (
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    ({[it.color, it.size].filter(Boolean).join(" / ")})
                  </span>
                ) : null}
              </span>
              <span className="whitespace-nowrap text-xs text-muted-foreground">
                × {it.quantity}
                {it.price != null ? ` · ${money(it.price, it.currency)}` : ""}
              </span>
            </li>
          ))
        )}
      </ul>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <div>
          الإجمالي: <span className="font-semibold text-foreground">{money(order.total_price, order.currency)}</span>
        </div>
        <div>
          طريقة الدفع: <span className="text-foreground">{order.payment_method ?? "—"}</span>
        </div>
        <div>
          حالة الدفع:{" "}
          <span className="text-foreground">
            {order.payment_status === "pending" ? "بانتظار إتمام الدفع" : "مدفوع"}
          </span>
        </div>
        <div>
          تاريخ الإنشاء:{" "}
          <span className="text-foreground">
            {new Date(order.created_at).toLocaleString("ar-EG")}
          </span>
        </div>
      </dl>

      <OrderTimeline order={order} />

      {awaiting && (
        <Button asChild size="sm" className="mt-3">
          <Link to="/chat/$slug" params={{ slug }} search={{ mode: "continue" }}>
            استكمال الدفع
          </Link>
        </Button>
      )}
    </article>
  );
}