import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const coreSource = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');

assert.match(
  coreSource,
  /world-gradient-tangent-covariance-v0/,
  'renderer must expose a truthful world-oriented tangent covariance identity',
);
assert.match(
  coreSource,
  /camera-facing-billboard-v0/,
  'renderer must retain the camera-facing billboard comparison identity',
);
assert.match(
  coreSource,
  /rendered-gaussian-integrated-alpha-conserved-v0/,
  'world covariance must preserve the fragment kernel integrated-alpha conservation law',
);
assert.match(coreSource, /attributePayloadSha256/, 'GPU audit must hash the complete effective per-candidate attribute payload');
assert.match(
  coreSource,
  /boundarySplatSupportGradient/,
  'world covariance orientation must derive from frozen state support rather than the camera',
);

const witnessSource = await readFile(new URL('../volume-raymarch-filament-orbit-witness.mjs', import.meta.url), 'utf8');
assert.match(witnessSource, /analytic_conserved/, 'camera orbit must capture the conserved analytic billboard family');
assert.match(witnessSource, /learned_conserved/, 'camera orbit must capture the conserved learned billboard family');
assert.match(witnessSource, /world_covariance/, 'camera orbit must capture the world covariance family');
assert.match(witnessSource, /sampleBoundarySplatFootprintAudit/, 'camera orbit must audit candidate identity and area/opacity conservation');
assert.match(witnessSource, /heldOutCameraIndices/, 'camera orbit must publish an explicit held-out camera split');
assert.match(witnessSource, /rendererFootprintAuthority/, 'holdout rows must carry effective renderer footprint authority');
assert.match(witnessSource, /attributePayloadSha256/, 'holdout rows must carry measured per-candidate attribute identity');
assert.match(witnessSource, /capture-report\.json/, 'a post-capture validation failure must preserve the complete capture report beside the failure envelope');

