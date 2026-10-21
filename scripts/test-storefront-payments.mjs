import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test, beforeEach } from 'node:test';
import ts from 'typescript';
import Stripe from 'stripe';
import { NextRequest } from 'next/server.js';

const require=createRequire(import.meta.url);
const account='10000000-0000-4000-8000-000000000001';
const item='20000000-0000-4000-8000-000000000001';
const id='30000000-0000-4000-8000-000000000001';
const requestId='40000000-0000-4000-8000-000000000001';
const customer={id:requestId,account_id:account,name:'Guest Customer',email:'guest@example.invalid',status:'new',
  address:{line1:'1 Test St',line2:'',city:'Test',state:'FL',postal_code:'32114',country:'US'}};
const secret='whsec_local_test_only';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});

beforeEach(()=>{
  Object.assign(process.env,{STRIPE_SECRET_KEY:'sk_test_local_only',STRIPE_WEBHOOK_SECRET:secret,STRIPE_SHIPPING_RATE_IDS:'shr_TestRate',
    STRIPE_SHIPPING_COUNTRIES:'US',STOREFRONT_SITE_URL:'http://localhost:3218',NEXT_PUBLIC_SUPABASE_URL:'https://test.invalid',
    NEXT_PUBLIC_SUPABASE_ANON_KEY:'test',SUPABASE_SERVICE_ROLE_KEY:'test-only'});
  delete process.env.STRIPE_LIVE_PAYMENTS_ENABLED;
  delete process.env.STOREFRONT_PAYMENTS_ENABLED;
});

