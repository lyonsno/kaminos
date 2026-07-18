import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildLayeredStructuralWitnessScenario,
  createLayeredStructuralMaterial,
} from '../structural-material-3d-core.js';

const root = new URL('..', import.meta.url).pathname;
const gpuCorePath = join(root, 'structural-material-3d-webgpu-core.js');
const browserWitnessPath = join(root, 'structural-material-3d-webgpu-witness.mjs');
const pagePath = join(root, 'structural-material-3d.html');

assert.ok(existsSync(gpuCorePath), 'WebGPU structural bond-response core exists');
assert.ok(existsSync(browserWitnessPath), 'WebGPU structural parity has a reusable browser witness');

const {
  STRUCTURAL_MATERIAL_3D_WEBGPU_ABI,
  STRUCTURAL_MATERIAL_3D_WEBGPU_ROUTE,
  buildLayeredStructuralCpuBondOracle,
  compareLayeredStructuralGpuParity,
  packLayeredStructuralGpuInteraction,
  packLayeredStructuralGpuSnapshot,
  runLayeredStructuralWebGpuParity,
} = await import('../structural-material-3d-webgpu-core.js');

const gpuCoreSource = readFileSync(gpuCorePath, 'utf8');
const browserWitnessSource = readFileSync(browserWitnessPath, 'utf8');
const pageSource = readFileSync(pagePath, 'utf8');

assert.equal(STRUCTURAL_MATERIAL_3D_WEBGPU_ABI, 'kaminos.structural-material.packed-bond-abi.v0');
assert.equal(STRUCTURAL_MATERIAL_3D_WEBGPU_ROUTE, 'kaminos.structural-material.webgpu-bond-response-parity.v0');
assert.match(gpuCoreSource, /usage\.STORAGE/, 'GPU route owns structural storage buffers');
assert.match(gpuCoreSource, /createComputePipelineAsync/, 'GPU route compiles a real compute pipeline');
assert.match(gpuCoreSource, /dispatchWorkgroups/, 'GPU route dispatches bond workgroups');
assert.match(gpuCoreSource, /atomicAdd/, 'GPU route appends crack-event candidates atomically');
assert.match(gpuCoreSource, /mapMode\.READ/, 'parity witness reads GPU results for validation');
assert.match(browserWitnessSource, /failurePhase/, 'browser witness preserves failure phase');
assert.match(browserWitnessSource, /requestedRoute/, 'browser witness records requested route');
assert.match(browserWitnessSource, /effectiveRoute/, 'browser witness records effective route');
assert.match(browserWitnessSource, /cpuFallbackUsed/, 'browser witness rejects silent CPU fallback');
assert.match(pageSource, /__structuralMaterial3dRunGpuParity/, '3D route exposes WebGPU parity execution');

const scenario = buildLayeredStructuralWitnessScenario();
const state = createLayeredStructuralMaterial({ columns: 9, rows: 5, layers: 4, notch: true });
const packed = packLayeredStructuralGpuSnapshot(state, scenario.force);
const oracle = buildLayeredStructuralCpuBondOracle(state, scenario.force);

assert.equal(packed.abi, STRUCTURAL_MATERIAL_3D_WEBGPU_ABI);
assert.equal(packed.nodeCount, state.nodes.length);
assert.equal(packed.bondCount, state.bonds.length);
assert.equal(packed.nodeData.byteLength, state.nodes.length * packed.layout.nodeStrideBytes);
assert.equal(packed.bondData.byteLength, state.bonds.length * packed.layout.bondStrideBytes);
assert.equal(packed.interactionData.byteLength, packed.layout.interactionBytes);
const packedShiftedContact = packLayeredStructuralGpuInteraction(state, {
  ...scenario.force,
  point: { x: 0.18, y: 0.24, z: 0.5 },
});
const packedShiftedView = new DataView(packedShiftedContact);
assert.ok(Math.abs(packedShiftedView.getFloat32(16, true) - 0.18) < 0.000001, 'packed ABI preserves picked contact x');
assert.ok(Math.abs(packedShiftedView.getFloat32(20, true) - 0.24) < 0.000001, 'packed ABI preserves picked contact y');
assert.ok(Math.abs(packedShiftedView.getFloat32(24, true) - 0.5) < 0.000001, 'packed ABI preserves picked contact z');
assert.equal(oracle.responses.length, state.bonds.length);
assert.equal(oracle.eventCandidates.length, scenario.summaries.cracked.brokenBondCount);
assert.ok(oracle.eventCandidates.some(event => event.bondKind === 'depth'), 'CPU parity oracle includes depth fracture candidates');

const exactGpuResult = {
  responses: oracle.responses.map(response => ({ ...response })),
  eventCandidates: oracle.eventCandidates.map(event => ({ ...event })),
  eventOverflowCount: 0,
};
const exactParity = compareLayeredStructuralGpuParity(oracle, exactGpuResult);
assert.equal(exactParity.ok, true, 'exact GPU-shaped response satisfies CPU parity');
assert.equal(exactParity.breakSetMatches, true);
assert.equal(exactParity.eventSetMatches, true);

const lyingGpuResult = {
  ...exactGpuResult,
  responses: exactGpuResult.responses.map((response, index) => index === 0
    ? { ...response, stress: response.stress + 0.1 }
    : response),
};
const rejectedParity = compareLayeredStructuralGpuParity(oracle, lyingGpuResult);
assert.equal(rejectedParity.ok, false, 'numeric GPU divergence cannot pass parity');
assert.ok(rejectedParity.maxStressError >= 0.09);

const lyingEventResult = {
  ...exactGpuResult,
  eventCandidates: exactGpuResult.eventCandidates.map((event, index) => index === 0
    ? { ...event, energy: event.energy + 0.1 }
    : event),
};
const rejectedEventParity = compareLayeredStructuralGpuParity(oracle, lyingEventResult);
assert.equal(rejectedEventParity.ok, false, 'matching event IDs cannot hide a corrupt causal payload');
assert.ok(rejectedEventParity.maxEventEnergyError >= 0.09);

const unavailable = await runLayeredStructuralWebGpuParity({ state, interaction: scenario.force, gpu: null });
assert.equal(unavailable.status, 'failed', 'missing WebGPU cannot produce a passing receipt');
assert.equal(unavailable.failurePhase, 'gpu-availability');
assert.equal(unavailable.effectiveRoute, null);
assert.equal(unavailable.effectiveBackend, null);
assert.equal(unavailable.cpuFallbackUsed, false, 'GPU route never silently substitutes the CPU oracle');
