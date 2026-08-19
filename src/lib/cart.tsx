import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export interface CartLine {
  productId: string;
  name: string;
  price: number | null;
  currency: string | null;
  quantity: number;
  image?: string | null;
  color?: string | null;
  size?: string | null;
}

export interface CartLineKey {
  productId: string;
  color?: string | null;
  size?: string | null;
}

interface CartCtx {
  lines: CartLine[];
  add: (line: Omit<CartLine, "quantity"> & { quantity?: number }) => void;
  remove: (key: CartLineKey) => void;
  setQty: (key: CartLineKey, qty: number) => void;
  clear: () => void;
  total: number;
  currency: string | null;
  count: number;
}

export function cartLineId(l: CartLineKey): string {
  return `${l.productId}::${l.color ?? ""}::${l.size ?? ""}`;
}

const Ctx = createContext<CartCtx | null>(null);

function storageKey(slug: string) { return `cupai_cart_${slug}`; }

export function CartProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(storageKey(slug));
      if (raw) setLines(JSON.parse(raw) as CartLine[]);
    } catch { /* ignore */ }
  }, [slug]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(storageKey(slug), JSON.stringify(lines)); }
    catch { /* ignore */ }
  }, [slug, lines]);

  const api = useMemo<CartCtx>(() => {
    const total = lines.reduce((n, l) => n + Number(l.price ?? 0) * l.quantity, 0);
    const currency = lines.find((l) => l.currency)?.currency ?? null;
    const count = lines.reduce((n, l) => n + l.quantity, 0);
    return {
      lines, total, currency, count,
      add: (line) => setLines((prev) => {
        const q = line.quantity ?? 1;
        const idx = prev.findIndex(
          (p) =>
            p.productId === line.productId &&
            (p.color ?? null) === (line.color ?? null) &&
            (p.size ?? null) === (line.size ?? null),
        );
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], quantity: next[idx].quantity + q };
          return next;
        }
        return [...prev, { ...line, quantity: q }];
      }),
      remove: (key) => setLines((prev) => prev.filter((l) => cartLineId(l) !== cartLineId(key))),
      setQty: (key, qty) => setLines((prev) =>
        prev.map((l) => cartLineId(l) === cartLineId(key) ? { ...l, quantity: Math.max(1, qty) } : l)),
      clear: () => setLines([]),
    };
  }, [lines]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart must be inside CartProvider");
  return c;
}