import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-server";
import { auditTqlConfiguration, testTqlAuthentication, tqlConnectionStatus } from "@/lib/carriers/tql";

export const runtime = "nodejs";
export const maxDuration = 30;
const attempts = new Map<string, number>();
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  const auth = await requireAdminSession();
  if (!auth.session || auth.response) return auth.response;
  try { return json(auditTqlConfiguration()); }
  catch { return json({ error: "TQL_AUTH_MODE must be public or legacy." }, 503); }
}

export async function POST(request: Request) {
  const auth = await requireAdminSession();
  if (!auth.session || auth.response) return auth.response;
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Please run the test from this website." }, 403);
  try {
    const status = tqlConnectionStatus();
    if (status.missing.length) return json({ authenticated: false, ...status, error: `Configure in Vercel: ${status.missing.join(", ")}` }, 503);
    const now = Date.now();
    for (const [id, time] of attempts) if (now - time >= 30_000) attempts.delete(id);
    if (attempts.has(auth.session.userId)) return json({ error: "Wait 30 seconds before testing again." }, 429);
    attempts.set(auth.session.userId, now);
    return json(await testTqlAuthentication());
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const safe = message.startsWith("TQL authentication returned HTTP") || message === "TQL_AUTH_MODE must be public or legacy." || message.startsWith("Use the HTTPS public.api.tql.com") ? message : "TQL authentication could not complete. Check the configuration or try again later.";
    return json({ authenticated: false, error: safe }, 502);
  }
}
