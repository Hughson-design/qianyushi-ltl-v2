import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-server";
import { supabaseRequest, supabaseRpc } from "@/lib/supabase-server";

export const runtime = "nodejs";
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
type ReviewQuote = { id: string; quote_number: string; reference: string; customer_id: string; price: number; status: string; updated_at: string; bol_number: string | null; provider_shipment_id: string | null };
async function loadQuote(id: string): Promise<ReviewQuote | null> {
  const response = await supabaseRequest(`saved_quotes?select=id,quote_number,reference,customer_id,price,status,updated_at,bol_number,provider_shipment_id&id=eq.${encodeURIComponent(id)}&limit=1`);
  if (!response.ok) throw new Error("Unable to load reservation.");
  return (await response.json())[0] || null;
}
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminSession();
  if (!auth.session || auth.response) return auth.response;
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Invalid quote ID." }, 400);
  try {
    const quote = await loadQuote(id);
    if (!quote?.customer_id) return json({ error: "Quote or owning customer not found." }, 404);
    const [customer, audit] = await Promise.all([
      supabaseRequest(`customers?select=name&id=eq.${encodeURIComponent(quote.customer_id)}&limit=1`),
      supabaseRequest(`booking_release_audit?select=id,created_at,action,reason,amount,actor_email,actor_name&quote_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=50`),
    ]);
    if (!customer.ok || !audit.ok) return json({ error: "Unable to load release audit. Check the database migration." }, 503);
    const availableAt = new Date(Date.parse(quote.updated_at) + 300000).toISOString();
    return json({ quote: { id, quoteNumber: quote.quote_number, reference: quote.reference, customerName: (await customer.json())[0]?.name || "Unknown customer", price: Number(quote.price), status: quote.status, availableAt, canRelease: quote.status === "booking" && !quote.bol_number && !quote.provider_shipment_id && Date.parse(availableAt) <= Date.now() }, records: await audit.json() });
  } catch { return json({ error: "Unable to load this reservation." }, 503); }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminSession();
  if (!auth.session || auth.response) return auth.response;
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return json({ error: "Submit from this website." }, 403);
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Invalid quote ID." }, 400);
  const body = await request.json().catch(() => null);
  const reason = typeof body?.reason === "string" ? body.reason.trim().replace(/\s+/g, " ") : "";
  if (body?.confirmedNoShipment !== true || reason.length < 10 || reason.length > 1000 || /[\x00-\x1f]/.test(reason)) return json({ error: "Confirm no shipment or pickup exists and provide a reason of 10 to 1000 characters." }, 400);
  try {
    const quote = await loadQuote(id);
    if (!quote?.customer_id) return json({ error: "Quote or owning customer not found." }, 404);
    if (quote.status !== "booking" || quote.bol_number || quote.provider_shipment_id) return json({ error: "Only a pending reservation without shipment identifiers may be released." }, 409);
    if (!Number.isFinite(Date.parse(quote.updated_at)) || Date.now() - Date.parse(quote.updated_at) < 300000) return json({ error: "Wait at least five minutes after booking started, then verify the carrier before releasing." }, 409);
    const result = await supabaseRpc("release_unsubmitted_booking", { p_quote_id: id, p_customer_id: quote.customer_id, p_actor_user_id: auth.session.userId, p_reason: reason, p_mode: "administrator" });
    if (!result.ok) return json({ error: "Release could not be completed. Refresh and check reservation status; do not adjust the balance manually." }, 409);
    const released = await result.json();
    return json({ released: released.released, amount: released.amount, status: released.status });
  } catch { return json({ error: "Unable to complete the audited release. Refresh to verify its status." }, 503); }
}
