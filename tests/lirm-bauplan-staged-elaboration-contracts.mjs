import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildLirmBauplanStagedElaborationPlan,
} from '../lirm-bauplan-staged-elaboration-core.mjs';
import {
  createLirmSpeciationArmatureImplicitBodyBundle,
} from '../lirm-speciation-armature-core.js';
import {
  LIRM_BAUPLAN_STAGED_ELABORATION_CONTROL_RECEIPT,
  resolveComparatorMapSources,
} from '../artifacts/lirm-bauplan-staged-elaboration-assay-v0/assay-contract.mjs';

assert.equal(
  LIRM_BAUPLAN_STAGED_ELABORATION_CONTROL_RECEIPT,
  'control-generation-receipt.json',
);
assert.notEqual(LIRM_BAUPLAN_STAGED_ELABORATION_CONTROL_RECEIPT, 'receipt.json');

const plan = buildLirmBauplanStagedElaborationPlan();
assert.equal(plan.schema, 'kaminos.lirm-bauplan-staged-elaboration-plan.v0');
assert.equal(plan.sourceCandidateId, 'lirm-armature-03');
assert.equal(plan.sourceSeed, 'molten-lirm-seed-0707');
assert.equal(plan.stages.length, 3);

const massAuthorityAssaySource = await readFile(
  new URL('../artifacts/lirm-bauplan-mass-authority-assay-v0/assay-result.json', import.meta.url),
  'utf8',
);
const massAuthorityAssay = JSON.parse(massAuthorityAssaySource);
assert.equal(massAuthorityAssay.visualInspection.operatorExposure, 'prohibited');
assert.equal(massAuthorityAssay.visualInspection.researchVisibility, 'agent_only');
assert.equal(
  Object.hasOwn(massAuthorityAssay.visualInspection, 'operatorExposureClass'),
  false,
);
assert.equal(massAuthorityAssaySource.includes('happy_safe'), false);
assert.equal(massAuthorityAssay.visualInspection.safe.disposition, 'failed');
assert.equal(massAuthorityAssay.visualInspection.happy.disposition, 'failed');
assert.equal(massAuthorityAssay.visualInspection.motionSafe.disposition, 'unassayed');
assert.deepEqual(
  massAuthorityAssay.visualInspection.safe.failureClasses,
  [
    'clustered_cavities',
    'porous_surface_defects',
    'ambiguous_hollow_anatomy',
  ],
);

assert.equal(
  plan.massAuthority?.schema,
  'kaminos.lirm-bauplan-mass-authority.v0',
  'bauplan plan must expose a deterministic low-frequency mass-authority sibling',
);
assert.equal(plan.massAuthority.parentStageId, 'bauplan-plus-dorsal-plates');
assert.equal(plan.massAuthority.variant.id, 'bauplan-heavy-plus-dorsal-plates');

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

const heavy = plan.massAuthority.variant;
const heavyBody = heavy.candidate.bodyPlan;
const parentBody = armored.candidate.bodyPlan;
assert.ok(heavyBody.silhouette.bellyScale > parentBody.silhouette.bellyScale);
assert.ok(heavyBody.silhouette.widthScale > parentBody.silhouette.widthScale);
assert.ok(heavyBody.silhouette.heightScale > parentBody.silhouette.heightScale);
assert.ok(heavyBody.bulkScale > parentBody.bulkScale);
assert.ok(heavyBody.massDistribution.bellyDrop > parentBody.massDistribution.bellyDrop);
assert.ok(heavyBody.contactWidth > parentBody.contactWidth);
const heavyGestaltHandle = heavy.candidate.semanticHandles.find(
  handle => handle.kind === 'gestalt_silhouette',
);
assert.deepEqual(
  {
    bellyScale: heavyGestaltHandle?.region.bellyScale,
    widthScale: heavyGestaltHandle?.region.widthScale,
    heightScale: heavyGestaltHandle?.region.heightScale,
  },
  {
    bellyScale: heavyBody.silhouette.bellyScale,
    widthScale: heavyBody.silhouette.widthScale,
    heightScale: heavyBody.silhouette.heightScale,
  },
  'heavy bauplan semantic silhouette handle must carry the authored dimensions',
);
assert.deepEqual(heavyBody.axisSamples, parentBody.axisSamples);
assert.equal(heavyBody.axialCurve, parentBody.axialCurve);
assert.equal(heavyBody.limbPairCount, parentBody.limbPairCount);
assert.equal(heavyBody.shellPlateCount, parentBody.shellPlateCount);
assert.deepEqual(heavy.developmentalModules, armored.developmentalModules);
assert.deepEqual(
  heavy.candidate.contactPoints.map(({ id, t, role }) => ({ id, t, role })),
  armored.candidate.contactPoints.map(({ id, t, role }) => ({ id, t, role })),
);
assert.deepEqual(
  plan.massAuthority.preserved,
  [
    'axialCurve',
    'axisSamples',
    'head-and-mouth-polarity',
    'limb-topology',
    'shell-modules',
    'contact-identities',
    'motion-affordance-class',
  ],
);

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
const heavyBundle = createLirmSpeciationArmatureImplicitBodyBundle({
  witness: plan.sourceWitness,
  candidate: heavy.candidate,
});
assert.equal(heavyBundle.candidateId, heavy.id);
assert.deepEqual(heavyBundle.silhouette, heavyBody.silhouette);
assert.deepEqual(
  heavyBundle.renderMaps.map(map => map.kind),
  ['clay', 'depth', 'normal', 'mask', 'semantic'],
);
assert.equal(
  heavyBundle.semanticHandles.some(handle => handle.kind === 'low_frequency_mass'),
  true,
);

const repeat = buildLirmBauplanStagedElaborationPlan();
assert.deepEqual(
  repeat.stages.map(stage => stage.candidate),
  plan.stages.map(stage => stage.candidate),
);

const comparatorFixtureRoot = await mkdtemp(join(tmpdir(), 'lirm-bauplan-comparator-'));
try {
  const localRoot = join(comparatorFixtureRoot, 'local');
  const missingLegacyRoot = join(comparatorFixtureRoot, 'missing-legacy');
  await mkdir(localRoot, { recursive: true });
  for (const kind of ['clay', 'depth', 'normal']) {
    await writeFile(join(localRoot, `${kind}.png`), `committed-${kind}`);
  }
  const resolved = await resolveComparatorMapSources({
    localRoot,
    legacyRoot: missingLegacyRoot,
  });
  assert.deepEqual(Object.keys(resolved), ['clay', 'depth', 'normal']);
  for (const [kind, map] of Object.entries(resolved)) {
    assert.equal(map.imported, false);
    assert.equal(await readFile(map.path, 'utf8'), `committed-${kind}`);
  }
} finally {
  await rm(comparatorFixtureRoot, { recursive: true, force: true });
}

console.log('LIRM bauplan staged elaboration contracts passed');
