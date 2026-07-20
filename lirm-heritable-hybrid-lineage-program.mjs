import {
  ANNULAR_CANOPY_HYBRID_PARAMETER_SPECS,
  createAnnularCanopyHybridPrimitives,
} from './lirm-cross-family-rare-gestalt-armature-program.mjs';

const point = (x, y, z) => ({ x, y, z });
const ellipsoid = (role, center, radius) => ({ kind: 'ellipsoid', role, center, radius });
const capsule = (role, a, b, radius) => ({ kind: 'capsule', role, a, b, radius });
const freezeSpecs = specs => Object.freeze(specs.map(Object.freeze));
const shiftedPoint = (value, dx = 0, dy = 0, dz = 0) => point(value.x + dx, value.y + dy, value.z + dz);

const LINEAGE_PARAMETER_SPECS = freezeSpecs([
  { id: 'canopyCleft', semanticRole: 'heritableCanopyCleavage', initial: 0, min: 0, max: 0.5, step: 0.08 },
  { id: 'canopyHornRise', semanticRole: 'heritableDorsalHorn', initial: 0, min: 0, max: 0.56, step: 0.08 },
  { id: 'pendantForkSpread', semanticRole: 'heritableSuspendedOrganFork', initial: 0, min: 0, max: 0.42, step: 0.07 },
  { id: 'supportKneeBend', semanticRole: 'heritableSupportArticulation', initial: 0.02, min: -0.34, max: 0.34, step: 0.06 },
  { id: 'ventralKeelLength', semanticRole: 'heritableVentralKeel', initial: 0, min: 0, max: 0.62, step: 0.1 },
  { id: 'ventralKeelSweep', semanticRole: 'heritableVentralKeel', initial: 0, min: -0.42, max: 0.42, step: 0.08 },
  { id: 'lateralSailSpan', semanticRole: 'heritableLateralSail', initial: 0, min: 0, max: 0.72, step: 0.11 },
  { id: 'lateralSailSweep', semanticRole: 'heritableLateralSail', initial: 0, min: -0.48, max: 0.48, step: 0.08 },
]);

export const HERITABLE_HYBRID_PARAMETER_SPECS = freezeSpecs([
  ...ANNULAR_CANOPY_HYBRID_PARAMETER_SPECS,
  ...LINEAGE_PARAMETER_SPECS,
]);

function splitCanopy(primitives, p) {
  if (p.canopyCleft <= 0) return primitives;
  const canopy = primitives.filter(primitive => primitive.role === 'dorsalCanopy');
  const rest = primitives.filter(primitive => primitive.role !== 'dorsalCanopy');
  const rebuilt = [];
  for (const primitive of canopy) {
    if (primitive.kind !== 'ellipsoid') continue;
    const relativeX = primitive.center.x - p.canopyOffset;
    if (Math.abs(relativeX) < p.canopySpan * 0.08) {
      const halfWidth = Math.max(primitive.radius.x * 0.48, 0.08);
      const shift = p.canopyCleft * 0.72 + halfWidth * 0.54;
      rebuilt.push(ellipsoid(
        'dorsalCanopy',
        shiftedPoint(primitive.center, -shift, 0, -p.canopyAsymmetry * 0.08),
        point(halfWidth, primitive.radius.y, primitive.radius.z),
      ));
      rebuilt.push(ellipsoid(
        'dorsalCanopy',
        shiftedPoint(primitive.center, shift, p.canopyAsymmetry * 0.08, p.canopyAsymmetry * 0.08),
        point(halfWidth, primitive.radius.y, primitive.radius.z),
      ));
      continue;
    }
    const direction = Math.sign(relativeX) || 1;
    rebuilt.push(ellipsoid(
      'dorsalCanopy',
      shiftedPoint(primitive.center, direction * p.canopyCleft * 0.5),
      primitive.radius,
    ));
  }
  const canopyY = p.groundHeight + p.ringRise
    + (p.apertureHeight * 0.5 + p.ringThickness)
    + p.canopyLift;
  const halfGap = p.canopyCleft * 0.74;
  rebuilt.push(capsule(
    'dorsalCanopy',
    point(p.canopyOffset - p.canopySpan * 0.4, canopyY, 0),
    point(p.canopyOffset - halfGap, canopyY + p.canopyArch * 0.34, -p.canopyAsymmetry * 0.08),
    p.canopyHeight * 0.24,
  ));
  rebuilt.push(capsule(
    'dorsalCanopy',
    point(p.canopyOffset + halfGap, canopyY + p.canopyAsymmetry * 0.1, p.canopyAsymmetry * 0.08),
    point(p.canopyOffset + p.canopySpan * 0.4, canopyY + p.canopyAsymmetry * 0.12, 0),
    p.canopyHeight * 0.24,
  ));
  return [...rest, ...rebuilt];
}

