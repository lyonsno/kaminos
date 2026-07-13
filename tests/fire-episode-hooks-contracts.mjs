import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const moduleUrl = new URL('../fire-episode-hooks.mjs', import.meta.url);
const source = await readFile(moduleUrl, 'utf8').catch(() => '');
const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const witness = await readFile(new URL('../volume-witness.mjs', import.meta.url), 'utf8');

assert.match(
  source,
  /export function createFireEpisodeHooks/,
  'fire episode telemetry must be an explicit reusable lifecycle contract',
);

const {
  FIRE_EPISODE_HOOK_IDENTITY,
  createFireEpisodeHooks,
} = await import(moduleUrl);

let nowMs = 100;
let frameCount = 10;
let simStepCount = 20;
const hooks = createFireEpisodeHooks({
  now: () => nowMs,
  readCounters: () => ({ frameCount, simStepCount }),
  readRouteIdentity: () => ({
    effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
    flameRendererIdentity: 'live-boundary-sidecar-learned-attribute-splats-v0',
  }),
});

assert.equal(FIRE_EPISODE_HOOK_IDENTITY, 'foreground-kiln-fire-episode-hooks-v0');
assert.deepEqual(hooks.snapshot(), {
  identity: FIRE_EPISODE_HOOK_IDENTITY,
  evidenceSource: 'foreground-volume-render-loop-raf-sim-step-and-queue-proxy-v0',
  authority: 'renderer-simulator-hooks-for-wake-foreground-heartbeat',
  disclaimers: [
    'not-gpu-exclusive-or-present-latency',
    'not-displayed-frame-latency',
    'not-sharp-backend-heartbeat',
  ],
  firingId: null,
  generation: 0,
  phase: 'idle',
  status: 'idle',
  startedAtMs: null,
  updatedAtMs: null,
  endedAtMs: null,
  durationMs: 0,
  routeIdentity: null,
  rawRafGapSamplesMs: [],
  rafGapHistogramMs: [],
  sampleCount: 0,
  maxRafGapMs: 0,
  p95RafGapMs: 0,
  lastRafGapMs: null,
  longGapThresholdMs: 50,
  longGapCount: 0,
  longGapStreakCurrent: 0,
  longGapStreakMax: 0,
  frameStartCount: null,
  frameEndCount: null,
  frameAdvanceCount: 0,
  simStepStartCount: null,
  simStepEndCount: null,
  simStepAdvanceCount: 0,
  cpuFrameMs: null,
  queueCompletionProxy: {
    evidenceSource: 'webgpu-queue-onSubmittedWorkDone-proxy',
    disclaimer: 'queue-completion-proxy-not-present-latency',
    available: false,
    pending: false,
    samples: 0,
    lastDoneMs: null,
    p95DoneMs: null,
    error: null,
  },
  mohelIndicator: {
    uncappedRawGapSamples: true,
    sampleCount: 0,
    largeSampleSet: false,
    note: 'Raw firing-window gap samples are intentionally uncapped; use this diagnostic if the window is too broad.',
  },
});

assert.throws(() => hooks.begin({}), /firingId/, 'an exact episode cannot begin without a firing id');

const firingA = hooks.begin({ firingId: 'firing-a' });
assert.equal(firingA.firingId, 'firing-a');
assert.equal(firingA.generation, 1);
assert.equal(firingA.phase, 'recording');
assert.equal(firingA.status, 'recording');
assert.equal(firingA.frameStartCount, 10);
assert.equal(firingA.simStepStartCount, 20);

nowMs = 117;
frameCount = 11;
simStepCount = 21;
hooks.recordFrame({ rafGapMs: 17, cpuFrameMs: 2.5 });
nowMs = 180;
frameCount = 13;
simStepCount = 24;
hooks.recordFrame({ rafGapMs: 63, cpuFrameMs: 3.5 });

