import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const exporter = new URL('../tools/sam31-two-frame-tracker-meta-packet.py', import.meta.url);
const outDir = await mkdtemp(join(tmpdir(), 'sam31-mask-conditioned-meta-'));
const variantOutDir = await mkdtemp(join(tmpdir(), 'sam31-mask-conditioned-meta-variant-'));
const python = process.env.SAM31_TORCH_PYTHON || '/Users/noahlyons/dev/sf3d/.venv/bin/python';
const run = spawnSync(
  python,
  [exporter.pathname, '--out-dir', outDir, '--frame0-mode', 'mask-conditioning'],
  { cwd: root.pathname, encoding: 'utf8', timeout: 240000 },
);
assert.equal(run.status, 0, run.stderr || run.stdout);

const manifest = JSON.parse(await readFile(join(outDir, 'tensor-manifest.json'), 'utf8'));
const receipt = JSON.parse(await readFile(join(outDir, 'reference-receipt.json'), 'utf8'));
const byRole = Object.fromEntries(manifest.tensors.map(entry => [entry.role, entry]));
const floats = async role => {
  assert.ok(byRole[role], `missing tensor role ${role}`);
  const bytes = await readFile(join(outDir, byRole[role].file));
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
};

assert.equal(manifest.schema, 'kaminos.sam31-mask-conditioned-two-frame-tracker-meta-packet.v0');
assert.equal(receipt.schema, 'kaminos.sam31-mask-conditioned-two-frame-tracker-meta-reference-receipt.v0');
assert.equal(manifest.mode, 'official-meta-mask-conditioning-memory-attention-propagation-decoder');
assert.equal(manifest.boundary, 'frame-0-mask-conditioning-to-memory-state-to-frame-1-conditioned-decoder');
assert.equal(receipt.boundary, manifest.boundary);
assert.equal(manifest.stateTransition.frame0OriginKind, 'mask-conditioning');
assert.equal(manifest.stateTransition.maskOwner, 'browser-webgpu');
assert.equal(manifest.stateTransition.pointerOwner, 'official-reference-bridge');
assert.equal(manifest.claims.officialFrame0DecoderExecuted, false);
assert.equal(manifest.claims.officialMaskConditioningMethodExecuted, true);
assert.equal(manifest.claims.officialInteractiveSamHeadsExecuted, true);
assert.equal(manifest.claims.officialInteractivePromptEncoderExecuted, true);
assert.equal(manifest.claims.officialInteractiveMaskDecoderExecuted, true);
assert.equal(manifest.claims.checkpointBackedInteractivePointers, true);
assert.equal(manifest.claims.fullProductionInteractiveGeometryExecuted, false);
assert.deepEqual(manifest.claims.effectiveInteractiveImageEmbeddingSize, [2, 2]);
assert.deepEqual(manifest.claims.effectiveSourceMaskSize, [32, 32]);
assert.deepEqual(manifest.claims.effectivePromptMaskSize, [8, 8]);
assert.deepEqual(manifest.claims.effectiveDecoderMaskSize, [8, 8]);
assert.equal(manifest.claims.officialMemoryMethodExecuted, true);
assert.equal(manifest.claims.officialTemporalMethodExecuted, true);
assert.equal(manifest.claims.officialMemoryAttentionExecuted, true);
assert.equal(manifest.claims.officialFrame1DecoderExecuted, true);

const binaryMasks = await floats('frame-0-binary-mask-inputs');
const memoryMasks = await floats('frame-0-memory-input-masks');
const scores = await floats('frame-0-object-scores');
const pointers = await floats('frame-0-object-pointers');
assert.equal(binaryMasks.length, 16 * 32 * 32);
assert.equal(memoryMasks.length, binaryMasks.length);
assert.equal(scores.length, 16);
assert.equal(pointers.length, 16 * 256);
assert.equal(binaryMasks.every(value => value === 0 || value === 1), true);

let appearing = 0;
let absent = 0;
for (let object = 0; object < 16; object += 1) {
  const begin = object * 32 * 32;
  const end = begin + 32 * 32;
  const present = binaryMasks.slice(begin, end).some(value => value === 1);
  appearing += Number(present);
  absent += Number(!present);
  assert.equal(scores[object], present ? 10 : -10, `object ${object} appearance score must come from the binary input mask`);
  for (let index = begin; index < end; index += 1) {
    assert.equal(memoryMasks[index], binaryMasks[index] === 1 ? 10 : -10, `mask logit ${index} must be the exact Meta mask-as-output conversion`);
  }
}
assert.ok(appearing > 0 && absent > 0, 'the mask-conditioned fixture must witness both appearing and absent objects');
assert.equal(manifest.stateTransition.frame0AppearingObjectCount, appearing);
assert.equal(manifest.stateTransition.frame0AbsentObjectCount, absent);
assert.equal(manifest.stateTransition.frame0SuppressedAbsentMaskCount, 0);
assert.equal(manifest.stateTransition.noObjectMaskScore, null);
assert.ok(byRole['frame-0-memory-features']);
assert.ok(byRole['frame-1-memory-conditioned-features']);
assert.ok(byRole['frame-1-selected-masks']);

const variantRun = spawnSync(
  python,
  [exporter.pathname, '--out-dir', variantOutDir, '--frame0-mode', 'mask-conditioning', '--mask-variant', '1'],
  { cwd: root.pathname, encoding: 'utf8', timeout: 240000 },
);
assert.equal(variantRun.status, 0, variantRun.stderr || variantRun.stdout);
const variantManifest = JSON.parse(await readFile(join(variantOutDir, 'tensor-manifest.json'), 'utf8'));
const variantMask = variantManifest.tensors.find(entry => entry.role === 'frame-0-binary-mask-inputs');
assert.notEqual(variantMask.sha256, byRole['frame-0-binary-mask-inputs'].sha256, 'mask variants must produce distinct invocation-owned mask identities');
assert.equal(variantManifest.fixture.maskVariant, 1);

console.log('sam3.1 mask-conditioned tracker official meta-packet contracts passed');
