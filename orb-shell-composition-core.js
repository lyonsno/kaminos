export const ORB_SHELL_COMPOSITION_IDENTITY = 'orb-shell-macro-grammar-grounding-v0';
export const ORB_SHELL_COMPOSITION_BASELINE = 'coherent-but-wrong-model-baseline';
export const ORB_SHELL_CONTROLLED_VARIATION_MODE = 'orb-shell-controlled-variation-assay-v0';
export const ORB_SHELL_MACRO_TORSION_MODE = 'macro-torsion-field-v0';
export const ORB_SHELL_MACRO_FAMILY_SUBSTRIP_MODE = 'parent-owned-lamellar-substrip-decomposition-v0';
export const ORB_SHELL_APERTURE_TERMINATION_MODE = 'aperture-relative-lamellar-termination-v0';
export const ORB_SHELL_APERTURE_TANGENCY_WITNESS_MODE = 'aperture-tangency-witness-v0';

const TAU = Math.PI * 2;
const MACRO_VARIATION_IDS = [
  'north-west-dominant-thrust',
  'north-east-counter-thrust',
  'equatorial-cupping-whorl',
  'polar-crown-lock',
  'lower-socket-keel',
];
const REQUIRED_MACRO_ASSEMBLAGE_IDS = [
  'north-west-dominant-thrust',
  'north-east-counter-thrust',
];
const OPTIONAL_MACRO_ASSEMBLAGE_IDS = [
  'equatorial-cupping-whorl',
  'polar-crown-lock',
  'lower-socket-keel',
];

function spherePoint(lat, lon, radius = 1) {
  const c = Math.cos(lat);
  return [radius * Math.sin(lon) * c, radius * Math.sin(lat), radius * Math.cos(lon) * c];
}

function makeVec3(THREE, point) {
  return new THREE.Vector3(point[0], point[1], point[2]);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smoothStep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function pointDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function summarizeDistances(samples) {
  const values = samples.map(sample => sample.distance);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    min,
    max,
    mean,
    variation: max - min,
    relativeVariation: mean ? (max - min) / mean : 0,
  };
}

function normalizePoint(point) {
  const length = Math.hypot(point[0], point[1], point[2]) || 1;
  return [point[0] / length, point[1] / length, point[2] / length];
}

function addScaledPoint(point, normal, amount) {
  return [
    point[0] + normal[0] * amount,
    point[1] + normal[1] * amount,
    point[2] + normal[2] * amount,
  ];
}

