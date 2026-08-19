import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(process.cwd(), "src/routes/api/chat-ai.ts"), "utf8");

describe("point 6 — missing information is only recorded by the explicit tool", () => {
  it("no promise-phrase regex remains", () => {
    expect(src).not.toMatch(/promiseRe/);
  });

  it("no Arabic sales-promise keywords are matched against the reply", () => {
    for (const kw of ["هشوف", "هراجع", "هرجعلك", "سأتأكد", "get_back_to_you"]) {
      expect(src).not.toContain(kw);
    }
    expect(src).not.toMatch(/get\s*\\s\+\s*back/);
  });

  it("missingInfoRecorded is set only from the report_missing_information tool result", () => {
    const assignments = src.match(/missingInfoRecorded\s*=\s*true/g) ?? [];
    expect(assignments.length).toBe(1);
    const idx = src.indexOf("missingInfoRecorded = true");
    const before = src.slice(Math.max(0, idx - 600), idx);
    expect(before).toContain("report_missing_information");
  });

  it("recordMissingInformation runs only in the tool execution path", () => {
    const calls = src.match(/recordMissingInformation/g) ?? [];
    expect(calls.length).toBe(2);
    // The only call site sits before the reply post-processing block, inside the
    // executor invoked by the `report_missing_information` tool branch.
    const callIdx = src.indexOf("recordMissingInformation");
    const branchIdx = src.indexOf('fnName === "report_missing_information"');
    expect(branchIdx).toBeGreaterThan(callIdx);
    expect(src.slice(callIdx)).not.toMatch(/reply\s*\)\s*\{[\s\S]*recordMissingInformation/);
  });
});
