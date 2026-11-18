import "server-only";

import type { NormalizedRate, QuoteRequest } from "./types";
import type { ShipmentBookingResult, ShipmentParty, StoredQuote } from "./shipment-types";

const packaging: Record<string, string> = {
  Bale: "BALE",
  Carton: "CARTON",
  Crate: "CRATE",
  Loose: "PIECES",
  Pallet: "PLT",
  Roll: "ROLL",
};

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;

  const authUrl = process.env.WWEX_AUTH_URL;
  const clientId = process.env.WWEX_CLIENT_ID;
  const clientSecret = process.env.WWEX_CLIENT_SECRET;
  const audience = process.env.WWEX_AUDIENCE;
  if (!authUrl || !clientId || !clientSecret || !audience) throw new Error("WWEX sandbox is not configured.");

  const response = await fetch(authUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, audience }),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(`WWEX authentication returned HTTP ${response.status}.`);

  cachedToken = { value: String(data.access_token), expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

export async function getWwexRates(input: QuoteRequest): Promise<NormalizedRate[]> {
  const apiBase = process.env.WWEX_API_BASE;
  if (!apiBase) throw new Error("WWEX sandbox is not configured.");
  const token = await getToken();
  const totalWeight = input.items.reduce((sum, item) => sum + item.totalWeight, 0);
  const totalDeclaredValue = input.items.reduce((sum, item) => sum + item.declaredValue, 0);
  const has = (service: string) => input.services.includes(service);

  const response = await fetch(`${apiBase}/shopFlow`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      request: {
        productType: "LTL",
        shipment: {
          appointmentDeliveryFlag: has("Appointment delivery"),
          insuranceRequestFlag: totalDeclaredValue > 0,
          ...(totalDeclaredValue > 0 ? { totalDeclaredValue: { unit: "USD", value: String(totalDeclaredValue) } } : {}),
          originAddress: {
            address: {
              addressLineList: [input.origin.addressLine || "N/A"],
              locality: input.origin.city,
              region: input.origin.state,
              postalCode: input.origin.zip,
              countryCode: "US",
              companyName: "",
              contactList: [{ firstName: "Quote", lastName: "Contact", phone: "", contactType: "SENDER" }],
            },
            locationType: null,
          },
          destinationAddress: {
            address: {
              addressLineList: [input.destination.addressLine || "N/A"],
              locality: input.destination.city,
              region: input.destination.state,
              postalCode: input.destination.zip,
              countryCode: "US",
              companyName: "",
              contactList: [{ firstName: "Quote", lastName: "Contact", phone: "", contactType: "RECEIVER" }],
            },
            locationType: has("Residential delivery") ? "RESIDENTIAL" : has("Limited access") ? "LIMITED_ACCESS" : null,
          },
          handlingUnitList: input.items.map((item) => ({
            billedDimension: {
              length: { value: String(item.length), unit: "in" },
              width: { value: String(item.width), unit: "in" },
              height: { value: String(item.height), unit: "in" },
              dimensionType: "NET",
            },
            isMixedClass: false,
            isStackable: item.stackable,
            packagingType: packaging[item.packaging] || "PLT",
            quantity: item.pallets,
            shippedItemList: [{
              commodityClass: item.freightClass,
              commodityDescription: item.commodity || "General merchandise",
              commodityType: packaging[item.packaging] || "PLT",
              dimensions: {
                length: { value: null, unit: "in" },
                width: { value: null, unit: "in" },
                height: { value: null, unit: "in" },
                dimensionType: "NET",
              },
              hazMatItemInfo: null,
              isHazMat: item.hazmat,
              NMFCNbr: null,
              quantity: String(item.pieces ?? item.pallets),
              weight: { value: item.totalWeight, unit: "LB" },
            }],
            weight: { unit: "LB", value: item.totalWeight },
          })),
          protectionFromColdFlag: false,
          residentialPickupFlag: has("Residential pickup"),
          shipmentDate: `${input.readyDate} 09:00:00`,
          sortAndSegregateFlag: false,
          totalHandlingUnitCount: input.items.reduce((sum, item) => sum + item.pallets, 0),
          totalWeight: { value: totalWeight, unit: "LB" },
          tradeshowDeliveryFlag: false,
          tradeshowPickupFlag: false,
          holdAtTerminalFlag: false,
          insideDeliveryFlag: false,
          insidePickupFlag: false,
          carrierTerminalPickupFlag: false,
          liftgateDeliveryFlag: has("Liftgate at delivery"),
          liftgatePickupFlag: has("Liftgate at pickup"),
          constructionSiteDeliveryFlag: false,
          constructionSitePickupFlag: false,
          notifyBeforeDeliveryFlag: false,
        },
      },
    }),
    cache: "no-store",
  });

  const data = await response.json();
  if (!response.ok) throw new Error(`WWEX returned HTTP ${response.status}.`);
  const offers = Array.isArray(data?.response?.offerList) ? data.response.offerList : [];

  return offers
    .map((offer: Record<string, any>): NormalizedRate | null => {
      const price = Number(offer.totalOfferPrice?.value);
      if (!Number.isFinite(price) || price <= 0) return null;
      const vendor = offer.primaryVendor || {};
      const product = Array.isArray(offer.offeredProductList) ? offer.offeredProductList[0] : null;
      const transit = Number(product?.shopRQShipment?.timeInTransit?.transitDays);
      return {
        provider: "wwex",
        carrier: String(vendor.preferredName || vendor.legalName || vendor.scac || "WWEX carrier"),
        carrierCode: vendor.scac ? String(vendor.scac) : undefined,
        service: "Standard LTL",
        transitDays: Number.isFinite(transit) ? transit : null,
        price,
        providerRef: {
          productTransactionId: String(offer.productTransactionId || ""),
          offerId: String(offer.offerId || offer.id || ""),
        },
      };
    })
    .filter((rate: NormalizedRate | null): rate is NormalizedRate => rate !== null);
}

