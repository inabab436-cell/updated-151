/**
 * Tests for the AI analyzer — upload analysis, matching, conflict
 * resolution, and guided-retry flow. The Lovable AI Gateway (fetch) is
 * fully mocked so tests are deterministic and never hit the network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  analyzeBatch,
  analyzeAgainstExistingBatch,
  reduceDecisions,
  retryActionDecisions,
  type AnalysisFileInput,
} from "@/lib/ai-analyzer.server";

type MockCall = { url: string; init: RequestInit };
let calls: MockCall[] = [];

function jsonBody(payload: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  } as unknown as Response;
}

function mockChatContent(content: string) {
  return jsonBody({ choices: [{ message: { content } }] });
}

function installFetch(handler: (call: MockCall) => Response) {
  const spy = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as URL | Request).toString();
    const call: MockCall = { url, init: init ?? {} };
    calls.push(call);
    return handler(call);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  calls = [];
  vi.stubEnv("LOVABLE_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("analyzeBatch (upload analysis + AI vision)", () => {
  it("short-circuits with a warning when no files are supplied", async () => {
    installFetch(() => mockChatContent("{}"));
    const res = await analyzeBatch([]);
    expect(res.products).toEqual([]);
    expect(res.global_warnings).toContain("لا توجد ملفات للتحليل.");
    // No AI call should have been made.
    expect(calls).toHaveLength(0);
  });

  it("throws a clear error when the AI API key is missing", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "");
    await expect(
      analyzeBatch([
        { fileName: "a.png", mimeType: "image/png", url: "https://x/y.png" },
      ]),
    ).rejects.toThrow(/Missing/);
  });

  it("sends image inputs as vision parts to the AI gateway and parses products", async () => {
    installFetch(() =>
      mockChatContent(
        JSON.stringify({
          products: [
            { name: "قميص أزرق", decision: { action: "new" } },
          ],
          categories: ["ملابس"],
          global_warnings: [],
        }),
      ),
    );

    const files: AnalysisFileInput[] = [
      {
        fileName: "shirt.png",
        mimeType: "image/png",
        url: "https://cdn.example/shirt.png",
      },
    ];
    const res = await analyzeBatch(files);
    expect(res.products).toHaveLength(1);
    expect(res.products[0].name).toBe("قميص أزرق");

    // Verify the request payload: model + image_url parts + JSON response mode.
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].role).toBe("system");
    const userParts = body.messages[1].content;
    const imagePart = userParts.find((p: any) => p.type === "image_url");
    expect(imagePart?.image_url?.url).toBe("https://cdn.example/shirt.png");
  });

  it("returns a parse warning when the model emits unparseable JSON", async () => {
    installFetch(() => mockChatContent("not-json-at-all"));
    const res = await analyzeBatch([
      { fileName: "x.png", mimeType: "image/png", url: "https://x/y.png" },
    ]);
    expect(res.products).toEqual([]);
    expect(res.global_warnings.join(" ")).toMatch(/تعذّر تحليل/);
  });

  it("maps HTTP 402 (out of credits) to a friendly Arabic error", async () => {
    installFetch(() => ({
      ok: false,
      status: 402,
      text: async () => "no funds",
    }) as unknown as Response);
    await expect(
      analyzeBatch([
        { fileName: "x.png", mimeType: "image/png", url: "https://x/y.png" },
      ]),
    ).rejects.toThrow(/رصيد/);
  });

  it("maps HTTP 429 (rate limit) to a friendly Arabic error", async () => {
    installFetch(() => ({
      ok: false,
      status: 429,
      text: async () => "slow down",
    }) as unknown as Response);
    await expect(
      analyzeBatch([
        { fileName: "x.png", mimeType: "image/png", url: "https://x/y.png" },
      ]),
    ).rejects.toThrow(/حد الاستخدام/);
  });

  it("strips ```json fences before parsing", async () => {
    installFetch(() =>
      mockChatContent(
        "```json\n" +
          JSON.stringify({ products: [{ name: "A" }], categories: [] }) +
          "\n```",
      ),
    );
    const res = await analyzeBatch([
      { fileName: "x.png", mimeType: "image/png", url: "https://x/y.png" },
    ]);
    expect(res.products.map((p) => p.name)).toEqual(["A"]);
  });
});

describe("analyzeAgainstExistingBatch (AI-driven matching)", () => {
  it("returns the per-index decisions parsed from the model response", async () => {
    installFetch(() =>
      mockChatContent(
        JSON.stringify({
          decisions: [
            { index: 0, action: "merge", target_id: "p1", reason: "same" },
            { index: 1, action: "new", target_id: null },
            { garbage: true }, // must be dropped
          ],
        }),
      ),
    );
    const out = await analyzeAgainstExistingBatch(
      "product",
      [{ name: "قميص" }, { name: "بنطلون" }],
      [{ id: "p1", name: "قميص" }],
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ index: 0, action: "merge", target_id: "p1" });
    expect(out[1]).toMatchObject({ index: 1, action: "new", target_id: null });
  });

  it("returns [] when there are no incoming items (no AI call)", async () => {
    const spy = installFetch(() => mockChatContent("{}"));
    const out = await analyzeAgainstExistingBatch("policy", [], []);
    expect(out).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns [] when the model response cannot be parsed", async () => {
    installFetch(() => mockChatContent("<<< not json >>>"));
    const out = await analyzeAgainstExistingBatch(
      "product",
      [{ name: "x" }],
      [],
    );
    expect(out).toEqual([]);
  });
});

describe("reduceDecisions (conflict resolution)", () => {
  it("finalises as `new` without any AI call when there are no candidates", async () => {
    const spy = installFetch(() => mockChatContent("{}"));
    const res = await reduceDecisions("product", { name: "x" }, []);
    expect(res).toEqual({
      action: "new",
      target_id: null,
      reason: null,
      conflicts: null,
      identity: null,
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns the AI's final decision when candidates disagree", async () => {
    installFetch(() =>
      mockChatContent(
        JSON.stringify({
          final: {
            action: "merge",
            target_id: "p1",
            reason: "identical SKU",
            conflicts: [],
          },
        }),
      ),
    );
    const res = await reduceDecisions(
      "product",
      { name: "قميص" },
      [
        {
          decision: { index: 0, action: "merge", target_id: "p1" },
          existing: { id: "p1", name: "قميص" },
        },
        {
          decision: { index: 0, action: "new", target_id: null },
          existing: { id: "p2", name: "قميص" },
        },
      ],
    );
    expect(res).toMatchObject({ action: "merge", target_id: "p1" });
  });

  it("degrades to null-action when the AI response is unparseable", async () => {
    installFetch(() => mockChatContent(">>>"));
    const res = await reduceDecisions(
      "policy",
      { title: "return" },
      [
        {
          decision: { index: 0, action: "update", target_id: "p1" },
          existing: { id: "p1", title: "return" },
        },
      ],
    );
    expect(res.action).toBeNull();
  });
});

describe("retryActionDecisions (guided-retry for invalid actions)", () => {
  it("returns [] when there is nothing to correct (no AI call)", async () => {
    const spy = installFetch(() => mockChatContent("{}"));
    const out = await retryActionDecisions([]);
    expect(out).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("keeps only fixes whose action passes the enum validator", async () => {
    installFetch(() =>
      mockChatContent(
        JSON.stringify({
          fixes: [
            { kind: "product", idx: 0, action: "merge" }, // valid
            { kind: "product", idx: 1, action: "DELETE" }, // invalid → null
            { kind: "unknown", idx: 2, action: "new" }, // wrong kind → drop
            { foo: "bar" }, // shape violation → drop
          ],
        }),
      ),
    );
    const out = await retryActionDecisions([
      { kind: "product", idx: 0, rejected_action: "flag", snapshot: {} },
      { kind: "product", idx: 1, rejected_action: "delete", snapshot: {} },
    ]);
    expect(out).toEqual([
      { kind: "product", idx: 0, action: "merge" },
      { kind: "product", idx: 1, action: null },
    ]);
  });

  it("returns [] (never invents a default) when the retry call fails", async () => {
    installFetch(() => ({
      ok: false,
      status: 500,
      text: async () => "boom",
    }) as unknown as Response);
    const out = await retryActionDecisions([
      { kind: "product", idx: 0, rejected_action: "?", snapshot: {} },
    ]);
    expect(out).toEqual([]);
  });
});