function articulateSupports(primitives, p) {
  const supports = primitives.filter(primitive => primitive.role === 'tripodSupport');
  const rest = primitives.filter(primitive => primitive.role !== 'tripodSupport');
  const articulated = [];
  for (const [index, support] of supports.entries()) {
    const side = index === 0 ? -1 : index === 1 ? 1 : 0;
    const fore = index === 2 ? 1 : -0.42;
    const knee = point(
      (support.a.x + support.b.x) * 0.5 + side * p.supportKneeBend,
      (support.a.y + support.b.y) * 0.5 + Math.abs(p.supportKneeBend) * 0.1,
      (support.a.z + support.b.z) * 0.5 + fore * p.supportKneeBend * 0.7,
    );
    articulated.push(capsule('tripodSupport', support.a, knee, support.radius));
    articulated.push(capsule('tripodSupport', knee, support.b, support.radius * 0.92));
  }
  return [...rest, ...articulated];
}

function forkPendant(primitives, p) {
  if (p.pendantForkSpread <= 0) return primitives;
  const masses = primitives.filter(primitive => primitive.role === 'suspendedSensoryMass');
  const rest = primitives.filter(primitive => !['suspendedSensoryMass', 'sensorySuspensor'].includes(primitive.role));
  const source = masses[0];
  const centerY = source.center.y;
  const split = p.pendantForkSpread * 0.5;
  const left = shiftedPoint(source.center, -split, 0, -split * 0.22);
  const right = shiftedPoint(source.center, split, split * 0.08, split * 0.22);
  const radius = point(source.radius.x * 0.72, source.radius.y * 0.92, source.radius.z * 0.82);
  const ringCenterY = p.groundHeight + p.ringRise;
  const ringCrownY = ringCenterY + p.apertureHeight * 0.5 + p.ringThickness;
  const roots = [
    point(left.x - p.suspensorSpread * 0.62, ringCrownY, -p.ringTwist * 0.12),
    point(left.x + p.suspensorSpread * 0.34, ringCrownY, p.ringTwist * 0.08),
    point(right.x - p.suspensorSpread * 0.34, ringCrownY, -p.ringTwist * 0.08),
    point(right.x + p.suspensorSpread * 0.62, ringCrownY, p.ringTwist * 0.12),
  ];
  return [
    ...rest,
    capsule('sensorySuspensor', roots[0], left, p.supportThickness * 0.38),
    capsule('sensorySuspensor', roots[1], left, p.supportThickness * 0.34),
    capsule('sensorySuspensor', roots[2], right, p.supportThickness * 0.34),
    capsule('sensorySuspensor', roots[3], right, p.supportThickness * 0.38),
    ellipsoid('suspendedSensoryMass', left, radius),
    ellipsoid('suspendedSensoryMass', right, radius),
    capsule('suspendedSensoryBridge', left, right, Math.max(p.supportThickness * 0.34, 0.026)),
  ];
}

