import { NextResponse } from "next/server";

import { requireAdminSession, requireUserManagerSession } from "@/lib/auth-server";
import { responseError, supabaseConfig, supabaseRequest } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireUserManagerSession();
  if (auth.response || !auth.session) return auth.response;
  const query = auth.session.role === "customer_admin"
    ? `customers?select=id,name,active,app_users(user_id,email,full_name,role,active)&id=eq.${encodeURIComponent(auth.session.customerId ?? "")}`
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
    // Check both identifiers before creating anything: the login is optional,
    // but a known email conflict must not leave a half-created customer behind.
    const [codeCheck, emailCheck] = await Promise.all([
      supabaseRequest(`customers?select=id&code=eq.${encodeURIComponent(code)}&limit=1`),
      email ? supabaseRequest(`app_users?select=user_id&email=eq.${encodeURIComponent(email)}&limit=1`) : Promise.resolve(null),
    ]);
    if (!codeCheck.ok || (emailCheck && !emailCheck.ok)) return NextResponse.json({ error: "暂时无法核对客户代码或邮箱，请稍后重试。 / Unable to check customer identifiers. Try again later." }, { status: 503 });
    const [matchingCodes, matchingEmails] = await Promise.all([codeCheck.json(), emailCheck ? emailCheck.json() : Promise.resolve([])]);
    if (!Array.isArray(matchingCodes) || !Array.isArray(matchingEmails)) return NextResponse.json({ error: "暂时无法核对客户资料，请稍后重试。 / Unable to verify customer details." }, { status: 503 });
    const conflicts: string[] = [];
    if (matchingCodes.length) conflicts.push("客户代码已被使用，请换一个唯一代码。 / Customer code is already in use; choose another code.");
    if (matchingEmails.length) conflicts.push("邮箱已绑定现有登录用户，请使用其他邮箱；如需调整原用户，请在用户管理中编辑。 / Email already belongs to a login user; use another email or edit the existing user.");
    if (conflicts.length) return NextResponse.json({ code: "CUSTOMER_IDENTIFIER_CONFLICT", error: conflicts.join("\n") }, { status: 409 });
    const customerResponse = await supabaseRequest("customers", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ name, code, active: true, can_self_book: body.canSelfBook !== false, markup_percent: Math.max(0, Number(body.markupPercent) || 0), minimum_markup: Math.max(0, Number(body.minimumMarkup) || 0) }),
    });
    if (!customerResponse.ok) {
      const failure = await customerResponse.clone().json().catch(() => null);
      if (failure?.code === "23505") return NextResponse.json({ code: "CUSTOMER_IDENTIFIER_CONFLICT", error: "客户代码已被使用，请换一个唯一代码。 / Customer code is already in use; choose another code." }, { status: 409 });
      return NextResponse.json({ error: await responseError(customerResponse, "Unable to create the customer.") }, { status: 502 });
    }
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
