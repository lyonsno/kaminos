#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../volume-witness.mjs', import.meta.url), 'utf8');
const orbitWitness = readFileSync(new URL('../volume-raymarch-filament-orbit-witness.mjs', import.meta.url), 'utf8');
const holdoutOracle = readFileSync(new URL('../boundary-splat-camera-holdout-oracle.mjs', import.meta.url), 'utf8');

assert.match(core, /BOUNDARY_SPLAT_KERNEL_MOMENT_RENDERER_IDENTITY\s*=\s*'live-boundary-sidecar-flow-kernel-moment-covariance-splats-v0'/);
assert.match(core, /BOUNDARY_SPLAT_KERNEL_MOMENT_AUTHORITY\s*=\s*'base-footprint-plus-flow-kernel-second-moment-tangent-covariance-v0'/);
assert.match(core, /normalizeBoundarySplatMode[\s\S]*'kernel_moment_covariance'/, 'the analytical treatment is explicitly requestable');
assert.match(page, /<option value="kernel_moment_covariance">kernel moment covariance<\/option>/, 'the live route can request the treatment without a fallback value');
assert.match(page, /normalizeBoundarySplatMode[\s\S]*'kernel_moment_covariance'/, 'URL and DOM normalization retain the treatment');
assert.match(core, /SUPPORTED_GRID_SIZES\s*=\s*\[[^\]]*140[^\]]*\]/, 'the broad-manifold screen must execute the requested 140^3 state instead of falling back');
assert.match(page, /<option value="140">140\^3<\/option>/, 'the cockpit exposes the exact 140^3 assay grid');
assert.match(page, /\[32, 48, 64, 96, 128, 140, 160\]\.includes\(routeResolution\)/, 'the URL route must retain the requested 140^3 state');
assert.match(witness, /\[32, 48, 64, 96, 128, 140, 160\]\.includes\(requestedGrid\)/, 'the witness must reject any 140^3 fallback');
assert.match(core, /kernel_moment_covariance[\s\S]*BOUNDARY_SPLAT_KERNEL_MOMENT_RENDERER_IDENTITY/, 'the effective renderer identity cannot impersonate world covariance');
assert.match(core, /kernel_moment_covariance[\s\S]*BOUNDARY_SPLAT_KERNEL_MOMENT_AUTHORITY/, 'the effective footprint authority names the representational ceiling');
assert.match(core, /normalized === 'kernel_moment_covariance'[\s\S]*BOUNDARY_SPLAT_ATTRIBUTE_MODEL_IDENTITY/, 'kernel moments reuse the same learned appearance attributes');
assert.match(core, /boundarySplatAreaOpacityConserved[\s\S]*kernel_moment_covariance/, 'kernel moments cannot gain energy by widening the footprint');

