import { NextResponse } from "next/server";

import { supabaseRequest } from "@/lib/supabase-server";
import { customerFilter, requireAppSession } from "@/lib/auth-server";

export const runtime = "nodejs";

function storageError(status: number, details: string) {
  const tableMissing = status === 404 || details.includes("saved_quotes");
  return NextResponse.json(
    { error: tableMissing ? "Saved quote storage is not ready. Run the provided Supabase SQL first." : "Unable to access saved quotes." },
    { status: tableMissing ? 503 : 502 },
  );
}

export async function GET() {
  try {
    const auth = await requireAppSession();
    if (auth.response || !auth.session) return auth.response;
    const response = await supabaseRequest(`saved_quotes?select=*&order=created_at.desc&limit=100${customerFilter(auth.session)}`);
    if (!response.ok) return storageError(response.status, await response.text());
    return NextResponse.json({ quotes: await response.json() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load saved quotes." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAppSession();
    if (auth.response || !auth.session) return auth.response;
    const body = await request.json();
    if (!body?.rate?.carrier || !Number.isFinite(Number(body?.rate?.price))) {
      return NextResponse.json({ error: "Select a valid rate before saving." }, { status: 400 });
    }
    if (!body?.sender?.zip || !body?.receiver?.zip || !body?.reference) {
      return NextResponse.json({ error: "Complete the required booking details." }, { status: 400 });
    }

    const datePart = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const quoteNumber = `Q-${datePart}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const record = {
      quote_number: quoteNumber,
      status: "draft",
      reference: String(body.reference),
      origin_zip: String(body.originZip || body.sender.zip),
      destination_zip: String(body.destinationZip || body.receiver.zip),
      ready_date: body.readyDate || null,
      carrier: String(body.rate.carrier),
      service: String(body.rate.service || ""),
      transit: String(body.rate.transit || ""),
      price: Number(body.rate.price),
      provider: body.rate.provider || null,
      provider_ref: body.rate.providerRef || {},
      freight_items: Array.isArray(body.items) ? body.items : [],
      services: Array.isArray(body.services) ? body.services : [],
      sender: body.sender,
      receiver: body.receiver,
      skip_address_verification: Boolean(body.skipAddressVerification),
      pickup_ready_time: body.pickupReadyTime || "09:00",
      pickup_close_time: body.pickupCloseTime || "16:00",
      ...(auth.session.customerId ? { customer_id: auth.session.customerId } : {}),
    };

    const response = await supabaseRequest("saved_quotes", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(record),
    });
    if (!response.ok) return storageError(response.status, await response.text());
    const rows = await response.json();
    return NextResponse.json({ quote: rows[0] }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save this quote." }, { status: 500 });
  }
}
