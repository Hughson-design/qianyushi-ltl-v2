import { NextResponse } from "next/server";
import { verifyShipmentProof } from "@/lib/quote-integrity";
import { validateBooking } from "@/lib/booking-safety";
import { isNoShipmentSubmissionError } from "@/lib/booking-errors";

import { dispatchPriority1Shipment } from "@/lib/carriers/priority1";
import { dispatchTqlShipment } from "@/lib/carriers/tql";
import type { StoredQuote } from "@/lib/carriers/shipment-types";
import { dispatchWwexShipment } from "@/lib/carriers/wwex";
import { responseError, supabaseRequest, supabaseRpc } from "@/lib/supabase-server";
import { AppSession, customerFilter, requireAppSession } from "@/lib/auth-server";

export const runtime = "nodejs";

async function loadQuote(id: string, session: AppSession, adminReconcile = false): Promise<StoredQuote | null> {
  const response = await supabaseRequest(`saved_quotes?select=*&id=eq.${encodeURIComponent(id)}&limit=1${adminReconcile && session.role === "admin" ? "" : customerFilter(session)}`);
  if (!response.ok) throw new Error(await responseError(response, "Unable to load this quote."));
  const rows = await response.json();
  return rows[0] || null;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid quote ID." }, { status: 400 });
  try {
    const auth = await requireAppSession();
    if (auth.response || !auth.session) return auth.response;
    if (!auth.session.canSelfBook) return NextResponse.json({ error: "This customer account is not allowed to generate BOLs." }, { status: 403 });
    const reconcile = new URL(request.url).searchParams.get("reconcile") === "true";
    if (reconcile && auth.session.role !== "admin") return NextResponse.json({ error: "Administrator access is required for reconciliation." }, { status: 403 });
    const quote = await loadQuote(id, auth.session, reconcile);
    if (!quote) return NextResponse.json({ error: "Quote not found." }, { status: 404 });
    if (quote.status === "booked") return NextResponse.json({ quote });
    if (quote.status !== (reconcile ? "booking" : "draft")) return NextResponse.json({ error: "This quote cannot generate a BOL in its current status. Pending bookings must be reconciled." }, { status: 409 });
    if (quote.provider_ref?.bookingVersion !== 2) return NextResponse.json({ error: "This draft or pending booking predates safe booking identifiers. Ask an administrator to check carrier records before copying and requoting." }, { status: 409 });

    const customerId = quote.customer_id;
    if (!customerId || !verifyShipmentProof(quote.provider_ref?.shipmentProof, id, customerId, quote.provider_ref?.offerExpiresAt)) {
      return NextResponse.json({ error: "The quote ownership or pricing proof could not be verified. Ask an administrator to check this record; do not rebook it." }, { status: 409 });
    }

    if (!reconcile) {
    if (!Number.isFinite(Number(quote.provider_ref.offerExpiresAt)) || Number(quote.provider_ref.offerExpiresAt) <= Date.now()) return NextResponse.json({ error: "This rate has expired. Copy the details and get fresh rates before booking." }, { status: 409 });
    validateBooking(quote);
    const reserve = await supabaseRpc("reserve_quote_for_bol", auth.session.customerId
      ? { p_quote_id: id, p_customer_id: auth.session.customerId, p_actor_user_id: auth.session.userId }
      : { p_quote_id: id });
    if (!reserve.ok) return NextResponse.json({ error: await responseError(reserve, "Unable to reserve the deposit.") }, { status: 409 });
    }

    let booking;
    try {
      if (quote.provider === "priority1") booking = await dispatchPriority1Shipment(quote, reconcile);
      else if (quote.provider === "tql") booking = await dispatchTqlShipment(quote, reconcile);
      else booking = await dispatchWwexShipment(quote, reconcile);
    } catch (error) {
      if (!reconcile && isNoShipmentSubmissionError(error)) {
        const release = await supabaseRpc("release_unsubmitted_booking", { p_quote_id: id, p_customer_id: customerId, p_actor_user_id: auth.session.userId, p_reason: `${quote.provider}: ${error.message}`, p_mode: "automatic" });
        if (release.ok) {
          const result = await release.json();
          if (result.released) return NextResponse.json({ reservationReleased: true, error: "The booking was not submitted or was explicitly rejected before creation. The deposit reservation has been released and audited. Correct the details or retry later." }, { status: 422 });
          return NextResponse.json({ error: "This reservation changed while processing. Refresh the quote to check its current state." }, { status: 409 });
        }
      }
      return NextResponse.json({ reconciliationRequired: true, error: "Carrier booking is not confirmed. The deposit remains reserved and the quote remains pending. Do not create another shipment. Ask an administrator to reconcile carrier records." }, { status: 409 });
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
    return NextResponse.json({ quote: await loadQuote(id, auth.session, reconcile) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to generate the BOL." }, { status: 502 });
  }
}
