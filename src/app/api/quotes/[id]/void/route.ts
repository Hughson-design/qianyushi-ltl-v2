import { NextResponse } from "next/server";

import { cancelPriority1Shipment } from "@/lib/carriers/priority1";
import type { StoredQuote } from "@/lib/carriers/shipment-types";
import { cancelWwexShipment, getWwexPickupIdByBol } from "@/lib/carriers/wwex";
import { responseError, supabaseRequest, supabaseRpc } from "@/lib/supabase-server";
import { customerFilter, requireAppSession } from "@/lib/auth-server";

export const runtime = "nodejs";

type BookedQuote = StoredQuote & { bol_number: string | null; provider_shipment_id: string; provider_pickup_id: string | null };

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid quote ID." }, { status: 400 });
  try {
    const auth = await requireAppSession();
    if (auth.response || !auth.session) return auth.response;
    const response = await supabaseRequest(`saved_quotes?select=*&id=eq.${encodeURIComponent(id)}&limit=1${customerFilter(auth.session)}`);
    if (!response.ok) throw new Error(await responseError(response, "Unable to load this shipment."));
    const quote: BookedQuote | undefined = (await response.json())[0];
    if (!quote) return NextResponse.json({ error: "Shipment not found." }, { status: 404 });
    if (quote.status === "void") return NextResponse.json({ quote });
    if (quote.status !== "booked" || !quote.provider_shipment_id) return NextResponse.json({ error: "Only a booked shipment can be voided." }, { status: 409 });

    if (quote.provider === "priority1") await cancelPriority1Shipment(quote.provider_shipment_id);
    else {
      const pickupId = quote.provider_pickup_id || (quote.bol_number ? await getWwexPickupIdByBol(quote.bol_number) : null);
      if (!pickupId) throw new Error("WWEX pickup transaction could not be found, so the shipment was not cancelled.");
      if (!quote.provider_pickup_id) {
        await supabaseRequest(`saved_quotes?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ provider_pickup_id: pickupId }) });
      }
      await cancelWwexShipment(quote.provider_shipment_id, pickupId);
    }

    const refund = await supabaseRpc("void_quote_and_refund", auth.session.customerId
      ? { p_quote_id: id, p_customer_id: auth.session.customerId, p_actor_user_id: auth.session.userId }
      : { p_quote_id: id });
    if (!refund.ok) return NextResponse.json({ error: "The carrier cancellation succeeded, but the deposit refund needs attention." }, { status: 502 });
    const updated = await supabaseRequest(`saved_quotes?select=*&id=eq.${encodeURIComponent(id)}&limit=1${customerFilter(auth.session)}`);
    return NextResponse.json({ quote: (await updated.json())[0] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to void this shipment." }, { status: 502 });
  }
}
