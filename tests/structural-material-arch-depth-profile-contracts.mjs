import assert from 'node:assert/strict';
import { buildArchProfileFromGlb } from '../structural-material-arch-profile.mjs';

const glbPath = 'artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/trellis-intact/output.glb';
const profile = buildArchProfileFromGlb(glbPath, 48, 36, {
  min: [-0.5, -0.39],
  max: [0.5, 0.39],
});

assert.equal(profile.depthEnvelope?.length, profile.columns * profile.rows,
  'the GLB profile must retain per-cell surface depth instead of discarding Z');
assert.equal(profile.depthSource?.kind, 'triangle-barycentric-z-envelope-v0');
assert.ok(profile.meshTopology?.boundaryEdges > 0,
  'the report must distinguish observed mesh surface from an inferred filled interior');
assert.ok(profile.meshTopology?.edgeIncidenceClosed === false,
  'the TRELLIS source must not be represented as a closed solid');

const measured = profile.depthEnvelope.filter(Boolean);
assert.ok(measured.length > 700, 'depth coverage must span the arch surface, not a few sampled cells');
assert.ok(measured.every(({ minZ, maxZ }) => Number.isFinite(minZ) && Number.isFinite(maxZ) && maxZ >= minZ));
assert.ok(measured.some(({ minZ, maxZ }) => maxZ - minZ > 0.05),
  'the extracted envelope must preserve the mesh through-depth extent');
assert.ok(measured.some(({ minZ, maxZ }) => maxZ - minZ < 0.36),
  'the mesh-derived depth must not silently remain the uniform 0.36 extrusion');

console.log('structural arch depth profile contracts passed');
