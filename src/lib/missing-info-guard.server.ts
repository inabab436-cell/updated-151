/**
 * MISSING-INFORMATION TRUTH GUARD (server-only)
 * =============================================
 *
 * Problem this solves
 * -------------------
 * The agent sometimes *says* "هتأكد وأرجعلك" / "هسأل الإدارة" without ever
 * calling `report_missing_information`, so the brand owner is never asked.
 * Later in the same conversation it then claims "الإدارة قالت..." even though
 * no request was ever made and no answer ever arrived.
 *
 * How it is solved
 * ----------------
 * NOT with keywords, phrase lists or regexes. After the reply is produced we
 * run one small semantic judgement pass that reads the customer's message, the
 * reply, and the real state of this conversation's missing-info topics, and
 * answers three questions by MEANING:
 *
 *   1. does the reply commit to checking / getting back to the customer?
 *   2. does the reply claim the brand owner already answered something?
 *   3. is there an unanswered question whose expected SOURCE is the brand
 *      owner's own commercial knowledge (which may simply never have been
 *      entered), as opposed to a concrete record that must exist in the
 *      system and whose absence is itself the answer?
 *
 * The distinction in (3) is described to the model conceptually:
 *
 *   - brand_owner  → commercial / policy / operational knowledge the owner
 *     holds in their head and may have forgotten to add. Not finding it does
 *     NOT mean "no". It must actually be requested from the owner.
 *   - system_record → a value that lives inside structured, enumerable store
 *     data (catalogue, variants, colours, sizes, registered shipping
 *     governorates, branches vs online-only). If the data set exists and the
 *     value is not in it, the absence IS the answer. Never manufacture a
 *     question to the owner for this.
 *
 * The caller uses the verdict to (a) actually perform the request when it is
 * owed, and (b) rewrite a reply that promised or claimed something untrue.
 */

import { safeSlice } from "@/lib/safe-slice";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

export type GapSource = "brand_owner" | "system_record" | "customer" | "none";

export interface MissingInfoVerdict {
  /** The reply promises a later answer / to check with the brand owner. */
  promisedFollowUp: boolean;
  /** The reply states or implies the brand owner already answered. */
  claimedOwnerAnswered: boolean;
  /** Expected source of the still-unanswered information, if any. */
  gapSource: GapSource;
  /** Canonical question to send to the brand owner (only for brand_owner). */
  gapQuestion: string | null;
  gapProduct: string | null;
  /** One of the report_missing_information field values. */
  gapField: string;
  /**
   * The reply gave a definitive answer (usually a flat "no"/"not available")
   * to something whose real source is the brand owner, i.e. an answer it had
   * no basis for. Such a reply must be rewritten before it is sent.
   */
  deniedWithoutBasis: boolean;
  /**
   * The reply treated an unrecognised place name as unknown/uncovered instead
   * of asking the customer which governorate or city it belongs to.
   */
  unresolvedPlace: boolean;
}


export interface AuditInput {
  /** The customer's latest message. */
  customerMessage: string;
  /** The reply the agent is about to send. */
  reply: string;
  /** Short recent transcript, oldest first: "عميل: ..." / "الوكيل: ...". */
  transcript: string;
  /** Topics this conversation already reported, with their real state. */
  topics: Array<{ question: string; status: string; answer?: string | null }>;
  /** Did this same turn already record a request through the tool? */
  alreadyRecorded: boolean;
}

const FIELDS = [
  "price",
  "size",
  "color",
  "availability",
  "shipping",
  "policy",
  "brand_preference",
  "other",
];

async function ask(apiKey: string, prompt: string): Promise<string | null> {
  try {
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content;
    return typeof text === "string" ? text : null;
  } catch {
    return null;
  }
}

function parseJson(text: string): Record<string, unknown> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * One semantic judgement pass over the finished turn. Never keyword-based.
 */
