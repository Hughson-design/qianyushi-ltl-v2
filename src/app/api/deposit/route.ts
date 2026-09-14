import { NextResponse } from "next/server";

import { responseError, supabaseRequest, supabaseRpc } from "@/lib/supabase-server";
import { requireAdminSession, requireAppSession } from "@/lib/auth-server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const auth = await requireAppSession();
    if (auth.response || !auth.session) return auth.response;
    const accountQuery = auth.session.customerId
      ? `deposit_accounts?select=available_balance&customer_id=eq.${encodeURIComponent(auth.session.customerId)}&limit=1`
      : "deposit_accounts?select=available_balance&id=eq.true&limit=1";
    const transactionOwnership = auth.session.customerId ? `&customer_id=eq.${encodeURIComponent(auth.session.customerId)}` : "";
    const accountResponse = await supabaseRequest(accountQuery);
    let transactionsResponse = await supabaseRequest(`deposit_transactions?select=id,transaction_type,amount,balance_after,reason,created_at,saved_quotes(quote_number,reference)&order=created_at.desc&limit=100${transactionOwnership}`);
    if (!accountResponse.ok) return NextResponse.json({ error: await responseError(accountResponse, "Unable to load the deposit balance.") }, { status: 503 });
    let transactions;
    if (!transactionsResponse.ok) {
      // Keep the existing ledger readable until the administrator runs the latest migration.
      transactionsResponse = await supabaseRequest(`deposit_transactions?select=id,transaction_type,amount,balance_after,created_at,saved_quotes(quote_number,reference)&order=created_at.desc&limit=100${transactionOwnership}`);
      if (!transactionsResponse.ok) return NextResponse.json({ error: await responseError(transactionsResponse, "Unable to load deposit activity.") }, { status: 503 });
      transactions = (await transactionsResponse.json()).map((row: Record<string, unknown>) => ({ ...row, reason: "" }));
    } else {
      transactions = await transactionsResponse.json();
    }
    const rows = await accountResponse.json();
    return NextResponse.json({ availableBalance: Number(rows[0]?.available_balance || 0), transactions });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load the deposit balance." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdminSession();
    if (auth.response || !auth.session) return auth.response;
    const body = await request.json();
    const amount = Number(body.amount);
    const reason = String(body.reason || "").trim();
    if (!Number.isFinite(amount) || amount === 0) return NextResponse.json({ error: "Enter a non-zero deposit amount." }, { status: 400 });
    if (!reason) return NextResponse.json({ error: "A payment reference or adjustment reason is required." }, { status: 400 });
    const response = await supabaseRpc("adjust_deposit_balance", auth.session.customerId
      ? { p_customer_id: auth.session.customerId, p_amount: amount, p_reason: reason, p_actor_user_id: auth.session.userId }
      : { p_amount: amount, p_reason: reason });
    if (!response.ok) return NextResponse.json({ error: await responseError(response, "Unable to adjust the deposit balance. Run the latest Supabase SQL first.") }, { status: 503 });
    return NextResponse.json({ availableBalance: Number(await response.json()) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to adjust the deposit balance." }, { status: 500 });
  }
}
