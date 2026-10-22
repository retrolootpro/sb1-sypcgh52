import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { NextRequest } from 'next/server.js';

const require = createRequire(import.meta.url);
const owner = '10000000-0000-4000-8000-000000000001';
const employee = '10000000-0000-4000-8000-000000000002';
function harness({ userId = owner, role = 'admin', status = 'active', accountId = owner, databaseError = false, authError = false, emailConfirmed = true } = {}) {
  const reads = [];
  const writes = [];
  const admin = {
    auth: { getUser: async () => ({ data: { user: authError ? null : { id: userId, email: 'team@example.invalid', email_confirmed_at: emailConfirmed ? '2026-01-01T00:00:00Z' : null } }, error: authError ? new Error('Invalid token') : null }) },
    from(table) {
      const filters = {};
      const chain = {
        select() { return chain; }, eq(key, value) { filters[key] = value; return chain; },
        single() { return chain; }, maybeSingle() { return chain; }, order() { return chain; }, limit() { return chain; },
        update(patch) { writes.push({ table, filters, patch }); return chain; },
        then(done) {
          reads.push({ table, filters });
          const data = table === 'storefront_settings' ? { user_id: owner }
            : accountId === filters.account_owner_id && status === filters.status ? { id: 'membership', account_owner_id: accountId, user_id: userId, role, status } : null;
          return Promise.resolve({ data, error: databaseError ? new Error('Unavailable') : null }).then(done);
        },
      };
      return chain;
    },
  };
  const modules = new Map();
  function load(file) {
    file = resolve(file);
    if (file.endsWith('/server/supabase-admin.ts')) return { createSupabaseAdmin: () => admin };
    if (modules.has(file)) return modules.get(file);
    const module = { exports: {} };
    const output = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
    new Function('module', 'exports', 'require', 'console', output)(module, module.exports, name => {
      if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`);
      if (name.startsWith('./')) return load(resolve(file, '..', `${name}.ts`));
      if (name === '@supabase/supabase-js') return { createClient: () => admin };
      return require(name);
    }, { error() {} });
    modules.set(file, module.exports);
    return module.exports;
  }
  return { load, reads, writes };
}

test('business routes preserve nested bookmarks, query strings and hashes without touching shop or callback URLs', () => {
  const { businessPath, legacyBusinessPath, businessModules } = harness().load('lib/business-routes.ts');
  for (const module of businessModules) {
    const old = `/${module}`;
    assert.equal(legacyBusinessPath(businessPath(old)), old);
  }
  assert.equal(businessPath('/inventory/item-123?tab=pricing#photos'), '/business/inventory/item-123?tab=pricing#photos');
  assert.equal(businessPath('/storefront/requests?status=paid'), '/business/orders?status=paid');
  for (const path of ['/shop/checkout?session_id=cs_test', '/api/storefront/webhook', '/auth/ebay/callback', '/business/orders', '/']) assert.equal(businessPath(path), path);
  assert.equal(legacyBusinessPath('/business/not-real'), null);
});
test('login return destination rejects external and public URLs', () => {
  const { staffReturnPath } = harness().load('lib/business-routes.ts');
  assert.equal(staffReturnPath('/finance?tab=taxes'), '/business/finance?tab=taxes');
  assert.equal(staffReturnPath('/business/inventory/123?tab=pricing'), '/business/inventory/123?tab=pricing');
  for (const input of [null, '//evil.invalid', '/\\evil.invalid', 'https://evil.invalid', '/shop', '/login', '/business/../shop', '/business/not-real', '/%5c%5cevil.invalid']) assert.equal(staffReturnPath(input), '/business');
});
test('middleware redirects legacy bookmarks and rewrites canonical business URLs without loops', () => {
  const { middleware } = harness().load('middleware.ts');
  const redirect = middleware(new NextRequest('https://example.invalid/inventory/123?tab=pricing'));
  assert.equal(redirect.status, 307);
  assert.equal(redirect.headers.get('location'), 'https://example.invalid/business/inventory/123?tab=pricing');
  const rewrite = middleware(new NextRequest('https://example.invalid/business/orders?status=paid'));
  assert.equal(rewrite.headers.get('x-middleware-rewrite'), 'https://example.invalid/storefront/requests?status=paid');
  assert.equal(rewrite.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(middleware(new NextRequest('https://example.invalid/api/storefront/webhook')).headers.get('location'), null);
});
test('session requires a verified token and active membership in the configured company', async () => {
  const get = h => h.load('app/api/business/session/route.ts').GET(new NextRequest('https://example.invalid/api/business/session', { headers: { Authorization: 'Bearer fixture' } }));
  for (const [options, expected] of [[{}, 200], [{ userId: employee, role: 'user' }, 200], [{ status: 'revoked' }, 403], [{ status: 'invited' }, 403], [{ accountId: employee }, 403], [{ authError: true }, 401], [{ databaseError: true }, 503]]) {
    const h = harness(options), response = await get(h);
    assert.equal(response.status, expected);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    if (expected === 200) {
      const data = await response.json();
      assert.equal(data.accountId, owner); assert.equal(data.accountRole, options.role || 'admin');
    }
    if (expected !== 401 && !options.databaseError) assert.equal(h.reads.find(r => r.table === 'user_account_memberships').filters.account_owner_id, owner);
  }
  const noToken = await harness().load('app/api/business/session/route.ts').GET(new NextRequest('https://example.invalid/api/business/session'));
  assert.equal(noToken.status, 401);
});
test('server account resolution does not bootstrap a new owner or fall back during outages', async () => {
  const h = harness({ userId: employee, role: 'user' });
  assert.deepEqual(await h.load('lib/server-account.ts').getServerAccountContext({}, { id: employee }), { accountId: owner, role: 'user' });
  for (const options of [{ status: 'revoked' }, { accountId: employee }, { databaseError: true }]) {
    await assert.rejects(harness(options).load('lib/server-account.ts').getServerAccountContext({}, { id: owner }));
  }
});
test('invite acceptance is verified, scoped to the configured company and preserves the invited role', async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  const accept = h => h.load('app/api/team/accept-invite/route.ts').POST(new NextRequest('https://example.invalid/api/team/accept-invite', { method: 'POST', headers: { Authorization: 'Bearer fixture' } }));
  const h = harness({ status: 'invited', role: 'user' });
  assert.equal((await accept(h)).status, 200);
  assert.equal(h.writes.length, 1);
  assert.equal(h.reads.find(r => r.table === 'user_account_memberships').filters.account_owner_id, owner);
  assert.equal(h.writes[0].filters.status, 'invited');
  assert.equal(h.writes[0].patch.user_id, owner);
  assert.equal(Object.hasOwn(h.writes[0].patch, 'role'), false);
  const unverified = harness({ status: 'invited', emailConfirmed: false });
  assert.equal((await accept(unverified)).status, 401); assert.equal(unverified.writes.length, 0);
  const unrelated = harness({ status: 'invited', accountId: employee });
  assert.equal((await accept(unrelated)).status, 200); assert.equal(unrelated.writes.length, 0);
  const outage = harness({ status: 'invited', databaseError: true });
  assert.equal((await accept(outage)).status, 500); assert.equal(outage.writes.length, 0);
});
