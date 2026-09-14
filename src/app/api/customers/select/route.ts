import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { ACTIVE_CUSTOMER_COOKIE, requireAdminSession } from "@/lib/auth-server";
import { supabaseRequest } from "@/lib/supabase-server";

export async function POST(request: Request) {
  const auth = await requireAdminSession();
  if (auth.response || !auth.session) return auth.response;
  const body = await request.json();
  const customerId = String(body.customerId || "");
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) return NextResponse.json({ error: "Invalid customer ID." }, { status: 400 });
  const response = await supabaseRequest(`customers?select=id,name&active=eq.true&id=eq.${encodeURIComponent(customerId)}&limit=1`);
  const customer = response.ok ? (await response.json())[0] : null;
  if (!customer) return NextResponse.json({ error: "Customer not found or inactive." }, { status: 404 });
  (await cookies()).set(ACTIVE_CUSTOMER_COOKIE, customerId, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return NextResponse.json({ selected: true, customer });
}
