import { NextResponse } from "next/server";

import { getWwexBolDocument } from "@/lib/carriers/wwex";
import { responseError, supabaseRequest } from "@/lib/supabase-server";
import { customerFilter, requireAppSession } from "@/lib/auth-server";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid quote ID." }, { status: 400 });
  const auth = await requireAppSession();
  if (auth.response || !auth.session) return auth.response;
  const response = await supabaseRequest(`saved_quotes?select=provider,bol_number,bol_url,provider_shipment_id&id=eq.${encodeURIComponent(id)}&limit=1${customerFilter(auth.session)}`);
  if (!response.ok) return NextResponse.json({ error: await responseError(response, "Unable to load this BOL.") }, { status: 502 });
  const quote = (await response.json())[0];
  if (!quote?.bol_number) return NextResponse.json({ error: "BOL not found." }, { status: 404 });
  if (quote.provider === "priority1" && quote.bol_url) return NextResponse.redirect(quote.bol_url);
  if (quote.provider !== "wwex" || !quote.provider_shipment_id) return NextResponse.json({ error: "BOL document is unavailable." }, { status: 404 });

  const document = await getWwexBolDocument(String(quote.provider_shipment_id));
  if (!document) return NextResponse.json({ error: "WWEX BOL document is temporarily unavailable." }, { status: 502 });
  if (document.fileContent) {
    return new Response(Buffer.from(document.fileContent, "base64"), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${document.bolNumber}.pdf"`, "Cache-Control": "no-store" } });
  }
  if (document.securedLink) return NextResponse.redirect(document.securedLink);
  return NextResponse.json({ error: "WWEX BOL document is temporarily unavailable." }, { status: 502 });
}
