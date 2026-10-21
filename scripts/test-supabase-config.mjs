import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';

const source = ts.transpileModule(readFileSync(new URL('../lib/supabase.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function load(env, clientFactory = createClient) {
  const module = { exports: {} };
  new Function('module', 'exports', 'require', 'process', source)(
    module, module.exports, () => ({ createClient: clientFactory }), { env },
  );
  return module.exports.supabase;
}

test('missing Supabase configuration fails explicitly without creating a dummy client', () => {
  for (const env of [{}, { NEXT_PUBLIC_SUPABASE_URL: 'https://test.invalid' }, { NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-key' }]) {
    assert.throws(() => load(env, () => assert.fail('Must not create an unconfigured client')), /must be configured before building or running/);
  }
});

test('configured browser client preserves session persistence and token refresh defaults', async () => {
  const client = load({
    NEXT_PUBLIC_SUPABASE_URL: 'https://test.invalid',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-key',
  });
  assert.equal(client.supabaseUrl, 'https://test.invalid');
  assert.equal(client.auth.persistSession, true);
  assert.equal(client.auth.autoRefreshToken, true);
  await client.auth.stopAutoRefresh();
});
