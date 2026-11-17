import { NextResponse } from "next/server";
import postalCities from "@/data/us-postal-cities.json";
import { issueQuoteToken } from "@/lib/quote-integrity";

import { getMothershipRates, mothershipRatesEnabled } from "@/lib/carriers/mothership";
import { getPriority1Rates } from "@/lib/carriers/priority1";
import { getTqlRates } from "@/lib/carriers/tql";
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

const stateAbbreviations = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA",
  Colorado: "CO", Connecticut: "CT", Delaware: "DE", "District of Columbia": "DC",
  Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL",
  Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA",
  Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN",
  Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK",
  Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
  Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI",
  Wyoming: "WY", "Puerto Rico": "PR", Guam: "GU", "U.S. Virgin Islands": "VI",
  "American Samoa": "AS", "Northern Mariana Islands": "MP",
};
const stateCodes = new Map(Object.entries(stateAbbreviations).flatMap(([name, code]) => [
  [name.toLowerCase(), code] as const, [code.toLowerCase(), code] as const,
]));
const stateSuffix = new RegExp(`(?:^|[ ,])(${[...stateCodes.keys()]
  .sort((a, b) => b.length - a.length).map((name) => name.replaceAll(".", "\\.")).join("|")})$`, "i");
const postalIndex: Record<string, { state: string; cities: string[] }> = postalCities;

function parseLocation(address: string, zip: string): QuoteLocation {
  const clean = address.replace(/\s*·.*$/, "").replace(/[，、]/g, ",").trim()
    .replace(/(?:^|[\s,])(?:United States(?: of America)?|U\.?S\.?A?\.?|美国)[\s,]*$/i, "")
    .replace(/(?:^|[\s,])(\d{5})(?:-\d{4})?[\s,]*$/, (match, postalCode) => postalCode === zip ? "" : match)
    .replace(/[\s,]+$/, "");
  const postal = postalIndex[zip];
  const suffixMatch = clean.match(stateSuffix);
  const suffixIsCity = postal?.cities.some((city) => city.toLowerCase() === suffixMatch?.[1].toLowerCase());
  const stateMatch = suffixIsCity ? null : suffixMatch;
  const enteredState = stateCodes.get(stateMatch?.[1].toLowerCase() ?? "");
  if (enteredState && postal && enteredState !== postal.state) {
    throw new Error(`ZIP code ${zip} belongs to ${postal.state}. Check the city, state, and ZIP code.`);
  }

  const streetAndCity = stateMatch ? clean.slice(0, stateMatch.index).replace(/[\s,]+$/, "") : clean;
  const normalized = streetAndCity.toLowerCase();
  const citySuffix = postal?.cities.filter((city) => {
    const name = city.toLowerCase();
    return normalized === name || normalized.endsWith(` ${name}`) || normalized.endsWith(`,${name}`);
  }).sort((a, b) => b.length - a.length)[0];
  const parts = streetAndCity.split(",").map((part) => part.trim()).filter(Boolean);
  const lastPart = parts.at(-1) ?? "";
  const hasCityPart = parts.length > 1 && !/\d/.test(lastPart);
  const street = citySuffix ? streetAndCity.slice(0, -citySuffix.length).replace(/[\s,]+$/, "")
    : hasCityPart ? parts.slice(0, -1).join(", ") : /^\d/.test(streetAndCity) ? streetAndCity : "";
  return {
    addressLine: street || "N/A",
    city: citySuffix || postal?.cities[0] || (hasCityPart || !street ? lastPart : ""),
    state: enteredState || postal?.state || "",
    zip,
  };
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
  const fallback = { markupPercent: 0, minimumMarkup: 0, wwexEnabled: true, priority1Enabled: true, tqlEnabled: false };
  try {
    const response = await supabaseRequest("platform_settings?select=*&id=eq.true&limit=1");
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
      tqlEnabled: settings.tql_enabled === true,
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

async function quoteResponse(request: Request, emit?: (event: object) => void) {
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
    const providers = [
      { id: "wwex", enabled: pricing.wwexEnabled, getRates: getWwexRates },
      { id: "priority1", enabled: pricing.priority1Enabled, getRates: getPriority1Rates },
      { id: "tql", enabled: pricing.tqlEnabled, getRates: getTqlRates },
      { id: "mothership", enabled: mothershipRatesEnabled(), getRates: getMothershipRates },
    ] as const;
    const providerErrors: Record<string, string> = {};
    const batches = await Promise.all(providers.map(async ({ id, enabled, getRates }) => {
      if (!enabled) {
        emit?.({ type: "provider", id, status: "disabled" });
        return [];
      }
      const started = performance.now();
      emit?.({ type: "provider", id, status: "pending" });
      try {
        const returned = await getRates(quoteRequest);
        const rates = cheapestFive(returned.filter((rate) => Number.isFinite(rate.price) && rate.price > 0));
        emit?.({ type: "provider", id, status: rates.length ? "done" : "empty", elapsedMs: Math.round(performance.now() - started) });
        return rates;
      } catch (error) {
        providerErrors[id] = id === "mothership" ? "Mothership quote failed." : error instanceof Error ? error.message : "Carrier quote failed.";
        emit?.({ type: "provider", id, status: "failed", elapsedMs: Math.round(performance.now() - started) });
        return [];
      }
    }));

    const rates = batches.flat().map((rate) => customerRate(rate, pricing.markupPercent, pricing.minimumMarkup)).sort((a, b) => a.price - b.price);

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

export function POST(request: Request) {
  if (request.headers.get("accept") !== "application/x-ndjson") return quoteResponse(request);

  const encoder = new TextEncoder();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: object) => {
        if (!cancelled) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      try {
        const response = await quoteResponse(request, emit);
        emit({ type: "result", ok: response.ok, data: await response.json() });
      } catch {
        emit({ type: "result", ok: false, data: { error: "Unable to request rates." } });
      } finally {
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(body, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