function wwexBase() {
  const apiBase = process.env.WWEX_API_BASE;
  if (!apiBase) throw new Error("WWEX sandbox is not configured.");
  return apiBase;
}

function contact(party: ShipmentParty, contactType: "SENDER" | "RECEIVER") {
  const names = party.contact.trim().split(/\s+/);
  const firstName = names.length > 1 ? names.shift() || "Contact" : "Contact";
  const lastName = names.join(" ") || party.contact || party.company;
  return { firstName: firstName.slice(0, 17), lastName: lastName.slice(0, 17), phone: party.phone, contactType, email: party.email || "", extension: party.extension || null };
}

function findDeep(value: unknown, wanted: string[]): unknown {
  if (!value || typeof value !== "object") return undefined;
  for (const [key, child] of Object.entries(value)) {
    if (wanted.includes(key.toLowerCase()) && child !== null && child !== "") return child;
    const nested = findDeep(child, wanted);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export async function getWwexBolDocument(productTransactionId: string) {
  const token = await getToken();
  const response = await fetch(`${wwexBase()}/documentDownloadFlow`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ request: { downloadMode: "SINGLE", docTypes: ["BILL_OF_LADING"], transactionType: "LTL", referenceMap: { PRODUCT_TRANSACTION_ID: productTransactionId } } }),
    cache: "no-store",
  });
  if (!response.ok) return null;
  const data = await response.json();
  const securedLink = Array.isArray(data?.response?.securedLinks) ? String(data.response.securedLinks[0] || "") : "";
  const fileContent = typeof data?.response?.fileContent === "string" ? data.response.fileContent : "";
  const bolNumber = securedLink.match(/(?:combined-)?(NUD\d+)/i)?.[1]?.toUpperCase() || "";
  if (!bolNumber || (!securedLink && !fileContent)) return null;
  return { bolNumber, securedLink: securedLink || null, fileContent: fileContent || null };
}

export async function getWwexPickupIdByBol(bolNumber: string) {
  const token = await getToken();
  const response = await fetch(`${wwexBase()}/searchIndexDocumentFlow`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ request: { index: "producttransaction", searchFacts: { productType: ["LTL"], queryString: { query: bolNumber, fields: ["bol"] } }, limit: 10, sortList: [{ key: "orderedDate", order: "desc" }] } }),
    cache: "no-store",
  });
  if (!response.ok) return null;
  const data = await response.json();
  const documents = Array.isArray(data?.response?.documentList) ? data.response.documentList : [];
  const shipment = documents.find((item: Record<string, unknown>) => String(item.bol || item.orderId || "").toUpperCase() === bolNumber.toUpperCase());
  return shipment?.pickupProductTransactionId ? String(shipment.pickupProductTransactionId) : null;
}

