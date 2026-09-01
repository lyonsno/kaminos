import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  VOLUME_BASIN_DRIVE_SESSION_SCHEMA,
  createVolumeBasinDriveSessionRecorder,
  parseVolumeBasinDriveSession,
  replayVolumeBasinDriveSession,
  serializeVolumeBasinDriveSession,
  validateVolumeBasinDriveSession,
} from '../volume-basin-drive-session.mjs';

const source = {
  repository: 'kaminos',
  commit: '1'.repeat(40),
  branch: 'cc/handy-basin-atlas-rail-recorder-0830',
  dirty: false,
};
const canonicalSchema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url), 'utf8'));
const inventoryFor = (axis, descriptors) => descriptors.map(descriptor => ({
  axis,
  id: descriptor.key,
  param: descriptor.param,
  type: descriptor.type,
}));
const basinInventory = inventoryFor('basin', canonicalSchema.controls);
const rendererInventory = inventoryFor('renderer', canonicalSchema.rendererControls);
const presentationInventory = inventoryFor('presentation', canonicalSchema.presentationControls);
const controlSchema = {
  identity: 'kaminos-volume-settings-preset-schema-v2',
  sha256: '2'.repeat(64),
  basinControlCount: basinInventory.length,
  rendererControlCount: rendererInventory.length,
  presentationControlCount: presentationInventory.length,
  inventory: [...basinInventory, ...rendererInventory, ...presentationInventory],
};
const runtime = {
  requestedRoute: 'http://127.0.0.1:18412/?kaminos_volume_smoke=1',
  effectiveRoute: 'http://127.0.0.1:18412/?kaminos_volume_smoke=1&volume_density=1',
  backend: 'WebGPU:apple',
  requestedStorePath: '/var/operator/basin-drives',
  effectiveStorePath: '/var/operator/basin-drives',
};
function controlState({ exposure = 0.937891234567, density = 1 } = {}) {
  return {
    schema: 'kaminos.volume.basin-drive-control-state.v0',
    basin: Object.fromEntries(basinInventory.map(descriptor => [
      descriptor.id,
      descriptor.id === 'volume-exposure' ? exposure : descriptor.id === 'volume-density' ? density : 0,
    ])),
    renderer: Object.fromEntries(rendererInventory.map((descriptor, index) => [descriptor.id, [132, 0.5, 0.25][index]])),
    presentation: { 'raymarch-smoke-presentation': 'on' },
    effectivePresentation: {
      'raymarch-smoke-presentation': { effective: 'on', fallbackReason: null },
    },
    route: `http://127.0.0.1:18412/?kaminos_volume_smoke=1&volume_exposure=${exposure}&volume_density=${density}`,
  };
}
const initialState = controlState();

let monotonicMs = 1000;
const recorder = createVolumeBasinDriveSessionRecorder({
  sessionId: 'basin-drive-contract-001',
  source,
  controlSchema,
  runtime,
  initialState,
  startedAt: '2026-08-30T18:00:00.000Z',
  now: () => monotonicMs,
});

monotonicMs = 1001.25;
recorder.recordControl({
  controlId: 'volume-exposure',
  param: 'volume_exposure',
  requested: 0.12345678901234566,
  effective: 0.12345678901234566,
  inputType: 'range',
  axis: 'basin',
  gesture: {
    eventType: 'input',
    targetId: 'volume-exposure',
    targeted: true,
    trusted: true,
    commandDriven: false,
  },
});
monotonicMs = 1002.5;
recorder.mark({
  label: 'blue ring attachment',
  state: controlState({ exposure: 0.12345678901234566, density: 1 }),
});
monotonicMs = 1004;
recorder.recordControl({
  controlId: 'volume-density',
  param: 'volume_density',
  requested: 1.1,
  effective: 1.1,
  inputType: 'range',
  axis: 'basin',
  gesture: {
    eventType: 'change',
    targetId: 'volume-density',
    targeted: true,
    trusted: true,
    commandDriven: false,
  },
});

const mutableFinalState = controlState({ exposure: 0.12345678901234566, density: 1.1 });
monotonicMs = 1005;
const session = recorder.finish({
  finalState: mutableFinalState,
  endedAt: '2026-08-30T18:00:05.000Z',
});
mutableFinalState.basin['volume-density'] = 999;

assert.equal(session.schema, VOLUME_BASIN_DRIVE_SESSION_SCHEMA);
assert.equal(session.status, 'complete');
assert.equal(session.eventCount, 3);
assert.deepEqual(session.events.map(event => event.sequence), [0, 1, 2]);
assert.deepEqual(session.events.map(event => event.kind), ['control', 'mark', 'control']);
assert.deepEqual(session.events.map(event => event.elapsedMs), [1.25, 2.5, 4]);
assert.equal(session.events[0].requested, 0.12345678901234566, 'continuous control precision survives capture');
assert.equal(session.events[0].effective, 0.12345678901234566, 'effective control precision survives capture');
assert.equal(session.events[0].axis, 'basin');
assert.deepEqual(session.events[0].gesture, {
  eventType: 'input',
  targetId: 'volume-exposure',
  targeted: true,
  trusted: true,
  commandDriven: false,
});
assert.equal(session.finalState.basin['volume-density'], 1.1, 'finished state is detached from caller mutation');
assert.equal(Object.isFrozen(session), true, 'finished session is immutable');
assert.equal(Object.isFrozen(session.events), true, 'finished event stream is immutable');
assert.equal(validateVolumeBasinDriveSession(session), true);

