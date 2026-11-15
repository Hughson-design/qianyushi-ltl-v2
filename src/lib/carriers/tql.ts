import "server-only";

import type { NormalizedRate, QuoteRequest } from "./types";
import type { ShipmentBookingResult, ShipmentParty, StoredQuote } from "./shipment-types";

const packaging: Record<string, string> = {
  Bale: "UNITS",
  Carton: "CARTON",
  Crate: "CRATE",
  Loose: "UNITS",
  Pallet: "PLT",
  Roll: "ROLLS",
};

const accessorialCodes: Record<string, string> = {
  "Liftgate at pickup": "LGPU",
  "Liftgate at delivery": "LGDEL",
  "Appointment delivery": "APPTDEL",
};

let cachedToken: { value: string; expiresAt: number } | null = null;

function configuration() {
  const authUrl = process.env.TQL_AUTH_URL;
  const apiBase = process.env.TQL_API_BASE;
  const subscriptionKey = process.env.TQL_SUBSCRIPTION_KEY;
  const clientId = process.env.TQL_CLIENT_ID;
  const clientSecret = process.env.TQL_CLIENT_SECRET;
  const username = process.env.TQL_USERNAME;
  const password = process.env.TQL_PASSWORD;
  const scope = process.env.TQL_SCOPE;
  if (!authUrl || !apiBase || !subscriptionKey || !clientId || !clientSecret || !username || !password || !scope) {
    throw new Error("TQL API is not configured.");
  }
  return { authUrl, apiBase: apiBase.replace(/\/$/, ""), subscriptionKey, clientId, clientSecret, username, password, scope };
}

async function getToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;
  const config = configuration();
  const response = await fetch(config.authUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Ocp-Apim-Subscription-Key": config.subscriptionKey,
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: config.scope,
      grant_type: "password",
      username: config.username,
      password: config.password,
    }),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(tqlError(data, response.status, "authentication"));
  cachedToken = { value: String(data.access_token), expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

async function headers() {
  const config = configuration();
  return {
    "Content-Type": "application/json",
    "Ocp-Apim-Subscription-Key": config.subscriptionKey,
    Authorization: `Bearer ${await getToken()}`,
  };
}

function tqlError(data: unknown, status: number, operation: string) {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const content = record.content && typeof record.content === "object" ? record.content as Record<string, unknown> : null;
    const errors = Array.isArray(content?.errors) ? content.errors : Array.isArray(record.errors) ? record.errors : [];
    const messages = errors.map((item) => typeof item === "string" ? item : JSON.stringify(item)).filter(Boolean);
    const message = record.informationalMessage || record.message || record.error_description || record.error;
    if (messages.length || message) return `TQL ${operation}: ${messages.join(" ") || String(message)}`;
  }
  return `TQL ${operation} returned HTTP ${status}.`;
}

function locationType(input: QuoteRequest, side: "pickup" | "delivery") {
  if (input.services.includes(side === "pickup" ? "Residential pickup" : "Residential delivery")) return "Residential";
  if (side === "delivery" && input.services.includes("Limited access")) return "Limited Access";
  return "Commercial";
}

