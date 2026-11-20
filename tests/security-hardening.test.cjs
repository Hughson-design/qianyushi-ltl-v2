const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { stripTypeScriptTypes } = require('node:module');
function load(path, names, globals = {}) {
  const source = stripTypeScriptTypes(fs.readFileSync(path, 'utf8').replace(/^import .*;\r?\n/gm, '')).replace(/\bexport /g, '');
  return vm.runInNewContext(source + '\n;({' + names.join(',') + '})', { console, Buffer, Request, Response, URL, URLSearchParams, AbortSignal, Date, process: { env: {} }, ...globals });
}
const bookingErrors = load('src/lib/booking-errors.ts', ['NoShipmentSubmissionError','beforeShipmentSubmission','isNoShipmentSubmissionError','isTqlValidationRejection']);
const safe = load('src/lib/booking-safety.ts', ['bookingParty', 'validateBooking', 'priority1BookingReference'], { formatPhoneNumber: s => s });
const id = '12345678-1234-1234-1234-123456789abc';
const party = { company: 'Test', contact: 'Test', country: 'United States', address1: '1 Test St', address2: '', zip: '90670', state: 'CA', city: 'Test', phone: '5572145975', extension: '', email: 'test@example.com' };
test('booking contacts enforce required fields, lengths, ten digits, and discard injected fields', () => {
  const value = safe.bookingParty({ ...party, customer_id: 'other', price: 1 });
  assert.equal(value.customer_id, undefined); assert.equal(value.price, undefined);
  for (const override of [{ contact: '' }, { phone: '15572145975' }, { address1: 'x'.repeat(101) }, { state: 'California' }, { email: 'bad' }]) assert.throws(() => safe.bookingParty({ ...party, ...override }));
});
test('Priority1 recovery uses full unique quote ID, never customer PO or a truncated prefix', async () => {
  const one = safe.priority1BookingReference(id), two = safe.priority1BookingReference('12345678-1234-1234-1234-123456789abd');
  assert.equal(one.length, 35); assert.notEqual(one, two);
  for (const matching of [false, true]) {
    const calls = [];
    const carrier = load('src/lib/carriers/priority1.ts', ['dispatchPriority1Shipment'], {
      priority1BookingReference: safe.priority1BookingReference, ...bookingErrors,
      process: { env: { PRIORITY1_API_BASE: 'https://example.test', PRIORITY1_API_KEY: 'fixture' } },
      fetch: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return Response.json({ shipments: [{ id: 'provider-id', shipmentIdentifiers: [{ type: 'CUSTOMER_REFERENCE', value: matching ? one : 'shared-po' }, { type: 'BILL_OF_LADING', value: 'bol' }, { type: 'PICKUP', value: 'pickup' }] }] }); },
    });
    const request = carrier.dispatchPriority1Shipment({ id, reference: 'shared-po', freight_items: [] }, true);
    if (matching) assert.equal((await request).bolNumber, 'bol'); else await assert.rejects(request);
    assert.equal(calls.length, 1); assert.equal(calls[0].body.identifierValue, one);
    assert.equal(calls[0].url.includes('/dispatch'), false);
  }
});
function bolHarness({ role = 'admin', canSelfBook = true, status = 'draft', version = 2, expires = Date.now() + 60000, fail = false, invalid = false, proof = true, noSubmit = false, releaseFails = false } = {}) {
  const calls = [], dispatches = [];
  const quote = { id, customer_id: "owner-customer", status, provider: 'priority1', provider_ref: { bookingVersion: version, offerExpiresAt: expires, shipmentProof: 'proof' } };
  const route = load('src/app/api/quotes/[id]/bol/route.ts', ['POST'], {
    NextResponse: { json: (body, options) => Response.json(body, options) },
    requireAppSession: async () => ({ session: { customerId: 'customer', userId: 'user', role, canSelfBook } }), customerFilter: () => '&customer_id=eq.customer',
    isNoShipmentSubmissionError: bookingErrors.isNoShipmentSubmissionError, verifyShipmentProof: (_proof, _id, owner) => { assert.equal(owner, 'owner-customer'); return proof; }, validateBooking: () => { if (invalid) throw Error('Invalid contact'); },
    supabaseRequest: async () => Response.json([quote]),
    supabaseRpc: async (name) => { calls.push(name); if (name === "release_unsubmitted_booking") return Response.json({ released: true }, { status: releaseFails ? 503 : 200 }); return Response.json(true); },
    dispatchPriority1Shipment: async (value, only) => { dispatches.push(only); if (noSubmit) throw new bookingErrors.NoShipmentSubmissionError('Carrier lookup failed before dispatch'); if (fail) throw Error('Secret provider data'); return { shipmentId: 'provider', bolNumber: 'bol' }; },
  });
  return { calls, dispatches, post: (reconcile = false) => route.POST(new Request('https://test/api/quotes/' + id + '/bol' + (reconcile ? '?reconcile=true' : ''), { method: 'POST' }), { params: Promise.resolve({ id }) }) };
}
test('expired, legacy, invalid, and unauthorized bookings never reserve or contact the carrier', async () => {
  for (const options of [{ expires: 1 }, { version: 1 }, { invalid: true }, { proof: false }, { canSelfBook: false }, { status: 'booking' }]) {
    const h = bolHarness(options); assert.ok((await h.post()).status >= 400); assert.equal(h.calls.length, 0); assert.equal(h.dispatches.length, 0);
  }
});
test('timeouts, malformed responses and missing BOL keep reservation and do not refund or finalize', async () => {
  const h = bolHarness({ fail: true }); const response = await h.post();
  assert.equal(response.status, 409); const data = await response.json();
  assert.equal(data.reconciliationRequired, true); assert.equal(JSON.stringify(data).includes('Secret'), false);
  assert.deepEqual(h.calls, ['reserve_quote_for_bol']);
});
test('positive no-submission evidence releases through the audited RPC, but failed release stays pending', async () => {
  const h = bolHarness({ noSubmit: true });
  const response = await h.post(); assert.equal(response.status, 422);
  assert.equal((await response.json()).reservationReleased, true);
  assert.deepEqual(h.calls, ['reserve_quote_for_bol','release_unsubmitted_booking']);
  const failed = bolHarness({ noSubmit: true, releaseFails: true });
  assert.equal((await failed.post()).status, 409);
  const reconciling = bolHarness({ status: 'booking', noSubmit: true });
  assert.equal((await reconciling.post(true)).status, 409); assert.deepEqual(reconciling.calls, []);
});
test('reconciliation is admin-only, read-only at the carrier, and never reserves twice even after expiry', async () => {
  const h = bolHarness({ status: 'booking', expires: 1 }); assert.equal((await h.post(true)).status, 200);
  assert.deepEqual(h.calls, ['complete_quote_bol']); assert.deepEqual(h.dispatches, [true]);
  const denied = bolHarness({ status: 'booking', role: 'customer_admin' }); assert.equal((await denied.post(true)).status, 403); assert.equal(denied.dispatches.length, 0);
});
test('void is denied for customers without booking permission before any carrier or refund request', async () => {
  const route = load('src/app/api/quotes/[id]/void/route.ts', ['POST'], { NextResponse: { json: (body, options) => Response.json(body, options) }, requireAppSession: async () => ({ session: { canSelfBook: false } }), supabaseRequest: () => { throw Error('must not access records'); } });
  assert.equal((await route.POST(new Request('https://test/void', { method: 'POST' }), { params: Promise.resolve({ id }) })).status, 403);
});
test('saved proof binds expiry, customer and quote, and independent key survives Supabase key rotation', () => {
  const env = { QUOTE_SIGNING_KEY: 'independent-fixture-key', SUPABASE_SECRET_KEY: 'old' };
  const integrity = load('src/lib/quote-integrity.ts', ['shipmentProof', 'verifyShipmentProof'], { ...crypto, process: { env } });
  const proof = integrity.shipmentProof(id, 'customer', 123);
  env.SUPABASE_SECRET_KEY = 'new';
  assert.equal(integrity.verifyShipmentProof(proof, id, 'customer', 123), true);
  assert.equal(integrity.verifyShipmentProof(proof, id, 'customer', 124), false);
  assert.equal(integrity.verifyShipmentProof(proof, id, 'other', 123), false);
});
test('initial independent signing key rollout can verify existing in-flight proofs', () => {
  const env = { SUPABASE_SECRET_KEY: 'legacy-fixture' };
  const api = load('src/lib/quote-integrity.ts', ['shipmentProof', 'verifyShipmentProof'], { ...crypto, process: { env } });
  const proof = api.shipmentProof(id, 'customer', 123);
  env.QUOTE_SIGNING_KEY = 'new-independent-fixture';
  assert.equal(api.verifyShipmentProof(proof, id, 'customer', 123), true);
});
test('settings GET hides platform pricing and carrier switches from ordinary customers', async () => {
  const api = load('src/app/api/settings/route.ts', ['GET'], {
    NextResponse: { json: (body, options) => Response.json(body, options) },
    requireAppSession: async () => ({ session: { role: 'customer' } }),
    supabaseRequest: async () => Response.json([{ company_name: 'Test', markup_percent: 25, minimum_markup: 10, tql_enabled: true }]),
  });
  const response = await api.GET(), data = await response.json();
  assert.equal(data.settings.company_name, 'Test'); assert.equal(data.settings.markup_percent, undefined); assert.equal(data.settings.minimum_markup, undefined); assert.equal(data.settings.tql_enabled, undefined);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
function authHarness({ active = true, expired = true } = {}) {
  const userId = id, sessionId = '12345678-1234-1234-1234-123456789abd';
  const jwt = 'header.' + Buffer.from(JSON.stringify({ sub: userId, session_id: sessionId })).toString('base64url') + '.signature';
  const jar = new Map([['ltl_access_token', expired ? 'expired' : jwt], ['ltl_refresh_token', 'fixture-refresh']]); const calls = [];
  const store = { get: key => jar.has(key) ? { value: jar.get(key) } : undefined, set: (key, value) => jar.set(key, value), delete: key => jar.delete(key) };
  const api = load('src/lib/auth-server.ts', ['getAppSession', 'signOutSession'], {
    cookies: async () => store, process: { env: { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'fixture' } },
    supabaseConfig: () => ({ url: 'https://test' }),
    supabaseRequest: async (path, init) => { calls.push({ path, init }); if (init?.method === 'PATCH') return Response.json([]); return path.includes('select=user_id&') ? Response.json([{ user_id: userId }]) : Response.json([{ user_id: userId, customer_id: 'customer', active: true, role: 'customer', active_session_id: active ? sessionId : 'other-session', customers: { active: true, name: 'Customer' } }]); },
    fetch: async (url, init) => { calls.push({ url }); if (url.includes('grant_type=refresh_token')) return Response.json({ access_token: jwt, refresh_token: 'rotated' }); if (url.includes('/logout')) return new Response(null, { status: 204 }); return init.headers.Authorization === 'Bearer expired' ? Response.json({}, { status: 401 }) : Response.json({ id: userId }); },
  }); return { ...api, calls, jar };
}
test('expired sessions refresh only if still the active login, without reactivating displaced sessions', async () => {
  const h = authHarness(); assert.equal((await h.getAppSession()).userId, id); assert.equal(h.jar.get('ltl_refresh_token'), 'rotated');
  assert.equal(h.calls.some(c => c.init?.method === 'PATCH'), false);
  const displaced = authHarness({ active: false }); assert.equal(await displaced.getAppSession(), null); assert.equal(displaced.jar.get('ltl_access_token'), 'expired');
});
test('sign-out compares session ID before clearing it and revokes only its own Supabase session', async () => {
  const h = authHarness({ expired: false }); await h.signOutSession();
  assert.equal(h.jar.size, 0); assert.ok(h.calls.some(c => c.path?.includes('active_session_id=eq.'))); assert.ok(h.calls.some(c => c.url?.includes('logout?scope=local')));
});
test('sign-out also ends an expired access session after a safe refresh', async () => {
  const h = authHarness(); await h.signOutSession();
  assert.equal(h.jar.size, 0); assert.ok(h.calls.some(c => c.path?.includes('active_session_id=eq.')));
});
test('login throttle stores keyed hashes and fails closed when distributed protection is unavailable', async () => {
  let posted;
  const api = load('src/lib/login-throttle.ts', ['permitLogin'], { ...crypto, process: { env: { SUPABASE_SECRET_KEY: 'fixture', VERCEL: '1' } }, supabaseRpc: async (name, body) => { posted = { name, body }; return Response.json(true); } });
  assert.equal(await api.permitLogin(new Request('https://test/login', { headers: { 'x-forwarded-for': '192.0.2.1' } }), 'user@example.com'), true);
  assert.equal(posted.name, 'consume_login_attempt');
  assert.equal(JSON.stringify(posted).includes('192.0.2.1'), false); assert.equal(JSON.stringify(posted).includes('user@example.com'), false);
  assert.match(posted.body.p_ip_key, /^[0-9a-f]{64}$/);
  const down = load('src/lib/login-throttle.ts', ['permitLogin'], { ...crypto, process: { env: { SUPABASE_SECRET_KEY: 'fixture' } }, supabaseRpc: async () => new Response(null, { status: 404 }) });
  await assert.rejects(down.permitLogin(new Request('https://test/login'), 'user@example.com'), /unavailable/);
});
test('database errors are redacted except approved business errors', async () => {
  const api = load('src/lib/supabase-server.ts', ['responseError']);
  assert.equal(await api.responseError(Response.json({ message: 'secret_table.column failed' }), 'Safe fallback'), 'Safe fallback');
  assert.equal(await api.responseError(Response.json({ message: 'Insufficient deposit balance' }), 'Safe fallback'), 'Insufficient deposit balance');
});
test('TQL lookup failures and read-only reconciliation never call tender', async () => {
  for (const status of [200, 500]) {
    const calls = [];
    const api = load('src/lib/carriers/tql.ts', ['dispatchTqlShipment'], { ...bookingErrors,
      process: { env: { TQL_CLIENT_ID: 'fixture', TQL_SUBSCRIPTION_KEY: 'fixture', TQL_USERNAME: 'fixture', TQL_PASSWORD: 'fixture', TQL_SCOPE: 'fixture' } },
      fetch: async url => { calls.push(url); return url.endsWith('/token') ? Response.json({ access_token: 'fixture' }) : Response.json({ content: {} }, { status }); },
    });
    await assert.rejects(api.dispatchTqlShipment({ freight_items: [], provider_ref: { quoteId: 1, carrierPriceId: 2 } }, true));
    assert.equal(calls.some(url => url.endsWith('/tender')), false);
  }
});
test('WWEX lookup failure or missing pickup cannot be recovered as a complete shipment', async () => {
  for (const status of [200, 500]) {
    const calls = [];
    const api = load('src/lib/carriers/wwex.ts', ['dispatchWwexShipment'], { ...bookingErrors,
      process: { env: { WWEX_AUTH_URL: 'https://fixture/token', WWEX_API_BASE: 'https://fixture', WWEX_CLIENT_ID: 'fixture', WWEX_CLIENT_SECRET: 'fixture', WWEX_AUDIENCE: 'fixture' } },
      fetch: async url => { calls.push(url); return url.endsWith('/token') ? Response.json({ access_token: 'fixture' }) : url.endsWith('/documentDownloadFlow') ? Response.json({ response: { securedLinks: ['https://fixture/NUD123.pdf'] } }, { status }) : Response.json({ response: { documentList: [] } }); },
    });
    await assert.rejects(api.dispatchWwexShipment({ id, freight_items: [], provider_ref: { productTransactionId: 'own', offerId: 'own' } }, true));
    assert.equal(calls.some(url => url.endsWith('/quoteOrderFlow')), false);
  }
});

test('Priority1 preflight failure is releasable, partial matching shipment is not', async () => {
  for (const partial of [false,true]) {
    const api=load('src/lib/carriers/priority1.ts',['dispatchPriority1Shipment'],{
      ...bookingErrors,priority1BookingReference:safe.priority1BookingReference,
      process:{env:{PRIORITY1_API_BASE:'https://fixture',PRIORITY1_API_KEY:'fixture'}},
      fetch:async url=>{assert.ok(!url.includes('/dispatch'));return partial?Response.json({shipments:[{id:'existing',shipmentIdentifiers:[{type:'CUSTOMER_REFERENCE',value:safe.priority1BookingReference(id)}]}]}):new Response(null,{status:500});}
    });
    await assert.rejects(api.dispatchPriority1Shipment({id,freight_items:[]}),e=>bookingErrors.isNoShipmentSubmissionError(e)===!partial);
  }
});
test('TQL auto-release needs structured rejection and a successful matching no-PO follow-up',async()=>{
  for(const mode of ['validated','bare400','lookup500','existingPO','wrongQuote','missingPO','tenderedWithoutPO']){
    let lookups=0,tenders=0;
    const api=load('src/lib/carriers/tql.ts',['dispatchTqlShipment'],{
      ...bookingErrors,process:{env:{TQL_CLIENT_ID:'fixture',TQL_SUBSCRIPTION_KEY:'fixture',TQL_USERNAME:'fixture',TQL_PASSWORD:'fixture',TQL_SCOPE:'fixture'}},
      fetch:async url=>{
        if(url.endsWith('/token'))return Response.json({access_token:'fixture'});
        if(url.endsWith('/tender')){tenders++;return Response.json(mode==='bare400'?{}:{statusCode:400,content:{errors:['Invalid address']}},{status:400});}
        lookups++;
        if(lookups>1&&mode==='lookup500')return new Response(null,{status:500});
        return Response.json({content:{quoteId:lookups>1&&mode==='wrongQuote'?999:1,...(lookups>1&&mode==='missingPO'?{}:{poNumber:lookups>1&&mode==='existingPO'?123:null}),tenderedDate:lookups>1&&mode==='tenderedWithoutPO'?'2026-11-20':null}});
      }
    });
    await assert.rejects(api.dispatchTqlShipment({freight_items:[],provider_ref:{quoteId:1,carrierPriceId:2},sender:{...party},receiver:{...party},reference:'fixture',pickup_ready_time:'08:00',pickup_close_time:'17:00'}),e=>bookingErrors.isNoShipmentSubmissionError(e)===(mode==='validated'));
    assert.equal(tenders,1);assert.equal(lookups,mode==='bare400'?1:2);
  }
});
function releaseHarness({denied=false,quoteOverride={}}={}){
  const calls=[];
  const quote={id,customer_id:'actual-owner',quote_number:'TEST',reference:'PO',price:123,status:'booking',updated_at:new Date(Date.now()-600001).toISOString(),...quoteOverride};
  const api=load('src/app/api/quotes/[id]/release/route.ts',['GET','POST'],{
    NextResponse:{json:(b,o)=>Response.json(b,o)},
    requireAdminSession:async()=>denied?{response:Response.json({error:'Denied'},{status:403})}:{session:{userId:'actual-admin',customerId:'different-workspace'}},
    supabaseRequest:async path=>Response.json(path.startsWith('saved_quotes')?[quote]:path.startsWith('customers')?[{name:'Actual owner'}]:[]),
    supabaseRpc:async(name,body)=>{calls.push({name,body});return Response.json({released:true,amount:123,status:'draft'});}
  });
  return {calls,get:()=>api.GET(new Request('https://fixture/release'),{params:Promise.resolve({id})}),post:(body={reason:'Carrier support confirmed no shipment',confirmedNoShipment:true},origin='https://fixture')=>api.POST(new Request('https://fixture/release',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}),{params:Promise.resolve({id})})};
}
test('manual release requires admin, origin, confirmation, reason, cooldown and no shipment identifiers',async()=>{
  const denied=releaseHarness({denied:true});assert.equal((await denied.get()).status,403);assert.equal((await denied.post()).status,403);
  const h=releaseHarness();assert.equal((await h.post(undefined,'https://evil.test')).status,403);
  for(const body of [{reason:'Too short',confirmedNoShipment:true},{reason:'A sufficient audit reason',confirmedNoShipment:false}])assert.equal((await h.post(body)).status,400);
  for(const quoteOverride of [{status:'booked'},{bol_number:'BOL'},{provider_shipment_id:'existing'},{updated_at:new Date().toISOString()}]){
    const guarded=releaseHarness({quoteOverride});assert.equal((await guarded.post()).status,409);assert.equal(guarded.calls.length,0);
  }
  assert.equal(h.calls.length,0);
  assert.equal((await h.post({reason:'Confirmed in carrier portal, no shipment exists',confirmedNoShipment:true,p_customer_id:'spoof',amount:99999})).status,200);
  assert.equal(h.calls[0].body.p_customer_id,'actual-owner');assert.equal(h.calls[0].body.p_actor_user_id,'actual-admin');assert.equal(h.calls[0].body.amount,undefined);
  assert.equal((await (await h.get()).json()).quote.customerName,'Actual owner');
});
