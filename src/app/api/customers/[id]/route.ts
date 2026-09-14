import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/auth-server";
import { responseError, supabaseRequest } from "@/lib/supabase-server";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminSession();
  if (auth.response || !auth.session) return auth.response;
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid customer ID." }, { status: 400 });
  const body = await request.json();
  const record = {
    name: String(body.name || "").trim(),
    active: body.active !== false,
    can_self_book: body.canSelfBook !== false,
    markup_percent: Math.max(0, Number(body.markupPercent) || 0),
    minimum_markup: Math.max(0, Number(body.minimumMarkup) || 0),
    updated_at: new Date().toISOString(),
  };
  if (!record.name) return NextResponse.json({ error: "Customer name is required." }, { status: 400 });
  const response = await supabaseRequest(`customers?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(record) });
  if (!response.ok) return NextResponse.json({ error: await responseError(response, "Unable to update the customer.") }, { status: 502 });
  const rows = await response.json();
  if (!rows.length) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  return NextResponse.json({ customer: rows[0] });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminSession();
  if (auth.response || !auth.session) return auth.response;
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid customer ID." }, { status: 400 });
  const customerResponse = await supabaseRequest(`customers?select=id,name,is_internal&id=eq.${encodeURIComponent(id)}&limit=1`);
  const customer = customerResponse.ok ? (await customerResponse.json())[0] : null;
  if (!customer) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  if (customer.is_internal) return NextResponse.json({ error: "The internal Qianyushi customer cannot be deleted." }, { status: 409 });
  if (auth.session.customerId === id) return NextResponse.json({ error: "Switch to another customer before deleting this customer." }, { status: 409 });

  const encodedId = encodeURIComponent(id);
  const checks = await Promise.all([
    supabaseRequest(`saved_quotes?select=id&customer_id=eq.${encodedId}&limit=1`),
    supabaseRequest(`address_book?select=id&customer_id=eq.${encodedId}&limit=1`),
    supabaseRequest(`deposit_transactions?select=id&customer_id=eq.${encodedId}&limit=1`),
    supabaseRequest(`app_users?select=user_id&customer_id=eq.${encodedId}&limit=1`),
  ]);
  const labels = ["quotes or orders", "saved addresses", "deposit activity", "login users"];
  for (let index = 0; index < checks.length; index += 1) {
    const response = checks[index];
    if (!response.ok) return NextResponse.json({ error: `Unable to verify customer ${labels[index]}.` }, { status: 502 });
    if ((await response.json()).length) {
      return NextResponse.json({ error: `This customer has ${labels[index]}. Disable the customer instead of deleting it.` }, { status: 409 });
    }
  }

  const accountResponse = await supabaseRequest(`deposit_accounts?customer_id=eq.${encodedId}`, { method: "DELETE" });
  if (!accountResponse.ok) return NextResponse.json({ error: await responseError(accountResponse, "Unable to remove the empty deposit account.") }, { status: 502 });
  const deleteResponse = await supabaseRequest(`customers?id=eq.${encodedId}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
  if (!deleteResponse.ok) return NextResponse.json({ error: await responseError(deleteResponse, "Unable to delete the customer.") }, { status: 502 });
  return NextResponse.json({ deleted: true });
}