function subtractPoints(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function crossPoints(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function scalePoint(point, amount) {
  return [point[0] * amount, point[1] * amount, point[2] * amount];
}

function addPoints(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function lerpPoint(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function dotPoints(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function scaledNormalizedPoint(point, radius = 1) {
  const normal = normalizePoint(point);
  return [normal[0] * radius, normal[1] * radius, normal[2] * radius];
}

function seamGapSeedPoints(gapId, radius = 1.085) {
  const seamShapes = {
    'primary-front-intentional-slit': [[-0.28, 0.42, 0.92], [-0.18, 0.16, 1.04], [-0.02, -0.12, 1.07], [0.16, -0.42, 0.9]],
    'crossing-tuck-overlap-receiver': [[-0.1, -0.1, 1.05], [0.08, -0.2, 1.08], [0.28, -0.34, 0.94]],
    'lower-cup-socket-join-gap': [[-0.28, -0.82, 0.67], [-0.05, -0.92, 0.58], [0.26, -0.82, 0.68]],
    'upper-crown-receiver-gap': [[-0.28, 0.9, 0.52], [0.02, 1.02, 0.34], [0.32, 0.88, 0.52]],
    'right-side-rim-reveal-gap': [[0.74, 0.3, 0.62], [0.86, 0.02, 0.58], [0.76, -0.24, 0.62]],
  };
  return (seamShapes[gapId] || [[-0.2, 0, 1.02], [0, 0, 1.08], [0.2, 0, 1.02]])
    .map(point => scaledNormalizedPoint(point, radius));
}

function samplePolyline(points, t) {
  if (points.length <= 1) return points[0] || [0, 0, 1];
  const scaled = clamp(t, 0, 1) * (points.length - 1);
  const index = Math.min(points.length - 2, Math.floor(scaled));
  return lerpPoint(points[index], points[index + 1], scaled - index);
}

function stableNoise(key) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 0xffffffff) * 2 - 1;
}

function variantPreset(variantId) {
  const presets = {
    baseline: { amplitude: 0, cupBias: 0, tuckBias: 0, dominanceBias: 0 },
    'asymmetric-tuck': { amplitude: 0.88, cupBias: 0.12, tuckBias: 0.18, dominanceBias: 0.1 },
    'wide-cup': { amplitude: 0.72, cupBias: 0.22, tuckBias: -0.05, dominanceBias: -0.04 },
    'tight-crown': { amplitude: 0.64, cupBias: -0.08, tuckBias: 0.1, dominanceBias: 0.16 },
    'left-heavy-rim': { amplitude: 0.78, cupBias: 0.04, tuckBias: -0.16, dominanceBias: 0.2 },
  };
  return presets[variantId] || { amplitude: 0.7, cupBias: 0, tuckBias: 0, dominanceBias: 0 };
}

export function createControlledOrbShellVariationDescriptor({ variantId = 'baseline', variationSeed = 0, variationLeafCount = 10, uiControlSource = 'route-or-programmatic' } = {}) {
  const normalizedVariantId = String(variantId || 'baseline');
  const seed = Number.isFinite(Number(variationSeed)) ? Number(variationSeed) : 0;
  const leafCount = clamp(Math.round(Number.isFinite(Number(variationLeafCount)) ? Number(variationLeafCount) : 10), 8, 14);
  const leafDensityPressure = clamp((leafCount - 10) / 4, -0.5, 1);
  const leafAmplitudeScale = clamp(1 + leafDensityPressure * 0.16, 0.9, 1.18);
  const preset = variantPreset(normalizedVariantId);
  const frontAmplitude = preset.amplitude * leafAmplitudeScale;
  const macroAssemblages = {};
  for (const id of MACRO_VARIATION_IDS) {
    const base = `${normalizedVariantId}:${seed}:leaf-${leafCount}:${id}`;
    const amplitude = preset.amplitude * leafAmplitudeScale;
    macroAssemblages[id] = {
      phaseShift: clamp(stableNoise(`${base}:phase`) * 0.2 * amplitude, -0.22, 0.22),
      bowDelta: clamp(stableNoise(`${base}:bow`) * 0.18 * amplitude, -0.2, 0.2),
      twistDelta: clamp(stableNoise(`${base}:twist-delta`) * 0.22 * amplitude, -0.24, 0.24),
      torsionGradient: clamp(stableNoise(`${base}:torsion-gradient`) * 0.18 * amplitude, -0.2, 0.2),
      surfaceRoll: clamp(stableNoise(`${base}:surface-roll`) * 0.16 * amplitude, -0.18, 0.18),
      phaseLag: clamp(stableNoise(`${base}:phase-lag`) * 0.12 * amplitude, -0.14, 0.14),
      territoryWidthScale: clamp(1 + stableNoise(`${base}:territory`) * 0.16 * amplitude, 0.84, 1.18),
      siblingOffsetScale: clamp(1 + stableNoise(`${base}:sibling`) * 0.14 * amplitude, 0.86, 1.16),
      apertureBiteDelta: clamp(stableNoise(`${base}:bite`) * 0.09 * amplitude, -0.1, 0.1),
      terminationFlavor: stableNoise(`${base}:termination`) > 0 ? 'socket-heavy-compatible' : 'rim-absorbed-compatible',
    };
  }
  return {
    schema: 'OrbShellVariationDescriptor',
    mode: ORB_SHELL_CONTROLLED_VARIATION_MODE,
    generationLaw: 'bounded-semantic-assay-not-free-randomization',
    variantId: normalizedVariantId,
    variationSeed: seed,
    variationLeafCount: leafCount,
    uiControlSource,
    leafDensityPressure,
    boundedParameterFamilies: [
      'macro phase',
      'macro bow',
      'macro torsion',
      'twist delta',
      'surface roll',
      'territory width',
      'bounded macro assemblage count',
      'child sibling offset',
      'boundary aperture bite',
      'lower cup depth',
      'crossing tuck phase',
      'owner dominance',
      'ui leaf-count density pressure',
      'compatible termination flavor',
    ],
    forbiddenVariationClasses: [
      'free-randomization',
      'unbounded-macro-count-randomization',
      'aperture-owner-removal',
      'global-braid-randomization',
      'core-material-randomization',
    ],
    preservedInvariants: [
      'PrimaryApertureFrame',
      'front-aperture-ownership',
      'two-anchor-macro-assay-families',
      'bounded-three-to-five-macro-count',
      'spherical-closure-anchors',
      'shaped-boundary-pressure-fields',
      'wrong-model-baseline-warning',
    ],
    effectiveParameters: {
      macroAssemblages,
      frontApertureOwnership: {
        lowerCupDepth: clamp(1 + preset.cupBias + stableNoise(`${normalizedVariantId}:${seed}:leaf-${leafCount}:lower-cup`) * 0.12 * frontAmplitude, 0.82, 1.26),
        crossingTuckPhase: clamp(preset.tuckBias + stableNoise(`${normalizedVariantId}:${seed}:leaf-${leafCount}:crossing-tuck`) * 0.18 * frontAmplitude, -0.24, 0.26),
        ownerDominance: clamp(1 + preset.dominanceBias + stableNoise(`${normalizedVariantId}:${seed}:leaf-${leafCount}:owner-dominance`) * 0.1 * frontAmplitude, 0.84, 1.28),
        apertureBite: clamp(1 + stableNoise(`${normalizedVariantId}:${seed}:leaf-${leafCount}:aperture-bite`) * 0.12 * frontAmplitude, 0.84, 1.18),
      },
    },
  };
}

function band(id, parent, role, offset, width, layerIntervals, startType, endType) {
  return {
    schema: 'BandMember',
    id,
    parentAssemblage: parent,
    role,
    siblingOffset: offset,
    widthProfile: { root: width * 0.72, mid: width, tip: width * 0.58 },
    thicknessProfile: { root: 0.026, mid: 0.038, tip: 0.024 },
    proceduralFamily: role === 'hopping-member'
      ? 'offset-tributary-band-family-with-local-layer-hop'
      : 'offset-tributary-band-family',
    layerIntervals,
    splitMergeEvents: [
      { t: 0.24, type: 'sibling-separation', trigger: 'aperture-pressure' },
      { t: 0.78, type: 'terminal-reconvergence', trigger: 'termination-pressure' },
    ],
    startTermination: {
      schema: 'TerminationSocket',
      type: startType,
      proceduralFamily: 'termination-pressure',
      generatedBy: ['crown-lock', 'neighbor-dominance', 'sphere-closure'],
    },
    endTermination: {
      schema: 'TerminationSocket',
      type: endType,
      proceduralFamily: 'termination-pressure',
      generatedBy: ['socket-cap', 'rim-absorption', 'amber-seam-exposure'],
    },
    surfaceDetailHooks: ['bevel-tier-major', 'inset-panel-breaks', 'subordinate-amber-edge-glints'],
  };
}

function makeBoundaryPressureField(id, role, options = {}) {
  return {
    schema: 'BoundaryPressureField',
    id: `${id}-boundary-pressure`,
    proceduralFamilies: [
      'pressure-field-boundary',
      'trimmed-spherical-section',
      'aperture-repulsor-boundary-field',
      'offset-impulse-line-envelope',
    ],
    pressures: [
      { type: 'aperture-bite', side: options.apertureSide || 'inner', t: 0.48, radius: 0.22, strength: options.apertureStrength ?? 0.34 },
      { type: 'sibling-band-channel', side: 'both', t: 0.32, radius: 0.16, strength: 0.16 },
      { type: 'sibling-band-channel', side: 'both', t: 0.72, radius: 0.18, strength: 0.14 },
      { type: 'neighbor-tuck-clearance', side: options.tuckSide || 'outer', t: 0.58, radius: 0.2, strength: 0.2 },
      { type: 'closure-taper', side: 'both', t: 0.03, radius: 0.18, strength: 0.32 },
      { type: 'closure-taper', side: 'both', t: 0.97, radius: 0.18, strength: 0.32 },
      { type: 'silhouette-relief', side: options.reliefSide || 'outer', t: 0.2, radius: 0.12, strength: 0.14 },
      { type: 'silhouette-relief', side: options.reliefSide || 'outer', t: 0.84, radius: 0.12, strength: 0.12 },
    ],
    petalMaskFailurePressure: 'trim-wide-panels-into-forged-whorl-boundaries',
    role,
  };
}

function makeBoundaryCutProfile(field) {
  const samples = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    let leftScale = 1;
    let rightScale = 1;
    for (const pressure of field.pressures) {
      const influence = pressure.strength * Math.exp(-Math.pow((t - pressure.t) / pressure.radius, 2));
      if (pressure.side === 'left' || pressure.side === 'inner') leftScale -= influence;
      else if (pressure.side === 'right' || pressure.side === 'outer') rightScale -= influence;
      else {
        leftScale -= influence;
        rightScale -= influence;
      }
    }
    samples.push({
      t,
      leftScale: Math.max(0.38, leftScale),
      rightScale: Math.max(0.38, rightScale),
    });
  }
  return samples;
}

function territoryBody(id, role, territory, childBands, options = {}) {
  const primaryWidth = Math.max(...childBands.map(child => child.widthProfile.mid));
  const midWidth = Math.max(primaryWidth * 1.72, territory.lonWidth * (options.widthFactor || 0.22));
  const boundaryPressureField = makeBoundaryPressureField(id, role, options);
  return {
    schema: 'MacroTerritoryBody',
    id: `${id}-territory-body`,
    parentAssemblage: id,
    role,
    proceduralFamily: 'offset-impulse-line-envelope',
    boundaryHypotheses: [
      'swept-voronoi-territory',
      'pressure-field-boundary',
      'spherical-section-panel',
    ],
    widthProfile: {
      root: midWidth * 0.68,
      mid: midWidth,
      tip: midWidth * 0.72,
    },
    thicknessProfile: {
      root: 0.022,
      mid: 0.034,
      tip: 0.022,
    },
    occupancyMode: 'area-bearing-spherical-ribbon',
    closureAnchorIds: options.closureAnchorIds || ['crown-closure-anchor', 'lower-socket-anchor'],
    uShapedCageFailurePressure: 'body-occupancy-must-close-sphere-not-only-draw-open-arcs',
    petalMaskFailurePressure: 'boundary-shaping-must-prevent-broad-dark-panel-masks',
    boundaryPressureField,
    boundaryCutProfile: makeBoundaryCutProfile(boundaryPressureField),
  };
}

function macro(id, role, dominance, phase, handedness, territory, childBands, options = {}) {
  return {
    schema: 'MacroAssemblage',
    id,
    role,
    dominance,
    handedness,
    sphericalTerritory: {
      schema: 'MacroTerritory',
      centerPhase: phase,
      latRange: territory.latRange,
      lonWidth: territory.lonWidth,
      boundaryHypothesis: {
        proceduralFamily: 'swept-voronoi-territory',
        generatedBy: ['offset-impulse-line', 'neighbor-pressure-field', 'aperture-pressure'],
      },
    },
    spine: {
      proceduralFamily: options.spineFamily || 'biased-spherical-vector-field',
      impulseLine: options.impulseLine || 'great-circle-perturbed-by-aperture-repulsors',
      control: options.control,
      variationParameters: ['phase', 'handedness', 'bow', 'territoryWidth', 'entryExitLatitude'],
    },
    entryZone: options.entryZone || 'upper-crown-offset',
    exitZone: options.exitZone || 'lower-crown-opposite',
    childBandPlan: childBands,
    territoryBodyOccupancy: territoryBody(id, role, territory, childBands, options),
    layerItinerary: {
      schema: 'LayerDepthSchedule',
      proceduralFamily: 'local-layer-event-schedule',
      intervals: options.intervals || [
        { t0: 0, t1: 0.42, layer: 'outer', trigger: 'macro-dominance' },
        { t0: 0.42, t1: 0.58, layer: 'under-neighbor', trigger: 'neighbor-dominance' },
        { t0: 0.58, t1: 1, layer: 'outer', trigger: 're-emergence-after-aperture' },
      ],
      noGlobalBraidScheduler: true,
    },
    terminationPlan: {
      schema: 'TerminationSocketGraph',
      proceduralFamily: 'termination-pressure',
      start: childBands.map(child => ({ bandId: child.id, ...child.startTermination })),
      end: childBands.map(child => ({ bandId: child.id, ...child.endTermination })),
      coherencePressure: ['mutual-crown-lock', 'neighbor-tuck-clearance', 'sphere-closure'],
    },
    neighborRelations: options.neighborRelations || [],
    inverseProceduralHypotheses: {
      impulse: options.spineFamily || 'biased-spherical-vector-field',
      territory: 'swept-voronoi-territory',
      bands: 'offset-tributary-band-family',
      layers: 'local-layer-event-schedule',
      terminations: 'termination-pressure',
    },
  };
}

function createMacroAssemblageCountLaw(descriptor, candidates) {
  const candidateIds = candidates.map(candidate => candidate.id);
  const anchorMacroAssemblageIds = REQUIRED_MACRO_ASSEMBLAGE_IDS.filter(id => candidateIds.includes(id));
  const optionalMacroCandidateIds = OPTIONAL_MACRO_ASSEMBLAGE_IDS.filter(id => candidateIds.includes(id));
  const densityPressure = descriptor.leafDensityPressure || 0;
  const countScore = stableNoise(`${descriptor.variantId}:${descriptor.variationSeed}:leaf-${descriptor.variationLeafCount}:macro-law-count`)
    + densityPressure * 0.45;
  const optionalTargetCount = countScore < -0.28
    ? 1
    : countScore > 0.34
      ? 3
      : 2;
  const bias = {
    'equatorial-cupping-whorl': 0.8,
    'polar-crown-lock': 1.2,
    'lower-socket-keel': -0.05,
  };
  const optionalScores = optionalMacroCandidateIds
    .map(id => ({
      id,
      score: stableNoise(`${descriptor.variantId}:${descriptor.variationSeed}:leaf-${descriptor.variationLeafCount}:${id}:macro-option`)
        + densityPressure * 0.22
        + (bias[id] || 0),
    }))
    .sort((a, b) => b.score - a.score);
  const selectedOptionalIds = optionalScores
    .slice(0, clamp(optionalTargetCount, 1, optionalMacroCandidateIds.length))
    .map(item => item.id);
  const selectedSet = new Set([...anchorMacroAssemblageIds, ...selectedOptionalIds]);
  const selectedMacroAssemblageIds = candidateIds.filter(id => selectedSet.has(id));
  return {
    schema: 'MacroAssemblageCountLaw',
    mode: 'anchor-preserving-bounded-macro-thrust-count-v0',
    generationLaw: 'two-required-aperture-anchors-plus-ranked-optional-support-thrusts',
    variantId: descriptor.variantId,
    variationSeed: descriptor.variationSeed,
    variationLeafCount: descriptor.variationLeafCount,
    countScore,
    leafDensityPressure: densityPressure,
    minMacroAssemblageCount: REQUIRED_MACRO_ASSEMBLAGE_IDS.length + 1,
    maxMacroAssemblageCount: REQUIRED_MACRO_ASSEMBLAGE_IDS.length + OPTIONAL_MACRO_ASSEMBLAGE_IDS.length,
    requestedOptionalMacroCount: optionalTargetCount,
    anchorMacroAssemblageIds,
    optionalMacroCandidateIds,
    optionalMacroScores: optionalScores,
    selectedOptionalMacroIds: selectedOptionalIds,
    selectedMacroAssemblageIds,
    retiredMacroAssemblageIds: candidateIds.filter(id => !selectedSet.has(id)),
    requiredAnchorGuarantee: 'north-west and north-east aperture/counter-thrust families always survive count variation',
    nonGoals: [
      'no-free-random-macro-soup',
      'no-removal-of-primary-aperture-anchors',
      'no-global-retopology-yet',
    ],
  };
}

function createMacroInterlockGraph(composition) {
  const selectedIds = new Set(composition.macroAssemblages.map(assemblage => assemblage.id));
  const candidateRelations = [
    {
      schema: 'MacroInterlockRelation',
      id: 'lower-socket-keel-under-equatorial-cupping-whorl',
      sourceMacroId: 'lower-socket-keel',
      targetMacroId: 'equatorial-cupping-whorl',
      relationType: 'socket-tuck-under',
      precedence: 'target-claims-local-surface-over-source',
      interval: { t0: 0.04, t1: 0.62, fade: 0.12 },
      depthInset: 0.096,
      widthScale: 0.62,
      normalLiftDelta: -0.024,
      topologyRelief: 1,
      visualIntent: 'lower socket support ducks under the equatorial lower cup instead of occupying the same lower-left region as an adjacent slab',
      nonGoal: 'not a boolean union or solved collision pass',
    },
  ];
  const activeRelations = candidateRelations.filter(relation => (
    selectedIds.has(relation.sourceMacroId) && selectedIds.has(relation.targetMacroId)
  ));
  const retiredRelations = candidateRelations.filter(relation => !activeRelations.includes(relation)).map(relation => ({
    id: relation.id,
    sourceMacroId: relation.sourceMacroId,
    targetMacroId: relation.targetMacroId,
    relationType: relation.relationType,
    retiredReason: selectedIds.has(relation.sourceMacroId)
      ? 'target-macro-not-selected'
      : selectedIds.has(relation.targetMacroId)
        ? 'source-macro-not-selected'
        : 'source-and-target-not-selected',
  }));
  const interlockAffectedMacroIds = [...new Set(activeRelations.map(relation => relation.sourceMacroId))];
  return {
    schema: 'MacroInterlockGraph',
    mode: 'selected-macro-precedence-and-local-tuck-v0',
    generationLaw: 'selected macro families negotiate local precedence before final mesh fusion',
    sourceMacroAssemblageCountLaw: composition.macroAssemblageCountLaw?.schema,
    selectedMacroAssemblageIds: [...selectedIds],
    activeRelations,
    retiredRelations,
    activeRelationCount: activeRelations.length,
    visibleEffectCount: activeRelations.length,
    interlockAffectedMacroIds,
    firstSliceScope: 'lower-socket-keel-under-equatorial-cup-only',
    failurePressure: [
      'adjacent-macro-bodies-without-precedence',
      'count-variation-as-crowding',
      'tuck-label-without-visible-depth-change',
    ],
    nonGoals: [
      'do-not-solve-global-collision',
      'do-not-introduce-braid-scheduler',
      'do-not-retire-anchor-families',
    ],
  };
}

function attachMacroInterlockEffects(composition) {
  const graph = composition.macroInterlockGraph;
  for (const assemblage of composition.macroAssemblages) {
    assemblage.macroInterlockEffects = (graph?.activeRelations || [])
      .filter(relation => relation.sourceMacroId === assemblage.id)
      .map(relation => ({
        schema: 'MacroInterlockGeometryEffect',
        id: `${relation.id}-geometry-effect`,
        relationId: relation.id,
        relationType: relation.relationType,
        sourceMacroId: relation.sourceMacroId,
        targetMacroId: relation.targetMacroId,
        interval: relation.interval,
        depthInset: relation.depthInset,
        widthScale: relation.widthScale,
        normalLiftDelta: relation.normalLiftDelta,
        topologyRelief: relation.topologyRelief,
        visualContract: 'source macro centerline and width visibly tuck through the relation interval',
      }));
  }
}

function macroInterlockIntervalInfluence(effect, t) {
  const interval = effect.interval || { t0: 0, t1: 1, fade: 0.08 };
  if (t < interval.t0 || t > interval.t1) return 0;
  const fade = interval.fade ?? 0.08;
  const inWeight = smoothStep(interval.t0, Math.min(interval.t1, interval.t0 + fade), t);
  const outWeight = 1 - smoothStep(Math.max(interval.t0, interval.t1 - fade), interval.t1, t);
  return clamp(inWeight * outWeight, 0, 1);
}

function macroInterlockEffectAt(assemblage, t) {
  const activeEffects = (assemblage.macroInterlockEffects || [])
    .map(effect => ({ effect, influence: macroInterlockIntervalInfluence(effect, t) }))
    .filter(item => item.influence > 0);
  if (!activeEffects.length) {
    return {
      depthInset: 0,
      widthScale: 1,
      normalLiftDelta: 0,
      topologyRelief: 0,
      activeEffectIds: [],
    };
  }
  return activeEffects.reduce((total, item) => {
    const { effect, influence } = item;
    return {
      depthInset: total.depthInset + (effect.depthInset || 0) * influence,
      widthScale: Math.min(total.widthScale, 1 - (1 - (effect.widthScale ?? 1)) * influence),
      normalLiftDelta: total.normalLiftDelta + (effect.normalLiftDelta || 0) * influence,
      topologyRelief: Math.max(total.topologyRelief, (effect.topologyRelief || 0) * influence),
      activeEffectIds: [...total.activeEffectIds, effect.id],
    };
  }, {
    depthInset: 0,
    widthScale: 1,
    normalLiftDelta: 0,
    topologyRelief: 0,
    activeEffectIds: [],
  });
}

function createLowerSocketEquatorialSocketJointLaw(composition) {
  const lowerSocket = composition.macroAssemblages.find(assemblage => assemblage.id === 'lower-socket-keel');
  const equatorial = composition.macroAssemblages.find(assemblage => assemblage.id === 'equatorial-cupping-whorl');
  if (!lowerSocket || !equatorial) return null;

  const sourceT0 = 0.1;
  const sourceT1 = 0.6;
  const targetT0 = 0.76;
  const targetT1 = 0.46;
  const samples = [];
  for (let index = 0; index < 9; index++) {
    const u = index / 8;
    const sourceT = sourceT0 + (sourceT1 - sourceT0) * u;
    const targetT = targetT0 + (targetT1 - targetT0) * u;
    const sourcePoint = sampleSpinePoint(lowerSocket, {
      siblingOffset: 0,
      layerIntervals: lowerSocket.layerItinerary.intervals,
    }, sourceT, 1.048);
    const targetPoint = sampleSpinePoint(equatorial, {
      siblingOffset: 0,
      layerIntervals: equatorial.layerItinerary.intervals,
    }, targetT, 1.052);
    const seamPoint = scaledNormalizedPoint(lerpPoint(sourcePoint, targetPoint, 0.58), 1.072);
    samples.push({
      schema: 'SharedSocketSeamSample',
      id: `lower-equatorial-socket-seam-s${index}`,
      u,
      sourceT,
      targetT,
      sourcePoint,
      targetPoint,
      seamPoint,
      normal: normalizePoint(seamPoint),
      sourceDistance: pointDistance(sourcePoint, seamPoint),
      targetDistance: pointDistance(targetPoint, seamPoint),
    });
  }

  const distances = samples.flatMap(sample => [
    { t: sample.u, distance: sample.sourceDistance },
    { t: sample.u, distance: sample.targetDistance },
  ]);
  return {
    schema: 'LowerSocketEquatorialSocketJointLaw',
    id: 'lower-socket-equatorial-shared-socket-joint',
    mode: 'shared-seam-tuck-lip-joint-v0',
    relationship: 'lower-socket-tucks-under-equatorial-lip',
    sourceMacroId: 'lower-socket-keel',
    targetMacroId: 'equatorial-cupping-whorl',
    generationLaw: 'lower socket and equatorial cup derive local termination, tuck, lip, and clearance from one shared seam before contact-map judgment',
    sourceBehavior: [
      'terminate-into-shared-seam',
      'tuck-under-target-lip',
      'narrow-before-seam',
      'sink-radially-at-seam',
    ],
    targetBehavior: [
      'grow-equatorial-lip-over-seam',
      'own-visible-surface-precedence',
      'lift-cap-edge-over-source',
      'reserve-socket-clearance-band',
    ],
    sharedSeam: {
      schema: 'SharedSocketSeam',
      id: 'lower-equatorial-socket-seam',
      proceduralFamily: 'paired-macro-contact-seam-from-source-target-spines',
      samples,
      sampleCount: samples.length,
      sourceInterval: { t0: sourceT0, t1: sourceT1 },
      targetInterval: { t0: targetT1, t1: targetT0 },
      distanceStats: summarizeDistances(distances),
    },
    gapPolicy: {
      schema: 'SharedSocketGapPolicy',
      mode: 'constant-ish-seam-clearance',
      targetClearance: 0.054,
      maxRelativeGapVariation: 0.72,
      failurePressure: 'visible-overlap-without-owned-shared-seam',
    },
    sourceEffect: {
      role: 'tucking-source',
      interval: { t0: sourceT0, t1: sourceT1 + 0.1, fade: 0.12 },
      widthScale: 0.62,
      radialDelta: -0.066,
      normalLiftDelta: -0.028,
      seamPull: 0.04,
      topologyRelief: 1,
    },
    targetEffect: {
      role: 'lip-owning-target',
      interval: { t0: targetT1 - 0.08, t1: targetT0 + 0.06, fade: 0.12 },
      widthScale: 1.08,
      radialDelta: 0.025,
      normalLiftDelta: 0.024,
      seamPull: 0.02,
      topologyRelief: 0.62,
    },
    visualContract: 'mixed view should show lower socket entering a target-owned lip/socket seam rather than ending as a free appendage',
    nonGoals: [
      'not-global-collision-solving',
      'not-final-boolean-union',
      'not-independent-lower-socket-prettification',
    ],
  };
}

function attachLowerSocketEquatorialSocketJointEffects(composition) {
  const law = composition.lowerSocketEquatorialSocketJointLaw;
  for (const assemblage of composition.macroAssemblages) assemblage.sharedSocketSeamEffects = [];
  if (!law) return;
  const source = composition.macroAssemblages.find(assemblage => assemblage.id === law.sourceMacroId);
  const target = composition.macroAssemblages.find(assemblage => assemblage.id === law.targetMacroId);
  if (source) {
    source.sharedSocketSeamEffects.push({
      schema: 'SharedSocketSeamGeometryEffect',
      id: `${law.id}-source-effect`,
      jointLawId: law.id,
      sourceMacroId: law.sourceMacroId,
      targetMacroId: law.targetMacroId,
      relationship: law.relationship,
      role: law.sourceEffect.role,
      interval: law.sourceEffect.interval,
      widthScale: law.sourceEffect.widthScale,
      radialDelta: law.sourceEffect.radialDelta,
      normalLiftDelta: law.sourceEffect.normalLiftDelta,
      seamPull: law.sourceEffect.seamPull,
      topologyRelief: law.sourceEffect.topologyRelief,
      visualContract: 'source lower socket tucks into the shared seam and stops reading as a dangling appendage',
    });
  }
  if (target) {
    target.sharedSocketSeamEffects.push({
      schema: 'SharedSocketSeamGeometryEffect',
      id: `${law.id}-target-effect`,
      jointLawId: law.id,
      sourceMacroId: law.sourceMacroId,
      targetMacroId: law.targetMacroId,
      relationship: law.relationship,
      role: law.targetEffect.role,
      interval: law.targetEffect.interval,
      widthScale: law.targetEffect.widthScale,
      radialDelta: law.targetEffect.radialDelta,
      normalLiftDelta: law.targetEffect.normalLiftDelta,
      seamPull: law.targetEffect.seamPull,
      topologyRelief: law.targetEffect.topologyRelief,
      visualContract: 'target equatorial cup grows the visible lip/ownership side of the same seam',
    });
  }
}

function sharedSocketSeamIntervalInfluence(effect, t) {
  return macroInterlockIntervalInfluence(effect, t);
}

function sharedSocketSeamEffectAt(assemblage, t) {
  const activeEffects = (assemblage.sharedSocketSeamEffects || [])
    .map(effect => ({ effect, influence: sharedSocketSeamIntervalInfluence(effect, t) }))
    .filter(item => item.influence > 0);
  if (!activeEffects.length) {
    return {
      widthScale: 1,
      radialDelta: 0,
      normalLiftDelta: 0,
      seamPull: 0,
      topologyRelief: 0,
      activeEffectIds: [],
      active: false,
    };
  }
  return activeEffects.reduce((total, item) => {
    const { effect, influence } = item;
    return {
      widthScale: Math.min(total.widthScale, 1 - (1 - (effect.widthScale ?? 1)) * influence),
      radialDelta: total.radialDelta + (effect.radialDelta || 0) * influence,
      normalLiftDelta: total.normalLiftDelta + (effect.normalLiftDelta || 0) * influence,
      seamPull: total.seamPull + (effect.seamPull || 0) * influence,
      topologyRelief: Math.max(total.topologyRelief, (effect.topologyRelief || 0) * influence),
      activeEffectIds: [...total.activeEffectIds, effect.id],
      active: true,
    };
  }, {
    widthScale: 1,
    radialDelta: 0,
    normalLiftDelta: 0,
    seamPull: 0,
    topologyRelief: 0,
    activeEffectIds: [],
    active: true,
  });
}

function createLowerSocketFamilyRoleLaw(composition) {
  const lowerSocket = composition.macroAssemblages.find(assemblage => assemblage.id === 'lower-socket-keel');
  if (!lowerSocket) return null;
  const sharedSocketLaw = composition.lowerSocketEquatorialSocketJointLaw;
  const hasEquatorialSocket = !!sharedSocketLaw
    && sharedSocketLaw.sourceMacroId === 'lower-socket-keel'
    && sharedSocketLaw.targetMacroId === 'equatorial-cupping-whorl';
  return {
    schema: 'LowerSocketFamilyRoleLaw',
    id: 'lower-socket-family-role-law',
    mode: 'lower-socket-family-role-classifier-v0',
    targetMacroId: 'lower-socket-keel',
    selectedRole: hasEquatorialSocket ? 'tuck-tongue' : 'absorbed',
    visibleAuthority: hasEquatorialSocket ? 'subordinate-socket-insert' : 'absorbed-seam-influence',
    generationLaw: 'lower-socket-derived optional families must classify before meshing; no short visible macro foot survives without a socket/tuck role',
    roleEvidence: {
      schema: 'LowerSocketFamilyRoleEvidence',
      sourceAnatomyLawId: composition.lowerSocketKeelAnatomyLaw?.sourceMacroId || null,
      sharedSocketJointLawId: sharedSocketLaw?.id || null,
      macroCountContext: composition.macroAssemblageCountLaw?.selectedMacroAssemblageIds?.length || composition.macroAssemblages.length,
      familySizeClass: 'short-subordinate-lower-socket-family',
      observedFailurePressure: 'crimped-short-visible-foot-under-left-lower-socket',
    },
    familyRoleDecision: {
      schema: 'LowerSocketFamilyRoleDecision',
      role: hasEquatorialSocket ? 'tuck-tongue' : 'absorbed',
      authority: hasEquatorialSocket ? 'subordinate-socket-insert' : 'hidden-seam-pressure',
      targetMacroId: hasEquatorialSocket ? 'equatorial-cupping-whorl' : null,
      terminalAbsorbStartT: hasEquatorialSocket ? 0.32 : 0.28,
      terminalHoldT: hasEquatorialSocket ? 0.38 : 0.34,
      allowedVisibleIf: [
        'smooth-single-direction-socket-taper',
        'terminates-into-shared-socket-seam',
        'passes-under-equatorial-lip',
      ],
      demoteIf: [
        'cannot-find-shared-socket-target',
        'would-render-as-short-macro-pretender',
      ],
    },
    geometryEffect: {
      schema: 'LowerSocketFamilyRoleGeometryEffect',
      id: 'lower-socket-family-role-tuck-tongue-effect',
      role: hasEquatorialSocket ? 'tuck-tongue' : 'absorbed',
      interval: { t0: 0.04, t1: 1, fade: 0.14 },
      widthScale: hasEquatorialSocket ? 0.48 : 0.18,
      terminalAbsorbStartT: hasEquatorialSocket ? 0.32 : 0.28,
      terminalWidthScale: hasEquatorialSocket ? 0.04 : 0.025,
      terminalRadialDelta: hasEquatorialSocket ? -0.132 : -0.15,
      terminalNormalLiftDelta: hasEquatorialSocket ? -0.064 : -0.08,
      radialDelta: hasEquatorialSocket ? -0.052 : -0.09,
      normalLiftDelta: hasEquatorialSocket ? -0.026 : -0.046,
      socketAlignmentPull: hasEquatorialSocket ? 0.86 : 0.42,
      maxLateralWander: hasEquatorialSocket ? 0.06 : 0.035,
      topologyRelief: hasEquatorialSocket ? 0.72 : 1,
      geometryContract: 'smooth-single-direction-socket-taper',
    },
    tuckTongueRefinement: {
      schema: 'LowerSocketTuckTongueRefinementContract',
      mode: 'post-smoke-terminal-absorption-v0',
      visibleArcLimitT: hasEquatorialSocket ? 0.36 : 0.3,
      maxLateralWander: hasEquatorialSocket ? 0.06 : 0.035,
      terminalBehavior: 'persist-terminal-absorption-through-mesh-end',
      terminalCapAuthority: hasEquatorialSocket
        ? 'hidden-under-shared-socket-seam'
        : 'absorbed-no-visible-terminal-cap',
      socketAlignment: hasEquatorialSocket
        ? 'pull-terminal-rows-under-equatorial-lip'
        : 'absorb-terminal-rows-into-seam-pressure',
      forbiddenPostSmokeRead: [
        'bent-independent-appendage',
        'dangling-side-limb',
        'terminal-width-recovers-after-tuck',
      ],
    },
    promotedBodyPolicy: {
      schema: 'LowerSocketFamilyRolePromotedBodyPolicy',
      promotedBodyScale: hasEquatorialSocket ? 0.52 : 0.3,
      sideSilhouetteMode: 'lower-socket-tuck-tongue-smooth-side-return-v0',
      materialAuthority: 'subordinate-to-equatorial-lip',
    },
    requiredRelations: hasEquatorialSocket
      ? ['lower-socket-tucks-under-equatorial-lip', 'terminate-into-shared-seam']
      : ['absorb-into-lower-socket-seam-pressure'],
    forbiddenFailureClasses: [
      'crimped-independent-foot',
      'short-macro-pretender',
      'multi-kink-terminal-stump',
      'floating-support-appendage',
    ],
    verdict: hasEquatorialSocket
      ? 'tuck-tongue-role-law-applied'
      : 'lower-socket-family-absorbed-no-visible-macro-authority',
    nonGoals: [
      'not-editorial-one-off-shape-smoothing',
      'not-full-collision-solving',
      'not-final-orbit-tangent-continuation',
    ],
  };
}

function attachLowerSocketFamilyRoleLaw(composition) {
  const law = composition.lowerSocketFamilyRoleLaw;
  for (const assemblage of composition.macroAssemblages) assemblage.lowerSocketFamilyRoleEffects = [];
  if (!law) return;
  const lowerSocket = composition.macroAssemblages.find(assemblage => assemblage.id === law.targetMacroId);
  if (!lowerSocket) return;
  lowerSocket.lowerSocketFamilyRoleLaw = law;
  lowerSocket.lowerSocketFamilyRoleEffects.push({
    ...law.geometryEffect,
    familyRoleLawId: law.id,
    sourceMacroId: law.targetMacroId,
    targetMacroId: law.familyRoleDecision.targetMacroId,
    visualContract: 'lower socket appears as subordinate smooth tuck tongue, not a crimped independent foot',
  });
  if (lowerSocket.macroPromotedBody) {
    lowerSocket.macroPromotedBody.lowerSocketFamilyRoleLaw = law;
    lowerSocket.macroPromotedBody.familyRoleDecision = law.familyRoleDecision;
    lowerSocket.macroPromotedBody.visibleAuthority = law.visibleAuthority;
    lowerSocket.macroPromotedBody.promotedBodyScale = Math.min(
      lowerSocket.macroPromotedBody.promotedBodyScale || law.promotedBodyPolicy.promotedBodyScale,
      law.promotedBodyPolicy.promotedBodyScale,
    );
    lowerSocket.macroPromotedBody.sideSilhouettePolicy = {
      ...lowerSocket.macroPromotedBody.sideSilhouettePolicy,
      mode: law.promotedBodyPolicy.sideSilhouetteMode,
      terminalWidthScale: Math.min(
        lowerSocket.macroPromotedBody.sideSilhouettePolicy?.terminalWidthScale ?? law.geometryEffect.terminalWidthScale,
        law.geometryEffect.terminalWidthScale,
      ),
      visibleArcLimitT: law.tuckTongueRefinement?.visibleArcLimitT,
      maxLateralWander: law.tuckTongueRefinement?.maxLateralWander,
      terminalBehavior: law.tuckTongueRefinement?.terminalBehavior,
      reason: 'lower socket has been classified as subordinate tuck tongue before visible macro meshing',
    };
  }
}

function lowerSocketFamilyRoleEffectAt(assemblage, t) {
  const activeEffects = (assemblage.lowerSocketFamilyRoleEffects || [])
    .map(effect => ({ effect, influence: macroInterlockIntervalInfluence(effect, t), t }))
    .filter(item => item.influence > 0);
  if (!activeEffects.length) {
    return {
      widthScale: 1,
      radialDelta: 0,
      normalLiftDelta: 0,
      socketAlignmentPull: 0,
      maxLateralWander: Number.POSITIVE_INFINITY,
      terminalAbsorption: 0,
      topologyRelief: 0,
      activeEffectIds: [],
      active: false,
    };
  }
  return activeEffects.reduce((total, item) => {
    const { effect, influence } = item;
    const terminalAbsorption = smoothStep(effect.terminalAbsorbStartT ?? 1, 1, item.t ?? 0);
    const widthTarget = (effect.widthScale ?? 1)
      + ((effect.terminalWidthScale ?? effect.widthScale ?? 1) - (effect.widthScale ?? 1)) * terminalAbsorption;
    const radialTarget = (effect.radialDelta || 0)
      + ((effect.terminalRadialDelta ?? effect.radialDelta ?? 0) - (effect.radialDelta || 0)) * terminalAbsorption;
    const liftTarget = (effect.normalLiftDelta || 0)
      + ((effect.terminalNormalLiftDelta ?? effect.normalLiftDelta ?? 0) - (effect.normalLiftDelta || 0)) * terminalAbsorption;
    return {
      widthScale: Math.min(total.widthScale, 1 - (1 - widthTarget) * influence),
      radialDelta: total.radialDelta + radialTarget * influence,
      normalLiftDelta: total.normalLiftDelta + liftTarget * influence,
      socketAlignmentPull: Math.max(total.socketAlignmentPull, (effect.socketAlignmentPull || 0) * influence),
      maxLateralWander: Math.min(total.maxLateralWander, effect.maxLateralWander ?? Number.POSITIVE_INFINITY),
      terminalAbsorption: Math.max(total.terminalAbsorption, terminalAbsorption * influence),
      topologyRelief: Math.max(total.topologyRelief, (effect.topologyRelief || 0) * influence),
      activeEffectIds: [...total.activeEffectIds, effect.id],
      active: true,
    };
  }, {
    widthScale: 1,
    radialDelta: 0,
    normalLiftDelta: 0,
    socketAlignmentPull: 0,
    maxLateralWander: Number.POSITIVE_INFINITY,
    terminalAbsorption: 0,
    topologyRelief: 0,
    activeEffectIds: [],
    active: true,
  });
}

function createLowerSocketStripHonestyLaw(composition) {
  const lowerSocket = composition.macroAssemblages.find(assemblage => assemblage.id === 'lower-socket-keel');
  const roleLaw = composition.lowerSocketFamilyRoleLaw;
  if (!lowerSocket || roleLaw?.selectedRole !== 'tuck-tongue') return null;
  return {
    schema: 'LowerSocketStripHonestyLaw',
    id: 'lower-socket-strip-honesty-law',
    mode: 'lower-socket-clean-strip-before-tuck-or-merge-v0',
    targetMacroId: 'lower-socket-keel',
    role: 'tuck-tongue',
    coherentStripClass: 'subordinate-tuck-lamella',
    generationLaw: 'lower socket must become one smooth lamellar strip before it may tuck under, merge with, or be covered by another form',
    rewrittenExitZone: 'lower-equatorial-shared-socket-seam',
    rewrittenTerminalTrigger: 'shared-socket-seam-absorption',
    forbiddenHybridSignals: [
      'right-rim-re-emergence',
      'lower-front-rim',
      'rim-absorption-end-for-tuck-role',
      'visible-rim-exit-while-subordinate-tuck',
    ],
    requiredInvariants: [
      'single-coherent-lower-socket-strip',
      'continuous-centerline-before-tuck',
      'smooth-side-curves-before-merge',
      'bounded-terminal-width-recovery',
      'no-visible-rim-exit-for-tuck-role',
    ],
    deferredSolves: [
      'boolean-or-trim-merge',
      'bottom-lip-ownership',
      'final-under-neighbor-occlusion',
    ],
    visualContract: 'normal render may show one smooth lower-socket strip, not a crumpled foot or visible-rim/tuck hybrid',
  };
}

function rewriteLowerSocketIntervalsForStripHonesty(intervals = [], law) {
  if (!law) return intervals;
  return intervals.map(interval => {
    let trigger = interval.trigger;
    if (trigger === 'right-rim-re-emergence') trigger = law.rewrittenTerminalTrigger;
    if (trigger === 'primary-aperture-underfold' || trigger === 'aperture-underfold') {
      trigger = 'lower-socket-clean-strip-continuity';
    }
    return {
      ...interval,
      layer: 'outer',
      trigger,
    };
  });
}

function attachLowerSocketStripHonestyLaw(composition) {
  const law = composition.lowerSocketStripHonestyLaw;
  if (!law) return;
  const lowerSocket = composition.macroAssemblages.find(assemblage => assemblage.id === law.targetMacroId);
  if (!lowerSocket) return;
  lowerSocket.lowerSocketStripHonestyLaw = law;
  lowerSocket.exitZone = law.rewrittenExitZone;
  if (lowerSocket.layerItinerary?.intervals) {
    lowerSocket.layerItinerary.intervals = rewriteLowerSocketIntervalsForStripHonesty(
      lowerSocket.layerItinerary.intervals,
      law,
    );
  }
  for (const member of lowerSocket.childBandPlan || []) {
    member.layerIntervals = rewriteLowerSocketIntervalsForStripHonesty(member.layerIntervals || [], law);
    if (member.role === 'body' && member.endTermination?.type === 'rim-absorption') {
      member.endTermination.type = 'shared-socket-seam-absorption';
      member.endTermination.proceduralFamily = 'shared-socket-seam-terminal-absorption';
      member.endTermination.generatedBy = [
        'LowerSocketStripHonestyLaw',
        'lower-equatorial-shared-socket-seam',
        'tuck-tongue-role-law',
      ];
    }
  }
  if (lowerSocket.macroPromotedBody) {
    lowerSocket.macroPromotedBody.lowerSocketStripHonestyLaw = law;
    lowerSocket.macroPromotedBody.exitZone = law.rewrittenExitZone;
    lowerSocket.macroPromotedBody.sideSilhouettePolicy = {
      ...lowerSocket.macroPromotedBody.sideSilhouettePolicy,
      stripHonestyLawId: law.id,
      stripHonestyMode: law.mode,
      stripHonestyContract: law.visualContract,
    };
  }
}

function createLowerSocketKeelAnatomyLaw(assemblage) {
  if (assemblage.id !== 'lower-socket-keel') return null;
  return {
    schema: 'LowerSocketKeelAnatomyLaw',
    mode: 'single-body-side-return-termination-v0',
    sourceMacroId: assemblage.id,
    generationLaw: 'optional lower support resolves into one lower socket body with subordinate side-return lip before interlock tuning',
    requiredAnatomy: [
      'single-lower-socket-body',
      'side-return-lip-as-subordinate-anatomy',
      'inner-underfold-as-surface-event-not-separate-slab',
      'named-terminal-cut-before-neighbor',
    ],
    forbiddenFailureClasses: [
      'chopped-proxy-foot',
      'multi-slab-side-return',
      'rectangular-terminal-extrusion',
      'floating-inner-fin',
    ],
    widthProfile: {
      midScale: 0.72,
      terminalWidthScale: 0.2,
      terminalTaperPower: 0.56,
    },
    radialProfile: {
      terminalInset: 0.028,
      underfoldInset: 0.018,
    },
    liftProfile: {
      terminalLiftDelta: -0.018,
      underfoldLiftDelta: -0.012,
    },
    terminationDecision: {
      schema: 'LowerSocketTerminationDecision',
      decisionClass: 'cut-before-neighbor-socket-cap',
      start: 'socket-cap',
      end: 'cut-before-neighbor',
      terminalCutStartT: 0.72,
      terminalHoldT: 0.84,
      forbiddenEndpoint: 'arbitrary-rectangular-foot',
      contactPressureInput: 'MacroContactMap',
      unresolvedInterlockPolicy: 'record-contact-pressure-without-extending-geometry-through-neighbor',
    },
    contactMapTrustPolicy: 'trust-after-lower-socket-anatomy-law',
  };
}

function lowerSocketAnatomyEffectAt(assemblage, t) {
  const law = assemblage.lowerSocketKeelAnatomyLaw || assemblage.macroPromotedBody?.lowerSocketKeelAnatomyLaw;
  if (!law) {
    return {
      widthScale: 1,
      radialInset: 0,
      normalLiftDelta: 0,
      active: false,
    };
  }
  const profile = Math.pow(Math.sin(Math.PI * clamp(t, 0, 1)), law.widthProfile.terminalTaperPower);
  const widthScale = law.widthProfile.terminalWidthScale
    + (law.widthProfile.midScale - law.widthProfile.terminalWidthScale) * profile;
  const terminalPressure = Math.max(
    1 - smoothStep(0.62, 1, profile),
    smoothStep(law.terminationDecision.terminalCutStartT, 1, t),
  );
  const underfoldPressure = Math.exp(-Math.pow((t - 0.46) / 0.18, 2));
  return {
    widthScale,
    radialInset: law.radialProfile.terminalInset * terminalPressure
      + law.radialProfile.underfoldInset * underfoldPressure,
    normalLiftDelta: law.liftProfile.terminalLiftDelta * terminalPressure
      + law.liftProfile.underfoldLiftDelta * underfoldPressure,
    active: true,
  };
}

function lowerSocketAnatomyParametricT(assemblage, t) {
  const law = assemblage.lowerSocketKeelAnatomyLaw || assemblage.macroPromotedBody?.lowerSocketKeelAnatomyLaw;
  if (!law) return t;
  const stripHonestyLaw = assemblage.lowerSocketStripHonestyLaw || assemblage.macroPromotedBody?.lowerSocketStripHonestyLaw;
  if (stripHonestyLaw?.role === 'tuck-tongue') {
    return t;
  }
  const roleDecision = assemblage.lowerSocketFamilyRoleLaw?.familyRoleDecision
    || assemblage.macroPromotedBody?.familyRoleDecision;
  const cutStart = Math.min(
    law.terminationDecision.terminalCutStartT ?? 0.72,
    roleDecision?.terminalAbsorbStartT ?? Number.POSITIVE_INFINITY,
  );
  const terminalHold = Math.min(
    law.terminationDecision.terminalHoldT ?? 0.84,
    roleDecision?.terminalHoldT ?? Number.POSITIVE_INFINITY,
  );
  if (t <= cutStart) return t;
  const collapse = smoothStep(cutStart, 1, t);
  return cutStart + (terminalHold - cutStart) * (1 - Math.pow(1 - collapse, 1.45));
}

function macroContactEnvelopeRadius(assemblage, t) {
  const body = assemblage.territoryBodyOccupancy || {};
  const promoted = assemblage.macroPromotedBody || {};
  const expanded = assemblage.expandedRegionProxy || {};
  const profile = Math.pow(Math.sin(Math.PI * t), 0.34);
  const terminalScale = 0.52 + 0.48 * profile;
  const interlock = macroInterlockEffectAt(assemblage, t);
  const lowerSocket = lowerSocketAnatomyEffectAt(assemblage, t);
  const sharedSeam = sharedSocketSeamEffectAt(assemblage, t);
  const roleEffect = lowerSocketFamilyRoleEffectAt(assemblage, t);
  const width = (body.widthProfile?.mid || 0.16)
    * (promoted.promotedBodyScale || 1.22)
    * (expanded.coverageScale || 1)
    * terminalScale
    * interlock.widthScale
    * lowerSocket.widthScale
    * sharedSeam.widthScale
    * roleEffect.widthScale;
  const thickness = body.thicknessProfile?.mid || 0.038;
  return width * 0.72 + thickness * 0.85;
}

function macroContactEnvelopeSample(assemblage, t) {
  const point = sampleSpinePoint(assemblage, {
    siblingOffset: 0,
    layerIntervals: assemblage.layerItinerary?.intervals || [{ t0: 0, t1: 1, layer: 'outer' }],
  }, t, 1.045);
  return {
    t,
    point,
    envelopeRadius: macroContactEnvelopeRadius(assemblage, t),
  };
}

function findMacroClosestApproach(source, target, sampleCount = 18) {
  const sourceSamples = [];
  const targetSamples = [];
  for (let index = 0; index < sampleCount; index++) {
    const t = 0.03 + (index / (sampleCount - 1)) * 0.94;
    sourceSamples.push(macroContactEnvelopeSample(source, t));
    targetSamples.push(macroContactEnvelopeSample(target, t));
  }
  let best = null;
  for (const sourceSample of sourceSamples) {
    for (const targetSample of targetSamples) {
      const distance = pointDistance(sourceSample.point, targetSample.point);
      if (!best || distance < best.distance) {
        best = {
          distance,
          sourceT: sourceSample.t,
          targetT: targetSample.t,
          sourcePoint: sourceSample.point,
          targetPoint: targetSample.point,
          sourceEnvelopeRadius: sourceSample.envelopeRadius,
          targetEnvelopeRadius: targetSample.envelopeRadius,
        };
      }
    }
  }
  return best;
}

function findMacroContactRelation(composition, sourceMacroId, targetMacroId) {
  return (composition.macroInterlockGraph?.activeRelations || []).find(relation => (
    [relation.sourceMacroId, relation.targetMacroId].includes(sourceMacroId)
    && [relation.sourceMacroId, relation.targetMacroId].includes(targetMacroId)
  )) || null;
}

function findLowerSocketEquatorialSocketJointLaw(composition, sourceMacroId, targetMacroId) {
  const law = composition.lowerSocketEquatorialSocketJointLaw;
  if (!law) return null;
  return [law.sourceMacroId, law.targetMacroId].includes(sourceMacroId)
    && [law.sourceMacroId, law.targetMacroId].includes(targetMacroId)
    ? law
    : null;
}

function macroContactDiagnosisTags(sourceMacroId, targetMacroId, relation, clearanceVerdict, sharedSocketJointLaw = null, lowerSocketFamilyRoleLaw = null) {
  const ids = [sourceMacroId, targetMacroId];
  const tags = [];
  if (relation) tags.push('known-interlock-relation');
  if (sharedSocketJointLaw) tags.push('shared-socket-seam-law');
  if (lowerSocketFamilyRoleLaw && ids.includes(lowerSocketFamilyRoleLaw.targetMacroId)) tags.push('tuck-tongue-role-law');
  if (ids.includes('north-east-counter-thrust') && (
    ids.includes('north-west-dominant-thrust')
    || ids.includes('polar-crown-lock')
    || ids.includes('equatorial-cupping-whorl')
  )) {
    tags.push('upper-stack-watch');
  }
  if (ids.includes('lower-socket-keel')) tags.push('lower-socket-watch');
  if (clearanceVerdict === 'intersecting') tags.push('clearance-failure-candidate');
  if (clearanceVerdict === 'near') tags.push('near-contact-candidate');
  return tags;
}

function createMacroGeometryCoherenceWatch(composition, contacts) {
  const selectedIds = new Set(composition.macroAssemblages.map(assemblage => assemblage.id));
  const lowerSocketLaw = composition.lowerSocketKeelAnatomyLaw;
  const lowerSocketRoleLaw = composition.lowerSocketFamilyRoleLaw;
  const optionalStressIds = ['lower-socket-keel', 'polar-crown-lock', 'equatorial-cupping-whorl']
    .filter(id => selectedIds.has(id));
  const watch = optionalStressIds.map(id => {
    const lowerSocketGoverned = id === 'lower-socket-keel' && lowerSocketLaw;
    const lowerSocketRoleGoverned = id === 'lower-socket-keel' && lowerSocketRoleLaw;
    return {
      schema: 'MacroGeometryCoherenceWatch',
      macroId: id,
      watchType: lowerSocketGoverned
        ? lowerSocketRoleGoverned
          ? 'lower-socket-tuck-tongue-role-contact-trust'
          : 'lower-socket-procedural-anatomy-contact-trust'
        : 'non-hero-optional-family-contact-trust',
      reason: lowerSocketGoverned
        ? lowerSocketRoleGoverned
          ? 'lower socket contact evidence is generated after classifying the short family as subordinate tuck tongue anatomy'
          : 'lower socket contact evidence is generated after applying a single-body termination/anatomy law'
        : 'optional stress macro has less mature surface/termination grammar than the hero aperture anchors',
      diagnosticPolicy: lowerSocketGoverned
        ? lowerSocketRoleGoverned
          ? 'trust-after-lower-socket-family-role-law'
          : lowerSocketLaw.contactMapTrustPolicy
        : 'contact-map-can-indict-input-geometry-before-interlock-tuning',
      roleLawId: lowerSocketRoleGoverned ? lowerSocketRoleLaw.id : null,
      selectedRole: lowerSocketRoleGoverned ? lowerSocketRoleLaw.selectedRole : null,
    };
  });
  const badContacts = contacts
    .filter(contact => contact.clearanceVerdict === 'intersecting')
    .slice(0, 3)
    .map(contact => ({
      schema: 'MacroGeometryCoherenceWatch',
      macroId: `${contact.sourceMacroId}<->${contact.targetMacroId}`,
      watchType: 'measured-clearance-failure',
      reason: 'closest envelope distance is inside the declared clearance radius',
      contactId: contact.id,
    }));
  return [...watch, ...badContacts];
}

function createMacroContactMap(composition) {
  const contacts = [];
  for (let sourceIndex = 0; sourceIndex < composition.macroAssemblages.length; sourceIndex++) {
    for (let targetIndex = sourceIndex + 1; targetIndex < composition.macroAssemblages.length; targetIndex++) {
      const source = composition.macroAssemblages[sourceIndex];
      const target = composition.macroAssemblages[targetIndex];
      const closestApproach = findMacroClosestApproach(source, target);
      const relation = findMacroContactRelation(composition, source.id, target.id);
      const sharedSocketJointLaw = findLowerSocketEquatorialSocketJointLaw(composition, source.id, target.id);
      const lowerSocketFamilyRoleLaw = [source.id, target.id].includes(composition.lowerSocketFamilyRoleLaw?.targetMacroId)
        ? composition.lowerSocketFamilyRoleLaw
        : null;
      const clearanceRadius = closestApproach
        ? closestApproach.sourceEnvelopeRadius + closestApproach.targetEnvelopeRadius + (sharedSocketJointLaw ? sharedSocketJointLaw.gapPolicy.targetClearance : relation ? 0.055 : 0.035)
        : 0;
      const clearanceSlack = closestApproach ? closestApproach.distance - clearanceRadius : null;
      const clearanceVerdict = !closestApproach
        ? 'unproven'
        : clearanceSlack < 0
          ? 'intersecting'
          : clearanceSlack < 0.075
            ? 'near'
            : 'clear';
      const contact = {
        schema: 'MacroContactSample',
        id: `${source.id}--${target.id}`,
        sourceMacroId: source.id,
        targetMacroId: target.id,
        closestApproach,
        clearanceRadius,
        clearanceSlack,
        clearanceVerdict,
        intendedPrecedenceRelationId: relation?.id || null,
        intendedPrecedence: relation?.precedence || null,
        sharedSocketJointLawId: sharedSocketJointLaw?.id || null,
        sharedSocketSeamId: sharedSocketJointLaw?.sharedSeam?.id || null,
        lowerSocketFamilyRoleLawId: lowerSocketFamilyRoleLaw?.id || null,
        lowerSocketFamilyRole: lowerSocketFamilyRoleLaw?.selectedRole || null,
        diagnosisTags: macroContactDiagnosisTags(source.id, target.id, relation, clearanceVerdict, sharedSocketJointLaw, lowerSocketFamilyRoleLaw),
      };
      contacts.push(contact);
    }
  }
  const rankedContacts = [...contacts].sort((left, right) => (
    (left.clearanceSlack ?? Number.POSITIVE_INFINITY) - (right.clearanceSlack ?? Number.POSITIVE_INFINITY)
  ));
  const geometryCoherenceWatch = createMacroGeometryCoherenceWatch(composition, contacts);
  return {
    schema: 'MacroContactMap',
    mode: 'diagnostic-closest-approach-clearance-map-v0',
    generationLaw: 'sample live macro body envelopes after variation and interlock effects, then rank closest macro pairs',
    sourceMacroAssemblageCount: composition.macroAssemblages.length,
    sourceMacroAssemblageIds: composition.macroAssemblages.map(assemblage => assemblage.id),
    sampleCountPerMacro: 18,
    contacts,
    contactCount: contacts.length,
    rankedContacts,
    closestContactIds: rankedContacts.slice(0, 5).map(contact => contact.id),
    geometryCoherenceWatch,
    geometryCoherenceWatchCount: geometryCoherenceWatch.length,
    diagnosticTrustPolicy: 'if optional macro geometry is malformed, repair the macro anatomy before treating interlock tuning as evidence',
    failurePressure: [
      'pretty-overlap-without-measured-clearance',
      'one-sided-tuck-label-without-pairwise-contact-locus',
      'malformed-non-hero-plate-confused-with-interlock-failure',
    ],
    nonGoals: [
      'do-not-resolve-collisions-in-this-map',
      'do-not-retire-macro-families-from-diagnostic-output',
      'do-not-claim-final-over-under-from-centerline-sampling',
    ],
  };
}

function makePrimaryApertureFrame() {
  return {
    schema: 'PrimaryApertureFrame',
    id: 'primary-front-aperture-frame',
    proceduralFamilies: [
      'aperture-repulsor-field',
      'dominance-crossing-field',
      'front-cupping-thrust',
      'front-crossing-tuck',
    ],
    frontCompositionBias: [
      'break-open-horseshoe-symmetry',
      'reduce-passive-central-oval',
      'assign-front-aperture-ownership',
    ],
    owners: [
      {
        role: 'lower-cupping-owner',
        assemblageId: 'equatorial-cupping-whorl',
        memberIds: ['eq-body', 'eq-rail'],
        generatedBy: ['front-cupping-thrust', 'aperture-repulsor-field'],
        visibleGeometry: 'lower-front-cup-body',
      },
      {
        role: 'crossing-tuck-owner',
        assemblageId: 'north-east-counter-thrust',
        memberIds: ['ne-body', 'ne-support'],
        generatedBy: ['front-crossing-tuck', 'dominance-crossing-field'],
        visibleGeometry: 'front-crossing-tuck-member',
      },
      {
        role: 'side-rim-owner',
        side: 'left',
        assemblageId: 'north-west-dominant-thrust',
        memberIds: ['nw-body', 'nw-rail'],
        generatedBy: ['aperture-repulsor-field', 'side-rim-pressure-anchor'],
      },
      {
        role: 'side-rim-owner',
        side: 'right',
        assemblageId: 'north-east-counter-thrust',
        memberIds: ['ne-body', 'ne-support'],
        generatedBy: ['aperture-repulsor-field', 'side-rim-pressure-anchor'],
      },
    ],
    variationParameters: ['cupDepth', 'crossingTuckPhase', 'ownerDominance', 'apertureBite'],
  };
}

function createMacroPromotedBodyDescriptor(assemblage) {
  const lowerSocketKeelAnatomyLaw = createLowerSocketKeelAnatomyLaw(assemblage);
  const closureContracts = (assemblage.territoryBodyOccupancy?.closureAnchorIds || []).map(anchorId => ({
    kind: anchorId === 'lower-socket-anchor'
      ? 'lower-socket-join'
      : anchorId === 'crown-closure-anchor'
        ? 'crown-socket-overlap'
        : 'side-rim-overlap',
    anchorId,
    endpointBeadReplacement: 'socket-overlap-hint-not-orange-bead',
  }));
  const descriptor = {
    schema: 'MacroPromotedBody',
    id: `${assemblage.id}-promoted-body`,
    parentAssemblage: assemblage.id,
    objecthood: 'macro-assemblage-body-not-final-band',
    promotedFromVisibleBandIds: assemblage.childBandPlan.map(member => member.id),
    primarySpineFamily: assemblage.spine.proceduralFamily,
    promotedBodyScale: lowerSocketKeelAnatomyLaw
      ? 0.94
      : assemblage.role === 'crown-lock'
        ? 1.22
        : assemblage.role === 'supporting-whorl'
          ? 1.34
          : 1.28,
    sideSilhouettePolicy: {
      schema: 'PromotedBodySideSilhouettePolicy',
      mode: lowerSocketKeelAnatomyLaw
        ? 'lower-socket-smooth-keel-side-return-v0'
        : 'smooth-promoted-body-sides-v0',
      boundaryCutProfileVisible: false,
      sideScale: 1,
      terminalWidthScale: lowerSocketKeelAnatomyLaw?.widthProfile.terminalWidthScale ?? 1,
      preservesTopologyRelief: true,
      reason: lowerSocketKeelAnatomyLaw
        ? 'lower socket must read as one procedural body with a subordinate side-return lip before contact tuning'
        : 'truth-smoke needs clean macro side curves before reintroducing earned boundary articulation',
    },
    subordinateAnatomy: [
      'internal-rail-ridge',
      'edge-lip-channel',
      'slit-gap-within-macro-body',
      'child-band-as-anatomy-not-object',
      ...(lowerSocketKeelAnatomyLaw ? ['side-return-lip-as-subordinate-anatomy'] : []),
    ],
    closureContracts,
    failurePressure: lowerSocketKeelAnatomyLaw
      ? 'lower-socket-keel-must-not-regress-to-chopped-proxy-foot-or-competing-side-return-slab'
      : 'visible-bands-must-not-remain-final-objects',
    lowerSocketKeelAnatomyLaw,
    terminationDecision: lowerSocketKeelAnatomyLaw?.terminationDecision || null,
  };
  if (assemblage.id === 'equatorial-cupping-whorl') {
    descriptor.lowerCupClosure = {
      schema: 'LowerCupClosure',
      mode: 'lower-cup-socket-contiguous',
      bottomGapPolicy: 'forbid-accidental-triangle-bottom-gap',
      joins: ['lower-socket-anchor', 'north-west-dominant-thrust', 'north-east-counter-thrust'],
      visualIntent: 'lower-cupping-owner-becomes-contiguous-with-bottom-socket',
    };
  }
  if (assemblage.id === 'north-east-counter-thrust') {
    descriptor.crossingTuckIntegration = {
      schema: 'CrossingTuckIntegration',
      mode: 'crossing-tuck-macro-body',
      ownerRole: 'crossing-tuck-owner',
      railRole: 'subordinate-ridge-not-lone-wand',
      visibleRailId: 'primary-front-aperture-crossing-tuck-owner',
      broaderBodyRole: 'front-crossing-tuck-body',
    };
  }
  return descriptor;
}

function createMacroBodyPromotionPlan(composition) {
  const promotedBodies = composition.macroAssemblages.map(createMacroPromotedBodyDescriptor);
  const lowerSocketKeelAnatomyLaw = promotedBodies.find(body => body.lowerSocketKeelAnatomyLaw)?.lowerSocketKeelAnatomyLaw || null;
  return {
    schema: 'MacroBodyPromotionPlan',
    mode: 'macro-body-promotion-closure-v0',
    promotedBodies,
    lowerCupClosure: promotedBodies.find(body => body.lowerCupClosure)?.lowerCupClosure,
    crossingTuckIntegration: promotedBodies.find(body => body.crossingTuckIntegration)?.crossingTuckIntegration,
    lowerSocketKeelAnatomyLaw,
    lowerSocketKeelAnatomyVerdict: lowerSocketKeelAnatomyLaw
      ? 'procedural-lower-socket-anatomy-law-applied'
      : 'lower-socket-keel-not-selected',
    closurePolicy: [
      'macro-bodies-own-visible-objecthood',
      'subordinate-bands-become-ridges-slots-and-lips',
      'lower-cup-socket-contiguous',
      'crossing-tuck-macro-body',
      'forbid-accidental-triangle-bottom-gap',
    ],
  };
}

function torsionSurfaceFramePoints(assemblage, side, normal, t, strength = 1) {
  const field = assemblage.macroTorsionField;
  if (!field) return { side, normal };
  const roll = (
    field.surfaceRoll * Math.sin(Math.PI * t)
    + field.torsionGradient * Math.sin(TAU * t + field.phaseLag) * 0.35
  ) * strength;
  if (Math.abs(roll) < 1e-5) return { side, normal };
  const sideAxis = normalizePoint(addPoints(scalePoint(side, Math.cos(roll)), scalePoint(normal, Math.sin(roll))));
  const normalAxis = normalizePoint(addPoints(scalePoint(normal, Math.cos(roll * 0.42)), scalePoint(side, -Math.sin(roll * 0.42))));
  return {
    side: Math.hypot(...sideAxis) > 1e-8 ? sideAxis : [1, 0, 0],
    normal: Math.hypot(...normalAxis) > 1e-8 ? normalAxis : normal,
  };
}

function nearestCutProfileSample(cutProfile, t) {
  return (cutProfile || []).reduce((best, item) => (
    Math.abs(item.t - t) < Math.abs(best.t - t) ? item : best
  ), (cutProfile || [])[0] || { leftScale: 1, rightScale: 1, t: 0 });
}

function promotedBodySideScale(promoted, side, cutSample) {
  const policy = promoted?.sideSilhouettePolicy;
  if (policy?.boundaryCutProfileVisible === false) {
    return policy.sideScale ?? 1;
  }
  return side === 'left'
    ? cutSample?.leftScale ?? 1
    : cutSample?.rightScale ?? 1;
}

function macroPromotedBodyEdgeSamples(assemblage, targetEdge, rowCount = 72) {
  const body = assemblage.territoryBodyOccupancy;
  const promoted = assemblage.macroPromotedBody;
  const cutProfile = body.boundaryCutProfile || [];
  const sideSign = targetEdge === 'right-promoted-body-edge' ? 1 : -1;
  const centerline = [];
  for (let row = 0; row < rowCount; row++) {
    const t = row / (rowCount - 1);
    centerline.push(sampleSpinePoint(assemblage, {
      siblingOffset: 0,
      layerIntervals: assemblage.layerItinerary.intervals,
    }, t, 1.045));
  }

  return centerline.map((center, row) => {
    const t = row / (rowCount - 1);
    const prev = centerline[Math.max(0, row - 1)];
    const next = centerline[Math.min(rowCount - 1, row + 1)];
    const normal = normalizePoint(center);
    const tangent = normalizePoint(subtractPoints(next, prev));
    let side = normalizePoint(crossPoints(normal, tangent));
    if (Math.hypot(...side) < 1e-8) side = [1, 0, 0];
    const frame = torsionSurfaceFramePoints(assemblage, side, normal, t, 1);
    const sideAxis = frame.side;
    const normalAxis = frame.normal;
    const profile = Math.pow(Math.sin(Math.PI * t), 0.34);
    const terminalScale = 0.52 + 0.48 * profile;
    const nearestCut = nearestCutProfileSample(cutProfile, t);
    const expanded = assemblage.expandedRegionProxy;
    const scale = (promoted?.promotedBodyScale || 1.22) * (expanded?.coverageScale || 1);
    const interlock = macroInterlockEffectAt(assemblage, t);
    const lowerSocket = lowerSocketAnatomyEffectAt(assemblage, t);
    const sharedSeam = sharedSocketSeamEffectAt(assemblage, t);
    const roleEffect = lowerSocketFamilyRoleEffectAt(assemblage, t);
    const widthScale = interlock.widthScale * lowerSocket.widthScale * sharedSeam.widthScale * roleEffect.widthScale;
    const leftWidth = body.widthProfile.mid * scale * terminalScale * promotedBodySideScale(promoted, 'left', nearestCut) * widthScale;
    const rightWidth = body.widthProfile.mid * scale * terminalScale * promotedBodySideScale(promoted, 'right', nearestCut) * widthScale;
    const sideWidth = sideSign < 0 ? leftWidth : rightWidth;
    const lift = body.thicknessProfile.mid * (0.85 + 0.75 * profile) + interlock.normalLiftDelta + lowerSocket.normalLiftDelta + sharedSeam.normalLiftDelta + roleEffect.normalLiftDelta;
    const crown = 0.82;
    const outer = addScaledPoint(
      addScaledPoint(center, sideAxis, sideSign * sideWidth),
      normalAxis,
      lift * crown,
    );
    const inner = addScaledPoint(outer, normalAxis, -0.052);
    return {
      t,
      outer,
      inner,
      normalAxis,
      sideAxis,
      tangent,
      thickness: pointDistance(outer, inner),
    };
  });
}

function createLiveMacroSideWall(assemblage, targetEdge = 'left-promoted-body-edge') {
  const samples = macroPromotedBodyEdgeSamples(assemblage, targetEdge, 72);
  const thicknessStats = summarizeDistances(samples.map(sample => ({
    t: sample.t,
    distance: sample.thickness,
  })));
  return {
    schema: 'LiveMacroSideWall',
    mode: 'live-promoted-body-sidewall-v0',
    id: `${assemblage.id}-${targetEdge}-live-sidewall`,
    parentAssemblage: assemblage.id,
    targetPromotedBodyId: assemblage.macroPromotedBody?.id,
    targetEdge,
    materialMode: 'flat-low-shader-readable-thickness',
    surfaceDetailMode: 'disabled',
    outerSurfaceEdge: samples.map(sample => ({ t: sample.t, point: sample.outer })),
    innerThicknessEdge: samples.map(sample => ({ t: sample.t, point: sample.inner })),
    sideWallSamples: samples,
    sideWallThicknessStats: thicknessStats,
    polygonFaceCount: (samples.length - 1) * 2,
    couplingContract: {
      outerEdgeShared: true,
      innerEdgeGenerated: true,
      couplingVerdict: 'live-sidewall-strip-spans-promoted-body-edge-to-inner-thickness-edge',
    },
    visualContract: 'normal live render shows a flat readable polygon sidewall on a promoted body edge',
  };
}

function createLiveMacroTerminalCap(assemblage, sideWalls, endRole) {
  const leftWall = sideWalls.find(wall => wall.targetEdge === 'left-promoted-body-edge');
  const rightWall = sideWalls.find(wall => wall.targetEdge === 'right-promoted-body-edge');
  if (!leftWall || !rightWall) return null;
  const roleLaw = assemblage.lowerSocketFamilyRoleLaw || assemblage.macroPromotedBody?.lowerSocketFamilyRoleLaw;
  const terminalCapAuthority = roleLaw?.tuckTongueRefinement?.terminalCapAuthority || 'visible-promoted-body-terminal-cap';
  const normalRenderVisible = terminalCapAuthority === 'visible-promoted-body-terminal-cap';
  const sampleIndex = endRole === 'start-terminus' ? 0 : leftWall.sideWallSamples.length - 1;
  const left = leftWall.sideWallSamples[sampleIndex];
  const right = rightWall.sideWallSamples[sampleIndex];
  const outerMid = lerpPoint(left.outer, right.outer, 0.5);
  const innerMid = lerpPoint(left.inner, right.inner, 0.5);
  const capWidthStats = summarizeDistances([
    { distance: pointDistance(left.outer, right.outer) },
    { distance: pointDistance(outerMid, innerMid) },
    { distance: pointDistance(left.inner, right.inner) },
  ]);
  const capThicknessStats = summarizeDistances([
    { distance: pointDistance(left.outer, left.inner) },
    { distance: pointDistance(outerMid, innerMid) },
    { distance: pointDistance(right.outer, right.inner) },
  ]);
  return {
    schema: 'LiveMacroTerminalCap',
    mode: 'live-promoted-body-terminal-cap-v0',
    id: `${assemblage.id}-${endRole}-live-terminal-cap`,
    parentAssemblage: assemblage.id,
    targetPromotedBodyId: assemblage.macroPromotedBody?.id,
    endRole,
    t: endRole === 'start-terminus' ? 0 : 1,
    normalRenderVisible,
    capAuthority: terminalCapAuthority,
    sideWallIds: [leftWall.id, rightWall.id],
    capSamples: {
      outerLeft: left.outer,
      outerMid,
      outerRight: right.outer,
      innerLeft: left.inner,
      innerMid,
      innerRight: right.inner,
    },
    capWidthStats,
    capThicknessStats,
    capFaceCount: 4,
    couplingContract: {
      leftSideWallEdgeShared: true,
      rightSideWallEdgeShared: true,
      outerSurfaceEdgeShared: true,
      innerThicknessEdgeShared: true,
      couplingVerdict: 'terminal-cap-bridges-sidewalls-and-thickness-edges',
    },
    visualContract: normalRenderVisible
      ? 'normal live render shows a closed solid end on the promoted shell strip'
      : 'topology cap exists but normal render hides it under the shared socket seam',
  };
}

function createLiveMacroSideWallPlan(composition) {
  const expectedTerminalCapCount = composition.macroAssemblages.length * 2;
  const interlockAffectedMacroIds = composition.macroInterlockGraph?.interlockAffectedMacroIds || [];
  const sideWalls = composition.macroAssemblages.flatMap(assemblage => [
    createLiveMacroSideWall(assemblage, 'left-promoted-body-edge'),
    createLiveMacroSideWall(assemblage, 'right-promoted-body-edge'),
  ]);
  const interlockAffectedSideWallCount = sideWalls.filter(wall => (
    interlockAffectedMacroIds.includes(wall.parentAssemblage)
  )).length;
  const terminalCaps = composition.macroAssemblages.flatMap(assemblage => {
    const assemblageSideWalls = sideWalls.filter(wall => wall.parentAssemblage === assemblage.id);
    return ['start-terminus', 'end-terminus']
      .map(endRole => createLiveMacroTerminalCap(assemblage, assemblageSideWalls, endRole))
      .filter(Boolean);
  });
  const normalRenderHiddenTerminalCapIds = terminalCaps
    .filter(cap => cap.normalRenderVisible === false)
    .map(cap => cap.id);
  const suppressedLegacyRoundBandIds = composition.macroAssemblages
    .flatMap(assemblage => assemblage.childBandPlan.map(member => member.id));
  return {
    schema: 'LiveMacroSideWallPlan',
    mode: 'live-promoted-body-sidewall-v0',
    targetAssemblageIds: [...new Set(sideWalls.map(wall => wall.parentAssemblage))],
    macroInterlockGraph: composition.macroInterlockGraph,
    interlockAffectedMacroIds,
    interlockAffectedSideWallCount,
    sideWalls,
    sideWallCount: sideWalls.length,
    terminalCaps,
    terminalCapCount: terminalCaps.length,
    normalRenderHiddenTerminalCapIds,
    normalRenderVisibleTerminalCapCount: terminalCaps.length - normalRenderHiddenTerminalCapIds.length,
    terminalCapClosureVerdict: terminalCaps.length === expectedTerminalCapCount
      ? 'live-promoted-body-termini-capped'
      : 'live-promoted-body-termini-open',
    suppressedLegacyRoundBandIds,
    suppressedLegacyTerminationSocketIds: suppressedLegacyRoundBandIds.flatMap(id => [
      `${id}-start-termination-socket`,
      `${id}-end-termination-socket`,
    ]),
    legacyScaffoldSuppressionVerdict: suppressedLegacyRoundBandIds.length
      ? 'covered-promoted-body-legacy-round-bands-suppressed'
      : 'no-target-legacy-round-bands-suppressed',
    normalWitnessMaterialPolicy: {
      materialMode: 'neutral-semi-gloss-pbr-v0',
      materialClass: 'MeshStandardMaterial',
      environmentLit: true,
      toneMappingExpected: 'ACESFilmicToneMapping',
      bodyColor: 0x10181b,
      sideWallColor: 0x2d393d,
      railColor: 0x364449,
      roughness: 0.46,
      metalness: 0.06,
      envMapIntensity: 1.15,
      reason: 'neutral PBR truth-smoke should prove topology under Kaminos environment lighting without debug-white crutch',
    },
    liveRenderMaterialPolicy: {
      materialMode: 'flat-low-shader-topology',
      metalShaderVisible: false,
      surfaceDetailMode: 'disabled',
      territoryProxyUnderlayVisible: false,
      legacyRoundTargetBandTubesVisible: false,
      legacyTargetTerminationSocketsVisible: false,
      reason: 'live sidewall topology smoke must not depend on shiny material or overlapping proxy underlay',
    },
    liveMacroSideWallVisibilityVerdict: sideWalls.length >= 2
      ? 'visible-promoted-body-edge-sidewalls-rendered'
      : 'no-live-promoted-body-sidewall-rendered',
    nonGoals: [
      'do-not-solve-all-carapace-edges-in-this-slice',
      'do-not-use-metal-shader-as-sidewall-evidence',
      'do-not-treat-clean-diagnostic-witness-as-live-render-closure',
    ],
  };
}

function macroFamilySurfaceSample(assemblage, t, normalizedV, liftBias = 0.018) {
  const body = assemblage.territoryBodyOccupancy;
  const promoted = assemblage.macroPromotedBody;
  const center = sampleSpinePoint(assemblage, {
    siblingOffset: 0,
    layerIntervals: assemblage.layerItinerary.intervals,
  }, t, 1.045);
  const prev = sampleSpinePoint(assemblage, {
    siblingOffset: 0,
    layerIntervals: assemblage.layerItinerary.intervals,
  }, Math.max(0, t - 0.012), 1.045);
  const next = sampleSpinePoint(assemblage, {
    siblingOffset: 0,
    layerIntervals: assemblage.layerItinerary.intervals,
  }, Math.min(1, t + 0.012), 1.045);
  const normal = normalizePoint(center);
  const tangent = normalizePoint(subtractPoints(next, prev));
  let side = normalizePoint(crossPoints(normal, tangent));
  if (Math.hypot(...side) < 1e-8) side = [1, 0, 0];
  const frame = torsionSurfaceFramePoints(assemblage, side, normal, t, 1);
  const sideAxis = frame.side;
  const normalAxis = frame.normal;
  const profile = Math.pow(Math.sin(Math.PI * t), 0.34);
  const terminalScale = 0.52 + 0.48 * profile;
  const nearestCut = nearestCutProfileSample(body.boundaryCutProfile || [], t);
  const expanded = assemblage.expandedRegionProxy;
  const scale = (promoted?.promotedBodyScale || 1.22) * (expanded?.coverageScale || 1);
  const interlock = macroInterlockEffectAt(assemblage, t);
  const lowerSocket = lowerSocketAnatomyEffectAt(assemblage, t);
  const sharedSeam = sharedSocketSeamEffectAt(assemblage, t);
  const roleEffect = lowerSocketFamilyRoleEffectAt(assemblage, t);
  const widthScale = interlock.widthScale * lowerSocket.widthScale * sharedSeam.widthScale * roleEffect.widthScale;
  const leftWidth = body.widthProfile.mid * scale * terminalScale * promotedBodySideScale(promoted, 'left', nearestCut) * widthScale;
  const rightWidth = body.widthProfile.mid * scale * terminalScale * promotedBodySideScale(promoted, 'right', nearestCut) * widthScale;
  const sideWidth = normalizedV < 0 ? leftWidth : rightWidth;
  const lift = body.thicknessProfile.mid * (0.92 + 0.72 * profile) + liftBias + interlock.normalLiftDelta + lowerSocket.normalLiftDelta + sharedSeam.normalLiftDelta + roleEffect.normalLiftDelta;
  const topologyDip = topologyReliefStrength(assemblage, t);
  const crown = Math.max(0.62, 1 - Math.pow(Math.abs(normalizedV), 2.2) * 0.14 - topologyDip * 0.12);
  const point = addScaledPoint(
    addScaledPoint(center, sideAxis, normalizedV * sideWidth),
    normalAxis,
    lift * crown - topologyDip * 0.008,
  );
  return {
    t,
    normalizedV,
    point,
    normalAxis,
    sideAxis,
    tangent,
  };
}

function createApertureTerminationField(composition) {
  const primaryVoid = composition.AperturePressure?.primaryVoids?.[0] || {};
  const center = primaryVoid.center || [0.02, -0.02, 0.98];
  const normal = normalizePoint(center);
  const up = [0, 1, 0];
  let orbitTangent = normalizePoint(crossPoints(up, normal));
  if (Math.hypot(...orbitTangent) < 1e-8) orbitTangent = [1, 0, 0];
  return {
    schema: 'ApertureTerminationField',
    mode: ORB_SHELL_APERTURE_TERMINATION_MODE,
    id: 'primary-front-aperture-termination-field',
    sourceApertureId: primaryVoid.id || 'primary-front-teardrop-void',
    apertureCenter: center,
    apertureNormal: normal,
    orbitTangent,
    orbitRadiusBand: [
      primaryVoid.radius?.[0] ?? 0.34,
      primaryVoid.radius?.[1] ?? 0.55,
    ],
    captureStrength: 0.72,
    counterCurveDefaultAngle: 0.34,
    semanticPrimitive: 'aperture-relative-destiny-not-standalone-curve-family',
    curveMachinery: 'spherical-hermite-bezier-like-spines-driven-by-aperture-field',
  };
}

function aperturePressureRingPoint(voidRecord, angle) {
  const [cx, cy, cz] = voidRecord.center;
  const [rx, ry] = voidRecord.radius;
  const x = cx + Math.cos(angle) * rx;
  const y = cy + Math.sin(angle) * ry;
  const z = Math.max(cz * 0.8, Math.sqrt(Math.max(0.01, 1 - x * x - y * y))) + 0.05;
  return [x, y, z];
}

function aperturePressureRingPointAndTangent(voidRecord, angle) {
  const point = aperturePressureRingPoint(voidRecord, angle);
  const next = aperturePressureRingPoint(voidRecord, angle + 0.01);
  const prev = aperturePressureRingPoint(voidRecord, angle - 0.01);
  return {
    point,
    tangent: normalizePoint(subtractPoints(next, prev)),
  };
}

function nearestAperturePressureRingSample(voidRecord, point, steps = 180) {
  let nearest = null;
  for (let index = 0; index < steps; index++) {
    const angle = (index / steps) * TAU;
    const ring = aperturePressureRingPointAndTangent(voidRecord, angle);
    const distance = pointDistance(point, ring.point);
    if (!nearest || distance < nearest.distance) {
      nearest = { ...ring, angle, distance };
    }
  }
  return nearest;
}

function visibleApertureOrbitRecord(apertureField) {
  return {
    center: apertureField.apertureCenter,
    radius: apertureField.orbitRadiusBand,
  };
}

function orbitCaptureTerminalPhase(spec) {
  const offsets = {
    lead: -0.04,
    outer: 0.18,
    inner: -0.2,
  };
  return 0.75 * TAU + (offsets[spec.siblingRole] || 0);
}

function blendOrbitCaptureTerminalSample(spec, apertureField, localT, left, right, center) {
  const blend = smoothStep(0.58, 1, localT);
  if (blend <= 0) return { left, right, center };
  const apertureOrbit = visibleApertureOrbitRecord(apertureField);
  const terminalOrbit = aperturePressureRingPointAndTangent(apertureOrbit, orbitCaptureTerminalPhase(spec));
  const targetNormal = normalizePoint(terminalOrbit.point);
  let targetSideAxis = normalizePoint(crossPoints(targetNormal, terminalOrbit.tangent));
  if (dotPoints(targetSideAxis, center.sideAxis) < 0) targetSideAxis = scalePoint(targetSideAxis, -1);
  const width = pointDistance(left.point, right.point);
  const terminalCenterPoint = lerpPoint(center.point, terminalOrbit.point, blend);
  const terminalTangent = normalizePoint(lerpPoint(center.tangent, terminalOrbit.tangent, blend));
  const terminalNormal = normalizePoint(lerpPoint(center.normalAxis, targetNormal, blend));
  const terminalSideAxis = normalizePoint(lerpPoint(center.sideAxis, targetSideAxis, blend));
  const nextCenter = {
    ...center,
    point: terminalCenterPoint,
    normalAxis: terminalNormal,
    sideAxis: terminalSideAxis,
    tangent: terminalTangent,
  };
  const halfWidth = width * 0.5;
  return {
    center: nextCenter,
    left: {
      ...left,
      point: addScaledPoint(terminalCenterPoint, terminalSideAxis, -halfWidth),
      normalAxis: terminalNormal,
      sideAxis: terminalSideAxis,
      tangent: terminalTangent,
    },
    right: {
      ...right,
      point: addScaledPoint(terminalCenterPoint, terminalSideAxis, halfWidth),
      normalAxis: terminalNormal,
      sideAxis: terminalSideAxis,
      tangent: terminalTangent,
    },
  };
}

function blendCounterCurveSecondaryRefusal(spec, apertureField, localT, left, right, center) {
  if (spec.parentTerminationClass !== 'counter-curve-blade' || spec.ownsFurthestVisibleTip || spec.siblingRole === 'lead') {
    return { left, right, center };
  }
  const blend = smoothStep(0.62, 1, localT);
  if (blend <= 0) return { left, right, center };
  const nearest = nearestAperturePressureRingSample(visibleApertureOrbitRecord(apertureField), center.point);
  let refusalTangent = normalizePoint(crossPoints(normalizePoint(center.point), nearest.tangent));
  if (dotPoints(refusalTangent, center.tangent) < 0) refusalTangent = scalePoint(refusalTangent, -1);
  const terminalTangent = normalizePoint(lerpPoint(center.tangent, refusalTangent, blend));
  const nextCenter = { ...center, tangent: terminalTangent };
  return {
    center: nextCenter,
    left: { ...left, tangent: terminalTangent },
    right: { ...right, tangent: terminalTangent },
  };
}

function createApertureTangencyWitnessPlan(composition, apertureRelativeTerminationPlan, substrips) {
  const primaryVoid = composition.AperturePressure?.primaryVoids?.[0];
  const apertureField = apertureRelativeTerminationPlan?.apertureField;
  if (!primaryVoid || !apertureField) {
    return {
      schema: 'ApertureTangencyWitnessPlan',
      mode: ORB_SHELL_APERTURE_TANGENCY_WITNESS_MODE,
      id: 'limited-two-family-aperture-tangency-witness-plan',
      measuredApertureFieldId: apertureField?.id || null,
      measuredApertureSourceId: primaryVoid?.id || null,
      visualOverlayMode: 'terminal-and-orbit-tangent-rays',
      sampleCount: 0,
      samples: [],
      overlayGeometryIds: [],
      failureModes: ['missing-visible-aperture-source', 'pretty-geometry-without-aperture-coupling'],
    };
  }
  const samples = substrips.map(strip => {
    const terminalSample = strip.edgeSamples.at(-1);
    const terminalPoint = terminalSample.center;
    const terminalTangent = normalizePoint(terminalSample.tangent);
    const nearest = nearestAperturePressureRingSample(primaryVoid, terminalPoint);
    const tangentOrbitAlignment = Math.abs(dotPoints(terminalTangent, nearest.tangent));
    const tangentOrbitAngleRadians = Math.acos(clamp(tangentOrbitAlignment, -1, 1));
    const captureRadiusError = nearest.distance;
    const requestedTerminationClass = strip.apertureTermination.terminationClass;
    const classVerdict = requestedTerminationClass === 'orbit-capture'
      ? (
        tangentOrbitAlignment >= 0.72 && captureRadiusError <= 0.28
          ? 'measured-orbit-capture-coupling'
          : 'orbit-capture-request-not-yet-geometrically-proven'
      )
      : (
        tangentOrbitAlignment <= 0.82 || strip.apertureTermination.ownsFurthestVisibleTip
          ? 'measured-counter-curve-refusal'
          : 'counter-curve-request-not-yet-geometrically-proven'
      );
    const id = `${strip.id}-aperture-tangency-sample`;
    return {
      schema: 'ApertureTangencySample',
      mode: ORB_SHELL_APERTURE_TANGENCY_WITNESS_MODE,
      id,
      substripId: strip.id,
      parentAssemblage: strip.parentAssemblage,
      siblingRole: strip.siblingRole,
      requestedTerminationClass,
      ownsFurthestVisibleTip: strip.apertureTermination.ownsFurthestVisibleTip,
      terminalVisibility: strip.apertureTermination.terminalVisibility,
      terminalPoint,
      terminalTangent,
      nearestAperturePoint: nearest.point,
      nearestApertureAngleRadians: nearest.angle,
      apertureOrbitTangent: nearest.tangent,
      tangentOrbitAlignment,
      tangentOrbitAngleRadians,
      captureRadiusError,
      captureRadiusErrorVerdict: captureRadiusError <= 0.28 ? 'near-visible-aperture-orbit' : 'not-yet-near-visible-aperture-orbit',
      classVerdict,
      overlayGeometryIds: [
        `${id}-terminal-tangent-ray`,
        `${id}-aperture-orbit-tangent-ray`,
        `${id}-nearest-aperture-point`,
      ],
    };
  });
  const verdictCounts = samples.reduce((counts, sample) => {
    counts[sample.classVerdict] = (counts[sample.classVerdict] || 0) + 1;
    return counts;
  }, {});
  return {
    schema: 'ApertureTangencyWitnessPlan',
    mode: ORB_SHELL_APERTURE_TANGENCY_WITNESS_MODE,
    id: 'limited-two-family-aperture-tangency-witness-plan',
    measuredApertureFieldId: apertureField.id,
    measuredApertureSourceId: primaryVoid.id,
    visibleBlueRingField: primaryVoid.id,
    visualOverlayMode: 'terminal-and-orbit-tangent-rays',
    sampleCount: samples.length,
    samples,
    overlayGeometryIds: samples.flatMap(sample => sample.overlayGeometryIds),
    verdictCounts,
    failureModes: [
      'pretty-geometry-without-aperture-coupling',
      'requested-orbit-class-without-measured-terminal-tangent-alignment',
      'requested-counter-curve-class-without-visible-orbit-refusal',
    ],
  };
}

function dynamicSubstripVRange(spec, localT) {
  const [baseV0, baseV1] = spec.normalizedVRange;
  const baseCenter = (baseV0 + baseV1) * 0.5;
  const baseHalfWidth = (baseV1 - baseV0) * 0.5;
  const mouthWeight = Math.pow(1 - localT, 2.2);
  const terminalWeight = Math.pow(localT, 2.1);
  const terminalTarget = spec.terminalVTarget ?? baseCenter;
  const center = baseCenter
    + (spec.mouthVOffset ?? 0) * mouthWeight
    + (terminalTarget - baseCenter) * terminalWeight * (spec.terminalConvergence ?? 0.72);
  const widthScale = clamp(
    1 + (spec.mouthWidthBoost ?? 0.1) * mouthWeight - (spec.terminalNarrowing ?? 0.24) * terminalWeight,
    0.34,
    1.28,
  );
  return [
    center - baseHalfWidth * widthScale,
    center + baseHalfWidth * widthScale,
  ];
}

function substripApertureTermination(spec, parentTerminationClass) {
  return {
    schema: 'MacroFamilySubstripApertureTermination',
    mode: ORB_SHELL_APERTURE_TERMINATION_MODE,
    terminationClass: parentTerminationClass,
    siblingRole: spec.siblingRole,
    normalizedStartReach: spec.startReach ?? 0,
    normalizedTerminalReach: spec.terminalReach ?? 1,
    terminalVisibility: spec.terminalVisibility || 'visible-designed-terminal',
    ownsFurthestVisibleTip: Boolean(spec.ownsFurthestVisibleTip),
    terminalPlane: spec.endTerminalPlane || 'aperture-relative-angled-terminal',
    mouthLaw: 'spread-staggered-family-mouth',
    bodyLaw: 'shared-thrust-corridor',
  };
}

function makeMacroFamilySubstrip(assemblage, spec, apertureField, sampleCount = 54) {
  const edgeSamples = [];
  const leftSideWallSamples = [];
  const rightSideWallSamples = [];
  const startReach = spec.startReach ?? 0;
  const terminalReach = spec.terminalReach ?? 1;
  for (let index = 0; index < sampleCount; index++) {
    const localT = index / (sampleCount - 1);
    const t = startReach + localT * (terminalReach - startReach);
    const [v0, v1] = dynamicSubstripVRange(spec, localT);
    let left = macroFamilySurfaceSample(assemblage, t, v0, spec.liftBias);
    let right = macroFamilySurfaceSample(assemblage, t, v1, spec.liftBias);
    let center = macroFamilySurfaceSample(assemblage, t, (v0 + v1) * 0.5, spec.liftBias + 0.002);
    if (spec.parentTerminationClass === 'orbit-capture') {
      ({ left, right, center } = blendOrbitCaptureTerminalSample(spec, apertureField, localT, left, right, center));
    }
    ({ left, right, center } = blendCounterCurveSecondaryRefusal(spec, apertureField, localT, left, right, center));
    const sideWallDepth = spec.sideWallDepth ?? 0.026;
    edgeSamples.push({
      t,
      localT,
      normalizedV0: v0,
      normalizedV1: v1,
      leftEdge: left.point,
      rightEdge: right.point,
      center: center.point,
      surfaceNormal: center.normalAxis,
      sideAxis: center.sideAxis,
      tangent: center.tangent,
      width: pointDistance(left.point, right.point),
      layerOffset: spec.layerOffset ?? 0,
    });
    leftSideWallSamples.push({
      t,
      outer: left.point,
      inner: addScaledPoint(left.point, left.normalAxis, -sideWallDepth),
      surfaceNormal: left.normalAxis,
      tangent: left.tangent,
      sideAxis: left.sideAxis,
    });
    rightSideWallSamples.push({
      t,
      outer: right.point,
      inner: addScaledPoint(right.point, right.normalAxis, -sideWallDepth),
      surfaceNormal: right.normalAxis,
      tangent: right.tangent,
      sideAxis: right.sideAxis,
    });
  }
  const terminalCaps = ['start-terminus', 'end-terminus'].map(endRole => {
    const sample = endRole === 'start-terminus' ? edgeSamples[0] : edgeSamples[edgeSamples.length - 1];
    const sideWallIndex = endRole === 'start-terminus' ? 0 : leftSideWallSamples.length - 1;
    const leftWall = leftSideWallSamples[sideWallIndex];
    const rightWall = rightSideWallSamples[sideWallIndex];
    const noseLength = endRole === 'end-terminus' ? (spec.tipNoseLength ?? 0.018) : -(spec.mouthNoseLength ?? 0.006);
    const outerMid = addScaledPoint(sample.center, sample.tangent, noseLength);
    const innerMid = addScaledPoint(
      addScaledPoint(sample.center, sample.surfaceNormal, -(spec.sideWallDepth ?? 0.026)),
      sample.tangent,
      noseLength * 0.72,
    );
    return {
      schema: 'MacroFamilySubstripTerminalCap',
      mode: ORB_SHELL_MACRO_FAMILY_SUBSTRIP_MODE,
      id: `${assemblage.id}-${spec.id}-${endRole}-terminal-cap`,
      parentAssemblage: assemblage.id,
      sourceSubstripId: `${assemblage.id}-${spec.id}`,
      endRole,
      t: sample.t,
      capSamples: {
        outerLeft: leftWall.outer,
        outerRight: rightWall.outer,
        innerLeft: leftWall.inner,
        innerRight: rightWall.inner,
        outerMid,
        innerMid,
      },
      inheritsParentTermination: true,
      apertureTerminationMode: ORB_SHELL_APERTURE_TERMINATION_MODE,
      terminationClass: spec.parentTerminationClass,
      terminalPlane: endRole === 'end-terminus'
        ? (spec.endTerminalPlane || 'aperture-relative-angled-wedge')
        : (spec.startTerminalPlane || 'staggered-mouth-angled-entry'),
      siblingRole: spec.siblingRole,
      geometryKind: 'flat-substrip-end-cap-not-parent-slab-cap',
    };
  });
  return {
    schema: 'MacroFamilySubstrip',
    mode: ORB_SHELL_MACRO_FAMILY_SUBSTRIP_MODE,
    id: `${assemblage.id}-${spec.id}`,
    parentAssemblage: assemblage.id,
    targetPromotedBodyId: assemblage.macroPromotedBody?.id,
    role: spec.role,
    laneRole: spec.role,
    siblingRole: spec.siblingRole,
    coordinateFrame: {
      schema: 'MacroFamilyLocalFrame',
      u: 'parent-spine-arc-length',
      v: 'normalized-parent-width',
      h: 'normal-depth-offset',
      sourcePromotedBodyId: assemblage.macroPromotedBody?.id,
    },
    normalizedVRange: spec.normalizedVRange,
    layerOffset: spec.layerOffset ?? 0,
    geometryKind: 'flat-shell-conforming-lamellar-strip',
    crossSection: 'flat-ribbon-with-sidewalls-not-round-tube',
    renderRole: 'parent-owned-visible-lamellar-substrip',
    edgeSamples,
    sideWallSamples: {
      left: leftSideWallSamples,
      right: rightSideWallSamples,
    },
    widthStats: summarizeDistances(edgeSamples.map(sample => ({
      t: sample.t,
      distance: sample.width,
    }))),
    thicknessBudget: {
      target: spec.sideWallDepth ?? 0.026,
      tolerance: 0.008,
    },
    termination: {
      start: {
        role: spec.startRole || 'parent-start-sub-termination',
        inheritsParentTermination: true,
      },
      end: {
        role: spec.endRole || 'parent-end-sub-termination',
        inheritsParentTermination: true,
      },
    },
    apertureTermination: substripApertureTermination(spec, spec.parentTerminationClass),
    apertureFieldId: apertureField.id,
    terminalCaps,
    failurePressure: 'substrip-must-read-as-owned-anatomy-not-independent-band',
  };
}

function createApertureRelativeTerminationPlan(composition, apertureField, parentAssemblageIds, substrips) {
  const classByParent = {
    'north-west-dominant-thrust': 'orbit-capture',
    'north-east-counter-thrust': 'counter-curve-blade',
  };
  const descriptors = parentAssemblageIds.map(parentId => {
    const parentSubstrips = substrips.filter(strip => strip.parentAssemblage === parentId);
    const terminationClass = classByParent[parentId];
    const starts = parentSubstrips.map(strip => strip.apertureTermination.normalizedStartReach);
    const reaches = parentSubstrips.map(strip => strip.apertureTermination.normalizedTerminalReach);
    const mouthCenters = parentSubstrips.map(strip => {
      const sample = strip.edgeSamples[0];
      return (sample.normalizedV0 + sample.normalizedV1) * 0.5;
    }).sort((a, b) => a - b);
    const midCenters = parentSubstrips.map(strip => {
      const sample = strip.edgeSamples[Math.floor(strip.edgeSamples.length * 0.5)];
      return (sample.normalizedV0 + sample.normalizedV1) * 0.5;
    }).sort((a, b) => a - b);
    const mouthSpread = mouthCenters.length > 1 ? mouthCenters[mouthCenters.length - 1] - mouthCenters[0] : 0;
    const midBodySpread = midCenters.length > 1 ? midCenters[midCenters.length - 1] - midCenters[0] : 0;
    const sortedRanges = parentSubstrips
      .map(strip => {
        const sample = strip.edgeSamples[Math.floor(strip.edgeSamples.length * 0.5)];
        return [sample.normalizedV0, sample.normalizedV1];
      })
      .sort((a, b) => a[0] - b[0]);
    const gaps = [];
    for (let index = 0; index < sortedRanges.length - 1; index++) {
      gaps.push(Math.max(0, sortedRanges[index + 1][0] - sortedRanges[index][1]));
    }
    const leadReach = Math.max(...reaches);
    const terminalPoint = parentSubstrips
      .find(strip => strip.apertureTermination.normalizedTerminalReach === leadReach)
      ?.edgeSamples.at(-1)?.center;
    const terminalTangent = parentSubstrips
      .find(strip => strip.apertureTermination.normalizedTerminalReach === leadReach)
      ?.edgeSamples.at(-1)?.tangent || [1, 0, 0];
    const tangentAlignment = Math.abs(dotPoints(normalizePoint(terminalTangent), apertureField.orbitTangent));
    const siblingTerminations = parentSubstrips.map(strip => ({
      substripId: strip.id,
      siblingRole: strip.siblingRole,
      normalizedStartReach: strip.apertureTermination.normalizedStartReach,
      normalizedTerminalReach: strip.apertureTermination.normalizedTerminalReach,
      terminalVisibility: strip.apertureTermination.terminalVisibility,
      ownsFurthestVisibleTip: strip.apertureTermination.ownsFurthestVisibleTip,
      terminalPlane: strip.apertureTermination.terminalPlane,
    }));
    return {
      schema: 'LamellarFamilyTerminationDescriptor',
      mode: ORB_SHELL_APERTURE_TERMINATION_MODE,
      id: `${parentId}-aperture-relative-termination`,
      parentAssemblage: parentId,
      terminationClass,
      mouthAnchor: {
        tRange: [Math.min(...starts), Math.min(...starts) + 0.12],
        law: 'spread-staggered-family-mouth',
      },
      captureAnchor: terminationClass === 'orbit-capture'
        ? {
          fieldId: apertureField.id,
          orbitRadiusBand: apertureField.orbitRadiusBand,
          terminalPoint,
          law: 'aperture-orbit-capture-and-tuck',
        }
        : undefined,
      tipAnchor: terminationClass === 'counter-curve-blade'
        ? {
          fieldId: apertureField.id,
          terminalPoint,
          law: 'counter-curve-blade-refuses-orbit-capture',
        }
        : undefined,
      apertureTangentBlend: terminationClass === 'orbit-capture' ? Math.max(0.66, tangentAlignment) : 0.28,
      captureRadiusBand: terminationClass === 'orbit-capture' ? apertureField.orbitRadiusBand : undefined,
      counterCurveAngle: terminationClass === 'counter-curve-blade' ? apertureField.counterCurveDefaultAngle : 0,
      spreadMetrics: {
        mouthSpread,
        midBodySpread,
        terminalReachSpread: Math.max(...reaches) - Math.min(...reaches),
        minimumSiblingGap: gaps.length ? Math.min(...gaps) : 0.06,
      },
      siblingTerminations,
      visibleParentRetirementPreserved: true,
    };
  });
  const classCounts = descriptors.reduce((counts, descriptor) => {
    counts[descriptor.terminationClass] = (counts[descriptor.terminationClass] || 0) + 1;
    return counts;
  }, {});
  return {
    schema: 'ApertureRelativeTerminationPlan',
    mode: ORB_SHELL_APERTURE_TERMINATION_MODE,
    id: 'limited-two-family-aperture-relative-termination-plan',
    apertureField,
    parentAssemblageIds,
    parentTerminationPlans: descriptors,
    apertureTerminationClassCounts: classCounts,
    siblingRoleLaw: 'lead-inner-outer-tucked-roles-share-family-field-not-ribbon-subdivision',
    curveMachinery: apertureField.curveMachinery,
    antiEvidence: [
      'randomized-taper-only',
      'shared-flat-end-plane',
      'global-spiral-everywhere',
      'bottom-closure-before-endpoint-destiny',
    ],
  };
}

function createMacroFamilySubstripPlan(composition) {
  const apertureField = createApertureTerminationField(composition);
  const baseSpecs = {
    'north-west-dominant-thrust': [
      { id: 'broad-main-lamella', role: 'broad-main-lamella', siblingRole: 'lead', parentTerminationClass: 'orbit-capture', normalizedVRange: [-0.58, 0.12], startReach: 0.02, terminalReach: 0.98, mouthVOffset: 0.02, mouthWidthBoost: 0.16, terminalVTarget: -0.06, terminalNarrowing: 0.22, terminalVisibility: 'tucked-or-covered', endTerminalPlane: 'orbit-capture-tucked-wedge', liftBias: 0.03, sideWallDepth: 0.03, tipNoseLength: 0.016 },
      { id: 'outer-edge-lip-rail', role: 'edge-lip-rail', siblingRole: 'outer', parentTerminationClass: 'orbit-capture', normalizedVRange: [0.24, 0.46], startReach: 0.08, terminalReach: 0.9, mouthVOffset: 0.14, mouthWidthBoost: 0.1, terminalVTarget: 0.02, terminalNarrowing: 0.36, terminalVisibility: 'tucked-or-covered', endTerminalPlane: 'orbit-capture-early-tuck-wedge', liftBias: 0.04, sideWallDepth: 0.024, tipNoseLength: 0.012 },
      { id: 'inner-support-strip', role: 'inner-support-strip', siblingRole: 'inner', parentTerminationClass: 'orbit-capture', normalizedVRange: [-0.86, -0.68], startReach: 0, terminalReach: 0.84, mouthVOffset: -0.16, mouthWidthBoost: 0.12, terminalVTarget: -0.22, terminalNarrowing: 0.34, terminalVisibility: 'tucked-or-covered', endTerminalPlane: 'orbit-capture-inner-early-death-wedge', liftBias: 0.018, sideWallDepth: 0.022, layerOffset: -0.012, tipNoseLength: 0.01 },
    ],
    'north-east-counter-thrust': [
      { id: 'broad-main-lamella', role: 'broad-main-lamella', siblingRole: 'lead', parentTerminationClass: 'counter-curve-blade', normalizedVRange: [-0.22, 0.46], startReach: 0.04, terminalReach: 1, mouthVOffset: 0.1, mouthWidthBoost: 0.18, terminalVTarget: 0.11, terminalNarrowing: 0.52, terminalVisibility: 'visible-counter-curve-blade-tip', ownsFurthestVisibleTip: true, endTerminalPlane: 'counter-curve-blade-pointed-wedge', liftBias: 0.03, sideWallDepth: 0.03, tipNoseLength: 0.05 },
      { id: 'inner-support-strip', role: 'inner-support-strip', siblingRole: 'tucked', parentTerminationClass: 'counter-curve-blade', normalizedVRange: [-0.52, -0.36], startReach: 0, terminalReach: 0.78, mouthVOffset: -0.13, mouthWidthBoost: 0.14, terminalVTarget: -0.05, terminalNarrowing: 0.48, terminalVisibility: 'dies-early-into-lead-tip-corridor', endTerminalPlane: 'counter-curve-secondary-early-death-wedge', liftBias: 0.018, sideWallDepth: 0.022, layerOffset: -0.014, tipNoseLength: 0.018 },
    ],
  };
  const optionalSpecs = {
    'north-west-dominant-thrust': [
      { id: 'outer-secondary-pressure-lip', role: 'edge-lip-rail', siblingRole: 'outer-secondary', parentTerminationClass: 'orbit-capture', normalizedVRange: [0.56, 0.72], startReach: 0.14, terminalReach: 0.82, mouthVOffset: 0.22, mouthWidthBoost: 0.08, terminalVTarget: 0.08, terminalNarrowing: 0.38, terminalVisibility: 'tucked-or-covered', endTerminalPlane: 'orbit-capture-secondary-early-tuck-wedge', liftBias: 0.034, sideWallDepth: 0.02, layerOffset: 0.008, tipNoseLength: 0.01, activationThreshold: 0.62 },
      { id: 'outer-far-pressure-lip', role: 'edge-lip-rail', siblingRole: 'outer-far', parentTerminationClass: 'orbit-capture', normalizedVRange: [0.82, 0.94], startReach: 0.18, terminalReach: 0.74, mouthVOffset: 0.28, mouthWidthBoost: 0.06, terminalVTarget: 0.12, terminalNarrowing: 0.42, terminalVisibility: 'tucked-or-covered', endTerminalPlane: 'orbit-capture-far-early-tuck-wedge', liftBias: 0.03, sideWallDepth: 0.018, layerOffset: 0.012, tipNoseLength: 0.008, activationThreshold: 0.7 },
    ],
    'north-east-counter-thrust': [
      { id: 'inner-counter-shadow-lip', role: 'inner-support-strip', siblingRole: 'inner-counter', parentTerminationClass: 'counter-curve-blade', normalizedVRange: [-0.78, -0.64], startReach: 0, terminalReach: 0.68, mouthVOffset: -0.22, mouthWidthBoost: 0.1, terminalVTarget: -0.11, terminalNarrowing: 0.5, terminalVisibility: 'dies-early-before-counter-tip', endTerminalPlane: 'counter-curve-inner-shadow-early-death-wedge', liftBias: 0.016, sideWallDepth: 0.018, layerOffset: -0.018, tipNoseLength: 0.012, activationThreshold: 0.66 },
      { id: 'outer-counter-pressure-lip', role: 'edge-lip-rail', siblingRole: 'outer-counter', parentTerminationClass: 'counter-curve-blade', normalizedVRange: [0.58, 0.74], startReach: 0.1, terminalReach: 0.72, mouthVOffset: 0.18, mouthWidthBoost: 0.1, terminalVTarget: 0.18, terminalNarrowing: 0.46, terminalVisibility: 'dies-early-before-counter-tip', endTerminalPlane: 'counter-curve-outer-early-death-wedge', liftBias: 0.024, sideWallDepth: 0.02, layerOffset: 0.006, tipNoseLength: 0.014, activationThreshold: 0.66 },
    ],
  };
  const variation = composition.effectiveVariation || composition.controlledVariation || {};
  const leafDensityPressure = Number.isFinite(Number(variation.leafDensityPressure))
    ? Number(variation.leafDensityPressure)
    : clamp(((Number(variation.variationLeafCount) || 10) - 10) / 4, -0.5, 1);
  const variantId = variation.variantId || 'baseline';
  const variationSeed = Number.isFinite(Number(variation.variationSeed)) ? Number(variation.variationSeed) : 0;
  const parentAssemblageIds = Object.keys(baseSpecs);
  const optionalBudget = leafDensityPressure <= -0.25
    ? 1
    : leafDensityPressure < 0.25
      ? 3
      : 4;
  const optionalCandidateRecords = parentAssemblageIds.flatMap(parentId => (
    (optionalSpecs[parentId] || []).map((spec, index) => {
      const parentDensityBias = leafDensityPressure * 0.22;
      const optionSeed = (stableNoise(`${variantId}:${variationSeed}:${parentId}:${spec.id}:substrip-option`) + 1) * 0.5;
      const activationScore = optionSeed + parentDensityBias - index * 0.04;
      spec.activationScore = activationScore;
      return {
        parentId,
        spec,
        activationScore,
        activationThreshold: spec.activationThreshold ?? 0.66,
      };
    })
  ));
  const activatedOptionalIds = new Set(optionalCandidateRecords
    .filter(record => record.activationScore >= record.activationThreshold)
    .sort((a, b) => b.activationScore - a.activationScore)
    .slice(0, optionalBudget)
    .map(record => record.spec.id));
  const selectedSpecs = {};
  const perParentCounts = [];
  for (const parentId of parentAssemblageIds) {
    const parentDensityBias = leafDensityPressure * 0.22;
    const includedOptionalSpecs = (optionalSpecs[parentId] || [])
      .filter(spec => activatedOptionalIds.has(spec.id));
    selectedSpecs[parentId] = [...baseSpecs[parentId], ...includedOptionalSpecs]
      .sort((a, b) => a.normalizedVRange[0] - b.normalizedVRange[0]);
    perParentCounts.push({
      parentAssemblage: parentId,
      minimumCount: baseSpecs[parentId].length,
      optionalCandidateCount: optionalSpecs[parentId]?.length || 0,
      actualCount: selectedSpecs[parentId].length,
      densityPressure: leafDensityPressure,
      densityBias: parentDensityBias,
      optionalBudget,
      includedOptionalSpecIds: includedOptionalSpecs.map(spec => spec.id),
      optionalScores: (optionalSpecs[parentId] || []).map(spec => ({
        id: spec.id,
        activationScore: spec.activationScore,
        activationThreshold: spec.activationThreshold ?? 0.66,
      })),
    });
  }
  const substripCountLaw = {
    schema: 'MacroFamilySubstripCountLaw',
    mode: 'density-and-seed-driven-substrip-count-v0',
    sourceVariation: {
      variantId,
      variationSeed,
      variationLeafCount: variation.variationLeafCount ?? 10,
      leafDensityPressure,
      uiControlSource: variation.uiControlSource || 'route-or-programmatic',
    },
    macroFamilyCountPreserved: true,
    parentAssemblageIds,
    perParentCounts,
    countPressureLaw: 'base-anatomy-plus-density-seeded-optional-sibling-lanes',
    antiEvidence: [
      'macro-family-count-randomization',
      'single-ribbon-even-subdivision',
      'optional-strip-without-gap-contract',
      'optional-strip-without-aperture-termination-class',
    ],
  };
  const substrips = [];
  const gapContracts = [];
  for (const parentId of parentAssemblageIds) {
    const assemblage = composition.macroAssemblages.find(item => item.id === parentId);
    if (!assemblage?.macroPromotedBody) continue;
    const parentSubstrips = selectedSpecs[parentId].map(spec => makeMacroFamilySubstrip(assemblage, spec, apertureField));
    substrips.push(...parentSubstrips);
    const sorted = [...parentSubstrips].sort((a, b) => a.normalizedVRange[0] - b.normalizedVRange[0]);
    for (let index = 0; index < sorted.length - 1; index++) {
      const left = sorted[index];
      const right = sorted[index + 1];
      const normalizedGapWidth = right.normalizedVRange[0] - left.normalizedVRange[1];
      const normalizedGapSamples = left.edgeSamples.map(sample => ({
        t: sample.t,
        distance: normalizedGapWidth,
      }));
      gapContracts.push({
        schema: 'MacroFamilySubstripGapContract',
        mode: ORB_SHELL_MACRO_FAMILY_SUBSTRIP_MODE,
        id: `${parentId}-${left.role}-to-${right.role}-gap`,
        parentAssemblage: parentId,
        leftSubstripId: left.id,
        rightSubstripId: right.id,
        coordinateSpace: 'parent-normalized-v',
        normalizedGapWidth,
        gapDistanceStats: summarizeDistances(normalizedGapSamples),
        constantGapVerdict: normalizedGapWidth >= 0.04 && normalizedGapWidth <= 0.18
          ? 'within-parent-space-budget'
          : 'outside-parent-space-budget',
      });
    }
  }
  const apertureRelativeTerminationPlan = createApertureRelativeTerminationPlan(
    composition,
    apertureField,
    parentAssemblageIds,
    substrips,
  );
  const apertureTangencyWitnessPlan = createApertureTangencyWitnessPlan(
    composition,
    apertureRelativeTerminationPlan,
    substrips,
  );
  return {
    schema: 'MacroFamilySubstripPlan',
    mode: ORB_SHELL_MACRO_FAMILY_SUBSTRIP_MODE,
    scope: 'limited-two-family-proof-slice',
    sourceMacroBodyPlan: composition.macroBodyPromotion?.schema,
    parentAssemblageIds,
    substrips,
    substripCount: substrips.length,
    substripCountLaw,
    gapContracts,
    gapContractCount: gapContracts.length,
    apertureRelativeTerminationPlan,
    apertureTangencyWitnessPlan,
    apertureTerminationClassCounts: apertureRelativeTerminationPlan.apertureTerminationClassCounts,
    renderPolicy: {
      parentFillDemotion: 'muted-territory-support-not-final-slab',
      roundDiagnosticRailsVisible: false,
      textureGrooveSubstitutionAllowed: false,
      ambientOcclusionAsProofAllowed: false,
      materialMode: 'neutral-ao-off-topology-truth-smoke',
    },
    visibleParentRetirementPolicy: {
      schema: 'VisibleParentRetirementPolicy',
      mode: 'visible-parent-slab-retired-for-decomposed-families-v0',
      retiredParentAssemblageIds: parentAssemblageIds,
      normalRenderParentPromotedBodiesVisible: false,
      normalRenderParentSideWallsVisible: false,
      normalRenderParentTerminalCapsVisible: false,
      diagnosticParentDescriptorsPreserved: true,
      reason: 'macro family is procedural territory; visible shell read must come from owned lamellar plates',
    },
    meshAccounting: {
      substripMeshCount: substrips.length,
      sideWallMeshCount: substrips.length * 2,
      terminalCapMeshCount: substrips.length * 2,
      selectedParentPromotedBodyMeshCount: 0,
      selectedParentSideWallMeshCount: 0,
      selectedParentTerminalCapMeshCount: 0,
      sideWallIds: substrips.flatMap(strip => [
        `${strip.id}-left-sidewall`,
        `${strip.id}-right-sidewall`,
      ]),
      terminalCapIds: substrips.flatMap(strip => strip.terminalCaps.map(cap => cap.id)),
    },
    macroFamilyObjecthoodVerdict: 'parent-families-remain-nameable-after-subdivision',
    failurePressure: 'do-not-regress-to-independent-strip-soup',
  };
}

function createMacroTorsionField(assemblage, params = {}) {
  const baselineTwist = assemblage.spine.control.baseTwist ?? assemblage.spine.control.twist;
  const twistDelta = params.twistDelta ?? 0;
  const torsionGradient = params.torsionGradient ?? 0;
  const surfaceRoll = params.surfaceRoll ?? 0;
  const phaseLag = params.phaseLag ?? 0;
  return {
    schema: 'MacroTorsionField',
    mode: ORB_SHELL_MACRO_TORSION_MODE,
    id: `${assemblage.id}-macro-torsion-field`,
    parentAssemblage: assemblage.id,
    baselineTwist,
    twistDelta,
    effectiveTwist: clamp(baselineTwist + twistDelta, 0.48, 1.82),
    torsionGradient,
    surfaceRoll,
    phaseLag,
    appliesTo: [
      'spine-sampling',
      'expanded-region-proxy-surface',
      'future-mesh-boundary-input',
    ],
    preserve: [
      'lower-cup-socket-contiguous',
      'crossing-tuck-macro-body',
      'MacroRegionSeamGapDescriptor',
    ],
    proceduralFamily: 'bounded-spherical-torsion-field',
    failurePressure: 'twist-must-support-macro-design-not-arbitrary-tangle',
  };
}

function createMacroTorsionFieldPlan(composition, macroParameters = {}) {
  const fields = composition.macroAssemblages.map(assemblage => (
    createMacroTorsionField(assemblage, macroParameters[assemblage.id])
  ));
  return {
    schema: 'MacroTorsionFieldPlan',
    mode: ORB_SHELL_MACRO_TORSION_MODE,
    fields,
    futureMeshRole: 'future-mesh-boundary-input',
    variationFamilies: ['twistDelta', 'torsionGradient', 'surfaceRoll', 'phaseLag'],
    preserves: [
      'ExpandedMacroRegionProxy',
      'MacroRegionSeamGapDescriptor',
      'lower-cup-socket-contiguous',
      'crossing-tuck-macro-body',
    ],
  };
}

function createCleanProxySurfacePolicy() {
  return {
    schema: 'CleanProxySurfacePolicy',
    mode: 'clean-proxy-surface-diagnostic-v0',
    surfaceDetailMode: 'diagnostic-smooth-sheet',
    decorativeMicroVariation: 'forbidden',
    topologyOnlySurfaceRelief: true,
    allowedReliefEvents: [
      'level-change-dip',
      'under-neighbor',
      'inner-support',
      'local-layer-event-schedule',
    ],
    forbiddenSurfaceNoise: [
      'ridgeChannel',
      'centerRelief',
      'decorative-micro-variation',
      'scratch-simulacrum',
    ],
    reason: 'proxy-surfaces-must-expose-grammar-failures-before-final-meshing',
  };
}

function crossingSubSurge(id, role, centerline, options = {}) {
  return {
    schema: 'CrossingSubSurge',
    id,
    role,
    parentAssemblage: 'north-east-counter-thrust',
    centerline,
    widthProfile: options.widthProfile || { root: 0.052, mid: 0.082, tip: 0.046 },
    thicknessProfile: options.thicknessProfile || { root: 0.012, mid: 0.022, tip: 0.012 },
    seamReceivers: options.seamReceivers || ['crossing-tuck-overlap-receiver'],
    levelEvents: options.levelEvents || [],
    surfacePolicy: 'topologyOnlySurfaceRelief',
    objecthood: role === 'dominant-crossing-body'
      ? 'macro-body-sub-surge-not-wand'
      : 'subordinate-anatomy-not-standalone-bar',
  };
}

function createCrossingSubSurgePlan(frontParameters = {}) {
  const phase = frontParameters.crossingTuckPhase || 0;
  const dominance = frontParameters.ownerDominance || 1;
  const bodyLine = [
    [-0.42, 0.43, 0.82],
    [-0.21 + phase * 0.14, 0.18, 1.01],
    [0.08 + phase * 0.18, -0.06, 1.09],
    [0.38, -0.34 + phase * 0.1, 0.88],
  ];
  return {
    schema: 'CrossingSubSurgePlan',
    mode: 'crossing-sub-surge-decomposition-v0',
    id: 'north-east-counter-thrust-crossing-sub-surge-plan',
    ownerAssemblageId: 'north-east-counter-thrust',
    ownerRole: 'crossing-tuck-owner',
    bodySemantics: 'front-crossing-tuck-body-with-subordinate-anatomy',
    subSurges: [
      crossingSubSurge('crossing-tuck-dominant-body-surge', 'dominant-crossing-body', bodyLine, {
        widthProfile: { root: 0.072 * dominance, mid: 0.138 * dominance, tip: 0.064 * dominance },
        thicknessProfile: { root: 0.014, mid: 0.03, tip: 0.014 },
        seamReceivers: ['crossing-tuck-overlap-receiver', 'primary-front-intentional-slit'],
        levelEvents: [
          { type: 'level-change-dip', t: 0.42, layer: 'under-neighbor', generatedBy: 'dominance-crossing-field' },
          { type: 'reseat-after-underpass', t: 0.68, layer: 'outer', generatedBy: 'front-crossing-tuck' },
        ],
      }),
      crossingSubSurge('crossing-tuck-upper-edge-rail', 'subordinate-edge-rail', bodyLine.map(point => [point[0] - 0.028, point[1] + 0.018, point[2] + 0.006]), {
        widthProfile: { root: 0.016, mid: 0.02, tip: 0.014 },
        thicknessProfile: { root: 0.006, mid: 0.009, tip: 0.006 },
        seamReceivers: ['primary-front-intentional-slit'],
        levelEvents: [
          { type: 'level-change-dip', t: 0.46, layer: 'under-neighbor', generatedBy: 'edge-rail-follows-body-underpass' },
        ],
      }),
      crossingSubSurge('crossing-tuck-lower-seam-rail', 'subordinate-edge-rail', bodyLine.map(point => [point[0] + 0.034, point[1] - 0.022, point[2] - 0.004]), {
        widthProfile: { root: 0.014, mid: 0.018, tip: 0.012 },
        thicknessProfile: { root: 0.005, mid: 0.008, tip: 0.005 },
        seamReceivers: ['crossing-tuck-overlap-receiver'],
        levelEvents: [
          { type: 'level-change-dip', t: 0.52, layer: 'under-neighbor', generatedBy: 'seam-receiver-clearance' },
        ],
      }),
    ],
    failurePressure: 'central-crossing-must-not-read-as-isolated-wand',
  };
}

function createExpandedRegionProxyDescriptor(assemblage, cleanPolicy) {
  const roleScale = assemblage.id === 'equatorial-cupping-whorl'
    ? 1.24
    : assemblage.id === 'north-east-counter-thrust'
      ? 1.18
      : assemblage.id === 'polar-crown-lock'
        ? 1.14
        : 1.2;
  return {
    schema: 'ExpandedMacroRegionProxy',
    mode: 'macro-region-proxy-coverage-v0',
    id: `${assemblage.id}-expanded-region-proxy`,
    parentAssemblage: assemblage.id,
    proxyStatus: 'proxy-not-final-plate',
    futureMeshRole: 'future-mesh-boundary-input',
    coverageScale: roleScale,
    coverageIntent: 'macro-region-coverage-before-final-meshing',
    preserveReadableGaps: true,
    surfaceDetailMode: cleanPolicy?.surfaceDetailMode || 'diagnostic-smooth-sheet',
    topologyOnlySurfaceRelief: cleanPolicy?.topologyOnlySurfaceRelief ?? true,
    cleanSurfacePolicy: cleanPolicy ? {
      mode: cleanPolicy.mode,
      decorativeMicroVariation: cleanPolicy.decorativeMicroVariation,
      allowedReliefEvents: cleanPolicy.allowedReliefEvents,
    } : null,
    effectiveTorsion: assemblage.macroTorsionField ? {
      fieldId: assemblage.macroTorsionField.id,
      effectiveTwist: assemblage.macroTorsionField.effectiveTwist,
      torsionGradient: assemblage.macroTorsionField.torsionGradient,
      surfaceRoll: assemblage.macroTorsionField.surfaceRoll,
      phaseLag: assemblage.macroTorsionField.phaseLag,
    } : null,
    derivedFrom: assemblage.macroPromotedBody?.id,
  };
}

function seamGap(id, type, regions, role, options = {}) {
  return {
    schema: 'MacroRegionSeamGapDescriptor',
    id,
    type,
    regions,
    role,
    futureMeshRole: 'future-mesh-boundary-input',
    proxyStatus: 'proxy-not-final-plate',
    minimumReadability: options.minimumReadability || 0.035,
    generatedBy: options.generatedBy || ['neighbor-pressure-field', 'macro-region-coverage'],
  };
}

function createExpandedMacroRegionProxyPlan(composition, cleanPolicy) {
  const expandedRegions = composition.macroAssemblages.map(assemblage => (
    createExpandedRegionProxyDescriptor(assemblage, cleanPolicy)
  ));
  return {
    schema: 'ExpandedMacroRegionProxyPlan',
    mode: 'macro-region-proxy-coverage-v0',
    proxyStatus: 'proxy-not-final-plate',
    futureMeshRole: 'future-mesh-boundary-input',
    cleanSurfacePolicy: cleanPolicy,
    expandedRegions,
    seamGaps: [
      seamGap('primary-front-intentional-slit', 'intentional-slit', [
        'north-west-dominant-thrust-expanded-region-proxy',
        'north-east-counter-thrust-expanded-region-proxy',
      ], 'front aperture readable slit', { generatedBy: ['aperture-pressure', 'dominance-crossing-field'] }),
      seamGap('crossing-tuck-overlap-receiver', 'overlap-receiver', [
        'north-east-counter-thrust-expanded-region-proxy',
        'equatorial-cupping-whorl-expanded-region-proxy',
      ], 'crossing tuck receiver', { generatedBy: ['front-crossing-tuck', 'neighbor-tuck-clearance'] }),
      seamGap('lower-cup-socket-join-gap', 'lower-socket-join', [
        'equatorial-cupping-whorl-expanded-region-proxy',
        'north-west-dominant-thrust-expanded-region-proxy',
        'north-east-counter-thrust-expanded-region-proxy',
      ], 'contiguous lower socket join', { minimumReadability: 0.018, generatedBy: ['lower-cup-socket-contiguous'] }),
      seamGap('upper-crown-receiver-gap', 'crown-receiver', [
        'polar-crown-lock-expanded-region-proxy',
        'north-west-dominant-thrust-expanded-region-proxy',
        'north-east-counter-thrust-expanded-region-proxy',
      ], 'future crown receiver seam', { generatedBy: ['crown-socket-overlap', 'termination-pressure'] }),
      seamGap('right-side-rim-reveal-gap', 'side-rim-reveal', [
        'north-east-counter-thrust-expanded-region-proxy',
        'polar-crown-lock-expanded-region-proxy',
      ], 'side rim reveal', { generatedBy: ['side-rim-pressure-anchor', 'silhouette-relief'] }),
    ],
  };
}

function createBandChannelCandidate(assemblage, bodyId, railId) {
  const body = assemblage.childBandPlan.find(member => member.id === bodyId);
  const rail = assemblage.childBandPlan.find(member => member.id === railId);
  if (!body || !rail) return null;
  const gapSamples = [];
  for (let i = 0; i <= 8; i++) {
    const t = 0.1 + i * 0.1;
    const bodyPoint = sampleSpinePoint(assemblage, body, t, 1.045);
    const railPoint = sampleSpinePoint(assemblage, rail, t, 1.045);
    gapSamples.push({
      t,
      distance: pointDistance(bodyPoint, railPoint),
      bodyLayer: body.layerIntervals.find(interval => t >= interval.t0 && t <= interval.t1)?.layer || 'outer',
      railLayer: rail.layerIntervals.find(interval => t >= interval.t0 && t <= interval.t1)?.layer || 'outer',
    });
  }
  const gapDistanceStats = summarizeDistances(gapSamples);
  return {
    schema: 'ChannelThroughLineCandidate',
    id: `${assemblage.id}-${rail.id}-visible-rail`,
    sourceKind: 'BandMember',
    parentAssemblage: assemblage.id,
    bodyBandId: body.id,
    railBandId: rail.id,
    generationPath: 'sampleSpine-shared-parent-macro',
    sharedParentSpine: true,
    gapSamples,
    gapDistanceStats,
    continuityEvidence: [
      'same MacroAssemblage',
      'same sampleSpine function',
      'bounded siblingOffset variation',
    ],
    limitation: 'rail is not yet a meshed channel wall or constant-gap corridor',
  };
}

function createSharedSpineChannelDescriptor(assemblage, candidate) {
  const body = assemblage.childBandPlan.find(member => member.id === candidate.bodyBandId);
  const rail = assemblage.childBandPlan.find(member => member.id === candidate.railBandId);
  const constantGapBudget = {
    target: 0.12,
    tolerance: 0.018,
    maxRelativeVariation: 0.18,
  };
  const pairedEdgeSamples = candidate.gapSamples.map(sample => {
    const bodyPoint = sampleSpinePoint(assemblage, body, sample.t, 1.052);
    const railPoint = sampleSpinePoint(assemblage, rail, sample.t, 1.052);
    const railDirection = normalizePoint([
      railPoint[0] - bodyPoint[0],
      railPoint[1] - bodyPoint[1],
      railPoint[2] - bodyPoint[2],
    ]);
    const midpoint = [
      (bodyPoint[0] + railPoint[0]) * 0.5,
      (bodyPoint[1] + railPoint[1]) * 0.5,
      (bodyPoint[2] + railPoint[2]) * 0.5,
    ];
    const leftEdge = addScaledPoint(midpoint, railDirection, -constantGapBudget.target * 0.5);
    const rightEdge = addScaledPoint(midpoint, railDirection, constantGapBudget.target * 0.5);
    return {
      t: sample.t,
      leftEdge,
      rightEdge,
      measuredGap: pointDistance(leftEdge, rightEdge),
      sourceBodyPoint: bodyPoint,
      sourceRailPoint: railPoint,
      bodyLayer: sample.bodyLayer,
      railLayer: sample.railLayer,
    };
  });
  const gapDistanceStats = summarizeDistances(pairedEdgeSamples.map(sample => ({
    t: sample.t,
    distance: sample.measuredGap,
  })));
  const sourceStats = candidate.gapDistanceStats;
  const sourceOutsideBudget = sourceStats.relativeVariation > constantGapBudget.maxRelativeVariation;
  return {
    schema: 'ChannelThroughLineDescriptor',
    mode: 'channel-through-line-descriptor-v0',
    id: `${assemblage.id}-${candidate.railBandId}-channel-through-line`,
    sourceCandidateId: candidate.id,
    sourceGapDistanceStats: sourceStats,
    parentAssemblage: assemblage.id,
    sourceKind: candidate.sourceKind,
    generationPath: 'paired-edge-sampled-from-shared-parent-spine',
    surfaceAttachment: 'expanded-region-proxy-surface',
    constantGapBudget,
    pairedEdgeSamples,
    gapDistanceStats,
    constantGapVerdict: sourceOutsideBudget ? 'outside-budget' : 'within-budget',
    solvedForMeshing: !sourceOutsideBudget,
    correctiveAction: sourceOutsideBudget
      ? 'meshing-must-resample-channel-corridor-to-budget-before-preserving-groove'
      : 'eligible-for-bounded-meshing',
  };
}

function createUnsolvedSeamHintChannelDescriptor(candidate) {
  return {
    schema: 'ChannelThroughLineDescriptor',
    mode: 'channel-through-line-descriptor-v0',
    id: `${candidate.id}-channel-through-line`,
    sourceCandidateId: candidate.id,
    parentAssemblage: candidate.parentAssemblage,
    sourceKind: candidate.sourceKind,
    generationPath: 'unsolved-hardcoded-seam-hint',
    surfaceAttachment: 'not-proven',
    constantGapBudget: {
      target: 0.12,
      tolerance: 0.018,
      maxRelativeVariation: 0.18,
    },
    pairedEdgeSamples: [],
    gapDistanceStats: null,
    constantGapVerdict: 'not-applicable-hardcoded-hint',
    solvedForMeshing: false,
    correctiveAction: 'replace-hardcoded-seam-hint-with-generated-channel-through-line',
  };
}

function createChannelThroughLinePlan(composition, audit) {
  const descriptors = [];
  for (const candidate of audit.channelCandidates) {
    if (candidate.id === 'north-east-counter-thrust-ne-support-visible-rail') {
      const assemblage = composition.macroAssemblages.find(item => item.id === candidate.parentAssemblage);
      descriptors.push(createSharedSpineChannelDescriptor(assemblage, candidate));
    } else if (candidate.generationPath === 'hardcoded-seam-hint') {
      descriptors.push(createUnsolvedSeamHintChannelDescriptor(candidate));
    }
  }
  const solvedCount = descriptors.filter(descriptor => descriptor.solvedForMeshing).length;
  return {
    schema: 'ChannelThroughLinePlan',
    mode: 'channel-through-line-descriptor-v0',
    descriptors,
    descriptorCount: descriptors.length,
    solvedDescriptorCount: solvedCount,
    channelCorridorVerdict: solvedCount === descriptors.length
      ? 'all-channel-corridors-within-budget'
      : 'channel-corridors-described-but-not-all-solved',
    futureMeshRole: 'consume-channel-through-line-descriptors-before-preserving-grooves',
  };
}

function createLamellarChannelMeshPlan(channelPlan) {
  const stripMeshes = [];
  const unsolvedChannelDescriptors = [];
  for (const descriptor of channelPlan?.descriptors || []) {
    if (descriptor.id === 'north-east-counter-thrust-ne-support-channel-through-line' && descriptor.pairedEdgeSamples.length >= 2) {
      const visualWidthScale = 1.92;
      const edgeSamples = descriptor.pairedEdgeSamples.map(sample => {
        const sourceCenter = [
          (sample.leftEdge[0] + sample.rightEdge[0]) * 0.5,
          (sample.leftEdge[1] + sample.rightEdge[1]) * 0.5,
          (sample.leftEdge[2] + sample.rightEdge[2]) * 0.5,
        ];
        const edgeAxis = normalizePoint([
          sample.rightEdge[0] - sample.leftEdge[0],
          sample.rightEdge[1] - sample.leftEdge[1],
          sample.rightEdge[2] - sample.leftEdge[2],
        ]);
        const visualHalfWidth = descriptor.constantGapBudget.target * visualWidthScale * 0.5;
        const leftEdge = addScaledPoint(sourceCenter, edgeAxis, -visualHalfWidth);
        const rightEdge = addScaledPoint(sourceCenter, edgeAxis, visualHalfWidth);
        return {
          t: sample.t,
          leftEdge,
          rightEdge,
          sourceLeftEdge: sample.leftEdge,
          sourceRightEdge: sample.rightEdge,
          center: sourceCenter,
          surfaceNormal: normalizePoint(sourceCenter),
          measuredWidth: pointDistance(leftEdge, rightEdge),
          sourceMeasuredWidth: pointDistance(sample.leftEdge, sample.rightEdge),
          bodyLayer: sample.bodyLayer,
          railLayer: sample.railLayer,
        };
      });
      const strip = {
        schema: 'LamellarChannelStripMesh',
        mode: 'flat-lamellar-channel-strip-v0',
        id: `${descriptor.id}-flat-strip-mesh`,
        sourceDescriptorId: descriptor.id,
        sourceCandidateId: descriptor.sourceCandidateId,
        parentAssemblage: descriptor.parentAssemblage,
        replacesRoundBandId: 'ne-support',
        finalGeometryKind: 'flat-shell-conforming-lamellar-strip',
        crossSection: 'flat-ribbon-not-round-tube',
        meshTopology: 'sampled-paired-edge-ribbon-buffer-geometry',
        renderRole: 'final-visible-flat-channel-scaffold',
        roundDiagnosticRailFinalVisible: false,
        visualWidthScale,
        edgeSamples,
        widthBudget: {
          target: descriptor.constantGapBudget.target,
          tolerance: descriptor.constantGapBudget.tolerance,
          measuredMean: descriptor.gapDistanceStats.mean,
          visualTarget: descriptor.constantGapBudget.target * visualWidthScale,
          sourceRelativeVariation: descriptor.sourceGapDistanceStats?.relativeVariation,
        },
        thicknessBudget: {
          target: 0.014,
          tolerance: 0.006,
        },
        constantGapVerdict: descriptor.constantGapVerdict,
        solvedForMeshing: false,
        meshReadinessVerdict: descriptor.constantGapVerdict === 'within-budget'
          ? 'flat-strip-mesh-scaffolded-from-within-budget-descriptor'
          : 'flat-strip-mesh-scaffolded-source-still-outside-budget',
      };
      strip.plateLips = [
        {
          schema: 'LamellarPlateLip',
          mode: 'flat-lamellar-channel-strip-v0',
          id: `${strip.id}-left-plate-lip`,
          sourceStripMeshId: strip.id,
          edgeRole: 'left-shoulder',
          geometryKind: 'flat-beveled-lip-not-round-rod',
          lipWidth: 0.05,
          lipHeight: 0.018,
          highlightMaterialRole: 'cool-metal-edge-shoulder-highlight',
          edgeSamples: edgeSamples.map(sample => ({
            t: sample.t,
            edgePoint: sample.leftEdge,
            innerPoint: [
              sample.leftEdge[0] * 0.62 + sample.center[0] * 0.38,
              sample.leftEdge[1] * 0.62 + sample.center[1] * 0.38,
              sample.leftEdge[2] * 0.62 + sample.center[2] * 0.38,
            ],
            surfaceNormal: sample.surfaceNormal,
          })),
        },
        {
          schema: 'LamellarPlateLip',
          mode: 'flat-lamellar-channel-strip-v0',
          id: `${strip.id}-right-plate-lip`,
          sourceStripMeshId: strip.id,
          edgeRole: 'right-shoulder',
          geometryKind: 'flat-beveled-lip-not-round-rod',
          lipWidth: 0.05,
          lipHeight: 0.018,
          highlightMaterialRole: 'cool-metal-edge-shoulder-highlight',
          edgeSamples: edgeSamples.map(sample => ({
            t: sample.t,
            edgePoint: sample.rightEdge,
            innerPoint: [
              sample.rightEdge[0] * 0.62 + sample.center[0] * 0.38,
              sample.rightEdge[1] * 0.62 + sample.center[1] * 0.38,
              sample.rightEdge[2] * 0.62 + sample.center[2] * 0.38,
            ],
            surfaceNormal: sample.surfaceNormal,
          })),
        },
      ];
      stripMeshes.push(strip);
    } else {
      unsolvedChannelDescriptors.push({
        sourceDescriptorId: descriptor.id,
        sourceCandidateId: descriptor.sourceCandidateId,
        reason: descriptor.pairedEdgeSamples?.length ? 'descriptor-not-yet-selected-for-first-mesh' : 'no-paired-edge-samples',
        requiredAction: descriptor.correctiveAction,
      });
    }
  }
  return {
    schema: 'LamellarChannelMeshPlan',
    mode: 'flat-lamellar-channel-strip-v0',
    sourcePlanSchema: channelPlan?.schema,
    stripMeshes,
    stripMeshCount: stripMeshes.length,
    plateLipCount: stripMeshes.reduce((sum, strip) => sum + (strip.plateLips?.length || 0), 0),
    unsolvedChannelDescriptors,
    roundDiagnosticRailFinalVisible: false,
    plateLipVisualLegibilityVerdict: stripMeshes.some(strip => strip.plateLips?.length >= 2)
      ? 'raised-flat-lips-visible-plate-language'
      : 'flat-strip-lacks-visible-plate-lips',
    meshVerdict: stripMeshes.length
      ? 'first-channel-flat-strip-mesh-scaffolded'
      : 'no-flat-channel-strip-mesh-scaffolded',
    futureMeshRole: 'replace-round-diagnostic-rails-with-flat-shell-conforming-lamellar-strips',
  };
}

function createLamellarPlateBoundaryMesh(gap) {
  const gapWidth = 0.096;
  const centerline = seamGapSeedPoints(gap.id, 1.09);
  const sharedBoundarySamples = [];
  const pairedBoundaryEdges = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const center = samplePolyline(centerline, t);
    const prev = samplePolyline(centerline, Math.max(0, t - 0.03));
    const next = samplePolyline(centerline, Math.min(1, t + 0.03));
    const surfaceNormal = normalizePoint(center);
    const tangent = normalizePoint(subtractPoints(next, prev));
    let sideAxis = normalizePoint(crossPoints(surfaceNormal, tangent));
    if (Math.hypot(...sideAxis) < 1e-5) sideAxis = [1, 0, 0];
    const leftPlateEdge = addScaledPoint(center, sideAxis, -gapWidth * 0.5);
    const rightPlateEdge = addScaledPoint(center, sideAxis, gapWidth * 0.5);
    sharedBoundarySamples.push({
      t,
      center,
      tangent,
      surfaceNormal,
      sideAxis,
    });
    pairedBoundaryEdges.push({
      t,
      leftPlateEdge,
      rightPlateEdge,
      gapCenter: center,
      recessedFloorCenter: addScaledPoint(center, surfaceNormal, -0.026),
      measuredGap: pointDistance(leftPlateEdge, rightPlateEdge),
      surfaceNormal,
      sideAxis,
    });
  }
  const gapRadiusStats = summarizeDistances(pairedBoundaryEdges.map(sample => ({
    t: sample.t,
    distance: sample.measuredGap,
  })));
  const endpointDeltas = [
    Math.abs(pairedBoundaryEdges[0].measuredGap - gapWidth),
    Math.abs(pairedBoundaryEdges[pairedBoundaryEdges.length - 1].measuredGap - gapWidth),
  ];
  return {
    schema: 'LamellarPlateBoundaryMesh',
    mode: 'plate-boundary-topology-v0',
    id: `${gap.id}-intentional-gap-boundary-mesh`,
    targetBoundaryId: gap.id,
    sourceGapDescriptorId: gap.id,
    boundaryMode: 'intentional-gap',
    finalGeometryKind: 'constant-gap-chamfered-plate-boundary',
    sharedBoundarySamples,
    pairedBoundaryEdges,
    gapRadiusStats,
    endpointContinuityStats: {
      maxEndpointGapDelta: Math.max(...endpointDeltas),
      startGap: pairedBoundaryEdges[0].measuredGap,
      endGap: pairedBoundaryEdges[pairedBoundaryEdges.length - 1].measuredGap,
    },
    topologyFaces: [
      'topFace-left-return',
      'topFace-right-return',
      'left-chamfer-face',
      'right-chamfer-face',
      'left-side-wall',
      'right-side-wall',
      'recessed-gap-floor',
    ],
    topFace: 'paired plate top returns terminate at measured boundary edges',
    bevelFace: 'left/right chamfer faces descend into recessed gap floor',
    sideWall: 'side-wall faces give the gap thickness rather than a line overlay',
    decorativeRailFinalVisible: false,
    suppressedDecorativeHintIds: [`${gap.id}-future-mesh-boundary-input`],
    visualContract: 'one lower-cup discontinuity becomes an intentional constant-width chamfered gap',
  };
}

function createLamellarPlateBoundaryPlan(composition) {
  const targetGap = composition.expandedMacroRegionProxyPlan?.seamGaps?.find(gap => gap.id === 'lower-cup-socket-join-gap');
  const boundaryMeshes = targetGap ? [createLamellarPlateBoundaryMesh(targetGap)] : [];
  const suppressedDecorativeHintIds = boundaryMeshes.length
    ? (composition.expandedMacroRegionProxyPlan?.seamGaps || []).map(gap => `${gap.id}-future-mesh-boundary-input`)
    : [];
  const suppressedProxyFeatureIds = boundaryMeshes.length
    ? (composition.lamellarChannelMeshPlan?.stripMeshes || []).flatMap(strip => (strip.plateLips || []).map(lip => lip.id))
    : [];
  return {
    schema: 'LamellarPlateBoundaryPlan',
    mode: 'plate-boundary-topology-v0',
    boundaryMeshes,
    boundaryMeshCount: boundaryMeshes.length,
    targetBoundaryIds: boundaryMeshes.map(mesh => mesh.targetBoundaryId),
    suppressedDecorativeHintIds,
    suppressedProxyFeatureIds,
    decorativeSeamHintsFinalVisible: false,
    proxyPlateLipsFinalVisible: false,
    plateBoundaryTopologyVerdict: boundaryMeshes.length === 1
      ? 'one-intentional-gap-boundary-meshed'
      : 'no-plate-boundary-topology-mesh',
    nonGoals: [
      'do-not-add-transverse-crosscutting-band',
      'do-not-call-visual-lips-real-topology',
      'do-not-solve-whole-orb-boundary-system',
    ],
  };
}

function createLamellarInnerReturnSidePlaneMesh(gap) {
  const outerRadius = 1.108;
  const innerRadius = 1.036;
  const centerline = seamGapSeedPoints(gap.id, outerRadius);
  const outerPlateEdge = [];
  const innerReturnEdge = [];
  const sidePlaneSamples = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const outerCenter = samplePolyline(centerline, t);
    const prev = samplePolyline(centerline, Math.max(0, t - 0.03));
    const next = samplePolyline(centerline, Math.min(1, t + 0.03));
    const surfaceNormal = normalizePoint(outerCenter);
    const tangent = normalizePoint(subtractPoints(next, prev));
    let sideAxis = normalizePoint(crossPoints(surfaceNormal, tangent));
    if (Math.hypot(...sideAxis) < 1e-5) sideAxis = [1, 0, 0];
    const outer = addScaledPoint(scaledNormalizedPoint(outerCenter, outerRadius), sideAxis, 0.018);
    const innerBase = scaledNormalizedPoint(addScaledPoint(outerCenter, surfaceNormal, -0.01), innerRadius);
    const inner = addScaledPoint(innerBase, sideAxis, -0.012);
    const measuredThickness = pointDistance(outer, inner);
    outerPlateEdge.push({ t, point: outer, surfaceNormal, tangent, sideAxis });
    innerReturnEdge.push({ t, point: inner, surfaceNormal, tangent, sideAxis });
    sidePlaneSamples.push({
      t,
      outerPlateEdge: outer,
      innerReturnEdge: inner,
      midpoint: lerpPoint(outer, inner, 0.5),
      measuredThickness,
      surfaceNormal,
      tangent,
      sideAxis,
    });
  }
  const returnThicknessStats = summarizeDistances(sidePlaneSamples.map(sample => ({
    t: sample.t,
    distance: sample.measuredThickness,
  })));
  const targetThickness = returnThicknessStats.mean;
  const endpointThicknessDeltas = [
    Math.abs(sidePlaneSamples[0].measuredThickness - targetThickness),
    Math.abs(sidePlaneSamples[sidePlaneSamples.length - 1].measuredThickness - targetThickness),
  ];
  return {
    schema: 'LamellarInnerReturnSidePlaneMesh',
    mode: 'inner-return-side-plane-v0',
    id: `${gap.id}-inner-return-side-plane-mesh`,
    targetBoundaryId: gap.id,
    sourceGapDescriptorId: gap.id,
    boundaryRole: 'visible-side-rim-inner-return-candidate',
    declaredSecondLayer: false,
    finalGeometryKind: 'outer-edge-to-inner-return-side-wall',
    outerPlateEdge,
    innerReturnEdge,
    sidePlaneSamples,
    returnThicknessStats,
    endpointContinuityStats: {
      maxEndpointThicknessDelta: Math.max(...endpointThicknessDeltas),
      startThickness: sidePlaneSamples[0].measuredThickness,
      endThickness: sidePlaneSamples[sidePlaneSamples.length - 1].measuredThickness,
    },
    sideWallFaces: [
      'outer-chamfer-return',
      'inner-return-wall',
      'inner-return-chamfer',
      'side-plane-bridge',
    ],
    sideWallRenderableSurfaces: [
      'visible-return-sidewall-band',
      'outer-edge-shadow-break',
      'inner-return-highlight-break',
    ],
    sideWallVisibilityContract: {
      status: 'operator-visible',
      targetSurface: 'visible-return-sidewall-band',
      minimumScreenContrast: 0.18,
      minimumProjectedWidthPx: 10,
      materialIntent: 'slate-silver-side-plane-visible-against-black-carapace',
    },
    cleanTopologyWitness: {
      mode: 'clean-sidewall-topology-v0',
      materialMode: 'flat-diagnostic-no-metal',
      surfaceDetailMode: 'disabled',
      proxyClutterVisible: false,
      visibleSurfaces: [
        'outer-plate-edge-diagnostic',
        'inner-return-edge-diagnostic',
        'coupled-sidewall-face-diagnostic',
      ],
    },
    sideWallCouplingContract: {
      outerEdgeShared: true,
      innerEdgeShared: true,
      couplingVerdict: 'sidewall-face-shares-outer-and-inner-edge-vertices',
    },
    proxyRailFinalVisible: false,
    suppressedProxyHintIds: [`${gap.id}-future-mesh-boundary-input`],
    visualContract: 'visible right-side rim complication gets explicit side planes, not a declared second layer',
  };
}