export async function auditTurnForMissingInfo(
  apiKey: string,
  input: AuditInput,
): Promise<MissingInfoVerdict | null> {
  const topicLines = input.topics.length
    ? input.topics
        .map(
          (t) =>
            `- "${t.question}" → ${
              t.status === "resolved"
                ? `ANSWERED by the brand owner: ${(t.answer ?? "").trim() || "(answer stored)"}`
                : "STILL UNANSWERED (no reply from the brand owner yet)"
            }`,
        )
        .join("\n")
    : "(nothing has ever been requested from the brand owner in this conversation)";

  const prompt =
    "You audit ONE turn of a store sales agent for honesty about information it does not have.\n" +
    "Judge purely by meaning, in any language or dialect. Never rely on specific words or phrases.\n\n" +
    "Answer these, about the AGENT REPLY below:\n" +
    "A) promised_follow_up: does the reply commit — explicitly or implicitly — to checking something, asking the management/brand owner, confirming later, or getting back to the customer with an answer it does not currently have?\n" +
    "B) claimed_owner_answered: does the reply present information as if it came from the management/brand owner (or as newly confirmed by them) for something that is listed below as STILL UNANSWERED, or that was never requested at all? Ordinary store facts the agent already knows do not count.\n" +
    "C) gap_source: if the customer's question is still not truly answered, where would the answer have to come from?\n\n" +
    "Classify gap_source conceptually, NOT by keywords:\n" +
    '  "brand_owner" — commercial, operational or policy knowledge that lives in the brand owner\'s head and may simply never have been entered into the store data. This covers whether some SERVICE, OPTION, ARRANGEMENT, OFFER or ACCOMMODATION exists at all and on what terms: gift wrapping, quantity/bulk or negotiated discounts, custom tailoring or special measurements, express or international shipping, exchange/return/refund/warranty terms, deposit exceptions, and any local delivery detail finer than the recorded coverage. Not finding it in the store data does NOT mean the answer is "no". It must be requested from the owner. When in doubt between the two categories, choose brand_owner: wrongly denying an optional service is worse than one extra question to the owner.\n' +
    '  "system_record" — a concrete value that belongs to a structured, enumerable set the store already maintains and can list in full, so the store\'s own records are the authority and their silence is meaningful: which products exist in the catalogue, a product\'s own defined variants/colours/sizes, the top-level shipping areas the store registers (a whole governorate/city: whether it is covered at all and its cost and delivery time), and the store\'s selling presence (physical branches, online only, or both). Treat these as system_record even when the specific value is not visible to you: the absence itself is the answer, so nothing may be requested from the owner. This category is limited to those enumerable sets — it never covers services, offers or policies.\n' +
    "  Granularity decides the shipping case: a whole governorate/city (covered or not, its cost, its delivery time) is system_record, while a district, village or street-level spot finer than what the store registers is brand_owner.\n" +
    "  The store's own identity and inventory are always system_record, never brand_owner: whether it has physical branches or sells online only, which products it carries, and which colours/sizes/variants a product has. These are recorded facts, so nothing is requested from the owner about them.\n" +
    '  "customer" — only the customer can supply it (their size, choice, quantity, contact details, address). This INCLUDES an unrecognised place name: when the customer names a district, neighbourhood, village, compound or small town whose parent governorate/city the agent cannot establish, the missing piece is the customer\'s own information ("تابعة لمحافظة إيه؟"), not the owner\'s and not a coverage answer.\n' +
    '  "none" — the question is fully answerable from what the agent already has, or it is already answered.\n\n' +
    "D) denied_without_basis: does the reply give the customer a definitive answer — most often a flat no, \"not available\", \"we don't do that\", or a made-up condition/number — to a question whose gap_source you judged to be \"brand_owner\"? Any definite answer there is unfounded, because the silence of the data is not a no. true/false.\n" +
    "E) unresolved_place: does the reply treat a place name it could not identify as unknown or as outside coverage (\"مش عارف المكان ده\"، \"المنطقة دي مش عندنا\") instead of simply asking the customer which governorate or city that place belongs to? true/false.\n\n" +
    "If gap_source is \"brand_owner\", also write gap_question: one short, self-contained question in Egyptian Arabic addressed to the brand owner, capturing exactly what must be learned (include the product if it is product-specific), and pick gap_field from: " +
    FIELDS.join(", ") +
    ".\n\n" +
    "Return JSON only:\n" +
    '{"promised_follow_up":bool,"claimed_owner_answered":bool,"gap_source":"brand_owner|system_record|customer|none","gap_question":string|null,"gap_product":string|null,"gap_field":"...","denied_without_basis":bool,"unresolved_place":bool}\n\n' +
    `STATE OF REQUESTS TO THE BRAND OWNER IN THIS CONVERSATION:\n${topicLines}\n` +
    `A REQUEST WAS ALREADY RECORDED IN THIS VERY TURN: ${input.alreadyRecorded ? "yes" : "no"}\n\n` +
    `RECENT CONVERSATION:\n${safeSlice(input.transcript, 0, 4000)}\n\n` +
    `CUSTOMER MESSAGE: "${safeSlice(input.customerMessage, 0, 1500)}"\n` +
    `AGENT REPLY: "${safeSlice(input.reply, 0, 2000)}"`;

  const text = await ask(apiKey, prompt);
  if (!text) return null;
  const parsed = parseJson(text);
  if (!parsed) return null;

  const rawSource = String(parsed["gap_source"] ?? "none");
  const gapSource: GapSource = (
    ["brand_owner", "system_record", "customer", "none"] as const
  ).includes(rawSource as GapSource)
    ? (rawSource as GapSource)
    : "none";
  const rawField = String(parsed["gap_field"] ?? "other");
  const q = parsed["gap_question"];
  const p = parsed["gap_product"];

  return {
    promisedFollowUp: parsed["promised_follow_up"] === true,
    claimedOwnerAnswered: parsed["claimed_owner_answered"] === true,
    gapSource,
    gapQuestion: typeof q === "string" && q.trim() ? safeSlice(q.trim(), 0, 500) : null,
    gapProduct: typeof p === "string" && p.trim() ? safeSlice(p.trim(), 0, 200) : null,
    gapField: FIELDS.includes(rawField) ? rawField : "other",
    deniedWithoutBasis:
      parsed["denied_without_basis"] === true && gapSource === "brand_owner",
    unresolvedPlace: parsed["unresolved_place"] === true,
  };
}

