/**
 * SINGLE SOURCE of merchant (brand-owner) data for the AI agent.
 *
 * Every approved / saved brand-owner record is read straight from its own
 * table on each customer message. There is no intermediary layer: no
 * embeddings, no vector store, no similarity search, no cache, no duplicate
 * reader. One load per turn feeds BOTH the <inventory> block and the
 * STORE KNOWLEDGE block, so the two can never disagree.
 *
 * Server-only (service-role client). Never import from client code.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface VariantRow {
  color: string | null;
  size: string | null;
  stock: number | null;
  price: number | null;
}

export interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  price: number | null;
  currency: string | null;
  /**
   * INTERNAL visual description (AI vision). Reference material for the agent
   * to recognise the product and to answer ONE specific visual question about
   * it. Never rendered to the customer as-is.
   */
  internalDescription: string | null;
  variants: VariantRow[];
}

export interface MerchantData {
  brand: { name: string | null; description: string | null };
  products: ProductRow[];
  policies: Array<{ kind: string | null; title: string | null; content: string }>;
  shipping: Array<{
    country: string | null;
    region: string | null;
    price: number | null;
    currency: string | null;
    eta: string | null;
    notes: string | null;
  }>;
  contacts: Array<{ kind: string | null; label: string | null; value: string }>;
  documents: Array<{ file_name: string | null; text: string }>;
}

