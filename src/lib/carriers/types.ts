export type QuoteLineItem = {
  packaging: string;
  pallets: number;
  pieces?: number;
  stackable: boolean;
  length: number;
  width: number;
  height: number;
  totalWeight: number;
  freightClass: string;
  hazmat: boolean;
  commodity: string;
  declaredValue: number;
};

export type QuoteLocation = {
  addressLine: string;
  city: string;
  state: string;
  zip: string;
};

export type QuoteRequest = {
  origin: QuoteLocation;
  destination: QuoteLocation;
  readyDate: string;
  items: QuoteLineItem[];
  services: string[];
};

export type NormalizedRate = {
  provider: "wwex" | "priority1" | "tql" | "mothership";
  carrier: string;
  carrierCode?: string;
  service: string;
  transitDays: number | null;
  price: number;
  providerRef: Record<string, string | number>;
};

