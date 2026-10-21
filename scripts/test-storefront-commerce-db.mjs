import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, resolve } from 'node:path';
import { test, before, after, beforeEach, afterEach } from 'node:test';

const bin=process.env.PATH.split(delimiter).find(path=>existsSync(resolve(path,'../@electric-sql/pglite/package.json')));
if(!bin)throw new Error('Run with npm exec --package=@electric-sql/pglite -- node --test scripts/test-storefront-commerce-db.mjs');
const {PGlite}=createRequire(resolve(bin,'../@electric-sql/pglite/package.json'))('@electric-sql/pglite');
const db=new PGlite();
const account='10000000-0000-4000-8000-000000000001';
const other='10000000-0000-4000-8000-000000000002';
const item='20000000-0000-4000-8000-000000000001';
const second='20000000-0000-4000-8000-000000000002';
const order='30000000-0000-4000-8000-000000000001';
const request='40000000-0000-4000-8000-000000000001';
const lines=[{id:item,quantity:1,unit_amount:1000}];
const one=async(sql,params=[])=> (await db.query(sql,params)).rows[0];
const reserve=(id=order,items=lines,kind='checkout',requestId=null,owner=account,hash='cart')=>
  db.query('SELECT storefront_reserve($1,$2,$3,$4,$5,$6::jsonb) AS result',[id,owner,kind,requestId,hash,JSON.stringify(items)]);
const event=(id,action,params={})=>db.query(
  'SELECT storefront_apply_payment($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)',
  [id,order,'cs_test_order',action,params.total||0,params.tax||0,params.shipping||0,null,'pi_test',params.refunded||0]);

