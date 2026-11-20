import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-server";
import { supabaseRequest } from "@/lib/supabase-server";

export const runtime = "nodejs";
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminSession();
  if (!auth.session || auth.response) return auth.response;
  const { id } = await context.params;
  const rawOffset = new URL(request.url).searchParams.get("offset") ?? "0";
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) || !/^\d{1,7}$/.test(rawOffset)) return json({ error: "Invalid customer or page." }, 400);
  const offset = Number(rawOffset);
  try {
    const customerResponse = await supabaseRequest(`customers?select=id,name,code&id=eq.${id}&limit=1`);
    if (!customerResponse.ok) return json({ error: "Unable to load customer." }, 503);
    const customer = (await customerResponse.json())[0];
    if (!customer) return json({ error: "Customer not found." }, 404);
    const [account, ledger] = await Promise.all([
      supabaseRequest(`deposit_accounts?select=available_balance&customer_id=eq.${id}&limit=1`),
      supabaseRequest(`deposit_transactions?select=id,transaction_type,amount,balance_after,reason,created_at,saved_quotes(quote_number,reference)&customer_id=eq.${id}&order=created_at.desc,id.desc&offset=${offset}&limit=51`),
    ]);
    if (!account.ok || !ledger.ok) return json({ error: "Unable to load this customer's deposit activity." }, 503);
    const accounts = await account.json(), records = await ledger.json();
    const availableBalance = accounts.length ? Number(accounts[0].available_balance) : null;
    if (availableBalance !== null && !Number.isFinite(availableBalance)) throw new Error("Invalid balance");
    return json({ customer, availableBalance, records: records.slice(0, 50), nextOffset: records.length > 50 ? offset + 50 : null });
  } catch { return json({ error: "Unable to load this customer's deposit activity." }, 503); }
}
