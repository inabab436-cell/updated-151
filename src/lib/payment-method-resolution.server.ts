/**
 * Payment method resolution — MEANING, not keywords.
 *
 * The agent used to be gated by literal string equality (`payment_method`
 * must equal a stored method name character for character) plus a keyword /
 * token match against the customer's messages. Any wording difference
 * ("Vodafone Cash", "فودافون كاش 💰", "محفظة فودافون", "التانية") made the
 * order fail and the agent apologised and re-asked for the very same options.
 *
 * This module instead asks a small language model to UNDERSTAND which of the
 * merchant's enabled methods the customer actually expressed, in any dialect,
 * language, typo or indirect reference. No keyword matching is involved.
 */

export interface PaymentMethodLike {
  name: string;
}

export interface ResolvePaymentMethodInput<T extends PaymentMethodLike = PaymentMethodLike> {
  /** Lovable AI gateway key. When missing, the resolver degrades gracefully. */
  lovableApiKey?: string | null;
  /** The value the agent passed in the `create_order` tool call. */
  requested: string;
  /** The merchant's ENABLED payment methods. */
  methods: T[];
  /** Every message the CUSTOMER typed in this conversation (newest first is fine). */
  customerMessages: Array<string | null | undefined>;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

export interface ResolvePaymentMethodResult<T extends PaymentMethodLike = PaymentMethodLike> {
  /** The enabled method the customer meant, or null when nothing was expressed. */
  method: T | null;
  /** True when the CUSTOMER themselves expressed this method (not assumed). */
  chosenByCustomer: boolean;
  source: "exact" | "ai" | "fallback";
}

const MODEL = "google/gemini-2.5-flash";

function normalize(value: string): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ar");
}

/**
 * Resolves the chosen payment method by understanding the conversation.
 *
 * Fail-open policy: if the AI call cannot run (no key, network error, bad
 * response) we fall back to the agent's own value when it names an enabled
 * method exactly. We never fall back to keyword/token guessing.
 */
export async function resolvePaymentMethodChoice<T extends PaymentMethodLike>(
  input: ResolvePaymentMethodInput<T>,
): Promise<ResolvePaymentMethodResult<T>> {
  const methods = (input.methods ?? []).filter((m) => m && typeof m.name === "string");
  if (methods.length === 0) {
    return { method: null, chosenByCustomer: false, source: "fallback" };
  }

  const requested = normalize(input.requested ?? "");
  const exact = methods.find((m) => normalize(m.name) === requested) ?? null;

  const conversation = (input.customerMessages ?? [])
    .filter((m): m is string => typeof m === "string" && m.trim().length > 0)
    .slice(0, 60)
    .reverse()
    .join("\n");

  const key = input.lovableApiKey;
  const doFetch = input.fetchImpl ?? fetch;
  if (!key || !conversation) {
    return { method: exact, chosenByCustomer: !!exact, source: "fallback" };
  }

  const tool = {
    type: "function",
    function: {
      name: "report_payment_choice",
      description:
        "Report which of the store's enabled payment methods the customer expressed, based on meaning.",
      parameters: {
        type: "object",
        properties: {
          method_index: {
            type: "integer",
            description:
              "Zero-based index of the enabled method the customer meant, or -1 when the customer never expressed any payment method.",
          },
          stated_by_customer: {
            type: "boolean",
            description:
              "True only when the CUSTOMER themselves expressed this choice (explicitly or by clearly answering the payment question). False when it is only an assumption.",
          },
        },
        required: ["method_index", "stated_by_customer"],
        additionalProperties: false,
      },
    },
  };

  const list = methods.map((m, i) => `${i}. ${m.name}`).join("\n");
  const userContent = [
    "Store's enabled payment methods:",
    list,
    "",
    "Customer's own messages (oldest first):",
    conversation,
    "",
    `The sales agent believes the customer chose: "${input.requested}"`,
  ].join("\n");

  try {
    const res = await doFetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "You decide which payment method a shopper chose, by UNDERSTANDING their words. " +
              "Egyptian Arabic, other dialects, English, transliteration, typos, emojis, brand nicknames " +
              "(e.g. 'محفظة فودافون' = Vodafone Cash, 'instapay' = إنستا باي, 'عند الاستلام'/'لما يوصل' = cash on delivery) " +
              "and ordinal references ('الأولى', 'التانية') all count. " +
              "Never do literal string matching. If the customer clearly expressed one of the listed methods, return its index. " +
              "If they never expressed any payment preference, return -1 and stated_by_customer=false.",
          },
          { role: "user", content: userContent },
        ],
        tools: [tool],
        tool_choice: { type: "function", function: { name: "report_payment_choice" } },
      }),
    });
    if (!res.ok) {
      return { method: exact, chosenByCustomer: !!exact, source: "fallback" };
    }
    const json: any = await res.json();
    const argsStr = json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!argsStr) {
      return { method: exact, chosenByCustomer: !!exact, source: "fallback" };
    }
    const parsed = JSON.parse(argsStr);
    const idx = Number(parsed?.method_index);
    const stated = parsed?.stated_by_customer === true;
    if (!Number.isInteger(idx) || idx < 0 || idx >= methods.length || !stated) {
      return { method: null, chosenByCustomer: false, source: "ai" };
    }
    return { method: methods[idx], chosenByCustomer: true, source: "ai" };
  } catch {
    return { method: exact, chosenByCustomer: !!exact, source: "fallback" };
  }
}
