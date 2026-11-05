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
function guardWorld({fetchImpl,hash=''} = {}) {
  const listeners = {};
  const classes = new Set(['kaminos-starting']);
  const veil = {textContent: 'Starting Kaminos…', removed: false, children: [], style: {}, remove() { this.removed = true; }, append(node) { this.children.push(node); }};
  const timers = [];
  let clock=0;
  const nodes=Object.fromEntries(['phase','elapsed','delay','actions'].map(key=>[key,{textContent:'',children:[],append(node){this.children.push(node);}}]));
  const document = {
    readyState: 'loading',
    addEventListener(type,fn){listeners[type]=fn;},
    body: {classList: {add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c)}},
    documentElement: {classList: {add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c)}},
    getElementById: id => id==='kaminos-startup-veil'?(!veil.removed?veil:null):nodes[id.replace('kaminos-startup-','')]??null,
    createElement: () => ({textContent: '', addEventListener(type, fn) { this.onclick = fn; }}),
  };
  const window = {document, URLSearchParams,location:{hash}, addEventListener: (type, fn) => { listeners[type] = fn; }, setTimeout: (fn, ms) => {const timer={fn,ms,cancelled:false};timers.push(timer);return timer;},clearTimeout: timer=>{if(timer)timer.cancelled=true;},performance:{now:()=>clock},
    fetch: fetchImpl || (async () => ({ok: true, json: async () => ({sam3: null})}))};
  window.window = window;
  vm.runInNewContext(guardSource, window);
  document.defaultView=window;
  return {window,document,listeners,classes,veil,timers,nodes,advance:ms=>{clock+=ms;},pulse:()=>{const t=timers.find(t=>t.ms===250&&!t.cancelled);assert.ok(t);t.cancelled=true;t.fn();}};
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
  assert.equal(world.nodes.actions.children.length, 1);
  world.nodes.actions.children[0].onclick();
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


test('startup telemetry is alive before modules/configuration/GPU settle, without reporting rendered frames',()=>{
 const world=guardWorld({fetchImpl:()=>new Promise(()=>{})});
 assert.equal(typeof world.window.kaminosStartup?.phase,'function','the independent head guard must expose startup phases before the module graph');
 world.advance(10000);world.pulse();
 assert.match(world.nodes.elapsed.textContent,/10000 ms elapsed/);
 assert.equal(world.window.kaminosStartup.read().phase,'Loading application modules');
 assert.equal(world.window.kaminosStartup.read().elapsedMs,10000);
 assert.equal(world.classes.has(STARTING_CLASS),true,'telemetry must not admit an unfinished workspace');
 assert.equal('fps' in world.window.kaminosStartup.read(),false,'no rendered-frame throughput exists yet');
});

test('actual startup stages update immediately and heartbeat records delayed UI scheduling',()=>{
 const world=guardWorld();assert.ok(world.window.kaminosStartup,'startup telemetry must exist');
 world.advance(300);world.window.kaminosStartup.phase('Requesting GPU device');
 assert.equal(world.nodes.phase.textContent,'Requesting GPU device');
 world.advance(700);world.pulse();
 const state=world.window.kaminosStartup.read();
 assert.equal(state.phaseElapsedMs,700);assert.equal(state.lastUiDelayMs,750);
 assert.match(world.nodes.delay.textContent,/750 ms/);
 assert.deepEqual(Array.from(state.phases,row=>row.phase),['Loading application modules','Requesting GPU device']);
});

test('settled startup stops the head telemetry timers and retains a terminal record',async()=>{
 const world=guardWorld();assert.ok(world.window.kaminosStartup,'startup telemetry must exist');
 world.advance(1200);await settleStartupVeil(world.document,Promise.resolve());
 const state=world.window.kaminosStartup.read();
 assert.equal(state.status,'workspace-visible');assert.equal(state.elapsedMs,1200);
 assert.ok(world.timers.every(t=>t.cancelled),'no telemetry/watchdog timer is left idle after startup');
 world.advance(5000);assert.equal(world.window.kaminosStartup.read().elapsedMs,1200);
});


test('a main-thread stall ending at startup completion is retained even before the overdue heartbeat runs',async()=>{
 const world=guardWorld();world.advance(10000);
 await settleStartupVeil(world.document,Promise.resolve());
 assert.equal(world.window.kaminosStartup.read().maxUiDelayMs,9750,'terminal telemetry retains the overdue scheduled heartbeat');
});

test('the head heartbeat waits for body parsing and failure stops its timers',()=>{
 const world=guardWorld(),body=world.document.body;world.document.body=null;
 world.advance(250);world.pulse();assert.equal(world.window.kaminosStartup.read().status,'starting');
 world.document.body=body;world.listeners.error({message:'module unavailable'});
 assert.equal(world.window.kaminosStartup.read().status,'failed');assert.ok(world.timers.every(t=>t.cancelled));
});


test('head downloads the named scene body while application modules are still unavailable',async()=>{
 const calls=[];let finish;const body=new Promise(resolve=>finish=resolve);
 const world=guardWorld({hash:'#scene=shrine%20one.kaminos.json',fetchImpl:(url,init)=>{calls.push({url,init});return Promise.resolve({ok:true,text:()=>body,json:async()=>({})});}});
 assert.equal(calls.length,2,'scene transfer must start beside configuration, before modules execute');
 assert.equal(calls[1].url,'/api/read?root=scenes&path=shrine%20one.kaminos.json&raw=1');assert.equal(calls[1].init.cache,'no-store');
 assert.equal(world.window.__kaminosEarlySceneText.filename,'shrine one.kaminos.json');
 finish(' {"version":11} \n');assert.equal(await world.window.__kaminosEarlySceneText.text,' {"version":11} \n');
 assert.equal(world.window.kaminosStartup.read().status,'starting','download does not admit a viewer');
});
test('head scene refusal remains rejected for admission without unhandled rejection during module loading',async()=>{
 const world=guardWorld({hash:'#scene=missing.kaminos.json',fetchImpl:async url=>({ok:!url.includes('root=scenes'),text:async()=>'{}',json:async()=>({})})});
 assert.ok(world.window.__kaminosEarlySceneText,'the failed request must remain available for the real admission path');await assert.rejects(world.window.__kaminosEarlySceneText.text,/Scene unavailable: missing/);
});
