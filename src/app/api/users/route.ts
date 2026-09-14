import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/auth-server";
import { responseError, supabaseConfig, supabaseRequest } from "@/lib/supabase-server";

export async function POST(request: Request) {
  const auth = await requireAdminSession();
  if (auth.response || !auth.session) return auth.response;
  try {
    const body = await request.json();
    const customerId = String(body.customerId || "");
    const email = String(body.email || "").trim().toLowerCase();
    const fullName = String(body.fullName || "").trim();
    const password = String(body.password || "");
    const role = ["admin", "operations", "sales", "customer"].includes(body.role) ? body.role : "customer";
    if (!/^[0-9a-f-]{36}$/i.test(customerId) || !/^\S+@\S+\.\S+$/.test(email) || !fullName || password.length < 8) {
      return NextResponse.json({ error: "Customer, name, valid email, and password of at least 8 characters are required." }, { status: 400 });
    }
    const customerResponse = await supabaseRequest(`customers?select=id&id=eq.${encodeURIComponent(customerId)}&limit=1`);
    if (!customerResponse.ok || !(await customerResponse.json())[0]) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
    const { url, key } = supabaseConfig();
    const userResponse = await fetch(`${url}/auth/v1/admin/users`, { method: "POST", cache: "no-store", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: fullName } }) });
    if (!userResponse.ok) return NextResponse.json({ error: await responseError(userResponse, "Unable to create the login user.") }, { status: 502 });
    const user = await userResponse.json();
    const profileResponse = await supabaseRequest("app_users", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ user_id: user.id, customer_id: customerId, email, full_name: fullName, role, active: true }) });
    if (!profileResponse.ok) {
      await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE", headers: { apikey: key, Authorization: `Bearer ${key}` } });
      return NextResponse.json({ error: await responseError(profileResponse, "Unable to create the user profile.") }, { status: 502 });
    }
    return NextResponse.json({ user: (await profileResponse.json())[0] }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create the login user." }, { status: 500 });
  }
}
