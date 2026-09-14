import { NextResponse } from "next/server";

import { authSchemaStatus, setAuthCookies, supabaseAuth } from "@/lib/auth-server";
import { responseError, supabaseConfig, supabaseRequest } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const schema = await authSchemaStatus();
    if (!schema.ready) return NextResponse.json({ error: "Run the customer login SQL first." }, { status: 503 });
    if (schema.hasUsers) return NextResponse.json({ error: "The administrator account has already been created." }, { status: 409 });
    const body = await request.json();
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!name || !/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: "Enter the administrator name and a valid email." }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ error: "Password must contain at least 8 characters." }, { status: 400 });

    const { url, key } = supabaseConfig();
    const createResponse = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      cache: "no-store",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: name } }),
    });
    if (!createResponse.ok) return NextResponse.json({ error: await responseError(createResponse, "Unable to create the administrator account.") }, { status: 502 });
    const authUser = await createResponse.json();
    const customerResponse = await supabaseRequest("customers?select=id&is_internal=eq.true&limit=1");
    const customers = customerResponse.ok ? await customerResponse.json() : [];
    if (!customers[0]?.id) return NextResponse.json({ error: "The default customer record is missing." }, { status: 503 });
    const profileResponse = await supabaseRequest("app_users", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ user_id: authUser.id, customer_id: customers[0].id, email, full_name: name, role: "admin", active: true }),
    });
    if (!profileResponse.ok) {
      await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(authUser.id)}`, { method: "DELETE", headers: { apikey: key, Authorization: `Bearer ${key}` } });
      return NextResponse.json({ error: await responseError(profileResponse, "Unable to create the administrator profile.") }, { status: 502 });
    }

    const loginResponse = await supabaseAuth("token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
    if (!loginResponse.ok) return NextResponse.json({ created: true, signedIn: false });
    const session = await loginResponse.json();
    await setAuthCookies(session.access_token, session.refresh_token, Number(session.expires_in));
    return NextResponse.json({ created: true, signedIn: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create the administrator account." }, { status: 500 });
  }
}
