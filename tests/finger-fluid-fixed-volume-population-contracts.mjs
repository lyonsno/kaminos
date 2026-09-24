import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createFingerFluidTruthScenePopulation,
  measureFingerFluidRepresentedVolume,
} from '../finger-fluid-webgpu-core.js';

const coarse = createFingerFluidTruthScenePopulation(24_576, 'multi_regime_playground', {
  referenceParticleCount: 36_864,
});
const fine = createFingerFluidTruthScenePopulation(36_864, 'multi_regime_playground', {
  referenceParticleCount: 36_864,
});

assert.equal(coarse.particleCount, 24_576);
assert.equal(fine.particleCount, 36_864);
assert.equal(coarse.referenceParticleCount, 36_864);
assert.equal(fine.referenceParticleCount, 36_864);
assert.equal(coarse.particleVolumeScale, 1.5);
assert.equal(fine.particleVolumeScale, 1);
assert.equal(
  measureFingerFluidRepresentedVolume(coarse.particleCount, coarse.particleVolumeScale),
  measureFingerFluidRepresentedVolume(fine.particleCount, fine.particleVolumeScale),
  'both populations represent the same liquid volume',
);

const bounds = population => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < population.particleCount; index += 1) {
    const offset = index * 12;
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], population.particleData[offset + axis]);
      max[axis] = Math.max(max[axis], population.particleData[offset + axis]);
    }
  }
  return { min, max };
};
const coarseBounds = bounds(coarse);
const fineBounds = bounds(fine);
for (let axis = 0; axis < 3; axis += 1) {
  assert.ok(Math.abs(coarseBounds.min[axis] - fineBounds.min[axis]) <= 0.0551);
  assert.ok(Math.abs(coarseBounds.max[axis] - fineBounds.max[axis]) <= 0.0551);
}

assert.throws(
  () => createFingerFluidTruthScenePopulation(36_865, 'multi_regime_playground', {
    referenceParticleCount: 36_864,
  }),
  /reference population.*at least.*particle count/i,
  'a comparison cannot silently use a reference population smaller than its requested count',
);

const root = new URL('..', import.meta.url).pathname;
const indexSource = readFileSync(join(root, 'index.html'), 'utf8');
const solverSource = readFileSync(join(root, 'finger-fluid-webgpu-core.js'), 'utf8');
assert.match(indexSource, /finger_fluid_fixed_volume_reference_count/,
  'the live bench route exposes the fixed-volume comparison reference');
assert.match(indexSource,
  /fixedVolumeReferenceParticleCount: fingerFluidBenchConfig\.requestedFixedVolumeReferenceParticleCount/,
  'the live bench forwards the requested fixed-volume reference into the solver');
assert.match(solverSource,
  /initialTopologyFloats\[refinementOffset\] = index < safeBaseParticleCount[\s\S]*population\?\.particleVolumeScale/,
  'the solver assigns represented particle volume before its first density projection');
assert.match(solverSource,
  /fn analytic_boundary_density_support\(position: vec3<f32>, radiusScale: f32\)[\s\S]*let kernelRadius = params\.fluid\.x \* radiusScale/,
  'analytic boundaries scale with the represented particle kernel radius');

console.log('finger fluid fixed-volume population contracts passed');
