import { NextResponse } from "next/server";

import { authSchemaStatus, getAppSession } from "@/lib/auth-server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const schema = await authSchemaStatus();
    if (!schema.ready) return NextResponse.json({ error: "Authentication storage is unavailable." }, { status: 503 });
    if (!schema.hasUsers) return NextResponse.json({ authenticated: false, setupRequired: true });
    const user = await getAppSession();
    return NextResponse.json({ authenticated: Boolean(user), setupRequired: false, user });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to check the session." }, { status: 500 });
  }
}
