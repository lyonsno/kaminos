import assert from 'node:assert/strict';

import {
  REFERENCE_FIT_CAMERAS,
  renderReferenceArmature,
} from '../lirm-reference-fitted-armature-core.mjs';
import {
  ASYMMETRIC_BEAD_CHAIN_ARMATURE_PROGRAM,
  ASYMMETRIC_BEAD_CHAIN_PARAMETER_SPECS,
  FORKED_SADDLE_ARMATURE_PROGRAM,
  FORKED_SADDLE_PARAMETER_SPECS,
} from '../lirm-branching-armature-programs.mjs';

const initialParameters = specs => Object.fromEntries(specs.map(spec => [spec.id, spec.initial]));
const byRole = (primitives, role) => primitives.filter(primitive => primitive.role === role);
const occupiedBounds = witness => {
  const xs = [];
  const ys = [];
  for (let index = 0; index < witness.mask.length; index += 1) {
    if (!witness.mask[index]) continue;
    xs.push(index % witness.width);
    ys.push(Math.floor(index / witness.width));
  }
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
    width: Math.max(...xs) - Math.min(...xs) + 1,
    height: Math.max(...ys) - Math.min(...ys) + 1,
  };
};
const render = (program, parameters, cameraIndex) => renderReferenceArmature({
  parameters,
  armatureProgram: program,
  camera: REFERENCE_FIT_CAMERAS[cameraIndex],
  width: 64,
  height: 56,
});

assert.equal(FORKED_SADDLE_ARMATURE_PROGRAM.id, 'kaminos.lirm-armature-program.forked-saddle.v0');
assert.equal(
  FORKED_SADDLE_ARMATURE_PROGRAM.parameterVocabulary,
  `kaminos.reference-fitted-armature.forked-saddle-${FORKED_SADDLE_PARAMETER_SPECS.length}.v0`,
);
assert.ok(FORKED_SADDLE_PARAMETER_SPECS.length >= 18);
assert.equal(
  new Set(FORKED_SADDLE_PARAMETER_SPECS.map(spec => spec.id)).size,
  FORKED_SADDLE_PARAMETER_SPECS.length,
);

const saddleParameters = initialParameters(FORKED_SADDLE_PARAMETER_SPECS);
const saddlePrimitives = FORKED_SADDLE_ARMATURE_PROGRAM.createPrimitives(saddleParameters);
for (const role of ['saddleRootMass', 'forkBranch', 'terminalMass', 'localizedContactLimb', 'groundContact']) {
  assert.ok(byRole(saddlePrimitives, role).length > 0, `forked saddle missing semantic role: ${role}`);
}
assert.ok(byRole(saddlePrimitives, 'forkBranch').length >= 6, 'forked saddle needs articulated rising branches');
assert.equal(byRole(saddlePrimitives, 'terminalMass').length, 2, 'forked saddle needs paired terminal masses');
assert.equal(byRole(saddlePrimitives, 'localizedContactLimb').length, 4, 'forked saddle support must stay sparse');

const saddleTerminals = byRole(saddlePrimitives, 'terminalMass');
assert.ok(
  Math.abs(saddleTerminals[0].center.x - saddleTerminals[1].center.x) > 0.72,
  'fork spread must materially separate the terminal masses',
);
const saddleFront = render(FORKED_SADDLE_ARMATURE_PROGRAM, saddleParameters, 0);
const saddleSide = render(FORKED_SADDLE_ARMATURE_PROGRAM, saddleParameters, 2);
const saddleFrontBounds = occupiedBounds(saddleFront);
const saddleSideBounds = occupiedBounds(saddleSide);
assert.ok(saddleFrontBounds.width > saddleFrontBounds.height * 1.03, 'forked saddle front must read as a broad horseshoe');
assert.ok(saddleSideBounds.width < saddleFrontBounds.width * 0.74, 'forked saddle side must expose its thin profile');

const widerSaddle = {
  ...saddleParameters,
  branchSpread: Math.min(
    saddleParameters.branchSpread + 0.3,
    FORKED_SADDLE_PARAMETER_SPECS.find(spec => spec.id === 'branchSpread').max,
  ),
};
const widerTerminals = byRole(FORKED_SADDLE_ARMATURE_PROGRAM.createPrimitives(widerSaddle), 'terminalMass');
assert.ok(
  Math.abs(widerTerminals[0].center.x - widerTerminals[1].center.x)
    > Math.abs(saddleTerminals[0].center.x - saddleTerminals[1].center.x) + 0.2,
  'branchSpread must remain a direct semantic silhouette handle',
);

