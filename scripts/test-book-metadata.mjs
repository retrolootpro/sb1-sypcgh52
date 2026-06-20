import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourcePath = resolve(root, 'lib/book-metadata-service.ts');
const source = readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
}).outputText;

const module = { exports: {} };
const load = new Function('exports', 'module', compiled);
load(module.exports, module);

const {
  normalizeBookIdentifier,
  isValidIsbn10,
  isValidIsbn13,
  isbn10ToIsbn13,
  lookupBookMetadataByBarcode,
} = module.exports;

assert.equal(isValidIsbn10('0-439-13636-9'), true, 'valid ISBN-10 should pass');
assert.equal(isbn10ToIsbn13('0439136369'), '9780439136365', 'ISBN-10 should convert to ISBN-13');
assert.equal(isValidIsbn13('9780439136365'), true, 'valid ISBN-13 should pass');
assert.equal(isValidIsbn13('9780439136366'), false, 'invalid ISBN-13 should fail');

const bookland = normalizeBookIdentifier('978043913636590000\n');
assert.equal(bookland.valid, true, 'Bookland EAN with scanner suffix should normalize');
assert.equal(bookland.isbn13, '9780439136365');

const retailUpc = normalizeBookIdentifier('078073003501');
assert.equal(retailUpc.valid, false, 'non-ISBN retail UPC should not be treated as reliable metadata');
assert.equal(retailUpc.kind, 'retail_upc');

globalThis.fetch = async (url) => {
  const text = String(url);
  if (text.includes('googleapis')) return jsonResponse({ items: [] });
  if (text.includes('/isbn/')) return jsonResponse({ title: 'Open Library Fallback', publishers: ['Fallback Press'], number_of_pages: 123 });
  if (text.includes('/search.json')) return jsonResponse({ docs: [{ title: 'Open Library Fallback', author_name: ['Test Author'], isbn: ['9780439136365'] }] });
  throw new Error(`Unexpected URL ${text}`);
};

const fallback = await lookupBookMetadataByBarcode('9780439136365');
assert.equal(fallback.title, 'Open Library Fallback', 'Open Library should be used when Google has no result');
assert.equal(fallback.publisher, 'Fallback Press');
assert.deepEqual(fallback.authors, ['Test Author']);

globalThis.fetch = async (url) => {
  const text = String(url);
  if (text.includes('googleapis')) return jsonResponse({ items: [] });
  if (text.includes('/isbn/')) return { ok: false, status: 404, json: async () => ({}) };
  if (text.includes('/search.json')) return jsonResponse({ docs: [] });
  throw new Error(`Unexpected URL ${text}`);
};

const missing = await lookupBookMetadataByBarcode('9780439136365');
assert.equal(missing, null, 'valid ISBN with no metadata should return null');

console.log('Book metadata tests passed');

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}
