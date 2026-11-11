#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const core = readFileSync(resolve(root, 'volume-core.js'), 'utf8');
const index = readFileSync(resolve(root, 'index.html'), 'utf8');
const witness = readFileSync(resolve(root, 'volume-witness.mjs'), 'utf8');

const expectedControls = [
  ['flowKernelStrength', 'volume-flow-kernel-strength', 'volume_flow_kernel_strength'],
  ['flowKernelRadius', 'volume-flow-kernel-radius', 'volume_flow_kernel_radius'],
  ['flowKernelCoherence', 'volume-flow-kernel-coherence', 'volume_flow_kernel_coherence'],
];

for (const [key, id, param] of expectedControls) {
  assert.match(index, new RegExp(`id="${id}"`), `${key} has an operator control`);
  assert.match(index, new RegExp(`key:\\s*'${key}'[\\s\\S]*?id:\\s*'${id}'[\\s\\S]*?param:\\s*'${param}'`), `${key} is basin-URL addressable`);
  assert.match(index, new RegExp(`${key}:\\s*parseFloat\\(document\\.getElementById\\('${id}'\\)\\.value\\)`), `${key} reaches the renderer snapshot`);
}
assert.doesNotMatch(index, /Flow reconstruction follows the support-sheet tangent/, 'the compact authoring surface does not narrate implementation mechanics in-app');

assert.match(core, /FLOW_RECONSTRUCTION_KERNEL_IDENTITY\s*=\s*'flow-tangent-positive-symmetric-trilinear-v0'/, 'kernel has a stable semantic identity');
assert.match(core, /function normalizeFlowKernelStrength/, 'kernel strength is normalized once on the host');
assert.match(core, /function normalizeFlowKernelRadius/, 'world-space feature radius is normalized once on the host');
assert.match(core, /function normalizeFlowKernelCoherence/, 'flow coherence is normalized once on the host');
assert.match(core, /reconstruction_kernel_controls:\s*vec4<f32>/, 'raymarch receives a dedicated reconstruction uniform vector');

const reconstructionFunction = core.match(/fn sampleWorldFlowReconstruction\(p: vec3<f32>\) -> FlowReconstructionSample \{([\s\S]*?)\n\}/)?.[1] || '';
const reconstructionRawFunction = core.match(/fn sampleWorldFlowReconstructionRaw\(p: vec3<f32>\) -> FlowReconstructionSample \{([\s\S]*?)\n\}/)?.[1] || '';
// Numerical mixing, normals, tap symmetry/identity and world-space radius are
// exercised from production WGSL in volume-flow-reconstruction-native.mjs.
assert.doesNotMatch(reconstructionFunction, /divergenceAtCell[\s\S]*tangent/, 'divergence does not become a sampling direction');
assert.doesNotMatch(reconstructionRawFunction, /sampleWorldBoundarySidecar/, 'kernel-off raymarch does not add sidecar reads to modes that never consume the sidecar');

await (await import('./helpers/fine-admission-native.mjs')).assertNativeFineAdmission();

assert.match(core, /flowKernelIdentity:\s*FLOW_RECONSTRUCTION_KERNEL_IDENTITY/, 'runtime state records effective kernel identity');
assert.match(core, /flowKernelRequested:[\s\S]*strength:[\s\S]*radiusWorld:[\s\S]*coherence:/, 'runtime state records requested authoring values');
assert.match(core, /flowKernelEffective:[\s\S]*strength:[\s\S]*radiusWorld:[\s\S]*coherence:/, 'runtime state records normalized effective values');
assert.doesNotMatch(core, /select\(directCellOpticalSupport\(p\), 1\.0, flowKernelReconstructionActive\)/, 'wider authored reconstruction cannot globally disable empty-cell traversal');
assert.doesNotMatch(core, /fn flowReconstructionOpticalSupport\b/, 'optional filtering does not acquire independent material-support authority');
assert.match(witness, /expectedFlowKernelStrength/, 'visual witness derives expected kernel strength from the requested route');
assert.match(witness, /function quantizeFlowKernelControl/, 'visual witness models the declared HTML range steps instead of expecting impossible values');
assert.match(witness, /state\.flowKernelIdentity[\s\S]*FLOW_RECONSTRUCTION_KERNEL_IDENTITY/, 'visual witness verifies effective kernel identity');
assert.match(witness, /state\.flowKernelEffective\?\.strength[\s\S]*expectedFlowKernelStrength/, 'visual witness verifies effective kernel strength');
assert.match(witness, /state\.flowKernelEffective\?\.radiusWorld[\s\S]*expectedFlowKernelRadius/, 'visual witness verifies effective world-space radius');
assert.match(witness, /state\.flowKernelEffective\?\.coherence[\s\S]*expectedFlowKernelCoherence/, 'visual witness verifies effective flow coherence');



console.log('volume flow reconstruction kernel contracts passed');
