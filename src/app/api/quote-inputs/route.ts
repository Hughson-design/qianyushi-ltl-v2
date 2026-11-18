import { NextResponse } from "next/server";
import { customerFilter, requireAppSession, requireUserManagerSession } from "@/lib/auth-server";
import { supabaseRequest } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireAppSession();
  if (auth.response || !auth.session) return auth.response;
  const session = auth.session;
  if (!session.customerId) return NextResponse.json({ error: "Select a customer workspace." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (typeof body?.text !== "string" || body.text.length > 100000) {
    return NextResponse.json({ error: "SMART QUOTE text must be at most 100,000 characters." }, { status: 400 });
  }
  if (!body.text.trim()) return new Response(null, { status: 204 });
  const response = await supabaseRequest("quote_input_history", {
    method: "POST",
    body: JSON.stringify({
      customer_id: session.customerId,
      customer_name: session.customerName,
      user_id: session.userId,
      user_email: session.email,
      user_name: session.name,
      source: body.source === "mobile" ? "mobile" : "desktop",
      input_text: body.text,
    }),
  });
  if (!response.ok) {
    return NextResponse.json({ error: "Unable to save SMART QUOTE history. Ask the administrator to check the quote input history database migration, then try again." }, { status: 503 });
  }
  return NextResponse.json({ saved: true });
}

type InputRecord = {
  id: number | string; created_at: string; customer_name: string;
  user_email: string; user_name: string; source: string; input_text: string;
};

export async function GET(request: Request) {
  const auth = await requireUserManagerSession();
  if (auth.response || !auth.session) return auth.response;
  const scope = auth.session.role === "admin" ? "" : customerFilter(auth.session);
  const before = new URL(request.url).searchParams.get("before");
  if (before && !/^\d+$/.test(before)) return NextResponse.json({ error: "Invalid history page." }, { status: 400 });
  const response = await supabaseRequest(`quote_input_history?select=id,created_at,customer_name,user_name,user_email,source,input_text${scope}${before ? `&id=lt.${before}` : ""}&order=id.desc&limit=51`);
  if (!response.ok) return NextResponse.json({ error: "Unable to load quote inputs." }, { status: 503 });
  const rows: InputRecord[] = await response.json();
  const records = rows.slice(0, 50);
  return NextResponse.json({ records, next: rows.length > 50 ? String(records.at(-1)!.id) : null }, { headers: { "Cache-Control": "no-store" } });
}
