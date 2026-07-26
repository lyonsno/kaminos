import assert from 'node:assert/strict';

import {
  buildLirmBauplanStagedElaborationPlan,
} from '../lirm-bauplan-staged-elaboration-core.mjs';
import {
  createLirmSpeciationArmatureImplicitBodyBundle,
} from '../lirm-speciation-armature-core.js';

const plan = buildLirmBauplanStagedElaborationPlan();
const candidates = [
  plan.stages.find(stage => stage.id === 'bauplan-only').candidate,
  plan.massAuthority.variant.candidate,
];

const legacyFactors = {
  limbEmission: 'centerline',
  contactGeometry: 'body-sdf',
  projection: 'legacy-yaw-0.42',
};
const repairedFactors = {
  limbEmission: 'bilateral-sidecar',
  contactGeometry: 'semantic-only',
  projection: 'pairing-legible-yaw-pi-over-4',
};

for (const candidate of candidates) {
  const declaredPairs = candidate.semanticHandles.filter(
    handle => handle.kind === 'limb_bud' && handle.region.side === 'paired',
  );
  const legacy = createLirmSpeciationArmatureImplicitBodyBundle({
    witness: plan.sourceWitness,
    candidate,
    controlFactors: legacyFactors,
  });
  const repaired = createLirmSpeciationArmatureImplicitBodyBundle({
    witness: plan.sourceWitness,
    candidate,
    controlFactors: repairedFactors,
  });

  assert.ok(
    legacy.controlFactors,
    'implicit bundle must report requested and effective support-legibility factors',
  );
  assert.ok(
    repaired.controlFactors,
    'repaired implicit bundle must report effective support-legibility factors',
  );
  assert.deepEqual(legacy.controlFactors.requested, legacyFactors);
  assert.deepEqual(repaired.controlFactors.requested, repairedFactors);
  assert.equal(legacy.controlFactors.effective.cameraYawRadians, 0.42);
  assert.equal(
    repaired.controlFactors.effective.cameraYawRadians,
    Math.PI / 4,
    'pairing-legible projection must be preregistered rather than selected after rendering',
  );

  const legacyLimbs = legacy.implicitPrimitiveInventory.filter(
    primitive => primitive.role === 'limb_bud',
  );
  const repairedLimbs = repaired.implicitPrimitiveInventory.filter(
    primitive => primitive.role === 'limb_bud',
  );
  assert.equal(
    legacyLimbs.length,
    declaredPairs.length,
    'legacy counterfactual must preserve one centerline capsule per declared pair',
  );
  assert.equal(
    repairedLimbs.length,
    0,
    'bilateral sidecar supports must contribute no repeated geometry to generator-facing body maps',
  );
  for (const handle of declaredPairs) {
    assert.deepEqual(
      repaired.supportSemanticInventory
        .filter(support => support.sourceHandleId === handle.id)
        .map(support => support.pairMember)
        .sort(),
      ['left', 'right'],
      `declared pair ${handle.id} must retain explicit left/right sidecar identities`,
    );
  }

  assert.equal(
    legacy.implicitPrimitiveInventory.filter(primitive => primitive.role === 'contact_point').length,
    candidate.contactPoints.length,
    'legacy counterfactual must preserve contact markers fused into the body SDF',
  );
  assert.equal(
    repaired.implicitPrimitiveInventory.some(primitive => primitive.role === 'contact_point'),
    false,
    'semantic-only contacts must never enter organismal body geometry',
  );
  assert.deepEqual(
    repaired.contactPoints,
    candidate.contactPoints,
    'contact semantics must survive body-geometry exclusion unchanged',
  );

  assert.equal(
    repaired.implicitPrimitiveCount,
    legacy.implicitPrimitiveCount - declaredPairs.length - candidate.contactPoints.length,
  );
  assert.equal(
    repaired.projectionEvidence.projectedContactMarkerOccupancy,
    0,
    'semantic-only contacts must contribute no visible organismal pixels',
  );
  assert.equal(
    repaired.projectionEvidence.projectedSupportGeometryOccupancy,
    0,
    'the repaired view must not project repeated support geometry into the organismal source',
  );
  assert.equal(
    repaired.supportSemanticInventory.length,
    declaredPairs.length * 2,
    'every declared support pair must survive as two explicit sidecar identities',
  );
  assert.deepEqual(
    repaired.controlFactors.sourceEquality,
    {
      bodyMass: 'unchanged',
      headAndMouth: 'unchanged',
      prompt: 'unchanged',
      route: 'unchanged',
      cropAndScale: 'unchanged',
    },
  );
}

console.log('LIRM projected support legibility contracts passed');
