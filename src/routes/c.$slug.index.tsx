import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ShoppingBag, ShoppingCart, X, Send, Info, Truck, PhoneCall, ScrollText, MessageSquare, UserCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CartProvider, useCart } from "@/lib/cart";
import { CustomerAuthGate, useCustomerSession } from "@/components/customer/customer-login";
import { getStorefront, createStorefrontOrder, checkStorefrontStock, type StorefrontData } from "@/lib/storefront.functions";
import { saveCustomerDraft, clearCustomerDraft } from "@/lib/customer-orders.functions";
import { THEMES } from "@/components/website/identity-section";

export const Route = createFileRoute("/c/$slug/")({
  head: ({ params }) => {
    const name = prettifySlug(params.slug);
    return {
      meta: [
        { title: `${name} — Online store` },
        { name: "description", content: `Browse products from ${name} and place your order online.` },
        { property: "og:title", content: `${name} — Online store` },
        { property: "og:description", content: `Browse products from ${name} and place your order online.` },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  component: BrandPageShell,
});

function prettifySlug(slug: string) {
  return slug.split("-").filter(Boolean).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ") || "Brand";
}

function BrandPageShell() {
  const { slug } = Route.useParams();
  return (
    <CartProvider slug={slug}>
      <BrandPage slug={slug} />
    </CartProvider>
  );
}

function BrandPage({ slug }: { slug: string }) {
  return <BrandPageInner slug={slug} />;
}

/**
 * Debounced persistence of the local cart into the customer's server-side
 * draft (order_drafts). Only runs for a signed-in customer.
 */
function useDraftSync(cart: ReturnType<typeof useCart>, loggedIn: boolean) {
  const saveDraft = useServerFn(saveCustomerDraft);
  const clearDraft = useServerFn(clearCustomerDraft);
  const lines = cart.lines;

  useEffect(() => {
    if (!loggedIn) return;
    const t = setTimeout(() => {
      if (lines.length === 0) {
        void clearDraft().catch(() => {});
        return;
      }
      void saveDraft({
        data: {
          items: lines.map((l) => ({
            productId: l.productId,
            name: l.name,
            price: l.price,
            currency: l.currency,
            quantity: l.quantity,
            image: l.image ?? null,
            color: l.color ?? null,
            size: l.size ?? null,
          })),
        },
      }).catch(() => {});
    }, 900);
    return () => clearTimeout(t);
  }, [loggedIn, lines, saveDraft, clearDraft]);
}

function BrandPageInner({ slug }: { slug: string }) {
  const q = useQuery({
    queryKey: ["storefront", slug],
    queryFn: () => getStorefront({ data: { slug } }),
  });
  const [openDetail, setOpenDetail] = useState<{ kind: "policy" | "contact" | "shipping"; id: string } | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const cart = useCart();
  const session = useCustomerSession();

  // Keep an "incomplete order" draft in sync for the signed-in customer so it
  // shows up in their account page with a "resume" button.
  useDraftSync(cart, Boolean(session.data?.loggedIn));

  const brandName = q.data?.brandName || prettifySlug(slug);

  if (q.isLoading) {
    return <div className="grid min-h-screen place-items-center bg-gradient-surface text-muted-foreground text-sm">Loading store…</div>;
  }
  const store: StorefrontData | undefined = q.data;
  if (!store || !store.found) {
    return (
      <div className="grid min-h-screen place-items-center bg-gradient-surface px-6 text-center">
        <div className="rounded-2xl border border-border/60 bg-background/80 p-10 shadow-elegant backdrop-blur-xl">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-brand text-primary-foreground shadow-glow"><ShoppingBag className="h-6 w-6" /></div>
          <h1 className="mt-4 text-2xl font-semibold">Store not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">No storefront exists at /c/{slug}.</p>
        </div>
      </div>
    );
  }

  const theme = THEMES[(store.themeKey ?? "").toLowerCase()] ?? THEMES.espresso;
  const themeVars: React.CSSProperties = {
    // Expose palette as CSS vars for descendant components.
    ["--brand-primary" as any]: theme.primary,
    ["--brand-secondary" as any]: theme.secondary,
    ["--brand-accent" as any]: theme.accent,
    ["--brand-bg" as any]: theme.bg,
  };

  return (
    <div className="min-h-screen" style={{ ...themeVars, background: theme.bg }}>
      <header
        className="sticky top-0 z-30 border-b backdrop-blur-xl"
        style={{ background: `${theme.bg}cc`, borderColor: `${theme.primary}22` }}
      >
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            {store.logoUrl ? (
              <img src={store.logoUrl} alt={brandName}
                className="h-10 w-10 rounded-full object-cover ring-2"
                style={{ boxShadow: `0 0 0 2px ${theme.primary}` } as React.CSSProperties} />
            ) : (
              <div className="grid h-10 w-10 place-items-center rounded-full text-white font-bold"
                style={{ background: theme.primary }}>
                {brandName.slice(0, 1).toUpperCase()}
              </div>
            )}
            <h1 className="truncate text-base font-semibold" style={{ color: theme.primary }}>{brandName}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="outline" className="gap-1.5 hidden sm:inline-flex"
              style={{ borderColor: `${theme.primary}44`, color: theme.primary }}>
              <Link to="/c/$slug/account" params={{ slug }}>
                <UserCircle2 className="h-4 w-4" />
                {session.data?.loggedIn ? "حسابي" : "تسجيل الدخول"}
              </Link>
            </Button>
            <Button asChild size="icon" variant="outline" className="sm:hidden"
              style={{ borderColor: `${theme.primary}44`, color: theme.primary }}
              title={session.data?.loggedIn ? "حسابي" : "تسجيل الدخول"}
              aria-label={session.data?.loggedIn ? "حسابي" : "تسجيل الدخول"}>
              <Link to="/c/$slug/account" params={{ slug }}>
                <UserCircle2 className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="gap-1.5 hidden sm:inline-flex"
              style={{ borderColor: `${theme.primary}44`, color: theme.primary }}>
              <Link to="/chat/$slug" params={{ slug }} search={{ mode: "continue" }}>
                <MessageSquare className="h-4 w-4" />
                المحادثة
              </Link>
            </Button>
            <Button asChild size="icon" variant="outline" className="sm:hidden"
              style={{ borderColor: `${theme.primary}44`, color: theme.primary }}
              title="المحادثة">
              <Link to="/chat/$slug" params={{ slug }} search={{ mode: "continue" }}>
                <MessageSquare className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              size="sm"
              onClick={() => { void q.refetch(); setCartOpen(true); }}
              className="gap-2 text-white"
              style={{ background: theme.primary }}
            >
              <ShoppingCart className="h-4 w-4" />
              السلة{cart.count > 0 ? ` (${cart.count})` : ""}
            </Button>

          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto w-full max-w-6xl px-4 pt-10 pb-6 text-center">
        {store.logoUrl && (
          <img src={store.logoUrl} alt={brandName}
            className="mx-auto mb-4 h-24 w-24 rounded-full object-cover shadow-lg ring-4"
            style={{ boxShadow: `0 8px 30px ${theme.primary}33`, ["--tw-ring-color" as any]: `${theme.accent}66` }} />
        )}
        <h2 className="text-4xl font-bold tracking-tight" style={{ color: theme.primary }}>
          {brandName}
        </h2>
        {store.brandDescription && (
          <p className="mx-auto mt-3 max-w-2xl text-base" style={{ color: `${theme.primary}cc` }}>
            {store.brandDescription}
          </p>
        )}
        <div className="mx-auto mt-4 h-1 w-16 rounded-full" style={{ background: theme.accent }} />
      </section>

      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-8 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <SideList
            store={store}
            theme={theme}
            onOpen={(kind, id) => setOpenDetail({ kind, id })}
          />
        </aside>

        <main className="min-w-0 space-y-6">
          <section>
            <h2 className="mb-4 text-2xl font-semibold" style={{ color: theme.primary }}>Products</h2>
            {store.products.length === 0 ? (
              <div className="rounded-2xl border border-border/60 bg-white/70 p-10 text-center text-sm text-muted-foreground shadow-card">
                No products published yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {store.products.map((p) => (
                  <ProductCard key={p.id} product={p} theme={theme} />
                ))}
              </div>
            )}
          </section>
        </main>
      </div>

      {openDetail && (
        <DetailModal
          store={store}
          selection={openDetail}
          onClose={() => setOpenDetail(null)}
        />
      )}
      {cartOpen && (
        <CartDrawer slug={slug} onClose={() => setCartOpen(false)} theme={theme} merchantId={store.merchantId ?? null} brandName={brandName} store={store} />
      )}

      <footer className="border-t bg-white/40 py-8" style={{ borderColor: `${theme.primary}22` }}>
        <p className="text-center text-xs" style={{ color: `${theme.primary}99` }}>
          © {new Date().getFullYear()} {brandName}
        </p>
      </footer>
    </div>
  );
}

function SideList({
  store, onOpen, theme: _theme,
}: {
  store: StorefrontData;
  onOpen: (kind: "policy" | "contact" | "shipping", id: string) => void;
  theme?: any;
}) {
  const polGroups = groupBy(store.policies, (p) => p.kind || "other");
  const contactGroups = groupBy(store.contacts, (c) => c.kind || "other");
  const hasShipping = store.shipping.length > 0;
  const hasAnything = store.policies.length + store.contacts.length + store.shipping.length > 0;

  if (!hasAnything) {
    return <div className="rounded-2xl border border-border/60 bg-background/80 p-4 text-xs text-muted-foreground shadow-card backdrop-blur">No info published yet.</div>;
  }
  return (
    <nav className="space-y-4 text-sm">
      {Object.keys(polGroups).length > 0 && (
        <div className="rounded-2xl border border-border/60 bg-background/80 p-4 shadow-card backdrop-blur">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <ScrollText className="h-3.5 w-3.5" /> Policies
          </div>
          <ul className="space-y-1">
            {Object.entries(polGroups).map(([kind, items]) => (
              <li key={kind}>
                <div className="text-xs text-muted-foreground">{kind}</div>
                <ul className="ml-2 space-y-0.5">
                  {items.map((it) => (
                    <li key={it.id}>
                      <button onClick={() => onOpen("policy", it.id)} className="block w-full rounded-md px-2 py-1 text-right transition hover:bg-muted/50 hover:text-primary">
                        {it.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
      {Object.keys(contactGroups).length > 0 && (
        <div className="rounded-2xl border border-border/60 bg-background/80 p-4 shadow-card backdrop-blur">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <PhoneCall className="h-3.5 w-3.5" /> Contact
          </div>
          <ul className="space-y-1">
            {Object.entries(contactGroups).map(([kind, items]) => (
              <li key={kind}>
                <div className="text-xs text-muted-foreground">{kind}</div>
                <ul className="ml-2 space-y-0.5">
                  {items.map((it) => (
                    <li key={it.id}>
                      <button onClick={() => onOpen("contact", it.id)} className="block w-full rounded-md px-2 py-1 text-right transition hover:bg-muted/50 hover:text-primary">
                        {it.label || it.value}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasShipping && (
        <div className="rounded-2xl border border-border/60 bg-background/80 p-4 shadow-card backdrop-blur">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Truck className="h-3.5 w-3.5" /> Shipping
          </div>
          <ul className="space-y-0.5">
            {store.shipping.map((s) => (
              <li key={s.id}>
                <button onClick={() => onOpen("shipping", s.id)} className="block w-full rounded-md px-2 py-1 text-right transition hover:bg-muted/50 hover:text-primary">
                  {[s.country, s.region].filter(Boolean).join(" / ") || "Shipping"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
}

function groupBy<T, K extends string>(items: T[], k: (t: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const it of items) {
    const key = k(it);
    (out[key] ||= []).push(it);
  }
  return out;
}

interface VariantLike { color: string | null; size: string | null; stock?: number | null; price?: number | null }

function variantKey(color: string | null, size: string | null) {
  return `${color ?? ""}|${size ?? ""}`;
}

function ProductCard({ product, theme }: { product: StorefrontData["products"][number]; theme?: any }) {
  const cart = useCart();
  const variants: VariantLike[] = Array.isArray(product.variants) ? product.variants : [];
  // Stock is only meaningful when the merchant tracks it for this product.
  const anyStockInfo = variants.some((v) => v && typeof v.stock === "number");
  const inStock = variants.filter((v) => !anyStockInfo || (typeof v?.stock === "number" && (v.stock ?? 0) > 0));
  const availableColors = Array.from(new Set(inStock.map((v) => v?.color).filter((c): c is string => !!c)));
  const [color, setColor] = useState<string | null>(availableColors[0] ?? null);
  const sizesForColor = Array.from(new Set(
    inStock
      .filter((v) => (color ? v.color === color : true))
      .map((v) => v?.size)
      .filter((s): s is string => !!s),
  ));
  const [size, setSize] = useState<string | null>(sizesForColor[0] ?? null);
  const sizeIsValid = size && sizesForColor.includes(size);
  const effectiveSize = sizeIsValid ? size : (sizesForColor[0] ?? null);

  // Real availability for the exact selected variant (color + size).
  const stockByVariant = new Map<string, number>();
  for (const v of variants) {
    if (!v) continue;
    if (typeof v.stock !== "number") continue;
    const k = variantKey(v.color ?? null, v.size ?? null);
    stockByVariant.set(k, (stockByVariant.get(k) ?? 0) + Math.max(v.stock, 0));
  }
  const selectedStock = anyStockInfo
    ? (stockByVariant.get(variantKey(color, effectiveSize)) ?? 0)
    : null;
  const selectedVariant = variants.find(
    (v) => (v?.color ?? null) === color && (v?.size ?? null) === effectiveSize,
  );
  const unitPrice =
    typeof selectedVariant?.price === "number" ? selectedVariant.price : product.price;

  const [qty, setQty] = useState(1);
  const maxQty = selectedStock == null ? 99 : Math.max(selectedStock, 0);
  const clampedQty = Math.min(Math.max(qty, 1), Math.max(maxQty, 1));

  const img = product.images[0];
  const primary = theme?.primary ?? "hsl(var(--primary))";
  const accent = theme?.accent ?? primary;
  const outOfStock = anyStockInfo && (inStock.length === 0 || (selectedStock ?? 0) <= 0);
  return (
    <article
      className="group flex flex-col overflow-hidden rounded-2xl border bg-white shadow-card transition duration-300 hover:-translate-y-1 hover:shadow-glow"
      style={{ borderColor: `${primary}22` }}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
        {img ? (
          <img src={img} alt={product.name} className="h-full w-full object-cover transition group-hover:scale-105" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
        ) : (
          <div className="grid h-full place-items-center" style={{ background: `${primary}0a` }}>
            <ShoppingBag className="h-10 w-10" style={{ color: `${primary}55` }} />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-base font-semibold leading-tight" style={{ color: primary }}>{product.name}</h3>
          {unitPrice != null && (
            <span className="shrink-0 rounded-full px-2 py-0.5 text-sm font-semibold text-white" style={{ background: accent }}>
              {unitPrice} {product.currency ?? ""}
            </span>
          )}
        </div>
        {product.category && (
          <div className="text-xs text-muted-foreground">{product.category}</div>
        )}
        {product.description && (
          <p className="line-clamp-2 text-sm text-muted-foreground">{product.description}</p>
        )}
        {(availableColors.length > 0 || sizesForColor.length > 0) && (
          <div className="flex flex-wrap gap-2 pt-1">
            {availableColors.length > 0 && (
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <span>اللون</span>
                <select
                  value={color ?? ""}
                  onChange={(e) => { setColor(e.target.value || null); setQty(1); }}
                  className="rounded-md border bg-background px-2 py-1 text-xs"
                  style={{ borderColor: `${primary}44` }}
                >
                  {availableColors.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            )}
            {sizesForColor.length > 0 && (
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <span>المقاس</span>
                <select
                  value={effectiveSize ?? ""}
                  onChange={(e) => { setSize(e.target.value || null); setQty(1); }}
                  className="rounded-md border bg-background px-2 py-1 text-xs"
                  style={{ borderColor: `${primary}44` }}
                >
                  {sizesForColor.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            )}
          </div>
        )}
        {selectedStock != null && (
          <div className="text-xs" style={{ color: selectedStock > 0 ? `${primary}aa` : "hsl(var(--destructive))" }}>
            {selectedStock > 0 ? `المتاح حالياً: ${selectedStock}` : "غير متوفر حالياً"}
          </div>
        )}
        <div className="mt-auto flex items-center gap-2 pt-2">
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>الكمية</span>
            <Input
              type="number"
              min={1}
              max={maxQty}
              value={clampedQty}
              onChange={(e) => setQty(Number(e.target.value) || 1)}
              className="h-9 w-16"
              disabled={outOfStock}
            />
          </label>
          <Button
            size="sm"
            className="flex-1 text-white"
            style={{ background: primary }}
            disabled={outOfStock}
            onClick={() => {
              cart.add({
                productId: product.id, name: product.name,
                price: unitPrice, currency: product.currency, image: img ?? null,
                color, size: effectiveSize, quantity: clampedQty,
              });
              toast.success("تمت الإضافة إلى السلة");
            }}
          >
            <ShoppingCart className="ml-1 h-4 w-4" /> {outOfStock ? "غير متوفر" : "أضف إلى السلة"}
          </Button>
        </div>
      </div>
    </article>
  );
}


function DetailModal({
  store, selection, onClose,
}: {
  store: StorefrontData;
  selection: { kind: "policy" | "contact" | "shipping"; id: string };
  onClose: () => void;
}) {
  const item = useMemo(() => {
    if (selection.kind === "policy") return store.policies.find((p) => p.id === selection.id);
    if (selection.kind === "contact") return store.contacts.find((c) => c.id === selection.id);
    return store.shipping.find((s) => s.id === selection.id);
  }, [store, selection]);
  if (!item) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-border/60 bg-background p-6 shadow-elegant" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold">
            {selection.kind === "policy" && (item as any).title}
            {selection.kind === "contact" && ((item as any).label || (item as any).kind)}
            {selection.kind === "shipping" && [(item as any).country, (item as any).region].filter(Boolean).join(" / ")}
          </h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        {selection.kind === "policy" && (
          <p className="whitespace-pre-wrap text-sm">{(item as any).content}</p>
        )}
        {selection.kind === "contact" && (
          <p className="text-sm"><span className="text-muted-foreground">{(item as any).kind}:</span> <span className="font-medium">{(item as any).value}</span></p>
        )}
        {selection.kind === "shipping" && (
          <div className="space-y-1 text-sm">
            <div><span className="text-muted-foreground">Price: </span>{(item as any).price ?? "—"} {(item as any).currency ?? ""}</div>
            <div><span className="text-muted-foreground">ETA: </span>{(item as any).eta ?? "—"}</div>
            {(item as any).notes && <div className="text-muted-foreground">{(item as any).notes}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

type CheckoutStep = "cart" | "shipping" | "payment" | "summary" | "done";

/**
 * Same persistent visitor id the chat page uses (httpOnly cookie backed, with a
 * localStorage fallback), so a manual-payment order lands in the conversation
 * the customer already has with the agent.
 */
const VISITOR_KEY = (slug: string) => `cupai_visitor_${slug}`;

async function resolveVisitorId(slug: string): Promise<string | null> {
  let local: string | null = null;
  try { local = window.localStorage.getItem(VISITOR_KEY(slug)); } catch { /* ignore */ }
  try {
    const url = local ? `/api/visitor?fallback=${encodeURIComponent(local)}` : "/api/visitor";
    const res = await fetch(url, { method: "GET", credentials: "same-origin" });
    if (res.ok) {
      const j = (await res.json()) as { visitor_id?: string };
      if (j.visitor_id) {
        try { window.localStorage.setItem(VISITOR_KEY(slug), j.visitor_id); } catch { /* ignore */ }
        return j.visitor_id;
      }
    }
  } catch { /* offline is fine */ }
  return local;
}


function CartDrawer({
  slug, onClose, theme: _theme, merchantId, brandName, store,
}: {
  slug: string;
  onClose: () => void;
  theme?: any;
  merchantId?: string | null;
  brandName?: string;
  store: StorefrontData;
}) {
  const cart = useCart();
  const [step, setStep] = useState<CheckoutStep>("cart");
  const [name, setName] = useState(""); const [phone, setPhone] = useState("");
  const [address, setAddress] = useState(""); const [notes, setNotes] = useState("");
  const [shippingId, setShippingId] = useState<string | null>(store.shipping[0]?.id ?? null);
  const [paymentName, setPaymentName] = useState<string | null>(store.paymentMethods[0]?.name ?? null);
  const [shortages, setShortages] = useState<Array<Record<string, any>>>([]);
  const [receipt, setReceipt] = useState<{
    orderNumber: string; total: number; currency: string | null; message: string;
    requiresPayment: boolean; paymentMethod: string | null;
    lines: Array<{ name: string; color: string | null; size: string | null; quantity: number; price: number | null; currency: string | null }>;
    shippingLabel: string | null; shippingPrice: number; subtotal: number;
  } | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const shippingRow = store.shipping.find((s) => s.id === shippingId) ?? null;
  const shippingPrice = Number(shippingRow?.price ?? 0) || 0;
  const currency = cart.currency ?? shippingRow?.currency ?? null;
  const subtotal = cart.total;
  const total = subtotal + shippingPrice;
  const chosenMethod = store.paymentMethods.find((m) => m.name === paymentName) ?? null;
  const manualChosen = chosenMethod?.behavior === "manual";

  const mut = useMutation({
    mutationFn: async () => {
      const visitorId = await resolveVisitorId(slug);
      return createStorefrontOrder({
        data: {
          slug,
          items: cart.lines.map((l) => ({
            productId: l.productId, name: l.name, price: l.price,
            currency: l.currency, quantity: l.quantity,
            color: l.color ?? null, size: l.size ?? null,
          })),
          customer_name: name, customer_phone: phone,
          customer_address: address, notes,
          shipping_rate_id: shippingId,
          payment_method: paymentName,
          visitor_id: visitorId,
        },
      });
    },
    onSuccess: (res) => {
      if (res.ok === false) {
        if (res.error === "login_required") {
          toast.error("لازم تسجّل الدخول بالإيميل الأول عشان نقدر ننشئ الأوردر.");
          return;
        }
        // Server rejected on the LATEST stock — nothing was saved.
        setShortages(res.shortages ?? []);
        toast.error("الكمية المطلوبة غير متاحة حالياً.");
        return;
      }

      setShortages([]);
      setReceipt({
        orderNumber: res.orderNumber,
        total: res.total,
        currency: res.currency,
        message: res.confirmationMessage,
        requiresPayment: res.requiresPayment,
        paymentMethod: res.paymentMethod,
        lines: cart.lines.map((l) => ({
          name: l.name, color: l.color ?? null, size: l.size ?? null,
          quantity: l.quantity, price: l.price, currency: l.currency,
        })),
        shippingLabel: shippingRow
          ? [shippingRow.country, shippingRow.region].filter(Boolean).join(" / ") || "الشحن"
          : null,
        shippingPrice,
        subtotal,
      });
      setShowDetails(false);
      cart.clear();
      setStep("done");
    },
    onError: () => {
      toast.error("تعذّر إنشاء الأوردر. الرجاء المحاولة مرة أخرى.");
    },
  });

  /**
   * Availability pre-check, run the moment the customer leaves the cart step.
   * Telling them here that the quantity is not available avoids the old
   * behaviour of filling in every detail only to be rejected at the end.
   */
  const stockCheck = useMutation({
    mutationFn: async () =>
      checkStorefrontStock({
        data: {
          slug,
          items: cart.lines.map((l) => ({
            productId: l.productId, name: l.name, price: l.price,
            currency: l.currency, quantity: l.quantity,
            color: l.color ?? null, size: l.size ?? null,
          })),
        },
      }),
    onSuccess: (res) => {
      if (res.ok === false) {
        setShortages(res.shortages ?? []);
        toast.error("الكمية المطلوبة أكبر من المتاح في المخزون.");
        return;
      }
      setShortages([]);
      setStep("shipping");
    },
    onError: () => setStep("shipping"),
  });

  const canSubmit = Boolean(
    name.trim() && phone.trim() && address.trim() &&
    (store.shipping.length === 0 || shippingId) &&
    (store.paymentMethods.length === 0 || paymentName),
  );


  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose} dir="rtl">
      <div className="flex-1 bg-black/40" />
      <div className="flex h-full w-full max-w-md flex-col bg-background shadow-elegant" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-4">
          <h3 className="text-lg font-semibold">
            {step === "cart" && "سلة الشراء"}
            {step === "shipping" && "منطقة الشحن"}
            {step === "payment" && "طريقة الدفع"}
            {step === "summary" && "ملخص الأوردر"}
            {step === "done" && (receipt?.requiresPayment ? "بانتظار إتمام الدفع" : "تم تأكيد الأوردر")}
          </h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {step === "done" && receipt && (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                <div className="font-semibold">
                  {receipt.requiresPayment ? "تم تسجيل الأوردر — فاضل إتمام الدفع" : "تم إنشاء الأوردر بنجاح ✅"}
                </div>
                <div className="mt-1">رقم الأوردر: <span className="font-mono">{receipt.orderNumber}</span></div>
                <div className="mt-1">الإجمالي: {receipt.total} {receipt.currency ?? ""}</div>
              </div>

              {receipt.requiresPayment ? (
                <>
                  <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                    لن يُعتبر الأوردر مدفوعاً قبل تأكيد الدفع
                    {receipt.paymentMethod ? ` عبر ${receipt.paymentMethod}` : ""}.
                  </p>
                  <a
                    href={`/chat/${slug}`}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary font-semibold text-primary-foreground"
                  >
                    <MessageSquare className="h-4 w-4" /> التوجه لإتمام الدفع
                  </a>
                  <Button variant="outline" className="w-full" onClick={() => setShowDetails((v) => !v)}>
                    {showDetails ? "إخفاء تفاصيل الأوردر" : "الرجوع لرؤية تفاصيل الأوردر"}
                  </Button>
                </>
              ) : (
                receipt.message && (
                  <p className="whitespace-pre-wrap rounded-lg border p-3 text-muted-foreground">{receipt.message}</p>
                )
              )}

              {(showDetails || !receipt.requiresPayment) && (
                <div className="space-y-2 rounded-lg border p-3">
                  <ul className="space-y-1">
                    {receipt.lines.map((l, i) => (
                      <li key={i} className="flex justify-between gap-2">
                        <span className="min-w-0">
                          <span className="font-medium">{l.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {[l.color, l.size].filter(Boolean).join(" · ")} × {l.quantity}
                          </span>
                        </span>
                        <span>{((l.price ?? 0) * l.quantity).toFixed(2)} {l.currency ?? ""}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex justify-between border-t pt-1"><span className="text-muted-foreground">إجمالي المنتجات</span><span>{receipt.subtotal.toFixed(2)} {receipt.currency ?? ""}</span></div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">الشحن {receipt.shippingLabel ? `(${receipt.shippingLabel})` : ""}</span>
                    <span>{receipt.shippingPrice.toFixed(2)} {receipt.currency ?? ""}</span>
                  </div>
                  {receipt.paymentMethod && (
                    <div className="flex justify-between"><span className="text-muted-foreground">طريقة الدفع</span><span>{receipt.paymentMethod}</span></div>
                  )}
                  <div className="flex justify-between border-t pt-1 font-semibold">
                    <span>الإجمالي النهائي</span><span>{receipt.total.toFixed(2)} {receipt.currency ?? ""}</span>
                  </div>
                </div>
              )}
            </div>
          )}


          {step === "cart" && (
            cart.lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">السلة فارغة.</p>
            ) : (
              <ul className="space-y-3">
                {cart.lines.map((l) => (
                  <li key={`${l.productId}-${l.color ?? ""}-${l.size ?? ""}`} className="flex items-center gap-3 rounded-lg border p-2">
                    {l.image && <img src={l.image} alt="" className="h-12 w-12 rounded object-cover" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{l.name}</div>
                      {(l.color || l.size) && (
                        <div className="text-xs text-muted-foreground">
                          {[l.color, l.size].filter(Boolean).join(" · ")}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground">{l.price ?? "—"} {l.currency ?? ""}</div>
                    </div>
                    <Input
                      type="number" min={1} value={l.quantity}
                      onChange={(e) => cart.setQty({ productId: l.productId, color: l.color, size: l.size }, Number(e.target.value) || 1)}
                      className="w-16"
                    />
                    <button onClick={() => cart.remove({ productId: l.productId, color: l.color, size: l.size })} className="rounded p-1 text-muted-foreground hover:text-destructive">
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}

          {step === "shipping" && (
            <div className="space-y-3 text-sm">
              {store.shipping.length === 0 ? (
                <p className="text-muted-foreground">لا توجد مناطق شحن محددة — سيتم التواصل معك لتحديد الشحن.</p>
              ) : (
                <ul className="space-y-2">
                  {store.shipping.map((s) => (
                    <li key={s.id}>
                      <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 ${shippingId === s.id ? "border-primary bg-primary/5" : ""}`}>
                        <input type="radio" name="shipping" checked={shippingId === s.id} onChange={() => setShippingId(s.id)} className="mt-1" />
                        <span className="flex-1">
                          <span className="font-medium">{[s.country, s.region].filter(Boolean).join(" / ") || "الشحن"}</span>
                          <span className="block text-xs text-muted-foreground">
                            {s.price != null ? `${s.price} ${s.currency ?? ""}` : "سعر الشحن غير محدد"}
                            {s.eta ? ` · ${s.eta}` : ""}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {step === "payment" && (
            <div className="space-y-3 text-sm">
              {store.paymentMethods.length === 0 ? (
                <p className="text-muted-foreground">لا توجد طرق دفع مفعّلة — سيتم التواصل معك للاتفاق على الدفع.</p>
              ) : (
                <ul className="space-y-2">
                  {store.paymentMethods.map((m) => (
                    <li key={m.id}>
                      <label className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 ${paymentName === m.name ? "border-primary bg-primary/5" : ""}`}>
                        <input type="radio" name="payment" checked={paymentName === m.name} onChange={() => setPaymentName(m.name)} />
                        <span className="font-medium">{m.name}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {step === "summary" && (
            <div className="space-y-4 text-sm">
              <ul className="space-y-2">
                {cart.lines.map((l) => (
                  <li key={`${l.productId}-${l.color ?? ""}-${l.size ?? ""}`} className="flex justify-between gap-2 border-b pb-1">
                    <span className="min-w-0">
                      <span className="font-medium">{l.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {[l.color, l.size].filter(Boolean).join(" · ")} × {l.quantity}
                      </span>
                    </span>
                    <span>{((l.price ?? 0) * l.quantity).toFixed(2)} {l.currency ?? ""}</span>
                  </li>
                ))}
              </ul>
              <div className="space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">إجمالي المنتجات</span><span>{subtotal.toFixed(2)} {currency ?? ""}</span></div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">الشحن {shippingRow ? `(${[shippingRow.country, shippingRow.region].filter(Boolean).join(" / ")})` : ""}</span>
                  <span>{shippingPrice.toFixed(2)} {currency ?? ""}</span>
                </div>
                <div className="flex justify-between border-t pt-1 text-base font-semibold">
                  <span>الإجمالي النهائي</span><span>{total.toFixed(2)} {currency ?? ""}</span>
                </div>
                {paymentName && (
                  <div className="flex justify-between pt-1"><span className="text-muted-foreground">طريقة الدفع</span><span>{paymentName}</span></div>
                )}
                {manualChosen && (
                  <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                    طريقة دفع يدوية: بعد تسجيل الأوردر هيتم تحويلك لإتمام الدفع، ولن يُعتبر الأوردر مدفوعاً قبل تأكيد الدفع.
                  </p>

                )}
              </div>

              {merchantId ? (
                <CustomerAuthGate merchantId={merchantId} brandName={brandName} themePrimary={_theme?.primary}>
                  <div className="space-y-2">
                    <div><Label className="text-xs">الاسم *</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                    <div><Label className="text-xs">رقم الهاتف *</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
                    <div><Label className="text-xs">العنوان *</Label><Input value={address} onChange={(e) => setAddress(e.target.value)} /></div>
                    <div><Label className="text-xs">ملاحظات</Label><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
                  </div>
                  {shortages.length > 0 && (
                    <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                      <div className="font-medium">الكميات التالية غير متاحة حالياً، ولم يتم حفظ الأوردر:</div>
                      <ul className="mt-1 space-y-0.5">
                        {shortages.map((s, i) => (
                          <li key={i}>
                            {[s.product_name, s.color, s.size].filter(Boolean).join(" · ")} — المطلوب {s.requested} / المتاح {s.available}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <Button className="mt-3 w-full" disabled={mut.isPending || !canSubmit} onClick={() => mut.mutate()}>
                    <Send className="ml-1 h-4 w-4" /> {mut.isPending ? "جارٍ إنشاء الأوردر…" : "تأكيد الأوردر"}
                  </Button>
                </CustomerAuthGate>
              ) : null}
            </div>
          )}
        </div>

        {step !== "done" && cart.lines.length > 0 && (
          <div className="space-y-3 border-t p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">الإجمالي</span>
              <span className="font-semibold">{total.toFixed(2)} {currency ?? ""}</span>
            </div>
            <div className="flex gap-2">
              {step !== "cart" && (
                <Button variant="outline" className="flex-1" onClick={() =>
                  setStep(step === "shipping" ? "cart" : step === "payment" ? "shipping" : "payment")
                }>
                  رجوع
                </Button>
              )}
              {step !== "summary" && (
                <Button className="flex-1" onClick={() => {
                  if (step === "cart") { stockCheck.mutate(); return; }
                  setStep(step === "shipping" ? "payment" : "summary");
                }} disabled={
                  (step === "cart" && stockCheck.isPending) ||
                  (step === "shipping" && store.shipping.length > 0 && !shippingId) ||
                  (step === "payment" && store.paymentMethods.length > 0 && !paymentName)
                }>
                  {step === "cart" ? (stockCheck.isPending ? "جارٍ التحقق من المخزون…" : "إنشاء الأوردر") : "التالي"}
                </Button>

              )}
            </div>
          </div>
        )}
        {step === "done" && (
          <div className="border-t p-4">
            <Button className="w-full" onClick={onClose}>إغلاق</Button>
          </div>
        )}
      </div>
    </div>
  );
}