const firingARecorded = hooks.snapshot();
assert.deepEqual(firingARecorded.rawRafGapSamplesMs, [17, 63]);
assert.equal(firingARecorded.sampleCount, 2);
assert.equal(firingARecorded.frameAdvanceCount, 3);
assert.equal(firingARecorded.simStepAdvanceCount, 4);
assert.equal(firingARecorded.longGapCount, 1);
assert.equal(firingARecorded.longGapStreakMax, 1);
assert.equal(firingARecorded.routeIdentity.flameRendererIdentity, 'live-boundary-sidecar-learned-attribute-splats-v0');

const repeatedBegin = hooks.begin({ firingId: 'firing-a' });
assert.equal(repeatedBegin.generation, 1, 'repeating begin for the active firing is idempotent');
assert.equal(repeatedBegin.sampleCount, 2, 'idempotent begin does not discard current firing evidence');
hooks.recordQueueProxy({
  available: true,
  pending: false,
  samples: 4,
  lastDoneMs: 1.25,
  p95DoneMs: 1.75,
});
assert.equal(hooks.snapshot().queueCompletionProxy.samples, 4);

nowMs = 200;
const firingB = hooks.begin({ firingId: 'firing-b' });
assert.equal(firingB.generation, 2, 'a distinct firing gets a fresh generation');
assert.equal(firingB.sampleCount, 0, 'a distinct firing cannot inherit prototype-lifetime samples');
assert.deepEqual(firingB.rawRafGapSamplesMs, []);
assert.equal(firingB.queueCompletionProxy.samples, 0, 'a distinct firing cannot inherit queue evidence');
assert.equal(firingB.queueCompletionProxy.lastDoneMs, null);
assert.equal(firingB.frameStartCount, 13);
assert.equal(firingB.simStepStartCount, 24);

assert.throws(
  () => hooks.end({ firingId: 'firing-a', status: 'complete' }),
  /does not match active firing/i,
  'a stale firing cannot close the current episode',
);
assert.equal(hooks.snapshot().status, 'recording');

nowMs = 216;
frameCount = 14;
simStepCount = 25;
hooks.recordFrame({ rafGapMs: 16, cpuFrameMs: 2 });
const firingBComplete = hooks.end({ firingId: 'firing-b', status: 'complete' });
assert.equal(firingBComplete.phase, 'complete');
assert.equal(firingBComplete.status, 'complete');
assert.equal(firingBComplete.endedAtMs, 216);
assert.equal(firingBComplete.frameAdvanceCount, 1);
assert.equal(firingBComplete.simStepAdvanceCount, 1);

const repeatedEnd = hooks.end({ firingId: 'firing-b', status: 'complete' });
assert.deepEqual(repeatedEnd, firingBComplete, 'repeating end for the completed firing is idempotent');
hooks.recordFrame({ rafGapMs: 90, cpuFrameMs: 4 });
assert.deepEqual(hooks.snapshot(), firingBComplete, 'completed episodes reject later prototype-lifetime samples');
assert.throws(
  () => hooks.begin({ firingId: 'firing-b' }),
  /already used/i,
  'a completed firing id cannot be rebound to a newer generation that the consumer did not request',
);
assert.throws(
  () => hooks.begin({ firingId: 'firing-a' }),
  /already used/i,
  'a superseded firing id cannot be rebound after another firing owns the tracker',
);

const mutableSnapshot = hooks.snapshot();
mutableSnapshot.rawRafGapSamplesMs.push(999);
mutableSnapshot.queueCompletionProxy.samples = 999;
assert.deepEqual(hooks.snapshot(), firingBComplete, 'snapshots do not expose mutable episode state');

assert.match(core, /beginFireEpisode/, 'volume prototype exposes the begin socket to the firing owner');
assert.match(core, /endFireEpisode/, 'volume prototype exposes the end socket to the firing owner');
assert.match(core, /fireEpisodeHooks\.recordFrame/, 'route-local frame timing records only through the episode lifecycle');
assert.match(core, /fireEpisodeHooks:\s*fireEpisodeHooks\.snapshot\(\)/, 'debug and sample state expose an exact episode snapshot');
assert.match(witness, /fireEpisodeHooks/, 'volume witness preserves exact fire episode evidence');

console.log('fire episode hook contracts passed');
