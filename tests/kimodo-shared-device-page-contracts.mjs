import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { disposeKimodoCompositionResources } = await import('../kimodo-shared-device-inject.mjs');

const source = readFileSync(new URL('../kimodo-shared-device-inject.mjs', import.meta.url), 'utf8');

assert.match(source, /export\s*\{\s*sharedGpuDeviceRequirements\s*\}/, 'composition exports declarative requirements before mount');
assert.doesNotMatch(source, /initGPU|requestAdapter|navigator\.gpu/, 'composition has no producer-owned device fallback');
assert.match(source, /createKimodoProducer\(\{[\s\S]*device:\s*sharedGpu\.device[\s\S]*backendIdentity:\s*sharedGpu\.backendIdentity/, 'producer receives the exact host device and effective backend identity');
assert.match(source, /connectKimodoSharedDeviceForeground/, 'composition uses the public-kit persistent foreground adapter');
assert.ok(
  source.indexOf('foreground = connectKimodoSharedDeviceForeground') < source.indexOf('producer = await createKimodoProducer'),
  'the persistent foreground requester is connected before the long model load begins',
);
assert.match(source, /foreground\.attachProducer\(producer\)/, 'the loaded producer is admitted only after exact shared-device validation');
assert.match(source, /generationLifecycle/, 'page teardown tracks the whole generation through foreground finish, not only the producer promise');
assert.match(source, /__kimodoSharedDeviceTeardown/, 'the browser witness can await the same quiescent teardown chain used by pagehide');
assert.match(source, /await\s+foreground\.beginRun\(runId\)[\s\S]*producer\.generate\([\s\S]*foregroundOpportunity:\s*async\s+boundary\s*=>\s*\{[\s\S]*telemetry\.foreground\(boundary\)[\s\S]*run\.foregroundOpportunity\(boundary\)[\s\S]*finally\s*\{[\s\S]*await\s+run\.finish\(\)/, 'every generation reserves, observes, services, and drains one persistent foreground run');
assert.ok(/record\.status\s*=\s*'finalizing'[\s\S]*await\s+run\.finish\(\)/.test(source), 'failed/canceled records remain nonterminal while foreground duties drain');
assert.ok(/!\['running',\s*'finishing',\s*'finalizing'\]\.includes\(record\.status\)/.test(readFileSync(new URL('../scripts/observe-kimodo-shared-device.mjs', import.meta.url), 'utf8')), 'observer waits for run finalization before emitting a one-time terminal record');
assert.ok(
  source.indexOf("record.status = terminalStatus") > source.indexOf('record.foregroundSnapshot = foreground.snapshot()'),
  'a run is marked terminal only after timing, scheduler, flame, and foreground terminal evidence is populated',
);
assert.match(source, /deviceTopology:\s*'same-device'/, 'human-visible evidence names exact shared topology');
assert.match(source, /foregroundReceipts/, 'composition retains actual foreground service receipts');
assert.match(source, /frameIntervalStart:\s*state\.frameIntervals\.length/, 'each run records the start of its own uncapped frame interval window');
assert.match(source, /record\.pageP95Ms\s*=\s*percentile\(record\.frameIntervals,\s*\.95\)/, 'each run computes p95 from its own frame interval window');
assert.match(source, /record\.pageP99Ms\s*=\s*percentile\(record\.frameIntervals,\s*\.99\)/, 'each run computes p99 from its own frame interval window');
assert.match(source, /record\.pageMaxMs\s*=\s*record\.frameIntervals\.length\s*\?\s*Math\.max\(\.\.\.record\.frameIntervals\)\s*:\s*null/, 'each run records the worst observed frame interval without inventing an empty-run value');
assert.doesNotMatch(source, /frameIntervals\.length\s*>|samples\.length\s*>|\.splice\(|\.shift\(\)/, 'diagnostic history remains uncapped so a long run cannot erase its own contention evidence');
assert.match(source, /value="full-pass".*value="fence-light".*value="single-layer".*value="single-layer-serial"/s, 'the lab retains reference schedules alongside the opt-in serial single-layer schedule');
assert.match(source, /const flame = snapshotFlameState\(prototype\.debugState\(\)\)/, 'sample collection freezes the foreground counters and receipt it observed');
assert.match(source, /const sampleAtMs = performance\.now\(\)/, 'sample time is captured at the state read, not the earlier animation-frame timestamp');
assert.match(source, /flameBefore:\s*snapshotFlameState\(prototype\.debugState\(\)\)/, 'run-start flame evidence cannot inherit later foreground counter mutations');
const { snapshotFlameState } = await import('../kimodo-shared-device-inject.mjs');
const changingReceipt = { requestId: 'frame-1', result: { frameCount: 1 } };
const mutableFlame = {
  frameCount: 1,
  ordinaryForeground: { mode: 'producer-foreground-opportunities', completedFrames: 1, lastReceipt: changingReceipt },
};
const sampledFlame = snapshotFlameState(mutableFlame);
changingReceipt.result.frameCount = 2;
mutableFlame.ordinaryForeground.completedFrames = 2;
assert.equal(sampledFlame.ordinaryForeground.lastReceipt.result.frameCount, 1, 'captured sample receipt cannot change when the live receipt object is later mutated');
assert.equal(sampledFlame.ordinaryForeground.completedFrames, 1, 'captured foreground counters cannot change when the live counters later advance');

let unsafeProducerDisposals = 0;
await assert.rejects(
  () => disposeKimodoCompositionResources({
    foreground: {
      async dispose() { throw new Error('kit-run-still-active'); },
      snapshot() { return { disposed: false, activeRun: 'run-1', foregroundService: { disposed: false, activeRun: { runId: 'run-1' } } }; },
    },
    producer: { dispose() { unsafeProducerDisposals += 1; } },
  }),
  /kit-run-still-active/,
);
assert.equal(unsafeProducerDisposals, 0, 'producer weights remain resident when foreground/service quiescence was not established');

let quiescentProducerDisposals = 0;
await assert.rejects(
  () => disposeKimodoCompositionResources({
    foreground: {
      async dispose() { throw new Error('preserved-render-failure'); },
      snapshot() { return { disposed: true, activeRun: null, foregroundService: { disposed: true, activeRun: null } }; },
    },
    producer: { dispose() { quiescentProducerDisposals += 1; } },
  }),
  /preserved-render-failure/,
);
assert.equal(quiescentProducerDisposals, 1, 'a preserved renderer failure does not prevent release after foreground quiescence is proven');

console.log('Kimodo shared-device page contracts passed');
