import assert from 'node:assert/strict';

import {
  REFERENCE_FIT_CAMERAS,
  renderReferenceArmature,
} from '../lirm-reference-fitted-armature-core.mjs';
import {
  ANNULAR_TRIPOD_ARMATURE_PROGRAM,
  ANNULAR_TRIPOD_PARAMETER_SPECS,
  TRIPOD_CANOPY_ARMATURE_PROGRAM,
  TRIPOD_CANOPY_PARAMETER_SPECS,
} from '../lirm-rare-gestalt-armature-programs.mjs';

const initialParameters = specs => Object.fromEntries(specs.map(spec => [spec.id, spec.initial]));
const byRole = (primitives, role) => primitives.filter(primitive => primitive.role === role);
const render = (program, parameters, cameraIndex) => renderReferenceArmature({
  parameters,
  armatureProgram: program,
  camera: REFERENCE_FIT_CAMERAS[cameraIndex],
  width: 80,
  height: 72,
});
const maskAt = (witness, x, y) => witness.mask[y * witness.width + x];

assert.equal(ANNULAR_TRIPOD_ARMATURE_PROGRAM.id, 'kaminos.lirm-armature-program.annular-tripod.v0');
assert.equal(
  ANNULAR_TRIPOD_ARMATURE_PROGRAM.parameterVocabulary,
  `kaminos.rare-gestalt-armature.annular-tripod-${ANNULAR_TRIPOD_PARAMETER_SPECS.length}.v0`,
);
assert.ok(ANNULAR_TRIPOD_PARAMETER_SPECS.length >= 16);
assert.equal(new Set(ANNULAR_TRIPOD_PARAMETER_SPECS.map(spec => spec.id)).size, ANNULAR_TRIPOD_PARAMETER_SPECS.length);

const annularParameters = initialParameters(ANNULAR_TRIPOD_PARAMETER_SPECS);
const annularPrimitives = ANNULAR_TRIPOD_ARMATURE_PROGRAM.createPrimitives(annularParameters);
assert.ok(byRole(annularPrimitives, 'annularBody').length >= 12, 'annular body needs enough segments to carry a loop');
assert.equal(byRole(annularPrimitives, 'offAxisSensoryMass').length, 1);
assert.equal(byRole(annularPrimitives, 'tripodSupport').length, 3);
assert.equal(byRole(annularPrimitives, 'groundContact').length, 3);
const annularFront = render(ANNULAR_TRIPOD_ARMATURE_PROGRAM, annularParameters, 0);
assert.equal(maskAt(annularFront, 40, 30), 0, 'front witness must retain a large central aperture');
assert.equal(maskAt(annularFront, 40, 16), 1, 'annular body must occupy the aperture crown');

const widerAperture = {
  ...annularParameters,
  apertureWidth: Math.min(
    annularParameters.apertureWidth + 0.24,
    ANNULAR_TRIPOD_PARAMETER_SPECS.find(spec => spec.id === 'apertureWidth').max,
  ),
};
const initialRingXs = byRole(annularPrimitives, 'annularBody').flatMap(primitive => [primitive.a?.x, primitive.b?.x]).filter(Number.isFinite);
const widerRingXs = byRole(
  ANNULAR_TRIPOD_ARMATURE_PROGRAM.createPrimitives(widerAperture),
  'annularBody',
).flatMap(primitive => [primitive.a?.x, primitive.b?.x]).filter(Number.isFinite);
assert.ok(
  Math.max(...widerRingXs) - Math.min(...widerRingXs) > Math.max(...initialRingXs) - Math.min(...initialRingXs) + 0.18,
  'apertureWidth must directly widen the annular silhouette',
);

assert.equal(TRIPOD_CANOPY_ARMATURE_PROGRAM.id, 'kaminos.lirm-armature-program.tripod-canopy.v0');
assert.equal(
  TRIPOD_CANOPY_ARMATURE_PROGRAM.parameterVocabulary,
  `kaminos.rare-gestalt-armature.tripod-canopy-${TRIPOD_CANOPY_PARAMETER_SPECS.length}.v0`,
);
assert.ok(TRIPOD_CANOPY_PARAMETER_SPECS.length >= 17);
assert.equal(new Set(TRIPOD_CANOPY_PARAMETER_SPECS.map(spec => spec.id)).size, TRIPOD_CANOPY_PARAMETER_SPECS.length);

const canopyParameters = initialParameters(TRIPOD_CANOPY_PARAMETER_SPECS);
const canopyPrimitives = TRIPOD_CANOPY_ARMATURE_PROGRAM.createPrimitives(canopyParameters);
assert.ok(byRole(canopyPrimitives, 'dorsalCanopy').length >= 4);
assert.equal(byRole(canopyPrimitives, 'suspendedSensoryMass').length, 1);
assert.ok(byRole(canopyPrimitives, 'sensorySuspensor').length >= 2);
assert.equal(byRole(canopyPrimitives, 'tripodSupport').length, 3);
assert.equal(byRole(canopyPrimitives, 'groundContact').length, 3);
const canopyFront = render(TRIPOD_CANOPY_ARMATURE_PROGRAM, canopyParameters, 0);
const canopyRows = Array.from({ length: canopyFront.height }, (_, y) => (
  canopyFront.mask.slice(y * canopyFront.width, (y + 1) * canopyFront.width).filter(Boolean).length
));
const widestCanopyRow = canopyRows.indexOf(Math.max(...canopyRows));
assert.ok(widestCanopyRow < canopyFront.height * 0.5, 'tripod canopy must keep its widest mass above center');

const lowerPendant = {
  ...canopyParameters,
  pendantDrop: Math.min(
    canopyParameters.pendantDrop + 0.22,
    TRIPOD_CANOPY_PARAMETER_SPECS.find(spec => spec.id === 'pendantDrop').max,
  ),
};
const initialPendant = byRole(canopyPrimitives, 'suspendedSensoryMass')[0];
const lowerPendantPrimitive = byRole(
  TRIPOD_CANOPY_ARMATURE_PROGRAM.createPrimitives(lowerPendant),
  'suspendedSensoryMass',
)[0];
assert.ok(
  lowerPendantPrimitive.center.y < initialPendant.center.y - 0.18,
  'pendantDrop must remain a direct semantic vertical handle',
);

console.log('LIRM rare gestalt armature program contracts passed');
