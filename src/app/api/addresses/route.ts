import { NextResponse } from "next/server";

import { responseError, supabaseRequest } from "@/lib/supabase-server";
import { customerFilter, requireAppSession } from "@/lib/auth-server";

export const runtime = "nodejs";

const addressFields = ["company", "country", "address1", "address2", "zip", "state", "city", "phone", "extension", "contact", "email"] as const;

function addressStorageError(status: number, details: string) {
  const tableMissing = status === 404 || details.includes("address_book");
  return NextResponse.json(
    { error: tableMissing ? "Address book storage is not ready. Run the provided Supabase SQL first." : "Unable to access the address book." },
    { status: tableMissing ? 503 : 502 },
  );
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export async function GET() {
  try {
    const auth = await requireAppSession();
    if (auth.response || !auth.session) return auth.response;
    const response = await supabaseRequest(`address_book?select=*&order=updated_at.desc&limit=200${customerFilter(auth.session)}`);
    if (!response.ok) return addressStorageError(response.status, await response.text());
    return NextResponse.json({ addresses: await response.json() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load the address book." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAppSession();
    if (auth.response || !auth.session) return auth.response;
    const body = await request.json();
    if (!clean(body.company) || !clean(body.address1) || !/^\d{5}$/.test(clean(body.zip)) || !clean(body.state) || !clean(body.city)) {
      return NextResponse.json({ error: "Company, street address, postal code, state, and city are required." }, { status: 400 });
    }

    const { category } = body;
    if (category !== undefined && category !== "sender" && category !== "receiver" && category !== "both") {
      return NextResponse.json({ error: "Invalid address category." }, { status: 400 });
    }
    const record = Object.fromEntries(addressFields.map((field) => [field, clean(body[field])]));
    const fingerprint = [record.company, record.address1, record.address2, record.zip]
      .map((value) => value.toLowerCase().replace(/\s+/g, " "))
      .join("|");

    const ownedRecord = auth.session.customerId ? { ...record, customer_id: auth.session.customerId } : record;
    const conflict = auth.session.customerId ? "customer_id,fingerprint" : "fingerprint";
    const response = await supabaseRequest(`address_book?on_conflict=${conflict}`, {
      method: "POST",
      headers: { Prefer: body.keepExisting === true ? "resolution=ignore-duplicates,return=representation" : "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ ...ownedRecord, ...(category === undefined ? {} : { category }), fingerprint, updated_at: new Date().toISOString() }),
    });
    if (!response.ok) return addressStorageError(response.status, await responseError(response, "Unable to save this address."));
    const rows = await response.json();
    return NextResponse.json({ address: rows[0] }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save this address." }, { status: 500 });
  }
}
