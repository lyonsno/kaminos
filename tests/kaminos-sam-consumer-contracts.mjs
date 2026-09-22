import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const witness = new URL('../sam-image-witness.mjs', import.meta.url);
assert.ok(existsSync(witness), 'the actual Kaminos consumer needs a rerunnable image-to-export witness');
const consumer = await import(witness);
const { validateSamConsumerOutput } = consumer;
const output = { invocationId: 'new', promptText: 'wheel', outputAuthority: 'actual-webgpu-readback',
  verificationState: 'not-attached', effectiveRouteId: 'sam3.detr-encoder.phase-program.webgpu-local.v0',
  receiptChain: ['sam3.mask-tail.phase-program.webgpu-local.v0'],
  width: 288, height: 288, imageCache: { status: 'miss' },
  instances: [{ index: 7, score: 0.9, mask: [1], logits: [2] }],
};
const expected = { prompt: 'wheel', empty: false, previousId: null, cache: 'miss' };
assert.throws(() => validateSamConsumerOutput(output, expected), /partial/, 'partial tensors cannot close the live-output gate');
output.instances[0].mask = new Uint8Array(288 * 288).fill(1);
output.instances[0].logits = new Float32Array(288 * 288).fill(2);
validateSamConsumerOutput(output, expected);
for (const override of [{ outputAuthority: 'cpu-oracle' }, { verificationState: 'reference-parity' },
  { promptText: 'truck' }, { width: 64 }, { instances: [] }, { imageCache: { status: 'hit' } }]) {
  assert.throws(() => validateSamConsumerOutput({ ...output, ...override }, expected));
}
assert.throws(() => validateSamConsumerOutput(output, { ...expected, previousId: 'new' }), /reused/);
assert.throws(() => validateSamConsumerOutput(output, { ...expected, empty: true }), /empty/);
const live = { sameDevice: true, sameRendererDevice: true, invocation: { invocationId: 'new', startedAtMs: 10, completedAtMs: 100 },
  foreground: { failure: null, inputs: [{ id: 1, receivedAtMs: 30, type: 'wheel', trusted: true, zoom: 2, panX: 0, panY: 0 }],
    frames: [{ submittedAtMs: 5, inputIds: [], zoom: 1, panX: 0, panY: 0 },
      { submittedAtMs: 40, inputIds: [1], zoom: 2, panX: 0, panY: 0 }] } };
assert.equal(typeof consumer.validateSamConsumerInteraction, 'function', 'live consumer gate must inspect input-correlated submissions inside inference bounds');
consumer.validateSamConsumerInteraction(live, 'new');
for (const change of [
  { sameDevice: false }, { sameRendererDevice: false }, { invocation: { ...live.invocation, invocationId: 'old' } },
  { foreground: { ...live.foreground, inputs: [] } },
  { foreground: { ...live.foreground, frames: [live.foreground.frames[0]] } },
  { foreground: { ...live.foreground, frames: [live.foreground.frames[0], { ...live.foreground.frames[1], submittedAtMs: 101 }] } },
  { foreground: { ...live.foreground, frames: [live.foreground.frames[0], { ...live.foreground.frames[1], zoom: 1 }] } },
]) assert.throws(() => consumer.validateSamConsumerInteraction({ ...live, ...change }, 'new'));
assert.equal(typeof consumer.validateSamConsumerExport, 'function', 'persisted export gate must inspect decoded pixels and identity, not just a download event');
const exported = { mimeType: 'image/png', width: 2, height: 1, pixels: Uint8Array.from([255, 255, 255, 255, 0, 0, 0, 255]),
  sha256: 'sha256:export', source: '/api/read?root=image-inbox&path=export.png', name: 'wheel-mask.png' };
const sourcePixels = Uint8Array.from([42, 43, 44, 255, 10, 20, 30, 255]);
const exportContract = { kind: 'mask', width: 2, height: 1, mask: Uint8Array.from([1, 0]), sourcePixels,
  libraryEntry: { ...exported, pixels: undefined } };
consumer.validateSamConsumerExport(exported, exportContract);
for (const change of [{ width: 1 }, { mimeType: 'image/jpeg' }, { pixels: new Uint8Array(8) },
  { sha256: 'sha256:stale' }, { source: '/old.png' }]) {
  assert.throws(() => consumer.validateSamConsumerExport({ ...exported, ...change }, exportContract));
}
consumer.validateSamConsumerExport({ ...exported, pixels: Uint8Array.from([42, 43, 44, 255, 0, 0, 0, 0]) }, { ...exportContract, kind: 'cutout' });
assert.throws(() => consumer.validateSamConsumerExport({ ...exported, pixels: sourcePixels }, { ...exportContract, kind: 'cutout' }), /alpha/);
const out = mkdtempSync(join(tmpdir(), 'kaminos-sam-consumer-'));
const result = spawnSync(process.execPath, [witness.pathname, '--out-dir', out, '--expected-commit', 'not-the-source'], { encoding: 'utf8' });
assert.notEqual(result.status, 0);
const failure = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
assert.equal(failure.status, 'failed');
assert.equal(failure.failurePhase, 'source-identity');
assert.equal(failure.runs.length, 0);
console.log('Kaminos SAM consumer witness falsifiers passed');
