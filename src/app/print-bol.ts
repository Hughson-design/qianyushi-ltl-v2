type PrintParty = {
  company: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  contact: string;
  phone: string;
};

type PrintShipment = {
  bol_number: string | null;
  ready_date: string | null;
  reference: string;
  carrier: string;
  sender: PrintParty;
  receiver: PrintParty;
  freight_items: Array<{
    pallets: string;
    packaging: string;
    totalWeight?: number;
    freightClass?: string;
    commodity: string;
    hazmat: boolean;
  }>;
};

export function printBol(shipment: PrintShipment) {
  const preview = window.open("", "_blank");
  if (!preview) return false;
  preview.opener = null;

  const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character
  ));
  const address = (party?: PrintParty) => [
    party?.company,
    party?.address1,
    party?.address2,
    [party?.city, party?.state, party?.zip].filter(Boolean).join(" "),
    [party?.contact, party?.phone].filter(Boolean).join(" · "),
  ].filter(Boolean).map(escape).join("<br>");
  const items = shipment.freight_items ?? [];
  const rows = items.map((item) =>
    `<tr><td>${escape(item.pallets)}</td><td>${escape(item.packaging)}</td><td>${escape(item.totalWeight)}</td><td>${item.hazmat ? "X" : ""}</td><td>${escape(item.commodity)}</td><td></td><td>${escape(item.freightClass)}</td></tr>`
  ).join("");

  preview.document.open();
  preview.document.write(`<!doctype html>
<html lang="en"><meta charset="utf-8"><title>BOL ${escape(shipment.bol_number)}</title>
<style>
  @page { size: letter portrait; margin: .45in; }
  body { font: 12px Arial, sans-serif; margin: 24px auto; max-width: 7.6in; padding: 0 12px; color: #111; }
  header, .columns, .signatures { display: grid; grid-template-columns: 1fr 1fr; }
  header { align-items: center; border: 1px solid; padding: 6px; }
  h1 { margin: 0; font-size: 20px; text-align: right; }
  h2 { margin: 0; padding: 4px; font-size: 11px; text-align: center; background: #111; color: white; }
  .box { border: 1px solid; }
  .fields { padding: 7px; min-height: 55px; overflow-wrap: anywhere; }
  .line { min-height: 22px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid; padding: 5px; overflow-wrap: anywhere; }
  thead { display: table-header-group; }
  tr, .signatures { break-inside: avoid; }
  .description { width: 36%; }
  section { margin-top: 8px; }
  button { margin-bottom: 12px; }
  @media print {
    body { margin: 0; padding: 0; max-width: none; }
    button { display: none; }
    h2 { background: white; color: #111; border-bottom: 1px solid; }
  }
</style>
<button type="button">Print / Save as PDF</button>
<header><span>Pickup date: ${escape(shipment.ready_date)}</span><h1>BILL OF LADING</h1></header>
<div class="columns">
  <div>
    <div class="box"><h2>SHIP FROM</h2><div class="fields">${address(shipment.sender)}</div></div>
    <div class="box"><h2>SHIP TO</h2><div class="fields">${address(shipment.receiver)}</div></div>
    <div class="box"><h2>THIRD PARTY FREIGHT CHARGES BILL TO</h2><div class="fields"></div></div>
  </div>
  <div class="box"><h2>CARRIER / SHIPMENT INFORMATION</h2><div class="fields">
    <div class="line"><b>Bill of Lading Number:</b> ${escape(shipment.bol_number)}</div>
    <div class="line"><b>Carrier:</b> ${escape(shipment.carrier)}</div>
    <div class="line">Trailer number: __________________</div>
    <div class="line">Seal number(s): __________________</div>
    <div class="line">SCAC: __________________</div>
    <div class="line">PRO number: __________________</div>
    <div class="line">Freight charge terms: __________________</div>
  </div></div>
</div>
<section class="box"><h2>SPECIAL INSTRUCTIONS</h2><div class="fields"></div></section>
<section><h2>CUSTOMER ORDER INFORMATION</h2>
  <table><thead><tr><th>Reference / PO</th><th>Additional shipper information</th></tr></thead>
  <tbody><tr><td>${escape(shipment.reference)}</td><td></td></tr></tbody></table>
</section>
<section><h2>CARRIER INFORMATION</h2>
  <table><thead><tr><th>Handling units</th><th>Type</th><th>Weight (lb)</th><th>H.M.</th><th class="description">Commodity description</th><th>NMFC #</th><th>Class</th></tr></thead>
  <tbody>${rows}</tbody></table>
</section>
<section class="signatures">
  <div class="box"><h2>SHIPPER SIGNATURE / DATE</h2><div class="fields"></div></div>
  <div class="box"><h2>CARRIER SIGNATURE / PICKUP DATE</h2><div class="fields"></div></div>
</section></html>`);
  preview.document.close();
  preview.document.querySelector("button")?.addEventListener("click", () => preview.print());
  preview.focus();
  return true;
}
