export type ShipmentParty = {
  company: string;
  country: string;
  address1: string;
  address2: string;
  zip: string;
  state: string;
  city: string;
  phone: string;
  extension: string;
  contact: string;
  email: string;
  deliveryStartTime?: string;
  deliveryEndTime?: string;
};

export type ShipmentItem = {
  packaging: string;
  stackable: boolean;
  pallets: string | number;
  pieces?: string | number;
  length: string | number;
  width: string | number;
  height: string | number;
  unitWeight: string | number;
  totalWeight: string | number;
  freightClass: string;
  hazmat: boolean;
  commodity: string;
  declaredValue: string | number;
};

export type StoredQuote = {
  id: string;
  quote_number: string;
  status: string;
  reference: string;
  ready_date: string;
  pickup_ready_time: string;
  pickup_close_time: string;
  provider: "priority1" | "wwex" | "tql";
  provider_ref: Record<string, string | number>;
  transit: string;
  sender: ShipmentParty;
  receiver: ShipmentParty;
  freight_items: ShipmentItem[];
  services: string[];
};

export type ShipmentBookingResult = {
  shipmentId: string;
  pickupId: string | null;
  bolNumber: string;
  bolUrl: string | null;
  documentRef: string | null;
};
