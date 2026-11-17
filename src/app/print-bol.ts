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
  service?: string;
  provider?: string;
  services?: string[];
  sender: PrintParty;
  receiver: PrintParty;
  freight_items: Array<{
    pallets: string;
    packaging: string;
    totalWeight?: number;
    unitWeight?: string | number;
    freightClass?: string;
    commodity: string;
    hazmat: boolean;
  }>;
};

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character
  ));

export function printBol(shipment: PrintShipment) {
  const preview = window.open("", "_blank");
  if (!preview) return false;
  preview.opener = null;

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
<html lang="en" class="${shipment.provider === "tql" ? "tql-bol" : ""}"><meta charset="utf-8"><title>BOL ${escape(shipment.bol_number)}</title>
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
  .tql-bol .columns > div:first-child { display: grid; grid-template-rows: repeat(3, minmax(min-content, 1fr)); }
  .tql-bol .fields { min-height: 0; padding: 6px 7px; }
  .tql-bol .line { min-height: 18px; }
  .tql-bol section { margin-top: 5px; }
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

export function printShippingLabel(shipment: PrintShipment) {
  const preview = window.open("", "_blank");
  if (!preview) return false;
  preview.opener = null;

  const items = shipment.freight_items ?? [];
  const units = items.reduce((total, item) => total + (Number(item.pallets) || 0), 0);
  const pallets = items.filter((item) => item.packaging?.toLowerCase() === "pallet").reduce((total, item) => total + (Number(item.pallets) || 0), 0);
  const weight = items.reduce((total, item) => total + (Number(item.totalWeight) || (Number(item.pallets) || 0) * (Number(item.unitWeight) || 0)), 0);
  const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
  const labelParty = (party?: PrintParty) => [
    party?.company,
    party?.contact,
    [party?.address1, party?.address2].filter(Boolean).join(" "),
    [party?.city, [party?.state, party?.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    party?.phone ? "P: " + party.phone : "",
  ].filter(Boolean).map((line) => "<div>" + escape(line) + "</div>").join("");
  const logo = escape(new URL("/qianvushi-logo.jpg", window.location.origin).href);

  preview.document.open();
  preview.document.write(`<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Shipping Label ${escape(shipment.bol_number)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  @page { size: letter landscape; margin: .45in; }
  * { box-sizing: border-box; }
  body { max-width: 10.1in; margin: 16px auto; padding: 0 12px; font: 16px/1.45 Arial,sans-serif; color: #111; }
  button { margin-bottom: 12px; }
  article { border: 1px dashed #111; border-radius: 12px; padding: 18px; }
  header, .columns { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); gap: 18px; }
  header { align-items: center; margin-bottom: 14px; }
  header strong { color: #176b4a; font-size: 22px; letter-spacing: .06em; }
  header img { width: 68px; height: 68px; object-fit: contain; border-radius: 10px; }
  aside { padding-right: 16px; border-right: 2px solid #111; }
  section, .columns { overflow-wrap: anywhere; }
  h2 { font-size: 22px; line-height: 1.15; margin: 0 0 6px; }
  .line { border-bottom: 1px solid #111; padding: 8px 0; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .addresses section + section { border-top: 2px solid #111; margin-top: 12px; padding-top: 12px; }
  .date { margin-top: 4px; }
  @media screen and (max-width: 550px) {
    .columns, header { grid-template-columns: minmax(0, 1fr); }
    aside { border-right: 0; padding-right: 0; }
  }
  @media print {
    body { margin: 0; max-width: none; padding: 0; }
    button { display: none; }
    article { break-inside: avoid; }
  }
</style>
<button type="button">Print / Save as PDF</button>
<article>
  <header><strong>QIANYUSHI LTL</strong><img src="${logo}" alt="" width="68" height="68"></header>
  <div class="columns">
    <aside>
      <div class="line"><b>Carrier</b><div>${escape(shipment.carrier)}</div></div>
      <div class="line pair"><div><b>Service Type</b><div>${escape(shipment.service)}</div></div><div><b>Total Weight</b><div>${weight > 0 ? number.format(weight) + " lb" : "—"}</div></div></div>
      <div class="line"><b>BOL #</b> ${escape(shipment.bol_number)}</div>
      <div class="line"><b>Customer Reference</b><div>${escape(shipment.reference)}</div></div>
      <div class="line"><b>Total Handling Units:</b> ${units > 0 ? number.format(units) : "—"}<br><b>Total Pallet Count:</b> ${number.format(pallets)}</div>
      <div class="line"><b>Additional Details</b><div>${(shipment.services ?? []).map(escape).join(" · ")}</div></div>
    </aside>
    <div class="addresses">
      <section><h2>SHIP FROM</h2>${labelParty(shipment.sender)}
        <div class="date"><b>Ship Date:</b> ${escape(shipment.ready_date)}</div>
      </section>
      <section><h2>SHIP TO</h2>${labelParty(shipment.receiver)}</section>
    </div>
  </div>
</article></html>`);
  preview.document.close();
  preview.document.querySelector("button")?.addEventListener("click", () => preview.print());
  preview.focus();
  return true;
}
