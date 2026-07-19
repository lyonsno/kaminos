import assert from 'node:assert/strict';

import {
  REFERENCE_FIT_CAMERAS,
  renderReferenceArmature,
} from '../lirm-reference-fitted-armature-core.mjs';
import {
  createLirmArmatureProgramImplicitBodyBundle,
} from '../lirm-speciation-armature-core.js';
import {
  BULBOUS_RADIAL_UPRIGHT_ARMATURE_PROGRAM,
  BULBOUS_RADIAL_UPRIGHT_PARAMETER_SPECS,
} from '../lirm-bulbous-radial-upright-armature-program.mjs';

assert.equal(
  BULBOUS_RADIAL_UPRIGHT_ARMATURE_PROGRAM.id,
  'kaminos.lirm-armature-program.bulbous-radial-upright.v0',
);
assert.equal(
  BULBOUS_RADIAL_UPRIGHT_ARMATURE_PROGRAM.parameterVocabulary,
  'kaminos.reference-fitted-armature.bulbous-radial-upright-26.v0',
);
assert.equal(BULBOUS_RADIAL_UPRIGHT_PARAMETER_SPECS.length, 26);
assert.equal(new Set(BULBOUS_RADIAL_UPRIGHT_PARAMETER_SPECS.map(spec => spec.id)).size, 26);

const parameters = Object.fromEntries(
  BULBOUS_RADIAL_UPRIGHT_PARAMETER_SPECS.map(spec => [spec.id, spec.initial]),
);
const primitives = BULBOUS_RADIAL_UPRIGHT_ARMATURE_PROGRAM.createPrimitives(parameters);
const byRole = role => primitives.filter(primitive => primitive.role === role);
const requiredRoles = [
  'posteriorBulbousMass',
  'bodyBridge',
  'anteriorChestMass',
  'anteriorUprightNeck',
  'anteriorHead',
  'radialContactLimb',
  'groundContact',
];
for (const role of requiredRoles) assert.ok(byRole(role).length > 0, `missing semantic role: ${role}`);
assert.ok(byRole('anteriorUprightNeck').length >= 3, 'anterior neck must be a multi-segment rising chain');
assert.ok(byRole('radialContactLimb').length >= 8, 'locomotion field must contain at least eight radial contacts');
assert.equal(byRole('radialContactLimb').length, byRole('groundContact').length);

const posterior = byRole('posteriorBulbousMass')[0];
const chest = byRole('anteriorChestMass')[0];
const head = byRole('anteriorHead')[0];
const bridge = byRole('bodyBridge')[0];
const neckBase = byRole('anteriorUprightNeck').reduce((lowest, primitive) => (
  primitive.center.y < lowest.center.y ? primitive : lowest
));
const ellipsoidVolumeProxy = primitive => primitive.radius.x * primitive.radius.y * primitive.radius.z;
assert.ok(
  ellipsoidVolumeProxy(posterior) > ellipsoidVolumeProxy(chest) * 1.15,
  'posterior bulb must remain the dominant mass',
);
assert.ok(
  ellipsoidVolumeProxy(chest) > ellipsoidVolumeProxy(head) * 1.5,
  'anterior chest must mediate the mass hierarchy between posterior bulb and terminal head',
);
assert.ok(head.center.y > posterior.center.y + 0.48, 'anterior head must be materially elevated');
assert.ok(head.center.z > posterior.center.z + 0.9, 'anterior head must be longitudinally distinct from posterior mass');
assert.ok(
  bridge.center.z - bridge.radius.z < posterior.center.z + posterior.radius.z
    && bridge.center.z + bridge.radius.z > neckBase.center.z - neckBase.radius.z,
  'body bridge must overlap the posterior and anterior structures instead of floating between them',
);

const contactStations = byRole('groundContact').map(primitive => primitive.center.z);
assert.ok(
  Math.max(...contactStations) - Math.min(...contactStations) > 0.9,
  'radial contacts must be distributed along the body axis rather than orbiting one central trunk',
);

const render = cameraIndex => renderReferenceArmature({
  parameters,
  armatureProgram: BULBOUS_RADIAL_UPRIGHT_ARMATURE_PROGRAM,
  camera: REFERENCE_FIT_CAMERAS[cameraIndex],
  width: 64,
  height: 56,
});
const front = render(0);
const threeQuarter = render(1);
const side = render(2);
for (const witness of [front, threeQuarter, side]) {
  assert.ok(witness.mask.some(Boolean), `${witness.cameraId} witness must be nonblank`);
  for (const role of requiredRoles) assert.ok(witness.semanticRoles.includes(role));
}

const occupiedBounds = witness => {
  const xs = []; const ys = [];
  for (let index = 0; index < witness.mask.length; index += 1) if (witness.mask[index]) {
    xs.push(index % witness.width);
    ys.push(Math.floor(index / witness.width));
  }
  return {
    width: Math.max(...xs) - Math.min(...xs) + 1,
    height: Math.max(...ys) - Math.min(...ys) + 1,
  };
};
const frontBounds = occupiedBounds(front);
const sideBounds = occupiedBounds(side);
assert.ok(sideBounds.width > sideBounds.height * 1.03, 'side silhouette must retain a horizontal body axis');
assert.ok(
  Math.abs(sideBounds.width / sideBounds.height - frontBounds.width / frontBounds.height) > 0.18,
  'front and side silhouettes must materially diverge instead of collapsing to a radial blob',
);

const conditioningBundle = createLirmArmatureProgramImplicitBodyBundle({
  armatureProgram: BULBOUS_RADIAL_UPRIGHT_ARMATURE_PROGRAM,
  parameters,
  candidateId: 'lirm-bulbous-radial-upright-default-v0',
  pixelWidth: 48,
  pixelHeight: 36,
});
assert.equal(conditioningBundle.schema, 'kaminos.lirm-armature-program-implicit-body-bundle.v0');
assert.equal(conditioningBundle.route, 'kaminos/lirm-armature-program/implicit-body-v0');
assert.equal(conditioningBundle.armatureProgram.id, BULBOUS_RADIAL_UPRIGHT_ARMATURE_PROGRAM.id);
assert.equal(conditioningBundle.armatureProgram.parameterVocabulary, BULBOUS_RADIAL_UPRIGHT_ARMATURE_PROGRAM.parameterVocabulary);
assert.deepEqual(Object.keys(conditioningBundle.parameters), BULBOUS_RADIAL_UPRIGHT_PARAMETER_SPECS.map(spec => spec.id));
assert.equal(conditioningBundle.implicitPrimitiveCount, primitives.length);
assert.deepEqual(conditioningBundle.semanticRoles, requiredRoles);
assert.deepEqual(conditioningBundle.renderMaps.map(map => map.kind), ['clay', 'depth', 'normal', 'mask', 'semantic']);
for (const map of conditioningBundle.renderMaps) {
  assert.match(map.svg, /data-render-mode="raymarched-implicit-field"/);
  assert.match(map.svg, /<rect x=/, `${map.kind} control must contain nonblank ray-hit evidence`);
}
assert.equal(conditioningBundle.trellisSource.kind, 'trellis-clay');
assert.match(conditioningBundle.trellisSource.svg, /data-trellis-source="implicit-clay-tight"/);

console.log('LIRM bulbous radial upright armature program contracts passed');
