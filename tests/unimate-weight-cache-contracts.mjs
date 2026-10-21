// kaminos-test: node
import assert from 'node:assert/strict';
import { fetchBytes } from '../models/unimate/unimate-generator.js';

const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
const bytes = new Uint8Array([3, 1, 4, 1, 5, 9, 2, 6]);
let stored, fetched, puts, deletes;
const cache = {
  async match() { return stored?.clone(); },
  async delete() { deletes++; stored = null; },
  async put(url, response) { puts++; stored = new Response(await response.arrayBuffer()); },
};
function reset() {
  stored = null; fetched = 0; puts = 0; deletes = 0;
  globalThis.caches = { open: async () => cache };
  globalThis.fetch = async () => { fetched++; return new Response(bytes, { headers: { 'content-length': String(bytes.length) } }); };
}
try {
  reset();
  const progress = [];
  assert.deepEqual(new Uint8Array(await fetchBytes('https://fixture/weights', (...p) => progress.push(p), { expectBytes: bytes.length })), bytes);
  assert.equal(fetched, 1); assert.equal(puts, 1);
  assert.deepEqual(new Uint8Array(await stored.clone().arrayBuffer()), bytes, 'cold cache stores the exact bytes');
  assert.deepEqual(new Uint8Array(await fetchBytes('https://fixture/weights', null, { expectBytes: bytes.length })), bytes);
  assert.equal(fetched, 1, 'warm cache avoids another download');
  assert.deepEqual(progress.at(-1), [bytes.length, bytes.length]);
  stored = new Response(new Uint8Array([0]));
  await fetchBytes('https://fixture/weights', () => {}, { expectBytes: bytes.length });
  assert.equal(deletes, 1); assert.equal(fetched, 2, 'bad cached length is replaced');
  reset();
  await assert.rejects(fetchBytes('https://fixture/weights', () => {}, { expectBytes: bytes.length + 1 }), /expected 9/);
  assert.equal(puts, 0, 'invalid downloaded length never becomes cached evidence');
  reset(); globalThis.fetch = async () => new Response('missing', { status: 404 });
  await assert.rejects(fetchBytes('https://fixture/weights', () => {}, { expectBytes: bytes.length }), /HTTP 404/);
  reset(); globalThis.caches = { open: async () => { throw new Error('storage unavailable'); } };
  assert.deepEqual(new Uint8Array(await fetchBytes('https://fixture/weights', () => {}, { expectBytes: bytes.length })), bytes);
  assert.equal(puts, 0, 'storage refusal preserves the successful download');
} finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }
console.log('weight cache contracts: pass');
