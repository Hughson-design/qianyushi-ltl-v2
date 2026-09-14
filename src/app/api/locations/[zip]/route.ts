import { NextResponse } from "next/server";

import postalCities from "@/data/us-postal-cities.json";

export const runtime = "nodejs";

type PostalRecord = {
  state: string;
  cities: string[];
};

const postalIndex = postalCities as Record<string, PostalRecord>;

export async function GET(_request: Request, context: { params: Promise<{ zip: string }> }) {
  const { zip } = await context.params;
  if (!/^\d{5}$/.test(zip)) {
    return NextResponse.json({ error: "Enter a valid 5-digit ZIP code." }, { status: 400 });
  }

  const location = postalIndex[zip];
  if (!location?.state || !location.cities.length) {
    return NextResponse.json({ error: "ZIP code not found." }, { status: 404 });
  }

  return NextResponse.json({ zip, state: location.state, cities: location.cities });
}
