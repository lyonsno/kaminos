import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { balancedWgslBlock } from './helpers/wgsl-guard-ownership.mjs';

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
assert.match(core, /var<storage, read> frontSrc: array<f32>/);
const frontReads = [...RAYMARCH_NEIGHBORHOOD_WGSL.matchAll(/let frontTopology(\d) = ([^;]+);/g)];
assert.equal(frontReads.length, 8);
for (const [, corner, expression] of frontReads) {
  assert.equal(expression, `frontSrc[idx${corner}]`);
}

// Execute only the scalar expressions from the real WGSL, not a duplicate support formula.
const supportBlock = balancedWgslBlock(core, 'fn directCellOpticalSupportFromSlots(');
const supportBody = supportBlock.slice(supportBlock.indexOf('{') + 1, -1);
const support = new Function('velocityDensity', 'material', 'fireLayer', 'microLayer',
  'combustionFrontTopology', 'length', 'max', 'clamp', supportBody);
const zero = { x: 0, y: 0, z: 0, w: 0, xyz: [0, 0, 0] };
const frontSupport = front => support(zero, zero, zero, zero, front,
  v => Math.hypot(...v), Math.max, (x, lo, hi) => Math.min(hi, Math.max(lo, x)));
assert.ok(Math.abs(frontSupport(1) - 0.274) < 1e-12);
assert.ok(frontSupport(1) > 0.0001);
assert.ok(frontSupport(1 / 65536) < 0.0001, 'the old decode wrongly skipped front-only cells');

const fullFront = balancedWgslBlock(core, 'fn sampleFrontField(');
const fullInterpolate = new Function('c000', 'c100', 'c010', 'c110', 'c001', 'c101',
  'c011', 'c111', 'f', 'mix', fullFront.slice(fullFront.indexOf('  let x00'), -1));
const leanExpression = RAYMARCH_NEIGHBORHOOD_WGSL.match(/result.sample.frontTopology = ([\s\S]*?);/)[1];
const leanInterpolate = new Function(...frontReads.map(([, corner]) => `frontTopology${corner}`),
  'f', 'mix', `return ${leanExpression};`);
const mix = (a, b, t) => a * (1 - t) + b * t;
for (const corners of [Array(8).fill(1), [0, 0.1, 0.3, 0.7, 1, 1.2, 1.5, 2]]) {
  for (const f of [{x: 0, y: 0, z: 0}, {x: 1, y: 1, z: 1}, {x: 0.2, y: 0.7, z: 0.4}]) {
    assert.equal(leanInterpolate(...corners, f, mix), fullInterpolate(...corners, f, mix));
  }
}
assert.equal(leanInterpolate(...Array(8).fill(1), {x: 0.2, y: 0.7, z: 0.4}, mix), 1);
assert.match(RAYMARCH_NEIGHBORHOOD_WGSL, /max\(max\(support0, support1\), max\(support2, support3\)\)/);
assert.match(core, /reconstructed = reconstructRaymarchNeighborhood\(neighborhood\);/);
assert.match(core, /LEAN_EMISSIVE_RAYMARCH: selectEmissive/);
assert.match(core, /const key=`\$\{multisampled\}:\$\{targetPipeline===readbackPipeline\}:\$\{gridSize\}:\$\{gridHeight\}:\$\{selectEmissive\}:\$\{selectCached\}`/);
console.log('lean emissive admission and shared sampling contracts passed');
