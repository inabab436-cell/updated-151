import { describe, it, expect } from "vitest";
import {
  mapOfferRow,
  isLive,
  isSoldOut,
  isAvailableForCustomer,
  pastBucket,
  buildOffersBlock,
} from "@/lib/offers.server";
import { customerKeyOf } from "@/lib/offer-redemptions.server";

const base = (over: Record<string, unknown> = {}) =>
  mapOfferRow({
    id: "o1",
    title: "عرض",
    scope: "all",
    discount_type: "percent",
    discount_value: 10,
    starts_at: new Date(Date.now() - 3600_000).toISOString(),
    is_active: true,
    ...over,
  });

describe("usage limit", () => {
  it("defaults to per_order", () => {
    expect(base().usage_limit_type).toBe("per_order");
  });
  it("once_per_customer blocks a customer who already used it", () => {
    const o = base({ usage_limit_type: "once_per_customer" });
    expect(isAvailableForCustomer(o, true)).toBe(false);
    expect(isAvailableForCustomer(o, false)).toBe(true);
  });
  it("per_order stays available for a repeat customer", () => {
    expect(isAvailableForCustomer(base(), true)).toBe(true);
  });
  it("max_redemptions counts unique customers, not uses", () => {
    const o = base({ max_redemptions: 2, beneficiary_count: 1, redemption_count: 5 });
    expect(isSoldOut(o)).toBe(false);
    expect(isSoldOut(base({ max_redemptions: 2, beneficiary_count: 2, redemption_count: 2 }))).toBe(true);
  });
});

describe("customer identity", () => {
  it("prefers customer_id, then phone, then conversation", () => {
    expect(customerKeyOf({ customer_id: "a", customer_phone: "1", conversation_id: "c" })).toBe("c:a");
    expect(customerKeyOf({ customer_phone: "1", conversation_id: "c" })).toBe("p:1");
    expect(customerKeyOf({ conversation_id: "c" })).toBe("v:c");
  });
});

describe("expiry precision", () => {
  const now = Date.parse("2026-08-06T12:00:00+03:00");
  const ended = (iso: string) => base({ ends_at: iso });
  it("minutes ago is not yesterday", () => {
    expect(pastBucket(ended("2026-08-06T11:50:00+03:00"), now)).toBe("minutes");
  });
  it("hours ago", () => {
    expect(pastBucket(ended("2026-08-06T09:00:00+03:00"), now)).toBe("hours");
  });
  it("earlier today", () => {
    expect(pastBucket(ended("2026-08-06T01:00:00+03:00"), now)).toBe("today");
  });
  it("yesterday", () => {
    expect(pastBucket(ended("2026-08-05T23:30:00+03:00"), now)).toBe("yesterday");
  });
  it("wording matches the bucket", () => {
    const block = buildOffersBlock(
      { live: [], past: [{ bucket: pastBucket(ended("2026-08-06T11:50:00+03:00"), now) }] },
      new Map(),
      null,
    );
    expect(block).toContain("خلص من شوية");
    expect(block).not.toContain("خلص امبارح");
  });
});

describe("liveness after an edit", () => {
  it("an offer whose window ended is not live", () => {
    expect(isLive(base({ ends_at: new Date(Date.now() - 60_000).toISOString() }))).toBe(false);
  });
  it("an offer that hit its customer limit is not live", () => {
    expect(isLive(base({ max_redemptions: 1, beneficiary_count: 1 }))).toBe(false);
  });
});
