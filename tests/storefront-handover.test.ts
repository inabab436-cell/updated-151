import { describe, expect, it } from "vitest";

import {
  DEFAULT_MANUAL_HANDOVER_MESSAGE,
  buildHandoverChatMessage,
} from "@/lib/storefront-handover.server";

describe("buildHandoverChatMessage", () => {
  it("falls back to the default payment sentence when empty", () => {
    expect(buildHandoverChatMessage("")).toBe(DEFAULT_MANUAL_HANDOVER_MESSAGE);
    expect(buildHandoverChatMessage(null)).toBe(DEFAULT_MANUAL_HANDOVER_MESSAGE);
  });

  it("keeps the merchant confirmation wording as a single short line", () => {
    const msg = buildHandoverChatMessage("تمام،  تم تأكيد الاوردر.\nمن فضلك حوّل\tوابعت اللقطة.");
    expect(msg).toBe("تمام، تم تأكيد الاوردر. من فضلك حوّل وابعت اللقطة.");
    expect(msg).not.toContain("\n");
  });

  it("never lets a long template become a wall of order details", () => {
    const msg = buildHandoverChatMessage("ا".repeat(2000));
    expect(msg.length).toBe(400);
  });
});
