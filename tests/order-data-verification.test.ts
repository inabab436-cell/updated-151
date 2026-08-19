import { describe, it, expect } from "vitest";
import {
  extractPhones,
  isDummyPhone,
  isDummyText,
  normalizeDigits,
  normalizeText,
  verifyOrderIdentity,
} from "@/lib/order-data-verification";

const real = {
  name: "أحمد علي",
  phone: "01012345678",
  address: "المعادي شارع 9 عمارة 12",
};

describe("normalization helpers", () => {
  it("converts Arabic-Indic digits", () => {
    expect(normalizeDigits("٠١٠١٢٣٤٥٦٧٨")).toBe("01012345678");
  });
  it("unifies alef/ya/ta-marbuta and strips punctuation", () => {
    expect(normalizeText("أحمد، علي.")).toBe("احمد علي");
    expect(normalizeText("القاهره")).toBe(normalizeText("القاهرة"));
  });
  it("extracts phone-like digit runs", () => {
    expect(extractPhones("رقمي ٠١٠-١٢٣٤٥٦٧٨ تمام")).toContain("01012345678");
  });
  it("keeps a short Egyptian mobile attempt for immediate correction", () => {
    expect(extractPhones("رقمي 012884")).toEqual(["012884"]);
  });
  it("flags dummy values", () => {
    expect(isDummyText("عميل")).toBe(true);
    expect(isDummyText("غير محدد")).toBe(true);
    expect(isDummyText("أحمد علي")).toBe(false);
    expect(isDummyPhone("0000000000")).toBe(true);
    expect(isDummyPhone("123")).toBe(true);
    expect(isDummyPhone("01012345678")).toBe(false);
  });
});

describe("verifyOrderIdentity", () => {
  it("rejects everything when the customer never gave any data", () => {
    const v = verifyOrderIdentity({
      ...real,
      customerMessages: ["عايز اشتري تيشيرت أسود مقاس M"],
    });
    expect(v.ok).toBe(false);
    expect(v.unverified).toEqual([
      "customer_name",
      "customer_phone",
      "customer_address",
    ]);
  });

  it("accepts data the customer actually typed, even with Arabic digits", () => {
    const v = verifyOrderIdentity({
      ...real,
      customerMessages: [
        "اسمي أحمد علي",
        "رقمي ٠١٠١٢٣٤٥٦٧٨",
        "العنوان: المعادي شارع 9 عمارة 12",
      ],
    });
    expect(v).toEqual({ ok: true, unverified: [] });
  });

  it("accepts data coming from the saved customer profile", () => {
    const v = verifyOrderIdentity({
      ...real,
      customerMessages: ["أكد الطلب"],
      profile: real,
    });
    expect(v.ok).toBe(true);
  });

  it("rejects a fabricated phone even when the name and address are real", () => {
    const v = verifyOrderIdentity({
      ...real,
      phone: "01099999999",
      customerMessages: [
        "أنا أحمد علي، رقمي 01012345678، العنوان المعادي شارع 9 عمارة 12",
      ],
    });
    expect(v.ok).toBe(false);
    expect(v.unverified).toEqual(["customer_phone"]);
  });

  it("rejects an invented address that the customer never mentioned", () => {
    const v = verifyOrderIdentity({
      ...real,
      address: "شارع التحرير الدقي الجيزة",
      customerMessages: ["أحمد علي", "01012345678", "أنا ساكن في المعادي"],
    });
    expect(v.ok).toBe(false);
    expect(v.unverified).toEqual(["customer_address"]);
  });

  it("rejects placeholder values", () => {
    const v = verifyOrderIdentity({
      name: "عميل",
      phone: "0000000000",
      address: "غير محدد",
      customerMessages: ["عميل 0000000000 غير محدد"],
    });
    expect(v.ok).toBe(false);
    expect(v.unverified).toHaveLength(3);
  });

  it("tolerates spacing/diacritics differences in what the customer typed", () => {
    const v = verifyOrderIdentity({
      name: "أحمد  علي",
      phone: "+20 101 234 5678",
      address: "المعادى شارع ٩ عماره 12",
      customerMessages: [
        "احمد علي - 010 1234 5678 - المعادي شارع ٩ عمارة ١٢",
      ],
    });
    expect(v.ok).toBe(true);
  });
});