const compactor = core.match(/fn compactBoundarySplats[\s\S]*?(?=\n@compute @workgroup_size\(1\)\nfn finalizeBoundarySplats)/)?.[0] || '';
assert.match(compactor, /structuralSignal < 0\.11[\s\S]*atomicAdd\(&boundarySplatDraw\.candidateCount/, 'candidate support remains the structural compactor gate');
assert.match(compactor, /let flowFrame = boundarySplatFlowFrame\(world\)/, 'the treatment consumes the producer-owned tangent frame');
assert.match(compactor, /kernelMomentVariance\s*=\s*0\.5 \* reconstructionStrength \* flowFrame\.tangentRadius\.w \* flowFrame\.tangentRadius\.w/, 'the major-axis increment is the producer second moment');
assert.match(compactor, /kernelMajorRadius\s*=\s*sqrt\(baseMajorRadius \* baseMajorRadius \+ kernelMomentVariance\)/, 'covariance composes additively with the base footprint');
assert.match(compactor, /kernelMinorRadius\s*=\s*baseMinorRadius/, 'the rank-one producer moment does not invent transverse covariance');
assert.match(compactor, /effectiveAxisAreaScale[\s\S]*effectiveOpacity/, 'opacity conservation uses the widened effective area');
assert.match(compactor, /positionSupport = vec4<f32>\(world, structuralSignal\)/, 'zero first moment leaves candidate center and support identity fixed');
assert.match(compactor, /shape = vec4<f32>\(effectiveMajorRadius, effectiveMinorRadius, sidecar\.z, fireSignal\)/, 'only declared footprint geometry changes in the fixed candidate row');

const vertex = core.match(/fn boundarySplatVs[\s\S]*?(?=\n@fragment)/)?.[0] || '';
assert.match(vertex, /kernelMomentCovariance = boundarySplatCamera\.cameraRight\.w > 1\.5/, 'kernel moments have a distinct effective mode flag');
assert.match(vertex, /kernelTangent = normalize\(flowKernelDescriptorRowsForRender\[instanceIndex\]\.tangentCoherence\.xyz\)/, 'orientation is reused across cameras from the producer descriptor row');
assert.match(vertex, /kernelBitangent = normalize\(cross\(normal, kernelTangent\)\)/, 'the second raster axis stays in the structural tangent plane');
assert.match(core, /binding:\s*9[\s\S]*GPUShaderStage\.VERTEX[\s\S]*read-only-storage/, 'the render route binds the descriptor as read-only vertex input');

assert.match(core, /flowKernelCandidateAdmissionAuthority:\s*'structural-splat-candidates-v0'/, 'receipts name the post-compactor coverage boundary');
assert.doesNotMatch(core, /flowKernelCandidateAdmissionAuthority:\s*'native-cell-unfiltered'/, 'receipts must not claim arbitrary native-cell coverage');
const sampleFrame = core.match(/async function sampleFrame[\s\S]*?(?=\n  function compactRenderScaleSample)/)?.[0] || '';
assert.match(sampleFrame, /flowKernelIdentity:\s*state\.flowKernelIdentity/, 'frozen image receipts preserve the effective kernel mechanism');
assert.match(sampleFrame, /flowKernelEffective:\s*state\.flowKernelEffective/, 'frozen image receipts preserve effective kernel controls');
assert.match(sampleFrame, /flowKernelCandidateAdmissionAuthority:\s*state\.flowKernelCandidateAdmissionAuthority/, 'frozen image receipts preserve the candidate coverage ceiling');
assert.match(orbitWitness, /kernelMomentCovariance/, 'the orbit witness captures the flow-kernel moment family');
assert.match(orbitWitness, /flow-kernel-moment-covariance/, 'the holdout report names the kernel treatment as a distinct family');
assert.match(orbitWitness, /requireKernelMoment:\s*true/, 'new orbit reports fail if the kernel family is absent');
assert.match(orbitWitness, /footprint-family-preflight-v0/, 'the witness warms every footprint family before admitting cross-camera attribute hashes');
assert.match(
  orbitWitness,
  /\['analyticSplat', 'analyticBillboard', 'learnedBillboard', 'worldCovariance'\]\.includes\(request\.mode\)[\s\S]*setControls\(\{ flowKernelStrength: 0 \}\)/,
  'every non-kernel splat family must explicitly clear the kernel reconstruction strength',
);
assert.match(holdoutOracle, /base-footprint-plus-flow-kernel-second-moment-tangent-covariance-v0/, 'the oracle pins the treatment authority');
assert.match(holdoutOracle, /structural-splat-candidates-v0/, 'the oracle preserves the producer coverage ceiling');
assert.match(
  holdoutOracle,
  /REPLAY_CONTROLS_SHA256\s*=\s*'ba122038332747804203b4d03c6a5e9bf7b1e5969ec5d1f5ef995d3b5adff5b9'/,
  'the replay contract pins the post-kernel-control-schema step-96 state identity',
);

console.log('boundary splat kernel moment contracts passed');