export async function dispatchWwexShipment(quote: StoredQuote): Promise<ShipmentBookingResult> {
  if (quote.freight_items.some((item) => item.hazmat)) {
    throw new Error("Hazmat BOL requires additional hazardous-material details.");
  }
  const productTransactionId = String(quote.provider_ref.productTransactionId || "");
  const offerId = String(quote.provider_ref.offerId || "");
  if (!productTransactionId || !offerId) throw new Error("The WWEX quote reference is missing or expired. Request new rates.");
  const existingDocument = await getWwexBolDocument(productTransactionId);
  if (existingDocument) {
    return { shipmentId: productTransactionId, pickupId: null, bolNumber: existingDocument.bolNumber, bolUrl: `/api/quotes/${quote.id}/document`, documentRef: productTransactionId };
  }
  const token = await getToken();
  const address = (party: ShipmentParty, type: "SENDER" | "RECEIVER") => ({ address: { addressLineList: [party.address1, party.address2].filter(Boolean), locality: party.city, region: party.state, postalCode: party.zip, countryCode: "US", companyName: party.company, phone: party.phone, contactList: [contact(party, type)] } });
  const deliveryInstructions = quote.receiver.deliveryStartTime && quote.receiver.deliveryEndTime
    ? `Delivery hours (local time): ${quote.receiver.deliveryStartTime} - ${quote.receiver.deliveryEndTime}` : "";
  const response = await fetch(`${wwexBase()}/quoteOrderFlow`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ request: { shipmentProductTransactionId: productTransactionId, shipmentOfferId: offerId, shipment: { originAddress: address(quote.sender, "SENDER"), destinationAddress: address(quote.receiver, "RECEIVER"), shipmentReferenceList: [{ type: "Reference 1", value: quote.reference.slice(0, 35) }], pickupSpecialInstructions: "", deliverySpecialInstructions: deliveryInstructions, handlingSpecialInstructions: "" }, isSelfScheduled: false, pickupDate: `${quote.ready_date} ${quote.pickup_ready_time}:00`, closeTime: `${quote.pickup_close_time}:00`, readyTime: `${quote.pickup_ready_time}:00` } }),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`WWEX booking returned HTTP ${response.status}.`);
  const pickupId = findDeep(data, ["pickuptxnid", "pickuptransactionid", "pickupproducttransactionid"]);
  const bolValue = findDeep(data, ["bolnumber", "bolnum", "bol"]);
  const documentRef = findDeep(data, ["s3filename", "filename"]);
  const url = findDeep(data, ["downloadurl", "documenturl", "url"]);
  const bolFromFile = typeof documentRef === "string" ? documentRef.match(/(NUD\d+)/i)?.[1] : null;
  const downloadedDocument = bolValue || bolFromFile ? null : await getWwexBolDocument(productTransactionId);
  const bolNumber = String(bolValue || bolFromFile || downloadedDocument?.bolNumber || "");
  if (!bolNumber) throw new Error("WWEX created the shipment but its BOL is not available yet. Wait a moment and click Generate BOL again; the existing shipment will be recovered without creating a duplicate.");
  const bolUrl = downloadedDocument ? `/api/quotes/${quote.id}/document` : typeof url === "string" && /^https?:/i.test(url) ? url : `/api/quotes/${quote.id}/document`;
  return { shipmentId: productTransactionId, pickupId: pickupId ? String(pickupId) : null, bolNumber, bolUrl, documentRef: documentRef ? String(documentRef) : productTransactionId };
}

export async function cancelWwexShipment(shipmentId: string, pickupId: string | null) {
  const token = await getToken();
  const ids = [shipmentId, pickupId].filter((value): value is string => Boolean(value));
  const response = await fetch(`${wwexBase()}/integratedCancelFlow`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ request: { cancelRQList: ids.map((productTransactionId) => ({ productTransactionId })) } }), cache: "no-store" });
  if (!response.ok) {
    const text = await response.text();
    try {
      const data = JSON.parse(text);
      const message = data?.clientStatus?.message || data?.message;
      throw new Error(message ? `WWEX cancellation: ${message}` : `WWEX cancellation returned HTTP ${response.status}.`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("WWEX cancellation:")) throw error;
      throw new Error(`WWEX cancellation returned HTTP ${response.status}.`);
    }
  }
}
