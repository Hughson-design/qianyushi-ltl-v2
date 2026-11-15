import { NextResponse } from "next/server";

import { responseError, supabaseRequest } from "@/lib/supabase-server";
import { customerFilter, requireAppSession } from "@/lib/auth-server";

export const runtime = "nodejs";

const addressFields = ["company", "country", "address1", "address2", "zip", "state", "city", "phone", "extension", "contact", "email"] as const;

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid address ID." }, { status: 400 });
  try {
    const auth = await requireAppSession();
    if (auth.response || !auth.session) return auth.response;
    const body = await request.json();
    const { category } = body;
    if (category !== undefined && category !== "sender" && category !== "receiver") {
      return NextResponse.json({ error: "Invalid address category." }, { status: 400 });
    }
    const address = Object.fromEntries(addressFields.map((field) => [field, String(body[field] || "").trim()]));
    if (!address.company || !address.address1 || !/^\d{5}$/.test(address.zip) || !address.state || !address.city) {
      return NextResponse.json({ error: "Company, address, ZIP, state, and city are required." }, { status: 400 });
    }
    const response = await supabaseRequest(`address_book?id=eq.${encodeURIComponent(id)}${customerFilter(auth.session)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ ...address, ...(category === undefined ? {} : { category }), country: address.country || "United States", state: address.state.toUpperCase(), updated_at: new Date().toISOString() }),
    });
    if (!response.ok) return NextResponse.json({ error: await responseError(response, "Unable to update this address.") }, { status: 502 });
    const rows = await response.json();
    if (!rows.length) return NextResponse.json({ error: "Address not found." }, { status: 404 });
    return NextResponse.json({ address: rows[0] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update this address." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid address ID." }, { status: 400 });
  try {
    const auth = await requireAppSession();
    if (auth.response || !auth.session) return auth.response;
    const response = await supabaseRequest(`address_book?id=eq.${encodeURIComponent(id)}${customerFilter(auth.session)}`, {
      method: "DELETE",
      headers: { Prefer: "return=representation" },
    });
    if (!response.ok) return NextResponse.json({ error: await responseError(response, "Unable to delete this address.") }, { status: 502 });
    const rows = await response.json();
    if (!rows.length) return NextResponse.json({ error: "Address not found." }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to delete this address." }, { status: 500 });
  }
}
