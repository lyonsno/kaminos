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

const fireSimLookFields = index.match(/const FIRESIM_LOOK_FIELDS = \[([\s\S]*?)\];/)?.[1] || '';
for (const [key] of expectedControls) {
  assert.match(fireSimLookFields, new RegExp(`'${key}'`), `${key} is saved as authored reconstruction state`);
}

assert.match(core, /FLOW_RECONSTRUCTION_KERNEL_IDENTITY\s*=\s*'flow-tangent-positive-symmetric-trilinear-v0'/, 'kernel has a stable semantic identity');
assert.match(core, /function normalizeFlowKernelStrength/, 'kernel strength is normalized once on the host');
assert.match(core, /function normalizeFlowKernelRadius/, 'world-space feature radius is normalized once on the host');
assert.match(core, /function normalizeFlowKernelCoherence/, 'flow coherence is normalized once on the host');
assert.match(core, /reconstruction_kernel_controls:\s*vec4<f32>/, 'raymarch receives a dedicated reconstruction uniform vector');

const reconstructionFunction = core.match(/fn sampleWorldFlowReconstruction\(p: vec3<f32>\) -> FlowReconstructionSample \{([\s\S]*?)\n\}/)?.[1] || '';
const reconstructionNormalFunction = core.match(/fn flowReconstructionNormal\(p: vec3<f32>\) -> vec3<f32> \{([\s\S]*?)\n\}/)?.[1] || '';
const reconstructionMixFunction = core.match(/fn mixFlowReconstructionSample\([\s\S]*?\) -> FlowReconstructionSample \{([\s\S]*?)\n\}/)?.[1] || '';
const reconstructionRawFunction = core.match(/fn sampleWorldFlowReconstructionRaw\(p: vec3<f32>\) -> FlowReconstructionSample \{([\s\S]*?)\n\}/)?.[1] || '';
assert.match(reconstructionFunction, /let center = sampleWorldFlowReconstructionRaw\(p\)/, 'every reconstruction starts from the authoritative trilinear center sample');
assert.match(reconstructionFunction, /if \(strength <= 0\.0\) \{ return center; \}/, 'zero strength is an exact identity path before auxiliary taps');
assert.match(reconstructionFunction, /let forward = sampleWorldFlowReconstructionRaw\(p \+ tangent \* radiusWorld\)/, 'positive tangent tap remains a trilinear world sample');
assert.match(reconstructionFunction, /let backward = sampleWorldFlowReconstructionRaw\(p - tangent \* radiusWorld\)/, 'negative tangent tap is symmetric with the positive tap');
assert.match(reconstructionMixFunction, /centerWeight = 0\.5/, 'the fixed center tap is positive');
assert.match(reconstructionMixFunction, /neighborWeight = 0\.25/, 'both fixed neighbor taps are positive and normalized with the center');
const radiusExpression = reconstructionFunction.match(/let radiusWorld\s*=([^;]+);/)?.[1] || '';
assert.doesNotMatch(radiusExpression, /f32\(GRID\)/, 'authored radius is world-space rather than grid-cell-space');
assert.match(reconstructionFunction, /velocityTangent = center\.velocityDensity\.xyz - normal \* dot\(center\.velocityDensity\.xyz, normal\)/, 'flow direction is velocity projected into the structural tangent plane');
assert.match(reconstructionNormalFunction, /gradientWorld \/ max\(gradientLength, 0\.0001\)/, 'zero-gradient raymarch normals cannot create a non-finite intermediate');
assert.match(reconstructionFunction, /kernelCurlActivity[\s\S]*coherence[\s\S]*radiusWorld/, 'curl activity modulates reach through the coherence control');
assert.doesNotMatch(reconstructionFunction, /divergenceAtCell[\s\S]*tangent/, 'divergence does not become a sampling direction');
assert.doesNotMatch(reconstructionRawFunction, /sampleWorldBoundarySidecar/, 'kernel-off raymarch does not add sidecar reads to modes that never consume the sidecar');
const reconstructedSidecarFunction = core.match(/fn sampleWorldFlowReconstructedSidecar\([\s\S]*?\) -> vec4<f32> \{([\s\S]*?)\n\}/)?.[1] || '';
assert.match(reconstructedSidecarFunction, /let center = sampleWorldBoundarySidecar\(p\)/, 'sidecar reconstruction stays lazy at its semantic consumer');
assert.match(reconstructedSidecarFunction, /if \(strength <= 0\.0\) \{ return center; \}/, 'kernel-off sidecar sampling returns before neighbor taps');

