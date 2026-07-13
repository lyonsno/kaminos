import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const python = process.env.KAMINOS_TORCH_PYTHON || '/Users/noahlyons/dev/sf3d/.venv/bin/python';
const sourceRoot = process.env.KAMINOS_SAM31_SOURCE || '/Users/noahlyons/dev/sam3';
const checkpoint = process.env.KAMINOS_SAM31_CHECKPOINT || '/Users/noahlyons/.cache/huggingface/hub/models--facebook--sam3.1/snapshots/daa63191845a41281374e725f4c9e51c7a824460/sam3.1_multiplex.pt';
const tool = resolve('tools/sam31-temporal-memory-bank-meta-packet.py');
const outDir = mkdtempSync(join(tmpdir(), 'kaminos-sam31-temporal-bank-'));

try {
  const result = spawnSync(python, [tool, '--out-dir', outDir, '--source-root', sourceRoot, '--checkpoint', checkpoint], { encoding: 'utf8', timeout: 180_000 });
  assert.equal(result.status, 0, `official temporal-bank packet failed:\n${result.stdout}\n${result.stderr}`);
  const manifest = JSON.parse(readFileSync(join(outDir, 'tensor-manifest.json'), 'utf8'));
  const receipt = JSON.parse(readFileSync(join(outDir, 'reference-receipt.json'), 'utf8'));
  assert.equal(receipt.ok, true);
  assert.equal(manifest.reference.source.commit, '5dd401d1c5c1d5c3eedff06d41b77af824517619');
  assert.equal(manifest.reference.source.workingTreeClean, true);
  assert.equal(manifest.reference.model.sha256, 'sha256:0567debeec80ba4ac6369540c6c248025283cb3ff2b92827509e57e2b3541cb6');
  assert.equal(manifest.reference.execution.method, 'Sam3VideoTrackingMultiplex._prepare_memory_conditioned_features');
  assert.equal(manifest.claims.officialVideoMemoryAssemblyExecuted, true);
  assert.equal(manifest.claims.fullSemanticTracking, false);
  assert.deepEqual(manifest.plan.selectedConditioningFrameIndices, [3, 9, 10, 1]);
  assert.deepEqual(manifest.plan.spatialFrameIndices, [3, 9, 10, 1, 2, 4, 5, 6, 7]);
  assert.deepEqual(manifest.plan.pointerFrameIndices, [3, 9, 10, 1, 7, 6, 5, 4, 2, 0]);
  assert.deepEqual(manifest.shape, {
    batch: 1,
    queryHeight: 2,
    queryWidth: 2,
    queryTokens: 4,
    frameTokens: 4,
    spatialFrameCount: 9,
    memorySpatialTokens: 36,
    pointerFrameCount: 10,
    multiplexCount: 16,
    numObjPtrTokens: 160,
    memoryTokens: 196,
    channels: 256,
  });
  assert.equal(manifest.checkpointAudit.memoryAttentionTensorCount, 122);
  assert.equal(manifest.checkpointAudit.temporalPositionTensorCount, 3);
  const roles = new Set(manifest.tensors.map(tensor => tensor.role));
  for (const role of ['assembled-memory-image', 'assembled-memory', 'assembled-memory-image-pos', 'assembled-memory-pos', 'expected-memory-conditioned-features']) assert.ok(roles.has(role), `missing ${role}`);
  assert.equal(manifest.assemblyParity.officialVersusIndependentMaxAbsDiff, 0);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log('sam3.1 official temporal memory-bank packet contracts passed');
