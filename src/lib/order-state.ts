/**
 * STRUCTURED ORDER STATE — the single, persisted source of truth for the order
 * the customer is building in a conversation.
 *
 * Why this exists
 * ---------------
 * Before this module the order facts (product, colour, size, quantity, phone,
 * address, payment method) were re-derived from the chat transcript on EVERY
 * agent run. Any run whose re-extraction came back thin — a stalled helper
 * call, a long conversation, a customer message that only says "تمام" — made
 * the agent forget a decision that had already been taken and ask for it
 * again, or re-open a question that was already settled.
 *
 * The state below is stored on the conversation row (`conversations.order_state`)
 * and carried across runs. A run may only ever ADD to it or UPGRADE a field's
 * stage. It can never blank a field because this turn's extraction missed it.
 *
 * Stages (a value alone is NOT proof it was agreed)
 * -------------------------------------------------
 *   extracted → understood from what the customer said this/earlier turns
 *   verified  → checked against live store data (variant exists, has stock,
 *               shipping zone is covered, phone/address are usable)
 *   confirmed → the customer explicitly agreed to it (or it survived the
 *               order summary confirmation)
 *   committed → actually written into an order row; immutable afterwards
 *
 * Pure module: no network, no database, no environment. Callers load and save
 * the JSON blob.
 */

export const ORDER_STATE_FIELDS = [
  "name",
  "phone",
  "address",
  "product_name",
  "color",
  "size",
  "quantity",
  "payment_method",
  "shipping_zone",
] as const;

export type OrderStateField = (typeof ORDER_STATE_FIELDS)[number];

export type OrderStateStage = "extracted" | "verified" | "confirmed" | "committed";

const STAGE_RANK: Record<OrderStateStage, number> = {
  extracted: 1,
  verified: 2,
  confirmed: 3,
  committed: 4,
};

export interface OrderStateEntry {
  value: string;
  stage: OrderStateStage;
  at: string;
}

export interface OrderState {
  version: 1;
  fields: Partial<Record<OrderStateField, OrderStateEntry>>;
  /** Set once an order row exists for this conversation. */
  order_number: string | null;
  order_placed: boolean;
  updated_at: string | null;
}

export function emptyOrderState(): OrderState {
  return { version: 1, fields: {}, order_number: null, order_placed: false, updated_at: null };
}

function cleanValue(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (t === "-" || t.toLowerCase() === "null" || t.toLowerCase() === "undefined") return null;
  return t.length > 200 ? t.slice(0, 200) : t;
}

function sameValue(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[\u064B-\u0652]/g, "")
      .replace(/[أإآ]/g, "ا")
      .replace(/ة/g, "ه")
      .replace(/[^\p{L}\p{N}]+/gu, "");
  return norm(a) === norm(b);
}

function isStage(v: unknown): v is OrderStateStage {
  return v === "extracted" || v === "verified" || v === "confirmed" || v === "committed";
}

/** Tolerant reader: anything unexpected in the column degrades to empty state. */
export function parseOrderState(raw: unknown): OrderState {
  const out = emptyOrderState();
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  const fields = obj.fields;
  if (fields && typeof fields === "object") {
    for (const key of ORDER_STATE_FIELDS) {
      const entry = (fields as Record<string, unknown>)[key];
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const value = cleanValue(e.value);
      if (!value) continue;
      out.fields[key] = {
        value,
        stage: isStage(e.stage) ? e.stage : "extracted",
        at: typeof e.at === "string" ? e.at : new Date(0).toISOString(),
      };
    }
  }
  out.order_number = cleanValue(obj.order_number);
  out.order_placed = obj.order_placed === true || Boolean(out.order_number);
  out.updated_at = typeof obj.updated_at === "string" ? obj.updated_at : null;
  return out;
}

export type OrderStateInput = Partial<Record<OrderStateField, string | number | null | undefined>>;

export interface MergeOptions {
  now?: string;
  /** Stage applied to newly written values. Defaults to "extracted". */
  stage?: OrderStateStage;
  /**
   * Allow a differing incoming value to replace a value that is already
   * confirmed. Only true when the customer genuinely asked to change it.
   */
  allowChangeConfirmed?: boolean;
}

/**
 * Merges freshly understood values into the state.
 *
 * Rules (these are the whole point of the module):
 *  - A missing/empty incoming value NEVER clears a stored one.
 *  - A committed field is immutable.
 *  - Once the order is placed nothing changes any more.
 *  - An identical incoming value keeps the highest stage reached so far.
 *  - A genuinely different value replaces a stored `extracted`/`verified`
 *    value; a `confirmed` value only changes with `allowChangeConfirmed`.
 */
