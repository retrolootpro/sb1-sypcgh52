import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, resolve } from 'node:path';

const bin=process.env.PATH.split(delimiter).find(path=>existsSync(resolve(path,'../playwright/package.json')));
if(!bin)throw new Error('Run with npm exec --package=playwright -- node scripts/test-storefront-address-browser.mjs');
const {chromium}=createRequire(resolve(bin,'../playwright/package.json'))('playwright');
const base=process.argv[2]||'http://127.0.0.1:3218';
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser=await chromium.launch(existsSync(chrome)?{executablePath:chrome,headless:true}:{headless:true});
const page=await browser.newPage({viewport:{width:1448,height:1050}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const searches=[],requests=[];
const result={formatted:'123 Test Street, Test City, FL 32092, United States',housenumber:'123',street:'Test Street',city:'Test City',state_code:'FL',postcode:'32092',country_code:'us'};
let mode='success';
await page.route('https://api.geoapify.com/**',async route=>{
  const url=new URL(route.request().url());
  searches.push({query:url.searchParams.get('text'),filter:url.searchParams.get('filter'),limit:url.searchParams.get('limit')});
  if(mode==='fail')return route.fulfill({status:429,json:{error:'Quota exceeded'}});
  if(mode==='empty')return route.fulfill({json:{results:[{formatted:'Test City',country_code:'us',city:'Test City'}]}});
  if(mode==='slow'){
    await new Promise(resolve=>setTimeout(resolve,1200));
    return route.fulfill({json:{results:[{...result,formatted:'Older result',street:'Old Street'}]}});
  }
  return route.fulfill({json:{results:[result]}});
});
await page.route('**/api/storefront/catalog',route=>route.fulfill({json:{success:true,products:[{id:'fixture-game',slug:'fixture-game',title:'Test Game',price:10,quantity:2}]}}));
await page.route('**/api/storefront/checkout*',route=>route.fulfill({json:{success:true,paymentReady:true,carrierShipping:true}}));
await page.route('**/api/storefront/shipping',route=>route.fulfill({json:{success:true,token:'fixture-only',expires:Date.now()+900000,parcels:1,rates:[{id:'usps',name:'USPS Ground Advantage',amount:525,estimatedDays:4}]}}));
await page.route('**/api/storefront/requests',route=>{
  requests.push(route.request().postDataJSON());
  return route.fulfill({json:{success:true,message:'Fixture request accepted'}});
});
const search=()=>page.getByRole('combobox',{name:'Find your US address (optional)',exact:true});
try{
  await page.goto(`${base}/shop/request?item=Test%20game`);
  await search().waitFor();
  await page.getByLabel('Address line 2 (optional)',{exact:true}).fill('Apt 4');
  await search().focus();
  await page.waitForTimeout(550);
  assert.equal(searches.length,0,'No third-party call on focus');
  await search().fill('123');
  await page.waitForTimeout(550);
  assert.equal(searches.length,0,'Minimum four characters');
  await search().fill('123 Test');
  await search().fill('123 Test Street');
  await page.getByRole('option',{name:result.formatted,exact:true}).waitFor();
  assert.equal(searches.length,1,'Typing is debounced');
  assert.deepEqual(searches[0],{query:'123 Test Street',filter:'countrycode:us',limit:'5'});
  await search().press('ArrowDown');
  await search().press('Enter');
  assert.equal(await page.getByLabel('Address line 1',{exact:true}).inputValue(),'123 Test Street');
  assert.equal(await page.getByLabel('Address line 2 (optional)',{exact:true}).inputValue(),'Apt 4');
  assert.equal(await page.getByLabel('City',{exact:true}).inputValue(),'Test City');
  assert.equal(await page.getByLabel('State / province',{exact:true}).inputValue(),'FL');
  assert.equal(await page.getByLabel('Postal code',{exact:true}).inputValue(),'32092');
  assert.equal(await page.getByLabel('Country code',{exact:true}).inputValue(),'US');
  assert.equal(requests.length,0,'Enter selects a suggestion without submitting the request');
  mode='fail';await search().fill('456 Failure Street');
  await page.getByRole('status').filter({hasText:'Address search is unavailable'}).waitFor();
  await page.getByLabel('Address line 1',{exact:true}).fill('456 Manually Corrected Street');
  assert.equal(await page.getByLabel('City',{exact:true}).inputValue(),'Test City','Failure does not overwrite address');
  mode='empty';await search().fill('Partial town');
  await page.getByRole('status').filter({hasText:'No complete US address found'}).waitFor();
  assert.equal(await page.getByRole('option').count(),0);
  mode='slow';await search().fill('Older query');
  await page.waitForTimeout(550);
  mode='success';await search().fill('Newer query');
  await page.getByRole('option',{name:result.formatted,exact:true}).waitFor();
  await page.waitForTimeout(1300);
  assert.equal(await page.getByRole('option',{name:'Older result',exact:true}).count(),0,'Aborted response never replaces newer results');
  await search().press('Escape');
  assert.equal(await search().getAttribute('aria-expanded'),'false');
  await page.getByLabel('Your name',{exact:true}).fill('Fixture Customer');
  await page.getByLabel('Email',{exact:true}).fill('fixture@example.invalid');
  await page.getByRole('button',{name:'Submit request',exact:true}).click();
  await page.getByRole('heading',{name:'Request received',exact:true}).waitFor();
  assert.equal(requests[0].address.line1,'456 Manually Corrected Street');
  assert.equal(requests[0].address.line2,'Apt 4');

  await page.evaluate(()=>localStorage.setItem('pixel-page-cart',JSON.stringify({'fixture-game':1})));
  await page.goto(`${base}/shop/checkout`);
  await search().waitFor();
  await page.getByLabel('Recipient name',{exact:true}).fill('Fixture Customer');
  await page.getByLabel('Email for receipt',{exact:true}).fill('fixture@example.invalid');
  await page.getByLabel('Apartment / suite (optional)',{exact:true}).fill('Suite 7');
  await search().fill('123 Test Street');
  await page.getByRole('option',{name:result.formatted,exact:true}).click();
  await page.getByRole('button',{name:'Get shipping options',exact:true}).click();
  await page.getByLabel('Delivery service',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Apartment / suite (optional)',{exact:true}).inputValue(),'Suite 7');
  await search().fill('123 Test Street again');
  await page.getByRole('option',{name:result.formatted,exact:true}).waitFor();
  for(const theme of ['light']){
    await page.evaluate(theme=>{
      document.documentElement.classList.toggle('light',theme==='light');
      document.documentElement.classList.toggle('apple',theme==='apple');
    },theme);
    const styles=await search().evaluate(e=>({bg:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color}));
    assert.deepEqual(styles,{bg:'rgb(255, 255, 255)',color:'rgb(9, 45, 64)'});
  }
  for(const width of [1448,768,390,320]){
    await page.setViewportSize({width,height:1050});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Address search fits ${width}px`);
    const option=page.getByRole('option',{name:result.formatted,exact:true});
    assert.ok((await option.boundingBox()).height>=44);
  }
  await page.getByRole('option',{name:result.formatted,exact:true}).click();
  await page.getByLabel('City',{exact:true}).fill('Changed City');
  await page.getByLabel('Delivery service',{exact:true}).waitFor({state:'detached'});
  assert.equal(await page.getByLabel('Delivery service',{exact:true}).count(),0,'Changed address invalidates shipping quote');
  assert.equal(await page.getByRole('button',{name:'Continue to Stripe checkout',exact:true}).isDisabled(),true);
  assert.deepEqual(errors,[]);
  console.log('Address search browser checks passed: debounce, minimum length, US filtering, keyboard/click selection, manual correction, apartment preservation, provider failure/empty results, stale responses, no accidental submission, shipping invalidation, themes and 320-1448px layouts. All provider APIs are fixtures.');
}finally{await browser.close();}
