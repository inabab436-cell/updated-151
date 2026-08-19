import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("cn (Tailwind class merger)", () => {
  it("joins truthy class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("filters out falsy values", () => {
    expect(cn("a", false, undefined, null, "b")).toBe("a b");
  });

  it("lets later utilities override conflicting earlier ones", () => {
    // tailwind-merge semantics: px-4 replaces px-2
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("accepts arrays and objects", () => {
    expect(cn(["a", { b: true, c: false }], "d")).toBe("a b d");
  });
});
