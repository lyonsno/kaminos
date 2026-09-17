import assert from 'node:assert/strict';
import { state, runInference } from '../moge-live-flame-shared.mjs';

// Browser plumbing only: this tests capture policy, not GPU performance.
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    style: {}, textContent: '', innerHTML: '', appendChild() {},
    getContext: () => ({ drawImage() {}, getImageData: () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }),
      createImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData() {} }),
  });
  return elements.get(id);
}
globalThis.document = { getElementById: element, createElement: () => element(Symbol()), visibilityState: 'visible' };
globalThis.window = { __compositionRoute: { deviceTopology: 'same-gpu-two-devices', settingsPreset: 'test-only' } };
globalThis.location = { href: 'http://127.0.0.1:8094/moge-elfinblue.html' };
globalThis.Image = class { width = 1; height = 1; async decode() {} };
globalThis.localStorage = { setItem() {} };
globalThis.requestAnimationFrame = callback => setImmediate(() => callback(performance.now()));
const writes = [];
globalThis.fetch = async (url, options) => {
  assert.equal(url, '/api/volume-capture');
  const capture = JSON.parse(options.body);
  writes.push(capture);
  return { ok: true, json: async () => ({ ok: true, relativePath: `artifacts/volume-captures/${capture.runId}.json`, document: { capture } }) };
};
const scheduler = { status: 'unverified', classification: 'synthetic-test-only', eventTrace: { events: [{ kind: 'test-event', atMs: 12 }] } };
const inference = { async run() {
  state.frameTimes?.push(11, 22, 55);
  return { width: 1, height: 1, depth: [1], schedulerVerificationReceipt: scheduler,
    routeResult: { status: 'partial', fallbackReason: 'synthetic-test-only', runtime: { schedulerVerification: scheduler } } };
} };

await runInference(inference);
await runInference(inference);
assert.equal(writes.length, 2, 'every run must write its raw capture, not only overwrite the HUD summary');
assert.notEqual(writes[0].runId, writes[1].runId);
assert.deepEqual(writes[0].frameTimes, [11, 22, 55]);
assert.deepEqual(writes[0].routeResult.runtime.schedulerVerification, scheduler);
assert.equal(writes[0].routeResult.status, 'partial', 'fallback must not gain real-route authority');
assert.equal(writes[0].compositionRoute.deviceTopology, 'same-gpu-two-devices');
assert.deepEqual(writes[0].phases.map(p => p.phase), ['image-input', 'inference', 'depth-paint', 'complete']);
assert.ok(Number.isFinite(writes[0].timeOrigin));
assert.equal(writes[0].input.source, 'fixtures/moge-live-flame-source.png');

await assert.rejects(runInference({ async run() { throw new Error('test GPU failure'); } }), /test GPU failure/);
assert.equal(writes.length, 3, 'failed inference must also preserve a capture');
assert.equal(writes[2].status, 'failed');
assert.equal(writes[2].failure.phase, 'inference');
assert.equal(writes[2].routeResult, null, 'failed run cannot inherit the preceding route result');

globalThis.Image = class { async decode() { throw new Error('missing fixture'); } };
await assert.rejects(runInference(inference), /missing fixture/);
assert.equal(writes.at(-1).failure.phase, 'image-input');
assert.equal(writes.at(-1).input.status, 'unavailable');
globalThis.Image = class { width = 1; height = 1; async decode() {} };

for (const response of [
  { ok: false, status: 500 },
  { ok: true, json: async () => ({ ok: true }) },
  { ok: true, json: async () => ({ ok: true, relativePath: 'wrong.json', document: { capture: { runId: 'stale' } } }) },
]) {
  globalThis.fetch = async () => response;
  await runInference(inference);
  assert.match(element('moge-capture-status').textContent, /NOT SAVED/);
  assert.ok(state.unsavedCaptures.length, 'failed writes must retain raw data in memory');
}
assert.equal(state.unsavedCaptures.length, 3);
console.log('PASS: per-run raw retention, partial route, phase failures, missing fixture and failed/stale save visibility');