function createLamellarInnerReturnPlan(composition) {
  const targetGap = composition.expandedMacroRegionProxyPlan?.seamGaps?.find(gap => gap.id === 'right-side-rim-reveal-gap');
  const sidePlaneMeshes = targetGap ? [createLamellarInnerReturnSidePlaneMesh(targetGap)] : [];
  return {
    schema: 'LamellarInnerReturnPlan',
    mode: 'inner-return-side-plane-v0',
    sidePlaneMeshes,
    sidePlaneMeshCount: sidePlaneMeshes.length,
    targetBoundaryIds: sidePlaneMeshes.map(mesh => mesh.targetBoundaryId),
    declaredSecondLayer: false,
    proxyRailFinalVisible: false,
    suppressedProxyHintIds: sidePlaneMeshes.flatMap(mesh => mesh.suppressedProxyHintIds),
    visibleSideWallSurfaceCount: sidePlaneMeshes.reduce((sum, mesh) => sum + (mesh.sideWallRenderableSurfaces?.length ? 1 : 0), 0),
    innerReturnSideWallVisibilityVerdict: sidePlaneMeshes.every(mesh => mesh.sideWallVisibilityContract?.status === 'operator-visible')
      ? 'visible-sidewall-render-surface-required'
      : 'sidewall-render-surface-not-yet-visible',
    cleanTopologyWitnessMode: sidePlaneMeshes.every(mesh => mesh.cleanTopologyWitness?.mode === 'clean-sidewall-topology-v0')
      ? 'clean-sidewall-topology-v0'
      : 'not-configured',
    cleanTopologyProxyClutterVisible: sidePlaneMeshes.some(mesh => mesh.cleanTopologyWitness?.proxyClutterVisible !== false),
    innerReturnSidePlaneTopologyVerdict: sidePlaneMeshes.length === 1
      ? 'one-visible-side-rim-return-side-plane-meshed'
      : 'no-inner-return-side-plane-mesh',
    nonGoals: [
      'do-not-declare-full-second-layer',
      'do-not-use-round-rail-as-side-plane',
      'do-not-broaden-to-all-rim-boundaries',
    ],
  };
}

