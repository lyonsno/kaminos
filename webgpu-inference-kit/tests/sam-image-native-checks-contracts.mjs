import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateSamImageRun, validateSamImageCases, finalizeSamImageFailure, collectSamImageTrial } from './sam-image-native-checks.mjs';

// This synthetic row tests refusal policy; the browser supplies the external contract.
const expected = { invocationId: 'new', sourceSha256: 'sha256:image', prompt: 'wheel', cache: 'miss', maskSize: [2, 1], empty: false };
const row = { adapter: { vendor: 'apple', isFallbackAdapter: false }, wallMilliseconds: 1,
  output: { outputAuthority: 'actual-webgpu-readback', verificationState: 'not-attached', invocationId: 'new',
    sourceImage: { sha256: expected.sourceSha256 }, promptText: 'wheel',
    promptSha256: `sha256:${createHash('sha256').update('wheel').digest('hex')}`,
    imageCache: { status: 'miss' }, requestedRouteId: 'sam.webgpu-local.v0', effectiveRouteId: 'sam.webgpu-local.v0',
    receiptChain: Array.from({ length: 13 }, (_, i) => `route-${i}`), width: 2, height: 1,
    selectedCandidateCount: 1, instances: [{ index: 1, score: 0.9, box: [0, 0, 1, 1], logits: [1, -1], mask: [1, 0] }],
    mask: [1, 0], logits: [1, -1] } };
validateSamImageRun(row, expected);
for (const [change, message] of [
  [r => { r.adapter.isFallbackAdapter = true; }, /native adapter/],
  [r => { r.output.invocationId = 'old'; }, /stale invocation/],
  [r => { r.output.outputAuthority = 'cached'; }, /actual readback/],
  [r => { r.output.imageCache.status = 'hit'; }, /cache/],
  [r => { r.output.sourceImage.sha256 = 'other'; }, /source identity/],
  [r => { r.output.effectiveRouteId = 'fallback'; }, /route fallback/],
  [r => { r.output.instances[0].logits.pop(); }, /partial logits/],
  [r => { r.output.instances[0].mask = [0, 0]; }, /mask\/logit/],
  [r => { r.output.instances = []; }, /partial instances/],
  [r => { r.output.logits[0] = NaN; }, /nonfinite selected/],
  [r => { r.output.mask[0] = 0; }, /selected mask\/logit/],
  [r => { r.output.receiptChain[1] = r.output.receiptChain[0]; }, /route chain/],
]) {
  const invalid = structuredClone(row); change(invalid);
  assert.throws(() => validateSamImageRun(invalid, expected), message);
}
const collected = { name: 'wheel', frames: [10, 20], phases: [{ time: 10, phase: 'run-mask' }],
  adapter: row.adapter, snapshot: { phase: 'complete' }, wallMilliseconds: 10,
  output: structuredClone(row.output), provenance: { request: { invocationId: 'new' } } };
collected.output.instances[0].mask = [0, 0];
let failure;
try { validateSamImageRun(collected, expected); } catch (error) { failure = error; }
assert.match(failure?.message, /mask\/logit disagreement/);
globalThis.window = { samTrial: { startedAt: 10, completedAt: 20, done: true,
  frames: collected.frames, phases: collected.phases, output: collected.output },
  samAdapters: [row.adapter], samImageExample: {
    snapshot: () => ({ phase: 'complete', output: collected.output, foreground: { authority: 'queue-submissions-not-presented-frames' } }),
    provenance: () => { throw new Error('compact collection must not enumerate provenance'); } } };
const compactSignals = collectSamImageTrial();
delete globalThis.window;
assert.equal(compactSignals.output, undefined);
assert.equal(compactSignals.provenance, undefined);
assert.equal(compactSignals.snapshot.output, undefined);
assert.equal(compactSignals.outputMetadata.invocationId, 'new');
assert.equal(compactSignals.outputMetadata.maskLength, 2);
assert.equal(compactSignals.outputMetadata.instanceCount, 1);
assert.deepEqual(compactSignals.frames, collected.frames);
assert.deepEqual(compactSignals.adapter, row.adapter);
assert.equal(compactSignals.wallMilliseconds, 10);
assert.equal(compactSignals.outputAvailable, true);
delete collected.output;
delete collected.provenance;
Object.assign(collected, compactSignals);
const failedReport = { runs: [], phase: 'wheel' };
await finalizeSamImageFailure(failedReport, failure, async () => structuredClone(collected));
assert.equal(failedReport.runs.length, 1, 'terminal failure must retain collected trial');
for (const key of Object.keys(collected)) assert.deepEqual(failedReport.runs[0][key], collected[key]);
assert.equal(failedReport.runs[0].validation.status, 'failed');
assert.equal(failedReport.runs[0].validation.partial, true);
await finalizeSamImageFailure(failedReport, failure, async () => { throw new Error('CDP gone'); });
assert.equal(failedReport.error.message, failure.message, 'CDP failure must not mask validation failure');
assert.equal(failedReport.runs.length, 1);
assert.deepEqual(failedReport.runs[0].frames, collected.frames);
assert.equal(failedReport.collectionError, 'CDP gone');
const registered = { runs: [{ name: 'wheel', motion: [{ path: 'wheel-motion-0.png' }] }], phase: 'wheel' };
await finalizeSamImageFailure(registered, failure, async () => structuredClone(collected));
assert.equal(registered.runs.length, 1, 'registered trial must be updated, not duplicated');
assert.deepEqual(registered.runs[0].motion, [{ path: 'wheel-motion-0.png' }]);
assert.deepEqual(registered.runs[0].outputMetadata, collected.outputMetadata);
validateSamImageCases([{ name: 'wheel', prompt: 'wheel' }, { name: 'seat', prompt: 'seat' }]);
for (const afterTransfer of [false, true]) {
  const terminal = { runs: [], phase: 'wheel' }, events = [];
  const compact = { ...compactSignals, name: 'wheel' };
  await finalizeSamImageFailure(terminal, failure, async () => compact,
    async () => { events.push('persist'); assert.deepEqual(terminal.runs[0].frames, [10, 20]); },
    async trial => {
      events.push('transfer');
      if (afterTransfer) Object.assign(trial, { outputPath: 'wheel-output.json', outputSha256: 'sha256:raw',
        provenancePath: 'wheel-provenance.json', provenanceSha256: 'sha256:inventory' });
      throw new Error('artifact transport gone');
    });
  assert.deepEqual(events, ['persist', 'transfer', 'persist'], 'compact trace must be durable before transfer');
  assert.equal(terminal.error.message, failure.message);
  assert.equal(terminal.runs[0].artifactError, 'artifact transport gone');
  assert.equal(terminal.runs[0].outputPath, afterTransfer ? 'wheel-output.json' : undefined);
  assert.equal(terminal.runs[0].provenanceSha256, afterTransfer ? 'sha256:inventory' : undefined);
  assert.equal(terminal.runs[0].output, undefined);
  await finalizeSamImageFailure(terminal, failure, async () => { throw new Error('CDP gone'); });
  assert.deepEqual(terminal.runs[0].frames, [10, 20]);
  assert.equal(terminal.runs[0].outputSha256, afterTransfer ? 'sha256:raw' : undefined);
  assert.equal(terminal.error.message, failure.message);
}
assert.throws(() => validateSamImageCases([{ name: 'wheel', prompt: 'wheel' },
  { name: 'wheel', prompt: 'seat' }]), /duplicate case name/);
console.log('SAM native consumer evidence rejection contracts passed');
