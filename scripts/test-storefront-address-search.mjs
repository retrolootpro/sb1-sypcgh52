import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';

const module={exports:{}};
new Function('module','exports','require',ts.transpileModule(readFileSync('lib/storefront-address-search.ts','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
}).outputText)(module,module.exports,createRequire(import.meta.url));
const {addressSuggestions}=module.exports;
const complete={formatted:'123 Test Street, Test City, FL 32092, United States',housenumber:'123',street:'Test Street',city:'Test City',state_code:'FL',postcode:'32092',country_code:'us'};
test('maps complete US addresses without guessing fields',()=>{
  assert.deepEqual(addressSuggestions({results:[complete]}),[{label:complete.formatted,line1:'123 Test Street',city:'Test City',state:'FL',postal_code:'32092',country:'US'}]);
  assert.equal(addressSuggestions({results:[{...complete,state_code:'US-FL',postcode:'32092-1234'}]})[0].state,'FL');
});
test('omits partial, non-US, invalid state/ZIP and oversized street addresses',()=>{
  for(const patch of [{housenumber:undefined},{street:undefined},{city:undefined},{state_code:undefined},{state_code:'Florida'},{postcode:undefined},{postcode:'invalid'},{country_code:'ca'},{street:'a'.repeat(121)}]){
    if(patch.street?.length>120)assert.throws(()=>addressSuggestions({results:[{...complete,...patch}]}));
    else assert.deepEqual(addressSuggestions({results:[{...complete,...patch}]}),[]);
  }
});
test('deduplicates and bounds suggestions and rejects malformed provider responses',()=>{
  assert.equal(addressSuggestions({results:[complete,complete]}).length,1);
  assert.equal(addressSuggestions({results:Array.from({length:12},(_,i)=>({...complete,formatted:`${i} Test Street`}))}).length,5);
  assert.throws(()=>addressSuggestions({error:'provider unavailable'}));
  assert.throws(()=>addressSuggestions({results:[{formatted:3}]}));
});
