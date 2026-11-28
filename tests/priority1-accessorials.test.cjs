const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
function load(file, names, globals = {}) {
  const source = stripTypeScriptTypes(fs.readFileSync(file, 'utf8').replace(/^import .*;\r?\n/gm, '')).replace(/\bexport /g, '');
  return vm.runInNewContext(source + ';({' + names + '})', { Response, Date, serviceMappingIssue: (...args) => load('src/lib/carriers/service-support.ts', 'serviceMappingIssue').serviceMappingIssue(...args), process: { env: { PRIORITY1_API_BASE: 'https://fixture.invalid', PRIORITY1_API_KEY: 'fixture' } }, ...globals });
}
const input = { origin: { zip: '91710' }, destination: { zip: '76132' }, readyDate: '2026-11-30', items: [{ packaging: 'Pallet', pallets: 1, pieces: 1, totalWeight: 1188, length: 57, width: 40, height: 88, freightClass: '92.5' }] };
test('Limited Access Delivery is sent alongside liftgate and appointment; full carrier totals pass through', async () => {
  const requests = [];
  const carrier = load('src/lib/carriers/priority1.ts', 'getPriority1Rates', { fetch: async (url, init) => {
    const body = JSON.parse(init.body); requests.push(body); const limited = body.accessorialServices.some(s => s.code === 'LTDDEL');
    return Response.json({ rateQuotes: [
      { id: 1, carrierName: 'Roadrunner fixture', rateQuoteDetail: { total: limited ? 546.40 : 496.40 } },
      { id: 2, carrierName: 'Custom fixture', rateQuoteDetail: { total: limited ? 549.74 : 479.19 } },
    ] });
  } });
  const services = ['Liftgate at delivery', 'Appointment delivery', 'Limited access'];
  const rates = await carrier.getPriority1Rates({ ...input, services });
  assert.deepEqual(requests[0].accessorialServices.map(s => s.code), ['LGDEL', 'APPT', 'LTDDEL']);
  assert.equal(rates[0].price, 546.40); assert.equal(rates[1].price, 549.74);
  assert.equal(rates[0].providerRef.limitedAccessCode, 'LTDDEL');
  const base = await carrier.getPriority1Rates({ ...input, services: services.slice(0, 2) });
  assert.equal(base[0].price, 496.40); assert.equal(base[1].price, 479.19);
  assert.equal(base[0].providerRef.limitedAccessCode, undefined);
});
test('all previously supported services keep their codes when Limited Access is added', async () => {
  let request;
  const carrier = load('src/lib/carriers/priority1.ts', 'getPriority1Rates', { fetch: async (_, init) => { request = JSON.parse(init.body); return Response.json({ rateQuotes: [] }); } });
  await carrier.getPriority1Rates({ ...input, services: ['Liftgate at pickup', 'Liftgate at delivery', 'Residential pickup', 'Residential delivery', 'Appointment delivery', 'Limited access'] });
  assert.deepEqual(request.accessorialServices.map(s => s.code), ['LGPU','LGDEL','RESPU','RESDEL','APPT','LTDDEL']);
});
test('old limited-access drafts stop before deposit validation and any carrier request', async () => {
  const quote = { provider: 'priority1', services: ['Limited access'], provider_ref: { quoteId: 123 } };
  const safety = load('src/lib/booking-safety.ts', 'validateBooking');
  assert.throws(() => safety.validateBooking(quote), /Get fresh Priority1/);
  const errors = load('src/lib/booking-errors.ts', 'NoShipmentSubmissionError');
  let requests = 0;
  const carrier = load('src/lib/carriers/priority1.ts', 'dispatchPriority1Shipment', { ...errors, fetch: async () => { requests++; throw Error('unexpected'); } });
  await assert.rejects(carrier.dispatchPriority1Shipment(quote), /Get fresh Priority1/);
  assert.equal(requests, 0);
});
test('dispatch uses the selected quote ID carrying the priced accessorial, without inventing unsupported dispatch fields', async () => {
  const requests = [];
  const errors = load('src/lib/booking-errors.ts', 'NoShipmentSubmissionError,beforeShipmentSubmission');
  const carrier = load('src/lib/carriers/priority1.ts', 'dispatchPriority1Shipment', { ...errors, priority1BookingReference: () => 'unique-fixture', fetch: async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    return url.endsWith('/status') ? new Response(null, { status: 404 }) : Response.json({ id: 123, shipmentIdentifiers: [{ type: 'BILL_OF_LADING', value: 'fixture-bol' }] });
  } });
  const party = { company: 'Fixture', contact: 'Fixture', address1: 'Fixture', city: 'Fixture', state: 'CA', zip: '91710', phone: '5572145975' };
  const result = await carrier.dispatchPriority1Shipment({ id: 'fixture', services: ['Limited access'], provider_ref: { quoteId: 202, limitedAccessCode: 'LTDDEL' }, sender: party, receiver: party, freight_items: [], transit: '4 days', ready_date: '2026-11-30', pickup_ready_time: '09:00', pickup_close_time: '16:00' });
  assert.equal(result.bolNumber, 'fixture-bol'); assert.equal(requests[1].body.quoteId, 202);
});