function createChannelThroughLineAudit(composition) {
  const northEast = composition.macroAssemblages.find(assemblage => assemblage.id === 'north-east-counter-thrust');
  const candidates = [
    northEast ? createBandChannelCandidate(northEast, 'ne-body', 'ne-support') : null,
  ].filter(Boolean);
  const rightSideReveal = composition.expandedMacroRegionProxyPlan?.seamGaps?.find(gap => gap.id === 'right-side-rim-reveal-gap');
  if (rightSideReveal) {
    candidates.push({
      schema: 'ChannelThroughLineCandidate',
      id: rightSideReveal.id,
      sourceKind: 'MacroRegionSeamGapDescriptor',
      parentAssemblage: 'north-east-counter-thrust',
      generationPath: 'hardcoded-seam-hint',
      sharedParentSpine: false,
      gapSamples: [],
      gapDistanceStats: null,
      continuityEvidence: [
        'named seam/gap descriptor',
        'future mesh boundary input',
      ],
      limitation: 'seam hint polyline is not generated from the macro spine or solved as a constant-gap channel',
    });
  }
  const sampledCandidates = candidates.filter(candidate => candidate.gapDistanceStats);
  const maxRelativeVariation = Math.max(0, ...sampledCandidates.map(candidate => candidate.gapDistanceStats.relativeVariation));
  return {
    schema: 'ChannelThroughLineAudit',
    mode: 'channel-through-line-audit-v0',
    inspectedAttractorQuestion: 'are visible channels coherent through-lines or semi-aligned proxy artifacts',
    channelCandidates: candidates,
    maxRelativeGapVariation: maxRelativeVariation,
    channelAuditVerdict: 'semi-coherent-shared-spine-plus-hardcoded-seam-hint',
    constantGapVerdict: 'not-yet-proven',
    summary: 'one visible rail shares the parent macro spine; the side reveal remains a hardcoded seam hint; neither is a solved constant-gap channel corridor',
    requiredBeforeMeshing: [
      'ChannelThroughLineDescriptor',
      'paired-channel-edge-sampling',
      'constant-gap-distance-budget',
      'constant-gap-distance-budget-satisfied-or-explicitly-unsolved',
      'surface-attachment-proof',
    ],
  };
}

