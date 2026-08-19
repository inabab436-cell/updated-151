/** Server-only session reader that throws when unauthenticated. */
import { getSession } from "@tanstack/react-start/server";
import { getSessionConfig, type AppSessionData } from "@/lib/session.server";

export async function requireUserId(): Promise<{ userId: string; email: string }> {
  const session = await getSession<AppSessionData>(getSessionConfig());
  if (!session.data?.userId) {
    throw new Error("يجب تسجيل الدخول أولاً.");
  }
  return { userId: session.data.userId, email: session.data.email ?? "" };
}
