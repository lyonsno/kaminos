import assert from 'node:assert/strict';

import {
  REFERENCE_FIT_CAMERAS,
  renderReferenceArmature,
} from '../lirm-reference-fitted-armature-core.mjs';
import {
  HERITABLE_HYBRID_BRANCHES,
  HERITABLE_HYBRID_FOUNDER,
  HERITABLE_HYBRID_LINEAGE_PROGRAM,
  HERITABLE_HYBRID_PARAMETER_SPECS,
} from '../lirm-heritable-hybrid-lineage-program.mjs';

const byRole = (primitives, role) => primitives.filter(primitive => primitive.role === role);
const render = candidate => renderReferenceArmature({
  parameters: candidate.parameters,
  armatureProgram: candidate.program,
  camera: REFERENCE_FIT_CAMERAS[0],
  width: 128,
  height: 112,
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

assert.equal(HERITABLE_HYBRID_LINEAGE_PROGRAM.id, 'kaminos.lirm-armature-program.heritable-annular-canopy.v0');
assert.ok(HERITABLE_HYBRID_PARAMETER_SPECS.length >= 34);
assert.equal(new Set(HERITABLE_HYBRID_PARAMETER_SPECS.map(spec => spec.id)).size, HERITABLE_HYBRID_PARAMETER_SPECS.length);
assert.equal(HERITABLE_HYBRID_FOUNDER.generation, 0);
assert.equal(HERITABLE_HYBRID_FOUNDER.parentId, null);
assert.deepEqual(HERITABLE_HYBRID_FOUNDER.inheritedMutations, []);
assert.equal(HERITABLE_HYBRID_BRANCHES.length, 3);

const parameterSpecs = new Map(HERITABLE_HYBRID_PARAMETER_SPECS.map(spec => [spec.id, spec]));
const terminalRenders = [];
for (const branch of HERITABLE_HYBRID_BRANCHES) {
  assert.match(branch.id, /^[a-z0-9][a-z0-9-]*$/);
  assert.match(branch.requiredDerivedRole, /^[a-zA-Z][a-zA-Z0-9]*$/);
  assert.equal(branch.generations.length, 3);
  assert.equal(new Set(branch.generations.map(item => item.id)).size, 3);
  let parent = HERITABLE_HYBRID_FOUNDER;
  let priorMutationCount = 0;
  for (const descendant of branch.generations) {
    assert.equal(descendant.program, HERITABLE_HYBRID_LINEAGE_PROGRAM);
    assert.equal(descendant.lineageId, branch.id);
    assert.equal(descendant.parentId, parent.id);
    assert.equal(descendant.generation, parent.generation + 1);
    assert.ok(descendant.inheritedCommitments.includes('open-annular-aperture'));
    assert.ok(descendant.inheritedCommitments.includes('independent-dorsal-canopy'));
    assert.ok(descendant.inheritedCommitments.includes('sparse-tripod-support-field'));
    assert.ok(descendant.inheritedCommitments.includes('spatially-distinct-suspended-anatomy'));
    assert.ok(descendant.inheritedMutations.length > priorMutationCount);
    for (const mutation of parent.inheritedMutations) {
      assert.ok(descendant.inheritedMutations.includes(mutation), `${descendant.id} reverted mutation ${mutation}`);
    }
    for (const [key, value] of Object.entries(descendant.parameters)) {
      const spec = parameterSpecs.get(key);
      assert.ok(spec, `${descendant.id} uses unknown parameter ${key}`);
      assert.ok(value >= spec.min && value <= spec.max, `${descendant.id}.${key} escaped parameter bounds`);
    }
    const primitives = descendant.program.createPrimitives(descendant.parameters);
    assert.ok(byRole(primitives, 'annularBody').length >= 16);
    assert.ok(byRole(primitives, 'dorsalCanopy').length >= 5);
    assert.equal(byRole(primitives, 'tripodSupport').length, 6, 'articulated tripod must use two segments per support');
    assert.equal(byRole(primitives, 'groundContact').length, 3);
    assert.ok(byRole(primitives, 'suspendedSensoryMass').length >= 1);
    const witness = render(descendant);
    const bounds = occupiedBounds(witness);
    assert.ok(bounds.minX >= 2 && bounds.maxX <= witness.width - 3, `${descendant.id} clipped horizontally`);
    assert.ok(bounds.minY >= 2 && bounds.maxY <= witness.height - 3, `${descendant.id} clipped vertically`);
    let centralNegativeSpace = 0;
    for (let y = 34; y < 79; y += 1) {
      for (let x = 42; x < 87; x += 1) {
        if (!witness.mask[y * witness.width + x]) centralNegativeSpace += 1;
      }
    }
    assert.ok(centralNegativeSpace > 500, `${descendant.id} closed the inherited aperture region`);
    parent = descendant;
    priorMutationCount = descendant.inheritedMutations.length;
  }
  assert.ok(
    byRole(
      branch.generations.at(-1).program.createPrimitives(branch.generations.at(-1).parameters),
      branch.requiredDerivedRole,
    ).length >= 1,
    `${branch.id} terminal descendant omitted its branch-derived topology`,
  );
  terminalRenders.push(render(branch.generations.at(-1)));
}

for (let left = 0; left < terminalRenders.length; left += 1) {
  for (let right = left + 1; right < terminalRenders.length; right += 1) {
    assert.ok(iou(terminalRenders[left], terminalRenders[right]) < 0.82, 'terminal lineages need materially distinct silhouettes');
  }
}

console.log('LIRM heritable hybrid lineage contracts passed');
