import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  buildMissingInfoStatusBlock,
  MISSING_INFO_STATUS_HEADING,
} from "@/lib/missing-info-status";
import {
  pickAnsweredTopics,
  resolveMissingInfoFromInterface,
} from "@/lib/missing-info-resolve.server";

describe("missing information status block", () => {
  it("is empty when the conversation asked nothing", () => {
    expect(buildMissingInfoStatusBlock([])).toBe("");
  });

  it("tells the agent that management has not replied yet, and to keep talking", () => {
    const block = buildMissingInfoStatusBlock([
      { question: "سعر الشحن للقاهرة؟", field: "shipping", status: "open" },
    ]);
    expect(block).toContain(MISSING_INFO_STATUS_HEADING);
    expect(block).toContain("لسه الإدارة ما ردتش");
    expect(block).toContain("لا يوقف المحادثة");
  });

  it("marks an answered topic as confirmed and carries the answer", () => {
    const block = buildMissingInfoStatusBlock([
      {
        question: "سعر الشحن للقاهرة؟",
        field: "shipping",
        status: "resolved",
        resolvedTitle: "شحن: القاهرة",
        resolvedAnswer: "شحن إلى مصر — القاهرة | السعر: 70 EGP | المدة: يومين",
      },
    ]);
    expect(block).toContain("تم الرد من الإدارة");
    expect(block).toContain("70 EGP");
    expect(block).toContain("مؤكَّدة");
  });
});

// -----------------------------------------------------------------------------

function fakeAdmin(topics: any[], log: any[]) {
  return {
    from(table: string) {
      const q: any = {
        _table: table,
        select() {
          return q;
        },
        eq() {
          return q;
        },
        in() {
          return q;
        },
        order() {
          return q;
        },
        limit() {
          return q;
        },
        update(patch: any) {
          log.push({ table, patch });
          return { eq: () => Promise.resolve({ data: null }) };
        },
        insert(row: any) {
          log.push({ table, insert: row });
          return {
            select: () => ({ single: () => Promise.resolve({ data: { id: "m1" } }) }),
          };
        },
        maybeSingle() {
          return Promise.resolve({ data: null });
        },
        then(res: any) {
          const data = table === "missing_info_topics" ? topics : [];
          return Promise.resolve({ data }).then(res);
        },
      };
      return q;
    },
  } as any;
}

describe("resolving missing information from a dashboard interface", () => {
  const OLD_KEY = process.env.LOVABLE_API_KEY;

  beforeEach(() => {
    process.env.LOVABLE_API_KEY = "test-key";
  });
  afterEach(() => {
    process.env.LOVABLE_API_KEY = OLD_KEY;
    vi.unstubAllGlobals();
  });

  function stubAi(content: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content } }] }),
      })) as any,
    );
  }

  it("only returns topic ids the model actually picked", async () => {
    stubAi('{"ids":["t1","nope"]}');
    const ids = await pickAnsweredTopics(
      "k",
      { title: "شحن: القاهرة", content: "القاهرة | 70 EGP | يومين" },
      [
        { id: "t1", canonical_question: "شحن القاهرة؟", product: null, missing_field: "shipping" },
        { id: "t2", canonical_question: "شحن أسوان؟", product: null, missing_field: "shipping" },
      ],
    );
    expect(ids).toEqual(["t1"]);
  });

  it("marks the topic resolved with the exact saved data (same flow as manual entry)", async () => {
    stubAi('{"ids":["t1"]}');
    const log: any[] = [];
    const admin = fakeAdmin(
      [{ id: "t1", canonical_question: "شحن القاهرة؟", product: null, missing_field: "shipping" }],
      log,
    );
    const res = await resolveMissingInfoFromInterface(admin, "m-1", {
      title: "شحن: القاهرة",
      content: "شحن إلى مصر — القاهرة | السعر: 70 EGP | المدة: يومين",
      entryId: "s-1",
      fields: ["shipping"],
    });
    expect(res.resolvedTopicIds).toEqual(["t1"]);
    const topicPatch = log.find((l) => l.table === "missing_info_topics")?.patch;
    expect(topicPatch.status).toBe("resolved");
    expect(topicPatch.resolved_answer).toContain("70 EGP");
    expect(topicPatch.resolved_entry_id).toBe("s-1");
    // the notification for that topic is marked read, like manual entry does
    expect(log.some((l) => l.table === "notifications" && l.patch?.is_read === true)).toBe(true);
  });

  it("changes nothing when the saved data answers no open topic", async () => {
    stubAi('{"ids":[]}');
    const log: any[] = [];
    const admin = fakeAdmin(
      [{ id: "t1", canonical_question: "شحن أسوان؟", product: null, missing_field: "shipping" }],
      log,
    );
    const res = await resolveMissingInfoFromInterface(admin, "m-1", {
      title: "شحن: القاهرة",
      content: "القاهرة | 70 EGP",
      fields: ["shipping"],
    });
    expect(res.resolvedTopicIds).toEqual([]);
    expect(log).toHaveLength(0);
  });
});
