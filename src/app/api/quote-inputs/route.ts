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
  const url = new URL(request.url);
  if (url.searchParams.get("format") === "json") {
    const before = url.searchParams.get("before");
    if (before && !/^\d+$/.test(before)) return NextResponse.json({ error: "Invalid history page." }, { status: 400 });
    const response = await supabaseRequest(`quote_input_history?select=id,created_at,customer_name,user_name,user_email,source,input_text${scope}${before ? `&id=lt.${before}` : ""}&order=id.desc&limit=51`);
    if (!response.ok) return NextResponse.json({ error: "Unable to load quote inputs." }, { status: 503 });
    const rows: InputRecord[] = await response.json();
    const records = rows.slice(0, 50);
    return NextResponse.json({ records, next: rows.length > 50 ? String(records.at(-1)!.id) : null }, { headers: { "Cache-Control": "no-store" } });
  }
  const newest = await supabaseRequest(`quote_input_history?select=id${scope}&order=id.desc&limit=1`);
  if (!newest.ok) return NextResponse.json({ error: "Unable to load SMART QUOTE history. Check the database migration." }, { status: 503 });
  const ceiling = (await newest.json())[0]?.id;
  const sections = ["SMART QUOTE input history", "Time zone: America/Los_Angeles", ""];
  let cursor = "0";
  if (ceiling !== undefined) {
    if (!/^\d+$/.test(String(ceiling))) return NextResponse.json({ error: "Invalid history sequence." }, { status: 502 });
    while (true) {
      const response = await supabaseRequest(`quote_input_history?select=id,created_at,customer_name,user_name,user_email,source,input_text${scope}&id=gt.${cursor}&id=lte.${ceiling}&order=id.asc&limit=1000`);
      if (!response.ok) return NextResponse.json({ error: "Unable to export SMART QUOTE history. Please try again." }, { status: 502 });
      const records: InputRecord[] = await response.json();
      if (!records.length) break;
      for (const row of records) {
        sections.push(
          "============================================================",
          `Sequence: ${row.id}`,
          `Time (PT): ${new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Los_Angeles", dateStyle: "short", timeStyle: "medium" }).format(new Date(row.created_at))}`,
          `Time (UTC): ${row.created_at}`,
          `Customer: ${row.customer_name.replace(/[\r\n]/g, " ")}`,
          `Username: ${(row.user_name || row.user_email).replace(/[\r\n]/g, " ")}`,
          `Login email: ${row.user_email.replace(/[\r\n]/g, " ")}`,
          `Page: ${row.source}`,
          "SMART QUOTE text:",
          row.input_text.replace(/\r\n?/g, "\n"),
          "",
        );
      }
      const next = String(records.at(-1)!.id);
      if (!/^\d+$/.test(next) || BigInt(next) <= BigInt(cursor)) {
        return NextResponse.json({ error: "Unable to read the next history page." }, { status: 502 });
      }
      cursor = next;
    }
  }
  return new Response("\ufeff" + sections.join("\n").replace(/\n/g, "\r\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'attachment; filename="smart-quote-history.txt"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
