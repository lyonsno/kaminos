// kaminos-test: node
// While Kaminos starts, the page shows a neutral "Starting Kaminos…" state
// instead of the legacy sidebar, and asks the server for its runtime
// configuration once. The veil lifts when startup settles either way, and a
// failed startup leaves its error visible.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {settleStartupVeil, STARTING_CLASS} from '../startup-veil.mjs';
import {createRuntimeConfigLoader} from '../runtime-config-once.mjs';

function fakeDocument() {
  const classes = new Set([STARTING_CLASS]);
  const veil = {textContent: 'Starting Kaminos…', removed: false, remove() { this.removed = true; }};
  return {
    body: {classList: {add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c)}},
    getElementById: id => (id === 'kaminos-startup-veil' && !veil.removed ? veil : null),
    classes, veil,
  };
}

test('a successful startup lifts the veil and shows the workspace', async () => {
  const document = fakeDocument();
  await settleStartupVeil(document, Promise.resolve());
  assert.equal(document.classes.has(STARTING_CLASS), false);
  assert.equal(document.veil.removed, true);
});

test('a failed startup lifts the veil and leaves the reason visible', async () => {
  const document = fakeDocument();
  const failure = Promise.reject(new Error('WebGPU adapter unavailable'));
  await assert.rejects(settleStartupVeil(document, failure), /WebGPU adapter unavailable/);
  assert.equal(document.classes.has(STARTING_CLASS), false);
  assert.equal(document.classes.has('kaminos-startup-failed'), true);
  assert.equal(document.veil.removed, true);
});

test('settling twice is harmless', async () => {
  const document = fakeDocument();
  await settleStartupVeil(document, Promise.resolve());
  await settleStartupVeil(document, Promise.resolve());
  assert.equal(document.classes.has(STARTING_CLASS), false);
});

test('runtime configuration is requested once and shared', async () => {
  let calls = 0;
  const fetch = async (url, init) => {
    calls += 1;
    assert.equal(url, '/api/runtime-config');
    assert.equal(init.cache, 'no-store');
    return {ok: true, json: async () => ({sam3: {mounted: false}, hybridSplatOverlayModuleUrl: null})};
  };
  const load = createRuntimeConfigLoader(fetch);
  const [a, b] = await Promise.all([load(), load()]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  assert.deepEqual(a.sam3, {mounted: false});
});

test('a failed runtime configuration request is shared, then retried on the next call', async () => {
  let calls = 0;
  const fetch = async () => { calls += 1; return calls === 1 ? {ok: false, status: 503, json: async () => ({})} : {ok: true, json: async () => ({sam3: null})}; };
  const load = createRuntimeConfigLoader(fetch);
  await Promise.all([assert.rejects(load(), /runtime config 503/), assert.rejects(load(), /runtime config 503/)]);
  assert.equal(calls, 1);
  assert.deepEqual(await load(), {sam3: null});
  assert.equal(calls, 2);
});
