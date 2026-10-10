import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
assert.match(core, /override LEAN_EMISSIVE_RAYMARCH: bool = false;/,
  'emissive rendering must have an independently selectable optimized pipeline');
const { leanEmissiveRaymarchAdmission, RAYMARCH_NEIGHBORHOOD_WGSL } = await import('../volume-raymarch-sampling.mjs');
const valid = { physicalColorMode: 2, presentationMode: 'beauty' };
assert.equal(leanEmissiveRaymarchAdmission(valid).eligible, true);
for (const mutation of [
  { physicalColorMode: 0 }, { physicalColorMode: 1 }, { physicalColorMode: NaN },
  { presentationMode: 'density' }, { appearanceDecompositionActive: true },
  { supervisionFireOnlyTarget: true }, { nonRidgeOpticalCaptureActive: true },
  { nonRidgeSourceBasisCaptureActive: true }, { liveCompleteFlameOpticalCoefficientsEnabled: true },
]) {
  const result = leanEmissiveRaymarchAdmission({ ...valid, ...mutation });
  assert.equal(result.eligible, false, JSON.stringify(mutation));
  assert.ok(result.refusalReasons.length > 0);
}
assert.equal(leanEmissiveRaymarchAdmission().eligible, false);
assert.doesNotMatch(RAYMARCH_NEIGHBORHOOD_WGSL, /array<FlowReconstructionSample/,
  'camera loop does not carry or copy an eight-sample aggregate');
assert.match(RAYMARCH_NEIGHBORHOOD_WGSL, /let velocityDensity7 = fluidSrc\[idx7 \* SLOTS_PER_CELL\]/,
  'the fixed eight-corner footprint has compile-time load indices');
assert.match(RAYMARCH_NEIGHBORHOOD_WGSL, /let frontTopology7 = frontSrc\[idx7\];/,
  'combustion front is float storage, unlike the separate quantized quench field');
assert.match(RAYMARCH_NEIGHBORHOOD_WGSL, /max\(max\(support0, support1\), max\(support2, support3\)\)/);
assert.match(core, /reconstructed = reconstructRaymarchNeighborhood\(neighborhood\);/);
assert.match(core, /LEAN_EMISSIVE_RAYMARCH: selectEmissive/);
assert.match(core, /const key=`\$\{multisampled\}:\$\{targetPipeline===readbackPipeline\}:\$\{gridSize\}:\$\{gridHeight\}:\$\{selectEmissive\}`/);
console.log('lean emissive admission and shared sampling contracts passed');
