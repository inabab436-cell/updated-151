/**
 * Waking the agent up again after a MANUAL payment has been confirmed.
 *
 * The conversation is parked with `status: 'awaiting_payment'` + `agent_enabled: false`.
 * Resuming has to undo BOTH, otherwise the chat route keeps short-circuiting on
 * the parked status and the customer never gets an answer again.
 *
 * Databases whose `conversations.status` CHECK constraint has not been widened
 * yet silently reject one of the values, so the update is verified by re-reading
 * the row and retried with the next acceptable status. `agent_enabled: true` is
 * always enforced — it is the hard stop the chat route honours.
 */

/** Statuses that keep the agent silent in the chat route. */
export const PARKED_STATUSES = ["awaiting_payment", "needs_human"] as const;

/** Candidate "the agent may talk again" statuses, tried in order. */
export const RESUMED_STATUS_CANDIDATES = ["active", "open", "in_progress"] as const;

export function isParkedStatus(status: string | null | undefined): boolean {
  return (PARKED_STATUSES as readonly string[]).includes(String(status ?? ""));
}

export interface ResumeResult {
  ok: boolean;
  status: string | null;
  agentEnabled: boolean;
}

export async function resumeAgentAfterPaymentConfirmed(
  admin: any,
  conversationId: string,
): Promise<ResumeResult> {
  let lastStatus: string | null = null;

  for (const candidate of RESUMED_STATUS_CANDIDATES) {
    const { error } = await admin
      .from("conversations")
      .update({ status: candidate, agent_enabled: true })
      .eq("id", conversationId);
    if (!error) {
      const { data } = await admin
        .from("conversations")
        .select("status, agent_enabled")
        .eq("id", conversationId)
        .maybeSingle();
      lastStatus = (data as any)?.status ?? candidate;
      if (!isParkedStatus(lastStatus)) break;
    }
  }

  // Even if no status value was accepted, the agent toggle must be back on.
  const { error: toggleErr } = await admin
    .from("conversations")
    .update({ agent_enabled: true })
    .eq("id", conversationId);
  if (toggleErr) throw new Error(toggleErr.message ?? String(toggleErr));

  // Close the payment notification so the conversation leaves the queue.
  try {
    await admin
      .from("notifications")
      .update({ is_read: true })
      .eq("conversation_id", conversationId)
      .eq("type", "human_needed")
      .eq("is_read", false);
  } catch {
    /* non-fatal */
  }

  return { ok: !isParkedStatus(lastStatus), status: lastStatus, agentEnabled: true };
}
