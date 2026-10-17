// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAcceleratorUtilization, summarizeUtilization, createGpuUtilizationSampler, ambientGpuLabel} from '../gpu-utilization.mjs';

// Observed on Apple M4 Max (AGXAcceleratorG16X), macOS 15.6, 2026-10-16:
// /usr/sbin/ioreg -r -d 1 -w 0 -c IOAccelerator, trimmed to the statistics line.
const OBSERVED = `+-o AGXAcceleratorG16X  <class AGXAcceleratorG16X, id 0x100000454, registered, matched, active, busy 0 (0 ms), retain 112>
    {
      "model" = "Apple M4 Max"
      "PerformanceStatistics" = {"In use system memory (driver)"=0,"Alloc system memory"=47494512640,"Tiler Utilization %"=8,"recoveryCount"=0,"lastRecoveryTime"=0,"Renderer Utilization %"=23,"TiledSceneBytes"=2097152,"Device Utilization %"=24,"SplitSceneCount"=0,"Allocated PB Size"=213647360,"In use system memory"=3188719616}
    }`;

test('reads device, renderer and tiler utilization from the observed ioreg output', () => {
 assert.deepEqual(parseAcceleratorUtilization(OBSERVED), {device: 24, renderer: 23, tiler: 8});
});

test('output without the statistics reads as no sample, not as an idle GPU', () => {
 assert.equal(parseAcceleratorUtilization('+-o AGXAcceleratorG16X\n    {\n      "model" = "Apple M4 Max"\n    }'), null);
 assert.equal(parseAcceleratorUtilization(''), null);
 assert.equal(parseAcceleratorUtilization('"PerformanceStatistics" = {"Renderer Utilization %"=23}'), null, 'device utilization is required');
});

test('a window with no samples is unavailable with a reason, never 0%', () => {
 const summary = summarizeUtilization([], {from: 1000, to: 4000, intervalMs: 250});
 assert.equal(summary.available, false);
 assert.equal(summary.deviceMedian, null);
 assert.match(summary.reason, /no samples/);
});

test('only samples inside the window count, and thin coverage is marked partial', () => {
 const at = (t, device) => ({t, device, renderer: device, tiler: 1});
 const samples = [at(500, 99), ...Array.from({length: 12}, (_, i) => at(1000 + i * 250, 40 + i)), at(5000, 99)];
 const full = summarizeUtilization(samples, {from: 1000, to: 4000, intervalMs: 250});
 assert.equal(full.available, true);
 assert.equal(full.samples, 12);
 assert.equal(full.partial, false);
 assert.equal(full.deviceMax, 51, 'samples outside the window are excluded');
 assert.equal(full.deviceMedian, 46);
 const thin = summarizeUtilization(samples.slice(0, 4), {from: 1000, to: 4000, intervalMs: 250});
 assert.equal(thin.available, true);
 assert.equal(thin.partial, true);
});

test('read failures are carried into the summary instead of being dropped', async () => {
 let now = 0;
 const sampler = createGpuUtilizationSampler({read: async () => { throw new Error('ioreg: not found'); }, intervalMs: 10, now: () => (now += 10)});
 sampler.start();
 await new Promise(r => setTimeout(r, 40));
 await sampler.stop();
 const summary = sampler.summarize({from: 0, to: now});
 assert.equal(summary.available, false);
 assert.match(summary.reason, /ioreg: not found/);
});

test('the sampler records parsed readings with their times', async () => {
 let now = 1000;
 const sampler = createGpuUtilizationSampler({read: async () => OBSERVED, intervalMs: 5, now: () => (now += 5)});
 sampler.start();
 await new Promise(r => setTimeout(r, 40));
 await sampler.stop();
 const summary = sampler.summarize({from: 0, to: now + 1});
 assert.equal(summary.available, true);
 assert.ok(summary.samples >= 2);
 assert.equal(summary.deviceMedian, 24);
 assert.equal(summary.rendererMedian, 23);
 assert.equal(summary.tilerMedian, 8);
});

test('the ambient label names its threshold and refuses to call missing data quiet', () => {
 assert.deepEqual(ambientGpuLabel({available: true, deviceMedian: 3}), {label: 'quiet', thresholdPercent: 15});
 assert.deepEqual(ambientGpuLabel({available: true, deviceMedian: 40}), {label: 'busy', thresholdPercent: 15});
 assert.deepEqual(ambientGpuLabel({available: false, reason: 'no samples'}), {label: 'unknown', thresholdPercent: 15});
});

test('a measurement window without a running sampler or wall-clock bounds says so', async () => {
 const {windowUtilization} = await import('../gpu-utilization.mjs');
 assert.deepEqual(windowUtilization(null, [1, 2]), {available: false, reason: 'GPU sampler not running for this scenario'});
 const sampler = {summarize: ({from, to}) => ({available: true, from, to})};
 assert.deepEqual(windowUtilization(sampler, undefined), {available: false, reason: 'window carried no wall-clock bounds'});
 assert.deepEqual(windowUtilization(sampler, [1, null]), {available: false, reason: 'window carried no wall-clock bounds'});
 assert.deepEqual(windowUtilization(sampler, [10, 20]), {available: true, from: 10, to: 20});
});
