import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateSamImageRun } from './sam-image-native-checks.mjs';

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
]) {
  const invalid = structuredClone(row); change(invalid);
  assert.throws(() => validateSamImageRun(invalid, expected), message);
}
console.log('SAM native consumer evidence rejection contracts passed');
