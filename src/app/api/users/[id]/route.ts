import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/auth-server";
import { responseError, supabaseConfig, supabaseRequest } from "@/lib/supabase-server";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminSession();
  if (auth.response || !auth.session) return auth.response;
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid user ID." }, { status: 400 });
  const body = await request.json();
  const fullName = String(body.fullName || "").trim();
  const role = ["admin", "operations", "sales", "customer"].includes(body.role) ? body.role : "customer";
  const password = String(body.password || "");
  if (!fullName) return NextResponse.json({ error: "User name is required." }, { status: 400 });
  if (password && password.length < 8) return NextResponse.json({ error: "The new password must contain at least 8 characters." }, { status: 400 });
  const profileResponse = await supabaseRequest(`app_users?user_id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ full_name: fullName, role, active: body.active !== false, updated_at: new Date().toISOString() }) });
  if (!profileResponse.ok) return NextResponse.json({ error: await responseError(profileResponse, "Unable to update the user.") }, { status: 502 });
  const rows = await profileResponse.json();
  if (!rows.length) return NextResponse.json({ error: "User not found." }, { status: 404 });
  if (password) {
    const { url, key } = supabaseConfig();
    const authResponse = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: "PUT", cache: "no-store", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ password, user_metadata: { full_name: fullName } }) });
    if (!authResponse.ok) return NextResponse.json({ error: await responseError(authResponse, "Profile updated, but the password could not be changed.") }, { status: 502 });
  }
  return NextResponse.json({ user: rows[0] });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminSession();
  if (auth.response || !auth.session) return auth.response;
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid user ID." }, { status: 400 });
  if (id === auth.session.userId) return NextResponse.json({ error: "You cannot delete the account you are currently using." }, { status: 409 });
  const profileResponse = await supabaseRequest(`app_users?select=user_id&user_id=eq.${encodeURIComponent(id)}&limit=1`);
  const profile = profileResponse.ok ? (await profileResponse.json())[0] : null;
  if (!profile) return NextResponse.json({ error: "User not found." }, { status: 404 });
  const { url, key } = supabaseConfig();
  const response = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: "DELETE", cache: "no-store", headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!response.ok) return NextResponse.json({ error: await responseError(response, "Unable to delete the login user.") }, { status: 502 });
  return NextResponse.json({ deleted: true });
}