export function applyControlledOrbShellVariation(composition, descriptor) {
  const next = clone(composition);
  next.controlledVariation = descriptor;
  next.effectiveVariation = descriptor;
  const macroParameters = descriptor.effectiveParameters.macroAssemblages;
  const frontParameters = descriptor.effectiveParameters.frontApertureOwnership;
  for (const assemblage of next.macroAssemblages) {
    const params = macroParameters[assemblage.id];
    if (!params) continue;
    assemblage.sphericalTerritory.centerPhase += params.phaseShift;
    assemblage.sphericalTerritory.lonWidth = clamp(
      assemblage.sphericalTerritory.lonWidth * params.territoryWidthScale,
      0.48,
      1.24,
    );
    assemblage.spine.control.bow = clamp(assemblage.spine.control.bow + params.bowDelta, -0.62, 0.62);
    for (const [index, member] of assemblage.childBandPlan.entries()) {
      const sign = index % 2 === 0 ? -1 : 1;
      member.siblingOffset = clamp(
        member.siblingOffset * params.siblingOffsetScale + sign * params.phaseShift * 0.08,
        -0.24,
        0.24,
      );
      member.widthProfile.mid = clamp(member.widthProfile.mid * (0.96 + (params.territoryWidthScale - 1) * 0.35), 0.036, 0.18);
      member.widthProfile.root = member.widthProfile.mid * 0.72;
      member.widthProfile.tip = member.widthProfile.mid * 0.58;
      member.variationFlavor = params.terminationFlavor;
      if (params.terminationFlavor === 'socket-heavy-compatible' && member.role !== 'body') {
        member.endTermination.type = member.endTermination.type === 'amber-seam-cap' ? 'socket-cap' : member.endTermination.type;
      }
    }
    const body = assemblage.territoryBodyOccupancy;
    if (body) {
      body.widthProfile.mid = clamp(body.widthProfile.mid * params.territoryWidthScale, 0.16, 0.34);
      body.widthProfile.root = body.widthProfile.mid * 0.68;
      body.widthProfile.tip = body.widthProfile.mid * 0.72;
      body.variationFlavor = params.terminationFlavor;
      const aperturePressure = body.boundaryPressureField?.pressures?.find(pressure => pressure.type === 'aperture-bite');
      if (aperturePressure) aperturePressure.strength = clamp(aperturePressure.strength + params.apertureBiteDelta, 0.18, 0.48);
      body.boundaryCutProfile = makeBoundaryCutProfile(body.boundaryPressureField);
    }
  }
  next.macroBodyPromotion = createMacroBodyPromotionPlan(next);
  next.lowerSocketKeelAnatomyLaw = next.macroBodyPromotion.lowerSocketKeelAnatomyLaw || null;
  next.lowerSocketKeelAnatomyVerdict = next.macroBodyPromotion.lowerSocketKeelAnatomyVerdict;
  for (const assemblage of next.macroAssemblages) {
    assemblage.macroPromotedBody = next.macroBodyPromotion.promotedBodies.find(body => body.parentAssemblage === assemblage.id);
    assemblage.lowerSocketKeelAnatomyLaw = assemblage.macroPromotedBody?.lowerSocketKeelAnatomyLaw || null;
  }
  next.macroTorsionFieldPlan = createMacroTorsionFieldPlan(next, macroParameters);
  for (const assemblage of next.macroAssemblages) {
    const field = next.macroTorsionFieldPlan.fields.find(item => item.parentAssemblage === assemblage.id);
    assemblage.macroTorsionField = field;
    assemblage.spine.control.baseTwist = field.baselineTwist;
    assemblage.spine.control.effectiveTwist = field.effectiveTwist;
    assemblage.spine.control.torsionGradient = field.torsionGradient;
    assemblage.spine.control.surfaceRoll = field.surfaceRoll;
    assemblage.spine.control.phaseLag = field.phaseLag;
  }
  next.macroInterlockGraph = createMacroInterlockGraph(next);
  attachMacroInterlockEffects(next);
  next.lowerSocketEquatorialSocketJointLaw = createLowerSocketEquatorialSocketJointLaw(next);
  attachLowerSocketEquatorialSocketJointEffects(next);
  next.lowerSocketFamilyRoleLaw = createLowerSocketFamilyRoleLaw(next);
  attachLowerSocketFamilyRoleLaw(next);
  next.lowerSocketFamilyRoleVerdict = next.lowerSocketFamilyRoleLaw?.verdict || 'lower-socket-family-role-law-not-active';
  next.lowerSocketStripHonestyLaw = createLowerSocketStripHonestyLaw(next);
  attachLowerSocketStripHonestyLaw(next);
  next.lowerSocketStripHonestyVerdict = next.lowerSocketStripHonestyLaw
    ? 'lower-socket-strip-honesty-law-applied'
    : 'lower-socket-strip-honesty-law-not-active';
  if (next.macroBodyPromotion.lowerCupClosure) {
    next.frontApertureOwnership.lowerCupClosure = next.macroBodyPromotion.lowerCupClosure;
  }
  if (next.macroBodyPromotion.crossingTuckIntegration) {
    next.frontApertureOwnership.crossingTuckIntegration = next.macroBodyPromotion.crossingTuckIntegration;
  }
  next.crossingSubSurgePlan = createCrossingSubSurgePlan(frontParameters);
  next.cleanProxySurfacePolicy = createCleanProxySurfacePolicy();
  const northEast = next.macroAssemblages.find(assemblage => assemblage.id === 'north-east-counter-thrust');
  if (northEast) {
    northEast.crossingSubSurgePlan = next.crossingSubSurgePlan;
    northEast.macroPromotedBody.crossingSubSurgePlan = next.crossingSubSurgePlan;
  }
  next.frontApertureOwnership.crossingSubSurgePlan = next.crossingSubSurgePlan;
  if (next.frontApertureOwnership.crossingTuckIntegration) {
    next.frontApertureOwnership.crossingTuckIntegration.crossingSubSurgePlanId = next.crossingSubSurgePlan.id;
    next.frontApertureOwnership.crossingTuckIntegration.subSurgeRailRole = 'subordinate-edge-rail-not-lone-wand';
  }
  next.expandedMacroRegionProxyPlan = createExpandedMacroRegionProxyPlan(next, next.cleanProxySurfacePolicy);
  for (const assemblage of next.macroAssemblages) {
    assemblage.expandedRegionProxy = next.expandedMacroRegionProxyPlan.expandedRegions.find(region => region.parentAssemblage === assemblage.id);
    assemblage.cleanProxySurfacePolicy = next.cleanProxySurfacePolicy;
  }
  next.macroContactMap = createMacroContactMap(next);
  next.liveMacroSideWallPlan = createLiveMacroSideWallPlan(next);
  next.macroFamilySubstripPlan = createMacroFamilySubstripPlan(next);
  next.channelThroughLineAudit = createChannelThroughLineAudit(next);
  next.channelThroughLinePlan = createChannelThroughLinePlan(next, next.channelThroughLineAudit);
  next.lamellarChannelMeshPlan = createLamellarChannelMeshPlan(next.channelThroughLinePlan);
  next.lamellarPlateBoundaryPlan = createLamellarPlateBoundaryPlan(next);
  next.lamellarInnerReturnPlan = createLamellarInnerReturnPlan(next);
  next.frontApertureOwnership.effectiveVariation = frontParameters;
  for (const owner of next.frontApertureOwnership.owners) {
    owner.preservedByVariation = true;
    if (owner.role === 'lower-cupping-owner') owner.ownerDominance = frontParameters.ownerDominance;
    if (owner.role === 'crossing-tuck-owner') owner.crossingTuckPhase = frontParameters.crossingTuckPhase;
  }
  for (const voidRecord of next.AperturePressure.primaryVoids) {
    voidRecord.radius = [
      clamp(voidRecord.radius[0] * frontParameters.apertureBite, 0.26, 0.42),
      clamp(voidRecord.radius[1] * frontParameters.lowerCupDepth, 0.46, 0.68),
    ];
    voidRecord.effectiveVariation = {
      apertureBite: frontParameters.apertureBite,
      lowerCupDepth: frontParameters.lowerCupDepth,
    };
  }
  next.controlledVariation = descriptor;
  next.effectiveVariation = descriptor;
  return next;
}

export function createTargetOrbShellCompositionFixture(options = {}) {
  const controlledVariation = createControlledOrbShellVariationDescriptor(options);
  const sphericalClosureAnchors = [
    {
      id: 'crown-closure-anchor',
      role: 'crown-closure-anchor',
      proceduralFamily: 'low-order-harmonic-field-crown-closure',
      position: [0, 1.04, 0.14],
      generatedBy: ['sphere-closure', 'termination-socket-demand'],
    },
    {
      id: 'lower-socket-anchor',
      role: 'lower-socket-anchor',
      proceduralFamily: 'opposed-crown-socket-closure',
      position: [0, -1.04, 0.16],
      generatedBy: ['sphere-closure', 'lower-rim-absorption'],
    },
    {
      id: 'left-side-rim-pressure-anchor',
      role: 'side-rim-pressure-anchor',
      proceduralFamily: 'pressure-field-boundary',
      position: [-0.86, -0.02, 0.54],
      generatedBy: ['side-gill-pressure', 'macro-territory-boundary'],
    },
    {
      id: 'right-side-rim-pressure-anchor',
      role: 'side-rim-pressure-anchor',
      proceduralFamily: 'pressure-field-boundary',
      position: [0.86, 0.02, 0.54],
      generatedBy: ['side-gill-pressure', 'macro-territory-boundary'],
    },
  ];

  const northWest = [
    band('nw-body', 'north-west-dominant-thrust', 'body', -0.03, 0.16, [
      { t0: 0, t1: 1, layer: 'outer', trigger: 'dominant-thrust' },
    ], 'crown-lock', 'rim-absorption'),
    band('nw-rail', 'north-west-dominant-thrust', 'rail', 0.12, 0.064, [
      { t0: 0, t1: 0.48, layer: 'outer', trigger: 'edge-support' },
      { t0: 0.48, t1: 0.62, layer: 'under-neighbor', trigger: 'neighbor-dominance' },
      { t0: 0.62, t1: 1, layer: 'outer', trigger: 'terminal-reseat' },
    ], 'crown-lock', 'socket-cap'),
    band('nw-hop', 'north-west-dominant-thrust', 'hopping-member', -0.16, 0.052, [
      { t0: 0, t1: 0.36, layer: 'outer', trigger: 'aperture-frame' },
      { t0: 0.36, t1: 0.66, layer: 'inner-support', trigger: 'aperture-pressure' },
      { t0: 0.66, t1: 1, layer: 'outer', trigger: 'rim-absorption' },
    ], 'under-tuck', 'amber-seam-cap'),
  ];
  const northEast = [
    band('ne-body', 'north-east-counter-thrust', 'body', 0.02, 0.145, [
      { t0: 0, t1: 0.44, layer: 'outer', trigger: 'counter-thrust' },
      { t0: 0.44, t1: 0.56, layer: 'under-neighbor', trigger: 'dominance-crossing' },
      { t0: 0.56, t1: 1, layer: 'outer', trigger: 'aperture-clearance' },
    ], 'beveled-free-cap', 'crown-lock'),
    band('ne-support', 'north-east-counter-thrust', 'support', -0.13, 0.054, [
      { t0: 0, t1: 1, layer: 'outer', trigger: 'sibling-support' },
    ], 'rim-absorption', 'socket-cap'),
  ];
  const equator = [
    band('eq-body', 'equatorial-cupping-whorl', 'body', 0.0, 0.13, [
      { t0: 0, t1: 1, layer: 'outer', trigger: 'aperture-bowl-frame' },
    ], 'rim-absorption', 'neighbor-tuck'),
    band('eq-rail', 'equatorial-cupping-whorl', 'rail', 0.12, 0.048, [
      { t0: 0, t1: 0.28, layer: 'outer', trigger: 'silhouette-budget' },
      { t0: 0.28, t1: 0.52, layer: 'inner-support', trigger: 'front-aperture-pressure' },
      { t0: 0.52, t1: 1, layer: 'outer', trigger: 'side-gill-frame' },
    ], 'socket-cap', 'amber-seam-cap'),
  ];
  const crown = [
    band('cr-lock', 'polar-crown-lock', 'body', 0.0, 0.1, [
      { t0: 0, t1: 1, layer: 'outer', trigger: 'sphere-closure' },
    ], 'crown-lock', 'crown-lock'),
    band('cr-cover', 'polar-crown-lock', 'cap-cover', 0.16, 0.046, [
      { t0: 0, t1: 1, layer: 'outer', trigger: 'termination-cover' },
    ], 'beveled-free-cap', 'neighbor-tuck'),
  ];
  const lowerKeel = [
    band('lk-body', 'lower-socket-keel', 'body', 0.01, 0.115, [
      { t0: 0, t1: 0.36, layer: 'outer', trigger: 'lower-socket-closure' },
      { t0: 0.36, t1: 0.58, layer: 'inner-support', trigger: 'primary-aperture-underfold' },
      { t0: 0.58, t1: 1, layer: 'outer', trigger: 'right-rim-re-emergence' },
    ], 'socket-cap', 'rim-absorption'),
    band('lk-edge', 'lower-socket-keel', 'edge-rail', -0.12, 0.044, [
      { t0: 0, t1: 1, layer: 'outer', trigger: 'keel-side-lip' },
    ], 'under-tuck', 'amber-seam-cap'),
  ];

  const allMacroAssemblages = [
    macro('north-west-dominant-thrust', 'dominant-thrust', 1, -0.72, 1, {
      latRange: [-1.12, 1.02],
      lonWidth: 0.82,
    }, northWest, {
      control: { startLat: 1.1, endLat: -1.08, twist: 1.52, bow: -0.22 },
      closureAnchorIds: ['crown-closure-anchor', 'lower-socket-anchor', 'left-side-rim-pressure-anchor'],
      neighborRelations: [
        { target: 'north-east-counter-thrust', relation: 'passes-over-at-front-crown' },
        { target: 'equatorial-cupping-whorl', relation: 'frames-primary-aperture-left-edge' },
      ],
    }),
    macro('north-east-counter-thrust', 'counter-thrust', 0.82, 0.62, -1, {
      latRange: [-1.04, 1.18],
      lonWidth: 0.68,
    }, northEast, {
      spineFamily: 'coupled-great-circle-lopsided-loxodrome',
      control: { startLat: 1.18, endLat: -0.98, twist: 1.28, bow: 0.28 },
      closureAnchorIds: ['crown-closure-anchor', 'lower-socket-anchor', 'right-side-rim-pressure-anchor'],
      neighborRelations: [
        { target: 'north-west-dominant-thrust', relation: 'tucks-under-front-crossing' },
        { target: 'polar-crown-lock', relation: 'terminates-into-upper-crown' },
      ],
    }),
    macro('equatorial-cupping-whorl', 'supporting-whorl', 0.64, -2.18, 1, {
      latRange: [-0.82, 0.34],
      lonWidth: 1.04,
    }, equator, {
      spineFamily: 'aperture-repulsor-flow-on-spherical-atlas',
      control: { startLat: -0.78, endLat: 0.38, twist: 1.08, bow: 0.42 },
      entryZone: 'left-lower-rim',
      exitZone: 'right-side-gill-rim',
      closureAnchorIds: ['lower-socket-anchor', 'left-side-rim-pressure-anchor', 'right-side-rim-pressure-anchor'],
      widthFactor: 0.28,
      intervals: [
        { t0: 0, t1: 0.32, layer: 'outer', trigger: 'silhouette-budget' },
        { t0: 0.32, t1: 0.58, layer: 'inner-support', trigger: 'primary-aperture-pressure' },
        { t0: 0.58, t1: 1, layer: 'outer', trigger: 'side-gill-frame' },
      ],
      neighborRelations: [
        { target: 'north-west-dominant-thrust', relation: 'defines-primary-aperture-bottom-left' },
        { target: 'north-east-counter-thrust', relation: 'leaves-front-negative-space' },
      ],
    }),
    macro('polar-crown-lock', 'crown-lock', 0.5, 2.6, -1, {
      latRange: [0.72, 1.28],
      lonWidth: 0.74,
    }, crown, {
      spineFamily: 'low-order-harmonic-field-crown-closure',
      control: { startLat: 1.26, endLat: 0.72, twist: 0.72, bow: -0.08 },
      entryZone: 'upper-back-crown',
      exitZone: 'upper-front-crown',
      closureAnchorIds: ['crown-closure-anchor', 'left-side-rim-pressure-anchor', 'right-side-rim-pressure-anchor'],
      widthFactor: 0.24,
      intervals: [
        { t0: 0, t1: 1, layer: 'outer', trigger: 'termination-socket-demand' },
      ],
      neighborRelations: [
        { target: 'north-west-dominant-thrust', relation: 'receives-dominant-thrust-cap' },
        { target: 'north-east-counter-thrust', relation: 'locks-counter-thrust-end' },
      ],
    }),
    macro('lower-socket-keel', 'lower-socket-keel', 0.46, -1.42, -1, {
      latRange: [-1.2, -0.12],
      lonWidth: 0.7,
    }, lowerKeel, {
      spineFamily: 'opposed-crown-socket-closure',
      control: { startLat: -1.18, endLat: -0.14, twist: 0.86, bow: -0.18 },
      entryZone: 'lower-back-socket',
      exitZone: 'lower-front-rim',
      closureAnchorIds: ['lower-socket-anchor', 'left-side-rim-pressure-anchor', 'right-side-rim-pressure-anchor'],
      widthFactor: 0.22,
      intervals: [
        { t0: 0, t1: 0.34, layer: 'outer', trigger: 'lower-socket-closure' },
        { t0: 0.34, t1: 0.58, layer: 'inner-support', trigger: 'aperture-underfold' },
        { t0: 0.58, t1: 1, layer: 'outer', trigger: 'right-rim-re-emergence' },
      ],
      neighborRelations: [
        { target: 'equatorial-cupping-whorl', relation: 'may-replace-lower-cup-as-bottom-socket-support' },
        { target: 'north-west-dominant-thrust', relation: 'anchors-below-dominant-thrust' },
        { target: 'north-east-counter-thrust', relation: 'keeps-counter-thrust-from-floating' },
      ],
    }),
  ];
  const macroAssemblageCountLaw = createMacroAssemblageCountLaw(controlledVariation, allMacroAssemblages);
  const selectedMacroAssemblageIdSet = new Set(macroAssemblageCountLaw.selectedMacroAssemblageIds);
  const macroAssemblages = allMacroAssemblages.filter(assemblage => selectedMacroAssemblageIdSet.has(assemblage.id));

  const composition = {
    schema: 'OrbShellComposition',
    identity: ORB_SHELL_COMPOSITION_IDENTITY,
    baselineDisposition: ORB_SHELL_COMPOSITION_BASELINE,
    sourceAttractor: 'evil_orb_outer_shell_source_image',
    stableFamilyIdentity: [
      'three-to-five-major-macro-thrusts',
      'child-band-families-not-independent-strips',
      'sparse-local-layer-hops',
      'designed-termination-sockets',
      'aperture-pressure-as-constraint-not-root-mask',
    ],
    variableParameters: [
      'macro phase',
      'handedness',
      'territory width',
      'child sibling offset',
      'local bow',
      'compatible termination choice',
    ],
    macroAssemblages,
    macroAssemblageCountLaw,
    sphericalClosureAnchors,
    frontApertureOwnership: makePrimaryApertureFrame(),
    AperturePressure: {
      schema: 'AperturePressure',
      proceduralFamily: 'aperture-pressure-field-from-macro-thrusts',
      primaryVoids: [
        {
          id: 'primary-front-teardrop-void',
          generatedBy: ['north-west-dominant-thrust', 'north-east-counter-thrust', 'equatorial-cupping-whorl'],
          center: [0.02, -0.02, 0.98],
          radius: [0.34, 0.55],
          stableRole: 'front-readable-negative-space',
        },
      ],
      secondaryGills: [
        { id: 'left-lower-gill', generatedBy: ['equatorial-cupping-whorl', 'north-west-dominant-thrust'] },
        { id: 'right-side-gill', generatedBy: ['north-east-counter-thrust', 'equatorial-cupping-whorl'] },
      ],
      coreExposureBudget: 0.24,
      forbiddenFailureClasses: [
        'cage',
        'wicker',
        'strip-soup',
        'equal-width-net',
        'arbitrary-hole-mask',
        'core-dominates-shell',
      ],
    },
    inverseProceduralHypotheses: {
      macroImpulseLines: [
        'biased-spherical-vector-field',
        'coupled-great-circle-lopsided-loxodrome',
        'aperture-repulsor-flow-on-spherical-atlas',
        'low-order-harmonic-field-crown-closure',
      ],
      territories: ['swept-voronoi-territory', 'neighbor-pressure-field'],
      childBands: ['offset-tributary-band-family', 'split-merge-sibling-band-family'],
      terminations: ['termination-pressure', 'crown-lock', 'rim-absorption', 'socket-cap'],
    },
  };
  return applyControlledOrbShellVariation(composition, controlledVariation);
}

