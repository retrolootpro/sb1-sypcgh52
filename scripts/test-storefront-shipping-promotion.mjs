import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const modules=new Map();
function load(file){
  file=resolve(file);if(modules.has(file))return modules.get(file);
  const module={exports:{}};
  new Function('module','exports','require',ts.transpileModule(readFileSync(file,'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
  }).outputText)(module,module.exports,name=>name.startsWith('./')?load(resolve(file,'..',`${name}.ts`)):require(name));
  modules.set(file,module.exports);return module.exports;
}
const {shippingPromotion,shippingAllowance}=load('lib/storefront-shipping-promotion.ts');
const {shippingPackages,shippingParcels}=load('lib/storefront-shipping.ts');
const pack=(value,mode='eligible')=>({value,mode});
test('enforces exact subtotal, dollar cap and percentage boundaries',()=>{
  assert.equal(shippingPromotion([525],[pack(4999)]).amount,0);
  assert.equal(shippingPromotion([573],[pack(4407)]).amount,0);
  assert.equal(shippingPromotion([573],[pack(3488)]).amount,573);
  assert.equal(shippingPromotion([573],[pack(3819)]).amount,573);
  assert.equal(shippingPromotion([573],[pack(3820)]).amount,0);
  assert.equal(shippingPromotion([750],[pack(5000)]).amount,0);
  assert.equal(shippingPromotion([751],[pack(5000)]).amount,751);
  assert.equal(shippingPromotion([800],[pack(6000)]).amount,0);
  assert.equal(shippingPromotion([801],[pack(10000)]).amount,801);
  assert.equal(shippingAllowance(5333),799);
  assert.equal(shippingAllowance(5334),800);
});
test('quoted goal reflects percentage cap with no minimum spend',()=>{
  assert.equal(shippingPromotion([800],[pack(4000)]).goal,5334);
  assert.equal(shippingPromotion([750],[pack(4000)]).goal,5000);
  assert.equal(shippingPromotion([801],[pack(4000)]).goal,null);
  assert.equal(shippingPromotion([573],[pack(3488)]).goal,3820);
});
test('individual free offers waive only the minimum and protect low-priced items',()=>{
  assert.equal(shippingPromotion([500],[pack(1000,'free')]).amount,500);
  assert.equal(shippingPromotion([400],[pack(3000,'free')]).amount,0);
  assert.equal(shippingPromotion([801],[pack(10000,'free')]).amount,801);
});
test('mixed carts cover only exclusively promoted packages and cap the combined subsidy',()=>{
  const mixed=shippingPromotion([400,500],[pack(3000,'free'),pack(2000)]);
  assert.equal(mixed.discount,0);assert.equal(mixed.amount,900);
  assert.equal(shippingPromotion([400,200],[pack(3000),pack(6000,'excluded')]).amount,200);
  assert.equal(shippingPromotion([500,500],[pack(5000,'free'),pack(5000,'free')]).amount,1000,'No per-parcel cap loophole');
  assert.equal(shippingPromotion([400,200],[pack(3000,'free'),pack(6000,'excluded')]).amount,200);
  assert.equal(shippingPromotion([400],[pack(6000,'excluded')]).amount,400);
});
const profile={id:'50000000-0000-4000-8000-000000000001',name:'Games',category:'Games',platform:'',condition:'',
  unitWeightOz:5,packagingWeightOz:2,lengthIn:11,widthIn:8.5,heightIn:2,unitsPerParcel:2};
const line={id:'game',quantity:1,unit_amount:3000,title:'Game',category:'Games',platform:'PS3',condition:'CIB',shippingPromotion:'free'};
test('packing attributes value and eligibility to actual parcel contents while preserving dimensions',()=>{
  const lines=[line,{...line,id:'other',unit_amount:1000,quantity:2,shippingPromotion:'eligible'}];
  const packages=shippingPackages(lines,[profile]);
  assert.deepEqual(packages.map(p=>({value:p.value,mode:p.mode})),[{value:4000,mode:'eligible'},{value:1000,mode:'eligible'}]);
  assert.deepEqual(packages.map(p=>p.parcel),shippingParcels(lines,[profile]));
  assert.equal(packages[0].parcel.weight,'12.000');
  assert.equal(shippingPackages([line,{...line,shippingPromotion:'excluded'}],[profile])[0].mode,'excluded');
});
