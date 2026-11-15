import type { NormalizedRate, QuoteRequest } from "./types";

const freightTypes: Record<string, string> = {
  Pallet: "Pallet", Carton: "Carton", Crate: "Crate", Bale: "Bale", Roll: "Roll", Loose: "Pieces",
};

type SandboxRate = {
  id: string;
  price: number;
  provider: string;
  providerScac?: string;
  transitDays?: { maximum?: number };
};

export async function getMothershipRates(input: QuoteRequest): Promise<NormalizedRate[]> {
  const token = process.env.MOTHERSHIP_SANDBOX_TOKEN?.trim();
  if (!token) return [];
  if (input.items.some((item) => item.hazmat || !item.stackable || !Object.hasOwn(freightTypes, item.packaging) || item.declaredValue > 0) ||
      input.services.some((service) => service === "Limited access" || service === "Overlength freight")) return [];

  const pickup: string[] = [];
  const delivery: string[] = [];
  if (input.services.includes("Liftgate at pickup")) pickup.push("liftgate");
  if (input.services.includes("Liftgate at delivery")) delivery.push("liftgate");
  if (input.services.includes("Residential pickup")) pickup.push("residential");
  if (input.services.includes("Residential delivery")) delivery.push("residential");
  if (input.services.includes("Appointment delivery")) delivery.push("appointment");

  const response = await fetch("https://sandbox.api.mothership.com/beta/quotes", {
    method: "POST",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      pickup: { address: { zip: input.origin.zip }, accessorials: pickup },
      delivery: { address: { zip: input.destination.zip }, accessorials: delivery },
      pickupReadyDate: { date: input.readyDate, time: "0900" },
      applyAvailableCredits: false,
      freight: input.items.map((item) => ({
        quantity: item.pallets,
        type: freightTypes[item.packaging],
        weight: Math.max(1, Math.ceil(item.totalWeight / item.pallets)),
        length: Math.ceil(item.length),
        width: Math.ceil(item.width),
        height: Math.ceil(item.height),
        description: item.commodity,
        freightClass: item.freightClass,
      })),
    }),
  });
  if (!response.ok) throw new Error("Mothership sandbox returned HTTP " + response.status + ".");
  const result: { data?: { id: string; rates: SandboxRate[] } } = await response.json();
  const quote = result.data;
  if (!quote?.id || !Array.isArray(quote.rates)) throw new Error("Invalid Mothership quote response.");

  return quote.rates.filter((rate) => rate.id && Number.isFinite(rate.price) && rate.price > 0).map((rate) => {
    const days = rate.transitDays?.maximum;
    return {
      provider: "mothership",
      carrier: rate.provider === "mothership" ? "Mothership" : rate.providerScac?.toUpperCase() || rate.provider,
      service: "LTL",
      price: rate.price,
      transitDays: typeof days === "number" && Number.isFinite(days) && days >= 0 ? days : null,
      providerRef: { quoteId: quote.id, rateId: rate.id },
    };
  });
}
