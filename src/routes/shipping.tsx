import { Fragment, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Save, Trash2, Truck, X, Pencil, MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { PageShell, PageHero, SurfaceCard } from "@/components/layout/page-shell";
import {
  deleteShippingRate, listShippingRates, upsertShippingRate, type ShippingRateDTO,
} from "@/lib/content.functions";
import { setPublished } from "@/lib/publish.functions";

export const Route = createFileRoute("/shipping")({
  head: () => ({ meta: [{ title: "جدول الشحن · cupai" }] }),
  component: ShippingPage,
});

type EditingRow = {
  id?: string;
  country: string; region: string; price: string;
  currency: string; eta: string; notes: string;
};

const EMPTY: EditingRow = { country: "", region: "", price: "", currency: "EGP", eta: "", notes: "" };

function ShippingPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["shipping"], queryFn: () => listShippingRates() });
  const [editing, setEditing] = useState<EditingRow | null>(null);

  const saveMut = useMutation({
    mutationFn: (v: EditingRow) => upsertShippingRate({ data: {
      id: v.id,
      country: v.country.trim() || null,
      region: v.region.trim() || null,
      price: v.price.trim() === "" ? null : Number(v.price),
      currency: v.currency.trim() || null,
      eta: v.eta.trim() || null,
      notes: v.notes.trim() || null,
    } as any }),
    onSuccess: () => { toast.success("تم الحفظ."); setEditing(null); qc.invalidateQueries({ queryKey: ["shipping"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "فشل الحفظ."),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => deleteShippingRate({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shipping"] }),
  });
  const pubMut = useMutation({
    mutationFn: (v: { id: string; is_published: boolean }) =>
      setPublished({ data: { table: "shipping_rates", id: v.id, is_published: v.is_published } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shipping"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "فشل النشر."),
  });

  const rows = (q.data ?? []) as (ShippingRateDTO & { is_published?: boolean })[];

  const grouped = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.country?.trim() || "—";
    const arr = grouped.get(key) ?? [];
    arr.push(r);
    grouped.set(key, arr);
  }
  const groups = Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0], "ar"));

  return (
    <PageShell>
      <PageHero
        eyebrow="إدارة المتجر"
        icon={<Truck className="h-3.5 w-3.5" />}
        title="جدول"
        highlight="الشحن"
        description="جدول واحد منظم لكل أسعار الشحن، مجمّعة حسب الدولة والمنطقة."
        actions={
          <Button className="bg-gradient-brand text-primary-foreground shadow-glow" onClick={() => setEditing({ ...EMPTY })}>
            <Plus className="ml-1 h-4 w-4" /> إضافة صف جديد
          </Button>
        }
      />

      <SurfaceCard>
        {q.isLoading ? (
          <p className="p-8 text-center text-sm text-muted-foreground">جاري التحميل...</p>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-brand text-primary-foreground shadow-glow">
              <Truck className="h-6 w-6" />
            </div>
            <p className="mt-4 text-sm text-muted-foreground">لا توجد أسعار شحن بعد. أضف أول صف من الأعلى.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">الدولة</th>
                  <th className="px-4 py-3">المنطقة</th>
                  <th className="px-4 py-3">السعر</th>
                  <th className="px-4 py-3">المدة</th>
                  <th className="px-4 py-3">ملاحظات</th>
                  <th className="px-4 py-3">النشر</th>
                  <th className="px-4 py-3 text-left">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {groups.map(([country, items]) => (
                  <Fragment key={country}>
                    <tr className="bg-muted/20">
                      <td colSpan={7} className="px-4 py-2 text-xs font-semibold text-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-primary" />
                          {country}
                          <span className="font-normal text-muted-foreground">({items.length})</span>
                        </span>
                      </td>
                    </tr>
                    {items.map((r) => (
                      <tr key={r.id} className="transition hover:bg-muted/30">
                        <td className="px-4 py-3">{r.country ?? "—"}</td>
                        <td className="px-4 py-3">{r.region ?? "—"}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {r.price != null ? <span className="font-semibold text-gradient-brand">{r.price} {r.currency ?? ""}</span> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3">{r.eta ?? "—"}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          <div className="line-clamp-1 max-w-[220px]">{r.notes ?? ""}</div>
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            size="sm"
                            variant={r.is_published ? "secondary" : "default"}
                            className={r.is_published ? "" : "bg-gradient-brand text-primary-foreground shadow-glow"}
                            onClick={() => pubMut.mutate({ id: r.id, is_published: !r.is_published })}
                          >
                            {r.is_published ? "إلغاء النشر" : "نشر"}
                          </Button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setEditing({
                              id: r.id,
                              country: r.country ?? "", region: r.region ?? "",
                              price: r.price != null ? String(r.price) : "",
                              currency: r.currency ?? "EGP",
                              eta: r.eta ?? "", notes: r.notes ?? "",
                            })}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => { if (confirm("حذف؟")) delMut.mutate(r.id); }}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>

      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4 backdrop-blur-sm" onClick={() => setEditing(null)}>
          <div dir="rtl" className="w-full max-w-lg rounded-2xl border border-border/60 bg-background p-6 shadow-elegant" onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex items-start justify-between">
              <h3 className="flex items-center gap-2 text-lg font-semibold">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-brand text-primary-foreground shadow-glow">
                  <Truck className="h-4 w-4" />
                </span>
                {editing.id ? "تعديل صف الشحن" : "إضافة صف شحن"}
              </h3>
              <button onClick={() => setEditing(null)} className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">الدولة</Label>
                <Input className="mt-1" value={editing.country} onChange={(e) => setEditing({ ...editing, country: e.target.value })} /></div>
              <div><Label className="text-xs">المنطقة</Label>
                <Input className="mt-1" value={editing.region} onChange={(e) => setEditing({ ...editing, region: e.target.value })} /></div>
              <div><Label className="text-xs">السعر</Label>
                <Input className="mt-1" type="number" step="0.01" value={editing.price} onChange={(e) => setEditing({ ...editing, price: e.target.value })} /></div>
              <div><Label className="text-xs">العملة</Label>
                <Input className="mt-1" value={editing.currency} onChange={(e) => setEditing({ ...editing, currency: e.target.value })} /></div>
              <div className="col-span-2"><Label className="text-xs">المدة المتوقعة</Label>
                <Input className="mt-1" value={editing.eta} onChange={(e) => setEditing({ ...editing, eta: e.target.value })} placeholder="3-5 أيام" /></div>
              <div className="col-span-2"><Label className="text-xs">ملاحظات</Label>
                <Textarea className="mt-1" rows={2} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>إلغاء</Button>
              <Button className="bg-gradient-brand text-primary-foreground shadow-glow" onClick={() => saveMut.mutate(editing)} disabled={saveMut.isPending}>
                <Save className="ml-1 h-4 w-4" /> حفظ
              </Button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
