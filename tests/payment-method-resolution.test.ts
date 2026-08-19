import { describe, expect, it } from "vitest";
import { resolvePaymentMethodChoice } from "@/lib/payment-method-resolution.server";

const METHODS = [
  { id: "1", name: "الدفع عند الاستلام", behavior: "auto" },
  { id: "2", name: "فودافون كاش", behavior: "manual" },
];

function aiFetch(args: { method_index: number; stated_by_customer: boolean }) {
  const calls: any[] = [];
  const impl = (async (_url: string, init: any) => {
    calls.push(JSON.parse(init.body));
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              tool_calls: [
                { function: { arguments: JSON.stringify(args) } },
              ],
            },
          },
        ],
      }),
    } as any;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("resolvePaymentMethodChoice", () => {
  it("accepts a method whose wording differs from the stored name", async () => {
    const { impl } = aiFetch({ method_index: 1, stated_by_customer: true });
    const r = await resolvePaymentMethodChoice({
      lovableApiKey: "k",
      requested: "Vodafone Cash",
      methods: METHODS,
      customerMessages: ["هدفع محفظة فودافون"],
      fetchImpl: impl,
    });
    expect(r.method?.name).toBe("فودافون كاش");
    expect(r.chosenByCustomer).toBe(true);
    expect(r.source).toBe("ai");
  });

  it("rejects an assumed method the customer never expressed", async () => {
    const { impl } = aiFetch({ method_index: -1, stated_by_customer: false });
    const r = await resolvePaymentMethodChoice({
      lovableApiKey: "k",
      requested: "الدفع عند الاستلام",
      methods: METHODS,
      customerMessages: ["تمام", "اه"],
      fetchImpl: impl,
    });
    expect(r.method).toBeNull();
    expect(r.chosenByCustomer).toBe(false);
  });

  it("passes the enabled methods and the customer messages to the model", async () => {
    const { impl, calls } = aiFetch({ method_index: 0, stated_by_customer: true });
    await resolvePaymentMethodChoice({
      lovableApiKey: "k",
      requested: "cod",
      methods: METHODS,
      customerMessages: ["لما يوصل"],
      fetchImpl: impl,
    });
    const sent = calls[0].messages[1].content as string;
    expect(sent).toContain("فودافون كاش");
    expect(sent).toContain("لما يوصل");
  });

  it("falls back to the agent's exact method name when the model is unavailable", async () => {
    const failing = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    const r = await resolvePaymentMethodChoice({
      lovableApiKey: "k",
      requested: "فودافون كاش",
      methods: METHODS,
      customerMessages: ["فودافون كاش"],
      fetchImpl: failing,
    });
    expect(r.method?.name).toBe("فودافون كاش");
    expect(r.source).toBe("fallback");
  });

  it("returns nothing when the store has no enabled methods", async () => {
    const r = await resolvePaymentMethodChoice({
      lovableApiKey: "k",
      requested: "فودافون كاش",
      methods: [],
      customerMessages: ["فودافون كاش"],
    });
    expect(r.method).toBeNull();
  });
});
