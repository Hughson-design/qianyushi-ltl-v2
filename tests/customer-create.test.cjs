const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

function harness({ codeTaken = false, emailTaken = false, lookupFails = false, race = false, admin = true } = {}) {
  const writes = [], authCalls = [];
  const source = stripTypeScriptTypes(fs.readFileSync('src/app/api/customers/route.ts', 'utf8').replace(/^import .*;\r?\n/gm, '')).replace(/\bexport /g, '');
  const api = vm.runInNewContext(source + ';({POST})', {
    Request, Response, Promise, NextResponse: { json: (data, init) => Response.json(data, init) },
    requireAdminSession: async () => admin ? { session: { role: 'admin' } } : { response: Response.json({ error: 'Forbidden' }, { status: 403 }) },
    supabaseConfig: () => ({ url: 'https://fixture.invalid', key: 'fixture' }),
    responseError: async () => 'Safe error',
    supabaseRequest: async (path, init) => {
      if (!init) return Response.json(lookupFails ? { message: 'secret_database_detail' } : (path.startsWith('customers?') ? codeTaken : emailTaken) ? [{ id: 'existing' }] : [], { status: lookupFails ? 503 : 200 });
      writes.push({ path, body: JSON.parse(init.body) });
      if (path === 'customers') return race ? Response.json({ code: '23505', message: 'private_constraint_details' }, { status: 409 }) : Response.json([{ id: 'new-customer' }], { status: 201 });
      return Response.json({}, { status: 201 });
    },
    fetch: async (url, init) => { authCalls.push({ url, body: JSON.parse(init.body) }); return Response.json({ id: 'new-user' }, { status: 201 }); },
  });
  return { writes, authCalls, post: (extra = {}) => api.POST(new Request('https://site/api/customers', { method: 'POST', body: JSON.stringify({ name: 'Fixture', code: 'test', email: 'fixture@example.com', userName: 'Fixture User', password: 'fixture-pass-123', ...extra }) })) };
}

test('duplicate code and email are both explained before creating customer, deposit or auth user', async () => {
  const h = harness({ codeTaken: true, emailTaken: true }); const r = await h.post(), body = await r.json();
  assert.equal(r.status, 409); assert.match(body.error, /客户代码已被使用/); assert.match(body.error, /邮箱已绑定/);
  assert.equal(h.writes.length, 0); assert.equal(h.authCalls.length, 0);
});
test('email conflict alone cannot leave a new customer behind; failed checks also stop writes', async () => {
  for (const options of [{ emailTaken: true }, { lookupFails: true }, { admin: false }]) {
    const h = harness(options), r = await h.post(); assert.ok([403, 409, 503].includes(r.status));
    assert.equal(h.writes.length, 0); assert.equal(h.authCalls.length, 0);
    assert.ok(!JSON.stringify(await r.json()).includes('secret_database_detail'));
  }
});
test('race-time uniqueness failure has a safe actionable message', async () => {
  const h = harness({ race: true }), r = await h.post(), body = await r.json();
  assert.equal(r.status, 409); assert.match(body.error, /客户代码/); assert.ok(!body.error.includes('private_constraint'));
  assert.equal(h.writes.length, 1); assert.equal(h.authCalls.length, 0);
});
test('unique identifiers create the requested customer and optional login; empty email creates only customer', async () => {
  const h = harness(), r = await h.post(); assert.equal(r.status, 201);
  assert.deepEqual(h.writes.map(w => w.path), ['customers', 'deposit_accounts', 'app_users']); assert.equal(h.authCalls.length, 1);
  const noUser = harness(), without = await noUser.post({ email: '', userName: '', password: '' });
  assert.equal(without.status, 201); assert.equal(noUser.authCalls.length, 0); assert.equal(noUser.writes.length, 2);
});
