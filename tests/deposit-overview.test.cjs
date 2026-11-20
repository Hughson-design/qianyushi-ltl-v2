const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const {stripTypeScriptTypes}=require('node:module');
const id='12345678-1234-1234-1234-123456789abc';
function load(path,{denied=false,handler=async()=>Response.json([])}={}){
 const calls=[];const source=stripTypeScriptTypes(fs.readFileSync(path,'utf8').replace(/^import .*;\r?\n/gm,'')).replace(/\bexport /g,'');
 const api=vm.runInNewContext(source+';({GET})',{Request,Response,URL,Date,NextResponse:{json:(b,o)=>Response.json(b,o)},requireAdminSession:async()=>denied?{response:Response.json({error:'Administrator required'},{status:403})}:{session:{role:'admin',customerId:'another-workspace'}},supabaseRequest:async path=>{calls.push(path);return handler(path);}});
 return {calls,get:(url='https://site/api/deposit/customers')=>api.GET(new Request(url),{params:Promise.resolve({id})})};
}
const overview='src/app/api/deposit/customers/route.ts',detail='src/app/api/deposit/customers/[id]/route.ts';
test('customer deposit overview and detail deny non-admin callers before accessing money data',async()=>{
 for(const path of [overview,detail]){const h=load(path,{denied:true});assert.equal((await h.get()).status,403);assert.equal(h.calls.length,0);}
});
test('latest payment is scoped per customer and excludes refunds and releases; empty accounts stay distinct from zero',async()=>{
 const h=load(overview,{handler:async()=>Response.json([
  {id,name:'One',code:'ONE',active:true,deposit_accounts:[{available_balance:'120.25'}],latest_payment:[{amount:'500',created_at:'2026-11-20T12:00:00Z'}]},
  {id:'second',name:'Two',code:'TWO',active:true,deposit_accounts:{available_balance:0},latest_payment:[]},
  {id:'third',name:'Three',code:'THREE',active:false,deposit_accounts:null,latest_payment:null}
 ])});const response=await h.get(),data=await response.json();
 assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(data.customers[0].lastDepositAmount,500);assert.equal(data.customers[0].availableBalance,120.25);assert.equal(data.customers[1].availableBalance,0);assert.equal(data.customers[1].lastDepositAmount,null);assert.equal(data.customers[2].availableBalance,null);
 const query=h.calls[0];assert.match(query,/latest_payment.transaction_type=eq.DEPOSIT/);assert.match(query,/latest_payment.amount=gt.0/);assert.match(query,/latest_payment.limit=1/);assert.match(query,/latest_payment.order=created_at.desc,id.desc/);
});
test('overview paginates all customers, safely encodes search and rejects invalid offsets',async()=>{
 const h=load(overview,{handler:async()=>Response.json(Array.from({length:51},(_,i)=>({id:String(i),name:'Fixture',deposit_accounts:[],latest_payment:[]})))});
 const data=await(await h.get('https://site/api/deposit/customers?offset=50&search=Acme%22%2Cactive.eq.false')).json();assert.equal(data.customers.length,50);assert.equal(data.nextOffset,100);assert.match(h.calls[0],/offset=50&limit=51/);assert.ok(h.calls[0].includes('%5C%22'));
 const bad=load(overview);assert.equal((await bad.get('https://site/api/deposit/customers?offset=-1')).status,400);assert.equal(bad.calls.length,0);
});
test('detail uses explicit validated customer ownership, never the admin selected workspace, and paginates complete activity',async()=>{
 const h=load(detail,{handler:async path=>Response.json(path.startsWith('customers?')?[{id,name:'Actual customer',code:'OWNER'}]:path.startsWith('deposit_accounts?')?[{available_balance:'750'}]:Array.from({length:51},(_,i)=>({id:String(i),amount:i,transaction_type:'BOL_RESERVE'})))});
 const response=await h.get('https://site/api/deposit/customers/'+id+'?offset=50'),data=await response.json();assert.equal(data.customer.id,id);assert.equal(data.availableBalance,750);assert.equal(data.records.length,50);assert.equal(data.nextOffset,100);
 for(const path of h.calls.slice(1)){assert.ok(path.includes('customer_id=eq.'+id));assert.ok(!path.includes('another-workspace'));}
 assert.match(h.calls[2],/order=created_at.desc,id.desc&offset=50&limit=51/);assert.equal(response.headers.get('cache-control'),'no-store');
});
test('missing customer and database failures never invent zero balances or expose database details',async()=>{
 const missing=load(detail);assert.equal((await missing.get()).status,404);assert.equal(missing.calls.length,1);
 for(const path of [overview,detail]){const h=load(path,{handler:async()=>Response.json({message:'secret_table.column failed'},{status:500})});const r=await h.get();assert.equal(r.status,503);assert.ok(!(await r.text()).includes('secret_table'));}
});