function addDerivedTopology(primitives, p) {
  const result = [...primitives];
  const radiusX = p.apertureWidth * 0.5 + p.ringThickness;
  const radiusY = p.apertureHeight * 0.5 + p.ringThickness;
  const ringCenterY = p.groundHeight + p.ringRise;
  const ringCrownY = ringCenterY + radiusY;
  if (p.canopyHornRise > 0) {
    for (const side of [-1, 1]) {
      const root = point(
        p.canopyOffset + side * (p.canopySpan * 0.36 + p.canopyCleft * 0.25),
        ringCrownY + p.canopyLift + p.canopyHeight * 0.12,
        side * p.canopyAsymmetry * 0.18,
      );
      result.push(capsule(
        'dorsalHorn',
        root,
        point(root.x + side * p.canopyHornRise * 0.36, root.y + p.canopyHornRise, root.z - p.canopyHornRise * 0.18),
        Math.max(p.supportThickness * 0.64, 0.04),
      ));
    }
  }
  if (p.ventralKeelLength > 0) {
    const root = point(0, ringCenterY - radiusY * 0.56, p.ringDepth * 0.26);
    const middle = point(
      p.ventralKeelSweep * 0.2,
      root.y - p.ventralKeelLength * 0.46,
      p.ringDepth * 0.62 + p.ventralKeelSweep * 0.32,
    );
    const tip = point(
      p.ventralKeelSweep * 0.42,
      Math.max(p.groundHeight + 0.08, root.y - p.ventralKeelLength),
      p.ringDepth + p.ventralKeelSweep,
    );
    result.push(capsule('ventralKeel', root, middle, p.supportThickness * 0.72));
    result.push(capsule('ventralKeel', middle, tip, p.supportThickness * 0.48));
  }
  if (p.lateralSailSpan > 0) {
    for (const side of [-1, 1]) {
      const root = point(side * radiusX * 0.88, ringCenterY + radiusY * 0.16, 0);
      const shoulder = point(
        side * (radiusX + p.lateralSailSpan * 0.55),
        ringCenterY + radiusY * 0.34,
        p.lateralSailSweep * side * 0.32,
      );
      const tip = point(
        side * (radiusX + p.lateralSailSpan),
        ringCenterY - radiusY * 0.14 + Math.abs(p.lateralSailSweep) * 0.12,
        p.lateralSailSweep * side,
      );
      result.push(capsule('lateralSail', root, shoulder, Math.max(p.ringThickness * 0.42, 0.05)));
      result.push(capsule('lateralSail', shoulder, tip, Math.max(p.ringThickness * 0.3, 0.038)));
      result.push(ellipsoid(
        'lateralSail',
        shoulder,
        point(p.lateralSailSpan * 0.34, p.ringThickness * 0.62, p.ringDepth * 0.72),
      ));
    }
  }
  return result;
}

export function createHeritableHybridLineagePrimitives(p) {
  let primitives = createAnnularCanopyHybridPrimitives(p);
  primitives = splitCanopy(primitives, p);
  primitives = articulateSupports(primitives, p);
  primitives = forkPendant(primitives, p);
  return addDerivedTopology(primitives, p);
}

export const HERITABLE_HYBRID_LINEAGE_PROGRAM = Object.freeze({
  id: 'kaminos.lirm-armature-program.heritable-annular-canopy.v0',
  parameterVocabulary: `kaminos.lirm-armature.heritable-annular-canopy-${HERITABLE_HYBRID_PARAMETER_SPECS.length}.v0`,
  parameterSpecs: HERITABLE_HYBRID_PARAMETER_SPECS,
  createPrimitives: createHeritableHybridLineagePrimitives,
});

const initialParameters = () => Object.fromEntries(
  HERITABLE_HYBRID_PARAMETER_SPECS.map(spec => [spec.id, spec.initial]),
);
const COMMITMENTS = Object.freeze([
  'open-annular-aperture',
  'independent-dorsal-canopy',
  'sparse-tripod-support-field',
  'spatially-distinct-suspended-anatomy',
]);
const founderParameters = Object.freeze({
  ...initialParameters(),
  canopyAsymmetry: 0.14,
  pendantLateral: 0.08,
});

