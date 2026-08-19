/**
 * Unit tests for matchCustomerImage — the vision-based matcher that
 * picks an approved product for a customer-sent image.
 *
 * Guards:
 *  - low-confidence answers are rejected (threshold enforcement),
 *  - highest-confidence real candidate is returned when the model
 *    picks a valid id,
 *  - unknown product ids from the model are rejected,
 *  - failures (no candidates, API error) degrade to null rather than
 *    throwing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  matchCustomerImage,
  MATCH_ACCEPT_THRESHOLD,
} from "@/lib/customer-image-match.server";

function fakeAdmin(rows: any[]) {
  return {
    from() {
      return {
        select() {
          return {
            eq: async () => ({ data: rows, error: null }),
          };
        },
      };
    },
  } as any;
}

function mockFetchOnceJSON(payload: any, ok = true) {
  const res = {
    ok,
    json: async () => payload,
  } as any;
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(res);
}

const baseRows = [
  {
    id: "p1",
    name: "قميص أزرق",
    category: "ملابس",
    visual_features: { primary_colors: ["أزرق"] },
    internal_description: "قميص أزرق قطن",
  },
  {
    id: "p2",
    name: "بنطلون أسود",
    category: "ملابس",
    visual_features: { primary_colors: ["أسود"] },
    internal_description: "بنطلون أسود جينز",
  },
];

describe("matchCustomerImage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when there are no candidates", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const out = await matchCustomerImage({
      admin: fakeAdmin([]),
      lovableApiKey: "k",
      userId: "u1",
      imageUrl: "https://x/y.jpg",
    });
    expect(out).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns null when confidence is below the similar-alternative threshold", async () => {
    mockFetchOnceJSON({
      choices: [
        {
          message: {
            content: JSON.stringify({
              product_id: "p1",
              confidence: 0.2,
              reason: "لون قريب فقط",
            }),
          },
        },
      ],
    });
    const out = await matchCustomerImage({
      admin: fakeAdmin(baseRows),
      lovableApiKey: "k",
      userId: "u1",
      imageUrl: "https://x/y.jpg",
    });
    expect(out).toBeNull();
  });

  it("returns the picked candidate when confidence >= threshold", async () => {
    mockFetchOnceJSON({
      choices: [
        {
          message: {
            content: JSON.stringify({
              product_id: "p2",
              confidence: 0.9,
              match_kind: "exact",
              reason: "تطابق واضح",
            }),
          },
        },
      ],
    });
    const out = await matchCustomerImage({
      admin: fakeAdmin(baseRows),
      lovableApiKey: "k",
      userId: "u1",
      imageUrl: "https://x/y.jpg",
    });
    expect(out).not.toBeNull();
    expect(out!.product_id).toBe("p2");
    expect(out!.product_name).toBe("بنطلون أسود");
    expect(out!.confidence).toBeGreaterThanOrEqual(MATCH_ACCEPT_THRESHOLD);
    expect(out!.match_kind).toBe("exact");
  });

  it("returns a close candidate as a similar alternative without claiming an exact match", async () => {
    mockFetchOnceJSON({
      choices: [{ message: { content: JSON.stringify({
        product_id: "p1", confidence: 0.6, match_kind: "similar", reason: "تصميم قريب",
      }) } }],
    });
    const out = await matchCustomerImage({
      admin: fakeAdmin(baseRows), lovableApiKey: "k", userId: "u1", imageUrl: "https://x/y.jpg",
    });
    expect(out?.product_id).toBe("p1");
    expect(out?.match_kind).toBe("similar");
  });

  it("rejects unknown product ids returned by the model", async () => {
    mockFetchOnceJSON({
      choices: [
        {
          message: {
            content: JSON.stringify({
              product_id: "does-not-exist",
              confidence: 0.95,
              reason: "hallucination",
            }),
          },
        },
      ],
    });
    const out = await matchCustomerImage({
      admin: fakeAdmin(baseRows),
      lovableApiKey: "k",
      userId: "u1",
      imageUrl: "https://x/y.jpg",
    });
    expect(out).toBeNull();
  });

  it("returns null on API failure without throwing", async () => {
    mockFetchOnceJSON({ error: "boom" }, false);
    const out = await matchCustomerImage({
      admin: fakeAdmin(baseRows),
      lovableApiKey: "k",
      userId: "u1",
      imageUrl: "https://x/y.jpg",
    });
    expect(out).toBeNull();
  });

  it("returns null when key/url/userId are missing", async () => {
    const out = await matchCustomerImage({
      admin: fakeAdmin(baseRows),
      lovableApiKey: "",
      userId: "u1",
      imageUrl: "https://x/y.jpg",
    });
    expect(out).toBeNull();
  });
});
