import { describe, expect, it } from "vitest";
import {
  buildHistoryForModel,
  userMessageIdsCoveredBySnapshot,
  waitForAgentRunTurn,
  STALE_AGENT_STOCK_TAG,
} from "@/routes/api/chat-ai";


type Row = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

describe("serialized agent-run message coverage", () => {
  it("runs one agent reply for two rapid messages in the same settled snapshot", async () => {
    let locked = false;
    let replyCount = 0;
    const covered = new Set<string>();
    const messages: Row[] = [
      { id: "u1", role: "user", content: "عايز", created_at: "2026-08-11T11:00:00.000Z" },
    ];
    const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const handle = async (messageId: string) => {
      const claimed = await waitForAgentRunTurn({
        isCovered: async () => covered.has(messageId),
        tryClaim: async () => {
          if (locked) return false;
          locked = true;
          return true;
        },
        release: async () => { locked = false; },
        wait: () => delay(1),
        now: () => Date.now(),
        waitMs: 200,
      });
      if (!claimed) return;
      await delay(15);
      replyCount += 1;
      userMessageIdsCoveredBySnapshot([...messages]).forEach((id) => covered.add(id));
      locked = false;
    };
    const first = handle("u1");
    await delay(2);
    messages.push({ id: "u2", role: "user", content: "فستان", created_at: "2026-08-11T11:00:00.200Z" });
    const second = handle("u2");
    await Promise.all([first, second]);

    expect(replyCount).toBe(1);
    expect([...covered]).toEqual(["u1", "u2"]);
  });

  it("leaves a message arriving after the snapshot for a later run whose history includes the prior reply", () => {
    const firstSnapshot: Row[] = [
      { id: "u1", role: "user", content: "عايز", created_at: "2026-08-11T11:00:00.000Z" },
    ];
    const firstCovered = new Set(userMessageIdsCoveredBySnapshot(firstSnapshot));
    expect(firstCovered.has("u2")).toBe(false);

    const nextSnapshot: Row[] = [
      ...firstSnapshot,
      { id: "a1", role: "assistant", content: "تحب نوع معين؟", created_at: "2026-08-11T11:00:01.000Z" },
      { id: "u2", role: "user", content: "فستان", created_at: "2026-08-11T11:00:01.100Z" },
    ];
    const modelHistory = buildHistoryForModel(nextSnapshot);

    // Assistant replies keep their text verbatim and additionally carry the
    // structural staleness tag (attached by role/position, not by keywords).
    expect(modelHistory).toEqual([
      { role: "user", content: "عايز" },
      { role: "assistant", content: `تحب نوع معين؟\n\n${STALE_AGENT_STOCK_TAG}` },
      { role: "user", content: "فستان" },
    ]);
    expect(userMessageIdsCoveredBySnapshot(nextSnapshot)).toEqual(["u1", "u2"]);
  });


  it("does not abandon an uncovered message while another run is still active", async () => {
    let polls = 0;
    const claimed = await waitForAgentRunTurn({
      isCovered: async () => polls === 3,
      tryClaim: async () => false,
      release: async () => {},
      wait: async () => { polls += 1; },
      now: () => 1_000_000,
      waitMs: Number.POSITIVE_INFINITY,
    });

    expect(claimed).toBe(false);
    expect(polls).toBe(3);
  });
});