export const HERITABLE_HYBRID_FOUNDER = Object.freeze({
  id: 'annular-canopy-founder',
  lineageId: 'founder',
  generation: 0,
  parentId: null,
  program: HERITABLE_HYBRID_LINEAGE_PROGRAM,
  parameters: founderParameters,
  inheritedCommitments: COMMITMENTS,
  inheritedMutations: Object.freeze([]),
  lineagePressure: 'open annular creature with an independent dorsal canopy, articulated tripod stance, and suspended interior sensory anatomy',
});

const descendant = ({ id, lineageId, generation, parent, overrides, mutation, pressure }) => Object.freeze({
  id,
  lineageId,
  generation,
  parentId: parent.id,
  program: HERITABLE_HYBRID_LINEAGE_PROGRAM,
  parameters: Object.freeze({ ...parent.parameters, ...overrides }),
  inheritedCommitments: COMMITMENTS,
  inheritedMutations: Object.freeze([...parent.inheritedMutations, mutation]),
  lineagePressure: pressure,
});

function lineage(id, requiredDerivedRole, generations) {
  let parent = HERITABLE_HYBRID_FOUNDER;
  const descendants = generations.map((definition, index) => {
    const item = descendant({
      ...definition,
      id: `${id}-g${index + 1}`,
      lineageId: id,
      generation: index + 1,
      parent,
    });
    parent = item;
    return item;
  });
  return Object.freeze({ id, requiredDerivedRole, generations: Object.freeze(descendants) });
}

export const HERITABLE_HYBRID_BRANCHES = Object.freeze([
  lineage('cleft-crown-twins', 'dorsalHorn', [
    {
      overrides: { canopyCleft: 0.13, pendantForkSpread: 0.1, canopyHornRise: 0.08 },
      mutation: 'incipient-cleft-and-sensory-fork',
      pressure: 'incipient split crown with paired hanging sensory lobes while preserving the open annulus and tripod stance',
    },
    {
      overrides: { canopyCleft: 0.27, pendantForkSpread: 0.23, canopyHornRise: 0.24, canopySpan: 1.92 },
      mutation: 'paired-crown-horns',
      pressure: 'deeply cleft crown canopy with paired horns and clearly bifurcated suspended anatomy',
    },
    {
      overrides: { canopyCleft: 0.4, pendantForkSpread: 0.34, canopyHornRise: 0.28, canopySpan: 1.96, canopyLift: 0.08 },
      mutation: 'towering-bifid-crown',
      pressure: 'towering bifid crown organism with twin suspended organs and a load-bearing open annular torso',
    },
  ]),
  lineage('stilted-ventral-keel', 'ventralKeel', [
    {
      overrides: { supportKneeBend: 0.1, ventralKeelLength: 0.18, ringRise: 0.98, supportSpread: 0.82 },
      mutation: 'articulated-stilts-and-keel-bud',
      pressure: 'high annular body on articulated tripod stilts with an emerging ventral keel beneath the aperture',
    },
    {
      overrides: { supportKneeBend: 0.22, ventralKeelLength: 0.38, ventralKeelSweep: -0.18, ringRise: 1.01, supportSpread: 0.96, supportForeAft: 0.52 },
      mutation: 'swept-ventral-keel',
      pressure: 'long-jointed tripod strider with a swept ventral keel and suspended sensory anatomy inside the annulus',
    },
    {
      overrides: { supportKneeBend: 0.33, ventralKeelLength: 0.58, ventralKeelSweep: -0.38, ringRise: 0.96, supportSpread: 1.08, supportForeAft: 0.62, apertureHeight: 0.86 },
      mutation: 'high-stilt-keel-strider',
      pressure: 'towering three-stilt portal organism with a long rear-swept keel, high open body, and independent canopy',
    },
  ]),
  lineage('lateral-sail-radiant', 'lateralSail', [
    {
      overrides: { lateralSailSpan: 0.2, lateralSailSweep: 0.1, apertureWidth: 1.04, canopySpan: 1.54 },
      mutation: 'lateral-sail-buds',
      pressure: 'annular tripod creature with small lateral sail buds and a compact asymmetric canopy',
    },
    {
      overrides: { lateralSailSpan: 0.43, lateralSailSweep: 0.28, apertureWidth: 1.2, canopySpan: 1.38, canopyAsymmetry: -0.2, pendantLateral: -0.28 },
      mutation: 'swept-lateral-sails',
      pressure: 'wide portal organism with swept bilateral sails, offset suspended anatomy, and a narrow dorsal canopy',
    },
    {
      overrides: { lateralSailSpan: 0.5, lateralSailSweep: 0.42, apertureWidth: 1.24, apertureHeight: 0.64, canopySpan: 1.12, canopyAsymmetry: -0.34, pendantLateral: -0.4, pendantDrop: 0.62 },
      mutation: 'radiant-winged-portal',
      pressure: 'extremely wide low annular portal with radiant swept side sails, compact canopy, and a low eccentric pendant',
    },
  ]),
]);

