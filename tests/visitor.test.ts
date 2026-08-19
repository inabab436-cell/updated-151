/**
 * resolveVisitorId issues / reads a stable visitor cookie. It reads the
 * request Cookie header directly, so we can exercise it without a full
 * TanStack Start request context.
 */
import { describe, it, expect } from "vitest";
import { resolveVisitorId, visitorCookieHeader } from "@/routes/api/visitor";

function makeRequest(cookie?: string): Request {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  return new Request("http://example/api/visitor", { headers });
}

describe("resolveVisitorId", () => {
  it("reuses the visitor id when the request already carries a cookie", () => {
    const req = makeRequest("cupai_vid=existing-visitor-id-1234");
    const { visitorId, setCookieHeader } = resolveVisitorId(req);
    expect(visitorId).toBe("existing-visitor-id-1234");
    // No Set-Cookie needed when the cookie is already present.
    expect(setCookieHeader).toBeNull();
  });

  it("issues a new id and Set-Cookie header when no cookie is present", () => {
    const { visitorId, setCookieHeader } = resolveVisitorId(makeRequest());
    expect(visitorId.length).toBeGreaterThanOrEqual(8);
    expect(setCookieHeader).toBeTruthy();
    expect(setCookieHeader).toContain("cupai_vid=");
    expect(setCookieHeader).toContain("HttpOnly");
    expect(setCookieHeader).toContain("SameSite=Lax");
  });

  it("honours a caller-provided fallback id when it is long enough", () => {
    const { visitorId } = resolveVisitorId(makeRequest(), "fallback-visitor-abc");
    expect(visitorId).toBe("fallback-visitor-abc");
  });

  it("ignores short fallback ids and generates its own", () => {
    const { visitorId } = resolveVisitorId(makeRequest(), "abc");
    expect(visitorId).not.toBe("abc");
    expect(visitorId.length).toBeGreaterThanOrEqual(8);
  });

  it("visitorCookieHeader emits the documented Set-Cookie attributes", () => {
    const header = visitorCookieHeader("some-visitor-id");
    expect(header).toContain("cupai_vid=some-visitor-id");
    expect(header).toContain("Max-Age=31536000");
    expect(header).toContain("Path=/");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
  });
});
