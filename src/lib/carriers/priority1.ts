import "server-only";
import { priority1BookingReference } from "../booking-safety";
import { beforeShipmentSubmission, NoShipmentSubmissionError } from "../booking-errors";

import type { NormalizedRate, QuoteRequest } from "./types";
import type { ShipmentBookingResult, StoredQuote } from "./shipment-types";

const packaging: Record<string, string> = {
  Bale: "Bale",
  Carton: "Carton",
  Crate: "Crate",
  Loose: "Pieces",
  Pallet: "Pallet",
  Roll: "Roll",
};

const accessorialCodes: Record<string, string> = {
  "Liftgate at pickup": "LGPU",
  "Liftgate at delivery": "LGDEL",
  "Residential pickup": "RESPU",
  "Residential delivery": "RESDEL",
  "Limited access": "LTDDEL",
  "Appointment delivery": "APPT",
};

export async function getPriority1Rates(input: QuoteRequest): Promise<NormalizedRate[]> {
  const apiBase = process.env.PRIORITY1_API_BASE;
  const apiKey = process.env.PRIORITY1_API_KEY;
  if (!apiBase || !apiKey) throw new Error("Priority1 sandbox is not configured.");

  const response = await fetch(`${apiBase}/v2/ltl/quotes/rates`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify({
      originCity: input.origin.city || null,
      originStateAbbreviation: input.origin.state || null,
      originZipCode: input.origin.zip,
      originCountryCode: "US",
      destinationCity: input.destination.city || null,
      destinationStateAbbreviation: input.destination.state || null,
      destinationZipCode: input.destination.zip,
      destinationCountryCode: "US",
      pickupDate: `${input.readyDate}T00:00:00`,
      items: input.items.map((item) => ({
        freightClass: item.freightClass,
        packagingType: packaging[item.packaging] || "Pallet",
        units: item.pallets,
        pieces: item.pieces ?? item.pallets,
        totalWeight: item.totalWeight,
        length: item.length,
        width: item.width,
        height: item.height,
        isStackable: item.stackable,
        isHazardous: item.hazmat,
        isUsed: false,
        isMachinery: false,
        description: item.commodity || "General merchandise",
      })),
      accessorialServices: input.services
        .map((service) => accessorialCodes[service])
        .filter(Boolean)
        .map((code) => ({ code })),
      apiConfiguration: null,
    }),
    cache: "no-store",
  });

  const data = await response.json();
  if (!response.ok) throw new Error(`Priority1 returned HTTP ${response.status}.`);

  return (Array.isArray(data.rateQuotes) ? data.rateQuotes : [])
    .map((quote: Record<string, any>): NormalizedRate | null => {
      const price = Number(quote.rateQuoteDetail?.total);
      if (!Number.isFinite(price) || price <= 0) return null;
      return {
        provider: "priority1",
        carrier: String(quote.carrierName || quote.carrierCode || "Priority1 carrier"),
        carrierCode: quote.carrierCode ? String(quote.carrierCode) : undefined,
        service: String(quote.serviceLevelDescription || quote.serviceLevel || "Standard LTL"),
        transitDays: Number.isFinite(Number(quote.transitDays)) ? Number(quote.transitDays) : null,
        price,
        providerRef: { quoteId: Number(quote.id), ...(input.services.includes("Limited access") ? { limitedAccessCode: "LTDDEL" } : {}) },
      };
    })
    .filter((rate: NormalizedRate | null): rate is NormalizedRate => rate !== null);
}

function priority1Headers() {
  const apiKey = process.env.PRIORITY1_API_KEY;
  if (!apiKey) throw new Error("Priority1 sandbox is not configured.");
  return { "Content-Type": "application/json", "X-API-KEY": apiKey };
}

function priority1Base() {
  const apiBase = process.env.PRIORITY1_API_BASE;
  if (!apiBase) throw new Error("Priority1 sandbox is not configured.");
  return apiBase;
}

function addBusinessDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  let remaining = Math.max(1, days);
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return date.toISOString().slice(0, 10);
}

function priority1Error(data: unknown, status: number) {
  if (Array.isArray(data)) {
    const messages = data.map((item) => item?.message || item?.text || item?.description).filter(Boolean);
    if (messages.length) return `Priority1: ${messages.join(" ")}`;
  }
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (record.errors && typeof record.errors === "object") {
      const messages = Object.values(record.errors as Record<string, unknown>).flat().map(String);
      if (messages.length) return `Priority1: ${messages.join(" ")}`;
    }
    const message = record.message || record.detail || record.title;
    if (message) return `Priority1: ${String(message)}`;
  }
  return `Priority1 dispatch returned HTTP ${status}.`;
}

export async function dispatchPriority1Shipment(quote: StoredQuote, reconcileOnly = false): Promise<ShipmentBookingResult> {
  if (!reconcileOnly && quote.services?.includes("Limited access") && quote.provider_ref?.limitedAccessCode !== "LTDDEL") {
    throw new NoShipmentSubmissionError("Limited access 报价需重新获取，请复制并重新报价。 / Get fresh Priority1 rates including Limited Access before booking.");
  }
  if (quote.freight_items.some((item) => item.hazmat)) {
    throw new Error("Hazmat BOL requires UN number, shipping name, hazard class, and packing group.");
  }

  // Dispatch can create a shipment before returning a carrier-side error.
  // Use the full system quote ID, never a customer-supplied PO, for recovery.
  const reference = priority1BookingReference(quote.id);
  if (!reference) throw new Error("A customer reference is required before generating a Priority1 BOL.");
  const existingResponse = await beforeShipmentSubmission(() => fetch(`${priority1Base()}/v2/ltl/shipments/status`, {
    method: "POST",
    headers: priority1Headers(),
    body: JSON.stringify({ identifierType: "CUSTOMER_REFERENCE", identifierValue: reference }),
    cache: "no-store",
  }), "Priority1 lookup failed before dispatch; no booking request was submitted.");
  if (existingResponse.status !== 404) {
    if (!existingResponse.ok) {
      throw new NoShipmentSubmissionError("Priority1 lookup failed before dispatch; no booking request was submitted.");
    }
    const existing = await beforeShipmentSubmission(() => existingResponse.json(), "Priority1 lookup returned invalid data before dispatch.");
    if (!Array.isArray(existing.shipments)) {
      throw new NoShipmentSubmissionError("Priority1 lookup returned invalid data before dispatch.");
    }
    if (existing.shipments.length > 0) {
      const shipment = existing.shipments.length === 1 ? existing.shipments[0] as { id?: string | number; shipmentIdentifiers?: { type: string; value: string }[] } : null;
      const identifiers = shipment?.shipmentIdentifiers || [];
      const bolNumber = identifiers.find((identifier) => identifier.type === "BILL_OF_LADING")?.value;
      const pickupId = identifiers.find((identifier) => identifier.type === "PICKUP")?.value;
      if (shipment?.id && bolNumber && pickupId && identifiers.some(identifier => identifier.type === "CUSTOMER_REFERENCE" && identifier.value === reference)) {
        return { shipmentId: String(shipment.id), pickupId, bolNumber, bolUrl: null, documentRef: null };
      }
      const bolNumbers = existing.shipments.flatMap((item: { shipmentIdentifiers?: { type: string; value: string }[] }) =>
        (item.shipmentIdentifiers || []).filter((identifier) => identifier.type === "BILL_OF_LADING").map((identifier) => identifier.value));
      throw new Error(`Priority1 already has shipment records for reference ${reference}${bolNumbers.length ? ` (BOL: ${bolNumbers.join(", ")})` : ""}. No new shipment was submitted. Verify pickup and reconcile these records before booking again.`);
    }
  }

  if (reconcileOnly) throw new Error("No matching completed Priority1 shipment was found. Keep the reservation pending for manual reconciliation.");
  const transitDays = Number.parseInt(quote.transit, 10) || 3;
  const response = await fetch(`${priority1Base()}/v2/ltl/shipments/dispatch`, {
    method: "POST",
    headers: priority1Headers(),
    body: JSON.stringify({
      originLocation: {
        address: { addressLine1: quote.sender.address1, addressLine2: quote.sender.address2 || null, city: quote.sender.city, state: quote.sender.state, postalCode: quote.sender.zip, country: "US" },
        contact: { companyName: quote.sender.company, contactName: quote.sender.contact, phoneNumber: quote.sender.phone, phoneNumberExtension: quote.sender.extension || null, email: quote.sender.email || null },
      },
      destinationLocation: {
        address: { addressLine1: quote.receiver.address1, addressLine2: quote.receiver.address2 || null, city: quote.receiver.city, state: quote.receiver.state, postalCode: quote.receiver.zip, country: "US" },
        contact: { companyName: quote.receiver.company, contactName: quote.receiver.contact, phoneNumber: quote.receiver.phone, phoneNumberExtension: quote.receiver.extension || null, email: quote.receiver.email || null },
      },
      lineItems: quote.freight_items.map((item) => ({
        freightClass: String(item.freightClass), packagingType: packaging[item.packaging] || "Pallet", units: Number(item.pallets), pieces: Number(item.pieces ?? item.pallets), totalWeight: Number(item.totalWeight), length: Number(item.length), width: Number(item.width), height: Number(item.height), description: item.commodity || "General merchandise", isStackable: item.stackable, isHazardous: false, isUsed: false,
      })),
      pickupWindow: { date: quote.ready_date, startTime: quote.pickup_ready_time.slice(0, 5), endTime: quote.pickup_close_time.slice(0, 5) },
      deliveryWindow: { date: addBusinessDays(quote.ready_date, transitDays), startTime: quote.receiver.deliveryStartTime || "08:00", endTime: quote.receiver.deliveryEndTime || "17:00" },
      shipmentIdentifiers: [{ type: "CUSTOMER_REFERENCE", value: reference, primaryForType: false }],
      quoteId: Number(quote.provider_ref.quoteId),
      insuranceAmount: quote.freight_items.reduce((sum, item) => sum + (Number(item.declaredValue) || 0), 0),
    }),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(priority1Error(data, response.status));
  const identifiers = Array.isArray(data.shipmentIdentifiers) ? data.shipmentIdentifiers : [];
  const bolNumber = String(identifiers.find((item: Record<string, unknown>) => item.type === "BILL_OF_LADING")?.value || "");
  if (!data.id || !bolNumber) {
    const message = Array.isArray(data.infoMessages) ? data.infoMessages[0]?.text : null;
    throw new Error(message || "Priority1 did not return a BOL number.");
  }
  return { shipmentId: String(data.id), pickupId: String(identifiers.find((item: Record<string, unknown>) => item.type === "PICKUP")?.value || "") || null, bolNumber, bolUrl: data.capacityProviderBolUrl ? String(data.capacityProviderBolUrl) : null, documentRef: null };
}

export async function cancelPriority1Shipment(shipmentId: string) {
  const response = await fetch(`${priority1Base()}/v2/ltl/shipments/cancel`, {
    method: "POST",
    headers: priority1Headers(),
    body: JSON.stringify({ id: Number(shipmentId) }),
    cache: "no-store",
  });
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        "Priority1 sandbox does not allow shipment cancellation for this API key. The shipment remains booked and the deposit was not refunded.",
      );
    }
    const text = await response.text();
    let detail = "";
    try {
      const data = JSON.parse(text);
      detail = String(data.message || data.detail || data.title || (Array.isArray(data) ? data.map((item) => item.message || item.text).filter(Boolean).join(" ") : ""));
    } catch {
      detail = text;
    }
    throw new Error(detail ? `Priority1 cancellation: ${detail}` : `Priority1 cancellation returned HTTP ${response.status}.`);
  }
}