const CROSS_SOURCE_LOCI = Object.freeze({
  'cleft-crown-twins': Object.freeze([
    'canopyCleft',
    'canopyHornRise',
    'pendantForkSpread',
    'canopyLift',
  ]),
  'stilted-ventral-keel': Object.freeze([
    'supportKneeBend',
    'ventralKeelLength',
    'ventralKeelSweep',
    'ringRise',
    'supportSpread',
    'supportForeAft',
  ]),
  'lateral-sail-radiant': Object.freeze([
    'lateralSailSpan',
    'lateralSailSweep',
    'apertureWidth',
    'apertureHeight',
    'canopyAsymmetry',
    'pendantLateral',
    'pendantDrop',
  ]),
});

const CROSS_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'cleft-crown-x-stilted-keel',
    parentLineageIds: Object.freeze(['cleft-crown-twins', 'stilted-ventral-keel']),
    conflictLoci: Object.freeze(['canopySpan']),
    pressures: Object.freeze({
      'cleft-crown-twins': 'towering bifid-crown strider with paired suspended organs, articulated stilts, and a swept ventral keel around an open annular torso',
      'stilted-ventral-keel': 'long-legged annular keel creature carrying a compact inherited twin crown and forked sensory anatomy',
    }),
  }),
  Object.freeze({
    id: 'cleft-crown-x-lateral-sail',
    parentLineageIds: Object.freeze(['cleft-crown-twins', 'lateral-sail-radiant']),
    conflictLoci: Object.freeze(['canopySpan']),
    pressures: Object.freeze({
      'cleft-crown-twins': 'broad twin-horned annular organism with radiant side sails and paired suspended sensory organs',
      'lateral-sail-radiant': 'wide low portal creature with a compressed bifid crown, swept lateral sails, and forked interior anatomy',
    }),
  }),
  Object.freeze({
    id: 'stilted-keel-x-lateral-sail',
    parentLineageIds: Object.freeze(['stilted-ventral-keel', 'lateral-sail-radiant']),
    conflictLoci: Object.freeze(['apertureHeight', 'ringRise']),
    pressures: Object.freeze({
      'stilted-ventral-keel': 'high articulated portal strider with radiant lateral sails, a swept keel, and suspended interior anatomy',
      'lateral-sail-radiant': 'wide low sail-bearing annular creature with compressed stilts and a long eccentric ventral keel',
    }),
  }),
]);

function terminalByLineageId(lineageId) {
  const branch = HERITABLE_HYBRID_BRANCHES.find(item => item.id === lineageId);
  if (!branch) throw new Error(`unknown terminal lineage: ${lineageId}`);
  return branch.generations.at(-1);
}

