import { Fragment, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Package, ChevronDown, ChevronUp, Sparkles, Plus, Trash2, Loader2, ImageOff, ImagePlus, X, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { PageShell, PageHero, SurfaceCard } from "@/components/layout/page-shell";
import {
  listWebsiteProducts, setProductPublished, retryProductDescription, uploadProductImage,
  upsertWebsiteProduct, deleteWebsiteProduct, deleteProductImage, analyzeProductImage,
  analyzeProductImageFile,
  type WebsiteProductDTO,
} from "@/lib/website-products.functions";
import { createManualProduct, type ManualVariantInput } from "@/lib/inventory.functions";
import { requireQuantity } from "@/lib/variant-quantity";



export const Route = createFileRoute("/products")({
  head: () => ({
    meta: [
      { title: "المخزون · cupai" },
      { name: "description", content: "منتجاتك، الألوان، المقاسات، والكميات." },
    ],
  }),
  component: ProductsPage,
});

function ProductsPage() {
  const qc = useQueryClient();
  
  const q = useQuery({
    queryKey: ["website-products"],
    queryFn: () => listWebsiteProducts(),
    refetchInterval: (query) => {
      const products = query.state.data as WebsiteProductDTO[] | undefined;
      return products?.some((p) => p.images.length > 0 && p.description_status === "generating")
        ? 2500
        : false;
    },
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [addOpen, setAddOpen] = useState(false);
  // Keep only the id: the dialog always reads the latest saved product row.
  const [editingId, setEditingId] = useState<string | null>(null);
  const pubMut = useMutation({
    mutationFn: (v: { id: string; is_published: boolean }) =>
      setProductPublished({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["website-products"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "فشل النشر."),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => deleteWebsiteProduct({ data: { id } }),
    onSuccess: () => {
      toast.success("تم حذف المنتج.");
      qc.invalidateQueries({ queryKey: ["website-products"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "فشل الحذف."),
  });


  const rows = q.data ?? [];

  return (
    <PageShell>
      <PageHero
        eyebrow="إدارة المخزون"
        icon={<Package className="h-3.5 w-3.5" />}
        title="كل"
        highlight="منتجاتك"
        description="جدول موحّد لكل منتجاتك مع جدول فرعي لصور الألوان والمقاسات. اضغط على السهم لتوسيع أي منتج."
        actions={
          <div className="flex gap-2">
            <Button onClick={() => setAddOpen(true)} className="bg-gradient-brand text-primary-foreground shadow-glow">
              <Plus className="ml-1 h-4 w-4" />
              إضافة منتج
            </Button>
          </div>
        }
      />

      <AddProductDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={() => {
          setAddOpen(false);
          toast.success("تم إضافة المنتج إلى المخزون.");
          qc.invalidateQueries({ queryKey: ["website-products"] });
        }}
      />

      <EditProductDialog
        product={rows.find((p) => p.id === editingId) ?? null}
        onOpenChange={(v) => { if (!v) setEditingId(null); }}
        onSaved={() => {
          setEditingId(null);
          toast.success("تم حفظ التعديلات.");
          qc.invalidateQueries({ queryKey: ["website-products"] });
        }}
      />




      {q.isLoading ? (
        <SurfaceCard className="p-10 text-center text-sm text-muted-foreground">جاري التحميل...</SurfaceCard>
      ) : rows.length === 0 ? (
        <SurfaceCard className="p-12 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-brand text-primary-foreground shadow-glow">
            <Sparkles className="h-6 w-6" />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            لا توجد منتجات بعد. أضف منتجك الأول يدويًا للبدء.
          </p>
          <Button className="mt-5" onClick={() => setAddOpen(true)}>
            <Plus className="ml-1 h-4 w-4" />إضافة منتج
          </Button>
        </SurfaceCard>
      ) : (
        <SurfaceCard>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="w-8 px-3 py-3"></th>
                  <th className="px-4 py-3">الصورة</th>
                  <th className="px-4 py-3">الاسم</th>
                  <th className="px-4 py-3">الفئة</th>
                  <th className="px-4 py-3">السعر</th>
                  <th className="px-4 py-3">الألوان</th>
                  <th className="px-4 py-3">المقاسات</th>
                  <th className="px-4 py-3">تاريخ الإضافة</th>
                  <th className="px-4 py-3">النشر</th>
                  <th className="px-4 py-3">إجراءات</th>
                </tr>

              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((p) => {
                  const isOpen = expanded[p.id] === true;
                  const hasVariantImages = p.images.some((i) => i.color_id || i.size_id);
                  const canExpand = p.colors.length > 0 || p.sizes.length > 0 || hasVariantImages;
                  const firstImg = p.images[0];
                  return (
                    <Fragment key={p.id}>
                      <tr className="transition hover:bg-muted/30">
                        <td className="px-2 py-3 align-top">
                          {canExpand ? (
                            <button
                              onClick={() => setExpanded((prev) => ({ ...prev, [p.id]: !isOpen }))}
                              className="grid h-7 w-7 place-items-center rounded-lg border border-border/60 bg-background text-muted-foreground transition hover:border-primary/40 hover:text-primary"
                              aria-label={isOpen ? "طي" : "توسيع"}
                            >
                              {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            </button>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          {firstImg ? (
                            <img
                              src={firstImg.url}
                              alt={p.name}
                              className="h-14 w-14 rounded-xl object-cover ring-1 ring-border/60 shadow-card"
                              loading="lazy"
                            />
                          ) : (
                            <div className="grid h-14 w-14 place-items-center rounded-xl bg-muted text-xs text-muted-foreground">—</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{p.name}</span>
                            <DescriptionStatusIndicator product={p} />
                          </div>
                          {p.description && (
                            <div className="line-clamp-1 text-xs text-muted-foreground">
                              {p.description}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">—</td>
                        <td className="whitespace-nowrap px-4 py-3 font-medium">
                          {p.price != null ? <span className="text-gradient-brand font-semibold">{p.price} {p.currency ?? ""}</span> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {p.colors.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {p.colors.map((c) => (
                                <span key={c.id} className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-2 py-0.5">
                                  {c.hex && <span className="h-2.5 w-2.5 rounded-full border border-border/60" style={{ background: c.hex }} />}
                                  {c.label}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {p.sizes.length > 0 ? p.sizes.map((s) => s.label).join(", ") : "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                          {new Date(p.created_at).toLocaleDateString("ar-EG")}
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            size="sm"
                            variant={p.is_published ? "secondary" : "default"}
                            className={p.is_published ? "" : "bg-gradient-brand text-primary-foreground shadow-glow"}
                            onClick={() => pubMut.mutate({ id: p.id, is_published: !p.is_published })}
                          >
                            {p.is_published ? "إلغاء النشر" : "نشر"}
                          </Button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <Button
                              size="icon" variant="outline" title="تعديل"
                              onClick={() => setEditingId(p.id)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon" variant="ghost" title="حذف"
                              className="text-destructive hover:text-destructive"
                              disabled={delMut.isPending}
                              onClick={() => {
                                if (window.confirm(`حذف المنتج "${p.name}" نهائياً؟`)) delMut.mutate(p.id);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-muted/20">
                          <td colSpan={10} className="p-0">

                            <VariantSubTable product={p} />
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

/** Small read-only indicator for the internal image-description status.
 *  "Retry" appears only in the failed state and re-runs the existing job. */
function DescriptionStatusIndicator({ product }: { product: WebsiteProductDTO }) {
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: () => retryProductDescription({ data: { productId: product.id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["website-products"] });
      toast.success("تمت إعادة توليد وصف الصور.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "فشلت إعادة المحاولة."),
  });

  // A product with no images at all is not being processed — show a distinct
  // state instead of the misleading "generating" / "failed" labels.
  const hasImages = product.images.length > 0;
  const s = hasImages ? product.description_status : "no_images";
  const label =
    s === "no_images"
      ? "وصف الصور: لا توجد صور بعد"
      : s === "ready"
        ? "وصف الصور: جاهز"
        : s === "failed"
          ? "وصف الصور: فشل"
          : "وصف الصور: قيد التوليد";
  const tone =
    s === "ready"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
      : s === "failed"
        ? "border-destructive/30 bg-destructive/10 text-destructive"
        : s === "no_images"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-600"
          : "border-border/60 bg-muted text-muted-foreground";

  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone}`}>
        {s === "generating" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
        {s === "no_images" && <ImageOff className="h-2.5 w-2.5" />}
        {label}
      </span>
      {s === "failed" && (
        <button
          type="button"
          onClick={() => retry.mutate()}
          disabled={retry.isPending}
          className="rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground transition hover:border-primary/40 hover:text-primary disabled:opacity-60"
        >
          {retry.isPending ? "جارٍ..." : "إعادة المحاولة"}
        </button>
      )}
    </span>
  );
}

function VariantSubTable({ product }: { product: WebsiteProductDTO }) {
  const byColor = new Map<string, typeof product.images>();
  const bySize = new Map<string, typeof product.images>();
  const other: typeof product.images = [];
  for (const img of product.images) {
    if (img.color_id) {
      const arr = byColor.get(img.color_id) ?? [];
      arr.push(img);
      byColor.set(img.color_id, arr);
    } else if (img.size_id) {
      const arr = bySize.get(img.size_id) ?? [];
      arr.push(img);
      bySize.set(img.size_id, arr);
    } else {
      other.push(img);
    }
  }
  const colorRows = product.colors.map((c) => ({ c, imgs: byColor.get(c.id) ?? [] }));
  const sizeRows  = product.sizes.map((s)  => ({ s, imgs: bySize.get(s.id)  ?? [] }));

  return (
    <div className="border-r-4 border-primary/60 bg-background/60 p-5">
      <div className="overflow-x-auto rounded-xl border border-border/60 bg-background/80">
        <table className="w-full text-right text-xs">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2">النوع</th>
              <th className="px-3 py-2">الاسم</th>
              <th className="px-3 py-2">الصور</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {colorRows.length === 0 && sizeRows.length === 0 && other.length === 0 && (
              <tr><td colSpan={3} className="p-3 text-center text-muted-foreground">لا توجد صور مرتبطة.</td></tr>
            )}
            {colorRows.map(({ c, imgs }) => (
              <tr key={`c-${c.id}`}>
                <td className="whitespace-nowrap px-3 py-2 font-medium text-muted-foreground">لون</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                    {c.hex && <span className="h-2.5 w-2.5 rounded-full border border-border/60" style={{ background: c.hex }} />}
                    {c.label}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <ImageStrip imgs={imgs} label={c.label} />
                </td>
              </tr>
            ))}
            {sizeRows.map(({ s, imgs }) => (
              <tr key={`s-${s.id}`}>
                <td className="whitespace-nowrap px-3 py-2 font-medium text-muted-foreground">مقاس</td>
                <td className="whitespace-nowrap px-3 py-2">{s.label}</td>
                <td className="px-3 py-2">
                  <ImageStrip imgs={imgs} label={s.label} />
                </td>
              </tr>
            ))}
            {other.length > 0 && (
              <tr>
                <td className="whitespace-nowrap px-3 py-2 font-medium text-muted-foreground">عام</td>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">بدون لون/مقاس</td>
                <td className="px-3 py-2">
                  <ImageStrip imgs={other} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ImageStrip({ imgs, label }: { imgs: WebsiteProductDTO["images"]; label?: string }) {
  if (imgs.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-2">
      {imgs.map((img) => (
        <div key={img.id} className="flex flex-col items-center gap-1">
          <img
            src={img.url}
            alt={label ?? ""}
            className="h-14 w-14 rounded-lg border border-border/60 object-cover shadow-card"
            loading="lazy"
          />
          {label && (
            <span className="max-w-[80px] truncate text-[10px] text-muted-foreground" title={label}>
              {label}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manual Add Product dialog — creates a staging_products row inside a fresh
// analysis_batch and redirects the merchant to the batch review page so the
// existing approval flow handles the actual publish.
// ---------------------------------------------------------------------------

/** ONE row = one colour + one size + one quantity. Multi-size rows are not allowed. */
type AddColor = {
  /** Stable image-group key. Rows of the SAME colour share the same gkey, so
   *  every size of that colour is linked to the same colour images. */
  gkey: string;
  label: string;
  size: string;
  quantity: string;
  suggested?: boolean;
};

/** Sizes auto-filled, in order, each time a new colour row is printed. */
const SIZE_CYCLE = ["S", "L", "M", "XL", "XXL", "XXXL"];
const nextCycleSize = (rowCount: number) => SIZE_CYCLE[rowCount % SIZE_CYCLE.length]!;

let addGroupSeq = 0;
const nextAddGroupKey = () => `a${++addGroupSeq}`;

/** Normalised key used to decide that two images share the same colour. */
function colorKey(label: string) {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

/** First size of the cycle not used yet by the rows of this colour. */
function nextSizeForColor(rows: { label: string; size: string }[], label: string) {
  const used = new Set(
    rows.filter((r) => colorKey(r.label) === colorKey(label)).map((r) => r.size.trim()),
  );
  return SIZE_CYCLE.find((s) => !used.has(s)) ?? "";
}


function AddProductDialog({
  open, onOpenChange, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (productId: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [material, setMaterial] = useState("");

  const [price, setPrice] = useState("");
  
  const [colors, setColors] = useState<AddColor[]>([]);
  // Images picked before the product exists, keyed by colour group key ("g" = intake).
  const [pendingImages, setPendingImages] = useState<Record<string, File[]>>({});
  const [analyzingKey, setAnalyzingKey] = useState<string | null>(null);
  // Images already analyzed once — their «تحليل» button never comes back.
  const [analyzedFiles, setAnalyzedFiles] = useState<Set<string>>(new Set());
  // Progress of the automatic "analyze then group by colour" pass.
  const [grouping, setGrouping] = useState<{ done: number; total: number } | null>(null);

  // Always-fresh view of `colors` for use after awaits.
  const colorsRef = useRef<AddColor[]>(colors);
  colorsRef.current = colors;

  /**
   * Smart button: print one more row. If the previous row already carries a
   * colour, the new row keeps that SAME colour (and the same image group, so
   * every size of the colour is linked to the same colour images) and only the
   * size moves on to the next one in the cycle.
   */
  function addColorRow(patch: Partial<AddColor> = {}) {
    setColors((rows) => {
      const last = rows[rows.length - 1];
      const inherit = !!last && !!last.label.trim() && patch.label === undefined;
      const label = inherit ? last!.label : (patch.label ?? "");
      const size = inherit
        ? nextSizeForColor(rows, label)
        : (patch.size ?? nextCycleSize(rows.length));
      return [
        ...rows,
        {
          gkey: inherit ? last!.gkey : nextAddGroupKey(),
          label,
          size,
          quantity: "",
          ...patch,
          ...(inherit ? { gkey: last!.gkey, label, size } : {}),
        },
      ];
    });
  }

  function addFiles(key: string, files: FileList | null) {
    if (!files || files.length === 0) return;
    const picked = Array.from(files).filter((f) => /^image\//i.test(f.type));
    if (picked.length === 0) return;
    setPendingImages((prev) => ({ ...prev, [key]: [...(prev[key] ?? []), ...picked] }));
  }
  function removeFile(key: string, index: number) {
    setPendingImages((prev) => ({
      ...prev, [key]: (prev[key] ?? []).filter((_, i) => i !== index),
    }));
  }
  function patchColor(i: number, patch: Partial<AddColor>) {
    setColors((rows) => {
      const target = rows[i];
      if (!target) return rows;
      // Renaming a colour renames every row that shares its image group, so the
      // colour ⇄ image link stays intact across all of its sizes.
      return rows.map((r, j) => {
        if (j === i) return { ...r, ...patch };
        if (patch.label !== undefined && r.gkey === target.gkey) {
          return { ...r, label: patch.label };
        }
        return r;
      });
    });
  }

  /** Images of a colour are shown once, on the first row of its group. */
  function isFirstRowOfGroup(i: number) {
    return colors.findIndex((r) => r.gkey === colors[i]!.gkey) === i;
  }

  /** Remove a row; if it was the last row of its group, its images go back to intake. */
  function removeColor(i: number) {
    const gone = colorsRef.current[i];
    const rest = colorsRef.current.filter((_, j) => j !== i);
    setColors(rest);
    if (!gone) return;
    if (rest.some((r) => r.gkey === gone.gkey)) return;
    setPendingImages((prev) => {
      const out: Record<string, File[]> = { ...prev, g: [...(prev["g"] ?? []), ...(prev[gone.gkey] ?? [])] };
      delete out[gone.gkey];
      return out;
    });
  }

  /** Move one pending image to another group ("g", a colour group, or a new group). */
  function moveFile(fromKey: string, index: number, toKey: string) {
    const file = (pendingImages[fromKey] ?? [])[index];
    if (!file) return;
    let target = toKey;
    if (toKey === "__new") {
      target = nextAddGroupKey();
      setColors((rows) => [
        ...rows,
        { gkey: target, label: "", size: nextCycleSize(rows.length), quantity: "", suggested: true },
      ]);
    }
    if (target === fromKey) return;
    setPendingImages((prev) => ({
      ...prev,
      [fromKey]: (prev[fromKey] ?? []).filter((_, i) => i !== index),
      [target]: [...(prev[target] ?? []), file],
    }));
  }


  /** Stable identity for a picked file (survives moving between groups). */
  function fileKey(f: File) {
    return `${f.name}:${f.size}:${f.lastModified}`;
  }

  function reset() {
    setName(""); setDescription(""); setMaterial(""); setPrice("");
    setColors([]); setPendingImages({}); setAnalyzingKey(null);
    setGrouping(null); setAnalyzedFiles(new Set());
  }


  // Analyze ONE image. The colour is never merged into the name/description:
  // it is attached to the image as its own colour group, so the agent always
  // sees "this image = this colour" instead of an unusable general image.
  async function analyzeFile(key: string, file: File, colorIndex: number | null) {
    setAnalyzingKey(`${key}:${file.name}`);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await analyzeProductImageFile({ data: fd });
      // Analyzed once → hide this image's «تحليل» button for good.
      setAnalyzedFiles((prev) => new Set(prev).add(fileKey(file)));

      // Basic (colour-free) product data — only fills what is still empty.
      if (res.name && !name.trim()) setName(res.name);
      if (res.description && !description.trim()) setDescription(res.description);
      if (res.material && !material.trim()) setMaterial(res.material);
      if (res.price != null && !price.trim()) setPrice(String(res.price));

      const detected = (res.colors[0] ?? "").trim();

      if (colorIndex != null) {
        const cur = colorsRef.current[colorIndex];
        if (detected && !cur?.label.trim()) patchColor(colorIndex, { label: detected });
        if (res.sizes[0] && !cur?.size.trim()) {
          patchColor(colorIndex, { size: res.sizes[0] });
        }
        toast.success("تم تحليل الصورة، يمكنك تعديل الاقتراحات.");
        return;
      }

      // Image still in the intake area → move it into its colour group.
      const nextColors = [...colorsRef.current];
      let idx = detected
        ? nextColors.findIndex((c) => colorKey(c.label) === colorKey(detected))
        : -1;
      if (idx < 0) {
        nextColors.push({
          gkey: nextAddGroupKey(),
          label: detected,
          size: res.sizes[0] ?? nextCycleSize(nextColors.length),
          quantity: "",
          suggested: true,
        });
        idx = nextColors.length - 1;
      } else if (res.sizes[0] && !nextColors[idx]!.size.trim()) {
        nextColors[idx] = { ...nextColors[idx]!, size: res.sizes[0]! };
      }
      const gkey = nextColors[idx]!.gkey;
      colorsRef.current = nextColors;
      setColors(nextColors);
      setPendingImages((prev) => ({
        ...prev,
        [key]: (prev[key] ?? []).filter((f) => fileKey(f) !== fileKey(file)),
        [gkey]: [...(prev[gkey] ?? []), file],
      }));

      toast.success(
        detected
          ? `تم التعرف على اللون «${detected}» وربط الصورة به.`
          : "تم التحليل، اكتب اسم اللون الخاص بهذه الصورة.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل تحليل الصورة.");
    } finally {
      setAnalyzingKey(null);
    }
  }

  /** Pick images into the intake area — nothing runs until «تحليل». */
  function addIntakeFiles(list: FileList | null) {
    const picked = Array.from(list ?? []).filter((f) => /^image\//i.test(f.type));
    if (picked.length === 0) return;
    setPendingImages((prev) => ({ ...prev, g: [...(prev["g"] ?? []), ...picked] }));
  }

  /** Analyze every image still waiting in the intake area, one by one. */
  async function analyzeAllIntake() {
    const files = [...(pendingImages["g"] ?? [])].filter((f) => !analyzedFiles.has(fileKey(f)));
    if (files.length === 0) return;
    setGrouping({ done: 0, total: files.length });
    for (const f of files) {
      await analyzeFile("g", f, null);
      setGrouping((p) => (p ? { ...p, done: p.done + 1 } : p));
    }
    setGrouping(null);
  }


  const createMut = useMutation({
    mutationFn: async () => {
      const sizes = Array.from(
        new Set(colors.map((c) => c.size.trim()).filter(Boolean)),
      );
      const colorList = Array.from(
        new Set(colors.map((c) => c.label.trim()).filter(Boolean)),
      );
      const vs: ManualVariantInput[] = [];
      colors.forEach((c) => {
        const label = c.label.trim();
        if (!label) return;
        // Quantity is MANDATORY: a null stock row is later read as
        // "unavailable" and then flips once the merchant fills it in, which is
        // exactly the availability contradiction this guard prevents.
        const qty = requireQuantity(c.quantity, label);
        // Exactly one size per row — no multi-size expansion.
        vs.push({ color: label, size: c.size.trim() || null, quantity: qty });
      });

      const res = await createManualProduct({
        data: {
          name: name.trim(),
          description: description.trim() || null,
          material: material.trim() || null,
          price: price.trim() === "" ? null : Number(price),
          colors: colorList,
          sizes,
          variants: vs,
        },
      });


      // Upload the picked images through the existing product-image upload
      // mechanism, attaching each one to its colour.
      const colorIdByLabel = new Map(
        (res.colors ?? []).map((c) => [c.label.toLowerCase(), c.id] as const),
      );
      for (const [key, files] of Object.entries(pendingImages)) {
        const label =
          key === "g" ? "" : (colors.find((c) => c.gkey === key)?.label ?? "").trim();

        for (const file of files) {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("productId", res.productId);
          const cid = label ? colorIdByLabel.get(label.toLowerCase()) : null;
          if (cid) fd.append("colorId", cid);
          await uploadProductImage({ data: fd });
        }
      }
      return res;
    },
    onSuccess: (r) => {
      reset();
      onCreated(r.productId);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "فشل إنشاء المنتج."),
  });

  function Thumbs({ imgKey, colorIndex }: { imgKey: string; colorIndex: number | null }) {
    // In the intake area an analyzed image is ALWAYS moved into its colour
    // group — never keep a second copy of it here.
    const files = (pendingImages[imgKey] ?? [])
      .map((f, realIndex) => ({ f, realIndex }))
      .filter(({ f }) => imgKey !== "g" || !analyzedFiles.has(fileKey(f)));
    if (files.length === 0) return null;

    return (
      <div className="flex flex-wrap gap-3">
        {files.map(({ f, realIndex: k }) => {
          const busy = analyzingKey === `${imgKey}:${f.name}`;
          const done = analyzedFiles.has(fileKey(f));
          return (
            <div key={`${f.name}-${k}`} className="flex flex-col items-center gap-1">
              <div className="relative">
                <img
                  src={URL.createObjectURL(f)}
                  alt={f.name}
                  className="h-16 w-16 rounded-lg border border-border/60 object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeFile(imgKey, k)}
                  className="absolute -left-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-destructive text-destructive-foreground"
                  aria-label="حذف الصورة"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
              {!done && (
                <Button
                  type="button" size="sm" variant="outline"
                  className="h-6 px-2 text-[10px]"
                  disabled={busy}
                  onClick={() => analyzeFile(imgKey, f, colorIndex)}
                >
                  {busy
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <><Sparkles className="ml-1 h-3 w-3" />تحليل</>}
                </Button>
              )}
              <select
                aria-label="نقل الصورة إلى مجموعة"
                className="h-6 w-[84px] rounded-md border border-border/60 bg-background px-1 text-[10px]"
                value={imgKey}
                onChange={(e) => moveFile(imgKey, k, e.target.value)}
              >
                <option value="g">بدون لون بعد</option>
                {Array.from(new Map(colors.map((c) => [c.gkey, c] as const)).values()).map(
                  (c, ci) => (
                    <option key={c.gkey} value={c.gkey}>
                      {c.label.trim() || `لون ${ci + 1}`}
                    </option>
                  ),
                )}
                <option value="__new">+ مجموعة جديدة</option>
              </select>

            </div>

          );
        })}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent dir="rtl" className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>إضافة منتج جديد</DialogTitle>
          <DialogDescription>
            ارفع الصور واستخدم زر «تحليل» لملء البيانات تلقائيًا، ثم عدّلها كما تريد.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Image intake — first step: upload, then press «تحليل» */}
          <section className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold text-primary">١. صور المنتج</h4>
              <div className="flex items-center gap-2">
                {(pendingImages["g"] ?? []).filter((f) => !analyzedFiles.has(fileKey(f))).length > 1 && (
                  <Button
                    type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]"
                    disabled={!!grouping || !!analyzingKey}
                    onClick={() => { void analyzeAllIntake(); }}
                  >
                    <Sparkles className="ml-1 h-3 w-3" /> تحليل الكل
                  </Button>
                )}
                <label className={`inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] transition ${
                  grouping ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-primary/40 hover:text-primary"
                }`}>
                  <ImagePlus className="h-3.5 w-3.5" /> رفع صور
                  <input
                    type="file" accept="image/*" multiple className="hidden"
                    disabled={!!grouping}
                    onChange={(e) => { addIntakeFiles(e.target.files); e.currentTarget.value = ""; }}
                  />
                </label>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              ارفع الصور ثم اضغط «تحليل» بجانب كل صورة: يستخرج الذكاء الاصطناعي بيانات المنتج الأساسية،
              ويضع اللون في خانة اللون ويربط الصورة به كصورة لهذا اللون — لا توجد صور عامة.
            </p>
            {grouping && (
              <p className="flex items-center gap-1 text-[11px] text-primary">
                <Loader2 className="h-3 w-3 animate-spin" />
                جارٍ تحليل الصور… ({grouping.done}/{grouping.total})
              </p>
            )}
            <Thumbs imgKey="g" colorIndex={null} />
          </section>

          {/* Basic info */}
          <section className="space-y-3 rounded-xl border border-border/60 bg-card/40 p-4">
            <h4 className="text-xs font-semibold text-muted-foreground">٢. بيانات المنتج الأساسية</h4>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">اسم المنتج *</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: تيشيرت قطن" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">الوصف</label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
              <p className="text-[10px] text-muted-foreground">
                الوصف بدون لون — الألوان تُدار في خانة الألوان بالأسفل.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">الخامة</label>
                <Input
                  value={material}
                  onChange={(e) => setMaterial(e.target.value)}
                  placeholder="مثال: قطن ١٠٠٪"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">السعر (ج.م)</label>
                <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>
            </div>
          </section>


          {/* Colours */}
          <section className="space-y-3 rounded-xl border border-border/60 bg-card/40 p-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-muted-foreground">الألوان والمقاسات والكميات</h4>
              <Button
                size="sm" variant="outline" type="button"
                onClick={() => addColorRow()}
              >
                <Plus className="ml-1 h-3.5 w-3.5" /> إضافة لون + مقاس
              </Button>
            </div>
            {colors.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                لا توجد ألوان بعد. أضف لونًا لتحديد صوره ومقاساته وكميته.
              </p>
            )}
            {colors.map((c, i) => (
              <div key={i} className="space-y-3 rounded-lg border border-border/50 bg-muted/30 p-3">
                {c.suggested && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                    <Sparkles className="h-3 w-3" /> مقترح من التحليل — عدّله كما تريد
                  </span>
                )}
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">اسم اللون</label>
                    <Input
                      value={c.label}
                      placeholder="أحمر"
                      onChange={(e) => patchColor(i, { label: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">المقاس (واحد فقط)</label>
                    <Input
                      value={c.size}
                      placeholder="S"
                      onChange={(e) => patchColor(i, { size: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">الكمية *</label>
                    <Input
                      type="number" min={0} required className="sm:w-24" value={c.quantity}
                      placeholder="0"
                      onChange={(e) => patchColor(i, { quantity: e.target.value })}
                    />
                  </div>


                  <Button
                    size="icon" variant="ghost" type="button"
                    aria-label="حذف المجموعة"
                    onClick={() => removeColor(i)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>



                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-muted-foreground">صور هذا اللون</span>
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] transition hover:border-primary/40 hover:text-primary">
                    <ImagePlus className="h-3.5 w-3.5" /> رفع صور
                    <input
                      type="file" accept="image/*" multiple className="hidden"
                      onChange={(e) => { addFiles(c.gkey, e.target.files); e.currentTarget.value = ""; }}
                    />
                  </label>
                </div>
                {/* Images of a colour are shown ONCE, on the first row of its group. */}
                {isFirstRowOfGroup(i) && <Thumbs imgKey={c.gkey} colorIndex={i} />}
              </div>
            ))}
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending || !name.trim()}
          >
            {createMut.isPending && <Loader2 className="ml-1 h-4 w-4 animate-spin" />}
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// ---------------------------------------------------------------------------
// Edit Product dialog — edits the core fields, the colour/size lists, and the
// images attached to each colour. Uses the existing product server functions
// only (upsert / upload image / delete image); the automatic description
// generation keeps running exactly as before (it is triggered by the same
// image-upload path and by the existing freshness sweep).
// ---------------------------------------------------------------------------

type EditColor = {
  id?: string;
  /** Stable local key: pending (unsaved) images are grouped by this, so a
   *  rename never loses the images attached to the group. */
  gkey: string;
  label: string;
  hex: string | null;
  /** Exactly ONE size per row. */
  size: string;
  quantity: string;
  suggested?: boolean;
};

let editGroupSeq = 0;
const nextGroupKey = () => `g${++editGroupSeq}`;

function EditProductDialog({
  product, onOpenChange, onSaved,
}: {
  product: WebsiteProductDTO | null;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [material, setMaterial] = useState("");

  const [price, setPrice] = useState("");
  const [colors, setColors] = useState<EditColor[]>([]);
  
  // New images picked in this session, keyed by colour group key ("" = general).
  const [pending, setPending] = useState<Record<string, File[]>>({});
  /**
   * Already-saved images that the AI just resolved to a colour: imageId → group
   * key. The image MOVES into that colour group (it is never kept as a second,
   * colour-less copy) and the link is persisted on save.
   */
  const [savedAssign, setSavedAssign] = useState<Record<string, string>>({});
  const [loadedId, setLoadedId] = useState<string | null>(null);

  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  // Images already analyzed once — their «تحليل» button never comes back.
  const [analyzedIds, setAnalyzedIds] = useState<Set<string>>(new Set());
  const [grouping, setGrouping] = useState<{ done: number; total: number } | null>(null);

  const colorsRef = useRef<EditColor[]>(colors);
  colorsRef.current = colors;
  const pendingRef = useRef<Record<string, File[]>>(pending);
  pendingRef.current = pending;

  // Load the product into the form when it changes (no effect needed: the
  // dialog is keyed by the product id we last hydrated from).
  if (product && loadedId !== product.id) {
    setLoadedId(product.id);
    setName(product.name);
    setDescription(product.description ?? "");
    setMaterial(product.material ?? "");

    setPrice(product.price != null ? String(product.price) : "");
    // One row per (colour, size) pair — a colour with three sizes becomes three
    // independent rows, each with its own quantity.
    setColors(
      product.colors.flatMap((c) => {
        const vs = product.variants.filter(
          (v) => (v.color ?? "").toLowerCase() === c.label.toLowerCase(),
        );
        const base = { id: c.id, label: c.label, hex: c.hex };
        if (vs.length === 0) {
          return [{ ...base, gkey: nextGroupKey(), size: "", quantity: "" }];
        }
        return vs.map((v) => ({
          ...base,
          gkey: nextGroupKey(),
          size: v.size ?? "",
          quantity: v.quantity != null ? String(v.quantity) : "",
        }));
      }),
    );
    setPending({});
    setSavedAssign({});
    setGrouping(null);

  }

  const delImg = useMutation({
    mutationFn: (imageId: string) => deleteProductImage({ data: { imageId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["website-products"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "فشل حذف الصورة."),
  });

  // AI suggestion from a single saved image — same existing mechanism used
  // elsewhere. Always runs against the latest saved state of the product.
  const analyze = useMutation({
    mutationFn: async (v: { imageId: string; colorIndex: number | null }) => {
      setAnalyzingId(v.imageId);
      await qc.refetchQueries({ queryKey: ["website-products"] });
      const res = await analyzeProductImage({ data: { imageId: v.imageId } });
      setAnalyzedIds((prev) => new Set(prev).add(v.imageId));
      return { res, colorIndex: v.colorIndex, imageId: v.imageId };
    },
    onSettled: () => setAnalyzingId(null),
    onSuccess: ({ res, colorIndex, imageId }) => {
      if (colorIndex == null) {
        if (res.name) setName(res.name);
        if (res.description) setDescription(res.description);
        if (res.material && !material.trim()) setMaterial(res.material);
        if (res.price != null) setPrice(String(res.price));
        const detectedColor = (res.colors[0] ?? "").trim();
        if (detectedColor) {
          // The image BECOMES this colour's image — it must not stay as a
          // separate colour-less copy of the same photo.
          const rows = [...colorsRef.current];
          let idx = rows.findIndex((c) => colorKey(c.label) === colorKey(detectedColor));
          if (idx < 0) {
            rows.push({
              gkey: nextGroupKey(), label: detectedColor, hex: null,
              size: res.sizes[0] ?? nextCycleSize(rows.length), quantity: "", suggested: true,
            });
            idx = rows.length - 1;
          }
          colorsRef.current = rows;
          setColors(rows);
          setSavedAssign((prev) => ({ ...prev, [imageId]: rows[idx]!.gkey }));
        }
        toast.success(
          detectedColor
            ? `تم استخراج البيانات، ونُقلت الصورة إلى اللون «${detectedColor}».`
            : "تم اقتراح البيانات من الصورة، يمكنك تعديلها قبل الحفظ.",
        );

      } else {
        const detected = res.colors.find((c) => c.trim());
        if (res.material && !material.trim()) setMaterial(res.material);
        if (detected) {
          setColors((rows) => rows.map((r, j) => j === colorIndex ? { ...r, label: detected.trim() } : r));
          toast.success("تم اقتراح اسم اللون، يمكنك تعديله قبل الحفظ.");
        } else {
          toast.info("لم يتم التعرف على لون في هذه الصورة.");
        }
      }

    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "فشل تحليل الصورة."),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!product) return;
      const cleanColors = colors.filter((c) => c.label.trim());
      const allSizes = Array.from(
        new Set(cleanColors.map((c) => c.size.trim()).filter(Boolean)),
      );
      const variants: { color: string | null; size: string | null; quantity: number | null }[] = [];
      for (const c of cleanColors) {
        const label = c.label.trim();
        const qty = requireQuantity(c.quantity, label);
        // One row = one colour + one size + one quantity.
        variants.push({ color: label, size: c.size.trim() || null, quantity: qty });
      }
      const labelByKeyAll = new Map(colors.map((c) => [c.gkey, c.label.trim()] as const));
      const res = await upsertWebsiteProduct({
        data: {
          id: product.id,
          name: name.trim(),
          description: description.trim() || null,
          material: material.trim() || null,

          price: price.trim() === "" ? null : Number(price),
          currency: product.currency,
          sizes: allSizes.map((label) => ({ label })),
          colors: cleanColors.map((c) => ({ label: c.label.trim(), hex: c.hex })),
          variants,
          // Saved images the AI resolved to a colour: move the SAME row onto
          // that colour instead of leaving a duplicate colour-less image.
          imageColorAssignments: Object.entries(savedAssign)
            .map(([imageId, gkey]) => ({ imageId, colorLabel: labelByKeyAll.get(gkey) ?? "" }))
            .filter((a) => a.colorLabel),
        },
      });
      const idByLabel = new Map((res.colors ?? []).map((c) => [c.label.toLowerCase(), c.id] as const));
      const labelByKey = labelByKeyAll;
      for (const [gkey, files] of Object.entries(pending)) {
        const label = gkey === "" ? "" : (labelByKey.get(gkey) ?? "");
        for (const file of files) {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("productId", product.id);
          const cid = label ? idByLabel.get(label.toLowerCase()) : null;
          if (cid) fd.append("colorId", cid);
          await uploadProductImage({ data: fd });
        }
      }
    },
    onSuccess: () => { setLoadedId(null); onSaved(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "فشل حفظ التعديلات."),
  });

  if (!product) return null;

  /** Images of a colour group: saved links + images just moved by the AI. */
  const imagesForGroup = (colorId: string | undefined, gkey: string) =>
    product.images.filter(
      (i) => (colorId ? i.color_id === colorId : false) || savedAssign[i.id] === gkey,
    );

  /** Truly unassigned images only — analysed ones move out of here. */
  const imagesFor = (colorId?: string) =>
    product.images.filter((i) =>
      colorId ? i.color_id === colorId : !i.color_id && !i.size_id && !savedAssign[i.id],
    );


  /**
   * Smart button: print one more row. If the previous row already carries a
   * colour, the new row keeps that SAME colour (same colour id and same image
   * group, so every size of the colour stays linked to the same colour images)
   * and only the size moves on to the next one in the cycle.
   */
  function addColorRow(patch: Partial<EditColor> = {}) {
    setColors((rows) => {
      const last = rows[rows.length - 1];
      const inherit = !!last && !!last.label.trim() && patch.label === undefined;
      if (inherit) {
        const inherited: EditColor = {
          ...patch,
          size: patch.size ?? nextSizeForColor(rows, last!.label),
          quantity: "",
          // The colour link must never be overridden by the patch.
          id: last!.id,
          gkey: last!.gkey,
          label: last!.label,
          hex: last!.hex,
        };
        return [...rows, inherited];
      }
      return [
        ...rows,
        {
          gkey: nextGroupKey(), label: "", hex: null,
          size: nextCycleSize(rows.length), quantity: "", ...patch,
        },
      ];
    });
  }

  /** Images of a colour are shown once, on the first row that carries it. */
  const isFirstRowOfColor = (i: number) => {
    const row = colors[i]!;
    const same = row.label.trim()
      ? (r: EditColor) => colorKey(r.label) === colorKey(row.label)
      : (r: EditColor) => r.gkey === row.gkey;
    return colors.findIndex(same) === i;
  };

  function addFiles(gkey: string, files: FileList | null) {
    if (!files || files.length === 0) return;
    const picked = Array.from(files).filter((f) => /^image\//i.test(f.type));
    if (picked.length === 0) return;
    setPending((prev) => ({ ...prev, [gkey]: [...(prev[gkey] ?? []), ...picked] }));
  }

  /** Delete a colour group; its unsaved images fall back to the general area. */
  function removeColorGroup(i: number) {
    const gkey = colorsRef.current[i]?.gkey;
    setColors((rows) => rows.filter((_, j) => j !== i));
    if (!gkey) return;
    setSavedAssign((prev) => {
      const out = { ...prev };
      for (const [imgId, k] of Object.entries(out)) if (k === gkey) delete out[imgId];
      return out;
    });
    setPending((prev) => {
      const out: Record<string, File[]> = { ...prev, "": [...(prev[""] ?? []), ...(prev[gkey] ?? [])] };
      delete out[gkey];
      return out;

    });

  }

  /** Move one unsaved image between groups ("" = general, or a new group). */
  function moveFile(fromKey: string, index: number, toKey: string) {
    const file = (pendingRef.current[fromKey] ?? [])[index];
    if (!file) return;
    let target = toKey;
    if (toKey === "__new") {
      target = nextGroupKey();
      setColors((rows) => [...rows, {
        gkey: target, label: "", hex: null,
        size: nextCycleSize(rows.length), quantity: "", suggested: true,
      }]);
    }
    if (target === fromKey) return;
    setPending((prev) => ({
      ...prev,
      [fromKey]: (prev[fromKey] ?? []).filter((_, i) => i !== index),
      [target]: [...(prev[target] ?? []), file],
    }));
  }

  /** Pick images into the intake area — nothing runs until «تحليل». */
  function addIntakeFiles(list: FileList | null) {
    const picked = Array.from(list ?? []).filter((f) => /^image\//i.test(f.type));
    if (picked.length === 0) return;
    setPending((prev) => ({ ...prev, "": [...(prev[""] ?? []), ...picked] }));
  }

  /** Stable identity for a picked file (survives moving between groups). */
  function pendingFileKey(f: File) {
    return `pf:${f.name}:${f.size}:${f.lastModified}`;
  }

  /**
   * Analyze one not-yet-saved image: fill the empty basic fields (never the
   * colour), then attach the image to its detected colour group.
   */
  async function analyzePendingFile(file: File) {
    setAnalyzingId(`pending:${file.name}`);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await analyzeProductImageFile({ data: fd });
      // Analyzed once → hide this image's «تحليل» button for good.
      setAnalyzedIds((prev) => new Set(prev).add(pendingFileKey(file)));

      if (res.name && !name.trim()) setName(res.name);
      if (res.description && !description.trim()) setDescription(res.description);
      if (res.material && !material.trim()) setMaterial(res.material);
      if (res.price != null && !price.trim()) setPrice(String(res.price));

      const detected = (res.colors[0] ?? "").trim();
      const nextColors = [...colorsRef.current];
      let idx = detected
        ? nextColors.findIndex((c) => colorKey(c.label) === colorKey(detected))
        : -1;
      if (idx < 0) {
        nextColors.push({
          gkey: nextGroupKey(), label: detected, hex: null,
          size: res.sizes[0] ?? nextCycleSize(nextColors.length),
          quantity: "", suggested: true,
        });
        idx = nextColors.length - 1;
      } else if (res.sizes[0] && !nextColors[idx]!.size.trim()) {
        nextColors[idx] = { ...nextColors[idx]!, size: res.sizes[0]! };
      }
      const gkey = nextColors[idx]!.gkey;
      colorsRef.current = nextColors;
      setColors(nextColors);
      setPending((prev) => ({
        ...prev,
        "": (prev[""] ?? []).filter((f) => f !== file),
        [gkey]: [...(prev[gkey] ?? []), file],
      }));
      toast.success(
        detected
          ? `تم التعرف على اللون «${detected}» وربط الصورة به.`
          : "تم التحليل، اكتب اسم اللون الخاص بهذه الصورة.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل تحليل الصورة.");
    } finally {
      setAnalyzingId(null);
    }
  }

  /** Analyze every image still waiting in the intake area, one by one. */
  async function analyzeAllIntake() {
    const files = [...(pendingRef.current[""] ?? [])].filter(
      (f) => !analyzedIds.has(pendingFileKey(f)),
    );
    if (files.length === 0) return;
    setGrouping({ done: 0, total: files.length });
    for (const f of files) {
      await analyzePendingFile(f);
      setGrouping((p) => (p ? { ...p, done: p.done + 1 } : p));
    }
    setGrouping(null);
  }


  /** Group picker rendered under each unsaved thumbnail. */
  function GroupPicker({ fromKey, index }: { fromKey: string; index: number }) {
    return (
      <select
        aria-label="نقل الصورة إلى مجموعة"
        className="mt-1 h-5 w-14 rounded-md border border-border/60 bg-background px-0.5 text-[9px]"
        value={fromKey}
        onChange={(e) => moveFile(fromKey, index, e.target.value)}
      >
        <option value="">عامة</option>
        {colors.map((c, ci) => (
          <option key={c.gkey} value={c.gkey}>{c.label.trim() || `لون ${ci + 1}`}</option>
        ))}
        <option value="__new">+ جديدة</option>
      </select>
    );
  }

  return (
    <Dialog open={!!product} onOpenChange={(v) => { if (!v) setLoadedId(null); onOpenChange(v); }}>
      <DialogContent dir="rtl" className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>تعديل المنتج</DialogTitle>
          <DialogDescription>
            عدّل البيانات والألوان والمقاسات، وأدر صور كل لون. الصور الجديدة تُرفع عند الحفظ.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Image intake — upload, then «تحليل» links the image to its colour */}
          <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-primary">صور المنتج</span>
              <div className="flex items-center gap-2">
                {(pending[""] ?? []).filter((f) => !analyzedIds.has(pendingFileKey(f))).length > 1 && (
                  <Button
                    type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]"
                    disabled={!!grouping}
                    onClick={() => { void analyzeAllIntake(); }}
                  >
                    <Sparkles className="ml-1 h-3 w-3" /> تحليل الكل
                  </Button>
                )}
                <label className={`inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] ${
                  grouping ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-primary/40 hover:text-primary"
                }`}>
                  <ImagePlus className="h-3.5 w-3.5" /> رفع صور
                  <input type="file" accept="image/*" multiple className="hidden"
                    disabled={!!grouping}
                    onChange={(e) => { addIntakeFiles(e.target.files); e.currentTarget.value = ""; }} />
                </label>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              اضغط «تحليل» بجانب الصورة: تُستخرج بيانات المنتج الأساسية، ويوضع اللون في خانة اللون
              وتُربط الصورة به كصورة لهذا اللون.
            </p>
            {grouping && (
              <p className="flex items-center gap-1 text-[11px] text-primary">
                <Loader2 className="h-3 w-3 animate-spin" />
                جارٍ تحليل الصور… ({grouping.done}/{grouping.total})
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {imagesFor(undefined).map((img) => (
                <div key={img.id} className="relative">
                  <img src={img.url} alt="" className="h-14 w-14 rounded-lg border border-border/60 object-cover" />
                  <button type="button" aria-label="حذف الصورة"
                    onClick={() => delImg.mutate(img.id)}
                    className="absolute -left-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-destructive text-destructive-foreground">
                    <X className="h-2.5 w-2.5" />
                  </button>
                  {!analyzedIds.has(img.id) && (
                  <button type="button"
                    onClick={() => analyze.mutate({ imageId: img.id, colorIndex: null })}
                    disabled={analyze.isPending}
                    className="mt-1 flex w-14 items-center justify-center gap-0.5 rounded-md border border-border/60 bg-background px-1 py-0.5 text-[9px] transition hover:border-primary/40 hover:text-primary disabled:opacity-60">
                    {analyzingId === img.id
                      ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      : <Sparkles className="h-2.5 w-2.5" />}
                    تحليل
                  </button>
                  )}
                </div>
              ))}
              {(pending[""] ?? [])
                .map((f, realIndex) => ({ f, k: realIndex }))
                // An analyzed image ALWAYS moves into its colour group — it is
                // never left as a second copy in the intake area.
                .filter(({ f }) => !analyzedIds.has(pendingFileKey(f)))
                .map(({ f, k }) => {
                const busy = analyzingId === `pending:${f.name}`;
                return (
                  <div key={`pg-${k}`} className="relative">
                    <img src={URL.createObjectURL(f)} alt={f.name}
                      className="h-14 w-14 rounded-lg border border-dashed border-primary/50 object-cover" />
                    <button type="button" aria-label="إزالة"
                      onClick={() => setPending((prev) => ({ ...prev, "": (prev[""] ?? []).filter((_, j) => j !== k) }))}
                      className="absolute -left-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-destructive text-destructive-foreground">
                      <X className="h-2.5 w-2.5" />
                    </button>
                    {!analyzedIds.has(pendingFileKey(f)) && (
                    <button type="button"
                      onClick={() => { void analyzePendingFile(f); }}
                      disabled={busy || !!grouping}
                      className="mt-1 flex w-14 items-center justify-center gap-0.5 rounded-md border border-border/60 bg-background px-1 py-0.5 text-[9px] transition hover:border-primary/40 hover:text-primary disabled:opacity-60">
                      {busy ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Sparkles className="h-2.5 w-2.5" />}
                      تحليل
                    </button>
                    )}
                    <GroupPicker fromKey="" index={k} />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium">اسم المنتج *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">الوصف</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">الخامة</label>
              <Input value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="مثال: قطن ١٠٠٪" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">السعر</label>
              <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
          </div>


          {/* Colours + their images — one colour + one size + one quantity per row */}
          <div className="space-y-3 rounded-xl border border-border/60 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">الألوان والمقاسات والكميات</span>
              <Button size="sm" variant="outline" type="button"
                onClick={() => addColorRow()}>
                <Plus className="ml-1 h-3.5 w-3.5" /> إضافة لون + مقاس
              </Button>
            </div>

            {colors.map((c, i) => (
              <div key={c.gkey} className="space-y-2 rounded-lg bg-muted/30 p-2">
                {c.suggested && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                    <Sparkles className="h-3 w-3" /> مقترح من التحليل — عدّله كما تريد
                  </span>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={c.label} placeholder="اسم اللون" className="max-w-[180px]"
                    onChange={(e) => {
                      const v = e.target.value;
                      // Renaming a colour renames every row of the same colour
                      // group, so the colour ⇄ image link survives all sizes.
                      setColors((rows) => rows.map((r, j) =>
                        j === i || r.gkey === rows[i]!.gkey ? { ...r, label: v } : r,
                      ));
                    }}
                  />
                  <Input
                    value={c.size} placeholder="المقاس" className="max-w-[100px]"
                    onChange={(e) => setColors((rows) => rows.map((r, j) => j === i ? { ...r, size: e.target.value } : r))}
                  />
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] hover:border-primary/40 hover:text-primary">
                    <ImagePlus className="h-3.5 w-3.5" /> صور
                    <input type="file" accept="image/*" multiple className="hidden"
                      onChange={(e) => { addFiles(c.gkey, e.target.files); e.currentTarget.value = ""; }} />
                  </label>
                  <Input
                    type="number" min={0} required placeholder="الكمية *" className="max-w-[110px]"
                    value={c.quantity}
                    onChange={(e) => setColors((rows) => rows.map((r, j) => j === i ? { ...r, quantity: e.target.value } : r))}
                  />

                  <Button size="icon" variant="ghost" type="button" aria-label="حذف الصف"
                    onClick={() => removeColorGroup(i)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>


                {isFirstRowOfColor(i) && (
                <div className="flex flex-wrap gap-2">
                  {imagesForGroup(c.id, c.gkey).map((img) => (
                    <div key={img.id} className="relative">
                      <img src={img.url} alt={c.label}
                        className="h-14 w-14 rounded-lg border border-border/60 object-cover" />
                      <button type="button" aria-label="حذف الصورة"
                        onClick={() => delImg.mutate(img.id)}
                        className="absolute -left-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-destructive text-destructive-foreground">
                        <X className="h-2.5 w-2.5" />
                      </button>
                      {!analyzedIds.has(img.id) && (
                      <button type="button"
                        onClick={() => analyze.mutate({ imageId: img.id, colorIndex: i })}
                        disabled={analyze.isPending}
                        className="mt-1 flex w-14 items-center justify-center gap-0.5 rounded-md border border-border/60 bg-background px-1 py-0.5 text-[9px] transition hover:border-primary/40 hover:text-primary disabled:opacity-60">
                        {analyzingId === img.id
                          ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          : <Sparkles className="h-2.5 w-2.5" />}
                        تحليل
                      </button>
                      )}
                    </div>
                  ))}
                  {(pending[c.gkey] ?? []).map((f, k) => (
                    <div key={`p-${k}`} className="relative">
                      <img src={URL.createObjectURL(f)} alt={f.name}
                        className="h-14 w-14 rounded-lg border border-dashed border-primary/50 object-cover" />
                      <button type="button" aria-label="إزالة"
                        onClick={() => setPending((prev) => ({
                          ...prev,
                          [c.gkey]: (prev[c.gkey] ?? []).filter((_, j) => j !== k),
                        }))}
                        className="absolute -left-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-destructive text-destructive-foreground">
                        <X className="h-2.5 w-2.5" />
                      </button>
                      <GroupPicker fromKey={c.gkey} index={k} />
                    </div>
                  ))}
                </div>
                )}
              </div>
            ))}
          </div>
        </div>


        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !!grouping || !name.trim()}>
            {save.isPending ? <Loader2 className="ml-1 h-4 w-4 animate-spin" /> : null}
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

