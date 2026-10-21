import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, resolve } from 'node:path';

const bin=process.env.PATH.split(delimiter).find(path=>existsSync(resolve(path,'../playwright/package.json')));
if(!bin)throw new Error('Run with npm exec --package=playwright -- node scripts/test-storefront-fulfillment.mjs');
const {chromium}=createRequire(resolve(bin,'../playwright/package.json'))('playwright');
const base=process.argv[2]||'http://127.0.0.1:3218';
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser=await chromium.launch(existsSync(chrome)?{executablePath:chrome,headless:true}:{headless:true});
const page=await browser.newPage({viewport:{width:1448,height:1050}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const id='30000000-0000-4000-8000-000000000001';
const owner='10000000-0000-4000-8000-000000000001';
const customer={name:'Fixture Customer',email:'fixture@example.invalid',address:{line1:'1 Test Street',line2:'Suite 2',city:'Test City',state:'FL',postal_code:'32092',country:'US'}};
const order={id,kind:'checkout',status:'paid',created_at:'2026-10-21T22:42:34Z',items:[{title:'Gran Turismo 5 Prologue',quantity:1,unit_amount:6000}],
  subtotal_cents:6000,total_cents:6000,tax_cents:0,shipping_cents:0,refunded_cents:0,customer:null,tracking:null,
  shipping_quote:{customer,rate:{name:'USPS Ground Advantage',amount:0,carrierAmount:573,discount:573},parcels:2}};
const rates=[{id:'usps-label',name:'USPS Ground Advantage',amount:573,estimatedDays:4},{id:'ups-label',name:'UPS Ground',amount:900,estimatedDays:3}];
let labels=[],buyCount=0,quoteCount=0,lastIndex=0,loseResponse=false,shipCount=0;
const actions=[];
await page.addInitScript(({owner})=>{
  const token=`${btoa(JSON.stringify({alg:'HS256',typ:'JWT'}))}.${btoa(JSON.stringify({sub:owner,exp:4102444800}))}.fixture`;
  const user={id:owner,email:'staff@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}};
  const session={access_token:token,refresh_token:'fixture-only',expires_at:4102444800,expires_in:3600,token_type:'bearer',user};
  localStorage.setItem('sb-storefront-test-auth-token',JSON.stringify(session));
}, {owner});
await page.route('**/auth/v1/**',route=>route.fulfill({json:{id:owner,email:'staff@example.invalid',aud:'authenticated',app_metadata:{},user_metadata:{}}}));
await page.route('**/rest/v1/**',route=>{
  const url=route.request().url();
  return route.fulfill({json:url.includes('user_account_memberships')?{id:owner,account_owner_id:owner,user_id:owner,role:'admin',status:'active'}:null});
});
await page.route('**/api/storefront/catalog',route=>route.fulfill({json:{success:true,products:[]}}));
await page.route('**/api/storefront/manage*',route=>{
  if(route.request().method()==='POST'){
    actions.push(route.request().postDataJSON());shipCount++;
  }
  return route.fulfill({json:{success:true,requests:[],orders:[order,{...order,id:'40000000-0000-4000-8000-000000000001',status:'cancelled',items:[{title:'Cancelled Batman',quantity:1,unit_amount:966}]}],
    shippingRates:[],setupMessage:'',carrierShipping:true}});
});
await page.route('**/api/storefront/labels*',route=>{
  if(route.request().method()==='GET')return route.fulfill({json:{success:true,labels}});
  const input=route.request().postDataJSON();actions.push(input);
  if(input.action==='quote'){
    quoteCount++;lastIndex=input.index;
    return route.fulfill({json:{success:true,token:'fixture-label-token',rates,expires:Date.now()+900000,origin:customer,destination:customer,purchasedService:rates[0].name}});
  }
  if(input.action==='buy'){
    buyCount++;
    const label={id:`60000000-0000-4000-8000-00000000000${lastIndex}`,order_id:id,parcel_index:lastIndex,status:loseResponse?'purchasing':'success',
      rate:rates[0],parcel:{length:11,width:8.5,height:2,weight:7},transaction_id:loseResponse?null:'a'.repeat(32),
      label_url:'https://labels.example.invalid/fixture.pdf',tracking_number:`940000000000000000000${lastIndex}`,tracking_url:'https://tools.usps.com/'};
    labels.push(label);
    return route.fulfill(loseResponse?{status:503,json:{success:false,message:'Label purchase outcome needs review. Do not buy another label.'}}:{json:{success:true,label}});
  }
  if(input.action==='refresh'){
    labels=labels.map(l=>({...l,status:'success',transaction_id:'a'.repeat(32)}));
    return route.fulfill({json:{success:true,label:labels[0]}});
  }
  throw new Error(`Unexpected fixture action ${input.action}`);
});
try {
  await page.goto(`${base}/storefront/requests`);
  const card=page.getByRole('article',{name:`Order ${id.slice(0,8)}`,exact:true});
  await card.getByText('USPS Ground Advantage',{exact:true}).waitFor();
  assert.equal(await page.locator('pre').count(),0,'No raw JSON customer details');
  assert.match(await card.innerText(),/Fixture Customer/);
  assert.match(await card.innerText(),/1 Test Street/);
  assert.match(await card.innerText(),/Shipping promotion: \$5.73 covered by the shop/);
  assert.match(await card.innerText(),/customer paid \$0.00 shipping; a label still must be purchased/);
  await page.getByLabel('Order status',{exact:true}).selectOption('paid');
  assert.equal(await page.getByRole('article').count(),1);
  await page.getByLabel('Find order',{exact:true}).fill('not a matching title');
  await page.getByText('No matching orders on this page.',{exact:true}).waitFor();
  await page.getByLabel('Find order',{exact:true}).fill('Gran Turismo');
  await card.getByRole('button',{name:'Manage postage & labels',exact:true}).click();
  await card.getByLabel('Package',{exact:true}).waitFor();
  for(const [key,value] of Object.entries({length:11,width:8.5,height:2,weight:7})){
    await card.getByLabel(`Package ${key}`,{exact:true}).fill(String(value));
  }
  await card.getByRole('button',{name:'Get label prices',exact:true}).click();
  const buy=card.getByRole('button',{name:'Buy label - $5.73',exact:true});
  await buy.waitFor();
  assert.equal(await buy.isDisabled(),true);
  assert.equal(buyCount,0);
  await card.getByLabel('Postage service',{exact:true}).selectOption('ups-label');
  await card.getByRole('alert').filter({hasText:'differs from the customer-selected service'}).waitFor();
  await card.getByLabel('Postage service',{exact:true}).selectOption('usps-label');
  for(const width of [1448,768,390,320]){
    await page.setViewportSize({width,height:1050});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Fulfillment fits ${width}px`);
    if(process.argv[3]&&[1448,390].includes(width))await page.screenshot({path:`${process.argv[3]}-${width}.png`,fullPage:true});
  }
  await card.getByRole('checkbox').check();
  await card.getByLabel('Package weight',{exact:true}).fill('8');
  assert.equal(await card.getByRole('button',{name:/Buy label/}).count(),0,'Changing measurements invalidates quote and confirmation');
  await card.getByRole('button',{name:'Get label prices',exact:true}).click();
  await card.getByRole('checkbox').check();
  await card.getByRole('button',{name:'Buy label - $5.73',exact:true}).click();
  await card.getByRole('link',{name:'Open / print 4×6 PDF label',exact:true}).waitFor();
  assert.equal(buyCount,1);
  assert.equal(shipCount,0,'Printing a label does not dispatch');
  await card.getByRole('button',{name:'Refresh labels',exact:true}).click();
  assert.equal(buyCount,1);
  await card.getByLabel('Package',{exact:true}).selectOption('1');
  loseResponse=true;
  await card.getByRole('button',{name:'Get label prices',exact:true}).click();
  await card.getByRole('checkbox').check();
  await card.getByRole('button',{name:'Buy label - $5.73',exact:true}).click();
  await card.getByText('A purchase was started.',{exact:false}).waitFor();
  assert.equal(await card.getByRole('button',{name:/Buy label/}).count(),0,'Unknown purchase cannot be retried');
  await card.getByLabel('Shippo transaction ID',{exact:true}).fill('a'.repeat(32));
  await card.getByRole('button',{name:'Reconcile existing purchase',exact:true}).click();
  await card.getByRole('link',{name:'Open / print 4×6 PDF label',exact:true}).waitFor();
  assert.equal(buyCount,2,'Reconciliation makes no new purchase');
  assert.match(await card.getByLabel('Carrier and tracking number',{exact:true}).inputValue(),/9400000000000000000000.*9400000000000000000001/);
  assert.equal(actions.filter(a=>a.action==='buy').every(a=>a.confirm===true),true);
  assert.ok(quoteCount>=3);
  assert.deepEqual(errors,[]);
  console.log('Fulfillment browser checks passed: saved shipping service/address, order filters, mobile layouts, measured parcels, consent, quote invalidation, label links, tracking, multi-package recovery and duplicate protection. All provider/payment/staff APIs are fixtures; no production data or postage purchases.');
} catch(error) {
  console.error('Fulfillment browser failure:',{url:page.url(),errors,text:(await page.locator('body').innerText()).slice(0,8000)});
  throw error;
} finally {await browser.close();}
