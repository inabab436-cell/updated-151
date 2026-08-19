import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Save, Trash2, ScrollText, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { PageShell, PageHero, SurfaceCard, SectionHeader } from "@/components/layout/page-shell";
import {
  deletePolicy, listPolicies, upsertPolicy, type PolicyDTO,
} from "@/lib/content.functions";
import { setPublished } from "@/lib/publish.functions";

export const Route = createFileRoute("/policies")({
  head: () => ({ meta: [{ title: "السياسات · cupai" }] }),
  component: PoliciesPage,
});

const KINDS = ["shipping", "return", "refund", "warranty", "terms", "privacy", "other"];

const KIND_LABEL_AR: Record<string, string> = {
  shipping: "الشحن",
  return: "الاستبدال",
  refund: "الاسترجاع",
  warranty: "الضمان",
  terms: "الشروط",
  privacy: "الخصوصية",
  other: "أخرى",
};

function PoliciesPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["policies"], queryFn: () => listPolicies() });
  const [draft, setDraft] = useState<Partial<PolicyDTO>>({ kind: "shipping", title: "", content: "" });
  const [editing, setEditing] = useState<Record<string, Partial<PolicyDTO>>>({});

  const saveMut = useMutation({
    mutationFn: (p: Partial<PolicyDTO>) =>
      upsertPolicy({ data: { id: p.id, kind: p.kind ?? "other", title: p.title ?? "", content: p.content ?? "" } }),
    onSuccess: (_r, vars) => {
      toast.success("تم الحفظ.");
      if (!vars.id) setDraft({ kind: "shipping", title: "", content: "" });
      else setEditing((prev) => { const n = { ...prev }; delete n[vars.id!]; return n; });
      qc.invalidateQueries({ queryKey: ["policies"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "فشل الحفظ."),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => deletePolicy({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["policies"] }),
  });
  const pubMut = useMutation({
    mutationFn: (v: { id: string; is_published: boolean }) =>
      setPublished({ data: { table: "policies", id: v.id, is_published: v.is_published } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["policies"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "فشل النشر."),
  });

  return (
    <PageShell maxWidth="max-w-5xl">
      <PageHero
        eyebrow="إدارة المتجر"
        icon={<ScrollText className="h-3.5 w-3.5" />}
        title="السياسات"
        highlight="والشروط"
        description="أضف، عدّل، أو احذف سياسات متجرك يدوياً في أي وقت — الشحن، الاسترجاع، الضمان، والخصوصية."
      />

      <SurfaceCard>
        <SectionHeader
          icon={<Plus className="h-4 w-4" />}
          title="إضافة سياسة جديدة"
        />
        <div className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
            <div>
              <Label className="text-xs">النوع</Label>
              <select
                value={draft.kind ?? "other"}
                onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value }))}
                className="mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL_AR[k] ?? k}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">العنوان</Label>
              <Input value={draft.title ?? ""} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} className="mt-1" />
            </div>
          </div>
          <div>
            <Label className="text-xs">المحتوى</Label>
            <Textarea rows={5} className="mt-1" value={draft.content ?? ""} onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))} />
          </div>
          <div>
            <Button
              onClick={() => saveMut.mutate(draft)}
              disabled={saveMut.isPending || !draft.title}
              className="bg-gradient-brand text-primary-foreground shadow-glow"
            >
              <Save className="ml-1 h-4 w-4" />حفظ السياسة
            </Button>
          </div>
        </div>
      </SurfaceCard>

      <section className="space-y-3">
        {q.isLoading ? (
          <SurfaceCard className="p-6 text-center text-sm text-muted-foreground">جاري التحميل...</SurfaceCard>
        ) : (q.data ?? []).length === 0 ? (
          <SurfaceCard className="p-10 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-gradient-brand text-primary-foreground shadow-glow">
              <FileText className="h-5 w-5" />
            </div>
            <p className="mt-4 text-sm text-muted-foreground">لا توجد سياسات بعد. أضف أول سياسة من الأعلى.</p>
          </SurfaceCard>
        ) : (
          (q.data ?? []).map((p) => {
            const e = editing[p.id];
            const isEditing = !!e;
            return (
              <SurfaceCard key={p.id} className="p-5">
                {isEditing ? (
                  <div className="space-y-3">
                    <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
                      <select
                        value={e.kind ?? p.kind}
                        onChange={(ev) => setEditing((prev) => ({ ...prev, [p.id]: { ...prev[p.id], kind: ev.target.value } }))}
                        className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      >
                        {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL_AR[k] ?? k}</option>)}
                      </select>
                      <Input value={e.title ?? p.title} onChange={(ev) => setEditing((prev) => ({ ...prev, [p.id]: { ...prev[p.id], title: ev.target.value } }))} />
                    </div>
                    <Textarea rows={5} value={e.content ?? p.content} onChange={(ev) => setEditing((prev) => ({ ...prev, [p.id]: { ...prev[p.id], content: ev.target.value } }))} />
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" className="bg-gradient-brand text-primary-foreground shadow-glow" onClick={() => saveMut.mutate({ id: p.id, kind: e.kind ?? p.kind, title: e.title ?? p.title, content: e.content ?? p.content })}>
                        <Save className="ml-1 h-3.5 w-3.5" />حفظ
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing((prev) => { const n = { ...prev }; delete n[p.id]; return n; })}>إلغاء</Button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">{KIND_LABEL_AR[p.kind] ?? p.kind}</span>
                        <h3 className="truncate text-base font-semibold">{p.title}</h3>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{p.content}</p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setEditing((prev) => ({ ...prev, [p.id]: { ...p } }))}>تعديل</Button>
                      <Button
                        size="sm"
                        variant={(p as any).is_published ? "secondary" : "default"}
                        className={(p as any).is_published ? "" : "bg-gradient-brand text-primary-foreground shadow-glow"}
                        onClick={() => pubMut.mutate({ id: p.id, is_published: !(p as any).is_published })}
                      >
                        {(p as any).is_published ? "إلغاء النشر" : "نشر"}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => { if (confirm("حذف؟")) delMut.mutate(p.id); }}>
                        <Trash2 className="ml-1 h-3.5 w-3.5" />حذف
                      </Button>
                    </div>
                  </div>
                )}
              </SurfaceCard>
            );
          })
        )}
      </section>
    </PageShell>
  );
}
