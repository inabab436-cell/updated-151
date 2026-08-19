import { describe, it, expect } from "vitest";
import { normalizeEmail } from "@/lib/otp.server";

describe("otp normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Alice@Example.COM ")).toBe("alice@example.com");
  });

  it("is idempotent", () => {
    const once = normalizeEmail(" X@Y.Z ");
    expect(normalizeEmail(once)).toBe(once);
  });
});
