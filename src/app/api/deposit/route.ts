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
    if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Submit from this website." }, { status: 403 });
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid adjustment." }, { status: 400 });
    // Explicit customer target from the reviewed dialog; never silently fall back
    // to the administrator's selected workspace when a supplied target is invalid.
    const customerId = body.customerId === undefined ? auth.session.customerId : body.customerId;
    if (typeof customerId !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(customerId)) return NextResponse.json({ error: "Select a valid customer for this adjustment." }, { status: 400 });
    const rawAmount = String(body.amount ?? "").trim();
    const amount = Number(rawAmount);
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!/^-?\d{1,9}(?:\.\d{1,2})?$/.test(rawAmount) || !Number.isFinite(amount) || amount === 0) return NextResponse.json({ error: "Enter a non-zero amount with at most two decimal places." }, { status: 400 });
    if (!reason || reason.length > 1000 || /[\x00-\x1f]/.test(reason)) return NextResponse.json({ error: "A payment reference or adjustment reason of up to 1000 characters is required." }, { status: 400 });
    const customer = await supabaseRequest(`customers?select=id,name&id=eq.${customerId}&limit=1`);
    if (!customer.ok) return NextResponse.json({ error: "Unable to verify the adjustment customer." }, { status: 503 });
    if (!(await customer.json())[0]) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
    const response = await supabaseRpc("adjust_deposit_balance", {
      p_customer_id: customerId,
      p_amount: amount,
      p_reason: reason,
      p_actor_user_id: auth.session.userId,
    });
    if (!response.ok) {
      const message = await responseError(response, "Unable to confirm the adjustment. Check activity before submitting again.");
      return NextResponse.json({ error: message }, { status: message === "Adjustment would make the deposit balance negative" ? 409 : 503 });
    }
    const returnedBalance = await response.json();
    if ((typeof returnedBalance !== "number" && typeof returnedBalance !== "string") || String(returnedBalance).trim() === "" || !Number.isFinite(Number(returnedBalance))) return NextResponse.json({ error: "Unable to confirm the balance. Check activity before submitting again." }, { status: 503 });
    return NextResponse.json({ customerId, availableBalance: Number(returnedBalance) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: "Unable to confirm the adjustment. Check activity before submitting again." }, { status: 500 });
  }
}