function crossCandidate(definition, dominantLineageId) {
  const parents = definition.parentLineageIds.map(terminalByLineageId);
  const parentByLineage = new Map(parents.map(parent => [parent.lineageId, parent]));
  const parameters = { ...HERITABLE_HYBRID_FOUNDER.parameters };
  const locusProvenance = {};
  for (const parent of parents) {
    for (const locus of CROSS_SOURCE_LOCI[parent.lineageId]) {
      parameters[locus] = parent.parameters[locus];
      locusProvenance[locus] = parent.lineageId;
    }
  }
  const dominant = parentByLineage.get(dominantLineageId);
  for (const locus of definition.conflictLoci) {
    parameters[locus] = dominant.parameters[locus];
    locusProvenance[locus] = dominantLineageId;
  }
  const dominantHandle = dominantLineageId
    .replace('cleft-crown-twins', 'crown')
    .replace('stilted-ventral-keel', 'stilt')
    .replace('lateral-sail-radiant', 'sail');
  return Object.freeze({
    id: `${definition.id}-f1-${dominantHandle}-dominant`,
    lineageId: definition.id,
    generation: 4,
    crossGeneration: 1,
    parentId: null,
    parentIds: Object.freeze(parents.map(parent => parent.id)),
    parentLineageIds: definition.parentLineageIds,
    dominantLineageId,
    program: HERITABLE_HYBRID_LINEAGE_PROGRAM,
    parameters: Object.freeze(parameters),
    locusProvenance: Object.freeze(locusProvenance),
    inheritedCommitments: COMMITMENTS,
    inheritedMutations: Object.freeze([...new Set(parents.flatMap(parent => parent.inheritedMutations))]),
    lineagePressure: definition.pressures[dominantLineageId],
  });
}

export const HERITABLE_HYBRID_CROSSES = Object.freeze(CROSS_DEFINITIONS.map(definition => {
  const parents = definition.parentLineageIds.map(terminalByLineageId);
  const offspring = definition.parentLineageIds.map(dominantLineageId => crossCandidate(definition, dominantLineageId));
  return Object.freeze({
    id: definition.id,
    parentIds: Object.freeze(parents.map(parent => parent.id)),
    parentLineageIds: definition.parentLineageIds,
    conflictLoci: definition.conflictLoci,
    offspring: Object.freeze(offspring),
  });
}));

export function buildHeritableHybridCrossPlan({ crosses = HERITABLE_HYBRID_CROSSES } = {}) {
  if (!Array.isArray(crosses) || crosses.length !== 3) {
    throw new Error('heritable hybrid cross plan requires three pairwise terminal crosses');
  }
  const candidates = crosses.flatMap(cross => cross.offspring);
  if (candidates.length !== 6 || new Set(candidates.map(candidate => candidate.id)).size !== 6) {
    throw new Error('heritable hybrid cross plan requires six unique F1 offspring');
  }
  return {
    schema: 'kaminos.lirm-heritable-hybrid-cross-plan.v0',
    parents: HERITABLE_HYBRID_BRANCHES.map(branch => branch.generations.at(-1)),
    crosses: crosses.map(cross => ({
      id: cross.id,
      parentIds: [...cross.parentIds],
      parentLineageIds: [...cross.parentLineageIds],
      conflictLoci: [...cross.conflictLoci],
      offspringIds: cross.offspring.map(candidate => candidate.id),
    })),
    candidates,
    evidencePredicate: {
      exactPairwiseCrossCount: 3,
      exactOffspringCount: 6,
      discreteLocusInheritanceRequired: true,
      oppositeDominanceRequired: true,
      bothParentTopologiesRequired: true,
      visibleRecombinationRequiresInspection: true,
      generatorOrSpatialCastClaim: 'forbidden_until_separately_witnessed',
    },
  };
}
