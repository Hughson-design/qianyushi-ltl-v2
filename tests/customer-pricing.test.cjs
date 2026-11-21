const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const {stripTypeScriptTypes}=require('node:module');
function load(path,names,globals={}){const source=stripTypeScriptTypes(fs.readFileSync(path,'utf8').replace(/^import .*;\r?\n/gm,'')).replace(/\bexport /g,'');return vm.runInNewContext(source+';({'+names.join(',')+'})',{Request,Response,URL,AbortSignal,ReadableStream,TextEncoder,Date,performance,NextResponse:class extends Response{},...globals});}
const owner='12345678-1234-1234-1234-123456789abc';
function harness({customer={active:true,markup_percent:0,minimum_markup:0},platformDown=false,customerDown=false,networkDown=false}={}){
 const carriers=[],paths=[];const rate=async()=>{carriers.push('called');return [{id:'fixture',provider:'priority1',price:100}]};
 const api=load('src/app/api/quotes/rates/route.ts',['POST','pricingSettings'],{postalCities:{},issueQuoteToken:()=> 'fixture-token',requireAppSession:async()=>({session:{customerId:owner}}),supabaseRequest:async path=>{paths.push(path);if(networkDown)throw Error('secret_table failure');if(path.startsWith('platform_settings'))return Response.json([{markup_percent:99,minimum_markup:999,wwex_enabled:true,priority1_enabled:false,tql_enabled:false,mothership_enabled:false}],{status:platformDown?500:200});return Response.json(customer?[customer]:[],{status:customerDown?500:200});},getWwexRates:rate,getPriority1Rates:rate,getTqlRates:rate,getMothershipRates:rate,mothershipRatesEnabled:()=>false});
 const body={originZip:'90670',destinationZip:'32811',readyDate:'2026-11-20',items:[{pallets:1,unitWeight:100,length:48,width:40,height:48}]};
 return {...api,carriers,paths,post:(stream=false)=>api.POST(new Request('https://site/api/quotes/rates',{method:'POST',headers:{accept:stream?'application/x-ndjson':'application/json'},body:JSON.stringify(body)}))};
}
test('customer zero pricing remains zero and never inherits legacy platform markup',async()=>{
 const h=harness();const response=await h.post(),data=await response.json();assert.equal(response.status,200);assert.equal(data.rates[0].price,100);assert.equal(h.carriers.length,1);assert.match(h.paths[1],new RegExp('id=eq.'+owner));assert.ok(!h.paths[0].includes('markup'));
 const priced=harness({customer:{active:true,markup_percent:'20',minimum_markup:'30'}});const result=await(await priced.post()).json();assert.equal(result.rates[0].price,130);
});
test('missing, inactive, invalid and unavailable customer pricing stop all carrier calls',async()=>{
 for(const options of [{customer:null},{customerDown:true},{platformDown:true},{networkDown:true},...[
  {active:false,markup_percent:10,minimum_markup:20},{active:true,markup_percent:null,minimum_markup:0},{active:true,markup_percent:'',minimum_markup:0},{active:true,markup_percent:-1,minimum_markup:0},{active:true,markup_percent:0,minimum_markup:'NaN'}
 ].map(customer=>({customer}))]){
  const h=harness(options),r=await h.post();assert.equal(r.status,503);const data=await r.json();assert.equal(data.code,'PRICING_UNAVAILABLE');assert.equal(h.carriers.length,0);assert.ok(!data.error.includes('secret_table'));
 }
});
test('streamed quote requests also pause before any carrier is contacted',async()=>{
 const h=harness({customerDown:true});const response=await h.post(true),frames=(await response.text()).trim().split('\n').map(JSON.parse);assert.equal(frames.at(-1).type,'result');assert.equal(frames.at(-1).ok,false);assert.equal(frames.at(-1).data.code,'PRICING_UNAVAILABLE');assert.match(frames.at(-1).data.error,/paused/);assert.equal(h.carriers.length,0);
});
test('settings GET and POST omit obsolete pricing fields even for administrators and ignore submitted overrides',async()=>{
 const writes=[];const api=load('src/app/api/settings/route.ts',['GET','POST'],{requireAppSession:async()=>({session:{role:'admin'}}),requireAdminSession:async()=>({session:{role:'admin'}}),supabaseRequest:async(path,init)=>{if(init)writes.push(JSON.parse(init.body));return Response.json([{company_name:'Fixture',markup_percent:99,minimum_markup:999,wwex_enabled:true}]);},responseError:async()=> 'Safe failure'});
 const get=await(await api.GET()).json();assert.equal(get.settings.markup_percent,undefined);assert.equal(get.settings.minimum_markup,undefined);assert.equal(get.settings.wwex_enabled,true);
 const post=await api.POST(new Request('https://site/api/settings',{method:'POST',body:JSON.stringify({company_name:'Fixture',markup_percent:123,minimum_markup:9999})}));assert.equal(post.status,200);const data=await post.json();assert.equal(writes[0].markup_percent,undefined);assert.equal(writes[0].minimum_markup,undefined);assert.equal(data.settings.markup_percent,undefined);assert.equal(data.settings.minimum_markup,undefined);
});
