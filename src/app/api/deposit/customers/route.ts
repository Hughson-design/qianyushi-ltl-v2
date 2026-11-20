import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-server";
import { supabaseRequest } from "@/lib/supabase-server";

export const runtime = "nodejs";
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
type Account = { available_balance: number | string };
type Payment = { amount: number | string; created_at: string };
type Customer = { id: string; name: string; code: string; active: boolean; deposit_accounts: Account | Account[] | null; latest_payment: Payment | Payment[] | null };
const first = <T,>(value: T | T[] | null): T | null => Array.isArray(value) ? value[0] ?? null : value;

export async function GET(request: Request) {
  const auth = await requireAdminSession();
  if (!auth.session || auth.response) return auth.response;
  const params = new URL(request.url).searchParams;
  const rawOffset = params.get("offset") ?? "0";
  const search = (params.get("search") ?? "").trim();
  if (!/^\d{1,7}$/.test(rawOffset) || search.length > 100) return json({ error: "Invalid customer search or page." }, 400);
  const offset = Number(rawOffset);
  // Embed only the latest actual payment per customer, not refunds or releases.
  const literal = `"*${search.replace(/[\\"]/g, "\\$&")}*"`;
  const filter = search ? `&or=${encodeURIComponent(`(name.ilike.${literal},code.ilike.${literal})`)}` : "";
  try {
    const response = await supabaseRequest(`customers?select=id,name,code,active,deposit_accounts(available_balance),latest_payment:deposit_transactions(amount,created_at)&latest_payment.transaction_type=eq.DEPOSIT&latest_payment.amount=gt.0&latest_payment.order=created_at.desc,id.desc&latest_payment.limit=1&order=name.asc,id.asc&offset=${offset}&limit=51${filter}`);
    if (!response.ok) return json({ error: "Unable to load customer deposit overview." }, 503);
    const rows: Customer[] = await response.json();
    const customers = rows.slice(0, 50).map(row => {
      const account = first(row.deposit_accounts), payment = first(row.latest_payment);
      const balance = account ? Number(account.available_balance) : null;
      const lastDepositAmount = payment ? Number(payment.amount) : null;
      if ((balance !== null && !Number.isFinite(balance)) || (lastDepositAmount !== null && !Number.isFinite(lastDepositAmount))) throw new Error("Invalid money value");
      return { id: row.id, name: row.name, code: row.code, active: row.active, availableBalance: balance, lastDepositAmount, lastDepositAt: payment?.created_at ?? null };
    });
    return json({ customers, nextOffset: rows.length > 50 ? offset + 50 : null });
  } catch { return json({ error: "Unable to load customer deposit overview." }, 503); }
}
