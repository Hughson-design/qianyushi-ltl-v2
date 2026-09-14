import { NextResponse } from "next/server";

import { dispatchPriority1Shipment } from "@/lib/carriers/priority1";
import type { StoredQuote } from "@/lib/carriers/shipment-types";
import { dispatchWwexShipment } from "@/lib/carriers/wwex";
import { responseError, supabaseRequest, supabaseRpc } from "@/lib/supabase-server";
import { AppSession, customerFilter, requireAppSession } from "@/lib/auth-server";

export const runtime = "nodejs";

async function loadQuote(id: string, session: AppSession): Promise<StoredQuote | null> {
  const response = await supabaseRequest(`saved_quotes?select=*&id=eq.${encodeURIComponent(id)}&limit=1${customerFilter(session)}`);
  if (!response.ok) throw new Error(await responseError(response, "Unable to load this quote."));
  const rows = await response.json();
  return rows[0] || null;
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid quote ID." }, { status: 400 });
  try {
    const auth = await requireAppSession();
    if (auth.response || !auth.session) return auth.response;
    if (!auth.session.canSelfBook) return NextResponse.json({ error: "This customer account is not allowed to generate BOLs." }, { status: 403 });
    const quote = await loadQuote(id, auth.session);
    if (!quote) return NextResponse.json({ error: "Quote not found." }, { status: 404 });
    if (quote.status === "booked") return NextResponse.json({ quote });
    if (quote.status !== "draft") return NextResponse.json({ error: "This quote cannot generate a BOL in its current status." }, { status: 409 });

    const reserve = await supabaseRpc("reserve_quote_for_bol", auth.session.customerId
      ? { p_quote_id: id, p_customer_id: auth.session.customerId, p_actor_user_id: auth.session.userId }
      : { p_quote_id: id });
    if (!reserve.ok) return NextResponse.json({ error: await responseError(reserve, "Unable to reserve the deposit.") }, { status: 409 });

    let booking;
    try {
      booking = quote.provider === "priority1" ? await dispatchPriority1Shipment(quote) : await dispatchWwexShipment(quote);
    } catch (error) {
      await supabaseRpc("release_quote_bol_reservation", auth.session.customerId
        ? { p_quote_id: id, p_customer_id: auth.session.customerId, p_actor_user_id: auth.session.userId }
        : { p_quote_id: id });
      throw error;
    }

    const complete = await supabaseRpc("complete_quote_bol", {
      p_quote_id: id,
      p_bol_number: booking.bolNumber,
      p_bol_url: booking.bolUrl,
      p_provider_shipment_id: booking.shipmentId,
      p_provider_pickup_id: booking.pickupId,
      p_provider_document_ref: booking.documentRef,
    });
    if (!complete.ok) {
      return NextResponse.json({ error: "The carrier created the shipment, but the local record could not be finalized. Do not click Generate BOL again; verify the shipment with the carrier." }, { status: 502 });
    }
    return NextResponse.json({ quote: await loadQuote(id, auth.session) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to generate the BOL." }, { status: 502 });
  }
}
