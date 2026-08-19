import { describe, it, expect } from "vitest";
import { recordOfferRedemptionsForOrders } from "@/lib/offer-redemptions.server";

/** Tiny in-memory stand-in for the service-role client. */
function makeAdmin(db: Record<string, any[]>) {
  const q = (table: string) => {
    let rows = [...(db[table] ?? [])];
    const api: any = {
      select: () => api,
      eq: (c: string, v: any) => ((rows = rows.filter((r) => String(r[c] ?? "") === String(v))), api),
      in: (c: string, v: any[]) => ((rows = rows.filter((r) => v.map(String).includes(String(r[c])))), api),
      limit: () => Promise.resolve({ data: rows }),
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null }),
      order: () => api,
      then: (res: any) => Promise.resolve({ data: rows }).then(res),
      insert: (row: any) => {
        const list = (db[table] ??= []);
        if (table === "offer_redemptions" && list.some((r) => r.offer_id === row.offer_id && r.order_id === row.order_id)) {
          return Promise.resolve({ error: { message: "duplicate" } });
        }
        list.push({ id: `r${list.length + 1}`, created_at: new Date().toISOString(), ...row });
        return Promise.resolve({ error: null });
      },
      update: (patch: any) => ({
        eq: (c: string, v: any) => {
          for (const r of db[table] ?? []) if (String(r[c]) === String(v)) Object.assign(r, patch);
          return Promise.resolve({ error: null });
        },
      }),
    };
    return api;
  };
  return { from: q } as any;
}

const offer = (over: any = {}) => ({
  id: "o1",
  user_id: "u1",
  title: "عرض",
  scope: "all",
  discount_type: "percent",
  discount_value: 10,
  starts_at: new Date(Date.now() - 3600_000).toISOString(),
  ends_at: null,
  is_active: true,
  usage_limit_type: "per_order",
  redemption_count: 0,
  beneficiary_count: 0,
  ...over,
});

const order = (id: string, customer: string) => ({
  id,
  customer_id: customer,
  conversation_id: `conv-${customer}`,
  customer_name: customer,
  total_price: 100,
  items: [],
  payment_status: "confirmed",
});

describe("recording redemptions", () => {
  it("per_order: same customer counts twice → 1 beneficiary / 2 uses", async () => {
    const db: any = {
      merchants: [{ id: "m1", user_id: "u1" }],
      offers: [offer()],
      orders: [order("ord1", "cust1"), order("ord2", "cust1")],
      offer_redemptions: [],
    };
    const admin = makeAdmin(db);
    await recordOfferRedemptionsForOrders(admin, { merchantId: "m1", orderIds: ["ord1"] });
    await recordOfferRedemptionsForOrders(admin, { merchantId: "m1", orderIds: ["ord2"] });
    expect(db.offer_redemptions.length).toBe(2);
    expect(db.offers[0].redemption_count).toBe(2);
    expect(db.offers[0].beneficiary_count).toBe(1);
  });

  it("once_per_customer: the second order of the same customer is not counted", async () => {
    const db: any = {
      merchants: [{ id: "m1", user_id: "u1" }],
      offers: [offer({ usage_limit_type: "once_per_customer" })],
      orders: [order("ord1", "cust1"), order("ord2", "cust1")],
      offer_redemptions: [],
    };
    const admin = makeAdmin(db);
    await recordOfferRedemptionsForOrders(admin, { merchantId: "m1", orderIds: ["ord1"] });
    await recordOfferRedemptionsForOrders(admin, { merchantId: "m1", orderIds: ["ord2"] });
    expect(db.offer_redemptions.length).toBe(1);
    expect(db.offers[0].redemption_count).toBe(1);
    expect(db.offers[0].beneficiary_count).toBe(1);
  });

  it("two different customers → 2 beneficiaries", async () => {
    const db: any = {
      merchants: [{ id: "m1", user_id: "u1" }],
      offers: [offer({ usage_limit_type: "once_per_customer" })],
      orders: [order("ord1", "cust1"), order("ord2", "cust2")],
      offer_redemptions: [],
    };
    const admin = makeAdmin(db);
    await recordOfferRedemptionsForOrders(admin, { merchantId: "m1", orderIds: ["ord1", "ord2"] });
    expect(db.offers[0].beneficiary_count).toBe(2);
    expect(db.offers[0].redemption_count).toBe(2);
  });

  it("an ended offer records nothing", async () => {
    const db: any = {
      merchants: [{ id: "m1", user_id: "u1" }],
      offers: [offer({ ends_at: new Date(Date.now() - 60_000).toISOString() })],
      orders: [order("ord1", "cust1")],
      offer_redemptions: [],
    };
    const admin = makeAdmin(db);
    await recordOfferRedemptionsForOrders(admin, { merchantId: "m1", orderIds: ["ord1"] });
    expect(db.offer_redemptions.length).toBe(0);
  });
});
