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
const parcel={length:11,width:8.5,height:2,weight:7};
const paidShippingOrder={status:'paid',refunded_cents:0,shipping_quote:{customer,rate:{name:'USPS Ground Advantage',amount:525},parcels:1}};

beforeEach(()=>{
  Object.assign(process.env,{STRIPE_SECRET_KEY:'sk_test_local_only',STRIPE_WEBHOOK_SECRET:secret,STRIPE_SHIPPING_RATE_IDS:'shr_TestRate',
    STRIPE_SHIPPING_COUNTRIES:'US',STOREFRONT_SITE_URL:'http://localhost:3218',NEXT_PUBLIC_SUPABASE_URL:'https://test.invalid',
    NEXT_PUBLIC_SUPABASE_ANON_KEY:'test',SUPABASE_SERVICE_ROLE_KEY:'test-only'});
  delete process.env.STRIPE_LIVE_PAYMENTS_ENABLED;
  delete process.env.STOREFRONT_SHIPPING_PROVIDER;
  delete process.env.SHIPPO_API_KEY;
  process.env.STOREFRONT_PAYMENTS_ENABLED='true';
});

const packageProfile={id:'50000000-0000-4000-8000-000000000001',name:'Games',category:'Games',platform:'',condition:'',
  unitWeightOz:4,packagingWeightOz:2,lengthIn:8,widthIn:6,heightIn:2,unitsPerParcel:2};