const { canonicalizeBoundarySplatAuditRows } = await import('../volume-core.js');
const auditRowA = [0.5, -0.5, 0.25, 0.8, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const auditRowB = [-0.5, 0.5, -0.25, 0.6, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
const canonicalForward = canonicalizeBoundarySplatAuditRows(Float32Array.from([...auditRowA, ...auditRowB]), 2, 16);
const canonicalPermuted = canonicalizeBoundarySplatAuditRows(Float32Array.from([...auditRowB, ...auditRowA]), 2, 16);
assert.deepEqual(canonicalForward.positionSupport, canonicalPermuted.positionSupport, 'candidate identity must ignore GPU atomic append permutation');
assert.deepEqual(canonicalForward.attributes, canonicalPermuted.attributes, 'effective attributes must remain paired with their canonical candidate row');

const oracle = await import('../boundary-splat-camera-holdout-oracle.mjs');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function artifact(root, name, bytes) {
  const path = join(root, name);
  await writeFile(path, bytes);
  return { path, bytes: bytes.length, sha256: sha256(bytes) };
}

const root = await mkdtemp(join(tmpdir(), 'kaminos-covariance-holdout-contract-'));
const cameraRows = [];
for (let cameraIndex = 0; cameraIndex < 3; cameraIndex += 1) {
  const cameraHash = sha256(Buffer.from(`camera-${cameraIndex}`));
  const target = await artifact(root, `target-${cameraIndex}.png`, Buffer.from(`target-${cameraIndex}`));
  for (const family of ['analytic-billboard', 'learned-billboard', 'world-tangent-covariance']) {
    const image = await artifact(root, `${family}-${cameraIndex}.png`, Buffer.from(`${family}-${cameraIndex}`));
    cameraRows.push({
      cameraIndex,
      cameraPoseHash: cameraHash,
      family,
      familyAuthority: {
        'analytic-billboard': 'camera-facing-billboard-v0',
        'learned-billboard': 'learned-camera-facing-billboard-v0',
        'world-tangent-covariance': 'world-gradient-tangent-covariance-v0',
      }[family],
      rendererFootprintAuthority: {
        'analytic-billboard': 'camera-facing-billboard-v0',
        'learned-billboard': 'learned-camera-facing-billboard-v0',
        'world-tangent-covariance': 'world-gradient-tangent-covariance-v0',
      }[family],
      auditFootprintAuthority: {
        'analytic-billboard': 'camera-facing-billboard-v0',
        'learned-billboard': 'learned-camera-facing-billboard-v0',
        'world-tangent-covariance': 'world-gradient-tangent-covariance-v0',
      }[family],
      attributeSetId: family === 'analytic-billboard' ? 'analytic-fixed-attrs' : 'learned-fixed-attrs',
      attributePayloadAuthority: 'gpu-compacted-boundary-splat-effective-attributes-v0',
      attributePayloadSha256: family === 'analytic-billboard' ? 'b'.repeat(64) : 'c'.repeat(64),
      candidateCount: 93189,
      instanceCount: 93189,
      overflowCount: 0,
      candidatePayloadSha256: 'a'.repeat(64),
      fallbackReason: null,
      targetAuthority: 'smoke-off-complete-flame-local-emission-extinction-v0',
      target,
      image,
      conservation: {
        authority: 'rendered-gaussian-integrated-alpha-conserved-v0',
        baseIntegratedAlphaSum: 12.5,
        effectiveIntegratedAlphaSum: 12.5,
        relativeError: 0,
      },
    });
  }
}

const report = {
  schema: 'kaminos.boundary-splat-camera-holdout-oracle.v0',
  status: 'completed',
  requestedRoute: '/volume-selective-head-live.html',
  effectiveWrapperRoute: 'exact-basin-selective-head-live-v0',
  effectiveRendererRoute: 'native-3d-compute-fluid-raymarch-v0',
  backend: 'WebGPU:apple',
  fallbackReason: null,
  sourceSettingsPreset: {
    presetId: 'vsp-5d9fedbab31583860d39a34751ff5cd847116cd6fe6eeee6b4379909ef4bb2a2',
    authority: 'shared-volume-settings-preset-v2',
  },
  frozenState: {
    sameStateCaptureId: 'filament-orbit-f53-s53',
    frameCount: 53,
    simStepCount: 53,
    controlsHash: 'cfa8700f93bb4e5c4720b5e399fc50d2c818d21545dbb0d403c1acbc5d25635a',
  },
  candidatePayload: {
    authority: 'gpu-compacted-boundary-splat-candidates-frozen-state-v0',
    count: 93189,
    strideFloats: 19,
    sha256: 'a'.repeat(64),
  },
  trainCameraIndices: [1],
  heldOutCameraIndices: [0, 2],
  cameraRows,
};

const validated = await oracle.validateCameraHoldoutReport(report);
assert.equal(validated.cameraCount, 3);
assert.deepEqual(validated.heldOutCameraIndices, [0, 2]);
assert.equal(validated.familyCount, 3);

await assert.rejects(
  () => oracle.validateCameraHoldoutReport({
    ...report,
    cameraRows: report.cameraRows.map((row, index) => index === 7 ? { ...row, attributePayloadSha256: 'd'.repeat(64) } : row),
  }),
  /attribute payload.*reused/i,
);

await assert.rejects(
  () => oracle.validateCameraHoldoutReport({
    ...report,
    cameraRows: report.cameraRows.map((row, index) => index === 8
      ? { ...row, rendererFootprintAuthority: 'learned-camera-facing-billboard-v0' }
      : row),
  }),
  /effective.*footprint.*authority/i,
);

await assert.rejects(
  () => oracle.validateCameraHoldoutReport({
    ...report,
    cameraRows: report.cameraRows.map((row, index) => index === 2
      ? { ...row, conservation: { ...row.conservation, effectiveIntegratedAlphaSum: 14, relativeError: 0.12 } }
      : row),
  }),
  /integrated.*alpha.*conservation/i,
);

await assert.rejects(
  () => oracle.validateCameraHoldoutReport({
    ...report,
    cameraRows: report.cameraRows.map((row, index) => index === 4 ? { ...row, candidateCount: 93000 } : row),
  }),
  /candidate count/i,
);

await assert.rejects(
  () => oracle.validateCameraHoldoutReport({
    ...report,
    cameraRows: report.cameraRows.map((row, index) => index === 5 ? { ...row, fallbackReason: 'billboard-fallback' } : row),
  }),
  /fallback/i,
);

const cachedImage = report.cameraRows[0].image;
await assert.rejects(
  () => oracle.validateCameraHoldoutReport({
    ...report,
    cameraRows: report.cameraRows.map(row => row.family === 'analytic-billboard' ? { ...row, image: cachedImage } : row),
  }),
  /cached or static/i,
);

console.log('boundary splat world covariance contracts passed');
