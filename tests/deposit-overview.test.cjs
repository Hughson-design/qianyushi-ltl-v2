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

function adjustmentHarness({denied=false,selectedId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',exists=true,rpcOk=true}={}){
 const calls=[],mutations=[];
 const source=stripTypeScriptTypes(fs.readFileSync('src/app/api/deposit/route.ts','utf8').replace(/^import .*;\r?\n/gm,'')).replace(/\bexport /g,'');
 const api=vm.runInNewContext(source+';({POST})',{Request,Response,URL,Number,NextResponse:{json:(b,o)=>Response.json(b,o)},requireAdminSession:async()=>denied?{response:Response.json({error:'Denied'},{status:403})}:{session:{customerId:selectedId,userId:'server-admin'}},supabaseRequest:async path=>{calls.push(path);return Response.json(exists?[{id,name:'Reviewed customer'}]:[]);},supabaseRpc:async(name,body)=>{mutations.push({name,body});return Response.json(rpcOk?1234.56:{message:'Adjustment would make the deposit balance negative'},{status:rpcOk?200:400});},responseError:async r=>(await r.json()).message});
 return {calls,mutations,post:(body={customerId:id,amount:'100.25',reason:'Wire transfer reference'},origin='https://site')=>api.POST(new Request('https://site/api/deposit',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}))};
}
test('adjustment targets reviewed customer rather than selected workspace and records server actor',async()=>{
 const h=adjustmentHarness();const response=await h.post(),data=await response.json();assert.equal(response.status,200);assert.equal(data.customerId,id);assert.equal(h.mutations[0].body.p_customer_id,id);assert.equal(h.mutations[0].body.p_actor_user_id,'server-admin');assert.equal(h.mutations[0].body.p_amount,100.25);assert.match(h.calls[0],new RegExp('id=eq.'+id));assert.equal(response.headers.get('cache-control'),'no-store');
});
test('non-admin and foreign-origin adjustment attempts cannot access or mutate deposits',async()=>{
 for(const h of [adjustmentHarness({denied:true}),adjustmentHarness()]){const r=await h.post(undefined,'https://evil.test');assert.equal(r.status,403);assert.equal(h.calls.length,0);assert.equal(h.mutations.length,0);}
});
test('invalid explicit customer never falls back to current workspace; amount and reason validation precede mutation',async()=>{
 const h=adjustmentHarness();for(const body of [{customerId:'',amount:100,reason:'Valid reason'},{customerId:'bad',amount:100,reason:'Valid reason'},{customerId:id,amount:'1.001',reason:'Valid reason'},{customerId:id,amount:0,reason:'Valid reason'},{customerId:id,amount:'1e3',reason:'Valid reason'},{customerId:id,amount:100,reason:' '},{customerId:id,amount:100,reason:'x'.repeat(1001)}])assert.equal((await h.post(body)).status,400);assert.equal(h.calls.length,0);assert.equal(h.mutations.length,0);
});
test('missing customer and rejected negative adjustment do not report a successful balance change',async()=>{
 const missing=adjustmentHarness({exists:false});assert.equal((await missing.post()).status,404);assert.equal(missing.mutations.length,0);
 const negative=adjustmentHarness({rpcOk:false});assert.equal((await negative.post({customerId:id,amount:'-100',reason:'Correction reference'})).status,409);assert.equal(negative.mutations[0].body.p_amount,-100);
});
