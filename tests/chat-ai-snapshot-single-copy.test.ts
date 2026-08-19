import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Point 2 guard: the live store blocks must exist in exactly ONE place —
// the pinned `freshStoreSnapshot` (last message) — and must NOT be injected
// a second time into the system prompt.
const source = readFileSync(
  resolve(__dirname, "../src/routes/api/chat-ai.ts"),
  "utf8",
);

function systemPromptExpression(): string {
  const start = source.indexOf("const systemPrompt =");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf(";", start);
  return source.slice(start, end);
}

function snapshotExpression(): string {
  const start = source.indexOf("const buildFreshStoreSnapshot =");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf(";", start);
  return source.slice(start, end);
}

describe("live store snapshot is not duplicated", () => {
  it("keeps the store blocks only in freshStoreSnapshot", () => {
    const snap = snapshotExpression();
    for (const block of ["inventoryText", "existingOrdersBlock", "ragBlock", "offersBlock"]) {
      expect(snap).toContain(block);
    }
  });

  it("does not re-inject the store blocks into the system prompt", () => {
    const sys = systemPromptExpression();
    for (const block of ["inventoryText", "existingOrdersBlock", "ragBlock", "offersBlock"]) {
      expect(sys).not.toContain(block);
    }
  });

  it("points the system prompt at FRESH STORE SNAPSHOT instead", () => {
    const sys = systemPromptExpression();
    expect(sys).toContain("snapshotPointer");
    expect(source).toContain("FRESH STORE SNAPSHOT`. اعتمد عليها وحدها.");
  });

  it("still pins the snapshot as the last message", () => {
    expect(source).toContain("pinSnapshotLast(aiMessages, freshStoreSnapshot)");
  });

  it("refreshes canonical stock after a successful stock-mutating order", () => {
    expect(source).toContain("const refreshStockSnapshotAfterMutation = async () =>");
    expect(source).toMatch(
      /if \(deductionPlan\.deductStock\) \{\s*await refreshStockSnapshotAfterMutation\(\);\s*\}/,
    );
    expect(source).toContain("freshStoreSnapshot = buildFreshStoreSnapshot()");
  });

  it("keeps customer context and payment methods in the system prompt", () => {
    const sys = systemPromptExpression();
    expect(sys).toContain("customerContext");
    expect(sys).toContain("paymentBlock");
  });
});
