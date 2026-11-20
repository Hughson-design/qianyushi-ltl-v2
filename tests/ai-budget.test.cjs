const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const quota = { day: '2026-11-20', used: 0, reserved: 0, limit: 200000, remaining: 200000, blocked: false, resetAt: '2026-11-21T00:00:00Z' };
function harness(handler) {
  const source = stripTypeScriptTypes(fs.readFileSync('src/lib/ai-budget.ts','utf8').replace(/^import .*;\r?\n/gm,'')).replace(/\bexport /g,'');
  return vm.runInNewContext(source + ';({getReaderQuota,reserveReaderTokens,settleReaderTokens})', { Date, randomUUID: () => 'fixture-id', supabaseRpc: handler });
}
test('AI quota RPCs use a server ticket and preserve unknown usage as null', async () => {
  const calls=[];
  const api=harness(async(name,body)=>{calls.push({name,body}); return Response.json(name==='reserve_reader_ai_tokens'?{allowed:true,id:body.p_id,quota}:quota);});
  assert.equal((await api.getReaderQuota()).limit,200000);
  assert.equal((await api.reserveReaderTokens(7512)).id,'fixture-id');
  await api.settleReaderTokens('fixture-id',null);
  assert.equal(calls[2].body.p_actual,null);
  assert.equal(calls[2].body.p_id,'fixture-id');
});
test('missing or inconsistent counters fail closed rather than assuming a free balance', async () => {
  const missing=harness(async()=>new Response(null,{status:404}));
  await assert.rejects(missing.getReaderQuota());
  const invalid=harness(async()=>Response.json({...quota,remaining:250000}));
  await assert.rejects(invalid.getReaderQuota());
  const wrongId=harness(async()=>Response.json({allowed:true,id:'other-ticket',quota}));
  await assert.rejects(wrongId.reserveReaderTokens(100));
  await assert.rejects(wrongId.reserveReaderTokens(-1));
});
