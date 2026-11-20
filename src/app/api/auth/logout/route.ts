import { NextResponse } from "next/server";

import { signOutSession } from "@/lib/auth-server";

export async function POST() {
  try {
    await signOutSession();
    return NextResponse.json({ signedOut: true });
  } catch { return NextResponse.json({ error: "Unable to complete sign-out. Please try again." }, { status: 503 }); }
}
