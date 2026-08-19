import { describe, it, expect } from "vitest";
import {
  STAGING_ACTIONS,
  STAGING_ACTIONS_LIST,
  NEEDS_AI_REVIEW_STATUS,
  AI_ACTION_RETRY_BUDGET,
  isValidStagingAction,
} from "@/lib/staging-action";

describe("staging-action enum (single source of truth)", () => {
  it("exposes exactly the four allowed actions", () => {
    expect([...STAGING_ACTIONS]).toEqual(["new", "merge", "skip"]);
  });

  it("comma-list matches the enum verbatim (used in AI retry prompt)", () => {
    expect(STAGING_ACTIONS_LIST).toBe("new, merge, skip");
  });

  it("accepts every enum member", () => {
    for (const a of STAGING_ACTIONS) expect(isValidStagingAction(a)).toBe(true);
  });

  it("rejects unknown / non-string values", () => {
    for (const v of ["", "delete", "NEW", "Merge", 0, null, undefined, {}, []]) {
      expect(isValidStagingAction(v as unknown)).toBe(false);
    }
  });

  it("exposes a retry budget and review status for AI-owned decisions", () => {
    expect(AI_ACTION_RETRY_BUDGET).toBeGreaterThan(0);
    expect(NEEDS_AI_REVIEW_STATUS).toBe("needs_ai_review");
  });
});