const shippingSettings={origin:{name:'Shop',email:'shop@example.invalid',address:{line1:'2 Test St',line2:'',city:'Test',state:'FL',postal_code:'32114',country:'US'}},profiles:[packageProfile]};
function harness({order=null,role='admin',authenticated=true,stockError=false,paid=false,sessionStatus='open',invoicePaid=false,shippoFails=false,settings=shippingSettings,
  purchaseFails=false,transactionStatus='SUCCESS',forgedMetadata=false,saveLabelFails=false,productPrice=10,productPromotion='eligible',rateOverrides}={}) {
  const calls=[],rpc=[],writes=[],shippoCalls=[];
  const labels=[],transactions=[];
  const stripeFetch=async(url,init)=>{
    const path=new URL(String(url)).pathname;
    const params=new URLSearchParams(init.body||'');
    calls.push({path,method:init.method,params,key:new Headers(init.headers).get('idempotency-key')});
    if(path==='/v1/customers')return json({id:'cus_Test'});
    if(path==='/v1/shipping_rates')return json({id:'shr_Quoted'});
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
        select(){return chain;},eq(key,value){filters[key]=value;return chain;},in(key,value){filters[key]=value;return chain;},order(){return chain;},
        update(value){patch=value;return chain;},insert(value){writes.push({table,value});return Promise.resolve({error:null});},
        single(){return chain;},maybeSingle(){return chain;},
        then(resolve){
          if(patch){
            writes.push({table,patch,filters});
            if(table==='storefront_labels'){
              if(saveLabelFails)return Promise.resolve({error:{message:'DB unavailable after charge'}}).then(resolve);
              const label=labels.find(l=>l.id===filters.id&&l.status===filters.status);if(label)Object.assign(label,patch);
              return Promise.resolve({data:label,error:null}).then(resolve);
            }
            return Promise.resolve({data:null,error:null}).then(resolve);
          }
          if(table==='storefront_labels')return Promise.resolve({data:labels.filter(l=>l.order_id===filters.order_id&&l.account_id===filters.account_id),error:null}).then(resolve);
          if(table==='storefront_settings')return Promise.resolve({data:{user_id:account,shipping_config:settings},error:null}).then(resolve);
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
      if(name==='storefront_reserve'||name==='storefront_reserve_shipping'){reserved=true;if(params.p_shipping)snapshot.shipping_quote=params.p_shipping;return {data:snapshot,error:stockError?{message:'stock changed'}:null};}
      if(name==='storefront_apply_payment')return {error:null};
      if(name==='storefront_cancel_unstarted')return {data:!order,error:null};
      if(name==='storefront_claim_label'){
        const existing=labels.find(l=>l.order_id===params.p_order&&l.parcel_index===params.p_index);
        if(existing)return {data:{claimed:false,label:existing},error:null};
        const label={id:'60000000-0000-4000-8000-000000000001',order_id:params.p_order,account_id:params.p_account,
          parcel_index:params.p_index,status:'purchasing',rate:params.p_rate,parcel:params.p_parcel,transaction_id:null};
        labels.push(label);return {data:{claimed:true,label},error:null};
      }
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
    new Function('module','exports','require','console','fetch',output)(module,module.exports,name=>{
      if(name==='stripe')return LocalStripe;
      if(name==='@/lib/server/supabase-admin')return {createSupabaseAdmin:()=>admin};
      if(name==='@/lib/server-account')return {getServerAccountContext:async()=>({accountId:account,role})};
      if(name==='@/lib/server/storefront-catalog')return {loadStorefrontCatalog:async()=>({products:[{id:item,title:'Real game',price:productPrice,quantity:20,category:'Games',platform:'SNES',condition:'CIB',shippingPromotion:productPromotion}]})};
      if(name.startsWith('@/'))return load(`${name.slice(2)}.ts`);
      if(name.startsWith('./'))return load(resolve(file,'..',`${name.slice(2)}.ts`));
      return require(name);
    },{error(){},warn(){}},async(url,options)=>{
      if(url.startsWith('https://api.goshippo.com/transactions/')){
        const body=options.body?JSON.parse(options.body):null;
        shippoCalls.push({url,body});
        if(body){
          const value={object_id:'a'.repeat(32),status:transactionStatus,metadata:forgedMetadata?'other-order':body.metadata,
            rate:body.rate,test:!process.env.SHIPPO_API_KEY.startsWith('shippo_live_'),
            label_url:transactionStatus==='SUCCESS'?'https://labels.goshippo.com/test.pdf':null,
            tracking_number:transactionStatus==='SUCCESS'?'9400000000000000000000':null,
            tracking_url_provider:transactionStatus==='SUCCESS'?'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400000000000000000000':null,
            messages:transactionStatus==='ERROR'?[{text:'Carrier rejected parcel'}]:[]};
          transactions.push(value);
          if(purchaseFails)throw new Error('Connection lost after provider may have charged');
          return json(value);
        }
        return json(transactions[0]);
      }
      assert.equal(url,'https://api.goshippo.com/shipments/');
      shippoCalls.push(JSON.parse(options.body));
      if(shippoFails)return json({message:'carrier unavailable'},503);
      return json({rates:rateOverrides||[
        {object_id:`usps_${shippoCalls.length}`,provider:'USPS',currency:'USD',amount:'5.25',servicelevel:{name:'Ground Advantage',token:'usps_ground_advantage'},estimated_days:4},
        {object_id:`ups_${shippoCalls.length}`,provider:'UPS',currency:'USD',amount:'8.10',servicelevel:{name:'Ground',token:'ups_ground'},estimated_days:3},
        {object_id:`media_${shippoCalls.length}`,provider:'USPS',currency:'USD',amount:'2.00',servicelevel:{name:'Media Mail',token:'usps_media_mail'},estimated_days:6},
      ],messages:[]});
    });
    modules.set(file,module.exports);return module.exports;
  }
  return {load,calls,rpc,writes,snapshot,shippoCalls,labels,transactions};
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
test('new payments require explicit runtime enablement rather than relying on build-only environment variables',async()=>{
  delete process.env.STOREFRONT_PAYMENTS_ENABLED;
  const h=harness();
  const readiness=await h.load('app/api/storefront/checkout/route.ts').GET(new NextRequest('http://localhost:3218/api/storefront/checkout'));
  assert.equal((await readiness.json()).paymentReady,false);
  await assert.rejects(h.load('lib/server/storefront-payments.ts').createCheckout(h.snapshot),/not enabled/);
  assert.equal(h.calls.length,0);
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

function carrierMode() {
  process.env.STOREFRONT_SHIPPING_PROVIDER='shippo';
  process.env.SHIPPO_API_KEY='shippo_test_local_only';
}
const quotedCustomer=()=>({name:customer.name,email:customer.email,address:customer.address});
test('package profiles pack by configured capacity and weight, never invent missing measurements',()=>{
  const h=harness();
  const {shippingParcels,shippingSettingsSchema}=h.load('lib/storefront-shipping.ts');
  const lines=[{id:item,title:'Game',category:'Games',platform:'SNES',condition:'CIB',quantity:3,unit_amount:1000}];
  const parcels=shippingParcels(lines,[packageProfile]);
  assert.deepEqual(parcels.map(p=>p.weight),['10.000','6.000']);
  assert.equal(parcels.length,2);
  assert.throws(()=>shippingParcels(lines,[]),/not configured/);
  assert.throws(()=>shippingParcels(lines,[{...packageProfile,platform:'SNES'},{...packageProfile,id:'other',condition:'CIB'}]),/Multiple package profiles/);
  assert.throws(()=>shippingParcels([{...lines[0],quantity:30}],[{...packageProfile,unitsPerParcel:1}]),/more than 10/);
  assert.equal(shippingSettingsSchema.safeParse({...shippingSettings,profiles:[]}).success,false);
  assert.equal(shippingSettingsSchema.safeParse({...shippingSettings,profiles:[{...packageProfile,unitWeightOz:0}]}).success,false);
});
test('Shippo quotes aggregate matching services across parcels, exclude restricted mail, and never buy labels',async()=>{
  carrierMode();
  const h=harness();
  const quote=await h.load('lib/server/storefront-shipping.ts').shippingQuote([{id:item,quantity:3}],quotedCustomer());
  assert.equal(quote.parcels,2);
  assert.deepEqual(quote.rates.map(r=>[r.name,r.amount]),[['USPS Ground Advantage',1050],['UPS Ground',1620]]);
  assert.equal(h.shippoCalls.length,2);
  assert.ok(h.shippoCalls.every(call=>call.async===false&&call.parcels.length===1));
  assert.equal(h.calls.length,0);
  assert.equal(h.rpc.length,0);
});
test('signed carrier quotes reject tampering, changed quantities, changed customer addresses, and stale settings',async()=>{
  carrierMode();
  const h=harness(),service=h.load('lib/server/storefront-shipping.ts');
  const items=[{id:item,quantity:1}];
  const quote=await service.shippingQuote(items,quotedCustomer());
  const verified=await service.verifyShippingQuote(quote.token,quote.rates[0].id,items);
  assert.equal(verified.shipping.rate.amount,525);
  await assert.rejects(service.verifyShippingQuote(`${quote.token}x`,quote.rates[0].id,items),/invalid/);
  await assert.rejects(service.verifyShippingQuote(quote.token,quote.rates[0].id,[{id:item,quantity:2}]),/changed/);
  await assert.rejects(service.verifyShippingQuote(quote.token,'made-up-rate',items),/Select a quoted/);
  await assert.rejects(service.verifyShippingQuote(quote.token,quote.rates[0].id,items,{...quotedCustomer(),address:{...customer.address,postal_code:'10001'}}),/changed/);
  const other=harness({settings:{...shippingSettings,profiles:[{...packageProfile,unitWeightOz:8}]}}).load('lib/server/storefront-shipping.ts');
  await assert.rejects(other.verifyShippingQuote(quote.token,quote.rates[0].id,items),/changed/);
  const savedNow=Date.now;
  try {Date.now=()=>quote.expires+1;await assert.rejects(service.verifyShippingQuote(quote.token,quote.rates[0].id,items),/expired/);}
  finally {Date.now=savedNow;}
});
test('carrier failure and missing profiles never create a reservation or Stripe payment',async()=>{
  carrierMode();
  const h=harness({shippoFails:true});
  await assert.rejects(h.load('lib/server/storefront-shipping.ts').shippingQuote([{id:item,quantity:1}],quotedCustomer()),/could not be retrieved/);
  assert.equal(h.rpc.length,0);assert.equal(h.calls.length,0);
  const missing=harness({settings:null});
  const status=await missing.load('app/api/storefront/checkout/route.ts').GET(new NextRequest('http://localhost:3218/api/storefront/checkout'));
  const result=await status.json();
  assert.equal(result.paymentReady,false);assert.match(result.message,/not configured/);
});
test('carrier checkout persists the quote atomically and locks its delivery address and price in Stripe',async()=>{
  carrierMode();
  const h=harness(),items=[{id:item,quantity:1}];
  const quote=await h.load('lib/server/storefront-shipping.ts').shippingQuote(items,quotedCustomer());
  const route=h.load('app/api/storefront/checkout/route.ts');
  const response=await route.POST(post('/api/storefront/checkout',{orderId:id,items,shippingToken:quote.token,shippingRate:quote.rates[0].id}));
  assert.equal(response.status,200);
  const reserve=h.rpc.find(c=>c.name==='storefront_reserve_shipping');
  assert.equal(reserve.params.p_shipping.rate.amount,525);
  assert.equal(reserve.params.p_shipping.customer.address.postal_code,'32114');
  const checkout=h.calls.find(c=>c.path==='/v1/checkout/sessions');
  assert.equal(checkout.params.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'),'525');
  assert.equal(checkout.params.get('customer'),'cus_Test');
  assert.equal(checkout.params.has('shipping_address_collection[allowed_countries][0]'),false);
  assert.match(checkout.params.get('custom_text[submit][message]'),/1 Test St/);
  const customerCall=h.calls.find(c=>c.path==='/v1/customers');
  assert.equal(customerCall.params.get('shipping[address][postal_code]'),'32114');
  const noQuote=harness();
  assert.equal((await noQuote.load('app/api/storefront/checkout/route.ts').POST(post('/api/storefront/checkout',cart))).status,409);
  assert.equal(noQuote.rpc.some(c=>c.name==='storefront_reserve_shipping'),false);
});
test('carrier invoices use the guest request address, authoritative rate, and a dedicated Stripe shipping rate',async()=>{
  carrierMode();
  const h=harness();
  const shipping=h.load('app/api/storefront/shipping/route.ts');
  const items=[{id:item,quantity:1}];
  const response=await shipping.POST(post('/api/storefront/shipping',{action:'invoice-quote',requestId,items},{Authorization:'Bearer test'}));
  assert.equal(response.status,200);
  const quote=await response.json();
  const invoice=await h.load('app/api/storefront/manage/route.ts').POST(post('/api/storefront/manage',{
    action:'invoice',orderId:id,requestId,items,shippingToken:quote.token,shippingRate:quote.rates[0].id,
  },{Authorization:'Bearer test'}));
  assert.equal(invoice.status,200);
  assert.equal(h.rpc.find(c=>c.name==='storefront_reserve_shipping').params.p_shipping.rate.amount,525);
  assert.equal(h.calls.find(c=>c.path==='/v1/shipping_rates').params.get('fixed_amount[amount]'),'525');
  assert.equal(h.calls.find(c=>c.path==='/v1/invoices').params.get('shipping_cost[shipping_rate]'),'shr_Quoted');
});

test('server promotion sends zero shipping to Stripe checkout while preserving real postage',async()=>{
  carrierMode();
  const h=harness({productPrice:50}),items=[{id:item,quantity:1}];
  const service=h.load('lib/server/storefront-shipping.ts');
  const quote=await service.shippingQuote(items,quotedCustomer());
  assert.equal(quote.rates[0].amount,0);assert.equal(quote.rates[0].carrierAmount,525);
  assert.equal(quote.rates[1].amount,810,'Non-selected standard services stay paid');
  const response=await h.load('app/api/storefront/checkout/route.ts').POST(post('/api/storefront/checkout',{
    orderId:id,items,shippingToken:quote.token,shippingRate:quote.rates[0].id,
  }));
  assert.equal(response.status,200);
  const reservation=h.rpc.find(c=>c.name==='storefront_reserve_shipping');
  assert.equal(reservation.params.p_shipping.rate.discount,525);
  const session=h.calls.find(c=>c.path==='/v1/checkout/sessions');
  assert.equal(session.params.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'),'0');
});
test('individual promotion is authoritative and invoice rate can be zero',async()=>{
  carrierMode();
  const h=harness({productPrice:40,productPromotion:'free'}),items=[{id:item,quantity:1}];
  const service=h.load('lib/server/storefront-shipping.ts');
  const quote=await service.shippingQuote(items,quotedCustomer());
  assert.equal(quote.rates[0].amount,0);
  const response=await h.load('app/api/storefront/manage/route.ts').POST(post('/api/storefront/manage',{
    action:'invoice',orderId:id,requestId,items,shippingToken:quote.token,shippingRate:quote.rates[0].id,
  },{Authorization:'Bearer staff'}));
  assert.equal(response.status,200);
  const rate=h.calls.find(c=>c.path==='/v1/shipping_rates');
  assert.equal(rate.params.get('fixed_amount[amount]'),'0');
  assert.equal(h.rpc.find(c=>c.name==='storefront_reserve_shipping').params.p_shipping.rate.carrierAmount,525);
  const excluded=harness({productPrice:100,productPromotion:'excluded'});
  assert.equal((await excluded.load('lib/server/storefront-shipping.ts').shippingQuote(items,quotedCustomer())).rates[0].amount,525);
});
test('changing inventory offer invalidates a previously signed shipping quote',async()=>{
  carrierMode();
  const items=[{id:item,quantity:1}];
  const quote=await harness({productPrice:50}).load('lib/server/storefront-shipping.ts').shippingQuote(items,quotedCustomer());
  await assert.rejects(harness({productPrice:50,productPromotion:'excluded'}).load('lib/server/storefront-shipping.ts').verifyShippingQuote(quote.token,quote.rates[0].id,items),/changed/);
});
test('only recognized standard services qualify and discounted service becomes the default',async()=>{
  carrierMode();
  const priority={object_id:'priority',provider:'USPS',currency:'USD',amount:'4.00',servicelevel:{name:'Priority Mail',token:'usps_priority'},estimated_days:2};
  const ground={...priority,object_id:'ground',amount:'5.25',servicelevel:{name:'Ground Advantage',token:'usps_ground_advantage'}};
  const items=[{id:item,quantity:1}];
  const quote=await harness({productPrice:50,rateOverrides:[priority,ground]}).load('lib/server/storefront-shipping.ts').shippingQuote(items,quotedCustomer());
  assert.deepEqual(quote.rates.map(r=>[r.name,r.amount]),[['USPS Ground Advantage',0],['USPS Priority Mail',400]]);
  const noStandard=await harness({productPrice:50,rateOverrides:[priority]}).load('lib/server/storefront-shipping.ts').shippingQuote(items,quotedCustomer());
  assert.equal(noStandard.rates[0].amount,400);assert.equal(noStandard.rates[0].discount,undefined);
});
test('ordinary items automatically qualify below $50 using real postage and merchandise value',async()=>{
  carrierMode();
  const rate={object_id:'actual-ground',provider:'USPS',currency:'USD',amount:'5.73',servicelevel:{name:'Ground Advantage',token:'usps_ground_advantage'},estimated_days:2};
  const items=[{id:item,quantity:1}];
  const h=harness({productPrice:44.07,rateOverrides:[rate]});
  const quote=await h.load('lib/server/storefront-shipping.ts').shippingQuote(items,quotedCustomer());
  assert.equal(quote.rates[0].amount,0);
  assert.equal(quote.rates[0].discount,573);
  const response=await h.load('app/api/storefront/checkout/route.ts').POST(post('/api/storefront/checkout',{
    orderId:id,items,shippingToken:quote.token,shippingRate:quote.rates[0].id,
  }));
  assert.equal(response.status,200);
  assert.equal(h.calls.find(c=>c.path==='/v1/checkout/sessions').params.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'),'0');
  const below=await harness({productPrice:34.88,rateOverrides:[rate]}).load('lib/server/storefront-shipping.ts').shippingQuote(items,quotedCustomer());
  assert.equal(below.rates[0].amount,573);assert.equal(below.rates[0].promotionGoal,3820);
});
test('free customer shipping does not waive the actual staff postage purchase',async()=>{
  carrierMode();
  const h=harness({order:{...paidShippingOrder,shipping_quote:{...paidShippingOrder.shipping_quote,rate:{name:'USPS Ground Advantage',amount:0,carrierAmount:525,discount:525}}}});
  const result=await h.load('lib/server/storefront-labels.ts').quoteLabel(id,account,0,parcel);
  assert.equal(result.rates[0].amount,525);
});
test('shipping profile configuration and invoice rates require a store administrator',async()=>{
  carrierMode();
  for(const options of [{role:'member'},{authenticated:false}]) {
    const h=harness(options),route=h.load('app/api/storefront/shipping/route.ts');
    const response=await route.POST(post('/api/storefront/shipping',{action:'save',settings:shippingSettings},{Authorization:'Bearer test'}));
    assert.equal(response.status,options.authenticated===false?401:403);
    assert.equal(h.writes.length,0);
  }
});
test('live Stripe cannot be paired with a test Shippo key',()=>{
  carrierMode();
  process.env.STRIPE_SECRET_KEY='sk_live_local_only';
  process.env.STRIPE_LIVE_PAYMENTS_ENABLED='true';
  const config=harness().load('lib/server/storefront-payments.ts').paymentConfig;
  assert.throws(config,/not configured/);
  process.env.SHIPPO_API_KEY='shippo_live_local_only';
  assert.equal(config().carrierShipping,true);
});

test('label endpoints require staff administrator access before calling Shippo',async()=>{
  process.env.SHIPPO_API_KEY='shippo_test_local';
  for(const opts of [{authenticated:false},{role:'member'}]){
    const h=harness({...opts,order:paidShippingOrder});
    const route=h.load('app/api/storefront/labels/route.ts');
    const response=await route.POST(post('/api/storefront/labels',{action:'quote',orderId:id,index:0,parcel},{Authorization:'Bearer staff'}));
    assert.ok([401,403].includes(response.status));assert.equal(h.shippoCalls.length,0);
  }
});
test('label quote rejects unpaid, refunded, absent shipping and invalid packages',async()=>{
  process.env.SHIPPO_API_KEY='shippo_test_local';
  for(const order of [{...paidShippingOrder,status:'pending'},{...paidShippingOrder,refunded_cents:100},{...paidShippingOrder,shipping_quote:null}]){
    const h=harness({order});
    await assert.rejects(h.load('lib/server/storefront-labels.ts').quoteLabel(id,account,0,parcel));
    assert.equal(h.shippoCalls.length,0);
  }
  const h=harness({order:paidShippingOrder});
  await assert.rejects(h.load('lib/server/storefront-labels.ts').quoteLabel(id,account,1,parcel));
});
test('label quote binds paid order, measured parcel and stored address without catalog stock lookup',async()=>{
  process.env.SHIPPO_API_KEY='shippo_test_local';
  const h=harness({order:paidShippingOrder});
  const quote=await h.load('lib/server/storefront-labels.ts').quoteLabel(id,account,0,parcel);
  assert.equal(quote.rates.length,2);
  assert.equal(quote.rates[0].amount,525);
  assert.equal(h.shippoCalls[0].parcels[0].weight,'7');
  assert.equal(h.shippoCalls[0].address_to.street1,customer.address.line1);
  assert.equal(h.rpc.length,0);
  assert.deepEqual(quote.destination.address,customer.address);
});
test('confirmed label purchase persists a single claim before charging and saves PDF and tracking',async()=>{
  process.env.SHIPPO_API_KEY='shippo_test_local';
  const h=harness({order:paidShippingOrder});
  const labels=h.load('lib/server/storefront-labels.ts');
  const quote=await labels.quoteLabel(id,account,0,parcel);
  const result=await labels.buyLabel(id,account,quote.token,quote.rates[0].id);
  assert.equal(result.status,'success');assert.equal(result.tracking_number,'9400000000000000000000');
  assert.equal(h.rpc[0].name,'storefront_claim_label');
  assert.equal(h.transactions.length,1);
  assert.equal(h.shippoCalls.at(-1).body.label_file_type,'PDF_4x6');
  await assert.rejects(labels.buyLabel(id,account,quote.token,quote.rates[0].id),/already has a purchase/);
  assert.equal(h.transactions.length,1);
  assert.equal(h.rpc.some(r=>r.name==='storefront_apply_payment'||r.name.startsWith('storefront_reserve')),false);
});
test('label quote tampering, order mismatch, stale origin and missing cost confirmation never purchase postage',async()=>{
  process.env.SHIPPO_API_KEY='shippo_test_local';
  const settings=structuredClone(shippingSettings);
  const h=harness({order:paidShippingOrder,settings});
  const labels=h.load('lib/server/storefront-labels.ts');
  const quote=await labels.quoteLabel(id,account,0,parcel);
  await assert.rejects(labels.buyLabel(id,account,quote.token+'bad',quote.rates[0].id),/Invalid/);
  await assert.rejects(labels.buyLabel(requestId,account,quote.token,quote.rates[0].id),/another order/);
  const route=h.load('app/api/storefront/labels/route.ts');
  const result=await route.POST(post('/api/storefront/labels',{action:'buy',orderId:id,token:quote.token,rateId:quote.rates[0].id},{Authorization:'Bearer staff'}));
  assert.equal(result.status,400);
  settings.origin.address.line1='Changed origin';
  await assert.rejects(labels.buyLabel(id,account,quote.token,quote.rates[0].id),/Shipping details changed/);
  assert.equal(h.transactions.length,0);
});
test('lost charge response locks repurchase and reconciles only the matching provider transaction',async()=>{
  process.env.SHIPPO_API_KEY='shippo_test_local';
  const h=harness({order:paidShippingOrder,purchaseFails:true});
  const labels=h.load('lib/server/storefront-labels.ts');
  const quote=await labels.quoteLabel(id,account,0,parcel);
  await assert.rejects(labels.buyLabel(id,account,quote.token,quote.rates[0].id),/outcome needs review/);
  await assert.rejects(labels.buyLabel(id,account,quote.token,quote.rates[0].id),/already has a purchase/);
  assert.equal(h.transactions.length,1);
  const result=await labels.refreshLabel(id,account,h.labels[0].id,'a'.repeat(32));
  assert.equal(result.status,'success');
  assert.equal(h.transactions.length,1);
});
test('provider rejection, queued labels and forged transaction metadata never report usable labels',async()=>{
  process.env.SHIPPO_API_KEY='shippo_test_local';
  for(const [options,expected] of [[{transactionStatus:'ERROR'},'error'],[{transactionStatus:'QUEUED'},'pending'],[{forgedMetadata:true},'purchasing'],[{saveLabelFails:true},'purchasing']]){
    const h=harness({order:paidShippingOrder,...options});
    const labels=h.load('lib/server/storefront-labels.ts');
    const quote=await labels.quoteLabel(id,account,0,parcel);
    if(expected==='purchasing')await assert.rejects(labels.buyLabel(id,account,quote.token,quote.rates[0].id),/outcome needs review/);
    else assert.equal((await labels.buyLabel(id,account,quote.token,quote.rates[0].id)).status,expected);
    assert.equal(h.labels[0].status,expected);
    await assert.rejects(labels.buyLabel(id,account,quote.token,quote.rates[0].id),/already has a purchase/);
    assert.equal(h.transactions.length,1);
  }
});
test('expired label quotes and customer checkout tokens cannot authorize postage',async()=>{
  process.env.SHIPPO_API_KEY='shippo_test_local';
  const h=harness({order:paidShippingOrder});
  const labels=h.load('lib/server/storefront-labels.ts');
  const quote=await labels.quoteLabel(id,account,0,parcel);
  const now=Date.now;
  Date.now=()=>quote.expires+1;
  try{await assert.rejects(labels.buyLabel(id,account,quote.token,quote.rates[0].id),/expired/);}
  finally{Date.now=now;}
  const cartQuote=await h.load('lib/server/storefront-shipping.ts').shippingQuote([{id:item,quantity:1}],customer);
  await assert.rejects(labels.buyLabel(id,account,cartQuote.token,cartQuote.rates[0].id),/Invalid label quote/);
  assert.equal(h.transactions.length,0);
});
test('concurrent label purchases charge once and refresh does not create a new transaction',async()=>{
  process.env.SHIPPO_API_KEY='shippo_test_local';
  const h=harness({order:paidShippingOrder});
  const labels=h.load('lib/server/storefront-labels.ts');
  const quote=await labels.quoteLabel(id,account,0,parcel);
  const results=await Promise.allSettled([labels.buyLabel(id,account,quote.token,quote.rates[0].id),labels.buyLabel(id,account,quote.token,quote.rates[0].id)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  await labels.refreshLabel(id,account,h.labels[0].id);
  assert.equal(h.transactions.length,1);
});
test('reconciliation rejects another transaction metadata or rate and reflects provider refunds',async()=>{
  process.env.SHIPPO_API_KEY='shippo_test_local';
  const h=harness({order:paidShippingOrder});
  const labels=h.load('lib/server/storefront-labels.ts');
  const quote=await labels.quoteLabel(id,account,0,parcel);
  await labels.buyLabel(id,account,quote.token,quote.rates[0].id);
  h.transactions[0].rate='another-rate';
  await assert.rejects(labels.refreshLabel(id,account,h.labels[0].id),/does not match/);
  h.transactions[0].rate=quote.rates[0].id;
  h.transactions[0].status='REFUNDED';
  const result=await labels.refreshLabel(id,account,h.labels[0].id);
  assert.equal(result.status,'error');
  assert.match(result.message,/Do not use/);
  assert.equal(h.transactions.length,1);
});
