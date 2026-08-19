import { describe, it, expect } from "vitest";
import {
  checkIdentityIntake,
  buildIdentityIntakeBlock,
  buildPhoneCorrectionReply,
} from "@/lib/identity-intake";

describe("immediate identity intake validation", () => {
  it("flags a single-word name", () => {
    const issues = checkIdentityIntake({ name: "أحمد" });
    expect(issues.map((i) => i.field)).toEqual(["name"]);
  });

  it("accepts a two-part name", () => {
    expect(checkIdentityIntake({ name: "أحمد محمود" })).toEqual([]);
  });

  it("flags a phone that is not 11 digits", () => {
    expect(checkIdentityIntake({ phone: "0100123456" })[0]?.field).toBe("phone");
    expect(checkIdentityIntake({ phone: "01001234567" })).toEqual([]);
  });

  it("describes 012884 as incomplete without reciting the full rule", () => {
    const issue = checkIdentityIntake({ phone: "012884" })[0];
    const reply = buildPhoneCorrectionReply(
      issue?.reason ?? "invalid",
      null,
      issue?.value,
    );

    expect(issue).toMatchObject({ field: "phone", reason: "too_short", value: "012884" });
    expect(reply).toMatch(/ناقص|مش كامل/);
    expect(reply).not.toContain("11 رقم");
    expect(reply).not.toContain("010");
    expect(reply).not.toContain("011");
    expect(reply).not.toContain("012");
    expect(reply).not.toContain("015");
  });

  it("describes a very short phone generally without claiming one digit is missing", () => {
    const issue = checkIdentityIntake({ phone: "0125" })[0];

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const reply = buildPhoneCorrectionReply(
        issue?.reason ?? "invalid",
        null,
        issue?.value,
      );
      expect(reply).toMatch(/ناقص|مش كامل/);
      expect(reply).not.toContain("ناقص رقم");
      expect(reply).not.toContain("مش راكب");
    }
  });

  it("may say one digit is missing only when exactly one digit is missing", () => {
    const issue = checkIdentityIntake({ phone: "0101234567" })[0];
    const reply = buildPhoneCorrectionReply(
      issue?.reason ?? "invalid",
      null,
      issue?.value,
    );

    expect(reply).toContain("ناقص رقم");
  });

  it.each([
    ["wrong prefix", "01712345678", "bad_prefix"],
    ["too short", "0101234567", "too_short"],
    ["too long", "010123456789", "too_long"],
    ["wrong prefix and length", "0171234567", "bad_prefix"],
  ])("rejects %s and produces a short friendly correction reply", (_label, phone, reason) => {
    const issue = checkIdentityIntake({ phone })[0];
    expect(issue).toMatchObject({ field: "phone", reason });
    const reply = buildPhoneCorrectionReply(issue?.reason ?? "invalid");
    // Friendly + human: mentions the number is wrong, no technical rule dump.
    expect(reply).toContain("الرقم");
    expect(reply).not.toContain("11 رقم");
    expect(reply).not.toContain("010");
    expect(reply).not.toContain("015");
    expect(reply.length).toBeLessThan(120);
  });

  it("flags an address that is only a governorate", () => {
    const issues = checkIdentityIntake({ address: "القاهرة" });
    expect(issues[0]?.field).toBe("address");
    expect(issues[0]?.missing).toContain("street_or_landmark");
  });

  it("accepts a detailed address", () => {
    expect(
      checkIdentityIntake({ address: "القاهرة - مدينة نصر - شارع عباس العقاد برج ٥" }),
    ).toEqual([]);
  });

  it("ignores fields the customer has not given yet", () => {
    expect(checkIdentityIntake({})).toEqual([]);
  });

  it("builds an empty prompt block when everything is valid", () => {
    expect(buildIdentityIntakeBlock([])).toBe("");
  });

  it("builds a prompt block that demands correction in the same turn", () => {
    const block = buildIdentityIntakeBlock(checkIdentityIntake({ name: "أحمد" }));
    expect(block).toContain("تحقّق فوري");
    expect(block.length).toBeGreaterThan(20);
  });
});
