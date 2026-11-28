const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
function load(path, names, globals = {}) {
  const source = stripTypeScriptTypes(fs.readFileSync(path, 'utf8').replace(/^import .*;\r?\n/gm, '')).replace(/\bexport /g, '');
  return vm.runInNewContext(source + ';({' + names + '})', { Request, Response, URL, AbortSignal, ReadableStream, TextEncoder, Date, performance, NextResponse: class extends Response {}, ...globals });
}
const support = load('src/lib/carriers/service-support.ts', 'serviceMappingIssue');
const input = { origin: { zip: '91710' }, destination: { zip: '76132' }, readyDate: '2026-11-30', items: [{ packaging: 'Pallet', pallets: 1, totalWeight: 500, length: 48, width: 40, height: 48, stackable: true, hazmat: false, declaredValue: 0 }] };
test('unsupported combinations cannot silently discard a requested service', () => {
  for (const provider of ['priority1', 'wwex', 'tql', 'mothership']) {
    assert.match(support.serviceMappingIssue(provider, ['Overlength freight']), /Overlength/);
    assert.match(support.serviceMappingIssue(provider, ['unknown']), /Unsupported/);
    for (const service of ['Liftgate at pickup','Liftgate at delivery','Residential pickup','Residential delivery','Appointment delivery','Limited access']) assert.equal(support.serviceMappingIssue(provider, [service]), null);
  }
  for (const provider of ['wwex','tql']) assert.match(support.serviceMappingIssue(provider, ['Residential delivery','Limited access']), /cannot both/);
  assert.match(support.serviceMappingIssue('tql', ['Residential pickup','Residential delivery']), /both ends/);
  assert.equal(support.serviceMappingIssue('priority1', ['Residential delivery','Limited access']), null);
});
function mothership() {
  const requests = [];
  const carrier = load('src/lib/carriers/mothership.ts', 'getMothershipRates', { process: { env: { MOTHERSHIP_SANDBOX_TOKEN: 'fixture' } }, fetch: async (_, init) => {
    requests.push(JSON.parse(init.body));
    return Response.json({ data: { id: 'fixture', rates: [{ id: 'own', price: 100, provider: 'mothership' }, { id: 'third', price: 120, provider: 'other' }] } });
  } });
  return { ...carrier, requests };
}
test('Mothership sends limitedAccess together with liftgate and telephone appointment', async () => {
  const h = mothership();
  const rates = await h.getMothershipRates({ ...input, services: ['Limited access','Liftgate at delivery','Appointment delivery'] });
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].delivery.accessorials)), ['liftgate','limitedAccess','appointment']);
  assert.equal(rates.length, 2);
});
test('Mothership digital residential appointment only returns its own compatible service', async () => {
  const h = mothership();
  const rates = await h.getMothershipRates({ ...input, services: ['Residential delivery','Limited access'] });
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].delivery.accessorials)), ['residential','limitedAccess','scheduledDelivery']);
  assert.deepEqual(Array.from(rates, r => r.providerRef.rateId), ['own']);
});
test('explicit phone appointment is preserved without conflicting digital appointment or own residential rate', async () => {
  const h = mothership();
  const rates = await h.getMothershipRates({ ...input, services: ['Residential delivery','Appointment delivery'] });
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].delivery.accessorials)), ['residential','appointment']);
  assert.deepEqual(Array.from(rates, r => r.providerRef.rateId), ['third']);
});
test('old incompatible drafts are rejected before contact checks and deposit reservation', () => {
  const safe = load('src/lib/booking-safety.ts', 'validateBooking', support);
  assert.throws(() => safe.validateBooking({ provider: 'tql', services: ['Residential pickup','Residential delivery'] }), /both ends/);
  assert.throws(() => safe.validateBooking({ provider: 'wwex', services: ['Residential delivery','Limited access'] }), /cannot both/);
  assert.throws(() => safe.validateBooking({ provider: 'priority1', services: ['Overlength freight'] }), /Overlength/);
});
function routeHarness({ role = "admin", tqlFailure = false, tqlEnabled = true } = {}) {
  const calls = [];
  const rate = provider => async () => { calls.push(provider); if (provider === 'tql' && tqlFailure) throw Object.assign(new Error('private carrier payload'), { quoteHttpStatus: 400 }); return [{ provider, price: 100, providerRef: {} }]; };
  const api = load('src/app/api/quotes/rates/route.ts', 'POST', { ...support, postalCities: {}, issueQuoteToken: () => 'fixture', requireAppSession: async () => ({ session: { customerId: 'fixture', role } }), supabaseRequest: async path => Response.json(path.startsWith('platform_settings') ? [{ wwex_enabled: true, priority1_enabled: true, tql_enabled: tqlEnabled, mothership_enabled: true }] : [{ active: true, markup_percent: 0, minimum_markup: 0 }]), mothershipRatesEnabled: () => true, getWwexRates: rate('wwex'), getPriority1Rates: rate('priority1'), getTqlRates: rate('tql'), getMothershipRates: rate('mothership') });
  return { calls, post: (services, stream, onlyProvider) => api.POST(new Request('https://fixture.invalid/api/quotes/rates', { method: 'POST', headers: { origin: 'https://fixture.invalid', accept: stream ? 'application/x-ndjson' : 'application/json' }, body: JSON.stringify({ originZip: '91710', destinationZip: '76132', readyDate: '2026-11-30', items: [{ pallets: 1, unitWeight: 500, length: 48, width: 40, height: 48 }], services, ...(onlyProvider === undefined ? {} : { onlyProvider }) }) })) };
}
test('JSON and streaming API skip incompatible providers while other providers still quote', async () => {
  for (const stream of [false,true]) {
    const h = routeHarness(), response = await h.post(['Residential delivery','Limited access'], stream);
    const data = stream ? (await response.text()).trim().split('\n').map(JSON.parse).find(e => e.type === 'result').data : await response.json();
    assert.deepEqual(h.calls.sort(), ['mothership','priority1']);
    assert.equal(data.rates.length, 2);
    assert.match(data.providerErrors.tql, /cannot both/);
    assert.match(data.providerErrors.wwex, /cannot both/);
    assert.match(data.providerNotices.wwex, /cannot both/);
  }
});
test('overlength rejection is visible even with zero rates and makes no carrier calls', async () => {
  const h = routeHarness(), response = await h.post(['Overlength freight'], false);
  const data = await response.json();
  assert.equal(response.status, 502);
  assert.match(data.error, /Overlength/);
  assert.equal(h.calls.length, 0);
});


