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
import {
  ANNULAR_CANOPY_HYBRID_ARMATURE_PROGRAM,
  ANNULAR_CANOPY_HYBRID_PARAMETER_SPECS,
  CROSS_FAMILY_HYBRID_CANDIDATES,
} from '../lirm-cross-family-rare-gestalt-armature-program.mjs';

const initialParameters = specs => Object.fromEntries(specs.map(spec => [spec.id, spec.initial]));
const byRole = (primitives, role) => primitives.filter(primitive => primitive.role === role);
const render = (program, parameters, cameraIndex = 0) => renderReferenceArmature({
  parameters,
  armatureProgram: program,
  camera: REFERENCE_FIT_CAMERAS[cameraIndex],
  width: 96,
  height: 88,
});
const iou = (a, b) => {
  assert.equal(a.mask.length, b.mask.length);
  let intersection = 0;
  let union = 0;
  for (let index = 0; index < a.mask.length; index += 1) {
    if (a.mask[index] && b.mask[index]) intersection += 1;
    if (a.mask[index] || b.mask[index]) union += 1;
  }
  return intersection / union;
};
const maskAt = (witness, x, y) => witness.mask[y * witness.width + x];
const occupiedBounds = witness => {
  let minX = witness.width;
  let maxX = -1;
  let minY = witness.height;
  let maxY = -1;
  for (let index = 0; index < witness.mask.length; index += 1) {
    if (!witness.mask[index]) continue;
    const x = index % witness.width;
    const y = Math.floor(index / witness.width);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
};

assert.equal(
  ANNULAR_CANOPY_HYBRID_ARMATURE_PROGRAM.id,
  'kaminos.lirm-armature-program.annular-canopy-hybrid.v0',
);
assert.equal(
  ANNULAR_CANOPY_HYBRID_ARMATURE_PROGRAM.parameterVocabulary,
  `kaminos.rare-gestalt-armature.annular-canopy-hybrid-${ANNULAR_CANOPY_HYBRID_PARAMETER_SPECS.length}.v0`,
);
assert.ok(ANNULAR_CANOPY_HYBRID_PARAMETER_SPECS.length >= 24);
assert.equal(
  new Set(ANNULAR_CANOPY_HYBRID_PARAMETER_SPECS.map(spec => spec.id)).size,
  ANNULAR_CANOPY_HYBRID_PARAMETER_SPECS.length,
);

const parameters = initialParameters(ANNULAR_CANOPY_HYBRID_PARAMETER_SPECS);
const primitives = ANNULAR_CANOPY_HYBRID_ARMATURE_PROGRAM.createPrimitives(parameters);
assert.ok(byRole(primitives, 'annularBody').length >= 16, 'hybrid needs a load-bearing segmented annulus');
assert.ok(byRole(primitives, 'dorsalCanopy').length >= 5, 'hybrid needs an independently legible canopy mass');
assert.equal(byRole(primitives, 'suspendedSensoryMass').length, 1);
assert.ok(byRole(primitives, 'sensorySuspensor').length >= 2);
assert.equal(byRole(primitives, 'tripodSupport').length, 3);
assert.equal(byRole(primitives, 'groundContact').length, 3);

const front = render(ANNULAR_CANOPY_HYBRID_ARMATURE_PROGRAM, parameters);
assert.equal(maskAt(front, 48, 42), 0, 'hybrid front witness must retain visible annular negative space');
const rows = Array.from({ length: front.height }, (_, y) => (
  front.mask.slice(y * front.width, (y + 1) * front.width).filter(Boolean).length
));
assert.ok(rows.indexOf(Math.max(...rows)) < front.height * 0.48, 'hybrid widest mass must remain top-heavy');

const widerCanopyParameters = { ...parameters, canopySpan: parameters.canopySpan + 0.34 };
const initialCanopyXs = byRole(primitives, 'dorsalCanopy')
  .flatMap(primitive => [primitive.center?.x, primitive.a?.x, primitive.b?.x])
  .filter(Number.isFinite);
const widerCanopyXs = byRole(
  ANNULAR_CANOPY_HYBRID_ARMATURE_PROGRAM.createPrimitives(widerCanopyParameters),
  'dorsalCanopy',
).flatMap(primitive => [primitive.center?.x, primitive.a?.x, primitive.b?.x]).filter(Number.isFinite);
assert.ok(
  Math.max(...widerCanopyXs) - Math.min(...widerCanopyXs)
    > Math.max(...initialCanopyXs) - Math.min(...initialCanopyXs) + 0.2,
  'canopySpan must directly widen the hybrid canopy',
);

const widerApertureParameters = { ...parameters, apertureWidth: parameters.apertureWidth + 0.26 };
const initialRingXs = byRole(primitives, 'annularBody')
  .flatMap(primitive => [primitive.a?.x, primitive.b?.x])
  .filter(Number.isFinite);
const widerRingXs = byRole(
  ANNULAR_CANOPY_HYBRID_ARMATURE_PROGRAM.createPrimitives(widerApertureParameters),
  'annularBody',
).flatMap(primitive => [primitive.a?.x, primitive.b?.x]).filter(Number.isFinite);
assert.ok(
  Math.max(...widerRingXs) - Math.min(...widerRingXs)
    > Math.max(...initialRingXs) - Math.min(...initialRingXs) + 0.18,
  'apertureWidth must directly widen the hybrid annulus',
);

const annularParent = render(
  ANNULAR_TRIPOD_ARMATURE_PROGRAM,
  initialParameters(ANNULAR_TRIPOD_PARAMETER_SPECS),
);
const canopyParent = render(
  TRIPOD_CANOPY_ARMATURE_PROGRAM,
  initialParameters(TRIPOD_CANOPY_PARAMETER_SPECS),
);
assert.ok(iou(front, annularParent) < 0.82, 'hybrid silhouette must not reduce to the annular parent');
assert.ok(iou(front, canopyParent) < 0.82, 'hybrid silhouette must not reduce to the canopy parent');

assert.equal(CROSS_FAMILY_HYBRID_CANDIDATES.length, 3);
assert.equal(new Set(CROSS_FAMILY_HYBRID_CANDIDATES.map(item => item.id)).size, 3);
for (const candidate of CROSS_FAMILY_HYBRID_CANDIDATES) {
  assert.equal(candidate.program, ANNULAR_CANOPY_HYBRID_ARMATURE_PROGRAM);
  assert.ok(candidate.lineagePressure.includes('annul'));
  assert.ok(candidate.lineagePressure.includes('canopy'));
}
const candidateRenders = CROSS_FAMILY_HYBRID_CANDIDATES.map(candidate => render(candidate.program, candidate.parameters));
for (const [index, witness] of candidateRenders.entries()) {
  const bounds = occupiedBounds(witness);
  assert.ok(
    bounds.minX >= 2 && bounds.maxX <= witness.width - 3
      && bounds.minY >= 2 && bounds.maxY <= witness.height - 3,
    `${CROSS_FAMILY_HYBRID_CANDIDATES[index].id} must preserve a two-pixel conditioning-frame margin`,
  );
}
for (let left = 0; left < candidateRenders.length; left += 1) {
  for (let right = left + 1; right < candidateRenders.length; right += 1) {
    assert.ok(iou(candidateRenders[left], candidateRenders[right]) < 0.9, 'hybrid candidates need distinct silhouettes');
  }
}

console.log('LIRM cross-family rare gestalt armature program contracts passed');
