/**
 * Unified staging-action enum.
 *
 * Single source of truth for the values the AI is allowed to emit in
 * `decision.action`, and the ONLY vocabulary understood by any code path
 * that reads or writes a `staging_*.action` column. The exact same set
 * appears verbatim in the AI system prompt (see `ai-analyzer.server.ts`).
 *
 * IMPORTANT — architectural rule:
 *   The AI is the sole owner of business decisions (new / merge /
 *   skip, target selection, conflict resolution). The application performs
 *   ONLY technical validation and execution. It NEVER silently converts an
 *   unknown value into a default action.
 *
 *   When the AI returns a value outside this enum, callers MUST invoke a
 *   guided-retry flow that asks the AI itself to pick a valid value. If the
 *   retry budget is exhausted the row is marked with `NEEDS_AI_REVIEW_STATUS`
 *   and excluded from automatic approval — no TypeScript-side fallback
 *   decision is ever written.
 */
export const STAGING_ACTIONS = ["new", "merge", "skip"] as const;

export type StagingAction = (typeof STAGING_ACTIONS)[number];

/** Human-readable comma-separated list, used verbatim in retry prompts. */
export const STAGING_ACTIONS_LIST = STAGING_ACTIONS.join(", ");

export function isValidStagingAction(v: unknown): v is StagingAction {
  return (
    typeof v === "string" &&
    (STAGING_ACTIONS as readonly string[]).includes(v)
  );
}

/**
 * Status value written to `staging_*.status` when the AI failed to produce
 * a valid action after the guided-retry budget was exhausted. Rows carrying
 * this status are surfaced in the review UI but MUST be excluded from
 * automatic `approveBatch` execution.
 */
export const NEEDS_AI_REVIEW_STATUS = "needs_ai_review";

/** Maximum number of guided retry attempts before falling back to review. */
export const AI_ACTION_RETRY_BUDGET = 2;