function sampleSpinePoint(assemblage, bandMember, t, radius = 1.04) {
  const control = assemblage.spine.control;
  const torsion = assemblage.macroTorsionField;
  const anatomyT = lowerSocketAnatomyParametricT(assemblage, t);
  const roleEffect = lowerSocketFamilyRoleEffectAt(assemblage, t);
  const socketAlignmentDamping = 1 - clamp(roleEffect.socketAlignmentPull * roleEffect.terminalAbsorption, 0, 0.88);
  const lat = control.startLat + (control.endLat - control.startLat) * anatomyT;
  const widthPressure = assemblage.sphericalTerritory.lonWidth * 0.12;
  const rawSiblingOffset = bandMember.siblingOffset + Math.sin(Math.PI * anatomyT) * widthPressure * 0.18;
  const siblingOffset = rawSiblingOffset * socketAlignmentDamping;
  const effectiveTwist = control.effectiveTwist ?? control.twist;
  const torsionWave = torsion
    ? Math.sin(TAU * anatomyT + torsion.phaseLag) * torsion.torsionGradient * Math.sin(Math.PI * anatomyT) * socketAlignmentDamping
    : 0;
  const surfaceRollBias = torsion
    ? torsion.surfaceRoll * Math.sin(Math.PI * anatomyT) * (bandMember.siblingOffset || 0) * 0.9 * socketAlignmentDamping
    : 0;
  const lon = assemblage.sphericalTerritory.centerPhase
    + assemblage.handedness * effectiveTwist * (anatomyT - 0.5)
    + Math.sin(Math.PI * anatomyT) * control.bow * socketAlignmentDamping
    + torsionWave
    + surfaceRollBias
    + siblingOffset;
  const layer = bandMember.layerIntervals.find(interval => t >= interval.t0 && t <= interval.t1)?.layer || 'outer';
  const layerBias = layer === 'inner-support' ? -0.045 : layer === 'under-neighbor' ? -0.025 : 0.02;
  const interlock = macroInterlockEffectAt(assemblage, t);
  const lowerSocket = lowerSocketAnatomyEffectAt(assemblage, t);
  const sharedSeam = sharedSocketSeamEffectAt(assemblage, t);
  return spherePoint(lat, lon, radius + layerBias - interlock.depthInset - lowerSocket.radialInset + sharedSeam.radialDelta + roleEffect.radialDelta);
}

function sampleSpine(THREE, assemblage, bandMember, t, radius = 1.04) {
  return makeVec3(THREE, sampleSpinePoint(assemblage, bandMember, t, radius));
}

function torsionSurfaceFrame(THREE, assemblage, side, normal, t, strength = 1) {
  const field = assemblage.macroTorsionField;
  if (!field) return { side, normal };
  const roll = (
    field.surfaceRoll * Math.sin(Math.PI * t)
    + field.torsionGradient * Math.sin(TAU * t + field.phaseLag) * 0.35
  ) * strength;
  if (Math.abs(roll) < 1e-5) return { side, normal };
  const sideAxis = side.clone().multiplyScalar(Math.cos(roll)).add(normal.clone().multiplyScalar(Math.sin(roll))).normalize();
  const normalAxis = normal.clone().multiplyScalar(Math.cos(roll * 0.42)).add(side.clone().multiplyScalar(-Math.sin(roll * 0.42))).normalize();
  return {
    side: sideAxis.lengthSq() > 1e-8 ? sideAxis : new THREE.Vector3(1, 0, 0),
    normal: normalAxis.lengthSq() > 1e-8 ? normalAxis : normal,
  };
}

function topologyReliefStrength(assemblage, t) {
  const intervals = assemblage.layerItinerary?.intervals || [];
  let strength = macroInterlockEffectAt(assemblage, t).topologyRelief;
  strength = Math.max(strength, sharedSocketSeamEffectAt(assemblage, t).topologyRelief);
  strength = Math.max(strength, lowerSocketFamilyRoleEffectAt(assemblage, t).topologyRelief);
  for (const interval of intervals) {
    const isTopologyCarrier = interval.layer === 'under-neighbor' || interval.layer === 'inner-support';
    if (!isTopologyCarrier || t < interval.t0 - 0.08 || t > interval.t1 + 0.08) continue;
    const center = (interval.t0 + interval.t1) * 0.5;
    const radius = Math.max(0.045, (interval.t1 - interval.t0) * 0.62);
    const levelChangeDip = Math.exp(-Math.pow((t - center) / radius, 2));
    strength = Math.max(strength, interval.layer === 'inner-support' ? levelChangeDip * 0.86 : levelChangeDip * 0.68);
  }
  return clamp(strength, 0, 1);
}

function makeBandTube(THREE, assemblage, bandMember) {
  const points = [];
  for (let i = 0; i < 72; i++) points.push(sampleSpine(THREE, assemblage, bandMember, i / 71));
  const curve = new THREE.CatmullRomCurve3(points);
  const width = bandMember.widthProfile.mid;
  return new THREE.TubeGeometry(curve, 96, Math.max(0.012, width * 0.14), 10, false);
}

