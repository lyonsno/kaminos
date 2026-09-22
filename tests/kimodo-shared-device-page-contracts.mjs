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
assert.match(source, /deviceTopology:\s*'same-device'/, 'human-visible evidence names exact shared topology');
assert.match(source, /foregroundReceipts/, 'composition retains actual foreground service receipts');
assert.match(source, /frameIntervalStart:\s*state\.frameIntervals\.length/, 'each run records the start of its own uncapped frame interval window');
assert.match(source, /record\.pageP95Ms\s*=\s*percentile\(record\.frameIntervals,\s*\.95\)/, 'each run computes p95 from its own frame interval window');
assert.match(source, /record\.pageP99Ms\s*=\s*percentile\(record\.frameIntervals,\s*\.99\)/, 'each run computes p99 from its own frame interval window');
assert.match(source, /record\.pageMaxMs\s*=\s*record\.frameIntervals\.length\s*\?\s*Math\.max\(\.\.\.record\.frameIntervals\)\s*:\s*null/, 'each run records the worst observed frame interval without inventing an empty-run value');
assert.doesNotMatch(source, /frameIntervals\.length\s*>|samples\.length\s*>|\.splice\(|\.shift\(\)/, 'diagnostic history remains uncapped so a long run cannot erase its own contention evidence');
assert.match(source, /value="full-pass".*value="fence-light"/s, 'the lab retains an explicit full-pass reference alongside the opt-in split');
assert.match(source, /foreground:\s*flame\.ordinaryForeground\s*\?\s*\{\s*\.\.\.flame\.ordinaryForeground\s*\}/, 'historical foreground counters are copied at sample time');

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
