import { NextResponse } from "next/server";
import { readQuoteToken, shipmentProof } from "@/lib/quote-integrity";

import { supabaseRequest } from "@/lib/supabase-server";
import { customerFilter, requireAppSession } from "@/lib/auth-server";
import { formatPhoneNumber } from "@/lib/phone";
import { bookingParty } from "@/lib/booking-safety";

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
    const customerId = auth.session.customerId;
    if (!customerId) return NextResponse.json({ error: "An active customer account is required." }, { status: 403 });
    const offer = readQuoteToken(body?.rate?.quoteToken, customerId);
    if (!offer) return NextResponse.json({ error: "Get fresh rates before saving this quote." }, { status: 400 });
    const { rate, shipment } = offer;
    let sender, receiver;
    try {
      sender = bookingParty(body.sender); receiver = bookingParty(body.receiver);
      if (typeof body.reference !== "string" || !body.reference.trim() || body.reference.length > 300 || /[\x00-\x1f]/.test(body.reference)) throw new Error("Enter a reference of 1 to 300 characters.");
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(body.pickupReadyTime || "09:00") || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(body.pickupCloseTime || "16:00") || (body.pickupCloseTime || "16:00") <= (body.pickupReadyTime || "09:00")) throw new Error("Enter valid pickup hours.");
    } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Complete shipment contacts." }, { status: 400 }); }
    const deliveryStartTime = body.receiver?.deliveryStartTime ?? "08:00";
    const deliveryEndTime = body.receiver?.deliveryEndTime ?? "17:00";
    const validTime = (value: unknown) => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
    if (!validTime(deliveryStartTime) || !validTime(deliveryEndTime) || deliveryEndTime <= deliveryStartTime) {
      return NextResponse.json({ error: "Delivery end time must be later than delivery start time." }, { status: 400 });
    }
    if (rate.provider === "mothership") return NextResponse.json({ error: "Mothership rates are for comparison only." }, { status: 409 });
    if (body.sender?.zip !== shipment.originZip || body.receiver?.zip !== shipment.destinationZip || body.readyDate !== shipment.readyDate) {
      return NextResponse.json({ error: "The route or ready date changed. Get fresh rates before saving." }, { status: 400 });
    }
    if (!body?.sender?.zip || !body?.receiver?.zip || !body?.reference) {
      return NextResponse.json({ error: "Complete the required booking details." }, { status: 400 });
    }

    const datePart = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const id = crypto.randomUUID();
    const quoteNumber = `Q-${datePart}-${id.slice(0, 6).toUpperCase()}`;
    const record = {
      id,
      quote_number: quoteNumber,
      status: "draft",
      reference: body.reference.trim(),
      origin_zip: shipment.originZip,
      destination_zip: shipment.destinationZip,
      ready_date: shipment.readyDate,
      carrier: rate.carrier,
      service: rate.service,
      transit: rate.transitDays === null ? "Not provided" : `${rate.transitDays} ${rate.transitDays === 1 ? "day" : "days"}`,
      price: rate.price,
      provider: rate.provider,
      provider_ref: { ...rate.providerRef, bookingVersion: 2, offerExpiresAt: offer.expiresAt, shipmentProof: shipmentProof(id, customerId, offer.expiresAt) },
      freight_items: shipment.items,
      services: shipment.services,
      sender,
      receiver: { ...receiver, deliveryStartTime, deliveryEndTime },
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
