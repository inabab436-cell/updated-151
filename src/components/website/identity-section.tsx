import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Globe, Upload, ImageIcon, Palette } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  updateWebsiteIdentity,
  uploadWebsiteLogo,
  type SiteState,
} from "@/lib/website.functions";

// Ten fixed, tasteful palettes. Each merchant picks (or is auto-assigned) one.
export const THEMES: Record<string, { name: string; primary: string; secondary: string; accent: string; bg: string; }> = {
  espresso: { name: "Espresso", primary: "#5b3a29", secondary: "#c9a27a", accent: "#d97706", bg: "#faf6f0" },
  ocean:    { name: "Ocean",    primary: "#0f4c81", secondary: "#7bb6d9", accent: "#f97316", bg: "#f4f9fd" },
  emerald:  { name: "Emerald",  primary: "#065f46", secondary: "#6ee7b7", accent: "#f59e0b", bg: "#f2faf6" },
  plum:     { name: "Plum",     primary: "#5b21b6", secondary: "#c4b5fd", accent: "#ec4899", bg: "#f8f5fc" },
  slate:    { name: "Slate",    primary: "#1f2937", secondary: "#94a3b8", accent: "#3b82f6", bg: "#f8fafc" },
  rose:     { name: "Rose",     primary: "#9d174d", secondary: "#fda4af", accent: "#f59e0b", bg: "#fdf4f5" },
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? "");
      const idx = s.indexOf(",");
      res(idx >= 0 ? s.slice(idx + 1) : s);
    };
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

export function IdentitySection({ state }: { state: SiteState | undefined }) {
  const qc = useQueryClient();
  const [name, setName] = useState(state?.brand_name ?? "");
  const [description, setDescription] = useState(state?.description ?? "");
  const [logoUrl, setLogoUrl] = useState(state?.logo_url ?? "");
  const [themeKey, setThemeKey] = useState(state?.theme_key ?? "espresso");
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(state?.brand_name ?? "");
    setDescription(state?.description ?? "");
    setLogoUrl(state?.logo_url ?? "");
    setThemeKey(state?.theme_key ?? "espresso");
  }, [state?.brand_name, state?.description, state?.logo_url, state?.theme_key]);

  const saveMut = useMutation({
    mutationFn: (v: Parameters<typeof updateWebsiteIdentity>[0] extends { data?: infer D } ? D : any) =>
      updateWebsiteIdentity({ data: v as any }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["site-state"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed."),
  });

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      const base64 = await fileToBase64(file);
      const { url } = await uploadWebsiteLogo({
        data: { file_name: file.name, mime_type: file.type, base64 },
      });
      return url;
    },
    onSuccess: (url) => {
      setLogoUrl(url);
      saveMut.mutate({ logo_url: url });
      toast.success("Logo updated.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Upload failed."),
  });

  const commit = (patch: Record<string, unknown>) => {
    saveMut.mutate(patch as any);
  };

  return (
    <section className="rounded-xl border bg-background p-5 shadow-sm">
      <header className="mb-4 flex items-center gap-2">
        <Globe className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Enter Your Website Information</h2>
        <span className="ml-auto text-xs text-muted-foreground">
          Changes save automatically and appear on your live site.
        </span>
      </header>

      <div className="grid gap-4 md:grid-cols-[160px_1fr]">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2">
          <div className="grid h-32 w-32 place-items-center overflow-hidden rounded-full border bg-muted/40">
            {logoUrl ? (
              <img src={logoUrl} alt="Logo" className="h-full w-full object-cover" />
            ) : (
              <ImageIcon className="h-8 w-8 text-muted-foreground" />
            )}
          </div>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadMut.mutate(f);
              e.target.value = "";
            }}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={uploadMut.isPending}
            onClick={() => logoInputRef.current?.click()}
          >
            <Upload className="mr-1 h-4 w-4" />
            {uploadMut.isPending ? "Uploading…" : logoUrl ? "Replace logo" : "Upload logo"}
          </Button>
        </div>

        {/* Fields */}
        <div className="space-y-3">
          <div>
            <Label>Website Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if ((name ?? "").trim() !== (state?.brand_name ?? "")) commit({ brand_name: name.trim() });
              }}
              placeholder="e.g. Cup Coffee"
            />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => {
                if ((description ?? "") !== (state?.description ?? "")) commit({ description });
              }}
              placeholder="A short tagline for your storefront."
            />
          </div>

          <div>
            <Label className="flex items-center gap-1.5">
              <Palette className="h-3.5 w-3.5" /> Store color palette
            </Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(THEMES).map(([key, t]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setThemeKey(key); commit({ theme_key: key }); }}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition ${
                    themeKey === key ? "border-primary ring-2 ring-primary/30" : "hover:border-primary/50"
                  }`}
                >
                  <span className="flex gap-1">
                    <span className="h-4 w-4 rounded-full" style={{ background: t.primary }} />
                    <span className="h-4 w-4 rounded-full" style={{ background: t.secondary }} />
                    <span className="h-4 w-4 rounded-full" style={{ background: t.accent }} />
                  </span>
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
