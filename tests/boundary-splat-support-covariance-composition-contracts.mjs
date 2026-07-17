#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(
  core,
  /BOUNDARY_SPLAT_KERNEL_MOMENT_RENDERER_IDENTITY\s*=\s*'live-boundary-sidecar-flow-kernel-moment-covariance-splats-v0'/,
  'the combined route must expose a distinct effective covariance renderer identity',
);
assert.match(
  core,
  /BOUNDARY_SPLAT_KERNEL_MOMENT_AUTHORITY\s*=\s*'base-footprint-plus-flow-kernel-second-moment-tangent-covariance-v0'/,
  'the combined route must name the exact footprint authority rather than generic splat authority',
);
assert.match(
  page,
  /<option value="kernel_moment_covariance">kernel moment covariance<\/option>/,
  'the cockpit must request covariance explicitly without substituting another splat mode',
);
assert.match(
  page,
  /normalizeBoundarySplatMode[\s\S]*'kernel_moment_covariance'/,
  'URL and preset normalization must retain the covariance request',
);

const sidecarBake = core.match(/fn csBoundarySidecar[\s\S]*?(?=\n@compute @workgroup_size\(4, 4, 4\)\nfn csMajorant)/)?.[0] || '';
assert.match(
  sidecarBake,
  /supportWeights[\s\S]*boundarySupportAtCell[\s\S]*boundarySidecarCoverage[\s\S]*boundarySidecarRidge[\s\S]*boundarySidecarFootprintWidth/,
  'tuned heat, reaction, front, and interface support must remain upstream of baked sidecar structure',
);

const compactor = core.match(/fn compactBoundarySplats[\s\S]*?(?=\n@compute @workgroup_size\(1\)\nfn finalizeBoundarySplats)/)?.[0] || '';
assert.match(
  core,
  /fn boundarySplatKernelIntegral\(sharpness: f32\)[\s\S]*fn boundarySplatEnergyCompensation\(footprintRadius: f32, sharpness: f32\)/,
  'the composed WGSL must define both energy helpers before the compactor calls them',
);
assert.match(
  compactor,
  /admissionSidecar\s*=\s*boundarySidecar\[cellIndex\][\s\S]*structuralSignal[\s\S]*structuralSignal < 0\.11[\s\S]*atomicAdd\(&boundarySplatDraw\.candidateCount/,
  'the baked support sidecar must retain candidate admission authority',
);
assert.match(
  compactor,
  /let flowFrame = boundarySplatFlowFrame\(world\)[\s\S]*kernelMomentVariance[\s\S]*kernelMajorRadius[\s\S]*kernelMinorRadius/,
  'the admitted candidate must receive the producer cotangent second moment in the same compaction pass',
);
assert.match(
  compactor,
  /positionSupport = vec4<f32>\(world, structuralSignal\)[\s\S]*shape = vec4<f32>\(effectiveMajorRadius, effectiveMinorRadius, sidecar\.z, fireSignal\)/,
  'covariance may change footprint geometry but must not move or replace the support-selected candidate',
);

const vertex = core.match(/fn boundarySplatVs[\s\S]*?(?=\n@fragment)/)?.[0] || '';
assert.match(
  vertex,
  /kernelMomentCovariance[\s\S]*flowKernelDescriptorRowsForRender\[instanceIndex\]\.tangentCoherence\.xyz[\s\S]*cross\(normal, kernelTangent\)/,
  'the raster footprint must use the producer cotangent frame rather than a camera-facing isotropic billboard',
);

assert.match(
  core,
  /kernel_moment_covariance[\s\S]*BOUNDARY_SPLAT_KERNEL_MOMENT_RENDERER_IDENTITY[\s\S]*BOUNDARY_SPLAT_KERNEL_MOMENT_AUTHORITY/,
  'requested covariance must map to exact effective renderer and authority receipts',
);
assert.match(
  core,
  /flowKernelCandidateAdmissionAuthority:\s*'structural-splat-candidates-v0'/,
  'receipts must preserve the structural sidecar candidate ceiling',
);

const footprintAudit = core.match(/async function sampleBoundarySplatFootprintAudit[\s\S]*?(?=\n  async function readStorageBufferBytes)/)?.[0] || '';
assert.match(
  footprintAudit,
  /overflowCount[\s\S]*growBoundarySplatCapacity\(draw\.candidateCount\)[\s\S]*encodeBoundarySplats[\s\S]*boundary-splat-footprint-audit-partial-candidates/,
  'the combined witness must retry the full support-selected population and fail loud on partial evidence',
);
assert.match(
  core,
  /sampleFrame,\s*sampleBoundarySplatFootprintAudit,\s*sampleDeterministicReplayFrame/,
  'the full-population audit must be exposed on the live prototype instead of remaining unreachable',
);

console.log('boundary splat support and covariance composition contracts passed');