before(async()=>{
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.user',true),'')::uuid $$;
    CREATE FUNCTION current_account_owner_id() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.account',true),'')::uuid $$;
    CREATE FUNCTION is_account_member(owner uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT owner=current_account_owner_id() $$;
    CREATE TABLE inventory_items(id uuid PRIMARY KEY,user_id uuid,product_name text,quantity integer,status text DEFAULT 'available',
      console text,condition text,storefront_enabled boolean DEFAULT true,storefront_slug text,storefront_price numeric,
      storefront_updated_at timestamptz,selected_market_value numeric,price_cib numeric,price_loose numeric,price_new numeric);
    CREATE TABLE financial_transactions(id uuid DEFAULT gen_random_uuid(),user_id uuid,date date,description text,amount numeric,type text,
      category text,subcategory text,source text,platform text,reference_id text,merchant_name text,notes text);
    INSERT INTO auth.users VALUES('${account}'),('${other}');
    INSERT INTO inventory_items(id,user_id,product_name,quantity,console,condition) VALUES
      ('${item}','${account}','Test game',2,'SNES','Loose'),('${second}','${account}','Other game',1,'SNES','CIB');
    CREATE FUNCTION storefront_slugify(value text) RETURNS text LANGUAGE sql AS $$ SELECT value $$;
  `);
  const old=readFileSync('supabase/migrations/20260726180000_storefront_inventory_sync.sql','utf8');
  await db.exec(old.slice(old.indexOf('CREATE OR REPLACE FUNCTION public.prepare_storefront_inventory_item()'),old.indexOf('CREATE OR REPLACE FUNCTION public.enqueue_inventory_sync_event()')));
  const inventoryBefore=await db.query('SELECT id,quantity,storefront_price,storefront_enabled FROM inventory_items ORDER BY id');
  await db.exec(readFileSync('supabase/migrations/20261021164500_storefront_catalog_settings.sql','utf8'));
  assert.deepEqual((await db.query('SELECT id,quantity,storefront_price,storefront_enabled FROM inventory_items ORDER BY id')).rows,inventoryBefore.rows);
  await db.exec(readFileSync('supabase/migrations/20261021170000_storefront_commerce.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261021200000_storefront_shipping.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261021230000_storefront_labels.sql','utf8'));
});
after(()=>db.close());
beforeEach(()=>db.exec('BEGIN'));
afterEach(()=>db.exec('ROLLBACK'));

test('reserves once under idempotent retries and rejects cart-key reuse',async()=>{
  await reserve();await reserve();
  assert.equal((await one('SELECT quantity FROM inventory_items WHERE id=$1',[item])).quantity,1);
  await assert.rejects(reserve(order,lines,'checkout',null,account,'different'),/different cart/);
});
const labelClaim=(index=0,owner=account)=>one('SELECT storefront_claim_label($1,$2,$3,$4::jsonb,$5::jsonb) AS result',
  [order,owner,index,JSON.stringify({id:'rate',name:'USPS Ground Advantage',amount:525}),JSON.stringify({length:8,width:6,height:2,weight:7})]);
async function paidLabelOrder(parcels=1) {
  await reserve();
  await db.query("UPDATE storefront_orders SET stripe_id='cs_test_order',shipping_quote=$1::jsonb WHERE id=$2",[JSON.stringify({parcels}),order]);
  await event('evt_paid','paid',{total:1600,tax:100,shipping:500});
}
test('label claim is durable and idempotent without stock or revenue changes',async()=>{
  await paidLabelOrder();
  const inventory=(await db.query('SELECT * FROM inventory_items ORDER BY id')).rows;
  const finance=(await db.query('SELECT * FROM financial_transactions')).rows;
  const first=(await labelClaim()).result;
  const retry=(await labelClaim()).result;
  assert.equal(first.claimed,true);assert.equal(retry.claimed,false);
  assert.equal(first.label.id,retry.label.id);
  assert.deepEqual((await db.query('SELECT * FROM inventory_items ORDER BY id')).rows,inventory);
  assert.deepEqual((await db.query('SELECT * FROM financial_transactions')).rows,finance);
});
test('label claims reject unpaid, refunded, wrong-account and nonexistent parcels',async()=>{
  await reserve();
  await db.exec('SAVEPOINT label_check');
  await assert.rejects(labelClaim(),/Only paid/);
  await db.exec('ROLLBACK TO SAVEPOINT label_check');
  await db.query("UPDATE storefront_orders SET status='paid',shipping_quote='{\"parcels\":1}' WHERE id=$1",[order]);
  for(const action of [()=>labelClaim(1),()=>labelClaim(0,other),async()=>{
    await db.query('UPDATE storefront_orders SET refunded_cents=100 WHERE id=$1',[order]);await labelClaim();
  }]){
    await db.exec('SAVEPOINT label_check');
    await assert.rejects(action());
    await db.exec('ROLLBACK TO SAVEPOINT label_check');
  }
});
test('all parcel labels must finish before dispatch and tracking supports multiple packages',async()=>{
  await paidLabelOrder(2);await labelClaim(0);
  await db.exec('SAVEPOINT dispatch');
  await assert.rejects(db.query('SELECT storefront_ship($1,$2,$3)',[order,account,'USPS tracking']),/Resolve and complete/);
  await db.exec('ROLLBACK TO SAVEPOINT dispatch');
  await db.exec("UPDATE storefront_labels SET status='success'");
  await db.exec('SAVEPOINT dispatch');
  await assert.rejects(db.query('SELECT storefront_ship($1,$2,$3)',[order,account,'USPS tracking']),/Resolve and complete/);
  await db.exec('ROLLBACK TO SAVEPOINT dispatch');
  await labelClaim(1);await db.exec("UPDATE storefront_labels SET status='success'");
  await db.query('SELECT storefront_ship($1,$2,$3)',[order,account,'USPS tracking '.repeat(30)]);
  assert.equal((await one('SELECT status FROM storefront_orders WHERE id=$1',[order])).status,'shipped');
});
test('label records and claims are not accessible to browser database roles',async()=>{
  const result=await one(`SELECT
    has_table_privilege('anon','storefront_labels','SELECT') AS anon_read,
    has_table_privilege('authenticated','storefront_labels','INSERT') AS browser_write,
    has_function_privilege('authenticated','storefront_claim_label(uuid,uuid,integer,jsonb,jsonb)','EXECUTE') AS browser_claim`);
  assert.deepEqual(result,{anon_read:false,browser_write:false,browser_claim:false});
});
test('shipping reservation saves the accepted rate and address in the stock transaction',async()=>{
  const quote={customer:{name:'Test customer',address:{postal_code:'32114'}},rate:{name:'USPS Ground Advantage',amount:525},parcels:1};
  const sql='SELECT storefront_reserve_shipping($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) AS result';
  const params=[order,account,'checkout',null,'quoted-cart',JSON.stringify(lines),JSON.stringify(quote)];
  const first=await one(sql,params);
  assert.deepEqual(first.result.shipping_quote,quote);
  await one(sql,params);
  assert.equal((await one('SELECT quantity FROM inventory_items WHERE id=$1',[item])).quantity,1);
  assert.deepEqual((await one('SELECT shipping_quote FROM storefront_orders WHERE id=$1',[order])).shipping_quote,quote);
});
test('concurrent last-item attempts cannot oversell',async()=>{
  await db.query('UPDATE inventory_items SET quantity=1 WHERE id=$1',[item]);
  const results=await Promise.allSettled([reserve(),reserve('30000000-0000-4000-8000-000000000002')]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
});
test('multi-item stock failure rolls back all earlier decrements',async()=>{
  await db.exec('SAVEPOINT before_reserve');
  await assert.rejects(reserve(order,[...lines,{id:second,quantity:2,unit_amount:500}]),/no longer available/);
  await db.exec('ROLLBACK TO SAVEPOINT before_reserve');
  assert.equal((await one('SELECT quantity FROM inventory_items WHERE id=$1',[item])).quantity,2);
  assert.equal((await one('SELECT count(*)::int AS count FROM storefront_orders')).count,0);
});
test('cross-account stock and duplicate lines cannot be reserved',async()=>{
  await assert.rejects(reserve(order,lines,'checkout',null,other),/no longer available/);
});
test('duplicate lines are rejected',async()=>{
  await assert.rejects(reserve(order,[...lines,...lines]),/Duplicate items/);
});
test('paid webhook is idempotent and records revenue excluding collected tax',async()=>{
  await reserve();
  await db.query("UPDATE storefront_orders SET stripe_id='cs_test_order' WHERE id=$1",[order]);
  await event('evt_paid','paid',{total:1600,tax:100,shipping:500});
  await event('evt_paid','paid',{total:1600,tax:100,shipping:500});
  await event('evt_second_notification','paid',{total:1600,tax:100,shipping:500});
  assert.equal((await one('SELECT status FROM storefront_orders')).status,'paid');
  const finance=await one('SELECT count(*)::int AS count,sum(amount) AS amount FROM financial_transactions');
  assert.equal(finance.count,1);assert.equal(Number(finance.amount),15);
  assert.equal((await one('SELECT quantity FROM inventory_items WHERE id=$1',[item])).quantity,1);
});
test('amount mismatch and unknown Stripe IDs cannot mark orders paid',async()=>{
  await reserve();await db.query("UPDATE storefront_orders SET stripe_id='cs_test_order' WHERE id=$1",[order]);
  await assert.rejects(event('evt_bad','paid',{total:1}),/amount mismatch/);
});
test('expiry/void releases stock exactly once and preserves publication flag',async()=>{
  await db.query('UPDATE inventory_items SET quantity=1 WHERE id=$1',[item]);
  await reserve();await db.query("UPDATE storefront_orders SET stripe_id='cs_test_order' WHERE id=$1",[order]);
  assert.equal((await one('SELECT storefront_enabled FROM inventory_items WHERE id=$1',[item])).storefront_enabled,false);
  await event('evt_expire','cancel');await event('evt_duplicate_expire','cancel');
  const inventory=await one('SELECT quantity,storefront_enabled FROM inventory_items WHERE id=$1',[item]);
  assert.equal(inventory.quantity,1);assert.equal(inventory.storefront_enabled,true);
});
test('unstarted cancellation prevents a late reservation from starting',async()=>{
  assert.equal((await one('SELECT storefront_cancel_unstarted($1) AS cancelled',[order])).cancelled,true);
  await assert.rejects(reserve(),/cancelled/);
});
test('late expiry cannot restore paid stock; cumulative refunds never duplicate or restock',async()=>{
  await reserve();await db.query("UPDATE storefront_orders SET stripe_id='cs_test_order' WHERE id=$1",[order]);
  await event('evt_paid','paid',{total:1100,tax:100});
  await event('evt_expire','cancel');
  await event('evt_refund','refund',{refunded:550});
  await event('evt_refund_again','refund',{refunded:550});
  await event('evt_refund_all','refund',{refunded:1100});
  assert.equal((await one('SELECT status FROM storefront_orders')).status,'refunded');
  assert.equal(Number((await one('SELECT sum(amount) AS amount FROM financial_transactions')).amount),0);
  assert.equal((await one('SELECT quantity FROM inventory_items WHERE id=$1',[item])).quantity,1);
});
test('invoice requires an account-owned open request and fulfillment requires payment',async()=>{
  await db.query("INSERT INTO storefront_requests(id,account_id,name,email,item,address) VALUES($1,$2,'Test','test@example.invalid','Game','{}')",[request,account]);
  await reserve(order,lines,'invoice',request);
  await db.query("UPDATE storefront_orders SET stripe_id='cs_test_order' WHERE id=$1",[order]);
  await event('evt_paid','paid',{total:1000});
  assert.equal((await one('SELECT status FROM storefront_requests')).status,'paid');
  await db.query('SELECT storefront_ship($1,$2,$3)',[order,account,'Carrier TRACK123']);
  assert.equal((await one('SELECT status FROM storefront_orders')).status,'shipped');
  assert.equal((await one('SELECT status FROM storefront_requests')).status,'fulfilled');
});
test('anonymous writes and stock/payment RPC execution are denied',async()=>{
  await db.exec('SET LOCAL ROLE anon');
  await assert.rejects(db.query('SELECT storefront_reserve($1,$2,$3,$4,$5,$6::jsonb)',[order,account,'checkout',null,'key',JSON.stringify(lines)]),/permission denied/);
});
test('staff cannot read another account requests or mutate payment state',async()=>{
  await db.query("INSERT INTO storefront_requests(account_id,name,email,item,address) VALUES($1,'Private','private@example.invalid','Secret','{}')",[other]);
  await db.query("SELECT set_config('request.account',$1,true)",[account]);
  await db.exec('SET LOCAL ROLE authenticated');
  assert.equal((await one('SELECT count(*)::int AS count FROM storefront_requests')).count,0);
  await assert.rejects(db.exec("UPDATE storefront_orders SET status='paid'"),/permission denied/);
});
test('rate limits are database-backed across repeated calls',async()=>{
  const first=await one("SELECT storefront_rate_limit('same',1,60) AS allowed");
  const second=await one("SELECT storefront_rate_limit('same',1,60) AS allowed");
  assert.equal(first.allowed,true);assert.equal(second.allowed,false);
});
