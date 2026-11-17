import { NextResponse } from "next/server";

import { appRoles, customerFilter, normalizeLoginEmail, requireAdminSession, requireUserManagerSession } from "@/lib/auth-server";
import { responseError, supabaseConfig, supabaseRequest } from "@/lib/supabase-server";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminSession();
  if (auth.response || !auth.session) return auth.response;
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid user ID." }, { status: 400 });
  const profileResponse = await supabaseRequest(`app_users?select=*&user_id=eq.${encodeURIComponent(id)}&limit=1`);
  if (!profileResponse.ok) return NextResponse.json({ error: "Unable to load user." }, { status: 502 });
  const profile = (await profileResponse.json())[0];
  if (!profile) return NextResponse.json({ error: "User not found." }, { status: 404 });
  const { url, key } = supabaseConfig();
  const response = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(id)}`, { cache: "no-store", headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!response.ok) return NextResponse.json({ error: "Unable to load user profile." }, { status: 502 });
  const user = await response.json();
  const saved = user.user_metadata?.ltl_profile;
  const [firstName, ...lastName] = profile.full_name.split(/\s+/);
  return NextResponse.json({ user: { ...profile, email: user.email, firstName: saved?.firstName ?? firstName, lastName: saved?.lastName ?? lastName.join(" "), phone: saved?.phone ?? "" } }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireUserManagerSession();
  if (auth.response || !auth.session) return auth.response;
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid user ID." }, { status: 400 });
  const body = await request.json();
  const fullName = String(body.fullName || "").trim();
  const password = String(body.password || "");
  const requestedEmail = normalizeLoginEmail(body.requestedEmail);
  if (body.requestedEmail !== undefined && !requestedEmail) {
    return NextResponse.json({ error: "Enter a valid login email." }, { status: 400 });
  }
  const scoped = auth.session.role === "customer_admin";
  if (scoped && ["email", "customerId", "firstName", "lastName", "phone"].some((field) => body[field] !== undefined)) {
    return NextResponse.json({ error: "Platform administrator access is required for these fields." }, { status: 403 });
  }
  if (scoped && ((body.role !== undefined && body.role !== "customer" && body.role !== "customer_admin") || password)) {
    return NextResponse.json({ error: "Only a platform administrator can change roles or reset existing passwords." }, { status: 403 });
  }
  if (scoped && id.toLowerCase() === auth.session.userId.toLowerCase() && body.active === false) {
    return NextResponse.json({ error: "You cannot deactivate the account you are currently using." }, { status: 409 });
  }
  if (!fullName) return NextResponse.json({ error: "User name is required." }, { status: 400 });
  if (password && password.length < 8) return NextResponse.json({ error: "The new password must contain at least 8 characters." }, { status: 400 });
  if (!scoped && body.role !== undefined && !appRoles.includes(body.role)) return NextResponse.json({ error: "Invalid role." }, { status: 400 });
  const email = body.email === undefined ? undefined : normalizeLoginEmail(body.email);
  if (email === null) return NextResponse.json({ error: "Enter a valid login email." }, { status: 400 });
  const hasPersonalDetails = ["firstName", "lastName", "phone"].some((field) => body[field] !== undefined);
  if (hasPersonalDetails && (typeof body.firstName !== "string" || !body.firstName.trim() || body.firstName.length > 80 || typeof body.lastName !== "string" || body.lastName.length > 80 || typeof body.phone !== "string" || body.phone.length > 40)) {
    return NextResponse.json({ error: "Enter valid name and phone details." }, { status: 400 });
  }
  if (!scoped && id.toLowerCase() === auth.session.userId.toLowerCase() && (body.active === false || (body.role !== undefined && body.role !== "admin"))) {
    return NextResponse.json({ error: "Use another administrator account to change your own role or deactivate this account." }, { status: 409 });
  }
  if (!scoped && body.customerId !== undefined) {
    if (!/^[0-9a-f-]{36}$/i.test(String(body.customerId))) return NextResponse.json({ error: "Select a customer." }, { status: 400 });
    const customer = await supabaseRequest(`customers?select=id&id=eq.${encodeURIComponent(body.customerId)}&limit=1`);
    if (!customer.ok) return NextResponse.json({ error: "Unable to verify customer." }, { status: 502 });
    if (!(await customer.json())[0]) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  }

  const scope = scoped
    ? `${customerFilter(auth.session)}&role=${body.role ? `eq.${body.role}` : "in.(customer,customer_admin)"}`
    : "";
  const profile = {
    full_name: fullName,
    updated_at: new Date().toISOString(),
    ...(requestedEmail ? { requested_email: requestedEmail } : {}),
    ...(!scoped && body.customerId !== undefined ? { customer_id: body.customerId } : {}),
    ...(scoped
      ? (typeof body.active === "boolean" ? { active: body.active } : {})
      : { ...(body.role !== undefined ? { role: body.role } : {}), ...(body.active !== undefined ? { active: body.active !== false } : {}) }),
  };
  if (!scoped && (email || password || hasPersonalDetails)) {
    const lookup = await supabaseRequest(`app_users?select=user_id&user_id=eq.${encodeURIComponent(id)}&limit=1`);
    if (!lookup.ok) return NextResponse.json({ error: "Unable to verify user." }, { status: 502 });
    if (!(await lookup.json())[0]) return NextResponse.json({ error: "User not found." }, { status: 404 });
    if (email) {
      const migration = await supabaseRequest("app_users?select=requested_email&limit=0");
      if (!migration.ok) return NextResponse.json({ error: "Run the login email change migration first." }, { status: 503 });
    }
    const { url, key } = supabaseConfig();
    const userMetadata = { full_name: fullName, ...(hasPersonalDetails ? { ltl_profile: { firstName: body.firstName.trim(), lastName: body.lastName.trim(), phone: body.phone.trim() } } : {}) };
    const response = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
      method: "PUT", cache: "no-store",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...(email ? { email, email_confirm: true } : {}), ...(password ? { password } : {}), user_metadata: userMetadata }),
    });
    if (!response.ok) return NextResponse.json({ error: await responseError(response, "Unable to update login details.") }, { status: 502 });
  }
  const profileResponse = await supabaseRequest(`app_users?user_id=eq.${encodeURIComponent(id)}${scope}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(profile),
  });
  if (!profileResponse.ok) return NextResponse.json({ error: scoped ? "Unable to update the user." : "Login details may have been saved, but the user profile could not be updated. Reload the user and retry." }, { status: 502 });
  const rows = await profileResponse.json();
  if (!rows.length) return NextResponse.json({ error: "User not found." }, { status: 404 });
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
