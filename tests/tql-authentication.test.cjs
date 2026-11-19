const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
function load(path, names, globals) {
  const code = stripTypeScriptTypes(fs.readFileSync(path, 'utf8').replace(/^import .*;\r?\n/gm, '')).replace(/\bexport /g, '');
  return vm.runInNewContext(code + '\n;({' + names.join(',') + '})', { URL, URLSearchParams, Response, AbortSignal, Date, ...globals });
}
const credentials = { TQL_SUBSCRIPTION_KEY: 'fixture-key', TQL_CLIENT_ID: 'fixture-id', TQL_USERNAME: 'fixture-user', TQL_PASSWORD: 'fixture-password', TQL_SCOPE: 'fixture-scope' };
function carrier(overrides = {}, response = { access_token: 'fixture-token', expires_in: 3600 }, status = 200) {
  const calls = [];
  const api = load('src/lib/carriers/tql.ts', ['testTqlAuthentication', 'getToken', 'tqlConnectionStatus'], {
    process: { env: { ...credentials, ...overrides } },
    fetch: async (url, init) => { calls.push({ url, init }); return Response.json(response, { status }); },
  });
  return { ...api, calls };
}
test('public client requests a token without secret, quote, shipment or carrier calls', async () => {
  const api = carrier({ TQL_AUTH_MODE: 'public', TQL_CLIENT_SECRET: 'stale-secret' });
  const result = await api.testTqlAuthentication();
  assert.equal(result.authenticated, true); assert.equal(result.mode, 'public');
  assert.equal(JSON.stringify(result).includes('fixture-token'), false);
  assert.equal(api.calls.length, 1);
  const { url, init } = api.calls[0];
  assert.equal(url, 'https://public.api.tql.com/identity/token');
  assert.equal(init.body.get('grant_type'), 'password');
  assert.equal(init.body.get('client_id'), 'fixture-id');
  assert.equal(init.body.has('client_secret'), false);
  assert.equal(init.body.get('username'), 'fixture-user');
  assert.equal(init.headers['Ocp-Apim-Subscription-Key'], 'fixture-key');
  assert.ok(init.signal); assert.equal(init.cache, 'no-store');
  await api.getToken(); assert.equal(api.calls.length, 1, 'normal callers reuse cached token');
});
test('legacy clients retain their independently supplied secret', async () => {
  const missing = carrier({ TQL_AUTH_MODE: 'legacy' });
  await assert.rejects(missing.testTqlAuthentication(), /TQL_CLIENT_SECRET/); assert.equal(missing.calls.length, 0);
  const api = carrier({ TQL_CLIENT_SECRET: 'legacy-secret' });
  assert.equal((await api.testTqlAuthentication()).mode, 'legacy');
  assert.equal(api.calls[0].init.body.get('client_secret'), 'legacy-secret');
});
test('accepts camel-case token fields and JSON envelopes without exposing token values', async () => {
  for (const payload of [{ accessToken: 'fixture-token', expiresIn: 1800 }, { content: { access_token: 'fixture-token' } }, { data: { token: 'fixture-token' } }]) {
    const api = carrier({ TQL_AUTH_MODE: 'public' }, payload);
    assert.equal((await api.testTqlAuthentication()).authenticated, true);
    assert.equal(await api.getToken(), 'fixture-token');
  }
  const error = carrier({}, { content: { error_description: 'fixture-password' } });
  await assert.rejects(error.testTqlAuthentication(), (failure) => /root: content/.test(failure.message) && /error_description/.test(failure.message) && !/fixture-password/.test(failure.message));
});
test('missing credentials, invalid mode and non-TQL destinations fail before transmitting credentials', async () => {
  for (const env of [{ TQL_PASSWORD: '' }, { TQL_AUTH_MODE: 'unknown' }, { TQL_AUTH_URL: 'https://other.example/token' }]) {
    const api = carrier(env); await assert.rejects(api.testTqlAuthentication()); assert.equal(api.calls.length, 0);
  }
});
test('provider authentication errors do not expose returned secrets or tokens', async () => {
  const api = carrier({}, { error_description: 'fixture-password fixture-key fixture-token' }, 401);
  await assert.rejects(api.testTqlAuthentication(), (error) => /HTTP 401/.test(error.message) && !/fixture/.test(error.message));
});
function endpoint({ authorized = true, missing = [], reject = false } = {}) {
  let attempts = 0;
  const api = load('src/app/api/settings/tql/test/route.ts', ['POST'], {
    NextResponse: { json: (value, options) => Response.json(value, options) },
    requireAdminSession: async () => authorized ? { session: { userId: 'fixture-admin' } } : { response: Response.json({}, { status: 403 }) },
    tqlConnectionStatus: () => ({ mode: 'public', missing }),
    testTqlAuthentication: async () => { attempts++; if (reject) throw new Error('internal-secret'); return { authenticated: true, mode: 'public' }; },
  });
  return { ...api, attempts: () => attempts };
}
const request = (origin = 'https://ltl.example') => new Request('https://ltl.example/api/settings/tql/test', { method: 'POST', headers: { origin } });
test('admin-only endpoint checks origin and missing configuration before calling TQL', async () => {
  const denied = endpoint({ authorized: false }); assert.equal((await denied.POST(request())).status, 403); assert.equal(denied.attempts(), 0);
  const cross = endpoint(); assert.equal((await cross.POST(request('https://other.example'))).status, 403); assert.equal(cross.attempts(), 0);
  const incomplete = endpoint({ missing: ['TQL_PASSWORD'] }); const result = await incomplete.POST(request());
  assert.equal(result.status, 503); assert.equal((await result.json()).missing[0], 'TQL_PASSWORD'); assert.equal(incomplete.attempts(), 0);
});
test('test endpoint throttles retries and redacts unexpected failures', async () => {
  const app = endpoint(); const result = await app.POST(request());
  assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal((await app.POST(request())).status, 429); assert.equal(app.attempts(), 1);
  const failure = await endpoint({ reject: true }).POST(request());
  assert.equal(failure.status, 502); assert.equal((await failure.text()).includes('internal-secret'), false);
});
