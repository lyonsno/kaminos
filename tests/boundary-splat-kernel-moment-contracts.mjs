#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

assert.match(core, /BOUNDARY_SPLAT_KERNEL_MOMENT_RENDERER_IDENTITY\s*=\s*'live-boundary-sidecar-flow-kernel-moment-covariance-splats-v0'/);
assert.match(core, /BOUNDARY_SPLAT_KERNEL_MOMENT_AUTHORITY\s*=\s*'base-footprint-plus-flow-kernel-second-moment-tangent-covariance-v0'/);
assert.match(core, /normalizeBoundarySplatMode[\s\S]*'kernel_moment_covariance'/, 'the analytical treatment is explicitly requestable');
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

console.log('boundary splat kernel moment contracts passed');
