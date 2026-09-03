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
const positiveZeroRow = [0, 0.25, 0.5, 0.75, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const negativeZeroRow = [-0, 0.25, 0.5, 0.75, -0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const signedZeroForward = canonicalizeBoundarySplatAuditRows(Float32Array.from([...positiveZeroRow, ...negativeZeroRow]), 2, 16);
const signedZeroPermuted = canonicalizeBoundarySplatAuditRows(Float32Array.from([...negativeZeroRow, ...positiveZeroRow]), 2, 16);
assert.deepEqual(
  new Uint8Array(signedZeroForward.positionSupport.buffer),
  new Uint8Array(signedZeroPermuted.positionSupport.buffer),
  'candidate canonical order must distinguish signed-zero bytes',
);
assert.deepEqual(
  new Uint8Array(signedZeroForward.attributes.buffer),
  new Uint8Array(signedZeroPermuted.attributes.buffer),
  'attribute canonical order must distinguish signed-zero bytes while preserving row pairing',
);

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
  () => oracle.validateCameraHoldoutReport(report, { requireKernelMoment: true }),
  /kernel moment.*missing/i,
);

const kernelRows = [];
for (let cameraIndex = 0; cameraIndex < 3; cameraIndex += 1) {
  const image = await artifact(root, `flow-kernel-moment-covariance-${cameraIndex}.png`, Buffer.from(`flow-kernel-moment-covariance-${cameraIndex}`));
  const baseRow = cameraRows.find(row => row.cameraIndex === cameraIndex);
  kernelRows.push({
    ...baseRow,
    family: 'flow-kernel-moment-covariance',
    familyAuthority: 'base-footprint-plus-flow-kernel-second-moment-tangent-covariance-v0',
    rendererFootprintAuthority: 'base-footprint-plus-flow-kernel-second-moment-tangent-covariance-v0',
    auditFootprintAuthority: 'base-footprint-plus-flow-kernel-second-moment-tangent-covariance-v0',
    attributeSetId: 'learned-fixed-attrs',
    attributePayloadSha256: 'd'.repeat(64),
    image,
    kernelTreatment: {
      identity: 'flow-tangent-positive-symmetric-trilinear-v0',
      candidateAdmissionAuthority: 'structural-splat-candidates-v0',
      firstMomentAuthority: 'zero-first-moment-candidate-centers-fixed-v0',
      strength: 1,
      radiusWorld: 0.03,
      coherence: 1,
    },
  });
}
const kernelCameraRows = [...cameraRows, ...kernelRows];
const preflightModeByFamily = {
  'analytic-billboard': 'analyticBillboard',
  'learned-billboard': 'learnedBillboard',
  'world-tangent-covariance': 'worldCovariance',
  'flow-kernel-moment-covariance': 'kernelMomentCovariance',
};
const kernelPreflight = Object.entries(preflightModeByFamily).map(([family, mode]) => {
  const admitted = kernelCameraRows.find(row => row.cameraIndex === 1 && row.family === family);
  return {
    identity: 'footprint-family-preflight-v0',
    family,
    mode,
    candidateCount: admitted.candidateCount,
    candidatePayloadSha256: admitted.candidatePayloadSha256,
    attributePayloadSha256: admitted.attributePayloadSha256,
  };
});
const kernelReport = {
  ...report,
  cameraRows: kernelCameraRows,
  footprintFamilyPreflight: kernelPreflight,
};
assert.equal(
  typeof oracle.validateCaptureReportFootprintPreflight,
  'function',
  'capture-report preflight family identity must have a directly testable predicate',
);
const captureReport = {
  footprintFamilyPreflight: kernelPreflight,
  covarianceAnalysis: { trainingCameraIndex: 1 },
  captures: kernelCameraRows
    .filter(row => row.cameraIndex === 1)
    .map(row => ({
      cameraIndex: row.cameraIndex,
      mode: preflightModeByFamily[row.family],
      boundarySplatCandidateCount: row.candidateCount,
      footprintAudit: {
        candidatePayloadSha256: row.candidatePayloadSha256,
        attributePayloadSha256: row.attributePayloadSha256,
      },
    })),
};
assert.equal(oracle.validateCaptureReportFootprintPreflight(captureReport).familyCount, 4);
assert.throws(
  () => oracle.validateCaptureReportFootprintPreflight({
    ...captureReport,
    footprintFamilyPreflight: kernelPreflight.map((row, index) => index === 0
      ? { ...row, family: 'unknown-family' }
      : row),
  }),
  /preflight.*unknown family/i,
);
assert.throws(
  () => oracle.validateCaptureReportFootprintPreflight({
    ...captureReport,
    footprintFamilyPreflight: kernelPreflight.map((row, index) => index === 1
      ? { ...row, family: kernelPreflight[0].family }
      : row),
  }),
  /preflight.*duplicate family/i,
);
const crossFamilyDriftHash = 'f'.repeat(64);
const crossFamilyDriftMode = preflightModeByFamily['flow-kernel-moment-covariance'];
assert.throws(
  () => oracle.validateCaptureReportFootprintPreflight({
    ...captureReport,
    footprintFamilyPreflight: kernelPreflight.map(row => row.family === 'flow-kernel-moment-covariance'
      ? {
          ...row,
          candidateCount: row.candidateCount + 1,
          candidatePayloadSha256: crossFamilyDriftHash,
        }
      : row),
    captures: captureReport.captures.map(row => row.mode === crossFamilyDriftMode
      ? {
          ...row,
          boundarySplatCandidateCount: row.boundarySplatCandidateCount + 1,
          footprintAudit: {
            ...row.footprintAudit,
            candidatePayloadSha256: crossFamilyDriftHash,
          },
        }
      : row),
  }),
  /preflight.*candidate payload.*families/i,
);
const validatedKernel = await oracle.validateCameraHoldoutReport(kernelReport, { requireKernelMoment: true });
assert.equal(validatedKernel.familyCount, 4);

await assert.rejects(
  () => oracle.validateCameraHoldoutReport({
    ...kernelReport,
    footprintFamilyPreflight: kernelPreflight.map((row, index) => index === 0
      ? { ...row, candidatePayloadSha256: 'e'.repeat(64) }
      : row),
  }, { requireKernelMoment: true }),
  /preflight.*candidate payload.*admitted/i,
);

await assert.rejects(
  () => oracle.validateCameraHoldoutReport({
    ...kernelReport,
    footprintFamilyPreflight: kernelPreflight.map((row, index) => index === 1
      ? { ...row, attributePayloadSha256: 'e'.repeat(64) }
      : row),
  }, { requireKernelMoment: true }),
  /preflight.*attribute payload.*admitted/i,
);

await assert.rejects(
  () => oracle.validateCameraHoldoutReport({
    ...kernelReport,
    footprintFamilyPreflight: kernelPreflight.slice(1),
  }, { requireKernelMoment: true }),
  /preflight.*families/i,
);

await assert.rejects(
  () => oracle.validateCameraHoldoutReport({
    ...kernelReport,
    footprintFamilyPreflight: [...kernelPreflight, kernelPreflight[0]],
  }, { requireKernelMoment: true }),
  /preflight.*duplicate/i,
);

await assert.rejects(
  () => oracle.validateCameraHoldoutReport({
    ...kernelReport,
    footprintFamilyPreflight: kernelPreflight.map((row, index) => index === 0
      ? { ...row, family: 'unknown-family' }
      : row),
  }, { requireKernelMoment: true }),
  /preflight.*unknown family/i,
);

const replayBridgeReport = {
  ...report,
  sourceSettingsPreset: {
    presetId: null,
    authority: null,
  },
  sourceRouteAuthority: 'checksum-anchor-bridge-explicit-controls-hash-v0',
  replayAuthority: {
    warmupAuthority: 'checksum-bound-exact-basin-step96-field-anchor-v0',
    warmupTarget: 96,
    warmupComplete: true,
    warmupReceipt: {
      ok: true,
      authority: 'checksum-bound-exact-basin-step96-field-anchor-v0',
      completedSteps: 96,
      grid: 160,
      fluidSha256: 'd58df9b715f0e7cd21b2e97811e5f19b2ecf2e7494a7e2bbc3866f61fcb94ac1',
      frontSha256: '1fd70b831b7f377d2923288715ca6ccbe26939790fd51b8f759ffb7c00ff29e8',
    },
    freezeAfterWarmupRequested: true,
    postWarmupFreezeReceipt: {
      paused: true,
      frameCount: 96,
      simStepCount: 96,
      authority: 'witness-owned-presented-frame-pause-release-v0',
    },
  },
  frozenState: {
    sameStateCaptureId: 'filament-orbit-f96-s96',
    frameCount: 96,
    simStepCount: 96,
    controlsHash: 'ba122038332747804203b4d03c6a5e9bf7b1e5969ec5d1f5ef995d3b5adff5b9',
  },
};
const validatedReplayBridge = await oracle.validateCameraHoldoutReport(replayBridgeReport);
assert.equal(validatedReplayBridge.cameraCount, 3);

await assert.rejects(
  () => oracle.validateCameraHoldoutReport({
    ...replayBridgeReport,
    replayAuthority: {
      ...replayBridgeReport.replayAuthority,
      warmupReceipt: {
        ...replayBridgeReport.replayAuthority.warmupReceipt,
        fluidSha256: '0'.repeat(64),
      },
    },
  }),
  /replay source identity/i,
);

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