export type RepairMode =
  /** Reply promised a follow-up but nothing is actually being asked. */
  | "unbacked_promise"
  /** Reply claimed the owner answered, but no answer exists. */
  | "false_owner_answer"
  /** Reply denied / decided something only the brand owner can answer. */
  | "unfounded_denial"
  /** Reply treated an unidentified place as unknown instead of asking. */
  | "unresolved_place";

/**
 * Rewrites a reply that made an untrue commitment or an untrue attribution,
 * keeping the same voice, language and everything that was truthful in it.
 * Returns null when the rewrite is unavailable, so the caller can decide.
 */
export async function repairUntruthfulReply(
  apiKey: string,
  reply: string,
  mode: RepairMode,
  context: { customerMessage: string; openTopicQuestions: string[] },
): Promise<string | null> {
  const instruction =
    mode === "false_owner_answer"
      ? "The reply presents something as if the management/brand owner had answered it, but no answer from them exists. Remove that attribution and anything derived from it. If the matter is still waiting on them, say honestly and warmly that it is still being checked and that you will tell the customer the moment you know. If it is not waiting on them at all, simply drop the claim."
      : mode === "unfounded_denial"
        ? "The reply answers the customer definitively — usually with a no, a 'not available', or an invented condition — about something only the brand owner can decide (a service, an offer, a policy, a special arrangement, or a very local delivery detail). The store data being silent about it is NOT a no, so that answer has no basis. Remove the denial and every condition or number derived from it, do not replace it with a yes either, and instead say warmly and briefly that you are confirming this and will come back to them shortly. This question IS genuinely being asked of the brand owner right now, so the promise is truthful. Keep everything else in the reply."
        : mode === "unresolved_place"
          ? "The reply treats a place the agent could not identify as unknown or as outside the delivery coverage. That is wrong: an employee never tells a customer they do not know where their area is. Remove that sentence and instead ask the customer, in one short natural question, which governorate or city that place belongs to, so coverage can be checked. Do not confirm coverage and do not deny it. Keep everything else in the reply."
          : "The reply promises to check something or come back with an answer, but nothing is actually pending with the management/brand owner and the answer cannot come from them. Remove that promise. Either answer with what is genuinely known, or say plainly and kindly that this option/value is not available, without inventing anything and without promising a follow-up.";

  const pending = context.openTopicQuestions.length
    ? `Genuinely pending with the brand owner right now:\n- ${context.openTopicQuestions.join("\n- ")}`
    : "Nothing at all is pending with the brand owner right now.";

  const prompt =
    "You are editing one chat reply written by a store sales person in Egyptian Arabic.\n" +
    "Keep the exact same voice, dialect, length and warmth. Keep every truthful part unchanged. Change only what is described below.\n" +
    "Never mention this edit, never mention systems, tools or data.\n\n" +
    `${instruction}\n\n${pending}\n\n` +
    `CUSTOMER MESSAGE: "${safeSlice(context.customerMessage, 0, 1000)}"\n` +
    `REPLY TO FIX:\n"""${safeSlice(reply, 0, 2000)}"""\n\n` +
    "Return ONLY the corrected reply text, nothing else.";

  const text = await ask(apiKey, prompt);
  const out = (text ?? "").trim().replace(/^"+|"+$/g, "");
  return out ? out : null;
}
