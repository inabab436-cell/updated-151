import { describe, it, expect } from "vitest";
import {
  CUSTOMER_COOKIE_NAME,
  normalizeEmail,
  publicHash,
} from "@/lib/customer-auth.server";

describe("customer-auth helpers", () => {
  it("normalizeEmail lowercases and trims whitespace", () => {
    expect(normalizeEmail("  Foo@BAR.com \n")).toBe("foo@bar.com");
  });

  it("publicHash produces a deterministic 64-char hex sha256", () => {
    const a = publicHash("foo@bar.com");
    const b = publicHash("foo@bar.com");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(publicHash("other@bar.com")).not.toBe(a);
  });

  it("exposes the shared customer-session cookie name", () => {
    expect(CUSTOMER_COOKIE_NAME).toBe("cupai_cs");
  });
});
