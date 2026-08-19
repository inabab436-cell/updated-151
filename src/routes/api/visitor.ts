/**
 * Persistent visitor identity endpoint.
 *
 * Issues a stable `cupai_vid` value stored in an httpOnly Cookie (1 year,
 * SameSite=Lax). If a cookie is already present, its value is returned as-is
 * so the same visitor is recognized across tabs, mode=new links, and even
 * after localStorage is cleared. Clients also mirror the value into
 * localStorage as a defense-in-depth fallback for environments that drop
 * third-party cookies inside embedded contexts.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getCookie, setCookie } from "@tanstack/react-start/server";

const COOKIE_NAME = "cupai_vid";
const ONE_YEAR = 60 * 60 * 24 * 365;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function randomId(): string {
  const c: Crypto | undefined =
    typeof crypto !== "undefined" ? (crypto as Crypto) : undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `v_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function cookieValueFromRequest(request: Request | undefined): string | null {
  const raw = request?.headers.get("cookie") ?? "";
  const found = raw
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (!found) return null;
  const value = decodeURIComponent(found.slice(COOKIE_NAME.length + 1));
  return value && value.length >= 8 ? value : null;
}

export function visitorCookieHeader(visitorId: string): string {
  return `${COOKIE_NAME}=${encodeURIComponent(visitorId)}; Path=/; Max-Age=${ONE_YEAR}; HttpOnly; SameSite=Lax; Secure`;
}

export function resolveVisitorId(
  request?: Request,
  fallbackVisitorId?: string | null,
): { visitorId: string; setCookieHeader: string | null } {
  const fromRequest = cookieValueFromRequest(request);
  if (fromRequest) return { visitorId: fromRequest, setCookieHeader: null };

  let fromContext: string | null = null;
  try {
    fromContext = getCookie(COOKIE_NAME) ?? null;
  } catch {
    fromContext = null;
  }
  if (fromContext && fromContext.length >= 8) {
    return { visitorId: fromContext, setCookieHeader: visitorCookieHeader(fromContext) };
  }

  const id = fallbackVisitorId && fallbackVisitorId.length >= 8 ? fallbackVisitorId : randomId();
  try {
    setCookie(COOKIE_NAME, id, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: ONE_YEAR,
    });
  } catch {
    // The explicit Set-Cookie header below is the reliable path for server routes.
  }
  return { visitorId: id, setCookieHeader: visitorCookieHeader(id) };
}

export function readOrIssueVisitorId(): string {
  return resolveVisitorId().visitorId;
}

export const Route = createFileRoute("/api/visitor")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: corsHeaders }),
      GET: async ({ request }) => {
        const fallback = new URL(request.url).searchParams.get("fallback");
        const resolved = resolveVisitorId(request, fallback);
        const visitor_id = resolved.visitorId;
        const headers = { ...corsHeaders, "Content-Type": "application/json" } as Record<string, string>;
        if (resolved.setCookieHeader) headers["Set-Cookie"] = resolved.setCookieHeader;
        return new Response(JSON.stringify({ visitor_id }), {
          status: 200,
          headers,
        });
      },
    },
  },
});
