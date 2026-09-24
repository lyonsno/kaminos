import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const webgpuCorePath = join(root, 'finger-fluid-webgpu-core.js');
const benchCorePath = join(root, 'finger-fluid-bench-core.js');
const witnessPath = join(root, 'finger-fluid-bench-witness.mjs');
const webgpuCoreSource = readFileSync(webgpuCorePath, 'utf8');
const benchCoreSource = readFileSync(benchCorePath, 'utf8');
const witnessSource = readFileSync(witnessPath, 'utf8');

assert.match(
  webgpuCoreSource,
  /KAMINOS_FINGER_FLUID_REFRACTION_RENDERER_ROUTE\s*=\s*'webgpu-screen-space-liquid-refraction-v0'/,
  'the reviewed refraction route is present on the composed solver branch',
);
assert.match(
  webgpuCoreSource,
  /KAMINOS_FINGER_FLUID_OPTICAL_TRANSPORT_ROUTE\s*=\s*'snell-two-interface-screen-space-slab-v0'/,
  'the reviewed two-interface optical slab is present on the composed solver branch',
);
assert.match(
  webgpuCoreSource,
  /KAMINOS_FINGER_FLUID_RENDERER_MODES\s*=\s*Object\.freeze\(\[[^\]]*'screen_space_refraction'[^\]]*'sphere_debug'[^\]]*\]\)/,
  'optical composition retains both the refraction route and independent particle truth',
);
assert.match(
  webgpuCoreSource,
  /KAMINOS_FINGER_FLUID_INTERFACE_GEOMETRY_CONTRACT\s*=\s*'wgsl-solver-owned-interface-normal-curvature-confidence-v1'/,
  'solver-owned interface geometry has a versioned authority contract',
);
assert.match(
  webgpuCoreSource,
  /fn estimate_interface_curvature\(index: u32, position: vec3<f32>, interfaceNormal: vec3<f32>\) -> vec2<f32>/,
  'curvature and its resolution confidence are estimated together in solver world space with adaptive-volume particle identity',
);
assert.match(
  webgpuCoreSource,
  /let tangentOffset = offset - interfaceNormal \* dot\(offset, interfaceNormal\)/,
  'curvature separates tangent span from normal displacement',
);
assert.match(
  webgpuCoreSource,
  /normalCurvature = vec4<f32>\(interfaceNormal, interfaceCurvature\)/,
  'the interface carrier publishes measured curvature rather than anisotropy under a curvature label',
);
assert.match(
  webgpuCoreSource,
  /velocityConfidence = vec4<f32>\(particle\.velocity\.xyz, geometryConfidence\)/,
  'interface confidence describes the published normal and curvature geometry, not only free-surface classification',
);
assert.doesNotMatch(
  webgpuCoreSource,
  /normalCurvature = vec4<f32>\(interfaceNormal, anisotropy\)/,
  'anisotropy cannot masquerade as solver-owned curvature',
);
assert.match(
  webgpuCoreSource,
  /interfaceGeometryContract:\s*KAMINOS_FINGER_FLUID_INTERFACE_GEOMETRY_CONTRACT/,
  'runtime evidence exposes the effective interface geometry authority',
);
assert.match(
  benchCoreSource,
  /interfaceGeometryContract:\s*options\.interfaceGeometryContract/,
  'bench state carries the effective solver interface geometry contract',
);
assert.match(
  witnessSource,
  /interfaceGeometryContract[^\n]*KAMINOS_FINGER_FLUID_INTERFACE_GEOMETRY_CONTRACT|wgsl-solver-owned-interface-normal-curvature-confidence-v1/,
  'browser evidence rejects a missing or stale interface geometry contract',
);
assert.doesNotMatch(
  webgpuCoreSource,
  /webgpu-deferred-world-space-reflection-v0/,
  'the operator-falsified deferred reflection experiment is excluded from this composition slice',
);

const webgpuCore = await import(webgpuCorePath);
const planeNeighbors = Array.from({ length: 8 }, (_, index) => {
  const angle = index * Math.PI / 4;
  return { position: [Math.cos(angle) * 0.1, 0, Math.sin(angle) * 0.1], confidence: 1 };
});
const planeGeometry = webgpuCore.estimateFingerFluidInterfaceGeometry([0, 0, 0], planeNeighbors, {
  kernelRadius: 0.25,
  fallbackNormal: [0, 1, 0],
});
assert.equal(planeGeometry.contract, 'wgsl-solver-owned-interface-normal-curvature-confidence-v1');
assert.ok(Math.abs(planeGeometry.curvature) < 1e-10, `planar interface curvature should be zero, received ${planeGeometry.curvature}`);
assert.ok(planeGeometry.normal[1] > 0.999, `planar interface normal should preserve the supplied outward orientation: ${planeGeometry.normal}`);

const polarAngle = 0.12;
const sphereNeighbors = Array.from({ length: 12 }, (_, index) => {
  const azimuth = index * Math.PI / 6;
  return {
    position: [
      Math.sin(polarAngle) * Math.cos(azimuth),
      Math.cos(polarAngle),
      Math.sin(polarAngle) * Math.sin(azimuth),
    ],
    confidence: 1,
  };
});
const sphereGeometry = webgpuCore.estimateFingerFluidInterfaceGeometry([0, 1, 0], sphereNeighbors, {
  kernelRadius: 0.25,
  fallbackNormal: [0, 1, 0],
});
assert.ok(sphereGeometry.normal[1] > 0.999, `convex sphere patch normal should point outward: ${sphereGeometry.normal}`);
assert.ok(Math.abs(sphereGeometry.curvature - 1) < 0.01, `unit sphere patch should estimate curvature 1, received ${sphereGeometry.curvature}`);
assert.equal(sphereGeometry.neighborCount, sphereNeighbors.length);
assert.ok(sphereGeometry.confidence > 0.99, `resolved sphere patch should publish high geometry confidence, received ${sphereGeometry.confidence}`);

const degenerateGeometry = webgpuCore.estimateFingerFluidInterfaceGeometry([0, 0, 0], [
  { position: [0, -0.04, 0], confidence: 1 },
  { position: [0, -0.08, 0], confidence: 1 },
  { position: [0, -0.12, 0], confidence: 1 },
  { position: [0, -0.16, 0], confidence: 1 },
], {
  kernelRadius: 0.25,
  fallbackNormal: [0, 1, 0],
});
assert.equal(degenerateGeometry.curvature, 0, 'a collinear neighborhood cannot publish a resolved curvature');
assert.equal(degenerateGeometry.confidence, 0, 'a collinear neighborhood must fail closed rather than looking geometrically authoritative');
assert.equal(degenerateGeometry.resolved, false);

console.log('finger fluid optics composition contracts passed');
