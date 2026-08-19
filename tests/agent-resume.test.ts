import { describe, expect, it } from "vitest";

import {
  isParkedStatus,
  resumeAgentAfterPaymentConfirmed,
} from "@/lib/agent-resume.server";
import { buildActiveOrderStateBlock } from "@/lib/active-order-state";

/** Minimal chainable fake of the supabase client used by the resume helper. */
function makeAdmin(opts: {
  /** Statuses the DB CHECK constraint accepts. */
  allowed: string[];
  initialStatus: string;
}) {
  const row = { status: opts.initialStatus, agent_enabled: false };
  const notifications: Array<{ read: boolean }> = [{ read: false }];

  const admin = {
    row,
    notifications,
    from(table: string) {
      if (table === "notifications") {
        return {
          update() {
            return {
              eq() {
                return this;
              },
              then(res: any) {
                notifications.forEach((n) => (n.read = true));
                return Promise.resolve({ error: null }).then(res);
              },
            };
          },
        } as any;
      }
      return {
        update(patch: Record<string, unknown>) {
          return {
            async eq() {
              if (typeof patch.status === "string" && !opts.allowed.includes(patch.status)) {
                return { error: { message: "check constraint" } };
              }
              if (typeof patch.status === "string") row.status = patch.status;
              if (typeof patch.agent_enabled === "boolean") row.agent_enabled = patch.agent_enabled;
              return { error: null };
            },
          };
        },
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data: { ...row }, error: null };
                },
              };
            },
          };
        },
      } as any;
    },
  };
  return admin;
}

describe("resumeAgentAfterPaymentConfirmed", () => {
  it("un-parks the conversation: status back to active and agent enabled", async () => {
    const admin = makeAdmin({ allowed: ["active", "awaiting_payment"], initialStatus: "awaiting_payment" });
    const res = await resumeAgentAfterPaymentConfirmed(admin, "c1");
    expect(res.ok).toBe(true);
    expect(admin.row.status).toBe("active");
    expect(admin.row.agent_enabled).toBe(true);
  });

  it("falls back to another accepted status when the DB rejects 'active'", async () => {
    const admin = makeAdmin({ allowed: ["open", "awaiting_payment"], initialStatus: "awaiting_payment" });
    const res = await resumeAgentAfterPaymentConfirmed(admin, "c1");
    expect(admin.row.status).toBe("open");
    expect(admin.row.agent_enabled).toBe(true);
    expect(res.ok).toBe(true);
  });

  it("still turns the agent back on when no status value is accepted", async () => {
    const admin = makeAdmin({ allowed: [], initialStatus: "awaiting_payment" });
    await resumeAgentAfterPaymentConfirmed(admin, "c1");
    expect(admin.row.agent_enabled).toBe(true);
  });

  it("marks the pending payment notification as read", async () => {
    const admin = makeAdmin({ allowed: ["active"], initialStatus: "awaiting_payment" });
    await resumeAgentAfterPaymentConfirmed(admin, "c1");
    expect(admin.notifications.every((n) => n.read)).toBe(true);
  });

  it("knows which statuses keep the agent parked", () => {
    expect(isParkedStatus("awaiting_payment")).toBe(true);
    expect(isParkedStatus("needs_human")).toBe(true);
    expect(isParkedStatus("active")).toBe(false);
    expect(isParkedStatus(null)).toBe(false);
  });
});

describe("agent awareness of a confirmed payment", () => {
  it("tells the agent the payment is already confirmed", () => {
    const out = buildActiveOrderStateBlock({
      order: { order_number: "ORD-9", status: "new", payment_status: "confirmed" },
    });
    expect(out).toContain("حالة الدفع: تم تأكيد الدفع بالفعل");
    expect(out).not.toContain("لم يتم تأكيد الدفع بعد");
  });

  it("keeps saying the payment is pending while it really is", () => {
    const out = buildActiveOrderStateBlock({
      order: { order_number: "ORD-9", status: "new", payment_status: "pending" },
    });
    expect(out).toContain("حالة الدفع: لم يتم تأكيد الدفع بعد");
  });
});

describe("chat route gate", () => {
  it("only silences an awaiting_payment conversation while the agent toggle is off", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/routes/api/chat-ai.ts", "utf8");
    expect(src).toContain('convo.status === "awaiting_payment" && !agentToggleOn');
  });
});
