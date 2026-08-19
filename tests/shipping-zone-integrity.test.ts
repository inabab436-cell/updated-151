/**
 * Shipping integrity: the agent must never invent a shipping zone, price or
 * delivery time. A Cairo address with only an Alexandria rate recorded has NO
 * rate — it must not silently inherit the Alexandria price/ETA.
 */
import { describe, it, expect } from "vitest";
import { matchShippingZone } from "@/lib/order-input-validation";
import { buildStoreKnowledgeBlock, emptyMerchantData } from "@/lib/merchant-data.server";

const cairo = { country: "مصر", region: "القاهرة", price: 50, currency: "EGP", eta: "3 أيام" };
const alex = { country: "مصر", region: "الإسكندرية", price: 65, currency: "EGP", eta: "يوم" };

describe("matchShippingZone — no cross-zone guessing", () => {
  it("refuses to use the only recorded zone when the address is a different governorate", () => {
    const m = matchShippingZone([alex], ["القاهرة مدينة نصر شارع 10"]);
    expect(m.zone).toBeNull();
    expect(m.conflict).toBe(true);
    expect(m.addressGovernorate).toBe("القاهرة");
  });

  it("still matches the correct zone when it exists", () => {
    const m = matchShippingZone([cairo, alex], ["القاهرة المعادي شارع 9"]);
    expect(m.zone?.price).toBe(50);
    expect(m.zone?.eta).toBe("3 أيام");
    expect(m.conflict).toBeUndefined();
  });

  it("resolves city aliases to the right governorate zone", () => {
    expect(matchShippingZone([cairo, alex], ["ساكن في سموحة اسكندرية"]).zone?.price).toBe(65);
    expect(matchShippingZone([cairo, alex], ["الهرم فيصل شارع 5"]).zone).toBeNull();
  });

  it("does not let an earlier unrelated message override the address governorate", () => {
    const m = matchShippingZone([cairo, alex], [
      "الإسكندرية سيدي بشر شارع 3",
      "صاحبي من القاهرة اشترى منكم",
    ]);
    expect(m.zone?.price).toBe(65);
  });

  it("uses a generic all-governorates zone for any address", () => {
    const generic = { country: "مصر", region: "كل المحافظات", price: 60, currency: "EGP" };
    expect(matchShippingZone([generic], ["القاهرة المعادي شارع 1"]).zone?.price).toBe(60);
    expect(matchShippingZone([generic], ["مش عارف"]).fallbackSingleZone).toBe(true);
  });

  it("asks instead of guessing when the address names no governorate", () => {
    expect(matchShippingZone([cairo, alex], ["شارع 10 عمارة 5"]).zone).toBeNull();
  });
});

describe("store knowledge shipping block", () => {
  it("states that unlisted zones have no rate", () => {
    const data = { ...emptyMerchantData(), shipping: [alex] };
    const block = buildStoreKnowledgeBlock(data);
    expect(block).toContain("الإسكندرية");
    expect(block).toContain("المدة: يوم");
    expect(block).toContain("قاعدة الشحن (ملزمة)");
  });

  it("forbids inventing shipping data when nothing is recorded", () => {
    const data = { ...emptyMerchantData(), contacts: [{ kind: "phone", label: null, value: "010" }] };
    expect(buildStoreKnowledgeBlock(data)).toContain("لا توجد أي أسعار شحن");
  });
});

describe("zones named after cities / districts", () => {
  const obour = { country: "مصر", region: "العبور", price: 40, currency: "EGP", eta: "يومين" };
  const zagazig = { country: "مصر", region: "الزقازيق", price: 55, currency: "EGP", eta: "4 أيام" };

  it("matches a zone whose region is a city name, not a governorate", () => {
    const m = matchShippingZone([obour, zagazig], ["العبور الحي الأول شارع 5"]);
    expect(m.zone?.price).toBe(40);
    expect(m.zone?.eta).toBe("يومين");
  });

  it("never treats an unrecognised city zone as an all-governorates zone", () => {
    const m = matchShippingZone([obour], ["القاهرة المعادي شارع 9"]);
    expect(m.zone).toBeNull();
  });

  it("still uses a real all-governorates zone alongside city zones", () => {
    const generic = { country: "مصر", region: "كل المحافظات", price: 60, currency: "EGP", eta: "3 أيام" };
    const m = matchShippingZone([obour, generic], ["القاهرة المعادي شارع 9"]);
    expect(m.zone?.price).toBe(60);
  });
})