const serialized = serializeVolumeBasinDriveSession(session);
assert.ok(serialized.endsWith('\n'), 'serialized session is a line-terminated durable JSON document');
assert.deepEqual(parseVolumeBasinDriveSession(serialized), session, 'session round-trips without precision or authority loss');

const replayed = [];
const marks = [];
const replayInitialStates = [];
const replayReceipt = await replayVolumeBasinDriveSession(session, {
  applyInitialState(state) {
    replayInitialStates.push(state);
    return state;
  },
  waitUntilElapsed() {},
  applyControl(event) {
    replayed.push([event.controlId, event.requested]);
    return event.effective;
  },
  applyMark(event) {
    marks.push(event.label);
  },
  captureState() {
    return session.finalState;
  },
});
assert.deepEqual(replayInitialStates, [session.initialState], 'replay restores the recorded initial condition before applying motion');
assert.deepEqual(replayed, [
  ['volume-exposure', 0.12345678901234566],
  ['volume-density', 1.1],
]);
assert.deepEqual(marks, ['blue ring attachment']);
assert.equal(replayReceipt.status, 'replayed');
assert.equal(replayReceipt.eventCount, session.eventCount);
assert.equal(replayReceipt.initialStateApplied, true);
assert.equal(replayReceipt.effectiveMatch, true);
assert.equal(replayReceipt.finalStateMatch, true);

await assert.rejects(
  replayVolumeBasinDriveSession(session, {
    applyInitialState: state => state,
    waitUntilElapsed() {},
    applyControl: event => event.controlId === 'volume-exposure' ? 0.12 : event.effective,
    captureState: () => session.finalState,
  }),
  /effective.*mismatch/i,
  'replay fails loud when the cockpit substitutes an effective value',
);

assert.throws(
  () => validateVolumeBasinDriveSession({ ...session, source: { ...source, commit: null } }),
  /source.*commit/i,
  'missing source identity cannot masquerade as a replayable session',
);
assert.throws(
  () => validateVolumeBasinDriveSession({ ...session, eventCount: 2 }),
  /event.*count/i,
  'a truncated stream cannot preserve the original event count',
);
assert.throws(
  () => validateVolumeBasinDriveSession({
    ...session,
    events: session.events.map((event, index) => index === 2 ? { ...event, sequence: 7 } : event),
  }),
  /sequence/i,
  'missing or reordered events fail loud',
);
assert.throws(
  () => validateVolumeBasinDriveSession({
    ...session,
    events: session.events.map((event, index) => index === 2 ? { ...event, elapsedMs: 0.5 } : event),
  }),
  /monotonic/i,
  'backward event timing fails loud',
);

let uncappedNow = 0;
const uncappedRecorder = createVolumeBasinDriveSessionRecorder({
  sessionId: 'basin-drive-uncapped',
  source,
  controlSchema,
  runtime,
  initialState,
  startedAt: '2026-08-30T18:10:00.000Z',
  now: () => uncappedNow,
});
for (let index = 0; index < 10001; index += 1) {
  uncappedNow += 0.01;
  uncappedRecorder.recordControl({
    controlId: 'volume-exposure',
    param: 'volume_exposure',
    requested: index / 10000,
    effective: index / 10000,
    inputType: 'range',
    axis: 'basin',
    gesture: {
      eventType: 'input',
      targetId: 'volume-exposure',
      targeted: true,
      trusted: true,
      commandDriven: false,
    },
  });
}
uncappedNow += 1;
const uncappedSession = uncappedRecorder.finish({
  finalState: initialState,
  endedAt: '2026-08-30T18:10:01.000Z',
});
assert.equal(uncappedSession.eventCount, 10001, 'recorder does not silently truncate a long operator performance');
assert.equal(uncappedSession.events.at(-1).requested, 1);

let brokenNow = 10;
const brokenClockRecorder = createVolumeBasinDriveSessionRecorder({
  sessionId: 'basin-drive-broken-clock',
  source,
  controlSchema,
  runtime,
  initialState,
  startedAt: '2026-08-30T18:20:00.000Z',
  now: () => brokenNow,
});
brokenNow = 9;
assert.throws(
  () => brokenClockRecorder.recordControl({
    controlId: 'volume-exposure',
    param: 'volume_exposure',
    requested: 1,
    effective: 1,
    inputType: 'range',
    axis: 'basin',
    gesture: {
      eventType: 'input',
      targetId: 'volume-exposure',
      targeted: true,
      trusted: true,
      commandDriven: false,
    },
  }),
  /monotonic.*backward/i,
  'recorder rejects a clock that moves backward instead of rewriting history',
);

await assert.rejects(
  replayVolumeBasinDriveSession(session, { applyControl: event => event.effective }),
  /requires applyInitialState/i,
  'replay cannot report success without a witnessed initial-state phase',
);

assert.throws(
  () => validateVolumeBasinDriveSession({
    ...session,
    events: session.events.map((event, index) => index === 0 ? { ...event, axis: 'compute-budget-ish' } : event),
  }),
  /axis.*basin.*renderer.*presentation/i,
  'an unknown control axis cannot enter a replayable trajectory',
);

assert.throws(
  () => validateVolumeBasinDriveSession({
    ...session,
    events: session.events.map((event, index) => index === 0
      ? { ...event, gesture: { ...event.gesture, trusted: 'probably' } }
      : event),
  }),
  /gesture.*trusted.*boolean/i,
  'gesture provenance cannot silently weaken into an ambiguous value',
);

console.log('volume basin drive session contracts passed');