function makeMacroTerritoryBodyGeometry(THREE, assemblage) {
  const body = assemblage.territoryBodyOccupancy;
  const rowCount = 64;
  const columnCount = 9;
  const vertices = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const cutProfile = body.boundaryCutProfile || [];

  const centerline = [];
  for (let row = 0; row < rowCount; row++) {
    const t = row / (rowCount - 1);
    centerline.push(sampleSpine(THREE, assemblage, {
      siblingOffset: 0,
      layerIntervals: assemblage.layerItinerary.intervals,
    }, t, 1.025));
  }

  for (let row = 0; row < rowCount; row++) {
    const t = row / (rowCount - 1);
    const center = centerline[row];
    const prev = centerline[Math.max(0, row - 1)];
    const next = centerline[Math.min(rowCount - 1, row + 1)];
    const normal = center.clone().normalize();
    const tangent = next.clone().sub(prev).normalize();
    let side = new THREE.Vector3().crossVectors(normal, tangent);
    if (side.lengthSq() < 1e-8) side = new THREE.Vector3(1, 0, 0);
    side.normalize();
    const frame = torsionSurfaceFrame(THREE, assemblage, side, normal, t, 0.62);
    const sideAxis = frame.side;
    const normalAxis = frame.normal;
    const profile = Math.pow(Math.sin(Math.PI * t), 0.42);
    const terminalScale = 0.42 + 0.58 * profile;
    const nearestCut = cutProfile.reduce((best, item) => (
      Math.abs(item.t - t) < Math.abs(best.t - t) ? item : best
    ), cutProfile[0] || { leftScale: 1, rightScale: 1, t: 0 });
    const leftWidth = body.widthProfile.mid * terminalScale * nearestCut.leftScale;
    const rightWidth = body.widthProfile.mid * terminalScale * nearestCut.rightScale;
    const lift = body.thicknessProfile.mid * (0.45 + 0.55 * profile);
    for (let col = 0; col < columnCount; col++) {
      const u = col / (columnCount - 1);
      const q = u * 2 - 1;
      const sideWidth = q < 0 ? leftWidth : rightWidth;
      const crown = 1 - Math.pow(Math.abs(q), 1.8) * 0.16;
      const pos = center.clone()
        .addScaledVector(sideAxis, q * sideWidth)
        .addScaledVector(normalAxis, lift * crown);
      vertices.push(pos.x, pos.y, pos.z);
      normals.push(normalAxis.x, normalAxis.y, normalAxis.z);
      uvs.push(u, t);
    }
  }

  for (let row = 0; row < rowCount - 1; row++) {
    for (let col = 0; col < columnCount - 1; col++) {
      const a = row * columnCount + col;
      const b = a + 1;
      const c = (row + 1) * columnCount + col + 1;
      const d = (row + 1) * columnCount + col;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.MacroTerritoryBody = body;
  geometry.userData.MacroTorsionField = assemblage.macroTorsionField;
  return geometry;
}

function makeMacroPromotedBodyGeometry(THREE, assemblage) {
  const body = assemblage.territoryBodyOccupancy;
  const promoted = assemblage.macroPromotedBody;
  const rowCount = 72;
  const columnCount = 13;
  const vertices = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const cutProfile = body.boundaryCutProfile || [];
  const centerline = [];
  for (let row = 0; row < rowCount; row++) {
    const t = row / (rowCount - 1);
    centerline.push(sampleSpine(THREE, assemblage, {
      siblingOffset: 0,
      layerIntervals: assemblage.layerItinerary.intervals,
    }, t, 1.045));
  }

  for (let row = 0; row < rowCount; row++) {
    const t = row / (rowCount - 1);
    const center = centerline[row];
    const prev = centerline[Math.max(0, row - 1)];
    const next = centerline[Math.min(rowCount - 1, row + 1)];
    const normal = center.clone().normalize();
    const tangent = next.clone().sub(prev).normalize();
    let side = new THREE.Vector3().crossVectors(normal, tangent);
    if (side.lengthSq() < 1e-8) side = new THREE.Vector3(1, 0, 0);
    side.normalize();
    const frame = torsionSurfaceFrame(THREE, assemblage, side, normal, t, 1);
    const sideAxis = frame.side;
    const normalAxis = frame.normal;
    const profile = Math.pow(Math.sin(Math.PI * t), 0.34);
    const terminalScale = 0.52 + 0.48 * profile;
    const nearestCut = cutProfile.reduce((best, item) => (
      Math.abs(item.t - t) < Math.abs(best.t - t) ? item : best
    ), cutProfile[0] || { leftScale: 1, rightScale: 1, t: 0 });
    const expanded = assemblage.expandedRegionProxy;
    const scale = (promoted?.promotedBodyScale || 1.22) * (expanded?.coverageScale || 1);
    const interlock = macroInterlockEffectAt(assemblage, t);
    const lowerSocket = lowerSocketAnatomyEffectAt(assemblage, t);
    const sharedSeam = sharedSocketSeamEffectAt(assemblage, t);
    const roleEffect = lowerSocketFamilyRoleEffectAt(assemblage, t);
    const widthScale = interlock.widthScale * lowerSocket.widthScale * sharedSeam.widthScale * roleEffect.widthScale;
    const leftWidth = body.widthProfile.mid * scale * terminalScale * promotedBodySideScale(promoted, 'left', nearestCut) * widthScale;
    const rightWidth = body.widthProfile.mid * scale * terminalScale * promotedBodySideScale(promoted, 'right', nearestCut) * widthScale;
    const lift = body.thicknessProfile.mid * (0.85 + 0.75 * profile) + interlock.normalLiftDelta + lowerSocket.normalLiftDelta + sharedSeam.normalLiftDelta + roleEffect.normalLiftDelta;
    const topologyDip = topologyReliefStrength(assemblage, t);
    for (let col = 0; col < columnCount; col++) {
      const u = col / (columnCount - 1);
      const q = u * 2 - 1;
      const sideWidth = q < 0 ? leftWidth : rightWidth;
      const diagnosticCrown = 1 - Math.pow(Math.abs(q), 2.2) * 0.18;
      const topologyDipMask = (1 - Math.pow(Math.abs(q), 1.4)) * topologyDip;
      const crown = Math.max(0.58, diagnosticCrown - topologyDipMask * 0.28);
      const pos = center.clone()
        .addScaledVector(sideAxis, q * sideWidth)
        .addScaledVector(normalAxis, lift * crown - topologyDipMask * 0.018);
      vertices.push(pos.x, pos.y, pos.z);
      normals.push(normalAxis.x, normalAxis.y, normalAxis.z);
      uvs.push(u, t);
    }
  }

  for (let row = 0; row < rowCount - 1; row++) {
    for (let col = 0; col < columnCount - 1; col++) {
      const a = row * columnCount + col;
      const b = a + 1;
      const c = (row + 1) * columnCount + col + 1;
      const d = (row + 1) * columnCount + col;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.MacroPromotedBody = promoted;
  geometry.userData.ExpandedMacroRegionProxy = assemblage.expandedRegionProxy;
  geometry.userData.MacroTorsionField = assemblage.macroTorsionField;
  return geometry;
}

function makeMacroPromotedBodySideWallGeometry(THREE, sideWall) {
  const rowCount = sideWall.sideWallSamples.length;
  const columnCount = 3;
  const vertices = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (let row = 0; row < rowCount; row++) {
    const sample = sideWall.sideWallSamples[row];
    const outer = new THREE.Vector3(...sample.outer);
    const inner = new THREE.Vector3(...sample.inner);
    const tangent = new THREE.Vector3(...sample.tangent).normalize();
    const thicknessAxis = inner.clone().sub(outer).normalize();
    let faceNormal = new THREE.Vector3().crossVectors(tangent, thicknessAxis).normalize();
    if (faceNormal.lengthSq() < 1e-8) faceNormal = new THREE.Vector3(...sample.sideAxis).normalize();
    const points = [
      outer,
      outer.clone().lerp(inner, 0.5),
      inner,
    ];
    for (let col = 0; col < columnCount; col++) {
      const point = points[col];
      vertices.push(point.x, point.y, point.z);
      normals.push(faceNormal.x, faceNormal.y, faceNormal.z);
      uvs.push(col / (columnCount - 1), sample.t);
    }
  }

  for (let row = 0; row < rowCount - 1; row++) {
    for (let col = 0; col < columnCount - 1; col++) {
      const a = row * columnCount + col;
      const b = a + 1;
      const c = (row + 1) * columnCount + col + 1;
      const d = (row + 1) * columnCount + col;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.LiveMacroSideWall = sideWall;
  return geometry;
}

function makeMacroPromotedBodyTerminalCapGeometry(THREE, terminalCap) {
  const points = [
    terminalCap.capSamples.outerLeft,
    terminalCap.capSamples.outerMid,
    terminalCap.capSamples.outerRight,
    terminalCap.capSamples.innerLeft,
    terminalCap.capSamples.innerMid,
    terminalCap.capSamples.innerRight,
  ].map(point => new THREE.Vector3(...point));
  const indices = [
    0, 1, 3,
    1, 4, 3,
    1, 2, 4,
    2, 5, 4,
  ];
  const capNormal = new THREE.Vector3()
    .crossVectors(points[2].clone().sub(points[0]), points[3].clone().sub(points[0]))
    .normalize();
  const normals = [];
  for (let i = 0; i < points.length; i++) normals.push(capNormal.x, capNormal.y, capNormal.z);
  const vertices = points.flatMap(point => [point.x, point.y, point.z]);
  const uvs = [
    0, 0,
    0.5, 0,
    1, 0,
    0, 1,
    0.5, 1,
    1, 1,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.LiveMacroTerminalCap = terminalCap;
  return geometry;
}

function makeAperturePressureRing(THREE, voidRecord) {
  const points = [];
  for (let i = 0; i <= 120; i++) {
    const a = (i / 120) * TAU;
    points.push(new THREE.Vector3(...aperturePressureRingPoint(voidRecord, a)));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, true), 120, 0.006, 8, true);
}

function makeApertureTangencyVectorGeometry(THREE, startPoint, direction, length = 0.18, radius = 0.005) {
  const start = new THREE.Vector3(...startPoint);
  const end = start.clone().add(new THREE.Vector3(...direction).normalize().multiplyScalar(length));
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3([start, end]), 1, radius, 8, false);
}

function makeMacroContactSegmentGeometry(THREE, contact, radius = 0.006) {
  const start = new THREE.Vector3(...contact.closestApproach.sourcePoint);
  const end = new THREE.Vector3(...contact.closestApproach.targetPoint);
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3([start, end]), 1, radius, 8, false);
}

function makeSeamGapHintGeometry(THREE, gap) {
  const points = seamGapSeedPoints(gap.id, 1.085).map(point => new THREE.Vector3(...point));
  const radius = gap.type === 'lower-socket-join' ? 0.004 : 0.006;
  const curve = new THREE.CatmullRomCurve3(points);
  const geometry = new THREE.TubeGeometry(curve, 48, radius, 6, false);
  geometry.userData.MacroRegionSeamGapDescriptor = gap;
  return geometry;
}

function makeLamellarPlateBoundaryGeometry(THREE, boundary) {
  const rowCount = boundary.pairedBoundaryEdges.length;
  const columnCount = 7;
  const vertices = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const chamferHeight = 0.034;
  const floorDepth = 0.03;
  const floorInset = 0.22;
  for (let row = 0; row < rowCount; row++) {
    const sample = boundary.pairedBoundaryEdges[row];
    const left = new THREE.Vector3(...sample.leftPlateEdge);
    const right = new THREE.Vector3(...sample.rightPlateEdge);
    const center = new THREE.Vector3(...sample.gapCenter);
    const normal = new THREE.Vector3(...sample.surfaceNormal).normalize();
    const side = new THREE.Vector3(...sample.sideAxis).normalize();
    const leftFloor = left.clone().lerp(center, floorInset).addScaledVector(normal, -floorDepth);
    const rightFloor = right.clone().lerp(center, floorInset).addScaledVector(normal, -floorDepth);
    const points = [
      left.clone().addScaledVector(side, -0.032).addScaledVector(normal, chamferHeight * 0.42),
      left.clone().addScaledVector(normal, chamferHeight),
      leftFloor,
      center.clone().addScaledVector(normal, -floorDepth * 1.08),
      rightFloor,
      right.clone().addScaledVector(normal, chamferHeight),
      right.clone().addScaledVector(side, 0.032).addScaledVector(normal, chamferHeight * 0.42),
    ];
    for (let col = 0; col < columnCount; col++) {
      const point = points[col];
      vertices.push(point.x, point.y, point.z);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(col / (columnCount - 1), sample.t);
    }
  }
  for (let row = 0; row < rowCount - 1; row++) {
    for (let col = 0; col < columnCount - 1; col++) {
      const a = row * columnCount + col;
      const b = a + 1;
      const c = (row + 1) * columnCount + col + 1;
      const d = (row + 1) * columnCount + col;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.LamellarPlateBoundaryMesh = boundary;
  return geometry;
}

function makeLamellarInnerReturnSidePlaneGeometry(THREE, mesh) {
  const rowCount = mesh.sidePlaneSamples.length;
  const columnCount = 5;
  const vertices = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (let row = 0; row < rowCount; row++) {
    const sample = mesh.sidePlaneSamples[row];
    const outer = new THREE.Vector3(...sample.outerPlateEdge);
    const inner = new THREE.Vector3(...sample.innerReturnEdge);
    const normal = new THREE.Vector3(...sample.surfaceNormal).normalize();
    const tangent = new THREE.Vector3(...sample.tangent).normalize();
    const sideNormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();
    const points = [
      outer.clone().addScaledVector(normal, 0.018),
      outer.clone().lerp(inner, 0.18).addScaledVector(normal, 0.008),
      outer.clone().lerp(inner, 0.5).addScaledVector(sideNormal, 0.004),
      outer.clone().lerp(inner, 0.82).addScaledVector(normal, -0.006),
      inner.clone().addScaledVector(normal, -0.014),
    ];
    for (let col = 0; col < columnCount; col++) {
      const point = points[col];
      vertices.push(point.x, point.y, point.z);
      normals.push(sideNormal.x, sideNormal.y, sideNormal.z);
      uvs.push(col / (columnCount - 1), sample.t);
    }
  }
  for (let row = 0; row < rowCount - 1; row++) {
    for (let col = 0; col < columnCount - 1; col++) {
      const a = row * columnCount + col;
      const b = a + 1;
      const c = (row + 1) * columnCount + col + 1;
      const d = (row + 1) * columnCount + col;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.LamellarInnerReturnSidePlaneMesh = mesh;
  return geometry;
}

function makeLamellarInnerReturnSideWallGeometry(THREE, mesh) {
  const rowCount = mesh.sidePlaneSamples.length;
  const columnCount = 4;
  const vertices = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (let row = 0; row < rowCount; row++) {
    const sample = mesh.sidePlaneSamples[row];
    const outer = new THREE.Vector3(...sample.outerPlateEdge);
    const inner = new THREE.Vector3(...sample.innerReturnEdge);
    const tangent = new THREE.Vector3(...sample.tangent).normalize();
    const sideAxis = new THREE.Vector3(...sample.sideAxis).normalize();
    const surfaceNormal = new THREE.Vector3(...sample.surfaceNormal).normalize();
    const faceNormal = new THREE.Vector3().crossVectors(tangent, surfaceNormal).normalize();
    if (faceNormal.dot(sideAxis) < 0) faceNormal.multiplyScalar(-1);
    const points = [
      outer.clone(),
      outer.clone().lerp(inner, 0.33),
      outer.clone().lerp(inner, 0.67),
      inner.clone(),
    ];
    for (let col = 0; col < columnCount; col++) {
      const point = points[col];
      vertices.push(point.x, point.y, point.z);
      normals.push(faceNormal.x, faceNormal.y, faceNormal.z);
      uvs.push(col / (columnCount - 1), sample.t);
    }
  }
  for (let row = 0; row < rowCount - 1; row++) {
    for (let col = 0; col < columnCount - 1; col++) {
      const a = row * columnCount + col;
      const b = a + 1;
      const c = (row + 1) * columnCount + col + 1;
      const d = (row + 1) * columnCount + col;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.LamellarInnerReturnSidePlaneMesh = mesh;
  geometry.userData.visibleSideWallSurface = mesh.sideWallVisibilityContract;
  return geometry;
}

function makeLamellarInnerReturnDiagnosticEdgeGeometry(THREE, edgeSamples, radius = 0.006) {
  const points = edgeSamples.map(sample => new THREE.Vector3(...sample.point));
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, Math.max(8, points.length * 2), radius, 8, false);
}

function makeLamellarChannelStripGeometry(THREE, strip) {
  const rowCount = strip.edgeSamples.length;
  const columnCount = 5;
  const vertices = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const centerColumn = (columnCount - 1) * 0.5;
  for (let row = 0; row < rowCount; row++) {
    const sample = strip.edgeSamples[row];
    const left = new THREE.Vector3(...sample.leftEdge);
    const right = new THREE.Vector3(...sample.rightEdge);
    const normal = new THREE.Vector3(...sample.surfaceNormal).normalize();
    const thickness = strip.thicknessBudget.target;
    for (let col = 0; col < columnCount; col++) {
      const u = col / (columnCount - 1);
      const q = Math.abs(col - centerColumn) / centerColumn;
      const crown = (1 - q * q) * thickness;
      const point = left.clone().lerp(right, u).addScaledVector(normal, crown);
      vertices.push(point.x, point.y, point.z);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(u, sample.t);
    }
  }
  for (let row = 0; row < rowCount - 1; row++) {
    for (let col = 0; col < columnCount - 1; col++) {
      const a = row * columnCount + col;
      const b = a + 1;
      const c = (row + 1) * columnCount + col + 1;
      const d = (row + 1) * columnCount + col;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.LamellarChannelStripMesh = strip;
  return geometry;
}

function makeLamellarPlateLipGeometry(THREE, lip) {
  const rowCount = lip.edgeSamples.length;
  const columnCount = 3;
  const vertices = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (let row = 0; row < rowCount; row++) {
    const sample = lip.edgeSamples[row];
    const edge = new THREE.Vector3(...sample.edgePoint);
    const inner = new THREE.Vector3(...sample.innerPoint);
    const normal = new THREE.Vector3(...sample.surfaceNormal).normalize();
    const shoulder = edge.clone().lerp(inner, 0.42);
    const points = [
      edge.clone().addScaledVector(normal, lip.lipHeight * 0.42),
      shoulder.clone().addScaledVector(normal, lip.lipHeight),
      inner.clone().addScaledVector(normal, lip.lipHeight * 0.18),
    ];
    for (let col = 0; col < columnCount; col++) {
      const point = points[col];
      vertices.push(point.x, point.y, point.z);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(col / (columnCount - 1), sample.t);
    }
  }
  for (let row = 0; row < rowCount - 1; row++) {
    for (let col = 0; col < columnCount - 1; col++) {
      const a = row * columnCount + col;
      const b = a + 1;
      const c = (row + 1) * columnCount + col + 1;
      const d = (row + 1) * columnCount + col;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.LamellarPlateLip = lip;
  return geometry;
}

function makeMacroFamilySubstripGeometry(THREE, substrip) {
  const rowCount = substrip.edgeSamples.length;
  const columnCount = 7;
  const vertices = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const centerColumn = (columnCount - 1) * 0.5;
  for (let row = 0; row < rowCount; row++) {
    const sample = substrip.edgeSamples[row];
    const left = new THREE.Vector3(...sample.leftEdge);
    const right = new THREE.Vector3(...sample.rightEdge);
    const normal = new THREE.Vector3(...sample.surfaceNormal).normalize();
    const crownHeight = substrip.role === 'broad-main-lamella' ? 0.014 : 0.01;
    for (let col = 0; col < columnCount; col++) {
      const u = col / (columnCount - 1);
      const q = Math.abs(col - centerColumn) / centerColumn;
      const crown = (1 - q * q) * crownHeight;
      const point = left.clone().lerp(right, u).addScaledVector(normal, crown);
      vertices.push(point.x, point.y, point.z);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(u, sample.t);
    }
  }
  for (let row = 0; row < rowCount - 1; row++) {
    for (let col = 0; col < columnCount - 1; col++) {
      const a = row * columnCount + col;
      const b = a + 1;
      const c = (row + 1) * columnCount + col + 1;
      const d = (row + 1) * columnCount + col;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.MacroFamilySubstrip = substrip;
  return geometry;
}

function makeMacroFamilySubstripSideWallGeometry(THREE, substrip, sideName) {
  const samples = substrip.sideWallSamples[sideName] || [];
  const rowCount = samples.length;
  const columnCount = 3;
  const vertices = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (let row = 0; row < rowCount; row++) {
    const sample = samples[row];
    const outer = new THREE.Vector3(...sample.outer);
    const inner = new THREE.Vector3(...sample.inner);
    const normal = new THREE.Vector3(...sample.surfaceNormal).normalize();
    const points = [
      outer,
      outer.clone().lerp(inner, 0.55),
      inner,
    ];
    for (let col = 0; col < columnCount; col++) {
      const point = points[col];
      vertices.push(point.x, point.y, point.z);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(col / (columnCount - 1), sample.t);
    }
  }
  for (let row = 0; row < rowCount - 1; row++) {
    for (let col = 0; col < columnCount - 1; col++) {
      const a = row * columnCount + col;
      const b = a + 1;
      const c = (row + 1) * columnCount + col + 1;
      const d = (row + 1) * columnCount + col;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.MacroFamilySubstrip = substrip;
  geometry.userData.MacroFamilySubstripSideWall = { substripId: substrip.id, sideName };
  return geometry;
}

function makeMacroFamilySubstripTerminalCapGeometry(THREE, cap) {
  const points = cap.capSamples;
  const outerLeft = new THREE.Vector3(...points.outerLeft);
  const outerMid = new THREE.Vector3(...points.outerMid);
  const outerRight = new THREE.Vector3(...points.outerRight);
  const innerLeft = new THREE.Vector3(...points.innerLeft);
  const innerMid = new THREE.Vector3(...points.innerMid);
  const innerRight = new THREE.Vector3(...points.innerRight);
  const vertices = [
    outerLeft, outerMid, outerRight,
    innerLeft, innerMid, innerRight,
  ];
  const normal = outerMid.clone().normalize();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices.flatMap(point => [point.x, point.y, point.z]), 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(Array.from({ length: vertices.length }, () => [normal.x, normal.y, normal.z]).flat(), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 1, 0.5, 1, 1, 1,
    0, 0, 0.5, 0, 1, 0,
  ], 2));
  geometry.setIndex([0, 1, 3, 1, 4, 3, 1, 2, 4, 2, 5, 4]);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.MacroFamilySubstripTerminalCap = cap;
  return geometry;
}

function makeLowerCupClosureGeometry(THREE, lowerCupDepth = 1) {
  const rowCount = 22;
  const columnCount = 13;
  const vertices = [];
  const normals = [];
  const indices = [];
  for (let row = 0; row < rowCount; row++) {
    const t = row / (rowCount - 1);
    const y = -0.99 + t * 0.5;
    const centerX = -0.01 + Math.sin(t * Math.PI) * 0.035;
    const halfWidth = (0.17 + t * 0.2) * (0.95 + lowerCupDepth * 0.1);
    const zBase = 0.54 + t * 0.34 + Math.sin(t * Math.PI) * 0.07 * lowerCupDepth;
    for (let col = 0; col < columnCount; col++) {
      const u = col / (columnCount - 1);
      const q = u * 2 - 1;
      const x = centerX + q * halfWidth * (0.72 + 0.28 * Math.sin(t * Math.PI));
      const z = zBase - Math.abs(q) * 0.04 + Math.sin(Math.PI * t) * (1 - Math.abs(q)) * 0.035;
      const point = new THREE.Vector3(x, y, z).normalize().multiplyScalar(1.078);
      vertices.push(point.x, point.y, point.z);
      normals.push(point.x, point.y, point.z);
    }
  }
  for (let row = 0; row < rowCount - 1; row++) {
    for (let col = 0; col < columnCount - 1; col++) {
      const a = row * columnCount + col;
      const b = a + 1;
      const c = (row + 1) * columnCount + col + 1;
      const d = (row + 1) * columnCount + col;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeFrontOwnerCurveGeometry(THREE, points, radius) {
  const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
  return new THREE.TubeGeometry(curve, 72, radius, 10, false);
}

function subSurgeLevelDip(surge, t) {
  let strength = 0;
  for (const event of surge.levelEvents || []) {
    if (event.type !== 'level-change-dip') continue;
    strength = Math.max(strength, Math.exp(-Math.pow((t - event.t) / 0.12, 2)));
  }
  return clamp(strength, 0, 1);
}

function surgeWidthAt(surge, t) {
  const width = surge.widthProfile || { root: 0.052, mid: 0.082, tip: 0.046 };
  return t < 0.5
    ? width.root + (width.mid - width.root) * t * 2
    : width.mid + (width.tip - width.mid) * (t - 0.5) * 2;
}

function makeCrossingTuckBodyGeometry(THREE, surge, ownerDominance = 1) {
  const centerline = surge.centerline || surge;
  const curve = new THREE.CatmullRomCurve3(centerline.map(point => new THREE.Vector3(...point)));
  const rowCount = 48;
  const columnCount = 9;
  const vertices = [];
  const normals = [];
  const indices = [];
  for (let row = 0; row < rowCount; row++) {
    const t = row / (rowCount - 1);
    const center = curve.getPoint(t);
    const prev = curve.getPoint(Math.max(0, t - 0.02));
    const next = curve.getPoint(Math.min(1, t + 0.02));
    const normal = center.clone().normalize();
    const tangent = next.clone().sub(prev).normalize();
    let side = new THREE.Vector3().crossVectors(normal, tangent);
    if (side.lengthSq() < 1e-8) side = new THREE.Vector3(1, 0, 0);
    side.normalize();
    const levelDip = subSurgeLevelDip(surge, t);
    const width = surgeWidthAt(surge, t) * ownerDominance * (1 + levelDip * 0.18);
    const thickness = (surge.thicknessProfile?.mid || 0.022) * (0.72 + Math.sin(Math.PI * t) * 0.5);
    for (let col = 0; col < columnCount; col++) {
      const u = col / (columnCount - 1);
      const q = u * 2 - 1;
      const crown = 1 - Math.pow(Math.abs(q), 1.9) * 0.16 - levelDip * (1 - Math.abs(q)) * 0.28;
      const pos = center.clone()
        .addScaledVector(side, q * width)
        .addScaledVector(normal, thickness * crown - levelDip * 0.015)
        .normalize()
        .multiplyScalar(1.07 - levelDip * 0.012);
      const posNormal = pos.clone().normalize();
      vertices.push(pos.x, pos.y, pos.z);
      normals.push(posNormal.x, posNormal.y, posNormal.z);
    }
  }
  for (let row = 0; row < rowCount - 1; row++) {
    for (let col = 0; col < columnCount - 1; col++) {
      const a = row * columnCount + col;
      const b = a + 1;
      const c = (row + 1) * columnCount + col + 1;
      const d = (row + 1) * columnCount + col;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.CrossingSubSurge = surge;
  return geometry;
}

function makeCrossingSubSurgeRailGeometry(THREE, surge) {
  const radius = surgeWidthAt(surge, 0.5) * 0.24;
  return makeFrontOwnerCurveGeometry(THREE, surge.centerline, Math.max(0.006, radius));
}

function makeLowerFrontCupGeometry(THREE, lowerCupDepth = 1) {
  const rowCount = 24;
  const columnCount = 9;
  const vertices = [];
  const normals = [];
  const indices = [];
  for (let row = 0; row < rowCount; row++) {
    const t = row / (rowCount - 1);
    const y = -0.72 + t * (0.3 + lowerCupDepth * 0.05);
    const centerX = -0.05 + Math.sin(t * Math.PI) * 0.06 * lowerCupDepth;
    const halfWidth = 0.26 + lowerCupDepth * 0.03 + Math.sin(t * Math.PI) * 0.1 * lowerCupDepth;
    for (let col = 0; col < columnCount; col++) {
      const u = col / (columnCount - 1);
      const q = u * 2 - 1;
      const x = centerX + q * halfWidth * (0.62 + 0.38 * Math.sin(t * Math.PI));
      const z = 0.78 + Math.sin(t * Math.PI) * 0.1 * lowerCupDepth - Math.abs(q) * 0.055;
      const point = new THREE.Vector3(x, y, z).normalize().multiplyScalar(1.07);
      vertices.push(point.x, point.y, point.z);
      normals.push(point.x, point.y, point.z);
    }
  }
  for (let row = 0; row < rowCount - 1; row++) {
    for (let col = 0; col < columnCount - 1; col++) {
      const a = row * columnCount + col;
      const b = a + 1;
      const c = (row + 1) * columnCount + col + 1;
      const d = (row + 1) * columnCount + col;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function addPrimaryApertureFrameGeometry(THREE, group, composition, materials) {
  const frame = composition.frontApertureOwnership;
  const variation = frame.effectiveVariation || {};
  const closure = new THREE.Mesh(makeLowerCupClosureGeometry(THREE, variation.lowerCupDepth || 1), materials.ownerBody);
  closure.name = 'primary-front-aperture-lower-cup-socket-contiguous';
  closure.userData.lowerCupClosure = frame.lowerCupClosure;
  closure.userData.MacroPromotedBody = composition.macroBodyPromotion?.promotedBodies?.find(body => body.parentAssemblage === 'equatorial-cupping-whorl');
  group.add(closure);

  const cup = new THREE.Mesh(makeLowerFrontCupGeometry(THREE, variation.lowerCupDepth || 1), materials.ownerBody);
  cup.name = 'primary-front-aperture-lower-cupping-owner';
  cup.userData.PrimaryApertureFrame = frame;
  cup.userData.frontApertureOwnerRole = 'lower-cupping-owner';
  group.add(cup);

  const crossingPlan = frame.crossingSubSurgePlan || createCrossingSubSurgePlan(variation);
  for (const surge of crossingPlan.subSurges) {
    const isBody = surge.role === 'dominant-crossing-body';
    const mesh = new THREE.Mesh(
      isBody
        ? makeCrossingTuckBodyGeometry(THREE, surge, variation.ownerDominance || 1)
        : makeCrossingSubSurgeRailGeometry(THREE, surge),
      isBody ? materials.crossingBody : materials.subSurgeRail,
    );
    mesh.name = isBody
      ? 'primary-front-aperture-crossing-tuck-macro-body'
      : surge.id === 'crossing-tuck-upper-edge-rail'
        ? 'primary-front-aperture-crossing-tuck-owner'
        : `${surge.id}-topology-only-relief`;
    mesh.userData.PrimaryApertureFrame = frame;
    mesh.userData.CrossingSubSurgePlan = crossingPlan;
    mesh.userData.CrossingSubSurge = surge;
    mesh.userData.crossingTuckIntegration = frame.crossingTuckIntegration;
    mesh.userData.MacroPromotedBody = composition.macroBodyPromotion?.promotedBodies?.find(body => body.parentAssemblage === 'north-east-counter-thrust');
    mesh.userData.frontApertureOwnerRole = 'crossing-tuck-owner';
    mesh.userData.railRole = surge.role === 'subordinate-edge-rail' ? 'subordinate-edge-rail-not-lone-wand' : 'dominant-crossing-body';
    group.add(mesh);
  }
}

function disposeObject(child, sharedMaterials) {
  child.geometry?.dispose?.();
  if (child.material && !sharedMaterials.has(child.material)) child.material.dispose?.();
}

export function createKaminosOrbShellCompositionWitness({ THREE, scene, camera, controls, onStatus, onDirty } = {}) {
  let active = false;
  let group = null;
  let variationOptions = { variantId: 'baseline', variationSeed: 0, variationLeafCount: 10, uiControlSource: 'route-or-programmatic' };
  let composition = createTargetOrbShellCompositionFixture(variationOptions);

  const sharedMaterials = new Set();
  const pbrPolicy = composition.liveMacroSideWallPlan.normalWitnessMaterialPolicy;
  function neutralPbrMaterial({ color, roughness = pbrPolicy.roughness, metalness = pbrPolicy.metalness, envMapIntensity = pbrPolicy.envMapIntensity, side = THREE.FrontSide, transparent = false, opacity = 1 }) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
      envMapIntensity,
      side,
      transparent,
      opacity,
    });
  }
  const bodyMaterial = neutralPbrMaterial({ color: pbrPolicy.bodyColor, side: THREE.DoubleSide });
  const territoryMaterial = neutralPbrMaterial({
    color: 0x182428,
    side: THREE.DoubleSide,
  });
  const railMaterial = neutralPbrMaterial({ color: pbrPolicy.railColor, roughness: 0.42, metalness: 0.04 });
  const hopMaterial = neutralPbrMaterial({ color: 0x3d3530, roughness: 0.5, metalness: 0.04 });
  const apertureMaterial = new THREE.MeshBasicMaterial({ color: 0x61b8d9, transparent: true, opacity: 0.28, depthWrite: false });
  const terminationMaterial = new THREE.MeshBasicMaterial({ color: 0xff6a1c, transparent: true, opacity: 0.42 });
  const apertureTerminalTangentMaterial = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.94, depthWrite: false, depthTest: false });
  const apertureOrbitTangentMaterial = new THREE.MeshBasicMaterial({ color: 0x63d7ff, transparent: true, opacity: 0.94, depthWrite: false, depthTest: false });
  const apertureTangencyPointMaterial = new THREE.MeshBasicMaterial({ color: 0xff4f7a, transparent: true, opacity: 0.96, depthWrite: false, depthTest: false });
  const macroContactIntersectMaterial = new THREE.MeshBasicMaterial({ color: 0xff3f5f, transparent: true, opacity: 0.96, depthWrite: false, depthTest: false });
  const macroContactNearMaterial = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false });
  const macroContactClearMaterial = new THREE.MeshBasicMaterial({ color: 0x63d7ff, transparent: true, opacity: 0.62, depthWrite: false, depthTest: false });
  const apertureOwnerBodyMaterial = neutralPbrMaterial({ color: 0x1a2427, side: THREE.DoubleSide });
  const apertureOwnerRailMaterial = neutralPbrMaterial({ color: 0x46565b, roughness: 0.4, metalness: 0.05 });
  const crossingSubSurgeRailMaterial = neutralPbrMaterial({ color: 0x1d2a2f, roughness: 0.52, metalness: 0.04 });
  const promotedBodyMaterial = neutralPbrMaterial({ color: pbrPolicy.bodyColor, side: THREE.DoubleSide });
  const promotedBodySupportMaterial = neutralPbrMaterial({
    color: 0x0b1113,
    roughness: 0.62,
    metalness: 0.04,
    side: THREE.DoubleSide,
  });
  const liveMacroSideWallMaterial = neutralPbrMaterial({
    color: pbrPolicy.sideWallColor,
    roughness: 0.38,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const crossingTuckBodyMaterial = neutralPbrMaterial({ color: 0x1d2529, side: THREE.DoubleSide });
  const seamGapHintMaterial = new THREE.MeshBasicMaterial({ color: 0x061015, transparent: true, opacity: 0.74, depthWrite: false });
  const lamellarChannelStripMaterial = neutralPbrMaterial({
    color: 0x233036,
    roughness: 0.5,
    metalness: 0.04,
    side: THREE.DoubleSide,
  });
  const lamellarPlateLipMaterial = neutralPbrMaterial({
    color: 0x53646a,
    roughness: 0.36,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const macroFamilySubstripMaterial = neutralPbrMaterial({
    color: 0x2e3b40,
    roughness: 0.44,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const macroFamilySubstripSideWallMaterial = neutralPbrMaterial({
    color: 0x66777d,
    roughness: 0.36,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const lamellarPlateBoundaryMaterial = neutralPbrMaterial({
    color: 0x151d20,
    roughness: 0.58,
    metalness: 0.03,
    side: THREE.DoubleSide,
  });
  const lamellarInnerReturnMaterial = neutralPbrMaterial({
    color: 0x263238,
    roughness: 0.48,
    metalness: 0.04,
    side: THREE.DoubleSide,
  });
  const lamellarInnerReturnSideWallMaterial = neutralPbrMaterial({
    color: 0x405056,
    roughness: 0.38,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const cleanSideWallMaterial = new THREE.MeshBasicMaterial({
    color: 0xb8c6ca,
    side: THREE.DoubleSide,
  });
  const cleanSidePlaneMaterial = new THREE.MeshBasicMaterial({
    color: 0x273238,
    side: THREE.DoubleSide,
  });
  const cleanOuterEdgeMaterial = new THREE.MeshBasicMaterial({ color: 0xf2f7f8 });
  const cleanInnerEdgeMaterial = new THREE.MeshBasicMaterial({ color: 0x20313a });
  for (const material of [
    bodyMaterial,
    territoryMaterial,
    railMaterial,
    hopMaterial,
    apertureMaterial,
    terminationMaterial,
    apertureTerminalTangentMaterial,
    apertureOrbitTangentMaterial,
    apertureTangencyPointMaterial,
    macroContactIntersectMaterial,
    macroContactNearMaterial,
    macroContactClearMaterial,
    apertureOwnerBodyMaterial,
    apertureOwnerRailMaterial,
    promotedBodyMaterial,
    promotedBodySupportMaterial,
    liveMacroSideWallMaterial,
    crossingTuckBodyMaterial,
    seamGapHintMaterial,
    lamellarChannelStripMaterial,
    lamellarPlateLipMaterial,
    macroFamilySubstripMaterial,
    macroFamilySubstripSideWallMaterial,
    lamellarPlateBoundaryMaterial,
    lamellarInnerReturnMaterial,
    lamellarInnerReturnSideWallMaterial,
    cleanSideWallMaterial,
    cleanSidePlaneMaterial,
    cleanOuterEdgeMaterial,
    cleanInnerEdgeMaterial,
  ]) sharedMaterials.add(material);

  function materialForBand(bandMember) {
    if (bandMember.role === 'body') return bodyMaterial;
    if (bandMember.role === 'hopping-member') return hopMaterial;
    return railMaterial;
  }

  function legacyTargetBandTubeSuppressed(assemblage, bandMember) {
    const plan = composition.liveMacroSideWallPlan;
    return plan?.liveRenderMaterialPolicy?.legacyRoundTargetBandTubesVisible === false
      && plan.targetAssemblageIds?.includes(assemblage.id)
      && plan.suppressedLegacyRoundBandIds?.includes(bandMember.id);
  }

  function disposeGroup() {
    if (!group) return;
    scene.remove(group);
    group.traverse(child => disposeObject(child, sharedMaterials));
    group = null;
  }

  function liveMacroSideWallMeshIds() {
    const ids = [];
    group?.traverse(child => {
      if (child.userData?.LiveMacroSideWall) ids.push(child.name);
    });
    return ids;
  }

  function macroFamilySubstripMeshIds() {
    const ids = [];
    group?.traverse(child => {
      if (
        child.userData?.MacroFamilySubstrip
        && !child.userData?.MacroFamilySubstripSideWall
        && !child.userData?.MacroFamilySubstripTerminalCap
      ) ids.push(child.name);
    });
    return ids;
  }

  function macroFamilySubstripSideWallMeshIds() {
    const ids = [];
    group?.traverse(child => {
      if (child.userData?.MacroFamilySubstripSideWall) ids.push(child.name);
    });
    return ids;
  }

  function macroFamilySubstripTerminalCapMeshIds() {
    const ids = [];
    group?.traverse(child => {
      if (child.userData?.MacroFamilySubstripTerminalCap) ids.push(child.name);
    });
    return ids;
  }

  function selectedParentPromotedBodyMeshIds() {
    const retiredParentIds = composition.macroFamilySubstripPlan?.visibleParentRetirementPolicy?.retiredParentAssemblageIds || [];
    const ids = [];
    group?.traverse(child => {
      const parentId = child.userData?.MacroPromotedBody?.parentAssemblage;
      if (parentId && retiredParentIds.includes(parentId) && child.name.endsWith('-macro-promoted-body')) ids.push(child.name);
    });
    return ids;
  }

  function selectedParentSideWallMeshIds() {
    const retiredParentIds = composition.macroFamilySubstripPlan?.visibleParentRetirementPolicy?.retiredParentAssemblageIds || [];
    const ids = [];
    group?.traverse(child => {
      const parentId = child.userData?.LiveMacroSideWall?.parentAssemblage;
      if (parentId && retiredParentIds.includes(parentId)) ids.push(child.name);
    });
    return ids;
  }

  function selectedParentTerminalCapMeshIds() {
    const retiredParentIds = composition.macroFamilySubstripPlan?.visibleParentRetirementPolicy?.retiredParentAssemblageIds || [];
    const ids = [];
    group?.traverse(child => {
      const parentId = child.userData?.LiveMacroTerminalCap?.parentAssemblage;
      if (parentId && retiredParentIds.includes(parentId)) ids.push(child.name);
    });
    return ids;
  }

  function build() {
    disposeGroup();
    composition = createTargetOrbShellCompositionFixture(variationOptions);
    group = new THREE.Group();
    group.name = ORB_SHELL_COMPOSITION_IDENTITY;
    group.userData.OrbShellComposition = composition;

    const keyLight = new THREE.DirectionalLight(0xcdd8de, 2.1);
    keyLight.position.set(-2.5, 2.2, 3.4);
    group.add(keyLight);
    const amberLight = new THREE.DirectionalLight(0xff7a25, 0.75);
    amberLight.position.set(2.4, -0.3, 2.6);
    group.add(amberLight);
    group.add(new THREE.HemisphereLight(0x445057, 0x070707, 0.55));

    for (const assemblage of composition.macroAssemblages) {
      const macroGroup = new THREE.Group();
      macroGroup.name = assemblage.id;
      macroGroup.userData.MacroAssemblage = assemblage;
      macroGroup.userData.MacroTorsionField = assemblage.macroTorsionField;
      const retiredParentIds = composition.macroFamilySubstripPlan?.visibleParentRetirementPolicy?.retiredParentAssemblageIds || [];
      const parentRetiredFromNormalRender = retiredParentIds.includes(assemblage.id);
      const hasOwnedSubstrips = composition.macroFamilySubstripPlan?.parentAssemblageIds?.includes(assemblage.id);
      if (!parentRetiredFromNormalRender) {
        const promotedMesh = new THREE.Mesh(
          makeMacroPromotedBodyGeometry(THREE, assemblage),
          hasOwnedSubstrips ? promotedBodySupportMaterial : promotedBodyMaterial,
        );
        promotedMesh.name = `${assemblage.id}-macro-promoted-body`;
        promotedMesh.userData.MacroPromotedBody = assemblage.macroPromotedBody;
        promotedMesh.userData.MacroTorsionField = assemblage.macroTorsionField;
        promotedMesh.userData.MacroFamilySubstripPlan = hasOwnedSubstrips ? composition.macroFamilySubstripPlan : null;
        macroGroup.add(promotedMesh);
        for (const sideWall of composition.liveMacroSideWallPlan?.sideWalls?.filter(wall => wall.parentAssemblage === assemblage.id) || []) {
          const sideWallMesh = new THREE.Mesh(makeMacroPromotedBodySideWallGeometry(THREE, sideWall), liveMacroSideWallMaterial);
          sideWallMesh.name = sideWall.id;
          sideWallMesh.userData.LiveMacroSideWallPlan = composition.liveMacroSideWallPlan;
          sideWallMesh.userData.LiveMacroSideWall = sideWall;
          sideWallMesh.userData.MacroPromotedBody = assemblage.macroPromotedBody;
          macroGroup.add(sideWallMesh);
        }
        for (const terminalCap of composition.liveMacroSideWallPlan?.terminalCaps?.filter(cap => (
          cap.parentAssemblage === assemblage.id
          && cap.normalRenderVisible !== false
        )) || []) {
          const capMesh = new THREE.Mesh(makeMacroPromotedBodyTerminalCapGeometry(THREE, terminalCap), liveMacroSideWallMaterial);
          capMesh.name = terminalCap.id;
          capMesh.userData.LiveMacroSideWallPlan = composition.liveMacroSideWallPlan;
          capMesh.userData.LiveMacroTerminalCap = terminalCap;
          capMesh.userData.MacroPromotedBody = assemblage.macroPromotedBody;
          macroGroup.add(capMesh);
        }
      }
      for (const substrip of composition.macroFamilySubstripPlan?.substrips?.filter(strip => strip.parentAssemblage === assemblage.id) || []) {
        const substripMesh = new THREE.Mesh(makeMacroFamilySubstripGeometry(THREE, substrip), macroFamilySubstripMaterial);
        substripMesh.name = substrip.id;
        substripMesh.userData.MacroFamilySubstripPlan = composition.macroFamilySubstripPlan;
        substripMesh.userData.MacroFamilySubstrip = substrip;
        substripMesh.userData.MacroPromotedBody = assemblage.macroPromotedBody;
        macroGroup.add(substripMesh);
        for (const sideName of ['left', 'right']) {
          const sideWallMesh = new THREE.Mesh(
            makeMacroFamilySubstripSideWallGeometry(THREE, substrip, sideName),
            macroFamilySubstripSideWallMaterial,
          );
          sideWallMesh.name = `${substrip.id}-${sideName}-sidewall`;
          sideWallMesh.userData.MacroFamilySubstripPlan = composition.macroFamilySubstripPlan;
          sideWallMesh.userData.MacroFamilySubstrip = substrip;
          sideWallMesh.userData.MacroFamilySubstripSideWall = { substripId: substrip.id, sideName };
          sideWallMesh.userData.MacroPromotedBody = assemblage.macroPromotedBody;
          macroGroup.add(sideWallMesh);
        }
        for (const cap of substrip.terminalCaps || []) {
          const capMesh = new THREE.Mesh(makeMacroFamilySubstripTerminalCapGeometry(THREE, cap), macroFamilySubstripSideWallMaterial);
          capMesh.name = cap.id;
          capMesh.userData.MacroFamilySubstripPlan = composition.macroFamilySubstripPlan;
          capMesh.userData.MacroFamilySubstrip = substrip;
          capMesh.userData.MacroFamilySubstripTerminalCap = cap;
          capMesh.userData.MacroPromotedBody = assemblage.macroPromotedBody;
          macroGroup.add(capMesh);
        }
      }
      if (composition.liveMacroSideWallPlan?.liveRenderMaterialPolicy?.territoryProxyUnderlayVisible !== false) {
        const territoryMesh = new THREE.Mesh(makeMacroTerritoryBodyGeometry(THREE, assemblage), territoryMaterial);
        territoryMesh.name = `${assemblage.id}-macro-territory-body`;
        territoryMesh.userData.MacroTerritoryBody = assemblage.territoryBodyOccupancy;
        territoryMesh.userData.MacroTorsionField = assemblage.macroTorsionField;
        macroGroup.add(territoryMesh);
      }
      for (const bandMember of assemblage.childBandPlan) {
        if (legacyTargetBandTubeSuppressed(assemblage, bandMember)) continue;
        const replacementStrip = composition.lamellarChannelMeshPlan?.stripMeshes?.find(strip => (
          strip.parentAssemblage === assemblage.id
          && strip.replacesRoundBandId === bandMember.id
          && strip.roundDiagnosticRailFinalVisible === false
        ));
        if (replacementStrip) continue;
        const mesh = new THREE.Mesh(makeBandTube(THREE, assemblage, bandMember), materialForBand(bandMember));
        mesh.name = bandMember.id;
        mesh.userData.BandMember = bandMember;
        macroGroup.add(mesh);
        for (const t of [0.02, 0.98]) {
          const cap = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 8), terminationMaterial);
          cap.name = `${bandMember.id}-${t < 0.5 ? 'start' : 'end'}-termination-socket`;
          cap.position.copy(sampleSpine(THREE, assemblage, bandMember, t, 1.065));
          cap.userData.TerminationSocketGraph = t < 0.5 ? bandMember.startTermination : bandMember.endTermination;
          macroGroup.add(cap);
        }
      }
      group.add(macroGroup);
    }

    for (const strip of composition.lamellarChannelMeshPlan?.stripMeshes || []) {
      const stripMesh = new THREE.Mesh(makeLamellarChannelStripGeometry(THREE, strip), lamellarChannelStripMaterial);
      stripMesh.name = `${strip.id}-flat-lamellar-channel-strip`;
      stripMesh.userData.LamellarChannelMeshPlan = composition.lamellarChannelMeshPlan;
      stripMesh.userData.LamellarChannelStripMesh = strip;
      group.add(stripMesh);
      for (const lip of strip.plateLips || []) {
        if (composition.lamellarPlateBoundaryPlan?.suppressedProxyFeatureIds?.includes(lip.id)) continue;
        const lipMesh = new THREE.Mesh(makeLamellarPlateLipGeometry(THREE, lip), lamellarPlateLipMaterial);
        lipMesh.name = lip.id;
        lipMesh.userData.LamellarChannelMeshPlan = composition.lamellarChannelMeshPlan;
        lipMesh.userData.LamellarChannelStripMesh = strip;
        lipMesh.userData.LamellarPlateLip = lip;
        group.add(lipMesh);
      }
    }

    for (const boundary of composition.lamellarPlateBoundaryPlan?.boundaryMeshes || []) {
      const boundaryMesh = new THREE.Mesh(makeLamellarPlateBoundaryGeometry(THREE, boundary), lamellarPlateBoundaryMaterial);
      boundaryMesh.name = boundary.id;
      boundaryMesh.userData.LamellarPlateBoundaryPlan = composition.lamellarPlateBoundaryPlan;
      boundaryMesh.userData.LamellarPlateBoundaryMesh = boundary;
      group.add(boundaryMesh);
    }

    for (const sidePlane of composition.lamellarInnerReturnPlan?.sidePlaneMeshes || []) {
      const sidePlaneMesh = new THREE.Mesh(makeLamellarInnerReturnSidePlaneGeometry(THREE, sidePlane), lamellarInnerReturnMaterial);
      sidePlaneMesh.name = sidePlane.id;
      sidePlaneMesh.userData.LamellarInnerReturnPlan = composition.lamellarInnerReturnPlan;
      sidePlaneMesh.userData.LamellarInnerReturnSidePlaneMesh = sidePlane;
      sidePlaneMesh.userData.cleanTopologyRole = 'coupled-sidewall-underlay';
      group.add(sidePlaneMesh);
      const sideWallMesh = new THREE.Mesh(makeLamellarInnerReturnSideWallGeometry(THREE, sidePlane), lamellarInnerReturnSideWallMaterial);
      sideWallMesh.name = `${sidePlane.id}-visible-return-sidewall-band`;
      sideWallMesh.userData.LamellarInnerReturnPlan = composition.lamellarInnerReturnPlan;
      sideWallMesh.userData.LamellarInnerReturnSidePlaneMesh = sidePlane;
      sideWallMesh.userData.visibleSideWallSurface = sidePlane.sideWallVisibilityContract;
      sideWallMesh.userData.cleanTopologyRole = 'coupled-sidewall-face-diagnostic';
      group.add(sideWallMesh);
      const outerEdgeMesh = new THREE.Mesh(makeLamellarInnerReturnDiagnosticEdgeGeometry(THREE, sidePlane.outerPlateEdge), cleanOuterEdgeMaterial);
      outerEdgeMesh.name = `${sidePlane.id}-outer-plate-edge-diagnostic`;
      outerEdgeMesh.visible = false;
      outerEdgeMesh.userData.LamellarInnerReturnSidePlaneMesh = sidePlane;
      outerEdgeMesh.userData.cleanTopologyRole = 'outer-plate-edge-diagnostic';
      group.add(outerEdgeMesh);
      const innerEdgeMesh = new THREE.Mesh(makeLamellarInnerReturnDiagnosticEdgeGeometry(THREE, sidePlane.innerReturnEdge), cleanInnerEdgeMaterial);
      innerEdgeMesh.name = `${sidePlane.id}-inner-return-edge-diagnostic`;
      innerEdgeMesh.visible = false;
      innerEdgeMesh.userData.LamellarInnerReturnSidePlaneMesh = sidePlane;
      innerEdgeMesh.userData.cleanTopologyRole = 'inner-return-edge-diagnostic';
      group.add(innerEdgeMesh);
    }

    for (const voidRecord of composition.AperturePressure.primaryVoids) {
      const ring = new THREE.Mesh(makeAperturePressureRing(THREE, voidRecord), apertureMaterial);
      ring.name = `${voidRecord.id}-aperture-pressure-ring`;
      ring.userData.AperturePressure = voidRecord;
      group.add(ring);
    }
    for (const sample of composition.macroFamilySubstripPlan?.apertureTangencyWitnessPlan?.samples || []) {
      const terminalRay = new THREE.Mesh(
        makeApertureTangencyVectorGeometry(THREE, sample.terminalPoint, sample.terminalTangent, 0.2, 0.006),
        apertureTerminalTangentMaterial,
      );
      terminalRay.name = `${sample.id}-terminal-tangent-ray`;
      terminalRay.visible = false;
      terminalRay.userData.ApertureTangencySample = sample;
      terminalRay.userData.apertureTangencyOverlayRole = 'terminal-tangent-ray';
      group.add(terminalRay);

      const orbitRay = new THREE.Mesh(
        makeApertureTangencyVectorGeometry(THREE, sample.nearestAperturePoint, sample.apertureOrbitTangent, 0.2, 0.006),
        apertureOrbitTangentMaterial,
      );
      orbitRay.name = `${sample.id}-aperture-orbit-tangent-ray`;
      orbitRay.visible = false;
      orbitRay.userData.ApertureTangencySample = sample;
      orbitRay.userData.apertureTangencyOverlayRole = 'aperture-orbit-tangent-ray';
      group.add(orbitRay);

      const nearestPoint = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 8), apertureTangencyPointMaterial);
      nearestPoint.name = `${sample.id}-nearest-aperture-point`;
      nearestPoint.position.set(...sample.nearestAperturePoint);
      nearestPoint.visible = false;
      nearestPoint.userData.ApertureTangencySample = sample;
      nearestPoint.userData.apertureTangencyOverlayRole = 'nearest-aperture-point';
      group.add(nearestPoint);
    }
    for (const contact of composition.macroContactMap?.rankedContacts?.slice(0, 5) || []) {
      const material = contact.clearanceVerdict === 'intersecting'
        ? macroContactIntersectMaterial
        : contact.clearanceVerdict === 'near'
          ? macroContactNearMaterial
          : macroContactClearMaterial;
      const segment = new THREE.Mesh(makeMacroContactSegmentGeometry(THREE, contact), material);
      segment.name = `${contact.id}-macro-contact-segment`;
      segment.visible = false;
      segment.userData.MacroContactMap = composition.macroContactMap;
      segment.userData.MacroContactSample = contact;
      segment.userData.macroContactOverlayRole = 'closest-approach-segment';
      group.add(segment);

      const sourcePoint = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8), material);
      sourcePoint.name = `${contact.id}-source-contact-point`;
      sourcePoint.position.set(...contact.closestApproach.sourcePoint);
      sourcePoint.visible = false;
      sourcePoint.userData.MacroContactSample = contact;
      sourcePoint.userData.macroContactOverlayRole = 'source-contact-point';
      group.add(sourcePoint);

      const targetPoint = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8), material);
      targetPoint.name = `${contact.id}-target-contact-point`;
      targetPoint.position.set(...contact.closestApproach.targetPoint);
      targetPoint.visible = false;
      targetPoint.userData.MacroContactSample = contact;
      targetPoint.userData.macroContactOverlayRole = 'target-contact-point';
      group.add(targetPoint);
    }
    for (const gap of composition.expandedMacroRegionProxyPlan?.seamGaps || []) {
      const seamName = `${gap.id}-future-mesh-boundary-input`;
      if (composition.lamellarPlateBoundaryPlan?.suppressedDecorativeHintIds?.includes(seamName)) continue;
      const seam = new THREE.Mesh(makeSeamGapHintGeometry(THREE, gap), seamGapHintMaterial);
      seam.name = seamName;
      seam.userData.MacroRegionSeamGapDescriptor = gap;
      group.add(seam);
    }
    addPrimaryApertureFrameGeometry(THREE, group, composition, {
    ownerBody: apertureOwnerBodyMaterial,
    ownerRail: apertureOwnerRailMaterial,
    subSurgeRail: crossingSubSurgeRailMaterial,
    crossingBody: crossingTuckBodyMaterial,
  });

    scene.add(group);
    const renderedLiveMacroSideWallMeshIds = liveMacroSideWallMeshIds();
    const renderedSubstripMeshIds = macroFamilySubstripMeshIds();
    const renderedSubstripSideWallMeshIds = macroFamilySubstripSideWallMeshIds();
    const renderedSubstripTerminalCapMeshIds = macroFamilySubstripTerminalCapMeshIds();
    const renderedSelectedParentPromotedBodyMeshIds = selectedParentPromotedBodyMeshIds();
    const renderedSelectedParentSideWallMeshIds = selectedParentSideWallMeshIds();
    const renderedSelectedParentTerminalCapMeshIds = selectedParentTerminalCapMeshIds();
    onStatus?.({
      phase: 'built',
      identity: ORB_SHELL_COMPOSITION_IDENTITY,
      variantId: composition.effectiveVariation.variantId,
      variationSeed: composition.effectiveVariation.variationSeed,
      variationLeafCount: composition.effectiveVariation.variationLeafCount,
      uiControlSource: composition.effectiveVariation.uiControlSource,
      macroAssemblageCount: composition.macroAssemblages.length,
      MacroAssemblageCountLaw: composition.macroAssemblageCountLaw,
      macroAssemblageCountLaw: composition.macroAssemblageCountLaw,
      macroAssemblageIds: composition.macroAssemblages.map(item => item.id),
      selectedMacroAssemblageIds: composition.macroAssemblageCountLaw?.selectedMacroAssemblageIds || [],
      retiredMacroAssemblageIds: composition.macroAssemblageCountLaw?.retiredMacroAssemblageIds || [],
      MacroInterlockGraph: composition.macroInterlockGraph,
      macroInterlockGraph: composition.macroInterlockGraph,
      macroInterlockActiveRelationCount: composition.macroInterlockGraph?.activeRelationCount || 0,
      macroInterlockAffectedMacroIds: composition.macroInterlockGraph?.interlockAffectedMacroIds || [],
      LowerSocketEquatorialSocketJointLaw: composition.lowerSocketEquatorialSocketJointLaw,
      lowerSocketEquatorialSocketJointLaw: composition.lowerSocketEquatorialSocketJointLaw,
      lowerSocketEquatorialSocketJointVerdict: composition.lowerSocketEquatorialSocketJointLaw
        ? 'shared-seam-law-applied'
        : 'shared-seam-law-not-active',
      LowerSocketFamilyRoleLaw: composition.lowerSocketFamilyRoleLaw,
      lowerSocketFamilyRoleLaw: composition.lowerSocketFamilyRoleLaw,
      lowerSocketFamilyRoleVerdict: composition.lowerSocketFamilyRoleVerdict,
      LowerSocketStripHonestyLaw: composition.lowerSocketStripHonestyLaw,
      lowerSocketStripHonestyLaw: composition.lowerSocketStripHonestyLaw,
      lowerSocketStripHonestyVerdict: composition.lowerSocketStripHonestyVerdict,
      MacroContactMap: composition.macroContactMap,
      macroContactMap: composition.macroContactMap,
      macroContactCount: composition.macroContactMap?.contactCount || 0,
      macroClosestContactIds: composition.macroContactMap?.closestContactIds || [],
      macroGeometryCoherenceWatchCount: composition.macroContactMap?.geometryCoherenceWatchCount || 0,
      LowerSocketKeelAnatomyLaw: composition.lowerSocketKeelAnatomyLaw,
      lowerSocketKeelAnatomyLaw: composition.lowerSocketKeelAnatomyLaw,
      lowerSocketKeelAnatomyVerdict: composition.lowerSocketKeelAnatomyVerdict,
      macroFamilySubstripPlan: composition.macroFamilySubstripPlan,
      macroFamilySubstripParentIds: composition.macroFamilySubstripPlan?.parentAssemblageIds || [],
      macroFamilySubstripCount: composition.macroFamilySubstripPlan?.substripCount || 0,
      macroFamilySubstripMeshCount: renderedSubstripMeshIds.length,
      macroFamilySubstripMeshIds: renderedSubstripMeshIds,
      macroFamilySubstripSideWallMeshCount: renderedSubstripSideWallMeshIds.length,
      macroFamilySubstripSideWallMeshIds: renderedSubstripSideWallMeshIds,
      macroFamilySubstripTerminalCapMeshCount: renderedSubstripTerminalCapMeshIds.length,
      macroFamilySubstripTerminalCapMeshIds: renderedSubstripTerminalCapMeshIds,
      visibleParentRetirementPolicy: composition.macroFamilySubstripPlan?.visibleParentRetirementPolicy,
      apertureRelativeTerminationPlan: composition.macroFamilySubstripPlan?.apertureRelativeTerminationPlan,
      apertureTerminationField: composition.macroFamilySubstripPlan?.apertureRelativeTerminationPlan?.apertureField,
      apertureTerminationClassCounts: composition.macroFamilySubstripPlan?.apertureTerminationClassCounts || {},
      apertureTangencyWitnessPlan: composition.macroFamilySubstripPlan?.apertureTangencyWitnessPlan,
      apertureTangencySampleCount: composition.macroFamilySubstripPlan?.apertureTangencyWitnessPlan?.sampleCount || 0,
      apertureTangencyVerdictCounts: composition.macroFamilySubstripPlan?.apertureTangencyWitnessPlan?.verdictCounts || {},
      apertureTangencyMeasuredApertureSourceId: composition.macroFamilySubstripPlan?.apertureTangencyWitnessPlan?.measuredApertureSourceId,
      apertureTangencyOverlayGeometryIds: composition.macroFamilySubstripPlan?.apertureTangencyWitnessPlan?.overlayGeometryIds || [],
      selectedParentPromotedBodyMeshCount: renderedSelectedParentPromotedBodyMeshIds.length,
      selectedParentPromotedBodyMeshIds: renderedSelectedParentPromotedBodyMeshIds,
      selectedParentSideWallMeshCount: renderedSelectedParentSideWallMeshIds.length,
      selectedParentSideWallMeshIds: renderedSelectedParentSideWallMeshIds,
      selectedParentTerminalCapMeshCount: renderedSelectedParentTerminalCapMeshIds.length,
      selectedParentTerminalCapMeshIds: renderedSelectedParentTerminalCapMeshIds,
      macroFamilyObjecthoodVerdict: composition.macroFamilySubstripPlan?.macroFamilyObjecthoodVerdict,
      channelAuditVerdict: composition.channelThroughLineAudit?.channelAuditVerdict,
      constantGapVerdict: composition.channelThroughLineAudit?.constantGapVerdict,
      channelCandidateCount: composition.channelThroughLineAudit?.channelCandidates?.length || 0,
      channelThroughLineDescriptorCount: composition.channelThroughLinePlan?.descriptorCount || 0,
      channelCorridorVerdict: composition.channelThroughLinePlan?.channelCorridorVerdict,
      lamellarChannelStripMeshCount: composition.lamellarChannelMeshPlan?.stripMeshCount || 0,
      lamellarChannelMeshVerdict: composition.lamellarChannelMeshPlan?.meshVerdict,
      lamellarPlateLipCount: composition.lamellarChannelMeshPlan?.plateLipCount || 0,
      plateLipVisualLegibilityVerdict: composition.lamellarChannelMeshPlan?.plateLipVisualLegibilityVerdict,
      roundDiagnosticRailFinalVisible: composition.lamellarChannelMeshPlan?.roundDiagnosticRailFinalVisible,
      plateBoundaryMeshCount: composition.lamellarPlateBoundaryPlan?.boundaryMeshCount || 0,
      plateBoundaryTopologyVerdict: composition.lamellarPlateBoundaryPlan?.plateBoundaryTopologyVerdict,
      targetPlateBoundaryIds: composition.lamellarPlateBoundaryPlan?.targetBoundaryIds || [],
      decorativeSeamHintsFinalVisible: composition.lamellarPlateBoundaryPlan?.decorativeSeamHintsFinalVisible,
      proxyPlateLipsFinalVisible: composition.lamellarPlateBoundaryPlan?.proxyPlateLipsFinalVisible,
      suppressedDecorativeHintCount: composition.lamellarPlateBoundaryPlan?.suppressedDecorativeHintIds?.length || 0,
      suppressedProxyFeatureCount: composition.lamellarPlateBoundaryPlan?.suppressedProxyFeatureIds?.length || 0,
      innerReturnSidePlaneMeshCount: composition.lamellarInnerReturnPlan?.sidePlaneMeshCount || 0,
      innerReturnSidePlaneTopologyVerdict: composition.lamellarInnerReturnPlan?.innerReturnSidePlaneTopologyVerdict,
      innerReturnSideWallVisibilityVerdict: composition.lamellarInnerReturnPlan?.innerReturnSideWallVisibilityVerdict,
      visibleSideWallSurfaceCount: composition.lamellarInnerReturnPlan?.visibleSideWallSurfaceCount || 0,
      cleanTopologyWitnessMode: composition.lamellarInnerReturnPlan?.cleanTopologyWitnessMode,
      cleanTopologyProxyClutterVisible: composition.lamellarInnerReturnPlan?.cleanTopologyProxyClutterVisible,
      liveMacroSideWallCount: composition.liveMacroSideWallPlan?.sideWallCount || 0,
      liveMacroSideWallMeshCount: renderedLiveMacroSideWallMeshIds.length,
      liveMacroSideWallMeshIds: renderedLiveMacroSideWallMeshIds,
      interlockAffectedSideWallCount: composition.liveMacroSideWallPlan?.interlockAffectedSideWallCount || 0,
      liveMacroSideWallVisibilityVerdict: composition.liveMacroSideWallPlan?.liveMacroSideWallVisibilityVerdict,
      targetLiveMacroSideWallIds: composition.liveMacroSideWallPlan?.targetAssemblageIds || [],
      liveMacroTerminalCapCount: composition.liveMacroSideWallPlan?.terminalCapCount || 0,
      terminalCapClosureVerdict: composition.liveMacroSideWallPlan?.terminalCapClosureVerdict,
      normalWitnessMaterialPolicy: composition.liveMacroSideWallPlan?.normalWitnessMaterialPolicy,
      liveRenderMaterialPolicy: composition.liveMacroSideWallPlan?.liveRenderMaterialPolicy,
      suppressedLegacyRoundBandIds: composition.liveMacroSideWallPlan?.suppressedLegacyRoundBandIds || [],
      suppressedLegacyTerminationSocketIds: composition.liveMacroSideWallPlan?.suppressedLegacyTerminationSocketIds || [],
      legacyScaffoldSuppressionVerdict: composition.liveMacroSideWallPlan?.legacyScaffoldSuppressionVerdict,
      targetInnerReturnBoundaryIds: composition.lamellarInnerReturnPlan?.targetBoundaryIds || [],
      declaredSecondLayer: composition.lamellarInnerReturnPlan?.declaredSecondLayer,
      crossingSubSurgeCount: composition.crossingSubSurgePlan?.subSurges?.length || 0,
      cleanProxySurfaceMode: composition.cleanProxySurfacePolicy?.mode,
      topologyOnlySurfaceRelief: composition.cleanProxySurfacePolicy?.topologyOnlySurfaceRelief,
      torsionFieldCount: composition.macroTorsionFieldPlan?.fields?.length || 0,
      effectiveTorsion: composition.macroTorsionFieldPlan?.fields?.map(field => ({
        id: field.id,
        parentAssemblage: field.parentAssemblage,
        effectiveTwist: field.effectiveTwist,
        twistDelta: field.twistDelta,
        torsionGradient: field.torsionGradient,
        surfaceRoll: field.surfaceRoll,
        phaseLag: field.phaseLag,
      })) || [],
      promotedBodyCount: composition.macroBodyPromotion?.promotedBodies?.length || 0,
      expandedRegionCount: composition.expandedMacroRegionProxyPlan?.expandedRegions?.length || 0,
      seamGapCount: composition.expandedMacroRegionProxyPlan?.seamGaps?.length || 0,
      territoryBodyCount: composition.macroAssemblages.filter(item => item.territoryBodyOccupancy).length,
        closureAnchorCount: composition.sphericalClosureAnchors.length,
        frontApertureOwnershipCount: composition.frontApertureOwnership?.owners?.length || 0,
      });
    onDirty?.();
  }

  return {
    setVariation(next = {}) {
      variationOptions = {
        variantId: next.variantId ?? variationOptions.variantId,
        variationSeed: next.variationSeed ?? variationOptions.variationSeed,
        variationLeafCount: next.variationLeafCount ?? variationOptions.variationLeafCount,
        uiControlSource: next.uiControlSource ?? variationOptions.uiControlSource,
      };
      composition = createTargetOrbShellCompositionFixture(variationOptions);
      if (active) build();
      onDirty?.();
    },
    setActive(next) {
      active = !!next;
      if (active) build();
      else disposeGroup();
      onDirty?.();
    },
    frameCamera() {
      camera.position.set(0.16, 0.12, 4.25);
      controls.target.set(0, 0.02, 0);
      controls.update();
      onDirty?.();
    },
    frameSideRimReturn() {
      camera.position.set(2.18, 0.08, -1.08);
      controls.target.set(0.89, 0.02, 0.6);
      controls.update();
      onDirty?.();
    },
    frameLiveMacroSideWall() {
      camera.position.set(-0.05, 0.62, 1.85);
      controls.target.set(-0.82, 0.08, 0.64);
      controls.update();
      onDirty?.();
    },
    frameLiveMacroTerminalCaps() {
      camera.position.set(-0.74, 1.18, 0.78);
      controls.target.set(-0.49, 0.96, 0.02);
      controls.update();
      onDirty?.();
    },
    frameApertureTangencyWitness() {
      camera.position.set(0.12, -1.08, 3.35);
      controls.target.set(-0.04, -0.73, 0.78);
      controls.update();
      onDirty?.();
    },
    frameMacroContactMap() {
      camera.position.set(-0.28, 0.34, 3.1);
      controls.target.set(-0.16, -0.05, 0.48);
      controls.update();
      onDirty?.();
    },
    frameLowerSocketAnatomy() {
      camera.position.set(-1.72, 0.18, 1.56);
      controls.target.set(-0.66, -0.42, 0.32);
      controls.update();
      onDirty?.();
    },
    enableLowerSocketAnatomyWitness() {
      scene.children.forEach(child => {
        if (child !== group) {
          child.userData.lowerSocketAnatomyHidden = true;
          child.visible = false;
        }
      });
      let visibleCount = 0;
      let hiddenCount = 0;
      const visibleMeshIds = [];
      group?.traverse(child => {
        if (!child.isMesh) return;
        const promoted = child.userData?.MacroPromotedBody;
        const substrip = child.userData?.MacroFamilySubstrip;
        const sideWall = child.userData?.LiveMacroSideWall;
        const terminalCap = child.userData?.LiveMacroTerminalCap;
        const territory = child.userData?.MacroTerritoryBody;
        const bandMember = child.userData?.BandMember;
        const isLowerSocket = promoted?.parentAssemblage === 'lower-socket-keel'
          || substrip?.parentAssemblage === 'lower-socket-keel'
          || sideWall?.parentAssemblage === 'lower-socket-keel'
          || terminalCap?.parentAssemblage === 'lower-socket-keel'
          || territory?.parentAssemblage === 'lower-socket-keel'
          || bandMember?.parentAssemblage === 'lower-socket-keel';
        child.visible = !!isLowerSocket;
        if (child.visible) {
          visibleCount += 1;
          visibleMeshIds.push(child.name);
        } else {
          hiddenCount += 1;
        }
      });
      this.frameLowerSocketAnatomy();
      return {
        schema: 'LowerSocketAnatomyWitnessState',
        mode: 'lower-socket-anatomy-isolated-v0',
        targetAssemblage: 'lower-socket-keel',
        visibleCount,
        hiddenCount,
        visibleMeshIds,
        lowerSocketKeelAnatomyLaw: composition.lowerSocketKeelAnatomyLaw,
        lowerSocketKeelAnatomyVerdict: composition.lowerSocketKeelAnatomyVerdict,
      };
    },
    enableMacroContactMapWitness() {
      scene.children.forEach(child => {
        if (child !== group) {
          child.userData.macroContactMapWitnessHidden = true;
          child.visible = false;
        }
      });
      let visibleCount = 0;
      let hiddenCount = 0;
      const visibleOverlayIds = [];
      group?.traverse(child => {
        if (!child.isMesh) return;
        const isOverlay = !!child.userData?.MacroContactSample;
        const promotedBody = child.userData?.MacroPromotedBody;
        const isContextBody = promotedBody && composition.macroContactMap?.rankedContacts?.slice(0, 5).some(contact => (
          contact.sourceMacroId === promotedBody.parentAssemblage
          || contact.targetMacroId === promotedBody.parentAssemblage
        ));
        const isAperture = !!child.userData?.AperturePressure;
        child.visible = isOverlay || isContextBody || isAperture;
        if (child.visible) {
          visibleCount += 1;
          if (isOverlay) visibleOverlayIds.push(child.name);
        } else {
          hiddenCount += 1;
        }
      });
      controls.update();
      onDirty?.();
      return {
        schema: 'MacroContactMapWitnessState',
        mode: 'macro-contact-map-overlay-v0',
        visualOverlayMode: 'ranked-closest-contact-segments',
        contactCount: composition.macroContactMap?.contactCount || 0,
        closestContactIds: composition.macroContactMap?.closestContactIds || [],
        visibleCount,
        hiddenCount,
        visibleOverlayIds,
      };
    },
    enableApertureTangencyWitness() {
      scene.children.forEach(child => {
        if (child !== group) {
          child.userData.apertureTangencyWitnessHidden = true;
          child.visible = false;
        }
      });
      let visibleCount = 0;
      let hiddenCount = 0;
      const visibleOverlayIds = [];
      group?.traverse(child => {
        if (!child.isMesh) return;
        const isOverlay = !!child.userData?.ApertureTangencySample;
        const isAperture = !!child.userData?.AperturePressure;
        const isMeasuredSubstrip = !!child.userData?.MacroFamilySubstrip
          && !child.userData?.MacroFamilySubstripSideWall
          && !child.userData?.MacroFamilySubstripTerminalCap;
        child.visible = isOverlay || isAperture || isMeasuredSubstrip;
        if (child.visible) {
          visibleCount += 1;
          if (isOverlay) visibleOverlayIds.push(child.name);
        } else {
          hiddenCount += 1;
        }
      });
      controls.update();
      onDirty?.();
      return {
        schema: 'ApertureTangencyWitnessState',
        mode: 'aperture-tangency-overlay-v0',
        witnessPlanId: composition.macroFamilySubstripPlan?.apertureTangencyWitnessPlan?.id,
        measuredApertureSourceId: composition.macroFamilySubstripPlan?.apertureTangencyWitnessPlan?.measuredApertureSourceId,
        visualOverlayMode: composition.macroFamilySubstripPlan?.apertureTangencyWitnessPlan?.visualOverlayMode,
        visibleCount,
        hiddenCount,
        visibleOverlayIds,
        sampleCount: composition.macroFamilySubstripPlan?.apertureTangencyWitnessPlan?.sampleCount || 0,
      };
    },
    enableLiveTerminalCapWitness() {
      scene.children.forEach(child => {
        if (child !== group) {
          child.userData.liveTerminalCapWitnessHidden = true;
          child.visible = false;
        }
      });
      let visibleCount = 0;
      let hiddenCount = 0;
      group?.traverse(child => {
        if (!child.isMesh) return;
        const promotedBody = child.userData?.MacroPromotedBody;
        const isTargetBody = promotedBody?.parentAssemblage === 'north-west-dominant-thrust';
        const isTargetSideWall = child.userData?.LiveMacroSideWall?.parentAssemblage === 'north-west-dominant-thrust';
        const isTargetTerminalCap = child.userData?.LiveMacroTerminalCap?.parentAssemblage === 'north-west-dominant-thrust';
        child.visible = isTargetBody || isTargetSideWall || isTargetTerminalCap;
        if (child.visible) visibleCount += 1;
        else hiddenCount += 1;
      });
      controls.update();
      onDirty?.();
      return {
        mode: 'live-terminal-cap-isolated-witness-v0',
        targetAssemblage: 'north-west-dominant-thrust',
        visibleCount,
        hiddenCount,
        visibleRoles: ['MacroPromotedBody', 'LiveMacroSideWall', 'LiveMacroTerminalCap'],
      };
    },
    enableCleanSidewallTopologyWitness() {
      scene.children.forEach(child => {
        if (child !== group) {
          child.userData.cleanSidewallTopologyHidden = true;
          child.visible = false;
        }
      });
      group?.traverse(child => {
        if (!child.isMesh) return;
        const role = child.userData?.cleanTopologyRole;
        child.visible = !!role;
        if (role === 'coupled-sidewall-face-diagnostic') child.material = cleanSideWallMaterial;
        if (role === 'coupled-sidewall-underlay') child.material = cleanSidePlaneMaterial;
        if (role === 'outer-plate-edge-diagnostic') child.material = cleanOuterEdgeMaterial;
        if (role === 'inner-return-edge-diagnostic') child.material = cleanInnerEdgeMaterial;
      });
      camera.position.set(1.72, 0.03, -0.78);
      controls.target.set(0.89, 0.02, 0.6);
      controls.update();
      onDirty?.();
      return {
        schema: 'CleanSidewallTopologyWitnessState',
        cleanTopologyWitnessMode: composition.lamellarInnerReturnPlan?.cleanTopologyWitnessMode,
        materialMode: 'flat-diagnostic-no-metal',
        surfaceDetailMode: 'disabled',
        proxyClutterVisible: false,
        visibleRoles: [
          'outer-plate-edge-diagnostic',
          'inner-return-edge-diagnostic',
          'coupled-sidewall-face-diagnostic',
          'coupled-sidewall-underlay',
        ],
      };
    },
    sideWallVisibilityProbe(viewport = { width: 1600, height: 1100 }) {
      const sideWallMeshes = [];
      group?.traverse(child => {
        if (child.userData?.visibleSideWallSurface) sideWallMeshes.push(child);
      });
      const width = Math.max(1, Number(viewport.width) || 1600);
      const height = Math.max(1, Number(viewport.height) || 1100);
      const probes = sideWallMeshes.map(mesh => {
        const box = new THREE.Box3().setFromObject(mesh);
        const corners = [
          [box.min.x, box.min.y, box.min.z],
          [box.min.x, box.min.y, box.max.z],
          [box.min.x, box.max.y, box.min.z],
          [box.min.x, box.max.y, box.max.z],
          [box.max.x, box.min.y, box.min.z],
          [box.max.x, box.min.y, box.max.z],
          [box.max.x, box.max.y, box.min.z],
          [box.max.x, box.max.y, box.max.z],
        ].map(point => new THREE.Vector3(...point).project(camera));
        const screenPoints = corners
          .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y) && point.z > -1 && point.z < 1)
          .map(point => ({
            x: (point.x * 0.5 + 0.5) * width,
            y: (-point.y * 0.5 + 0.5) * height,
          }));
        if (!screenPoints.length) {
          return {
            name: mesh.name,
            visible: false,
            projectedWidthPx: 0,
            projectedHeightPx: 0,
            contract: mesh.userData.visibleSideWallSurface,
          };
        }
        const minX = Math.min(...screenPoints.map(point => point.x));
        const maxX = Math.max(...screenPoints.map(point => point.x));
        const minY = Math.min(...screenPoints.map(point => point.y));
        const maxY = Math.max(...screenPoints.map(point => point.y));
        const projectedWidthPx = maxX - minX;
        const projectedHeightPx = maxY - minY;
        return {
          name: mesh.name,
          visible: projectedWidthPx >= mesh.userData.visibleSideWallSurface.minimumProjectedWidthPx,
          projectedWidthPx,
          projectedHeightPx,
          contract: mesh.userData.visibleSideWallSurface,
        };
      });
      return {
        schema: 'LamellarInnerReturnSideWallVisibilityProbe',
        meshCount: sideWallMeshes.length,
        visibleMeshCount: probes.filter(probe => probe.visible).length,
        probes,
      };
    },
    dispose() {
      active = false;
      disposeGroup();
    },
    debugState() {
      return {
        identity: ORB_SHELL_COMPOSITION_IDENTITY,
        active,
        baselineDisposition: ORB_SHELL_COMPOSITION_BASELINE,
        variantId: composition.effectiveVariation.variantId,
        variationSeed: composition.effectiveVariation.variationSeed,
        variationLeafCount: composition.effectiveVariation.variationLeafCount,
        uiControlSource: composition.effectiveVariation.uiControlSource,
        controlledVariation: composition.controlledVariation,
        effectiveVariation: composition.effectiveVariation,
        macroAssemblageCount: composition.macroAssemblages.length,
        MacroAssemblageCountLaw: composition.macroAssemblageCountLaw,
        macroAssemblageCountLaw: composition.macroAssemblageCountLaw,
        macroAssemblageIds: composition.macroAssemblages.map(item => item.id),
        selectedMacroAssemblageIds: composition.macroAssemblageCountLaw?.selectedMacroAssemblageIds || [],
        retiredMacroAssemblageIds: composition.macroAssemblageCountLaw?.retiredMacroAssemblageIds || [],
        MacroInterlockGraph: composition.macroInterlockGraph,
        macroInterlockGraph: composition.macroInterlockGraph,
        macroInterlockActiveRelationCount: composition.macroInterlockGraph?.activeRelationCount || 0,
        macroInterlockAffectedMacroIds: composition.macroInterlockGraph?.interlockAffectedMacroIds || [],
        LowerSocketEquatorialSocketJointLaw: composition.lowerSocketEquatorialSocketJointLaw,
        lowerSocketEquatorialSocketJointLaw: composition.lowerSocketEquatorialSocketJointLaw,
        lowerSocketEquatorialSocketJointVerdict: composition.lowerSocketEquatorialSocketJointLaw
          ? 'shared-seam-law-applied'
          : 'shared-seam-law-not-active',
        LowerSocketFamilyRoleLaw: composition.lowerSocketFamilyRoleLaw,
        lowerSocketFamilyRoleLaw: composition.lowerSocketFamilyRoleLaw,
        lowerSocketFamilyRoleVerdict: composition.lowerSocketFamilyRoleVerdict,
        LowerSocketStripHonestyLaw: composition.lowerSocketStripHonestyLaw,
        lowerSocketStripHonestyLaw: composition.lowerSocketStripHonestyLaw,
        lowerSocketStripHonestyVerdict: composition.lowerSocketStripHonestyVerdict,
        MacroContactMap: composition.macroContactMap,
        macroContactMap: composition.macroContactMap,
        MacroContactSample: composition.macroContactMap?.contacts || [],
        macroContactCount: composition.macroContactMap?.contactCount || 0,
        macroClosestContactIds: composition.macroContactMap?.closestContactIds || [],
        macroGeometryCoherenceWatch: composition.macroContactMap?.geometryCoherenceWatch || [],
        macroGeometryCoherenceWatchCount: composition.macroContactMap?.geometryCoherenceWatchCount || 0,
        LowerSocketKeelAnatomyLaw: composition.lowerSocketKeelAnatomyLaw,
        lowerSocketKeelAnatomyLaw: composition.lowerSocketKeelAnatomyLaw,
        lowerSocketKeelAnatomyVerdict: composition.lowerSocketKeelAnatomyVerdict,
        MacroFamilySubstripPlan: composition.macroFamilySubstripPlan,
        macroFamilySubstripPlan: composition.macroFamilySubstripPlan,
        MacroFamilySubstrip: composition.macroFamilySubstripPlan?.substrips || [],
        macroFamilySubstripParentIds: composition.macroFamilySubstripPlan?.parentAssemblageIds || [],
        macroFamilySubstripCount: composition.macroFamilySubstripPlan?.substripCount || 0,
        macroFamilySubstripMeshCount: macroFamilySubstripMeshIds().length,
        macroFamilySubstripMeshIds: macroFamilySubstripMeshIds(),
        macroFamilySubstripSideWallMeshCount: macroFamilySubstripSideWallMeshIds().length,
        macroFamilySubstripSideWallMeshIds: macroFamilySubstripSideWallMeshIds(),
        macroFamilySubstripTerminalCapMeshCount: macroFamilySubstripTerminalCapMeshIds().length,
        macroFamilySubstripTerminalCapMeshIds: macroFamilySubstripTerminalCapMeshIds(),
        macroFamilySubstripGapContracts: composition.macroFamilySubstripPlan?.gapContracts || [],
        visibleParentRetirementPolicy: composition.macroFamilySubstripPlan?.visibleParentRetirementPolicy,
        apertureRelativeTerminationPlan: composition.macroFamilySubstripPlan?.apertureRelativeTerminationPlan,
        apertureTerminationField: composition.macroFamilySubstripPlan?.apertureRelativeTerminationPlan?.apertureField,
        apertureTerminationClassCounts: composition.macroFamilySubstripPlan?.apertureTerminationClassCounts || {},
        ApertureTangencyWitnessPlan: composition.macroFamilySubstripPlan?.apertureTangencyWitnessPlan,
        apertureTangencyWitnessPlan: composition.macroFamilySubstripPlan?.apertureTangencyWitnessPlan,
        ApertureTangencySample: composition.macroFamilySubstripPlan?.apertureTangencyWitnessPlan?.samples || [],
        apertureTangencySampleCount: composition.macroFamilySubstripPlan?.apertureTangencyWitnessPlan?.sampleCount || 0,
        apertureTangencyVerdictCounts: composition.macroFamilySubstripPlan?.apertureTangencyWitnessPlan?.verdictCounts || {},
        apertureTangencyMeasuredApertureSourceId: composition.macroFamilySubstripPlan?.apertureTangencyWitnessPlan?.measuredApertureSourceId,
        apertureTangencyOverlayGeometryIds: composition.macroFamilySubstripPlan?.apertureTangencyWitnessPlan?.overlayGeometryIds || [],
        selectedParentPromotedBodyMeshCount: selectedParentPromotedBodyMeshIds().length,
        selectedParentPromotedBodyMeshIds: selectedParentPromotedBodyMeshIds(),
        selectedParentSideWallMeshCount: selectedParentSideWallMeshIds().length,
        selectedParentSideWallMeshIds: selectedParentSideWallMeshIds(),
        selectedParentTerminalCapMeshCount: selectedParentTerminalCapMeshIds().length,
        selectedParentTerminalCapMeshIds: selectedParentTerminalCapMeshIds(),
        macroFamilyObjecthoodVerdict: composition.macroFamilySubstripPlan?.macroFamilyObjecthoodVerdict,
        channelAuditVerdict: composition.channelThroughLineAudit?.channelAuditVerdict,
        constantGapVerdict: composition.channelThroughLineAudit?.constantGapVerdict,
        channelCandidateCount: composition.channelThroughLineAudit?.channelCandidates?.length || 0,
        channelThroughLineDescriptorCount: composition.channelThroughLinePlan?.descriptorCount || 0,
        channelCorridorVerdict: composition.channelThroughLinePlan?.channelCorridorVerdict,
        lamellarChannelStripMeshCount: composition.lamellarChannelMeshPlan?.stripMeshCount || 0,
        lamellarChannelMeshVerdict: composition.lamellarChannelMeshPlan?.meshVerdict,
        lamellarPlateLipCount: composition.lamellarChannelMeshPlan?.plateLipCount || 0,
        plateLipVisualLegibilityVerdict: composition.lamellarChannelMeshPlan?.plateLipVisualLegibilityVerdict,
        roundDiagnosticRailFinalVisible: composition.lamellarChannelMeshPlan?.roundDiagnosticRailFinalVisible,
        plateBoundaryMeshCount: composition.lamellarPlateBoundaryPlan?.boundaryMeshCount || 0,
        plateBoundaryTopologyVerdict: composition.lamellarPlateBoundaryPlan?.plateBoundaryTopologyVerdict,
        targetPlateBoundaryIds: composition.lamellarPlateBoundaryPlan?.targetBoundaryIds || [],
        decorativeSeamHintsFinalVisible: composition.lamellarPlateBoundaryPlan?.decorativeSeamHintsFinalVisible,
        proxyPlateLipsFinalVisible: composition.lamellarPlateBoundaryPlan?.proxyPlateLipsFinalVisible,
        suppressedDecorativeHintCount: composition.lamellarPlateBoundaryPlan?.suppressedDecorativeHintIds?.length || 0,
        suppressedProxyFeatureCount: composition.lamellarPlateBoundaryPlan?.suppressedProxyFeatureIds?.length || 0,
        innerReturnSidePlaneMeshCount: composition.lamellarInnerReturnPlan?.sidePlaneMeshCount || 0,
        innerReturnSidePlaneTopologyVerdict: composition.lamellarInnerReturnPlan?.innerReturnSidePlaneTopologyVerdict,
        innerReturnSideWallVisibilityVerdict: composition.lamellarInnerReturnPlan?.innerReturnSideWallVisibilityVerdict,
        visibleSideWallSurfaceCount: composition.lamellarInnerReturnPlan?.visibleSideWallSurfaceCount || 0,
        cleanTopologyWitnessMode: composition.lamellarInnerReturnPlan?.cleanTopologyWitnessMode,
        cleanTopologyProxyClutterVisible: composition.lamellarInnerReturnPlan?.cleanTopologyProxyClutterVisible,
        liveMacroSideWallCount: composition.liveMacroSideWallPlan?.sideWallCount || 0,
        liveMacroSideWallMeshCount: liveMacroSideWallMeshIds().length,
        liveMacroSideWallMeshIds: liveMacroSideWallMeshIds(),
        interlockAffectedSideWallCount: composition.liveMacroSideWallPlan?.interlockAffectedSideWallCount || 0,
        liveMacroSideWallVisibilityVerdict: composition.liveMacroSideWallPlan?.liveMacroSideWallVisibilityVerdict,
        targetLiveMacroSideWallIds: composition.liveMacroSideWallPlan?.targetAssemblageIds || [],
        liveMacroTerminalCapCount: composition.liveMacroSideWallPlan?.terminalCapCount || 0,
        terminalCapClosureVerdict: composition.liveMacroSideWallPlan?.terminalCapClosureVerdict,
        normalWitnessMaterialPolicy: composition.liveMacroSideWallPlan?.normalWitnessMaterialPolicy,
        liveRenderMaterialPolicy: composition.liveMacroSideWallPlan?.liveRenderMaterialPolicy,
        suppressedLegacyRoundBandIds: composition.liveMacroSideWallPlan?.suppressedLegacyRoundBandIds || [],
        suppressedLegacyTerminationSocketIds: composition.liveMacroSideWallPlan?.suppressedLegacyTerminationSocketIds || [],
        legacyScaffoldSuppressionVerdict: composition.liveMacroSideWallPlan?.legacyScaffoldSuppressionVerdict,
        targetInnerReturnBoundaryIds: composition.lamellarInnerReturnPlan?.targetBoundaryIds || [],
        declaredSecondLayer: composition.lamellarInnerReturnPlan?.declaredSecondLayer,
        crossingSubSurgeCount: composition.crossingSubSurgePlan?.subSurges?.length || 0,
        cleanProxySurfaceMode: composition.cleanProxySurfacePolicy?.mode,
        topologyOnlySurfaceRelief: composition.cleanProxySurfacePolicy?.topologyOnlySurfaceRelief,
        torsionFieldCount: composition.macroTorsionFieldPlan?.fields?.length || 0,
        effectiveTorsion: composition.macroTorsionFieldPlan?.fields?.map(field => ({
          id: field.id,
          parentAssemblage: field.parentAssemblage,
          effectiveTwist: field.effectiveTwist,
          twistDelta: field.twistDelta,
          torsionGradient: field.torsionGradient,
          surfaceRoll: field.surfaceRoll,
          phaseLag: field.phaseLag,
        })) || [],
        promotedBodyCount: composition.macroBodyPromotion?.promotedBodies?.length || 0,
        expandedRegionCount: composition.expandedMacroRegionProxyPlan?.expandedRegions?.length || 0,
        seamGapCount: composition.expandedMacroRegionProxyPlan?.seamGaps?.length || 0,
        bandMemberCount: composition.macroAssemblages.reduce((sum, item) => sum + item.childBandPlan.length, 0),
        territoryBodyCount: composition.macroAssemblages.filter(item => item.territoryBodyOccupancy).length,
        closureAnchorCount: composition.sphericalClosureAnchors.length,
        shapedBoundaryCount: composition.macroAssemblages.filter(item => item.territoryBodyOccupancy?.boundaryPressureField).length,
        frontApertureOwnershipCount: composition.frontApertureOwnership?.owners?.length || 0,
        PrimaryApertureFrame: composition.frontApertureOwnership,
        frontApertureOwnership: composition.frontApertureOwnership,
        ChannelThroughLineAudit: composition.channelThroughLineAudit,
        channelThroughLineAudit: composition.channelThroughLineAudit,
        ChannelThroughLinePlan: composition.channelThroughLinePlan,
        channelThroughLinePlan: composition.channelThroughLinePlan,
        ChannelThroughLineDescriptor: composition.channelThroughLinePlan?.descriptors || [],
        LamellarChannelMeshPlan: composition.lamellarChannelMeshPlan,
        lamellarChannelMeshPlan: composition.lamellarChannelMeshPlan,
        LamellarChannelStripMesh: composition.lamellarChannelMeshPlan?.stripMeshes || [],
        LamellarPlateLip: composition.lamellarChannelMeshPlan?.stripMeshes?.flatMap(strip => strip.plateLips || []) || [],
        LamellarPlateBoundaryPlan: composition.lamellarPlateBoundaryPlan,
        lamellarPlateBoundaryPlan: composition.lamellarPlateBoundaryPlan,
        LamellarPlateBoundaryMesh: composition.lamellarPlateBoundaryPlan?.boundaryMeshes || [],
        LamellarInnerReturnPlan: composition.lamellarInnerReturnPlan,
        lamellarInnerReturnPlan: composition.lamellarInnerReturnPlan,
        LamellarInnerReturnSidePlaneMesh: composition.lamellarInnerReturnPlan?.sidePlaneMeshes || [],
        CrossingSubSurgePlan: composition.crossingSubSurgePlan,
        crossingSubSurgePlan: composition.crossingSubSurgePlan,
        CrossingSubSurge: composition.crossingSubSurgePlan?.subSurges || [],
        CleanProxySurfacePolicy: composition.cleanProxySurfacePolicy,
        cleanProxySurfacePolicy: composition.cleanProxySurfacePolicy,
        MacroTorsionFieldPlan: composition.macroTorsionFieldPlan,
        macroTorsionFieldPlan: composition.macroTorsionFieldPlan,
        MacroTorsionField: composition.macroTorsionFieldPlan?.fields || [],
        MacroBodyPromotionPlan: composition.macroBodyPromotion,
        macroBodyPromotion: composition.macroBodyPromotion,
        MacroPromotedBody: composition.macroBodyPromotion?.promotedBodies || [],
        LiveMacroSideWallPlan: composition.liveMacroSideWallPlan,
        liveMacroSideWallPlan: composition.liveMacroSideWallPlan,
        LiveMacroSideWall: composition.liveMacroSideWallPlan?.sideWalls || [],
        LiveMacroTerminalCap: composition.liveMacroSideWallPlan?.terminalCaps || [],
        lowerCupClosure: composition.macroBodyPromotion?.lowerCupClosure,
        crossingTuckIntegration: composition.macroBodyPromotion?.crossingTuckIntegration,
        ExpandedMacroRegionProxyPlan: composition.expandedMacroRegionProxyPlan,
        expandedMacroRegionProxyPlan: composition.expandedMacroRegionProxyPlan,
        ExpandedMacroRegionProxy: composition.expandedMacroRegionProxyPlan?.expandedRegions || [],
        MacroRegionSeamGapDescriptor: composition.expandedMacroRegionProxyPlan?.seamGaps || [],
        MacroTerritoryBody: composition.macroAssemblages.map(item => item.territoryBodyOccupancy),
        BoundaryPressureField: composition.macroAssemblages.map(item => item.territoryBodyOccupancy?.boundaryPressureField),
        boundaryPressureFields: composition.macroAssemblages.map(item => item.territoryBodyOccupancy?.boundaryPressureField),
        sphericalClosureAnchors: composition.sphericalClosureAnchors,
        OrbShellComposition: composition,
        inverseProceduralHypotheses: composition.inverseProceduralHypotheses,
        forbiddenFailureClasses: composition.AperturePressure.forbiddenFailureClasses,
      };
    },
  };
}