export async function getTqlRates(input: QuoteRequest): Promise<NormalizedRate[]> {
  const config = configuration();
  const response = await fetch(`${config.apiBase}/quotes`, {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify({
      accessorials: input.services.map((service) => accessorialCodes[service]).filter(Boolean),
      quoteCommodities: input.items.map((item) => ({
        freightClassCode: item.freightClass,
        unitTypeCode: packaging[item.packaging] || "PLT",
        description: (item.commodity || "General merchandise").slice(0, 250),
        quantity: item.pallets,
        weight: Math.round(item.totalWeight * 10) / 10,
        dimensionLength: Math.round(item.length),
        dimensionWidth: Math.round(item.width),
        dimensionHeight: Math.round(item.height),
        isHazmat: item.hazmat,
        isStackable: item.stackable,
      })),
      pickLocationType: locationType(input, "pickup"),
      dropLocationType: locationType(input, "delivery"),
      shipmentDate: `${input.readyDate}T12:00:00-05:00`,
      origin: { postalCode: input.origin.zip, city: input.origin.city, state: input.origin.state, country: "USA" },
      destination: { postalCode: input.destination.zip, city: input.destination.city, state: input.destination.state, country: "USA" },
    }),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(tqlError(data, response.status, "quote"));
  const content = data?.content || {};
  const quoteId = Number(content.quoteId);
  const prices = Array.isArray(content.carrierPrices) ? content.carrierPrices : [];
  return prices.map((price: Record<string, unknown>): NormalizedRate | null => {
    const amount = Number(price.customerRate);
    const carrierPriceId = Number(price.id);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(carrierPriceId) || !Number.isFinite(quoteId)) return null;
    return {
      provider: "tql",
      carrier: String(price.carrier || price.scac || "TQL carrier"),
      carrierCode: price.scac ? String(price.scac) : undefined,
      service: String(price.serviceLevelDescription || price.serviceLevel || "Standard LTL"),
      transitDays: Number.isFinite(Number(price.transitDays)) ? Number(price.transitDays) : null,
      price: amount,
      providerRef: { quoteId, carrierPriceId },
    };
  }).filter((rate: NormalizedRate | null): rate is NormalizedRate => rate !== null);
}

function twelveHourTime(value: string) {
  const [hoursText, minutes = "00"] = value.slice(0, 5).split(":");
  const hours = Number(hoursText);
  const suffix = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${minutes} ${suffix}`;
}

function partyDetails(party: ShipmentParty, hoursOpen: string, hoursClose: string) {
  return {
    stopName: party.company.slice(0, 50),
    contactName: party.contact.slice(0, 50),
    contactPhone: party.phone,
    contactExtension: party.extension ? party.extension.slice(0, 20) : null,
    address1: party.address1.slice(0, 50),
    address2: party.address2 ? party.address2.slice(0, 50) : null,
    hoursOpen,
    hoursClose,
  };
}

async function getTenderedPoNumber(quoteId: number) {
  const config = configuration();
  const response = await fetch(`${config.apiBase}/quotes/${quoteId}`, { headers: await headers(), cache: "no-store" });
  if (!response.ok) return null;
  const data = await response.json().catch(() => ({}));
  return data?.content?.poNumber ? String(data.content.poNumber) : null;
}

export async function dispatchTqlShipment(quote: StoredQuote): Promise<ShipmentBookingResult> {
  if (quote.freight_items.some((item) => item.hazmat)) {
    throw new Error("TQL hazmat BOL requires UN number, shipping name, hazard class, packing group, and emergency contact.");
  }
  const quoteId = Number(quote.provider_ref.quoteId);
  const carrierPriceId = Number(quote.provider_ref.carrierPriceId);
  if (!Number.isFinite(quoteId) || !Number.isFinite(carrierPriceId)) throw new Error("The TQL quote reference is missing or expired. Request new rates.");

  const existingPoNumber = await getTenderedPoNumber(quoteId);
  if (existingPoNumber) {
    return { shipmentId: existingPoNumber, pickupId: null, bolNumber: existingPoNumber, bolUrl: null, documentRef: "email" };
  }

  const bolEmail = process.env.TQL_BOL_EMAIL || quote.sender.email || quote.receiver.email;
  if (!bolEmail) throw new Error("Add TQL_BOL_EMAIL or a sender email before generating the TQL BOL.");
  const config = configuration();
  const response = await fetch(`${config.apiBase}/quotes/tender`, {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify({
      carrierPriceId,
      customerEmailAddresses: [bolEmail],
      shipmentDate: quote.ready_date,
      pickupDetails: {
        ...partyDetails(quote.sender, twelveHourTime(quote.pickup_ready_time), twelveHourTime(quote.pickup_close_time)),
        puNumber: quote.reference.slice(0, 300),
      },
      deliveryDetails: {
        ...partyDetails(quote.receiver, "8:00 AM", "5:00 PM"),
        deliveryPO: quote.reference.slice(0, 1000),
      },
    }),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(tqlError(data, response.status, "tender"));
  const bolNumber = String(data?.content?.poNumber || "");
  if (!bolNumber) throw new Error("TQL tendered the shipment but did not return a BOL number. Check the TQL portal before retrying.");
  return { shipmentId: bolNumber, pickupId: null, bolNumber, bolUrl: null, documentRef: "email" };
}

export async function cancelTqlShipment() {
  throw new Error("TQL does not provide a cancellation API. Contact TQL to cancel the shipment and pickup; the deposit has not been refunded.");
}