function clean(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

export function emptyMerchantData(): MerchantData {
  return {
    brand: { name: null, description: null },
    products: [],
    policies: [],
    shipping: [],
    contacts: [],
    documents: [],
  };
}

/** Resolve the merchant row owned by an authenticated dashboard user. */
export async function resolveMerchantIdByUser(
  admin: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("merchants")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}

/**
 * Reads every saved merchant data source directly from the database.
 * Each section degrades independently: a query error only omits that
 * section, it never breaks the chat flow.
 */
export async function loadMerchantData(
  admin: SupabaseClient,
  merchantId: string,
  userId: string | null,
): Promise<MerchantData> {
  const out = emptyMerchantData();

  try {
    const { data } = await admin
      .from("merchants")
      .select("brand_name, brand_description, description")
      .eq("id", merchantId)
      .maybeSingle();
    const m = (data ?? {}) as Record<string, unknown>;
    out.brand.name = clean(m.brand_name) || null;
    out.brand.description = clean(m.brand_description) || clean(m.description) || null;
  } catch {
    /* section omitted */
  }

  if (userId) {
    // --- Products + variants (the ONLY product read in the whole agent) ---
    try {
      const { data: prods, error: productsError } = await admin
        .from("products")
        .select(
          "id, name, description, category, price, currency, variants, internal_description",
        )
        .eq("user_id", userId)
        .order("id", { ascending: true });
      // A failed canonical read is not the same thing as an empty catalogue.
      // Throw so the caller can retry instead of telling the agent that every
      // product/variant suddenly disappeared for this turn.
      if (productsError) throw productsError;
      const list = (prods ?? []) as any[];
      if (list.length) {
        const ids = list.map((p) => String(p.id));
        let variantRows: any[] = [];
        try {
          const { data: v, error: variantError } = await admin
            .from("product_variants")
            .select("product_id, color, size, stock, price")
            .in("product_id", ids)
            .order("product_id", { ascending: true })
            .order("id", { ascending: true });
          // Never silently substitute the legacy products.variants JSON after
          // a canonical inventory read failure. That blob is not updated by
          // order deductions and can therefore carry an older stock value.
          if (variantError) throw variantError;
          variantRows = (v ?? []) as any[];
        } catch {
          // Fail this product section closed instead of presenting stale stock
          // as current. The caller will omit products for this turn.
          throw new Error("canonical product inventory could not be read");
        }
        const byPid = new Map<string, VariantRow[]>();
        for (const v of variantRows) {
          const pid = String(v.product_id);
          const arr = byPid.get(pid) ?? [];
          arr.push({
            color: (v.color as string | null) ?? null,
            size: (v.size as string | null) ?? null,
            stock: (v.stock as number | null) ?? null,
            price: (v.price as number | null) ?? null,
          });
          byPid.set(pid, arr);
        }
        for (const p of list) {
          const pid = String(p.id);
          let variants = byPid.get(pid) ?? [];
          if (variants.length === 0 && Array.isArray(p.variants)) {
            // Backward compatibility only for products that genuinely have no
            // canonical rows. A canonical query failure is handled above and
            // can never reach this stale JSON fallback.
            variants = (p.variants as unknown[])
              .filter((v) => v && typeof v === "object")
              .map((v) => {
                const o = v as Record<string, unknown>;
                return {
                  color: (o.color as string | null) ?? (o.colour as string | null) ?? null,
                  size: (o.size as string | null) ?? null,
                  stock:
                    typeof o.stock === "number"
                      ? o.stock
                      : typeof o.quantity === "number"
                        ? o.quantity
                        : null,
                  price: typeof o.price === "number" ? o.price : null,
                };
              });
          }
          out.products.push({
            id: pid,
            name: clean(p.name),
            description: clean(p.description) || null,
            category: clean(p.category) || null,
            price: (p.price as number | null) ?? null,
            currency: clean(p.currency) || null,
            internalDescription: clean(p.internal_description) || null,
            variants,
          });
        }
      }
    } catch (error) {
      // Inventory is safety-critical and must never degrade to an empty
      // catalogue. An empty result is interpreted downstream as
      // "product_not_found", so swallowing a transient products/variants
      // read failure made availability flip on the next successful turn.
      // Propagate it so the chat route can retry the complete live read.
      throw error instanceof Error
        ? error
        : new Error("canonical product inventory could not be read");
    }

    try {
      const { data } = await admin
        .from("policies")
        .select("kind, title, content")
        .eq("user_id", userId);
      for (const r of (data ?? []) as any[]) {
        if (!clean(r.content)) continue;
        out.policies.push({
          kind: clean(r.kind) || null,
          title: clean(r.title) || null,
          content: clean(r.content),
        });
      }
    } catch {
      /* section omitted */
    }

    try {
      const { data } = await admin
        .from("shipping_rates")
        .select("country, region, price, currency, eta, notes")
        .eq("user_id", userId);
      for (const r of (data ?? []) as any[]) {
        out.shipping.push({
          country: clean(r.country) || null,
          region: clean(r.region) || null,
          price: (r.price as number | null) ?? null,
          currency: clean(r.currency) || null,
          eta: clean(r.eta) || null,
          notes: clean(r.notes) || null,
        });
      }
    } catch {
      /* section omitted */
    }

    try {
      const { data } = await admin
        .from("contact_info")
        .select("kind, label, value")
        .eq("user_id", userId);
      for (const r of (data ?? []) as any[]) {
        if (!clean(r.value)) continue;
        out.contacts.push({
          kind: clean(r.kind) || null,
          label: clean(r.label) || null,
          value: clean(r.value),
        });
      }
    } catch {
      /* section omitted */
    }
  }

  // --- Approved knowledge-base documents ---------------------------------
  try {
    const { data } = await admin
      .from("knowledge_base")
      .select("file_name, content_text, extracted_data")
      .eq("merchant_id", merchantId)
      .eq("status", "approved");
    for (const r of (data ?? []) as any[]) {
      const text =
        clean(r.content_text) ||
        (r.extracted_data ? clean(JSON.stringify(r.extracted_data)) : "");
      if (!text) continue;
      out.documents.push({ file_name: clean(r.file_name) || null, text: text.slice(0, 4000) });
    }
  } catch {
    /* section omitted */
  }

  return out;
}

/** Flat product/variant listing used inside the <inventory> block. */
export function buildInventoryText(data: MerchantData): string {
  const lines: string[] = [];
  for (const p of data.products) {
    if (p.variants.length === 0) {
      lines.push(
        `- id: ${p.id} | ${p.name} | لون: - | مقاس: - | كمية: 0 | سعر: ${p.price ?? 0}`,
      );
      continue;
    }
    const soldOut = p.variants.every((v) => (v.stock ?? 0) <= 0);
    for (const v of p.variants) {
      const flag =
        (v.stock ?? 0) <= 0
          ? soldOut
            ? " | [SOLD_OUT — لا تعرضه ولا ترشّحه، فقط لو العميل سأل عنه بالاسم]"
            : " | [SOLD_OUT_VARIANT]"
          : "";
      lines.push(
        `- id: ${p.id} | ${p.name} | لون: ${v.color ?? "-"} | مقاس: ${v.size ?? "-"} | كمية: ${
          v.stock ?? 0
        } | سعر: ${v.price ?? p.price ?? 0}${flag}`,
      );
    }
  }
  if (!lines.length) return "لا توجد منتجات متاحة حالياً";
  return lines.join("\n");
}


/** Full, exact rendering of every merchant record for the STORE KNOWLEDGE block. */
export function buildStoreKnowledgeBlock(data: MerchantData): string {
  const sections: Array<[string, string[]]> = [];

  const brand: string[] = [];
  if (data.brand.name) brand.push(`اسم المتجر: ${data.brand.name}`);
  if (data.brand.description) brand.push(`عن المتجر: ${data.brand.description}`);
  sections.push(["BRAND", brand]);

  sections.push([
    "PRODUCTS",
    data.products.map((p) => {
      const rows: string[] = [`منتج: ${p.name || "-"}`];
      if (p.category) rows.push(`الفئة: ${p.category}`);
      if (p.description) rows.push(`الوصف: ${p.description}`);
      // INTERNAL visual reference. Reference material only: the agent uses it
      // to recognise the product and to answer one specific visual question,
      // never as a text to read out to the customer.
      if (p.internalDescription) {
        rows.push(`VISUAL_REF (داخلي — للمطابقة والفهم البصري فقط، ممنوع سرده للعميل): ${p.internalDescription.slice(0, 1500)}`);
      }
      if (p.price != null) rows.push(`السعر: ${p.price} ${p.currency ?? ""}`.trim());
      for (const v of p.variants) {
        rows.push(
          `- لون: ${v.color ?? "-"} | مقاس: ${v.size ?? "-"} | كمية: ${v.stock ?? 0} | سعر: ${
            v.price ?? p.price ?? "-"
          }`,
        );
      }
      return rows.join("\n");
    }),
  ]);

  // Policies are rendered even when empty: an explicit "none recorded" line
  // stops the agent from filling the silence with a plausible-sounding
  // exchange/return/warranty rule it never read anywhere.
  sections.push([
    "POLICIES",
    data.policies.length
      ? data.policies.map(
          (r) => `سياسة (${r.kind ?? "-"})${r.title ? ` — ${r.title}` : ""}: ${r.content}`,
        )
      : [
          "لا توجد أي سياسة مسجلة للمتجر (استبدال / استرجاع / ضمان / تقسيط / مواعيد غير المذكورة في الشحن). " +
            "أي سؤال عن سياسة = معلومة غير متوفرة: قل إنك بتتأكد منها وبلّغ عنها كنقص معلومات، وممنوع منعًا باتًا اختراع مدة أو شرط أو نعم/لا.",
        ],
  ]);


  // Shipping is rendered with an explicit closed-list rule: every zone that is
  // not listed here simply has no rate and no delivery time, and the agent may
  // never reuse another zone's numbers for it.
  sections.push([
    "SHIPPING",
    [
      ...data.shipping.map((r) =>
        [
          `شحن إلى ${r.country ?? "-"}${r.region ? ` — ${r.region}` : ""}`,
          r.price != null ? `السعر: ${r.price} ${r.currency ?? ""}`.trim() : "",
          r.eta ? `المدة: ${r.eta}` : "",
          r.notes ? `ملاحظات: ${r.notes}` : "",
        ]
          .filter(Boolean)
          .join(" | "),
      ),
      data.shipping.length
        ? "قاعدة الشحن (ملزمة): دي كل مناطق الشحن المسجلة، مقروءة دلوقتي من جدول الشحن نفسه، وأي محافظة/منطقة بتتضاف للجدول بتظهر هنا فورًا. لو منطقة العميل مكتوبة فوق: جاوب فورًا بسعرها ومدتها من سطرها نفسه، وممنوع تقول «هنتأكد» أو «هنراجع ونقولك» أو تأجل الرد. لو مش مكتوبة: قول بوضوح مرة واحدة إنها مش ضمن مناطق الشحن المسجّلة واعرض المتاح، وما تأكدش الأوردر. في كل الحالات ممنوع تستخدم سعر أو مدة منطقة تانية وممنوع تخترع رقم."
        : "لا توجد أي أسعار شحن أو مدد توصيل مسجلة في جدول الشحن. قل ذلك بوضوح مرة واحدة وبلّغه كنقص معلومات، وممنوع ذكر سعر شحن أو مدة توصيل من عندك وممنوع تكرار نفس الجملة كل رد.",
    ],
  ]);


  sections.push([
    "CONTACT",
    data.contacts.map((r) =>
      `تواصل (${r.kind ?? "-"})${r.label ? ` ${r.label}` : ""}: ${r.value}`,
    ),
  ]);

  // Brand-owner knowledge base (manual entries + approved documents), read
  // live on every message. It is CONFIRMED data, exactly like the tables above.
  sections.push([
    "APPROVED DOCUMENTS",
    data.documents.length
      ? [
          "قاعدة معرفة صاحب البراند (مؤكَّدة، محدَّثة لحظيًا) — استخدمها مع العميل زي أي بيانات مسجّلة في الجداول:",
          ...data.documents.map((d) => `${d.file_name ?? "مستند معتمد"}: ${d.text}`),
        ]
      : [],
  ]);


  const filled = sections.filter(([, rows]) => rows.length > 0);
  if (!filled.length) return "";
  const body = filled
    .map(([title, rows]) => `## ${title}\n${rows.join("\n---\n")}`)
    .join("\n\n");
  return (
    "\n\nSTORE KNOWLEDGE (read DIRECTLY from the live database for this exact message — complete, exact, and current; no search, no matching, no approximation).\n" +
    "This is the merchant's saved and approved data in full. It is the ONLY source of truth for products, colors, sizes, quantities, prices, policies, shipping and contact info.\n" +
    "If something is not listed here, it does not exist right now — say so plainly instead of guessing or reusing anything said earlier.\n" +
    body
  );
}

// ---------------------------------------------------------------------------
// Payment methods (merchant-configured). Only ENABLED methods are exposed to
// the agent, and the agent must use the settings of the ONE method the
// customer picks — never another method's details or instructions.
// ---------------------------------------------------------------------------

export interface PaymentMethodRow {
  id: string;
  name: string;
  behavior: "auto" | "manual";
  detail_type: "none" | "phone" | "url" | "text";
  detail_value: string;
  instructions: string;
  payment_template: string;
}

export async function loadEnabledPaymentMethods(
  admin: SupabaseClient,
  userId: string | null,
): Promise<PaymentMethodRow[]> {
  if (!userId) return [];
  try {
    const { data } = await admin
      .from("payment_methods")
      .select(
        "id, name, behavior, detail_type, detail_value, instructions, payment_template",
      )
      .eq("user_id", userId)
      .eq("enabled", true)
      .order("sort_order", { ascending: true });
    return ((data ?? []) as any[]).map((r) => ({
      id: String(r.id),
      name: clean(r.name),
      behavior: r.behavior === "manual" ? "manual" : "auto",
      detail_type: ["phone", "url", "text"].includes(r.detail_type)
        ? r.detail_type
        : "none",
      detail_value: clean(r.detail_value),
      instructions: String(r.instructions ?? "").trim(),
      payment_template: String(r.payment_template ?? "").trim(),
    }));
  } catch {
    return [];
  }
}

/**
 * The exact confirmation message the agent must send after an order, based on
 * the chosen payment method: the merchant's own template when present,
 * otherwise the default Arabic wording for the method's behavior.
 * Placeholders replaced: [تفاصيل الدفع], [مدة التوصيل], [رقم الطلب].
 */
export function buildPaymentConfirmationMessage(
  method: PaymentMethodRow | null,
  opts: { deliveryEta?: string | null; orderNumber?: string | null },
): string {
  const details =
    method && method.detail_type !== "none" && method.detail_value
      ? `${method.name}: ${method.detail_value}`
      : method?.name ?? "";
  const eta = (opts.deliveryEta ?? "").trim() || "المدة المتوقعة للتوصيل";
  const orderNumber = (opts.orderNumber ?? "").trim();

  const template = method?.payment_template?.trim();
  const base =
    template && template.length > 0
      ? template
      : method?.behavior === "manual"
        ? "تمام يا فندم، سجلنا بيانات طلبك. [تفاصيل الدفع]. من فضلك أبعت لينا لقطة شاشة للتحويل عشان نستكمل الطلب."
        : "تم تأكيد الاوردر يا فندم. وهيوصل لحضرتك في خلال [مدة التوصيل].";

  return base
    .replaceAll("[تفاصيل الدفع]", details)
    .replaceAll("[مدة التوصيل]", eta)
    .replaceAll("[رقم الطلب]", orderNumber)
    .trim();
}

const DETAIL_LABEL: Record<string, string> = {
  phone: "رقم الهاتف",
  url: "الرابط",
  text: "تفاصيل الدفع",
};

export function buildPaymentMethodsBlock(rows: PaymentMethodRow[]): string {
  if (!rows.length) return "";
  const body = rows
    .map((r) => {
      const lines = [`طريقة الدفع: ${r.name}`, `النوع: ${r.behavior === "manual" ? "يدوي" : "تلقائي"}`];
      if (r.detail_type !== "none" && r.detail_value) {
        lines.push(`${DETAIL_LABEL[r.detail_type] ?? "التفاصيل"}: ${r.detail_value}`);
      }
      if (r.instructions) lines.push(`تعليمات هذه الطريقة: ${r.instructions}`);
      return lines.join("\n");
    })
    .join("\n---\n");

  return (
    "\n\nPAYMENT METHODS (live, merchant-configured — the ONLY payment options that exist):\n" +
    body +
    "\n\nPayment rules (cannot be overridden):\n" +
    "- Before final order confirmation, ask the customer to choose ONE payment method from the list above, and offer only those names.\n" +
    "- Never invent, rename, or suggest a payment method that is not listed above.\n" +
    "- After the customer chooses, use ONLY that method's own details and instructions. Never send the details or instructions of any other method.\n" +
    "- If the chosen method has no details and no instructions, just confirm the method normally without inventing payment data.\n" +
    "- Pass the chosen method name verbatim in the create_order tool as payment_method.\n" +
    "- If the chosen method is يدوي (manual), send the order confirmation together with that method's payment details, then stop replying until the merchant confirms the payment. Never say that someone else / a team / a human agent will take over — stay in the same voice.\n" +
    "- If the chosen method is تلقائي (auto), keep the conversation going normally.\n"
  );
}