test('isolated TQL diagnosis calls no other providers, in JSON and stream modes', async () => {
  for (const stream of [false, true]) {
    const h = routeHarness(), response = await h.post([], stream, 'tql');
    const data = stream ? (await response.text()).trim().split('\n').map(JSON.parse).find(e => e.type === 'result').data : await response.json();
    assert.deepEqual(h.calls, ['tql']); assert.equal(data.rates.length, 1);
  }
});
test('isolated diagnosis is admin-only, rejects arbitrary selectors, and respects disabled TQL', async () => {
  const customer = routeHarness({ role: 'customer' });
  assert.equal((await customer.post([], false, 'tql')).status, 403); assert.equal(customer.calls.length, 0);
  const admin = routeHarness();
  assert.equal((await admin.post([], false, 'wwex')).status, 400); assert.equal(admin.calls.length, 0);
  const disabled = routeHarness({ tqlEnabled: false });
  await disabled.post([], false, 'tql'); assert.equal(disabled.calls.length, 0);
});
test('diagnosis exposes quote HTTP status without private carrier response text', async () => {
  const h = routeHarness({ tqlFailure: true });
  const data = await (await h.post([], false, 'tql')).json();
  assert.match(data.error, /HTTP 400/); assert.doesNotMatch(data.error, /private carrier payload/);
  assert.deepEqual(h.calls, ['tql']);
});
