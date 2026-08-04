#!/usr/bin/env node

import assert from 'node:assert/strict';

import {
  createMetaballSilhouetteAuthorityTranche,
  METABALL_SILHOUETTE_ARMATURE_PROGRAM,
} from '../lirm-metaball-silhouette-authority-core.mjs';
import {
  createLirmArmatureProgramImplicitBodyBundle,
} from '../lirm-speciation-armature-core.js';

const tranche = createMetaballSilhouetteAuthorityTranche();

assert.equal(tranche.schema, 'kaminos.lirm-metaball-silhouette-authority-tranche.v0');
assert.equal(tranche.baselineId, 'baseline');
assert.deepEqual(
  tranche.variants.map(variant => variant.id),
  [
    'baseline',
    'body-long',
    'body-deep',
    'dorsal-arched',
    'posterior-heavy',
    'supports-wide',
    'supports-long',
  ],
);

const baseline = tranche.variants[0];
const parameterIds = tranche.armatureProgram.parameterSpecs.map(spec => spec.id);
assert.deepEqual(Object.keys(baseline.parameters), parameterIds);

for (const variant of tranche.variants) {
  assert.deepEqual(Object.keys(variant.parameters), parameterIds);
  const primitives = tranche.armatureProgram.createPrimitives(variant.parameters);
  assert.ok(primitives.filter(primitive => primitive.role === 'bodyMass').length >= 5);
  assert.equal(primitives.filter(primitive => primitive.role === 'contactLimb').length, 4);
  assert.equal(primitives.filter(primitive => primitive.role === 'groundContact').length, 4);
  assert.equal(primitives.filter(primitive => primitive.role === 'headOrientation').length, 1);
}

for (const variant of tranche.variants.slice(1)) {
  const changed = parameterIds.filter(
    parameterId => variant.parameters[parameterId] !== baseline.parameters[parameterId],
  );
  assert.deepEqual(changed, [variant.axis.parameterId]);
  assert.equal(variant.axis.from, baseline.parameters[variant.axis.parameterId]);
  assert.equal(variant.axis.to, variant.parameters[variant.axis.parameterId]);
}

assert.deepEqual(tranche.fixedGenerator.seeds, [80401, 80402, 80403]);
assert.equal(tranche.fixedGenerator.model, 'flux2-klein-9b');
assert.equal(tranche.fixedGenerator.guidance, 1);
assert.match(tranche.fixedGenerator.prompt, /outer silhouette/);
assert.doesNotMatch(tranche.fixedGenerator.prompt, /horror|wound|hole|aperture/i);

const targetView = createLirmArmatureProgramImplicitBodyBundle({
  armatureProgram: METABALL_SILHOUETTE_ARMATURE_PROGRAM,
  parameters: baseline.parameters,
  candidateId: 'baseline-target',
  cameraYawRadians: 0.42,
});
const frontView = createLirmArmatureProgramImplicitBodyBundle({
  armatureProgram: METABALL_SILHOUETTE_ARMATURE_PROGRAM,
  parameters: baseline.parameters,
  candidateId: 'baseline-front',
  cameraYawRadians: 0,
});

assert.equal(targetView.effectiveConfig.cameraYawRadians, 0.42);
assert.equal(frontView.effectiveConfig.cameraYawRadians, 0);
assert.equal(targetView.projectionEvidence.cameraYawRadians, 0.42);
assert.equal(frontView.projectionEvidence.cameraYawRadians, 0);
assert.notEqual(
  targetView.renderMaps.find(map => map.kind === 'clay').svg,
  frontView.renderMaps.find(map => map.kind === 'clay').svg,
);

process.stdout.write('LIRM metaball silhouette authority contracts passed\n');
