import { NextResponse } from "next/server";

import { requireAdminSession, requireUserManagerSession } from "@/lib/auth-server";
import { responseError, supabaseConfig, supabaseRequest } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireUserManagerSession();
  if (auth.response || !auth.session) return auth.response;
  const query = auth.session.role === "customer_admin"
    ? `customers?select=id,name,active,app_users(user_id,email,full_name,role,active)&id=eq.${encodeURIComponent(auth.session.customerId ?? "")}&app_users.role=eq.customer`
    : "customers?select=id,name,code,active,is_internal,can_self_book,markup_percent,minimum_markup,created_at,app_users(user_id,email,full_name,role,active)&order=is_internal.desc,name.asc";
  const response = await supabaseRequest(query);
  if (!response.ok) return NextResponse.json({ error: "Unable to load customers." }, { status: 502 });
  return NextResponse.json({ customers: await response.json(), activeCustomerId: auth.session.customerId });
}

export async function POST(request: Request) {
  const auth = await requireAdminSession();
  if (auth.response || !auth.session) return auth.response;
  try {
    const body = await request.json();
    const name = String(body.name || "").trim();
    const code = String(body.code || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
    const email = String(body.email || "").trim().toLowerCase();
    const userName = String(body.userName || "").trim();
    const password = String(body.password || "");
    if (!name || !code) return NextResponse.json({ error: "Customer name and code are required." }, { status: 400 });
    if (email && (!/^\S+@\S+\.\S+$/.test(email) || !userName || password.length < 8)) {
      return NextResponse.json({ error: "For a login user, enter a valid email, name, and password of at least 8 characters." }, { status: 400 });
    }
    const customerResponse = await supabaseRequest("customers", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ name, code, active: true, can_self_book: body.canSelfBook !== false, markup_percent: Math.max(0, Number(body.markupPercent) || 0), minimum_markup: Math.max(0, Number(body.minimumMarkup) || 0) }),
    });
    if (!customerResponse.ok) return NextResponse.json({ error: await responseError(customerResponse, "Unable to create the customer.") }, { status: 502 });
    const customer = (await customerResponse.json())[0];
    await supabaseRequest("deposit_accounts", { method: "POST", body: JSON.stringify({ customer_id: customer.id, available_balance: 0 }) });

    if (email) {
      const { url, key } = supabaseConfig();
      const userResponse = await fetch(`${url}/auth/v1/admin/users`, { method: "POST", cache: "no-store", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: userName } }) });
      if (!userResponse.ok) return NextResponse.json({ error: `Customer created, but the login user failed: ${await responseError(userResponse, "Unable to create user.")}`, customer }, { status: 502 });
      const user = await userResponse.json();
      const profileResponse = await supabaseRequest("app_users", { method: "POST", body: JSON.stringify({ user_id: user.id, customer_id: customer.id, email, full_name: userName, role: "customer", active: true }) });
      if (!profileResponse.ok) return NextResponse.json({ error: `Customer created, but the user profile failed: ${await responseError(profileResponse, "Unable to create user profile.")}`, customer }, { status: 502 });
    }
    return NextResponse.json({ customer }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create the customer." }, { status: 500 });
  }
}