assert.equal(
  ASYMMETRIC_BEAD_CHAIN_ARMATURE_PROGRAM.id,
  'kaminos.lirm-armature-program.asymmetric-bead-chain.v0',
);
assert.equal(
  ASYMMETRIC_BEAD_CHAIN_ARMATURE_PROGRAM.parameterVocabulary,
  `kaminos.reference-fitted-armature.asymmetric-bead-chain-${ASYMMETRIC_BEAD_CHAIN_PARAMETER_SPECS.length}.v0`,
);
assert.ok(ASYMMETRIC_BEAD_CHAIN_PARAMETER_SPECS.length >= 20);
assert.equal(
  new Set(ASYMMETRIC_BEAD_CHAIN_PARAMETER_SPECS.map(spec => spec.id)).size,
  ASYMMETRIC_BEAD_CHAIN_PARAMETER_SPECS.length,
);

const chainParameters = initialParameters(ASYMMETRIC_BEAD_CHAIN_PARAMETER_SPECS);
const chainPrimitives = ASYMMETRIC_BEAD_CHAIN_ARMATURE_PROGRAM.createPrimitives(chainParameters);
for (const role of ['posteriorCluster', 'axialBead', 'terminalSensoryMass', 'localizedContactLimb', 'groundContact']) {
  assert.ok(byRole(chainPrimitives, role).length > 0, `bead chain missing semantic role: ${role}`);
}
assert.ok(byRole(chainPrimitives, 'posteriorCluster').length >= 3, 'posterior cluster must contain multiple overlapping masses');
assert.ok(byRole(chainPrimitives, 'axialBead').length >= 4, 'axial organization must be an articulated bead chain');
assert.equal(byRole(chainPrimitives, 'terminalSensoryMass').length, 1, 'terminal sensory mass must stay singular');
assert.ok(byRole(chainPrimitives, 'localizedContactLimb').length <= 5, 'support must remain localized instead of radial');

const chainMasses = chainPrimitives.filter(primitive => (
  primitive.center && (
    primitive.role === 'posteriorCluster'
    || primitive.role === 'axialBead'
    || primitive.role === 'terminalSensoryMass'
  )
));
const chainXs = chainMasses.map(primitive => primitive.center.x);
const chainZs = chainMasses.map(primitive => primitive.center.z);
assert.ok(Math.max(...chainXs) - Math.min(...chainXs) > 0.42, 'bead chain needs strong lateral asymmetry');
assert.ok(Math.max(...chainZs) - Math.min(...chainZs) > 1.25, 'bead chain needs a long axial mass trajectory');

const chainFront = render(ASYMMETRIC_BEAD_CHAIN_ARMATURE_PROGRAM, chainParameters, 0);
const chainSide = render(ASYMMETRIC_BEAD_CHAIN_ARMATURE_PROGRAM, chainParameters, 2);
const chainFrontBounds = occupiedBounds(chainFront);
const chainSideBounds = occupiedBounds(chainSide);
assert.ok(chainSideBounds.width > chainFrontBounds.width * 1.2, 'bead chain must expose a materially longer axial view');
assert.ok(
  Math.abs(chainSideBounds.width / chainSideBounds.height - saddleSideBounds.width / saddleSideBounds.height) > 0.45,
  'new programs must occupy materially different side-view gestalt basins',
);

const sweptChain = {
  ...chainParameters,
  lateralSweep: Math.min(
    chainParameters.lateralSweep + 0.24,
    ASYMMETRIC_BEAD_CHAIN_PARAMETER_SPECS.find(spec => spec.id === 'lateralSweep').max,
  ),
};
const sweptXs = ASYMMETRIC_BEAD_CHAIN_ARMATURE_PROGRAM.createPrimitives(sweptChain)
  .filter(primitive => primitive.role === 'axialBead' && primitive.center)
  .map(primitive => primitive.center.x);
const initialXs = byRole(chainPrimitives, 'axialBead')
  .filter(primitive => primitive.center)
  .map(primitive => primitive.center.x);
assert.ok(
  Math.max(...sweptXs) - Math.min(...sweptXs) > Math.max(...initialXs) - Math.min(...initialXs) + 0.12,
  'lateralSweep must remain a direct semantic trajectory handle',
);

console.log('LIRM branching armature program contracts passed');
