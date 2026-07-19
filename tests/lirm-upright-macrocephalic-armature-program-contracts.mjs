import assert from 'node:assert/strict';

import {
  REFERENCE_FIT_CAMERAS,
  renderReferenceArmature,
} from '../lirm-reference-fitted-armature-core.mjs';
import {
  UPRIGHT_MACROCEPHALIC_ARMATURE_PROGRAM,
  UPRIGHT_MACROCEPHALIC_PARAMETER_SPECS,
} from '../lirm-upright-macrocephalic-armature-program.mjs';

assert.equal(UPRIGHT_MACROCEPHALIC_ARMATURE_PROGRAM.id, 'kaminos.lirm-armature-program.upright-macrocephalic.v0');
assert.equal(
  UPRIGHT_MACROCEPHALIC_ARMATURE_PROGRAM.parameterVocabulary,
  'kaminos.reference-fitted-armature.upright-macrocephalic-14.v0',
);
assert.equal(UPRIGHT_MACROCEPHALIC_PARAMETER_SPECS.length, 14);
assert.equal(new Set(UPRIGHT_MACROCEPHALIC_PARAMETER_SPECS.map(spec => spec.id)).size, 14);

const parameters = Object.fromEntries(UPRIGHT_MACROCEPHALIC_PARAMETER_SPECS.map(spec => [spec.id, spec.initial]));
const primitives = UPRIGHT_MACROCEPHALIC_ARMATURE_PROGRAM.createPrimitives(parameters);
const roles = new Set(primitives.map(primitive => primitive.role));
assert.ok(roles.has('uprightTrunk'));
assert.ok(roles.has('waistCompression'));
assert.ok(roles.has('macrocephalicCrown'));
assert.ok(roles.has('radialContactLimb'));
assert.ok(roles.has('groundContact'));
assert.ok(primitives.filter(primitive => primitive.role === 'radialContactLimb').length >= 6);

const front = renderReferenceArmature({
  parameters,
  armatureProgram: UPRIGHT_MACROCEPHALIC_ARMATURE_PROGRAM,
  camera: REFERENCE_FIT_CAMERAS[0],
  width: 40,
  height: 32,
});
const side = renderReferenceArmature({
  parameters,
  armatureProgram: UPRIGHT_MACROCEPHALIC_ARMATURE_PROGRAM,
  camera: REFERENCE_FIT_CAMERAS[2],
  width: 40,
  height: 32,
});
assert.ok(front.mask.some(Boolean));
assert.ok(side.mask.some(Boolean));
assert.ok(front.semanticRoles.includes('macrocephalicCrown'));
assert.ok(front.semanticRoles.includes('radialContactLimb'));

const occupiedBounds = render => {
  const xs = []; const ys = [];
  for (let index = 0; index < render.mask.length; index += 1) if (render.mask[index]) {
    xs.push(index % render.width);
    ys.push(Math.floor(index / render.width));
  }
  return {
    width: Math.max(...xs) - Math.min(...xs) + 1,
    height: Math.max(...ys) - Math.min(...ys) + 1,
  };
};
const frontBounds = occupiedBounds(front);
const sideBounds = occupiedBounds(side);
assert.ok(frontBounds.height > frontBounds.width * 0.82, 'front view must retain an upright gestalt');
assert.ok(sideBounds.height > sideBounds.width * 0.82, 'side view must retain an upright gestalt');

console.log('LIRM upright macrocephalic armature program contracts passed');
