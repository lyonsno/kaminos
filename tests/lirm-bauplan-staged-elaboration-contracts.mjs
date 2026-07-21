import assert from 'node:assert/strict';

import {
  buildLirmBauplanStagedElaborationPlan,
} from '../lirm-bauplan-staged-elaboration-core.mjs';
import {
  createLirmSpeciationArmatureImplicitBodyBundle,
} from '../lirm-speciation-armature-core.js';

const plan = buildLirmBauplanStagedElaborationPlan();
assert.equal(plan.schema, 'kaminos.lirm-bauplan-staged-elaboration-plan.v0');
assert.equal(plan.sourceCandidateId, 'lirm-armature-03');
assert.equal(plan.sourceSeed, 'molten-lirm-seed-0707');
assert.equal(plan.stages.length, 3);

const [bauplan, armored, tactile] = plan.stages;
assert.deepEqual(
  plan.stages.map(stage => stage.lineageId),
  Array(3).fill('lirm-armature-03-bauplan'),
);
assert.deepEqual(
  plan.stages.map(stage => stage.parentId),
  [null, bauplan.id, armored.id],
);
assert.deepEqual(
  plan.stages.map(stage => stage.generation),
  [0, 1, 2],
);

const axisContract = stage => ({
  axialCurve: stage.candidate.bodyPlan.axialCurve,
  axisSamples: stage.candidate.bodyPlan.axisSamples,
  head: stage.candidate.semanticHandles.find(handle => handle.kind === 'head')?.region,
  mouth: stage.candidate.semanticHandles.find(handle => handle.kind === 'mouth')?.region,
  contacts: stage.candidate.contactPoints,
});
assert.deepEqual(axisContract(armored), axisContract(bauplan));
assert.deepEqual(axisContract(tactile), axisContract(bauplan));

const handleCount = (stage, kind) => stage.candidate.semanticHandles.filter(handle => handle.kind === kind).length;
assert.equal(handleCount(bauplan, 'shell_plate'), 0);
assert.equal(handleCount(armored, 'shell_plate'), 7);
assert.equal(handleCount(tactile, 'shell_plate'), 7);
assert.equal(handleCount(tactile, 'limb_bud') - handleCount(armored, 'limb_bud'), 2);
assert.deepEqual(armored.developmentalModules, ['dorsal-plate-series']);
assert.deepEqual(tactile.developmentalModules, ['dorsal-plate-series', 'paired-anterior-tactile-fork']);

const forbiddenKinds = new Set(['cavity', 'aperture', 'floating_organ', 'suspended_organ']);
for (const stage of plan.stages) {
  assert.equal(stage.candidate.semanticHandles.some(handle => forbiddenKinds.has(handle.kind)), false);
  assert.equal(stage.bauplanContract.enclosure, 'single-connected-body');
  assert.equal(stage.bauplanContract.polarity, 'terminal-head-and-mouth');
  assert.equal(stage.bauplanContract.contactTopology, 'seven-axial-supports');
}

const bundles = plan.stages.map(stage => createLirmSpeciationArmatureImplicitBodyBundle({
  witness: plan.sourceWitness,
  candidate: stage.candidate,
}));
assert.deepEqual(
  bundles.map(bundle => bundle.camera),
  Array(3).fill(bundles[0].camera),
);
assert.ok(bundles[1].implicitPrimitiveCount > bundles[0].implicitPrimitiveCount);
assert.equal(bundles[2].implicitPrimitiveCount, bundles[1].implicitPrimitiveCount + 2);
assert.deepEqual(
  bundles.map(bundle => bundle.renderMaps.map(map => map.kind)),
  Array(3).fill(['clay', 'depth', 'normal', 'mask', 'semantic']),
);

const repeat = buildLirmBauplanStagedElaborationPlan();
assert.deepEqual(
  repeat.stages.map(stage => stage.candidate),
  plan.stages.map(stage => stage.candidate),
);

console.log('LIRM bauplan staged elaboration contracts passed');
