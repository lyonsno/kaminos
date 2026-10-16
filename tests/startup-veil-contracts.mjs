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

// The guard is a classic script in <head>, independent of the page module:
// an import failure, top-level throw or hang must not hide behind the veil.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const guardSource = readFileSync(new URL('../startup-veil-guard.js', import.meta.url), 'utf8');
function guardWorld({fetchImpl} = {}) {
  const listeners = {};
  const classes = new Set(['kaminos-starting']);
  const veil = {textContent: 'Starting Kaminos…', removed: false, children: [], style: {}, remove() { this.removed = true; }, append(node) { this.children.push(node); }};
  const timers = [];
  const document = {
    readyState: 'loading',
    body: {classList: {add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c)}},
    documentElement: {classList: {add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c)}},
    getElementById: id => (id === 'kaminos-startup-veil' && !veil.removed ? veil : null),
    createElement: () => ({textContent: '', addEventListener(type, fn) { this.onclick = fn; }}),
  };
  const window = {document, addEventListener: (type, fn) => { listeners[type] = fn; }, setTimeout: (fn, ms) => timers.push({fn, ms}),
    fetch: fetchImpl || (async () => ({ok: true, json: async () => ({sam3: null})}))};
  window.window = window;
  vm.runInNewContext(guardSource, window);
  return {window, listeners, classes, veil, timers};
}

test('a script error before startup settles lifts the veil and marks failure', () => {
  const world = guardWorld();
  world.listeners.error({message: 'Failed to fetch module ./fire-light-field-shadow.mjs'});
  assert.equal(world.classes.has('kaminos-starting'), false);
  assert.equal(world.classes.has('kaminos-startup-failed'), true);
  assert.equal(world.veil.removed, true);
});

test('an unhandled rejection before startup settles lifts the veil and marks failure', () => {
  const world = guardWorld();
  world.listeners.unhandledrejection({reason: new Error('requestAdapter rejected')});
  assert.equal(world.classes.has('kaminos-starting'), false);
  assert.equal(world.classes.has('kaminos-startup-failed'), true);
});

test('errors after startup has settled leave the page alone', () => {
  const world = guardWorld();
  world.classes.delete('kaminos-starting');
  world.listeners.error({message: 'later error'});
  assert.equal(world.classes.has('kaminos-startup-failed'), false);
});

test('a hung startup offers a way to see the page after the watchdog', () => {
  const world = guardWorld();
  const watchdog = world.timers.find(timer => timer.ms >= 15000);
  assert.ok(watchdog, 'a watchdog is armed');
  watchdog.fn();
  assert.match(world.veil.textContent, /Still starting/);
  assert.equal(world.veil.children.length, 1);
  world.veil.children[0].onclick();
  assert.equal(world.classes.has('kaminos-starting'), false);
  assert.equal(world.veil.removed, true);
});

test('the guard starts the runtime configuration request before the page module loads', async () => {
  let calls = 0;
  const world = guardWorld({fetchImpl: async (url, init) => { calls += 1; assert.equal(url, '/api/runtime-config'); assert.equal(init.cache, 'no-store'); return {ok: true, json: async () => ({sam3: {mounted: true}})}; }});
  assert.equal(calls, 1);
  const load = createRuntimeConfigLoader(async () => { throw new Error('the early request should be adopted'); }, world.window);
  assert.deepEqual((await load()).sam3, {mounted: true});
  assert.equal(calls, 1);
});

test('a missing image during startup is not a startup failure', () => {
  const world = guardWorld();
  world.listeners.error({target: {tagName: 'IMG'}});
  assert.equal(world.classes.has('kaminos-starting'), true);
  assert.equal(world.classes.has('kaminos-startup-failed'), false);
});

test('a module script that fails to load is a startup failure', () => {
  const world = guardWorld();
  world.listeners.error({target: {tagName: 'SCRIPT'}});
  assert.equal(world.classes.has('kaminos-startup-failed'), true);
});
