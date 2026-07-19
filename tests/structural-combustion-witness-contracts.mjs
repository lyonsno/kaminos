import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { validateStructuralCombustionEvidence } from '../structural-combustion-evidence.mjs';

const witnessSource = readFileSync(new URL('../structural-combustion-witness.mjs', import.meta.url), 'utf8');
assert.match(
  witnessSource,
  /function isExecutionContextReplacement/,
  'browser witness names the bounded navigation-context replacement retry class',
);
assert.match(
  witnessSource,
  /if \(!isExecutionContextReplacement\(error\)\) throw error/,
  'browser witness retries only execution-context replacement instead of hiding other failures',
);
assert.match(
  witnessSource,
  /initialState\.status === 'failed'[\s\S]*pageFailure: initialState/,
  'a failed page state becomes durable evidence instead of a null CDP wrapper failure',
);
assert.match(
  witnessSource,
  /effectiveUrl = await evaluatePage\('location\.href'\)[\s\S]*initialState\.status === 'failed'/,
  'effective route identity is captured before a failed page state is reported',
);
assert.match(
  witnessSource,
  /meshAssetReceipt:\s*initialState\.meshAssetReceipt/,
  'browser evidence must preserve the effective imported asset receipt',
);
assert.match(
  witnessSource,
  /presentationMode:\s*initialState\.gpuLoop\.presentationMode/,
  'browser evidence must preserve the effective structural presentation mode',
);

const fixture = {
  requestedUrl: 'http://127.0.0.1:8178/structural-combustion.html',
  effectiveUrl: 'http://127.0.0.1:8178/structural-combustion.html',
  requestedBackend: 'webgpu',
  effectiveBackend: 'WebGPU:apple',
  pageRoute: 'kaminos.structural-combustion-dimensional-witness.v0',
  authority: 'same-device-pyro-node-material-bond-strength-v0',
  presentationMode: 'indexed-mesh-skin-resident-structural-proxy-v0',
  meshAssetReceipt: {
    status: 'loaded',
    requestedUrl: './assets/structural-combustion/irregular-timber-two-island.glb',
    effectiveUrl: 'http://127.0.0.1:8178/assets/structural-combustion/irregular-timber-two-island.glb',
    assetIdentity: `sha256:${'a'.repeat(64)}`,
    byteLength: 4084,
    vertexCount: 84,
    triangleCount: 96,
    islandIds: ['free', 'root'],
  },
  initial: {
    screenshot: { sha256: 'initial', nonDarkPixels: 2400, sampledPixels: 9216 },
    frame: 24,
    camera: { yaw: 0, pitch: 0, distance: 3.2, interactionCount: 0 },
  },
  orbited: {
    screenshot: { sha256: 'orbited', nonDarkPixels: 2420, sampledPixels: 9216 },
    camera: { yaw: 0.4, pitch: 0.2, distance: 3.8, interactionCount: 2 },
  },
  final: {
    screenshot: { sha256: 'final', nonDarkPixels: 2550, sampledPixels: 9216 },
    frame: 924,
    terminalReceipt: {
      mode: 'carried-fire',
      status: 'passed',
      checks: {
        targetIgnited: true,
        nearFaceExposed: true,
        farFaceHeated: true,
        targetWeakened: true,
        targetSeparated: true,
        fractureAfterIgnition: true,
        controlCool: true,
        controlConnected: true,
        sourceFinalized: true,
        sourceAccepted: true,
        noHostFeedback: true,
        detachedEmitterMoved: true,
        movedSourceAccepted: true,
        propagationTargetExposed: true,
        propagationAfterDetachment: true,
        propagationWithinMovedSourceWindow: true,
        propagationTargetIgnited: true,
        propagationControlCool: true,
      },
      structures: [
        { role: 'emitter', meshAssetIdentity: `sha256:${'a'.repeat(64)}`, meshTriangleCount: 96 },
        { role: 'control', meshAssetIdentity: `sha256:${'a'.repeat(64)}`, meshTriangleCount: 96 },
        { role: 'propagation-target', meshAssetIdentity: `sha256:${'a'.repeat(64)}`, meshTriangleCount: 96 },
        { role: 'propagation-control', meshAssetIdentity: `sha256:${'a'.repeat(64)}`, meshTriangleCount: 96 },
      ],
      carriedAudit: { movedSourceRecords: 12, firstMovedSourceStep: 120, lastMovedSourceStep: 180 },
      dispatchCount: 900,
      presentationCount: 900,
      liveRuntimeReadbackCount: 0,
      terminalReadbackCount: 1,
      terminalMapAsyncCount: 1,
      hostCausalFeedbackCount: 0,
    },
  },
  runtimeErrors: [],
};

