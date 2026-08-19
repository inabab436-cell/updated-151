/**
 * PHONE CONFIRMATION STATE
 * ========================
 *
 * A phone number lives in THREE distinct states, and the agent used to treat
 * them as one:
 *
 *   1. extracted  — some digits were understood from the customer.
 *   2. valid      — those digits form a real Egyptian mobile number.
 *   3. confirmed  — the customer stands behind that exact number (they sent it
 *                   in full, or completed it, and the agent read it back).
 *
 * Only state (3) may stop the agent from asking again, and only state (3) is
 * allowed to survive between runs as structured state — so a later run never
 * has to re-derive the number from chat history.
 *
 * Pure module: no database, no network. Callers pass plain strings.
 */
import { validateEgyptianPhone } from "@/lib/order-input-validation";

/** Arabic-Indic digits → western digits, everything else dropped. */
export function phoneDigits(text: unknown): string {
  return String(text ?? "")
    .replace(/[٠-٩]/g, (ch) => String("٠١٢٣٤٥٦٧٨٩".indexOf(ch)))
    .replace(/\D/g, "");
}

/** Reduces any written form (+20…, 0020…, 20…, 1…) to the local `01…` form. */
export function toLocalEgyptianForm(raw: unknown): string {
  let d = phoneDigits(raw);
  if (d.startsWith("0020")) d = d.slice(4);
  else if (d.startsWith("20") && d.length >= 12) d = d.slice(2);
  if (/^1[0-9]/.test(d) && d.length >= 9) d = `0${d}`;
  return d;
}

export function isValidPhone(raw: unknown): boolean {
  const local = toLocalEgyptianForm(raw);
  return !!local && validateEgyptianPhone(local).ok;
}

export function samePhone(a: unknown, b: unknown): boolean {
  const x = toLocalEgyptianForm(a);
  const y = toLocalEgyptianForm(b);
  return !!x && x === y;
}

/** A digit run shaped like an attempt at an Egyptian mobile number. */
function mobileAttempt(text: unknown): string | null {
  const normalized = String(text ?? "")
    .replace(/[٠-٩]/g, (ch) => String("٠١٢٣٤٥٦٧٨٩".indexOf(ch)))
    .replace(/[\s\-().+]/g, "");
  const runs = normalized.match(/\d{7,}/g) ?? [];
  for (const run of runs) {
    const d = toLocalEgyptianForm(run);
    if (/^01\d{6,10}$/.test(d)) return d;
  }
  return null;
}

/** True when the whole message is just a tiny digit fragment ("8", "٧٨"). */
function digitFragment(text: unknown): string | null {
  const stripped = String(text ?? "").trim().replace(/[\s\-().]/g, "");
  // The message must carry nothing but digits, otherwise it is ordinary
  // conversation (a quantity, a size, a price) and must never be glued onto a
  // phone number.
  if (!/^[0-9٠-٩]+$/.test(stripped)) return null;
  const digits = phoneDigits(stripped);
  return digits.length >= 1 && digits.length <= 4 ? digits : null;
}


export interface TurnPhone {
  /** Local `01…` form of what the customer is offering as their number. */
  phone: string;
  valid: boolean;
  /** True when the number was completed across two consecutive messages. */
  assembled: boolean;
}

/**
 * Understands the number the customer is giving in THIS turn, allowing a
 * number that arrived split across consecutive messages
 * ("0128255477" then "8") to be read as one number.
 *
 * The messages are never merged as text — each one stays its own message. Only
 * the digits are joined, and only when the result is a valid Egyptian mobile
 * number, so nothing is ever assembled at random.
 *
 * @param previousCustomerTexts customer messages, oldest → newest, excluding
 *        the current one.
 */
export function readTurnPhone(
  previousCustomerTexts: string[],
  currentMessage: string,
): TurnPhone | null {
  const direct = mobileAttempt(currentMessage);
  if (direct && validateEgyptianPhone(direct).ok) {
    return { phone: direct, valid: true, assembled: false };
  }

  const fragment = digitFragment(currentMessage);
  if (fragment) {
    // Only the customer's own last few messages are considered, so an old
    // number from far earlier in the chat can never be completed by accident.
    const recent = previousCustomerTexts.slice(-3).reverse();
    for (const prev of recent) {
      const partial = mobileAttempt(prev);
      if (!partial) continue;
      if (validateEgyptianPhone(partial).ok) break; // already complete: nothing to continue
      const combined = partial + fragment;
      if (combined.length === 11 && validateEgyptianPhone(combined).ok) {
        return { phone: combined, valid: true, assembled: true };
      }
      break; // the nearest attempt did not complete → do not keep guessing
    }
  }

  if (direct) return { phone: direct, valid: false, assembled: false };
  return null;
}

/**
 * The agent "confirmed" a number to the customer when it wrote that exact
 * number back in its reply. Combined with a valid value coming from the
 * customer, that is the moment the number becomes CONFIRMED state.
 */
export function replyRepeatsPhone(reply: unknown, phone: string): boolean {
  const target = toLocalEgyptianForm(phone);
  if (!target) return false;
  const digits = phoneDigits(reply);
  return digits.includes(target) || digits.includes(target.slice(1));
}

export interface PhoneStateBlockInput {
  phone?: string | null;
  confirmed?: boolean;
  /** A different number the customer just sent while a confirmed one exists. */
  pendingChange?: string | null;
}

/**
 * Prompt block carrying the structured phone state. It always wins over
 * anything the agent might re-derive from the chat history.
 */
export function buildPhoneStateBlock(input: PhoneStateBlockInput): string {
  const phone = String(input.phone ?? "").trim();
  if (!phone) return "";
  const lines: string[] = ["\n\nحالة رقم التواصل (حالة بنيوية محفوظة — أعلى من أي استنتاج من المحادثة):"];
  if (input.confirmed) {
    lines.push(
      `- الرقم المؤكد: ${phone}`,
      "- الرقم ده صالح ومؤكد من العميل. ممنوع تعتبره ناقص أو غير مكتمل، وممنوع تطلبه أو تطلب تأكيده تاني.",
    );
    if (input.pendingChange) {
      lines.push(
        `- العميل بعت رقم مختلف دلوقتي: ${input.pendingChange}. متستبدلش الرقم المؤكد تلقائيًا؛ اسأله بجملة قصيرة وودودة إذا كان عايز يغيّر رقم التواصل للرقم الجديد ولا الرقم القديم يفضل زي ما هو، واستنى إجابته.`,
      );
    }
  } else {
    lines.push(
      `- الرقم المستخرَج: ${phone} (لسه غير مؤكد من العميل).`,
      "- اقرأ الرقم للعميل مرة واحدة عشان يأكده، ومتفترضش إنه اتأكد.",
    );
  }
  return lines.join("\n");
}
