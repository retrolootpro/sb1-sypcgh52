import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, resolve } from 'node:path';
import { test, before, after, beforeEach, afterEach } from 'node:test';

const bin = process.env.PATH.split(delimiter).find(path => existsSync(resolve(path, '../@electric-sql/pglite/package.json')));
if (!bin) throw new Error('Run with npm exec --package=@electric-sql/pglite -- node --test scripts/test-business-access-db.mjs');
const { PGlite } = createRequire(resolve(bin, '../@electric-sql/pglite/package.json'))('@electric-sql/pglite');
const db = new PGlite();
const owner = '10000000-0000-4000-8000-000000000001', staff = '10000000-0000-4000-8000-000000000002', stranger = '10000000-0000-4000-8000-000000000003';
const rows = async sql => (await db.query(sql)).rows;
async function login(id, role = 'authenticated') {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.user',$1,true)", [id]);
  await db.exec(`SET ROLE ${role}`);
}
before(async () => {
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE anon;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.user',true),'')::uuid $$;
    CREATE TABLE storefront_settings(user_id uuid, public_slug text, is_active boolean);
    INSERT INTO storefront_settings VALUES('${owner}','pixel-and-page',true);
    CREATE TABLE user_account_memberships(id uuid DEFAULT gen_random_uuid(), account_owner_id uuid, user_id uuid, email text, role text, status text);
    INSERT INTO user_account_memberships(account_owner_id,user_id,email,role,status) VALUES
      ('${owner}','${owner}','owner@example.invalid','admin','active'),
      ('${owner}','${staff}','staff@example.invalid','user','active'),
      ('${stranger}','${stranger}','stranger@example.invalid','admin','active');
    CREATE TABLE inventory_items(id int, user_id uuid, quantity int);
    INSERT INTO inventory_items VALUES(1,'${owner}',5),(2,'${stranger}',3);
    CREATE TABLE financial_transactions(id int, amount numeric);
    INSERT INTO financial_transactions VALUES(1,123.45);
    CREATE TABLE storefront_orders(id int, status text);
    INSERT INTO storefront_orders VALUES(1,'paid');
    ALTER TABLE user_account_memberships ENABLE ROW LEVEL SECURITY;
    ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE storefront_settings ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "old membership read" ON user_account_memberships FOR SELECT TO authenticated USING(user_id=auth.uid());
    CREATE POLICY "Admins can invite account members" ON user_account_memberships FOR INSERT TO authenticated WITH CHECK(account_owner_id=auth.uid());
    CREATE POLICY "Admins and invitees can update account memberships" ON user_account_memberships FOR UPDATE TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
    CREATE POLICY "old owner access" ON inventory_items FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
    CREATE POLICY "team read" ON inventory_items FOR SELECT TO authenticated USING(user_id='${owner}');
    GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role,anon;
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated,service_role;
  `);
  const tables = ['user_account_memberships', 'inventory_items', 'financial_transactions', 'storefront_orders', 'storefront_settings'];
  const before = await Promise.all(tables.map(table => rows(`SELECT * FROM ${table} ORDER BY 1`)));
  await db.exec(readFileSync('supabase/migrations/20261022150000_pixel_page_business_access.sql', 'utf8'));
  assert.deepEqual(await Promise.all(tables.map(table => rows(`SELECT * FROM ${table} ORDER BY 1`))), before, 'Migration must not change existing records');
});
after(() => db.close());
beforeEach(() => db.exec('BEGIN'));
afterEach(() => db.exec('ROLLBACK; RESET ROLE'));
test('owner and employee keep the company context and their existing roles', async () => {
  for (const [id, role] of [[owner, 'admin'], [staff, 'user']]) {
    await login(id);
    const [context] = await rows('SELECT current_account_owner_id() AS owner,current_account_role() AS role');
    assert.deepEqual(context, { owner, role });
    assert.equal((await rows(`SELECT * FROM inventory_items WHERE user_id='${owner}'`)).length, 1);
  }
});
test('unrelated existing owner cannot read business data or use legacy self-bootstrap permissions', async () => {
  await login(stranger);
  assert.deepEqual(await rows('SELECT current_account_owner_id() AS owner,current_account_role() AS role'), [{ owner: null, role: null }]);
  assert.equal((await rows('SELECT * FROM inventory_items')).length, 0);
  await assert.rejects(db.exec(`INSERT INTO user_account_memberships(account_owner_id,user_id,role,status) VALUES('${stranger}','${stranger}','admin','active')`));
});
test('employee cannot change role or reinstate a revoked membership', async () => {
  await login(staff);
  await db.exec(`UPDATE user_account_memberships SET role='admin' WHERE user_id='${staff}'`);
  await db.exec('RESET ROLE');
  assert.equal((await rows(`SELECT role FROM user_account_memberships WHERE user_id='${staff}'`))[0].role, 'user');
  await db.exec(`UPDATE user_account_memberships SET status='revoked' WHERE user_id='${staff}'`);
  await login(staff);
  assert.equal((await rows('SELECT * FROM inventory_items')).length, 0);
  await db.exec(`UPDATE user_account_memberships SET status='active' WHERE user_id='${staff}'`);
  await db.exec('RESET ROLE');
  assert.equal((await rows(`SELECT status FROM user_account_memberships WHERE user_id='${staff}'`))[0].status, 'revoked');
});
test('owner can invite but pending invite does not grant business access', async () => {
  await login(owner);
  await db.exec(`INSERT INTO user_account_memberships(account_owner_id,user_id,email,role,status) VALUES('${owner}',null,'invite@example.invalid','user','invited')`);
  await login(stranger);
  assert.equal((await rows('SELECT * FROM inventory_items')).length, 0);
});
test('service workflows retain access and anonymous account helpers disclose no business access', async () => {
  await login('', 'service_role');
  assert.equal((await rows('SELECT * FROM inventory_items')).length, 2);
  await login('', 'anon');
  await assert.rejects(rows('SELECT current_account_owner_id() AS owner'));
});