export function mergeOrderState(
  state: OrderState,
  incoming: OrderStateInput,
  opts: MergeOptions = {},
): OrderState {
  const now = opts.now ?? new Date().toISOString();
  const stage = opts.stage ?? "extracted";
  const next: OrderState = {
    ...state,
    fields: { ...state.fields },
  };

  for (const key of ORDER_STATE_FIELDS) {
    const value = cleanValue(incoming[key]);
    if (!value) continue;
    const prev = next.fields[key];
    if (!prev) {
      next.fields[key] = { value, stage, at: now };
      continue;
    }
    if (prev.stage === "committed") continue;
    if (sameValue(prev.value, value)) {
      // Same decision seen again — keep it, never downgrade the stage.
      if (STAGE_RANK[stage] > STAGE_RANK[prev.stage]) {
        next.fields[key] = { value: prev.value, stage, at: now };
      }
      continue;
    }
    if (prev.stage === "confirmed" && !opts.allowChangeConfirmed) continue;
    next.fields[key] = { value, stage, at: now };
  }

  next.updated_at = now;
  return next;
}

/** Upgrades the stage of fields that already hold a value. Never downgrades. */
export function promoteOrderState(
  state: OrderState,
  fields: readonly OrderStateField[],
  stage: OrderStateStage,
  now = new Date().toISOString(),
): OrderState {
  const next: OrderState = { ...state, fields: { ...state.fields } };
  for (const key of fields) {
    const prev = next.fields[key];
    if (!prev) continue;
    if (STAGE_RANK[stage] <= STAGE_RANK[prev.stage]) continue;
    next.fields[key] = { ...prev, stage, at: now };
  }
  next.updated_at = now;
  return next;
}

/**
 * Freezes the state after an order row was actually written: every field the
 * order carries becomes `committed`, and the flow is closed for later runs.
 */
export function commitOrderState(
  state: OrderState,
  input: { orderNumber: string; values: OrderStateInput },
  now = new Date().toISOString(),
): OrderState {
  const next: OrderState = { ...state, fields: { ...state.fields } };
  for (const key of ORDER_STATE_FIELDS) {
    const value = cleanValue(input.values[key]) ?? next.fields[key]?.value ?? null;
    if (!value) continue;
    next.fields[key] = { value, stage: "committed", at: now };
  }
  next.order_number = cleanValue(input.orderNumber);
  next.order_placed = true;
  next.updated_at = now;
  return next;
}

export function valueOf(state: OrderState, key: OrderStateField): string | null {
  return state.fields[key]?.value ?? null;
}

export function stageOf(state: OrderState, key: OrderStateField): OrderStateStage | null {
  return state.fields[key]?.stage ?? null;
}

/** Fields that still have no value at all. */
export function missingOrderStateFields(
  state: OrderState,
  required: readonly OrderStateField[] = ORDER_STATE_FIELDS,
): OrderStateField[] {
  return required.filter((k) => !state.fields[k]?.value);
}

/** The shape `buildActiveOrderStateBlock` consumes for the pre-order selection. */
export function selectionFromOrderState(state: OrderState) {
  return {
    product_name: valueOf(state, "product_name"),
    color: valueOf(state, "color"),
    size: valueOf(state, "size"),
    quantity: valueOf(state, "quantity"),
    payment_method: valueOf(state, "payment_method"),
  };
}

/** Compact, human-readable stage list for the agent context. */
export function renderOrderStateStages(state: OrderState): string[] {
  const labels: Record<OrderStateField, string> = {
    name: "الاسم",
    phone: "الموبايل",
    address: "العنوان",
    product_name: "المنتج",
    color: "اللون",
    size: "المقاس",
    quantity: "الكمية",
    payment_method: "طريقة الدفع",
    shipping_zone: "منطقة الشحن",
  };
  const stageLabel: Record<OrderStateStage, string> = {
    extracted: "مبدئي",
    verified: "متحقق",
    confirmed: "مؤكَّد",
    committed: "منفَّذ",
  };
  const out: string[] = [];
  for (const key of ORDER_STATE_FIELDS) {
    const entry = state.fields[key];
    if (!entry) continue;
    out.push(`${labels[key]}: ${entry.value} (${stageLabel[entry.stage]})`);
  }
  return out;
}
