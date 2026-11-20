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

export function tqlConnectionStatus() {
  const mode = process.env.TQL_AUTH_MODE?.trim() || (process.env.TQL_CLIENT_SECRET?.trim() ? "legacy" : "public");
  if (!["public", "legacy"].includes(mode)) throw new Error("TQL_AUTH_MODE must be public or legacy.");
  const required = ["TQL_SUBSCRIPTION_KEY", "TQL_CLIENT_ID", "TQL_USERNAME", "TQL_PASSWORD", "TQL_SCOPE"];
  if (mode === "legacy") required.push("TQL_CLIENT_SECRET");
  return { mode, missing: required.filter((name) => !process.env[name]?.trim()) };
}

export function auditTqlConfiguration() {
  const status = tqlConnectionStatus();
  const expectedScopes = ["LTLQuotes.Read", "LTLQuotes.Write", "LTLQuotes.Tender", "LoadTracking.Read"].map((name) => `https://tqlidentity.onmicrosoft.com/services_combined/${name}`);
  const scopes = (process.env.TQL_SCOPE || "").trim().split(/\s+/).filter(Boolean);
  const id = process.env.TQL_CLIENT_ID?.trim() || "";
  const key = process.env.TQL_SUBSCRIPTION_KEY?.trim() || "";
  const password = process.env.TQL_PASSWORD || "";
  const required = ["TQL_CLIENT_ID", "TQL_SUBSCRIPTION_KEY", "TQL_USERNAME", "TQL_PASSWORD"];
  return {
    mode: status.mode, missing: status.missing,
    checks: {
      authEndpointMatchesEmail: (process.env.TQL_AUTH_URL?.trim() || "https://public.api.tql.com/identity/token") === "https://public.api.tql.com/identity/token",
      apiBaseMatchesProduction: (process.env.TQL_API_BASE?.trim() || "https://public.api.tql.com/ltl").replace(/\/$/, "") === "https://public.api.tql.com/ltl",
      scopesMatchEmail: scopes.length === expectedScopes.length && expectedScopes.every((scope) => scopes.includes(scope)),
      clientIdIsSingleUuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
      subscriptionKeyHasNoWhitespace: Boolean(key) && !/\s/.test(key),
      noCredentialPlaceholders: required.every((name) => !/^(?:YOUR_|REPLACE_|<|placeholder|fixture-|test-only)/i.test(process.env[name]?.trim() || "")),
      passwordHasNoEdgeWhitespace: Boolean(password) && password === password.trim(),
      scopeUsesSingleSpaces: (process.env.TQL_SCOPE?.trim() || "") === scopes.join(" "),
    },
  };
}

function configuration() {
  const status = tqlConnectionStatus();
  if (status.missing.length) throw new Error(`TQL API is not configured: ${status.missing.join(", ")}.`);
  const authUrl = process.env.TQL_AUTH_URL?.trim() || "https://public.api.tql.com/identity/token";
  const apiBase = process.env.TQL_API_BASE?.trim() || "https://public.api.tql.com/ltl";
  for (const endpoint of [authUrl, apiBase]) {
    const url = new URL(endpoint);
    if (url.origin !== "https://public.api.tql.com" || url.username || url.password || url.search || url.hash) throw new Error("Use the HTTPS public.api.tql.com endpoints supplied by TQL.");
  }
  return { authUrl, apiBase: apiBase.replace(/\/$/, ""), mode: status.mode,
    subscriptionKey: process.env.TQL_SUBSCRIPTION_KEY!.trim(), clientId: process.env.TQL_CLIENT_ID!.trim(),
    clientSecret: process.env.TQL_CLIENT_SECRET?.trim(), username: process.env.TQL_USERNAME!.trim(),
    password: process.env.TQL_PASSWORD!, scope: process.env.TQL_SCOPE!.trim() };
}

async function getToken(force = false) {
  if (!force && cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;
  const config = configuration();
  const body = new URLSearchParams({ client_id: config.clientId, scope: config.scope,
    grant_type: "password", username: config.username, password: config.password });
  if (config.mode === "legacy") body.set("client_secret", config.clientSecret!);
  const response = await fetch(config.authUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "Ocp-Apim-Subscription-Key": config.subscriptionKey,
    },
    body,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const raw = await response.text();
  let data: unknown = null;
  try { data = JSON.parse(raw); } catch { /* A public-client endpoint may return the JWT directly. */ }
  const root = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
  const envelopes = [root, root.content, root.data].filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value));
  const direct = typeof data === "string" ? data.trim() : raw.trim();
  const directJwt = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(direct);
  let token = directJwt ? direct : "", expires = 3600;
  for (const envelope of envelopes) {
    const candidate = envelope.access_token ?? envelope.accessToken ?? envelope.token;
    if (typeof candidate === "string" && candidate.trim()) {
      token = candidate.trim(); expires = Number(envelope.expires_in ?? envelope.expiresIn ?? 3600); break;
    }
  }
  // Return field names only, never values: identity-provider errors can echo credentials.
  if (!response.ok || !token) {
    const names = (record: Record<string, unknown>) => Object.keys(record).filter((key) => /^[a-zA-Z_][a-zA-Z0-9_]{0,39}$/.test(key)).slice(0, 12).join(", ") || "none";
    const shape = envelopes.map((envelope, index) => `${index === 0 ? "root" : "envelope"}: ${names(envelope)}`).join("; ");
    const format = data === null ? (response.headers.get("content-type")?.split(";")[0] || "non-JSON") : Array.isArray(data) ? "JSON array" : typeof data;
    const htmlHint = format === "text/html" ? /captcha|challenge|verify you are human|bot protection|incapsula|imperva|cloudflare/i.test(raw) ? " HTML category: access verification." : /access denied|request blocked|forbidden|security policy|blocked request/i.test(raw) ? " HTML category: access denied." : " HTML category: webpage, not an API token." : "";
    throw new Error(`TQL authentication returned HTTP ${response.status}. Response format: ${format}. Response fields (${shape}).${htmlHint} Check the subscription key, TRAX login, scopes and authentication mode.`);
  }
  cachedToken = { value: token, expiresAt: Date.now() + (Number.isFinite(expires) && expires > 0 ? Math.min(expires, 3600) : 3600) * 1000 };
  return cachedToken.value;
}

export async function testTqlAuthentication() {
  await getToken(true);
  return { authenticated: true, mode: tqlConnectionStatus().mode };
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
        ...(item.nmfc ? { nmfc: item.nmfc } : {}),
        unitTypeCode: packaging[item.packaging] || "PLT",
        description: (item.commodity || "General merchandise").slice(0, 250),
        quantity: item.pallets,
        weight: Math.ceil(item.totalWeight),
        dimensionLength: Math.ceil(item.length),
        dimensionWidth: Math.ceil(item.width),
        dimensionHeight: Math.ceil(item.height),
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
  if (!response.ok) throw new Error("TQL existing-tender lookup failed. Verify the shipment before booking.");
  const data = await response.json();
  if (!data?.content || typeof data.content !== "object" || Array.isArray(data.content)) throw new Error("TQL existing-tender response was invalid. Verify before booking.");
  return data?.content?.poNumber ? String(data.content.poNumber) : null;
}

export async function dispatchTqlShipment(quote: StoredQuote, reconcileOnly = false): Promise<ShipmentBookingResult> {
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

  if (reconcileOnly) throw new Error("No completed TQL tender was found. Keep the reservation pending for manual reconciliation.");
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
        ...partyDetails(quote.receiver, twelveHourTime(quote.receiver.deliveryStartTime || "08:00"), twelveHourTime(quote.receiver.deliveryEndTime || "17:00")),
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
