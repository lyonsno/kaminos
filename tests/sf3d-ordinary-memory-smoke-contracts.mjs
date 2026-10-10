import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const witness = new URL('../sf3d-ordinary-memory-smoke.mjs', import.meta.url);
const module = existsSync(witness) ? await import(witness) : {};
assert.equal(typeof module.judgeOrdinaryMemorySmoke, 'function', 'ordinary consumer evidence must have an explicit false-closure judge');
const source = {repoRoot: '/fixture', revision: 'a'.repeat(40), clean: true};
const frame = n => ({renderer: 'ordinary-volume', active: true, error: null,
  frameCount: n, simStepCount: n, simGrid: 32, controls: {emitterSourceDepth: 0.125},
  memory: {authority: 'observation-only', budget: {deviceAcquisition: 'requested-through-budget',
    gpu: {liveBytes: 1000, physicalMemoryMeasured: false}}}});
const report = {schema: 'kaminos.sf3d-ordinary-memory-smoke.v0', runId: 'fixture-run', ownedRootPid: 42,
  browserExecutable: '/fixture/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', browserVersion: 'Chrome/148.0.7778.96',
  source, requested: {...source, grid: 32, sourceDepth: 0.125}, events: [],
  servedHashesMatch: true, modelPayloadRequests: [],
  sourceHold: {verdict: 'refused', authority: 'circuit-breaker-only', modelPayloadBytesServed: 0,
    observation: {source: 'live-macos-sysctl', machine: 'Mac14,9', cpu: 'Apple M2 Pro', hostTotalBytes: 17179869184}},
  model: {initialized: false, error: {sourceAdmission: {verdict: 'refused', authority: 'circuit-breaker-only'}}},
  sourceHead: {status: 503, authority: 'circuit-breaker-only', bodyBytes: 0},
  adapters: [{isFallbackAdapter: false, info: {vendor: 'apple', architecture: 'metal-3'}}],
  before: frame(200), after: frame(220),
  captures: [{path: '/before.png', sha256: 'b'.repeat(64)}, {path: '/after.png', sha256: 'c'.repeat(64)}],
  processObservation: {status: 'observed', coverage: 'sampled-owned-process-tree', sampleCount: 2, rootPid: 42, runId: 'fixture-run'},
  cleanup: {browser: {exitObserved: true}, server: {exitObserved: true}}};
assert.deepEqual(module.judgeOrdinaryMemorySmoke(report), []);
for (const mutate of [
  r => r.source.revision = 'd'.repeat(40), r => r.servedHashesMatch = false,
  r => r.source.clean = false, r => r.browserExecutable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  r => r.sourceHead.status = 200, r => r.sourceHead.bodyBytes = 42,
  r => r.processObservation.runId = 'stale', r => r.processObservation.rootPid = 1,
  r => r.events.push({kind: 'pageerror', message: 'required module failed'}),
  r => r.sourceHold.observation.source = 'replay', r => r.sourceHold.verdict = 'not-applicable',
  r => r.sourceHold.modelPayloadBytesServed = 10, r => r.model.initialized = true,
  r => r.modelPayloadRequests.push('/lib/sf3d/weights.bin'), r => delete r.model.error.sourceAdmission,
  r => r.adapters[0].isFallbackAdapter = true, r => r.adapters[0].info.vendor = 'software',
  r => r.after.frameCount = r.before.frameCount, r => r.after.simStepCount = r.before.simStepCount,
  r => r.after.renderer = 'alternate-volume', r => r.after.active = false,
  r => r.after.simGrid = 160, r => r.after.controls.emitterSourceDepth = 0.006,
  r => r.after.memory.budget.deviceAcquisition = 'borrowed', r => r.after.memory.budget.gpu.liveBytes = 0,
  r => r.after.memory.authority = 'physical-fit', r => r.captures.pop(),
  r => r.captures[0].sha256 = '', r => r.processObservation.coverage = 'partial-process-coverage',
  r => r.memorySafety = {reason: 'budget-refused'}, r => r.cleanup.browser.exitObserved = false,
]) {
  const bad = structuredClone(report); mutate(bad);
  assert.ok(module.judgeOrdinaryMemorySmoke(bad).length, 'false closure must reject');
}
assert.ok(module.judgeOrdinaryMemorySmoke({}).length, 'early failure cannot pass without primary evidence');
const failureOut = mkdtempSync(path.join(os.tmpdir(), 'sf3d-ordinary-memory-failure-'));
const failed = await module.runOrdinaryMemorySmoke(['--out', failureOut]);
const failureReport = JSON.parse(readFileSync(failed.reportPath, 'utf8'));
assert.equal(failed.status, 'failed');
assert.equal(failureReport.failurePhase, 'arguments');
assert.match(failureReport.error.message, /required --repo-root/);
assert.equal(failureReport.captures.length, 0);
console.log('Ordinary memory smoke rejects wrong source, fallback, payload uptake, frozen renderer, partial evidence and unsafe completion');