function harness({order=null,role='admin',authenticated=true,stockError=false,paid=false,sessionStatus='open',invoicePaid=false}={}) {
  const calls=[],rpc=[],writes=[];
  const stripeFetch=async(url,init)=>{
    const path=new URL(String(url)).pathname;
    const params=new URLSearchParams(init.body||'');
    calls.push({path,method:init.method,params,key:new Headers(init.headers).get('idempotency-key')});
    if(path==='/v1/customers')return json({id:'cus_Test'});
    if(path==='/v1/checkout/sessions')return json({id:'cs_test_order',url:'https://checkout.stripe.com/c/pay/test',status:'open'});
    if(path==='/v1/checkout/sessions/cs_test_order/expire')return json({id:'cs_test_order',status:'expired'});
    if(path==='/v1/checkout/sessions/cs_test_order')return json({id:'cs_test_order',status:sessionStatus,payment_status:paid?'paid':'unpaid',
      currency:'usd',amount_total:1600,total_details:{amount_tax:100},shipping_cost:{amount_subtotal:500},metadata:{order_id:id},payment_intent:'pi_Test'});
    if(path==='/v1/invoices')return json({id:'in_Test',status:'draft'});
    if(path==='/v1/invoices/in_Test')return json({id:'in_Test',status:invoicePaid?'paid':'open',metadata:{order_id:id},currency:'usd',
      total:1600,amount_paid:invoicePaid?1600:0,total_taxes:[{amount:100}],shipping_cost:{amount_subtotal:500}});
    if(path==='/v1/invoice_payments')return json({data:[{status:'paid',amount_paid:1600,payment:{payment_intent:'pi_Test'}}],has_more:false});
    if(path==='/v1/payment_intents/pi_Test')return json({id:'pi_Test',status:'succeeded',currency:'usd',amount_received:1600});
    if(path==='/v1/invoiceitems')return json({id:`ii_${calls.length}`});
    if(path==='/v1/invoices/in_Test/finalize'||path==='/v1/invoices/in_Test/send')return json({id:'in_Test',status:'open',hosted_invoice_url:'https://invoice.stripe.com/i/test'});
    throw new Error(`Unexpected Stripe call ${path}`);
  };
  class LocalStripe extends Stripe {constructor(key,options){super(key,{...options,httpClient:Stripe.createFetchHttpClient(stripeFetch)});}}
  const snapshot={id,account_id:account,kind:'checkout',status:'creating',stripe_id:null,payment_url:null,email_sent:false,
    created_at:new Date().toISOString(),items:[{id:item,title:'Real game',platform:'SNES',condition:'CIB',quantity:1,unit_amount:1000}],subtotal_cents:1000,...order};
  let reserved=false;
  const admin={
    auth:{getUser:async()=>({data:{user:authenticated?{id:account}:null},error:null})},
    from(table){
      let patch=null;const filters={};
      const chain={
        select(){return chain;},eq(key,value){filters[key]=value;return chain;},in(key,value){filters[key]=value;return chain;},
        update(value){patch=value;return chain;},insert(value){writes.push({table,value});return Promise.resolve({error:null});},
        single(){return chain;},maybeSingle(){return chain;},
        then(resolve){
          if(patch){writes.push({table,patch,filters});return Promise.resolve({data:null,error:null}).then(resolve);}
          if(table==='storefront_settings')return Promise.resolve({data:{user_id:account},error:null}).then(resolve);
          if(table==='storefront_orders')return Promise.resolve({data:order||reserved?snapshot:null,error:null}).then(resolve);
          if(table==='storefront_requests')return Promise.resolve({data:customer,error:null}).then(resolve);
          throw new Error(`Unexpected table ${table}`);
        }
      };
      return chain;
    },
    async rpc(name,params){
      rpc.push({name,params});
      if(name==='storefront_rate_limit')return {data:true,error:null};
      if(name==='storefront_reserve'){reserved=true;return {data:snapshot,error:stockError?{message:'stock changed'}:null};}
      if(name==='storefront_apply_payment')return {error:null};
      if(name==='storefront_cancel_unstarted')return {data:!order,error:null};
      throw new Error(`Unexpected RPC ${name}`);
    }
  };
  const modules=new Map();
  function load(file) {
    file=resolve(file);
    if(resolve(file)===resolve('lib/server/supabase-admin.ts'))return {createSupabaseAdmin:()=>admin};
    if(modules.has(file))return modules.get(file);
    const module={exports:{}};
    const output=ts.transpileModule(readFileSync(resolve(file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
    new Function('module','exports','require','console',output)(module,module.exports,name=>{
      if(name==='stripe')return LocalStripe;
      if(name==='@/lib/server/supabase-admin')return {createSupabaseAdmin:()=>admin};
      if(name==='@/lib/server-account')return {getServerAccountContext:async()=>({accountId:account,role})};
      if(name==='@/lib/server/storefront-catalog')return {loadStorefrontCatalog:async()=>({products:[{id:item,title:'Real game',price:10,quantity:1}]})};
      if(name.startsWith('@/'))return load(`${name.slice(2)}.ts`);
      if(name.startsWith('./'))return load(resolve(file,'..',`${name.slice(2)}.ts`));
      return require(name);
    },{error(){},warn(){}});
    modules.set(file,module.exports);return module.exports;
  }
  return {load,calls,rpc,writes,snapshot};
}
const post=(path,body,headers={})=>new NextRequest(`http://localhost:3218${path}`,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const cart={orderId:id,items:[{id:item,quantity:1,unit_amount:1}]};

test('live payments and missing shipping configuration fail closed',()=>{
  const {paymentConfig}=harness().load('lib/server/storefront-payments.ts');
  process.env.STRIPE_SECRET_KEY='sk_live_not_enabled';
  assert.throws(paymentConfig,/not configured/);
  process.env.STRIPE_SECRET_KEY='sk_test_local_only';delete process.env.STRIPE_SHIPPING_RATE_IDS;
  assert.throws(paymentConfig,/not configured/);
});
test('production payment switch blocks checkout and invoicing before stock or Stripe changes',async()=>{
  process.env.STOREFRONT_PAYMENTS_ENABLED='false';
  const h=harness();const checkout=h.load('app/api/storefront/checkout/route.ts');
  const readiness=await checkout.GET(new NextRequest('http://localhost:3218/api/storefront/checkout'));
  assert.equal((await readiness.json()).paymentReady,false);
  assert.equal((await checkout.POST(post('/api/storefront/checkout',cart))).status,503);
  const invoice=await h.load('app/api/storefront/manage/route.ts').POST(post('/api/storefront/manage',{
    action:'invoice',orderId:id,requestId,shippingRate:'shr_TestRate',items:[{id:item,quantity:1}],
  },{Authorization:'Bearer local-test-token'}));
  assert.equal(invoice.status,503);
  assert.equal(h.rpc.some(call=>call.name==='storefront_reserve'),false);
  assert.equal(h.calls.length,0);
  assert.equal(h.writes.length,0);
});
test('disabled new payments do not block guest requests or cancellation of unstarted checkout',async()=>{
  process.env.STOREFRONT_PAYMENTS_ENABLED='false';
  const h=harness();
  const request=await h.load('app/api/storefront/requests/route.ts').POST(post('/api/storefront/requests',{
    ...customer,item:'Requested game',
  }));
  assert.equal(request.status,200);
  const cancellation=await h.load('app/api/storefront/checkout/route.ts').POST(post('/api/storefront/checkout',{...cart,action:'cancel'}));
  assert.equal(cancellation.status,200);
  assert.equal((await cancellation.json()).cancelled,true);
});
test('disabled new payments still allow an open Stripe checkout to be cancelled and stock released',async()=>{
  process.env.STOREFRONT_PAYMENTS_ENABLED='false';
  const h=harness({order:{stripe_id:'cs_test_order',status:'pending'}});
  h.snapshot.fingerprint=h.load('lib/server/storefront-http.ts').fingerprint({kind:'checkout',items:[{id:item,quantity:1}]});
  const response=await h.load('app/api/storefront/checkout/route.ts').POST(post('/api/storefront/checkout',{...cart,action:'cancel'}));
  assert.equal(response.status,200);
  assert.ok(h.calls.some(call=>call.path==='/v1/checkout/sessions/cs_test_order/expire'));
  assert.equal(h.rpc.find(call=>call.name==='storefront_apply_payment').params.p_action,'cancel');
});
test('checkout uses server prices, automatic tax, configured shipping, card-only hosted payment and stable idempotency',async()=>{
  const h=harness();const {POST}=h.load('app/api/storefront/checkout/route.ts');
  const response=await POST(post('/api/storefront/checkout',cart));
  assert.equal(response.status,200);
  const call=h.calls.find(call=>call.path==='/v1/checkout/sessions');
  assert.equal(call.params.get('line_items[0][price_data][unit_amount]'),'1000','client prices cannot affect charges');
  assert.equal(call.params.get('automatic_tax[enabled]'),'true');
  assert.equal(call.params.get('shipping_options[0][shipping_rate]'),'shr_TestRate');
  assert.equal(call.params.get('shipping_address_collection[allowed_countries][0]'),'US');
  assert.equal(call.params.get('payment_method_types[0]'),'card');
  assert.equal(call.key,`checkout-${id}`);
  assert.match(call.params.get('success_url'),/session_id=/);
});
test('stock rejection never calls Stripe',async()=>{
  const h=harness({stockError:true});
  assert.equal((await h.load('app/api/storefront/checkout/route.ts').POST(post('/api/storefront/checkout',cart))).status,409);
  assert.equal(h.calls.length,0);
});
test('cross-origin and malformed quantity inputs are rejected',async()=>{
  const h=harness();const route=h.load('app/api/storefront/checkout/route.ts');
  assert.equal((await route.POST(post('/api/storefront/checkout',cart,{Origin:'https://other.invalid'}))).status,403);
  assert.equal((await route.POST(post('/api/storefront/checkout',{...cart,items:[{id:item,quantity:-1}]}))).status,400);
  assert.equal(h.calls.length,0);
});
test('staff APIs require login and an administrator in the configured store account',async()=>{
  const h=harness({authenticated:false});
  assert.equal((await h.load('app/api/storefront/manage/route.ts').GET(new NextRequest('http://localhost:3218/api/storefront/manage'))).status,401);
  const user=harness({role:'user'});
  assert.equal((await user.load('app/api/storefront/manage/route.ts').GET(new NextRequest('http://localhost:3218/api/storefront/manage',{headers:{Authorization:'Bearer test'}}))).status,403);
});
test('guest requests save customer details in the configured account without requiring a login',async()=>{
  const h=harness({authenticated:false});
  const response=await h.load('app/api/storefront/requests/route.ts').POST(post('/api/storefront/requests',{
    name:'Guest Customer',email:'Customer@example.invalid',item:'Requested game',platform:'SNES',notes:'Complete copy',
    address:{line1:'1 Test St',city:'Test',state:'FL',postal_code:'32114',country:'US'},
  }));
  assert.equal(response.status,200);
  const saved=h.writes.find(write=>write.table==='storefront_requests').value;
  assert.equal(saved.account_id,account);
  assert.equal(saved.email,'customer@example.invalid');
  assert.equal(saved.item,'Requested game');
  assert.equal(saved.address.country,'US');
  assert.equal('website' in saved,false);
  assert.equal(h.calls.length,0,'An item request must not initiate a payment');
});
test('invalid or cross-origin guest requests do not save customer data',async()=>{
  const h=harness();const {POST}=h.load('app/api/storefront/requests/route.ts');
  assert.equal((await POST(post('/api/storefront/requests',{name:'Guest'}))).status,400);
  assert.equal((await POST(post('/api/storefront/requests',{}, {Origin:'https://other.invalid'}))).status,403);
  assert.equal(h.writes.length,0);
});
test('staff can turn a guest request into an emailed inventory-backed invoice link',async()=>{
  const h=harness();
  const response=await h.load('app/api/storefront/manage/route.ts').POST(post('/api/storefront/manage',{
    action:'invoice',orderId:id,requestId,shippingRate:'shr_TestRate',items:[{id:item,quantity:1,unit_amount:1}],
  },{Authorization:'Bearer local-test-token'}));
  assert.equal(response.status,200);
  assert.equal((await response.json()).url,'https://invoice.stripe.com/i/test');
  const reservation=h.rpc.find(call=>call.name==='storefront_reserve').params;
  assert.equal(reservation.p_account,account);
  assert.equal(reservation.p_request,requestId);
  assert.equal(reservation.p_kind,'invoice');
  assert.equal(reservation.p_items[0].unit_amount,1000);
  assert.ok(h.calls.some(call=>call.path==='/v1/invoices/in_Test/send'));
  assert.ok(h.writes.some(write=>write.table==='storefront_requests'&&write.patch?.status==='invoiced'&&write.filters.id===requestId));
});
test('invoice creation includes only its own inventory lines, tax, shipping and email delivery',async()=>{
  const h=harness();const payments=h.load('lib/server/storefront-payments.ts');
  const url=await payments.createRequestInvoice({...h.snapshot,kind:'invoice'},{
    name:'Customer',email:'customer@example.invalid',address:{line1:'1 Test St',line2:'',city:'Test',state:'FL',postal_code:'32114',country:'US'}
  },'shr_TestRate');
  assert.equal(url,'https://invoice.stripe.com/i/test');
  const invoice=h.calls.find(call=>call.path==='/v1/invoices');
  assert.equal(invoice.params.get('collection_method'),'send_invoice');
  assert.equal(invoice.params.get('pending_invoice_items_behavior'),'exclude');
  assert.equal(invoice.params.get('automatic_tax[enabled]'),'true');
  assert.equal(invoice.params.get('shipping_cost[shipping_rate]'),'shr_TestRate');
  assert.equal(h.calls.filter(call=>call.path==='/v1/invoiceitems').length,1);
  assert.ok(h.calls.some(call=>call.path==='/v1/invoices/in_Test/send'));
  assert.ok(h.writes.some(write=>write.patch?.email_sent===true));
  assert.ok(h.writes.filter(write=>write.patch?.status).every(write=>write.filters.status.includes('creating')&&write.filters.status.includes('pending')),'Creation must not regress webhook-confirmed paid state');
});
test('invoice rejects unsupported destinations before creating Stripe objects',async()=>{
  const h=harness();
  await assert.rejects(h.load('lib/server/storefront-payments.ts').createRequestInvoice(h.snapshot,{
    name:'Customer',email:'customer@example.invalid',address:{country:'CA'}},'shr_TestRate'),/outside/);
  assert.equal(h.calls.length,0);
});
test('unsigned or tampered webhook bodies do not touch stock or finance',async()=>{
  const h=harness();const {POST}=h.load('app/api/storefront/webhook/route.ts');
  assert.equal((await POST(post('/api/storefront/webhook',{type:'checkout.session.completed'}))).status,400);
  assert.equal((await POST(post('/api/storefront/webhook',{type:'checkout.session.completed'},{'stripe-signature':'invalid'}))).status,400);
  assert.equal(h.rpc.length,0);
});
test('signed webhook retrieves authoritative payment and applies it through the atomic RPC',async()=>{
  process.env.STOREFRONT_PAYMENTS_ENABLED='false';
  const h=harness({paid:true,sessionStatus:'complete'});
  const body=JSON.stringify({id:'evt_test',type:'checkout.session.completed',data:{object:{id:'cs_test_order',amount_total:1}}});
  const signature=Stripe.webhooks.generateTestHeaderString({payload:body,secret});
  const request=new NextRequest('http://localhost:3218/api/storefront/webhook',{method:'POST',body,headers:{'stripe-signature':signature}});
  assert.equal((await h.load('app/api/storefront/webhook/route.ts').POST(request)).status,200);
  const apply=h.rpc.find(call=>call.name==='storefront_apply_payment');
  assert.equal(apply.params.p_total,1600);
  assert.equal(apply.params.p_tax,100);
  assert.equal(apply.params.p_shipping,500);
  assert.equal(apply.params.p_action,'paid');
  const status=await h.load('app/api/storefront/checkout/route.ts').GET(new NextRequest('http://localhost:3218/api/storefront/checkout?session_id=cs_test_order'));
  assert.equal(status.status,200,'Disabling new payments must not block payment status checks');
});
test('valid unpaid completion does not masquerade as a purchase',async()=>{
  const h=harness();
  const body=JSON.stringify({id:'evt_test',type:'checkout.session.completed',data:{object:{id:'cs_test_order'}}});
  const signature=Stripe.webhooks.generateTestHeaderString({payload:body,secret});
  assert.equal((await h.load('app/api/storefront/webhook/route.ts').POST(new NextRequest('http://localhost:3218/api/storefront/webhook',{method:'POST',body,headers:{'stripe-signature':signature}}))).status,200);
  assert.equal(h.rpc.length,0);
});
test('invoice payment webhook verifies Stripe totals and the card payment before recording revenue',async()=>{
  const h=harness({invoicePaid:true});
  const body=JSON.stringify({id:'evt_invoice_paid',type:'invoice.paid',data:{object:{id:'in_Test',total:1}}});
  const signature=Stripe.webhooks.generateTestHeaderString({payload:body,secret});
  const response=await h.load('app/api/storefront/webhook/route.ts').POST(new NextRequest('http://localhost:3218/api/storefront/webhook',{
    method:'POST',body,headers:{'stripe-signature':signature},
  }));
  assert.equal(response.status,200);
  const apply=h.rpc.find(call=>call.name==='storefront_apply_payment').params;
  assert.equal(apply.p_order,id);
  assert.equal(apply.p_stripe,'in_Test');
  assert.equal(apply.p_action,'paid');
  assert.equal(apply.p_total,1600);
  assert.equal(apply.p_tax,100);
  assert.equal(apply.p_shipping,500);
  assert.equal(apply.p_intent,'pi_Test');
  assert.ok(h.calls.some(call=>call.path==='/v1/payment_intents/pi_Test'&&call.method==='GET'));
});
