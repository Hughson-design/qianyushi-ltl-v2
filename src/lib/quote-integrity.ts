import { createHmac, timingSafeEqual } from "node:crypto";
import type { NormalizedRate, QuoteLineItem } from "./carriers/types";

type RatedShipment = {
  originZip: string;
  destinationZip: string;
  readyDate: string;
  items: Array<QuoteLineItem & { unitWeight: number }>;
  services: string[];
};

type QuoteOffer = {
  customerId: string;
  expiresAt: number;
  rate: NormalizedRate;
  shipment: RatedShipment;
};

function sign(purpose: string, value: string) {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("Quote verification is not configured.");
  return createHmac("sha256", secret).update(purpose).update("\0").update(value).digest("base64url");
}

function matches(signature: unknown, expected: string) {
  if (typeof signature !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function issueQuoteToken(customerId: string, rate: NormalizedRate, shipment: RatedShipment) {
  const offer: QuoteOffer = { customerId, rate, shipment, expiresAt: Date.now() + 30 * 60 * 1000 };
  const payload = Buffer.from(JSON.stringify(offer)).toString("base64url");
  return payload + "." + sign("quote-offer-v1", payload);
}

export function readQuoteToken(token: unknown, customerId: string): QuoteOffer | null {
  if (typeof token !== "string" || token.length > 128_000) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || extra !== undefined || !matches(signature, sign("quote-offer-v1", payload))) return null;
  try {
    const offer: QuoteOffer = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (offer.customerId !== customerId || offer.expiresAt <= Date.now()) return null;
    if (!Number.isFinite(offer.rate.price) || offer.rate.price <= 0) return null;
    return offer;
  } catch {
    return null;
  }
}

export function shipmentProof(id: string, customerId: string) {
  return sign("saved-shipment-v1", JSON.stringify([id, customerId]));
}

export function verifyShipmentProof(proof: unknown, id: string, customerId: string) {
  return matches(proof, shipmentProof(id, customerId));
}
