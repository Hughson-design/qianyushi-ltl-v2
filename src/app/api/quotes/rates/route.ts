import { NextResponse } from "next/server";
import { issueQuoteToken } from "@/lib/quote-integrity";

import { getPriority1Rates } from "@/lib/carriers/priority1";
import type { NormalizedRate, QuoteLineItem, QuoteLocation, QuoteRequest } from "@/lib/carriers/types";
import { getWwexRates } from "@/lib/carriers/wwex";
import { supabaseRequest } from "@/lib/supabase-server";
import { AppSession, requireAppSession } from "@/lib/auth-server";

export const runtime = "nodejs";

type IncomingItem = {
  packaging?: unknown;
  pallets?: unknown;
  stackable?: unknown;
  length?: unknown;
  width?: unknown;
  height?: unknown;
  unitWeight?: unknown;
  freightClass?: unknown;
  hazmat?: unknown;
  commodity?: unknown;
  declaredValue?: unknown;
};

function parseLocation(address: string, zip: string): QuoteLocation {
  const clean = address.replace(/\s*·.*$/, "").replace(new RegExp(`\\s*${zip}\\s*$`), "").replace(/,\s*$/, "").trim();
  const parts = clean.split(",").map((part) => part.trim()).filter(Boolean);
  const statePart = parts.at(-1) || "";
  const state = statePart.match(/\b[A-Z]{2}\b/i)?.[0]?.toUpperCase() || "";
  const city = parts.length >= 2 ? parts.at(-2) || "" : "";
  const addressLine = parts.length >= 3 ? parts.slice(0, -2).join(", ") : "N/A";
  return { addressLine, city, state, zip };
}

function positiveNumber(value: unknown, field: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} must be greater than zero.`);
  return number;
}

function normalizeItem(item: IncomingItem, index: number): QuoteLineItem {
  const pallets = positiveNumber(item.pallets, `Line ${index + 1} pallets`);
  const unitWeight = positiveNumber(item.unitWeight, `Line ${index + 1} unit weight`);
  return {
    packaging: String(item.packaging || "Pallet"),
    pallets,
    stackable: item.stackable !== false,
    length: positiveNumber(item.length, `Line ${index + 1} length`),
    width: positiveNumber(item.width, `Line ${index + 1} width`),
    height: positiveNumber(item.height, `Line ${index + 1} height`),
    totalWeight: Math.round(pallets * unitWeight),
    freightClass: String(item.freightClass || "70"),
    hazmat: item.hazmat === true,
    commodity: String(item.commodity || "General merchandise").trim(),
    declaredValue: Math.max(0, Number(item.declaredValue) || 0),
  };
}

function cheapestFive(rates: NormalizedRate[]) {
  return [...rates].sort((a, b) => a.price - b.price).slice(0, 5);
}

async function pricingSettings(session: AppSession) {
  const fallback = { markupPercent: 0, minimumMarkup: 0, wwexEnabled: true, priority1Enabled: true };
  try {
    const response = await supabaseRequest("platform_settings?select=markup_percent,minimum_markup,wwex_enabled,priority1_enabled&id=eq.true&limit=1");
    if (!response.ok) return fallback;
    const settings = (await response.json())[0];
    if (!settings) return fallback;
    let customerPricing = { markup_percent: settings.markup_percent, minimum_markup: settings.minimum_markup };
    if (session.customerId) {
      const customerResponse = await supabaseRequest(`customers?select=markup_percent,minimum_markup&id=eq.${encodeURIComponent(session.customerId)}&limit=1`);
      if (customerResponse.ok) customerPricing = (await customerResponse.json())[0] || customerPricing;
    }
    return {
      markupPercent: Math.max(0, Number(customerPricing.markup_percent) || 0),
      minimumMarkup: Math.max(0, Number(customerPricing.minimum_markup) || 0),
      wwexEnabled: settings.wwex_enabled !== false,
      priority1Enabled: settings.priority1_enabled !== false,
    };
  } catch {
    return fallback;
  }
}

function customerRate(rate: NormalizedRate, markupPercent: number, minimumMarkup: number): NormalizedRate {
  const percentagePrice = rate.price * (1 + markupPercent / 100);
  const minimumPrice = rate.price + minimumMarkup;
  return { ...rate, price: Math.round(Math.max(percentagePrice, minimumPrice) * 100) / 100 };
}

export async function POST(request: Request) {
  try {
    const auth = await requireAppSession();
    if (auth.response || !auth.session) return auth.response;
    const customerId = auth.session.customerId;
    if (!customerId) return NextResponse.json({ error: "An active customer account is required." }, { status: 403 });
    const body = await request.json();
    const originZip = String(body.originZip || "").trim();
    const destinationZip = String(body.destinationZip || "").trim();
    const readyDate = String(body.readyDate || "").trim();
    if (!/^\d{5}$/.test(originZip) || !/^\d{5}$/.test(destinationZip)) {
      return NextResponse.json({ error: "Enter valid 5-digit origin and destination ZIP codes." }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(readyDate)) {
      return NextResponse.json({ error: "Select a valid ready date." }, { status: 400 });
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: "Add at least one freight line." }, { status: 400 });
    }

    const quoteRequest: QuoteRequest = {
      origin: parseLocation(String(body.originAddress || ""), originZip),
      destination: parseLocation(String(body.destinationAddress || ""), destinationZip),
      readyDate,
      items: body.items.map(normalizeItem),
      services: Array.isArray(body.services) ? body.services.map(String) : [],
    };

    const pricing = await pricingSettings(auth.session);
    const [wwex, priority1] = await Promise.allSettled([
      pricing.wwexEnabled ? getWwexRates(quoteRequest) : Promise.resolve([]),
      pricing.priority1Enabled ? getPriority1Rates(quoteRequest) : Promise.resolve([]),
    ]);
    const providerErrors: Record<string, string> = {};
    if (wwex.status === "rejected") providerErrors.wwex = wwex.reason instanceof Error ? wwex.reason.message : "WWEX quote failed.";
    if (priority1.status === "rejected") providerErrors.priority1 = priority1.reason instanceof Error ? priority1.reason.message : "Priority1 quote failed.";

    const rates = [
      ...cheapestFive(wwex.status === "fulfilled" ? wwex.value : []),
      ...cheapestFive(priority1.status === "fulfilled" ? priority1.value : []),
    ].filter((rate) => Number.isFinite(rate.price) && rate.price > 0).map((rate) => customerRate(rate, pricing.markupPercent, pricing.minimumMarkup)).sort((a, b) => a.price - b.price);

    if (rates.length === 0) {
      return NextResponse.json({ error: "No rates were returned by the connected carriers.", providerErrors }, { status: 502 });
    }
    return NextResponse.json({ rates: rates.map((rate) => ({
      ...rate,
      quoteToken: issueQuoteToken(customerId, rate, { originZip, destinationZip, readyDate, items: quoteRequest.items.map((item, index) => ({ ...item, unitWeight: Number(body.items[index].unitWeight) })), services: quoteRequest.services }),
    })), providerErrors });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to request rates." }, { status: 400 });
  }
}