const raymarchLoop = core.match(/for \(var i = 0; i < 192; i = i \+ 1\) \{([\s\S]*?)\n  \}/)?.[1] || '';
assert.match(raymarchLoop, /let reconstructed = sampleWorldFlowReconstruction\(p\)/, 'raymarch consumes the reconstructed semantic bundle');
assert.match(raymarchLoop, /reconstructed\.velocityDensity[\s\S]*reconstructed\.material[\s\S]*reconstructed\.fireLayer[\s\S]*reconstructed\.microLayer[\s\S]*reconstructed\.frontTopology/, 'raymarch consumes every reconstructed field lane together');

assert.match(core, /struct BoundarySplatCamera[\s\S]*reconstructionControls:\s*vec4<f32>/, 'splat compaction receives the same effective reconstruction controls');
const splatReconstructionFunction = core.match(/fn boundarySplatFlowReconstruction\(world: vec3<f32>\) -> BoundarySplatReconstructionSample \{([\s\S]*?)\n\}/)?.[1] || '';
assert.match(splatReconstructionFunction, /if \(strength <= 0\.0\) \{ return center; \}/, 'splat feature reconstruction has the same exact identity path');
assert.match(splatReconstructionFunction, /centerWeight = 0\.5[\s\S]*neighborWeight = 0\.25/, 'splat feature reconstruction uses the same positive symmetric kernel');
const splatCompactor = core.match(/fn compactBoundarySplats[\s\S]*?(?=\n@compute @workgroup_size\(1\)\nfn finalizeBoundarySplats)/)?.[0] || '';
assert.match(splatCompactor, /let admissionSidecar = boundarySidecar\[cellIndex\]/, 'splat candidate admission retains native cell authority');
assert.match(splatCompactor, /if \(reconstructionStrength > 0\.0\) \{[\s\S]*boundarySplatFlowReconstruction\(world\)/, 'kernel-off splat compaction bypasses trilinear reconstruction work');
assert.match(splatCompactor, /boundarySplatAttributeFeatures\(sidecar, material, fire, micro\)/, 'learned splat attributes consume the conditionally reconstructed feature bundle');

assert.match(core, /flowKernelIdentity:\s*FLOW_RECONSTRUCTION_KERNEL_IDENTITY/, 'runtime state records effective kernel identity');
assert.match(core, /flowKernelRequested:[\s\S]*strength:[\s\S]*radiusWorld:[\s\S]*coherence:/, 'runtime state records requested authoring values');
assert.match(core, /flowKernelEffective:[\s\S]*strength:[\s\S]*radiusWorld:[\s\S]*coherence:/, 'runtime state records normalized effective values');
assert.match(core, /flowKernelCandidateAdmissionAuthority:\s*'native-cell-unfiltered'/, 'runtime state makes unchanged splat admission authority explicit');
const temporalControlSignature = core.match(/function temporalControlSignature\(snapshot = controlsSnapshot\) \{([\s\S]*?)\n  \}/)?.[1] || '';
for (const [key] of expectedControls) {
  assert.match(temporalControlSignature, new RegExp(`snapshot\\.${key}`), `${key} changes invalidate temporal history`);
}
assert.match(witness, /expectedFlowKernelStrength/, 'visual witness derives expected kernel strength from the requested route');
assert.match(witness, /function quantizeFlowKernelControl/, 'visual witness models the declared HTML range steps instead of expecting impossible values');
assert.match(witness, /state\.flowKernelIdentity[\s\S]*FLOW_RECONSTRUCTION_KERNEL_IDENTITY/, 'visual witness verifies effective kernel identity');
assert.match(witness, /state\.flowKernelEffective\?\.strength[\s\S]*expectedFlowKernelStrength/, 'visual witness verifies effective kernel strength');
assert.match(witness, /state\.flowKernelEffective\?\.radiusWorld[\s\S]*expectedFlowKernelRadius/, 'visual witness verifies effective world-space radius');
assert.match(witness, /state\.flowKernelEffective\?\.coherence[\s\S]*expectedFlowKernelCoherence/, 'visual witness verifies effective flow coherence');

const frozenRenderFunction = core.match(/async function renderFrozenScaleToCanvas\(options = \{\}\) \{([\s\S]*?)\n  \}\n\n  async function ensureNativeLowSelectiveSharedRuntime/)?.[1] || '';
assert.match(frozenRenderFunction, /flowKernelIdentity:\s*state\.flowKernelIdentity/, 'frozen render receipt preserves the effective kernel identity');
assert.match(frozenRenderFunction, /flowKernelRequested:\s*state\.flowKernelRequested/, 'frozen render receipt preserves requested kernel controls');
assert.match(frozenRenderFunction, /flowKernelEffective:\s*state\.flowKernelEffective/, 'frozen render receipt preserves normalized effective kernel controls');
assert.match(frozenRenderFunction, /flowKernelCandidateAdmissionAuthority:\s*state\.flowKernelCandidateAdmissionAuthority/, 'frozen splat receipt proves that reconstruction did not replace native-cell candidate admission');

console.log('volume flow reconstruction kernel contracts passed');
