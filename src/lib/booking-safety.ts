import type { ShipmentParty, StoredQuote } from "./carriers/shipment-types";
import { formatPhoneNumber } from "./phone";
import { serviceMappingIssue } from "./carriers/service-support";

export function bookingParty(value: unknown): ShipmentParty {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Complete the shipment contact details.");
  const input = value as Record<string, unknown>;
  const limits = { company: 100, country: 50, address1: 100, address2: 100, zip: 5, state: 2, city: 100, phone: 30, extension: 10, contact: 100, email: 254 };
  const party: Record<string, string> = {};
  for (const [key, limit] of Object.entries(limits)) {
    const entry = input[key] ?? "";
    if (typeof entry !== "string" || entry.length > limit || /[\x00-\x1f]/.test(entry)) throw new Error(`Invalid shipment ${key}.`);
    party[key] = entry.trim();
  }
  if (![party.company, party.address1, party.city, party.contact].every(Boolean) || !/^\d{5}$/.test(party.zip) || !/^[A-Za-z]{2}$/.test(party.state)) throw new Error("Company, street address, city, state, ZIP and contact are required.");
  const digits = party.phone.replace(/\D/g, "");
  if (digits.length !== 10 || /[a-z]/i.test(party.phone)) throw new Error("Enter a 10-digit shipment phone number.");
  if (party.email && !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(party.email)) throw new Error("Enter a valid shipment email.");
  party.phone = formatPhoneNumber(party.phone); party.state = party.state.toUpperCase(); party.country ||= "United States";
  for (const field of ["deliveryStartTime", "deliveryEndTime"]) {
    if (input[field] !== undefined) {
      if (typeof input[field] !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input[field])) throw new Error("Enter valid delivery hours.");
      party[field] = input[field];
    }
  }
  return party as ShipmentParty;
}

export function validateBooking(quote: StoredQuote) {
  const mappingIssue = serviceMappingIssue(quote.provider, quote.services);
  if (mappingIssue) throw new Error(mappingIssue + " 请重新询价。 / Request fresh rates.");
  if (quote.provider === "priority1" && quote.services?.includes("Limited access") && quote.provider_ref?.limitedAccessCode !== "LTDDEL") throw new Error("Limited access 报价需重新获取，请复制并重新报价。 / Get fresh Priority1 rates including Limited Access before booking.");
  if (!["priority1", "wwex", "tql"].includes(quote.provider)) throw new Error("This provider does not support booking.");
  bookingParty(quote.sender); bookingParty(quote.receiver);
  if (!quote.reference.trim() || quote.reference.length > 300) throw new Error("Enter a reference of 1 to 300 characters.");
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(quote.pickup_ready_time) || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(quote.pickup_close_time) || quote.pickup_close_time <= quote.pickup_ready_time) throw new Error("Enter valid pickup hours.");
  if (!quote.freight_items.length || quote.freight_items.some(item => item.hazmat)) throw new Error("Hazardous freight requires an assisted booking with complete hazardous-material details.");
  if (quote.freight_items.some(item => [item.length, item.width, item.height, item.pallets, item.totalWeight].some(n => !Number.isFinite(Number(n)) || Number(n) <= 0))) throw new Error("Complete freight dimensions, quantity and weight.");
  if (quote.provider === "wwex" && (!quote.provider_ref.productTransactionId || !quote.provider_ref.offerId)) throw new Error("Request fresh WWEX rates.");
  if (quote.provider !== "wwex" && (!Number.isFinite(Number(quote.provider_ref.quoteId)) || Number(quote.provider_ref.quoteId) <= 0)) throw new Error("Request fresh carrier rates.");
  if (quote.provider === "tql" && (!quote.provider_ref.carrierPriceId || !(process.env.TQL_BOL_EMAIL || quote.sender.email || quote.receiver.email))) throw new Error("Complete the TQL quote reference and BOL email.");
}

export function priority1BookingReference(quoteId: string) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(quoteId)) throw new Error("Invalid quote ID.");
  return `QY-${quoteId.replaceAll("-", "").toLowerCase()}`;
}
