/**
 * Unit tests for hashImagePaths — the stability guard that decides
 * whether the vision layer needs to regenerate a description.
 */
import { describe, it, expect } from "vitest";
import { hashImagePaths } from "@/lib/product-vision.server";

describe("hashImagePaths", () => {
  it("is deterministic for the same ordered list", async () => {
    const a = await hashImagePaths(["a.jpg", "b.jpg", "c.jpg"]);
    const b = await hashImagePaths(["a.jpg", "b.jpg", "c.jpg"]);
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("changes when the order changes", async () => {
    const a = await hashImagePaths(["a.jpg", "b.jpg"]);
    const b = await hashImagePaths(["b.jpg", "a.jpg"]);
    expect(a).not.toBe(b);
  });

  it("changes when any path changes", async () => {
    const a = await hashImagePaths(["a.jpg", "b.jpg"]);
    const b = await hashImagePaths(["a.jpg", "b2.jpg"]);
    expect(a).not.toBe(b);
  });

  it("hashes an empty list to a stable value", async () => {
    const a = await hashImagePaths([]);
    const b = await hashImagePaths([]);
    expect(a).toBe(b);
  });
});
