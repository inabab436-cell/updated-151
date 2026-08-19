import { describe, it, expect } from "vitest";
import { extractPhoneCandidate, checkIdentityIntake } from "@/lib/identity-intake";
describe("phone candidate", () => {
  const bad = ["0165705518","016 5705518","٠١٦٥٧٠٥٥١٨","+201657055181","01312345678","0101234567","010123456789","تمام رقمي 0175705518 يا فندم","0165705518."];
  it("always rejects", () => {
    for (const b of bad) {
      const c = extractPhoneCandidate(b);
      expect(c, b).toBeTruthy();
      expect(checkIdentityIntake({ phone: c! }).length, b).toBe(1);
    }
  });
  it("accepts real ones", () => {
    for (const g of ["01012345678","رقمي 01598765432","+201112345678"]) {
      const c = extractPhoneCandidate(g);
      expect(c, g).toBeTruthy();
      expect(checkIdentityIntake({ phone: c! }), g).toEqual([]);
    }
  });
  it("ignores non-phone text", () => {
    expect(extractPhoneCandidate("عايز 3 قطع")).toBeNull();
  });
});
