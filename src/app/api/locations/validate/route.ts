import { NextResponse } from "next/server";
import { requireAppSession } from "@/lib/auth-server";

type GoogleValidation = {
  result?: {
    verdict?: {
      addressComplete?: boolean;
      validationGranularity?: string;
      hasReplacedComponents?: boolean;
    };
    address?: { postalAddress?: { postalCode?: string } };
    metadata?: { residential?: boolean; business?: boolean; poBox?: boolean };
  };
};

export async function POST(request: Request) {
  const auth = await requireAppSession();
  if (auth.response || !auth.session) return auth.response;
  if (!auth.session.customerId) return NextResponse.json({ classification: "unavailable" }, { status: 403 });

  const apiKey = process.env.GOOGLE_ADDRESS_VALIDATION_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ classification: "unavailable" });

  const body = await request.json().catch(() => null);
  const address = typeof body?.address === "string" ? body.address.trim() : "";
  const zip = typeof body?.zip === "string" ? body.zip : "";
  if (!address || address.length > 250 || !/^\d{5}$/.test(zip)) {
    return NextResponse.json({ classification: "unknown" }, { status: 400 });
  }

  try {
    const response = await fetch("https://addressvalidation.googleapis.com/v1:validateAddress", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey },
      body: JSON.stringify({ address: { regionCode: "US", addressLines: [address] } }),
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    if (!response.ok) return NextResponse.json({ classification: "unavailable" });

    const { result }: GoogleValidation = await response.json();
    const { verdict, metadata } = result ?? {};
    const buildingMatch = verdict?.addressComplete
      && ["PREMISE", "SUB_PREMISE"].includes(verdict.validationGranularity ?? "")
      && !verdict.hasReplacedComponents
      && result?.address?.postalAddress?.postalCode?.split("-")[0] === zip;
    const classification = !buildingMatch || metadata?.poBox ? "unknown"
      : metadata?.residential === true && metadata.business !== true ? "residential"
      : metadata?.business === true && metadata.residential !== true ? "business"
      : "unknown";
    return NextResponse.json({ classification });
  } catch {
    return NextResponse.json({ classification: "unavailable" });
  }
}
