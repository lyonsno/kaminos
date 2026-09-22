import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const witness = new URL('../sam-image-witness.mjs', import.meta.url);
assert.ok(existsSync(witness), 'the actual Kaminos consumer needs a rerunnable image-to-export witness');
const { validateSamConsumerOutput } = await import(witness);
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
const out = mkdtempSync(join(tmpdir(), 'kaminos-sam-consumer-'));
const result = spawnSync(process.execPath, [witness.pathname, '--out-dir', out, '--expected-commit', 'not-the-source'], { encoding: 'utf8' });
assert.notEqual(result.status, 0);
const failure = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
assert.equal(failure.status, 'failed');
assert.equal(failure.failurePhase, 'source-identity');
assert.equal(failure.runs.length, 0);
console.log('Kaminos SAM consumer witness falsifiers passed');
