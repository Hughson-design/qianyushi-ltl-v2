import { NextResponse } from "next/server";

import { clearAuthCookies } from "@/lib/auth-server";

export async function POST() {
  await clearAuthCookies();
  return NextResponse.json({ signedOut: true });
}
