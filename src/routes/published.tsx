import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Globe, Plus, Trash2, Pencil, Upload, X,
  Copy, ExternalLink, Save, Info, ShoppingBag, ScrollText, Truck, PhoneCall, Sparkles, Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { IdentitySection } from "@/components/website/identity-section";
import { PageShell, PageHero, SurfaceCard } from "@/components/layout/page-shell";

import {
  getSiteState, createWebsite, publishSite, unpublishSite,
  type SiteState,
} from "@/lib/website.functions";
import {
  listWebsiteProducts, upsertWebsiteProduct, deleteWebsiteProduct,
  uploadProductImage, deleteProductImage, setProductPublished,
  analyzeProductImage,
  type WebsiteProductDTO,
} from "@/lib/website-products.functions";
import {
  listPolicies, upsertPolicy, deletePolicy,
  listShippingRates, upsertShippingRate, deleteShippingRate,
  listContactInfo, upsertContactInfo, deleteContactInfo,
} from "@/lib/content.functions";

export const Route = createFileRoute("/published")({
  head: () => ({ meta: [{ title: "Website Management · cupai" }] }),
  component: PublishedPage,
});

const INFO_MSG =
  "Everything you add here will be automatically published on your website, and you can unpublish any item later from that section's settings.";

function PublishedPage() {
  const qc = useQueryClient();
  const site = useQuery({ queryKey: ["site-state"], queryFn: () => getSiteState() });

  const [brandName, setBrandName] = useState("");
  const createMut = useMutation({
    mutationFn: (v: { brand_name: string }) => createWebsite({ data: v }),
    onSuccess: () => {
      toast.success("Website created.");
      qc.invalidateQueries({ queryKey: ["site-state"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed."),
  });

  return (
    <PageShell dir="ltr">
      <PageHero
        eyebrow="Website Management"
        icon={<Globe className="h-3.5 w-3.5" />}
        title="Your"
        highlight="storefront"
        description="Everything you add here is published on your live store. Manage identity, products, policies, shipping, and contacts in one place."
      />

      <IdentitySection state={site.data} />

      <div className="flex items-start gap-2 rounded-2xl border border-primary/30 bg-primary/5 p-4 text-sm text-primary">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>{INFO_MSG}</p>
      </div>

      {site.isLoading && (
        <SurfaceCard className="p-6 text-center text-sm text-muted-foreground">Loading…</SurfaceCard>
      )}
      {site.data && !site.data.site_created && (
        <SurfaceCard className="p-10 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-brand text-primary-foreground shadow-glow">
            <ShoppingBag className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-lg font-semibold">No website yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Give your brand a name and create your storefront to get started.
          </p>
          <div className="mx-auto mt-6 flex max-w-sm flex-col gap-2">
            <Input
              placeholder="Brand name (e.g. Cup Coffee)"
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
            />
            <Button
              size="lg"
              className="bg-gradient-brand text-primary-foreground shadow-glow"
              disabled={createMut.isPending || brandName.trim().length < 2}
              onClick={() => createMut.mutate({ brand_name: brandName.trim() })}
            >
              <Plus className="mr-2 h-4 w-4" />
              Create Website
            </Button>
          </div>
        </SurfaceCard>
      )}

      {site.data?.site_created && <ManagementBoard state={site.data} />}
    </PageShell>
  );
}

// ---------------------------------------------------------------------------
// Board (visible only after Create Website)
// ---------------------------------------------------------------------------
function ManagementBoard({ state }: { state: SiteState }) {
  const qc = useQueryClient();
  const publicPath = state.brand_slug ? `/c/${state.brand_slug}` : null;
  const publicUrl = publicPath
    ? `${typeof window !== "undefined" ? window.location.origin : ""}${publicPath}`
    : null;

  const publishMut = useMutation({
    mutationFn: () => publishSite({}),
    onSuccess: () => { toast.success("Website published."); qc.invalidateQueries({ queryKey: ["site-state"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed."),
  });
  const unpublishMut = useMutation({
    mutationFn: () => unpublishSite({}),
    onSuccess: () => { toast.success("Website unpublished."); qc.invalidateQueries({ queryKey: ["site-state"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed."),
  });

  return (
    <div className="space-y-6">
      {/* Publish / URL card */}
      <SurfaceCard className="relative">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-brand opacity-[0.06]" />
        <div className="p-5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:flex-wrap sm:justify-between">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Brand</div>
              <div className="mt-0.5 truncate text-xl font-semibold">{state.brand_name}</div>
              <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
                  state.site_status === "published"
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : state.site_status === "unpublished"
                    ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                    : "bg-muted text-muted-foreground"
                }`}>
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {state.site_status}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {state.site_status !== "published" ? (
                <Button onClick={() => publishMut.mutate()} disabled={publishMut.isPending} className="bg-gradient-brand text-primary-foreground shadow-glow">
                  <Globe className="mr-2 h-4 w-4" />Publish
                </Button>
              ) : (
                <Button variant="outline" onClick={() => unpublishMut.mutate()} disabled={unpublishMut.isPending}>
                  Unpublish
                </Button>
              )}
            </div>
          </div>

          {state.site_status === "published" && publicUrl && (
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-muted/30 p-3">
              <code className="min-w-0 flex-1 truncate text-sm">{publicUrl}</code>
              <Button size="sm" variant="secondary" onClick={() => {
                navigator.clipboard?.writeText(publicUrl); toast.success("Link copied.");
              }}>
                <Copy className="mr-1 h-3.5 w-3.5" />Copy Link
              </Button>
              <Button size="sm" asChild className="bg-gradient-brand text-primary-foreground shadow-glow">
                <a href={publicPath!} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-1 h-3.5 w-3.5" />View
                </a>
              </Button>
            </div>
          )}
        </div>
      </SurfaceCard>

      {/* Products are managed from the Inventory page (/products), not here. */}
      <PoliciesSection />
      <ShippingSection />
      <ContactsSection />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PRODUCTS section (table, per-row edit, image upload, sizes/colors)
// ---------------------------------------------------------------------------
function ProductsSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["website-products"], queryFn: () => listWebsiteProducts() });
  const [editing, setEditing] = useState<WebsiteProductDTO | "new" | null>(null);

  const delMut = useMutation({
    mutationFn: (id: string) => deleteWebsiteProduct({ data: { id } }),
    onSuccess: () => { toast.success("Product deleted."); qc.invalidateQueries({ queryKey: ["website-products"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed."),
  });
  const pubMut = useMutation({
    mutationFn: (v: { id: string; is_published: boolean }) =>
      setProductPublished({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["website-products"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed."),
  });

  return (
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-background/80 shadow-elegant backdrop-blur-xl">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-muted/30 px-5 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold"><span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-brand text-primary-foreground shadow-glow"><ShoppingBag className="h-4 w-4" /></span>Products
        </h2>
        <Button size="sm" className="bg-gradient-brand text-primary-foreground shadow-glow" onClick={() => setEditing("new")}><Plus className="mr-1 h-3.5 w-3.5" />Add Product
        </Button>
      </header>

      {q.isLoading ? (
        <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>
      ) : (q.data ?? []).length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">No products yet.</p>
      ) : (
        <>
        {/* Mobile: stacked cards (no horizontal scrolling) */}
        <ul className="divide-y divide-border/60 md:hidden">
          {(q.data ?? []).map((p) => {
            const img = p.images[0];
            return (
              <li key={p.id} className="p-4">
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
                  {img ? (
                    <img src={img.url} alt={p.name}
                      className="h-14 w-14 shrink-0 rounded-lg object-cover ring-1 ring-border/60 shadow-card" />
                  ) : (
                    <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-muted text-xs text-muted-foreground">—</div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    {p.description && (
                      <div className="line-clamp-2 text-xs text-muted-foreground">{p.description}</div>
                    )}
                    <div className="mt-1 text-xs text-muted-foreground">
                      {p.price != null ? `${p.price} ${p.currency ?? ""}` : "—"}
                    </div>
                    {(p.sizes.length > 0 || p.colors.length > 0) && (
                      <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {[p.sizes.map((s) => s.label).join(", "), p.colors.map((c) => c.label).join(", ")]
                          .filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant={p.is_published ? "secondary" : "default"}
                    className={p.is_published ? "" : "bg-gradient-brand text-primary-foreground shadow-glow"}
                    onClick={() => pubMut.mutate({ id: p.id, is_published: !p.is_published })}>
                    {p.is_published ? "Unpublish" : "Publish"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="outline"
                    onClick={() => { if (confirm(`Delete "${p.name}"?`)) delMut.mutate(p.id); }}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-sm">

            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Image</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Price</th>
                <th className="px-4 py-2">Sizes</th>
                <th className="px-4 py-2">Colors</th>
                <th className="px-4 py-2">Published</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(q.data ?? []).map((p) => {
                const img = p.images[0];
                return (
                  <tr key={p.id} className="transition hover:bg-muted/30">
                    <td className="px-4 py-3">
                      {img ? (
                        <img src={img.url} alt={p.name}
                          className="h-12 w-12 rounded-lg object-cover ring-1 ring-border/60 shadow-card" />
                      ) : (
                        <div className="grid h-12 w-12 place-items-center rounded bg-muted text-xs text-muted-foreground">—</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{p.name}</div>
                      {p.description && (
                        <div className="line-clamp-1 text-xs text-muted-foreground">{p.description}</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {p.price != null ? `${p.price} ${p.currency ?? ""}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {p.sizes.length > 0 ? p.sizes.map((s) => s.label).join(", ") : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {p.colors.length > 0 ? p.colors.map((c) => c.label).join(", ") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Button size="sm" variant={p.is_published ? "secondary" : "default"} className={p.is_published ? "" : "bg-gradient-brand text-primary-foreground shadow-glow"} onClick={() => pubMut.mutate({ id: p.id, is_published: !p.is_published })}>
                        {p.is_published ? "Unpublish" : "Publish"}
                      </Button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost"
                          onClick={() => { if (confirm(`Delete "${p.name}"?`)) delMut.mutate(p.id); }}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}


      {editing && (
        <ProductEditor
          initial={editing === "new" ? null : editing}
          onClose={(saved) => {
            setEditing(null);
            if (saved) qc.invalidateQueries({ queryKey: ["website-products"] });
          }}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Product Editor modal (name / desc / price / sizes / colors / images)
// ---------------------------------------------------------------------------
function ProductEditor({
  initial, onClose,
}: {
  initial: WebsiteProductDTO | null;
  onClose: (saved: boolean) => void;
}) {
  const qc = useQueryClient();
  const [productId, setProductId] = useState<string | null>(initial?.id ?? null);
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [price, setPrice] = useState<string>(initial?.price != null ? String(initial.price) : "");
  const [currency, setCurrency] = useState(initial?.currency ?? "EGP");
  const [sizes, setSizes] = useState<{ id?: string; label: string }[]>(
    initial?.sizes.map((s) => ({ id: s.id, label: s.label })) ?? [],
  );
  const [colors, setColors] = useState<{ id?: string; label: string; hex?: string | null }[]>(
    initial?.colors.map((c) => ({ id: c.id, label: c.label, hex: c.hex })) ?? [],
  );
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [attachTo, setAttachTo] = useState<{ kind: "none" | "color" | "size"; id: string }>({ kind: "none", id: "" });
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);

  const analyzeMut = useMutation({
    mutationFn: async (imageId: string) => {
      setAnalyzingId(imageId);
      try {
        return await analyzeProductImage({ data: { imageId } });
      } finally {
        setAnalyzingId(null);
      }
    },
    onSuccess: (s) => {
      let filled = 0;
      if (s.name)        { setName(s.name); filled++; }
      if (s.description) { setDescription(s.description); filled++; }
      if (s.price != null) { setPrice(String(s.price)); filled++; }
      if (s.currency)    { setCurrency(s.currency); filled++; }
      if (s.colors.length) {
        const existing = new Set(colors.map((c) => c.label.toLowerCase()));
        const add = s.colors
          .filter((l) => l && !existing.has(l.toLowerCase()))
          .map((label) => ({ label, hex: null }));
        if (add.length) { setColors([...colors, ...add]); filled++; }
      }
      if (s.sizes.length) {
        const existing = new Set(sizes.map((c) => c.label.toLowerCase()));
        const add = s.sizes
          .filter((l) => l && !existing.has(l.toLowerCase()))
          .map((label) => ({ label }));
        if (add.length) { setSizes([...sizes, ...add]); filled++; }
      }
      toast.success(filled > 0
        ? `Analyzed image — filled ${filled} field${filled === 1 ? "" : "s"}. Click Save to keep them.`
        : "Analysis complete — no new fields extracted.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Analysis failed."),
  });

  // Persist current form to the products table. Returns the id.
  async function persist(): Promise<string> {
    const res = await upsertWebsiteProduct({ data: {
      id: productId ?? undefined,
      name: name.trim(),
      description: description.trim() || null,
      price: price.trim() === "" ? null : Number(price),
      currency: currency.trim() || null,
      sizes, colors,
    } });
    if (!productId) setProductId(res.id);
    qc.invalidateQueries({ queryKey: ["website-products"] });
    return res.id;
  }

  const saveMut = useMutation({
    mutationFn: () => persist(),
    onSuccess: () => { toast.success("Product saved."); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed."),
  });

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      if (!name.trim()) throw new Error("Enter a product name first.");
      // Auto-save if this is a new product so we have an id to attach images to.
      const id = productId ?? await persist();
      const fd = new FormData();
      fd.append("file", file);
      fd.append("productId", id);
      if (attachTo.kind === "color") fd.append("colorId", attachTo.id);
      if (attachTo.kind === "size")  fd.append("sizeId",  attachTo.id);
      return uploadProductImage({ data: fd });
    },
    onSuccess: () => { toast.success("Image uploaded."); qc.invalidateQueries({ queryKey: ["website-products"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Upload failed."),
  });

  const delImgMut = useMutation({
    mutationFn: (imageId: string) => deleteProductImage({ data: { imageId } }),
    onSuccess: () => { toast.success("Image removed."); qc.invalidateQueries({ queryKey: ["website-products"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed."),
  });

  // Refetched images for the current product so uploads/deletes appear live.
  const imgQ = useQuery({
    queryKey: ["website-products"],
    queryFn: () => listWebsiteProducts(),
    enabled: Boolean(productId),
  });
  const liveProduct = imgQ.data?.find((p) => p.id === productId) ?? initial;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4 backdrop-blur-sm" onClick={() => onClose(false)}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-border/60 bg-background p-6 shadow-elegant"
           onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold">{initial ? "Edit product" : "Add product"}</h3>
          <button onClick={() => onClose(false)} className="rounded p-1 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label>Description</Label>
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <Label>Price</Label>
            <Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div>
            <Label>Currency</Label>
            <Input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="EGP" />
          </div>
        </div>

        <ChipEditor
          title="Sizes"
          items={sizes}
          onAdd={(label) => setSizes([...sizes, { label }])}
          onRemove={(i) => setSizes(sizes.filter((_, k) => k !== i))}
        />
        <ChipEditor
          title="Colors"
          items={colors.map((c) => ({ label: c.label + (c.hex ? ` (${c.hex})` : "") }))}
          onAdd={(label) => {
            const m = label.match(/^(.*?)\s*\((#[0-9a-fA-F]{3,8})\)\s*$/);
            if (m) setColors([...colors, { label: m[1].trim(), hex: m[2] }]);
            else setColors([...colors, { label, hex: null }]);
          }}
          onRemove={(i) => setColors(colors.filter((_, k) => k !== i))}
          hint="Format: name or 'name (#hex)'"
        />

        {/* Images */}
        <div className="mt-5 rounded-lg border p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">Images</div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Attach to:</span>
              <select
                className="rounded border bg-background px-2 py-1"
                value={attachTo.kind === "none" ? "none" : `${attachTo.kind}:${attachTo.id}`}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "none") setAttachTo({ kind: "none", id: "" });
                  else {
                    const [k, id] = v.split(":");
                    setAttachTo({ kind: k as "color" | "size", id });
                  }
                }}
              >
                <option value="none">All (default)</option>
                {(liveProduct?.colors ?? []).map((c) => (
                  <option key={`c:${c.id}`} value={`color:${c.id}`}>Color: {c.label}</option>
                ))}
                {(liveProduct?.sizes ?? []).map((s) => (
                  <option key={`s:${s.id}`} value={`size:${s.id}`}>Size: {s.label}</option>
                ))}
              </select>
              <label
                className={`inline-flex cursor-pointer items-center rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium shadow-sm transition hover:bg-accent hover:text-accent-foreground ${
                  (!name.trim() || uploadMut.isPending || saveMut.isPending) ? "pointer-events-none opacity-50" : ""
                }`}
              >
                <Upload className="mr-1 h-3.5 w-3.5" />
                {uploadMut.isPending ? "Uploading…" : "Upload"}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  disabled={!name.trim() || uploadMut.isPending || saveMut.isPending}
                  onChange={async (e) => {
                    const files = Array.from(e.target.files ?? []);
                    for (const f of files) {
                      try { await uploadMut.mutateAsync(f); } catch { /* toast handled */ }
                    }
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                />
              </label>
            </div>
          </div>
          {!name.trim() ? (
            <p className="text-xs text-muted-foreground">Enter a product name to enable image upload.</p>
          ) : (liveProduct?.images ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No images yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {(liveProduct!.images).map((img) => {
                const c = liveProduct!.colors.find((cc) => cc.id === img.color_id);
                const s = liveProduct!.sizes.find((ss) => ss.id === img.size_id);
                return (
                  <div key={img.id} className="group relative overflow-hidden rounded-lg border bg-background shadow-sm">
                    <div className="relative aspect-square">
                      <img src={img.url} alt="" className="h-full w-full object-cover" />
                      <button
                        onClick={() => { if (confirm("Remove this image?")) delImgMut.mutate(img.id); }}
                        className="absolute right-1 top-1 hidden rounded bg-black/60 p-1 text-white group-hover:block"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-1 border-t bg-muted/30 px-2 py-1.5 text-[11px]">
                      {c ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                          {c.hex && <span className="h-2.5 w-2.5 rounded-full border" style={{ background: c.hex }} />}
                          {c.label}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Default</span>
                      )}
                      {s && <span className="rounded-full bg-muted px-2 py-0.5">Size: {s.label}</span>}
                    </div>
                    <div className="border-t p-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        disabled={analyzingId === img.id}
                        onClick={() => analyzeMut.mutate(img.id)}
                      >
                        {analyzingId === img.id ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="mr-1 h-3.5 w-3.5" />
                        )}
                        Analyze Image
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || name.trim().length === 0} className="bg-gradient-brand text-primary-foreground shadow-glow">
            <Save className="mr-1 h-4 w-4" />Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function ChipEditor({
  title, items, onAdd, onRemove, hint,
}: {
  title: string;
  items: { label: string }[];
  onAdd: (label: string) => void;
  onRemove: (index: number) => void;
  hint?: string;
}) {
  const [v, setV] = useState("");
  return (
    <div className="mt-4">
      <Label>{title}</Label>
      <div className="mt-1 flex flex-wrap gap-2">
        {items.map((it, i) => (
          <span key={`${it.label}-${i}`} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-1 text-xs">
            {it.label}
            <button onClick={() => onRemove(i)} className="text-muted-foreground hover:text-destructive">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <Input value={v} onChange={(e) => setV(e.target.value)}
          placeholder={hint ?? `Add ${title.toLowerCase()}…`}
          onKeyDown={(e) => {
            if (e.key === "Enter" && v.trim()) { e.preventDefault(); onAdd(v.trim()); setV(""); }
          }}
        />
        <Button type="button" size="sm" variant="outline"
          onClick={() => { if (v.trim()) { onAdd(v.trim()); setV(""); } }}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// POLICIES
// ---------------------------------------------------------------------------
const POLICY_KINDS = ["shipping","return","terms","privacy","refund","warranty","other"] as const;

function PoliciesSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["policies"], queryFn: () => listPolicies() });
  const [editing, setEditing] = useState<{ id?: string; kind: string; title: string; content: string } | null>(null);
  const delMut = useMutation({
    mutationFn: (id: string) => deletePolicy({ data: { id } }),
    onSuccess: () => { toast.success("Deleted."); qc.invalidateQueries({ queryKey: ["policies"] }); },
  });
  const saveMut = useMutation({
    mutationFn: (v: { id?: string; kind: string; title: string; content: string }) =>
      upsertPolicy({ data: v }),
    onSuccess: () => { toast.success("Saved."); qc.invalidateQueries({ queryKey: ["policies"] }); setEditing(null); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed."),
  });

  return (
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-background/80 shadow-elegant backdrop-blur-xl">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-muted/30 px-5 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold"><span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-brand text-primary-foreground shadow-glow"><ScrollText className="h-4 w-4" /></span>Policies</h2>
        <Button size="sm" className="bg-gradient-brand text-primary-foreground shadow-glow" onClick={() => setEditing({ kind: "shipping", title: "", content: "" })}><Plus className="mr-1 h-3.5 w-3.5" />Add Policy
        </Button>
      </header>
      {q.isLoading ? <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>
       : (q.data ?? []).length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">No policies yet.</p>
       : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr><th className="px-4 py-2">Kind</th><th className="px-4 py-2">Title</th><th className="px-4 py-2">Content</th><th className="px-4 py-2 text-right">Actions</th></tr>
            </thead>
            <tbody className="divide-y">
              {(q.data ?? []).map((p) => (
                <tr key={p.id} className="transition hover:bg-muted/30">
                  <td className="px-4 py-3 text-xs uppercase text-muted-foreground">{p.kind}</td>
                  <td className="px-4 py-3 font-medium">{p.title}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground"><div className="line-clamp-2">{p.content}</div></td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Delete "${p.title}"?`)) delMut.mutate(p.id); }}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4 backdrop-blur-sm" onClick={() => setEditing(null)}>
          <div className="w-full max-w-lg rounded-2xl border border-border/60 bg-background p-6 shadow-elegant" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <h3 className="text-lg font-semibold">{editing.id ? "Edit policy" : "Add policy"}</h3>
              <button onClick={() => setEditing(null)}><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <Label>Kind</Label>
                <select className="mt-1 w-full rounded border bg-background px-2 py-2 text-sm"
                  value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value })}>
                  {POLICY_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div><Label>Title</Label><Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></div>
              <div><Label>Content</Label><Textarea rows={6} value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} /></div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={() => saveMut.mutate(editing)} disabled={saveMut.isPending || !editing.title.trim()} className="bg-gradient-brand text-primary-foreground shadow-glow">
                <Save className="mr-1 h-4 w-4" />Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// SHIPPING
// ---------------------------------------------------------------------------
function ShippingSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["shipping"], queryFn: () => listShippingRates() });
  const [editing, setEditing] = useState<{
    id?: string; country: string; region: string; price: string; currency: string; eta: string; notes: string;
  } | null>(null);
  const delMut = useMutation({
    mutationFn: (id: string) => deleteShippingRate({ data: { id } }),
    onSuccess: () => { toast.success("Deleted."); qc.invalidateQueries({ queryKey: ["shipping"] }); },
  });
  const saveMut = useMutation({
    mutationFn: (v: NonNullable<typeof editing>) => upsertShippingRate({ data: {
      id: v.id,
      country: v.country.trim() || null,
      region: v.region.trim() || null,
      price: v.price.trim() === "" ? null : Number(v.price),
      currency: v.currency.trim() || null,
      eta: v.eta.trim() || null,
      notes: v.notes.trim() || null,
    } }),
    onSuccess: () => { toast.success("Saved."); qc.invalidateQueries({ queryKey: ["shipping"] }); setEditing(null); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed."),
  });

  return (
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-background/80 shadow-elegant backdrop-blur-xl">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-muted/30 px-5 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold"><span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-brand text-primary-foreground shadow-glow"><Truck className="h-4 w-4" /></span>Shipping Tables</h2>
        <Button size="sm" className="bg-gradient-brand text-primary-foreground shadow-glow" onClick={() => setEditing({ country: "", region: "", price: "", currency: "EGP", eta: "", notes: "" })}><Plus className="mr-1 h-3.5 w-3.5" />Add Rate
        </Button>
      </header>
      {q.isLoading ? <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>
       : (q.data ?? []).length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">No shipping rates yet.</p>
       : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr><th className="px-4 py-2">Country</th><th className="px-4 py-2">Region</th><th className="px-4 py-2">Price</th><th className="px-4 py-2">ETA</th><th className="px-4 py-2">Notes</th><th className="px-4 py-2 text-right">Actions</th></tr>
            </thead>
            <tbody className="divide-y">
              {(q.data ?? []).map((s) => (
                <tr key={s.id} className="transition hover:bg-muted/30">
                  <td className="px-4 py-3">{s.country ?? "—"}</td>
                  <td className="px-4 py-3">{s.region ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3">{s.price != null ? `${s.price} ${s.currency ?? ""}` : "—"}</td>
                  <td className="px-4 py-3">{s.eta ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground"><div className="line-clamp-1">{s.notes ?? ""}</div></td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing({
                        id: s.id, country: s.country ?? "", region: s.region ?? "",
                        price: s.price != null ? String(s.price) : "",
                        currency: s.currency ?? "EGP", eta: s.eta ?? "", notes: s.notes ?? "",
                      })}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => { if (confirm("Delete this rate?")) delMut.mutate(s.id); }}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4 backdrop-blur-sm" onClick={() => setEditing(null)}>
          <div className="w-full max-w-lg rounded-2xl border border-border/60 bg-background p-6 shadow-elegant" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <h3 className="text-lg font-semibold">{editing.id ? "Edit rate" : "Add rate"}</h3>
              <button onClick={() => setEditing(null)}><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Country</Label><Input value={editing.country} onChange={(e) => setEditing({ ...editing, country: e.target.value })} /></div>
              <div><Label>Region</Label><Input value={editing.region} onChange={(e) => setEditing({ ...editing, region: e.target.value })} /></div>
              <div><Label>Price</Label><Input type="number" step="0.01" value={editing.price} onChange={(e) => setEditing({ ...editing, price: e.target.value })} /></div>
              <div><Label>Currency</Label><Input value={editing.currency} onChange={(e) => setEditing({ ...editing, currency: e.target.value })} /></div>
              <div className="col-span-2"><Label>ETA</Label><Input value={editing.eta} onChange={(e) => setEditing({ ...editing, eta: e.target.value })} placeholder="3-5 days" /></div>
              <div className="col-span-2"><Label>Notes</Label><Textarea rows={2} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={() => saveMut.mutate(editing)} disabled={saveMut.isPending} className="bg-gradient-brand text-primary-foreground shadow-glow">
                <Save className="mr-1 h-4 w-4" />Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// CONTACTS
// ---------------------------------------------------------------------------
const CONTACT_KINDS = ["phone","email","address","whatsapp","instagram","facebook","tiktok","twitter","snapchat","telegram","website","other"] as const;

function ContactsSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["contacts"], queryFn: () => listContactInfo() });
  const [editing, setEditing] = useState<{ id?: string; kind: string; label: string; value: string } | null>(null);
  const delMut = useMutation({
    mutationFn: (id: string) => deleteContactInfo({ data: { id } }),
    onSuccess: () => { toast.success("Deleted."); qc.invalidateQueries({ queryKey: ["contacts"] }); },
  });
  const saveMut = useMutation({
    mutationFn: (v: NonNullable<typeof editing>) => upsertContactInfo({ data: {
      id: v.id, kind: v.kind, label: v.label.trim() || null, value: v.value.trim(),
    } }),
    onSuccess: () => { toast.success("Saved."); qc.invalidateQueries({ queryKey: ["contacts"] }); setEditing(null); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed."),
  });

  return (
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-background/80 shadow-elegant backdrop-blur-xl">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-muted/30 px-5 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold"><span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-brand text-primary-foreground shadow-glow"><PhoneCall className="h-4 w-4" /></span>Contact Information</h2>
        <Button size="sm" className="bg-gradient-brand text-primary-foreground shadow-glow" onClick={() => setEditing({ kind: "phone", label: "", value: "" })}><Plus className="mr-1 h-3.5 w-3.5" />Add Contact
        </Button>
      </header>
      {q.isLoading ? <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>
       : (q.data ?? []).length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">No contact info yet.</p>
       : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr><th className="px-4 py-2">Kind</th><th className="px-4 py-2">Label</th><th className="px-4 py-2">Value</th><th className="px-4 py-2 text-right">Actions</th></tr>
            </thead>
            <tbody className="divide-y">
              {(q.data ?? []).map((c) => (
                <tr key={c.id} className="transition hover:bg-muted/30">
                  <td className="px-4 py-3 text-xs uppercase text-muted-foreground">{c.kind}</td>
                  <td className="px-4 py-3">{c.label ?? "—"}</td>
                  <td className="px-4 py-3 font-medium">{c.value}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing({ id: c.id, kind: c.kind, label: c.label ?? "", value: c.value })}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { if (confirm("Delete this contact?")) delMut.mutate(c.id); }}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4 backdrop-blur-sm" onClick={() => setEditing(null)}>
          <div className="w-full max-w-lg rounded-2xl border border-border/60 bg-background p-6 shadow-elegant" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <h3 className="text-lg font-semibold">{editing.id ? "Edit contact" : "Add contact"}</h3>
              <button onClick={() => setEditing(null)}><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <Label>Kind</Label>
                <select className="mt-1 w-full rounded border bg-background px-2 py-2 text-sm"
                  value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value })}>
                  {CONTACT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div><Label>Label (optional)</Label><Input value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} /></div>
              <div><Label>Value *</Label><Input value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} /></div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={() => saveMut.mutate(editing)} disabled={saveMut.isPending || !editing.value.trim()} className="bg-gradient-brand text-primary-foreground shadow-glow">
                <Save className="mr-1 h-4 w-4" />Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
