/**
 * Website Management: explicit site state (site_created / site_status),
 * "Create Website" and "Publish" server actions. All operations use the
 * service-role client under a validated session (requireUserId).
 */
import { createServerFn } from "@tanstack/react-start";

function bad(m: string): never {
  throw new Error(m);
}

function slugify(input: string): string {
  return String(input ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u0600-\u06ff]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export interface SiteState {
  site_created: boolean;
  site_status: "draft" | "published" | "unpublished";
  brand_name: string | null;
  brand_slug: string | null;
  description: string | null;
  logo_url: string | null;
  theme_key: string | null;
  public_url: string | null;
}

async function loadState(userId: string): Promise<SiteState> {
  const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("merchants")
    .select("brand_name, brand_slug, site_created, site_status, description, logo_url, theme_key")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) {
    return {
      site_created: false, site_status: "draft",
      brand_name: null, brand_slug: null,
      description: null, logo_url: null, theme_key: null,
      public_url: null,
    };
  }
  return {
    site_created: Boolean(data.site_created),
    site_status: (data.site_status as SiteState["site_status"]) ?? "draft",
    brand_name: (data.brand_name as string | null) ?? null,
    brand_slug: (data.brand_slug as string | null) ?? null,
    description: (data.description as string | null) ?? null,
    logo_url: (data.logo_url as string | null) ?? null,
    theme_key: (data.theme_key as string | null) ?? null,
    public_url: data.brand_slug ? `/c/${data.brand_slug}` : null,
  };
}

export const getSiteState = createServerFn({ method: "GET" }).handler(
  async (): Promise<SiteState> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { userId } = await requireUserId();
    return loadState(userId);
  },
);

export const createWebsite = createServerFn({ method: "POST" })
  .inputValidator((d: { brand_name: string }) => {
    const name = (d?.brand_name ?? "").trim();
    if (name.length < 2) bad("Please enter a brand name (min 2 characters).");
    if (name.length > 80) bad("Brand name too long (max 80).");
    return { brand_name: name };
  })
  .handler(async ({ data }): Promise<SiteState> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();

    const base = slugify(data.brand_name) || "store";
    // Try base slug, then base-2, base-3, … until unique.
    let slug = base;
    for (let i = 2; i < 50; i++) {
      const { data: hit } = await admin
        .from("merchants")
        .select("id, user_id")
        .ilike("brand_slug", slug)
        .maybeSingle();
      if (!hit || hit.user_id === userId) break;
      slug = `${base}-${i}`;
    }

    const { error } = await admin
      .from("merchants")
      .upsert(
        {
          user_id: userId,
          brand_name: data.brand_name,
          brand_slug: slug,
          site_created: true,
          site_status: "draft",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);
    return loadState(userId);
  });

export const publishSite = createServerFn({ method: "POST" }).handler(
  async (): Promise<SiteState> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();
    const state = await loadState(userId);
    if (!state.site_created) throw new Error("Create the website first.");
    const { error } = await admin
      .from("merchants")
      .update({ site_status: "published", updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return loadState(userId);
  },
);

export const unpublishSite = createServerFn({ method: "POST" }).handler(
  async (): Promise<SiteState> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from("merchants")
      .update({ site_status: "unpublished", updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return loadState(userId);
  },
);
// ---------------------------------------------------------------------------
// Website Identity (name / description / logo / theme) — auto-saved from UI
// with no explicit publish button.
// ---------------------------------------------------------------------------
export const updateWebsiteIdentity = createServerFn({ method: "POST" })
  .inputValidator((d: {
    brand_name?: string | null;
    description?: string | null;
    logo_url?: string | null;
    theme_key?: string | null;
  }) => ({
    brand_name: typeof d?.brand_name === "string" ? d.brand_name.trim().slice(0, 80) : undefined,
    description: typeof d?.description === "string" ? d.description.slice(0, 2000) : undefined,
    logo_url: typeof d?.logo_url === "string" ? d.logo_url.slice(0, 1000) : undefined,
    theme_key: typeof d?.theme_key === "string" ? d.theme_key.slice(0, 40) : undefined,
  }))
  .handler(async ({ data }): Promise<SiteState> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.brand_name !== undefined) patch.brand_name = data.brand_name || null;
    if (data.description !== undefined) patch.description = data.description || null;
    if (data.logo_url !== undefined) patch.logo_url = data.logo_url || null;
    if (data.theme_key !== undefined) patch.theme_key = data.theme_key || null;

    // Load existing row to decide upsert path.
    const { data: existing } = await admin.from("merchants")
      .select("id, brand_slug, brand_name, site_created").eq("user_id", userId).maybeSingle();

    if (existing) {
      // If brand_name is set and no slug yet, mint one.
      const wantsSlug = (patch.brand_name || existing.brand_name) && !existing.brand_slug;
      if (wantsSlug) {
        const base = slugify(String(patch.brand_name ?? existing.brand_name ?? "store")) || "store";
        let slug = base;
        for (let i = 2; i < 50; i++) {
          const { data: hit } = await admin.from("merchants")
            .select("user_id").ilike("brand_slug", slug).maybeSingle();
          if (!hit || hit.user_id === userId) break;
          slug = `${base}-${i}`;
        }
        patch.brand_slug = slug;
        patch.site_created = true;
      }
      const { error } = await admin.from("merchants").update(patch).eq("user_id", userId);
      if (error) throw new Error(error.message);
    } else {
      // Insert; requires brand_name.
      const name = String(patch.brand_name ?? "").trim();
      if (name.length < 2) bad("Enter a website name first.");
      const base = slugify(name) || "store";
      let slug = base;
      for (let i = 2; i < 50; i++) {
        const { data: hit } = await admin.from("merchants")
          .select("id").ilike("brand_slug", slug).maybeSingle();
        if (!hit) break;
        slug = `${base}-${i}`;
      }
      const { error } = await admin.from("merchants").insert({
        user_id: userId,
        brand_name: name,
        brand_slug: slug,
        description: patch.description ?? null,
        logo_url: patch.logo_url ?? null,
        theme_key: patch.theme_key ?? null,
        site_created: true,
        site_status: "draft",
      });
      if (error) throw new Error(error.message);
    }

    return loadState(userId);
  });


// Upload the site logo to the public `site-logo` storage bucket. Returns the
// permanent public URL (bucket must be public).
export const uploadWebsiteLogo = createServerFn({ method: "POST" })
  .inputValidator((d: { file_name: string; mime_type: string; base64: string }) => {
    if (!d?.base64) bad("Missing file.");
    if (!/^image\//.test(d.mime_type ?? "")) bad("Logo must be an image.");
    return d;
  })
  .handler(async ({ data }): Promise<{ url: string }> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();

    const BUCKET = "site-logo";
    const clean = String(data.file_name).replace(/[^\w.\-]+/g, "_");
    const path = `${userId}/${Date.now()}-${clean}`;
    const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
      contentType: data.mime_type, upsert: true,
    });
    if (error) throw new Error(`Logo upload failed: ${error.message}`);
    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
    return { url: pub.publicUrl };
  });
