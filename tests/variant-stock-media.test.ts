import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  inStockColorLabels,
  soldOutColorLabels,
  partitionColorsByStock,
} from "@/lib/variant-stock-media";

const source = readFileSync("src/routes/api/chat-ai.ts", "utf8");
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

const product = {
  id: "p1",
  variants: [
    { color: "أحمر", stock: 3 },
    { color: "أخضر", stock: 0 },
    { color: "أزرق", stock: 0 },
    { color: "أزرق", stock: 2 },
  ],
};

describe("variant-level stock gate for product media", () => {
  it("lists only colours with real stock", () => {
    expect(inStockColorLabels(product).sort()).toEqual(["أحمر", "أزرق"].sort());
    expect(soldOutColorLabels(product)).toEqual(["أخضر"]);
  });

  it("partitions stored colour rows by live stock", () => {
    const { inStockIds, soldOutIds, inStockLabels } = partitionColorsByStock(
      [
        { id: "c1", label: "أحمر" },
        { id: "c2", label: "أخضر" },
        { id: "c3", label: "أزرق" },
      ],
      product,
      norm,
    );
    expect([...inStockIds].sort()).toEqual(["c1", "c3"]);
    expect([...soldOutIds]).toEqual(["c2"]);
    expect(inStockLabels).toContain("أحمر");
    expect(inStockLabels).not.toContain("أخضر");
  });

  it("filters attached images to in-stock colours in the chat route", () => {
    expect(source).toContain("partitionColorsByStock");
    expect(source).toContain('query.in("color_id", [...inStockIds])');
    expect(source).toContain("soldOutIds.has(String(r.color_id))");
    expect(source).toContain("requested_color_out_of_stock");
  });
});