assert.equal(validateStructuralCombustionEvidence(fixture).status, 'passed');
assert.throws(
  () => validateStructuralCombustionEvidence({ ...fixture, effectiveUrl: 'http://127.0.0.1:8178/index.html' }),
  /effective route/i,
);
assert.throws(
  () => validateStructuralCombustionEvidence({ ...fixture, pageRoute: 'kaminos.structural-combustion-fallback.v0' }),
  /page route identity/i,
);
assert.throws(
  () => validateStructuralCombustionEvidence({ ...fixture, presentationMode: 'solid-cell-surface-with-structural-overlay-v0' }),
  /mesh presentation mode/i,
);
assert.throws(
  () => validateStructuralCombustionEvidence({ ...fixture, meshAssetReceipt: null }),
  /mesh asset receipt/i,
);
assert.throws(
  () => validateStructuralCombustionEvidence({
    ...fixture,
    meshAssetReceipt: { ...fixture.meshAssetReceipt, islandIds: ['root'] },
  }),
  /authored island/i,
);
assert.throws(
  () => validateStructuralCombustionEvidence({
    ...fixture,
    final: {
      ...fixture.final,
      terminalReceipt: {
        ...fixture.final.terminalReceipt,
        structures: fixture.final.terminalReceipt.structures.map((structure, index) => index === 0
          ? { ...structure, meshAssetIdentity: `sha256:${'b'.repeat(64)}` }
          : structure),
      },
    },
  }),
  /mesh asset identity continuity/i,
);
assert.throws(
  () => validateStructuralCombustionEvidence({
    ...fixture,
    final: { ...fixture.final, screenshot: { ...fixture.final.screenshot, sha256: 'initial' } },
  }),
  /stale/i,
);
assert.throws(
  () => validateStructuralCombustionEvidence({
    ...fixture,
    orbited: { ...fixture.orbited, screenshot: { ...fixture.orbited.screenshot, nonDarkPixels: 0 } },
  }),
  /blank/i,
);
assert.throws(
  () => validateStructuralCombustionEvidence({
    ...fixture,
    final: {
      ...fixture.final,
      terminalReceipt: { ...fixture.final.terminalReceipt, status: 'failed' },
    },
  }),
  /terminal receipt/i,
);
assert.throws(
  () => validateStructuralCombustionEvidence({
    ...fixture,
    final: {
      ...fixture.final,
      terminalReceipt: {
        ...fixture.final.terminalReceipt,
        structures: fixture.final.terminalReceipt.structures.filter(
          structure => structure.role !== 'propagation-target',
        ),
      },
    },
  }),
  /propagation-target/i,
);
const { propagationTargetIgnited, ...missingCarriedCheck } = fixture.final.terminalReceipt.checks;
assert.throws(
  () => validateStructuralCombustionEvidence({
    ...fixture,
    final: {
      ...fixture.final,
      terminalReceipt: { ...fixture.final.terminalReceipt, checks: missingCarriedCheck },
    },
  }),
  /propagationTargetIgnited/,
);
assert.throws(
  () => validateStructuralCombustionEvidence({
    ...fixture,
    final: {
      ...fixture.final,
      terminalReceipt: { ...fixture.final.terminalReceipt, liveRuntimeReadbackCount: 1 },
    },
  }),
  /live readback/i,
);
assert.throws(
  () => validateStructuralCombustionEvidence({ ...fixture, runtimeErrors: ['GPU validation failure'] }),
  /runtime error/i,
);

console.log('structural combustion witness contracts: ok');
