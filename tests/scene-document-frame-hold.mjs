// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = page.includes('let sceneDocumentFrameHolds =')
  ? page.indexOf('let sceneDocumentFrameHolds =')
  : page.indexOf('function createPageSceneDocumentSession(');
const end = page.indexOf('\nconst sceneDocument =', start);
assert.ok(start >= 0 && end > start);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };

function fixture(apply, drain = Promise.resolve()) {
  const events = [];
  const context = vm.createContext({
    sceneLoadRequests: {}, sceneRecords: {},
    createSceneDocumentSession: options => options,
    sceneLightingPreparation: {state: () => ({held: false})},
    volumePrototype: {setSceneLightingRebuildPending(held) { events.push(['hold', held]); return drain; }},
    applySceneDocument: (...args) => { events.push(['apply', ...args]); return apply(...args); },
    window: {_kaminosDirty() { events.push(['dirty']); }},
  });
  vm.runInContext(page.slice(start, end), context);
  return {context, events, apply: context.createPageSceneDocumentSession().apply};
}

test('document application parks and drains the flame before mutating scene inputs', async () => {
  const drain = deferred(), body = deferred();
  const f = fixture(() => body.promise, drain.promise);
  const pending = f.apply('saved scene');
  assert.deepEqual(f.events, [['hold', true]], 'No scene mutation before the admitted flame frame drains');
  drain.resolve();
  await new Promise(setImmediate);
  assert.deepEqual(f.events, [['hold', true], ['apply', 'saved scene']]);
  body.resolve('done');
  assert.equal(await pending, 'done');
  assert.deepEqual(f.events.slice(-2), [['hold', false], ['dirty']]);
});

test('overlapping document applications and lighting cannot release each other', async () => {
  const first = deferred(), second = deferred();
  const f = fixture(name => name === 'first' ? first.promise : second.promise);
  const a = f.apply('first'), b = f.apply('second');
  await Promise.resolve();
  f.context.syncVolumeSceneFrameHold(false);
  assert.deepEqual(f.events.at(-1), ['hold', true]);
  first.resolve(); await a;
  assert.deepEqual(f.events.at(-2), ['hold', true], 'A superseded apply cannot release the newer apply');
  f.context.sceneLightingPreparation.state = () => ({held: true});
  second.resolve(); await b;
  assert.deepEqual(f.events.at(-2), ['hold', true], 'Document completion preserves an active lighting hold');
  f.context.syncVolumeSceneFrameHold(false);
  assert.deepEqual(f.events.at(-1), ['hold', false]);
});

test('failed application releases its hold and redraws without hiding the error', async () => {
  const f = fixture(() => { throw Error('restore failed'); });
  await assert.rejects(f.apply(), /restore failed/);
  assert.deepEqual(f.events, [['hold', true], ['apply'], ['hold', false], ['dirty']]);
});

test('a volume created during document application inherits the outstanding hold', async () => {
  const body = deferred(), f = fixture(() => body.promise);
  const pending = f.apply(); await Promise.resolve();
  const a = page.indexOf('function createPageVolumePrototype('), b = page.indexOf('\nasync function releaseSceneRadianceRoute', a);
  assert.ok(a >= 0 && b > a);
  const replacementHolds = [];
  Object.assign(f.context, {
    THREE: {}, camera: {}, controls: {}, readVolumeControls() {}, sharedGpu: {},
    document: {getElementById() { return {}; }}, sceneAshAtmosphereSettings: {},
    fingerFluidPyroCompositionRequested: () => false,
    isFireLightFieldRoute: () => false, isAuthoredKilnCollisionRoute: () => false,
    createKaminosVolumePrototype: () => ({
      setSceneLightingRebuildPending(held) { replacementHolds.push(held); return Promise.resolve(); },
      setSharedAshAtmosphere() {}, setRayStepTelemetryCanvas() {},
    }),
  });
  vm.runInContext(page.slice(a, b), f.context);
  f.context.createPageVolumePrototype();
  assert.deepEqual(replacementHolds, [true]);
  body.resolve(); await pending;
  assert.deepEqual(replacementHolds, [true, false]);
});
