import { NextResponse } from "next/server";

import { authResponseError, setAuthCookies, supabaseAuth } from "@/lib/auth-server";
import { permitLogin } from "@/lib/login-throttle";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || !password || email.length > 254 || password.length > 1024) return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
    if (!await permitLogin(request, email)) return NextResponse.json({ error: "Too many sign-in attempts. Wait 15 minutes before trying again." }, { status: 429, headers: { "Retry-After": "900" } });
    const response = await supabaseAuth("token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
    if (!response.ok) return NextResponse.json({ error: await authResponseError(response, "Unable to sign in.") }, { status: 401 });
    const session = await response.json();
    await setAuthCookies(session.access_token, session.refresh_token, Number(session.expires_in));
    return NextResponse.json({ signedIn: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to sign in." }, { status: 500 });
  }
}
