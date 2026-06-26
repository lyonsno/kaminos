export const ORB_SHELL_COMPOSITION_IDENTITY = 'orb-shell-macro-grammar-grounding-v0';
export const ORB_SHELL_COMPOSITION_BASELINE = 'coherent-but-wrong-model-baseline';
export const ORB_SHELL_CONTROLLED_VARIATION_MODE = 'orb-shell-controlled-variation-assay-v0';
export const ORB_SHELL_MACRO_TORSION_MODE = 'macro-torsion-field-v0';

const TAU = Math.PI * 2;
const MACRO_VARIATION_IDS = [
  'north-west-dominant-thrust',
  'north-east-counter-thrust',
  'equatorial-cupping-whorl',
  'polar-crown-lock',
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

export function createControlledOrbShellVariationDescriptor({ variantId = 'baseline', variationSeed = 0 } = {}) {
  const normalizedVariantId = String(variantId || 'baseline');
  const seed = Number.isFinite(Number(variationSeed)) ? Number(variationSeed) : 0;
  const preset = variantPreset(normalizedVariantId);
  const macroAssemblages = {};
  for (const id of MACRO_VARIATION_IDS) {
    const base = `${normalizedVariantId}:${seed}:${id}`;
    const amplitude = preset.amplitude;
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
    boundedParameterFamilies: [
      'macro phase',
      'macro bow',
      'macro torsion',
      'twist delta',
      'surface roll',
      'territory width',
      'child sibling offset',
      'boundary aperture bite',
      'lower cup depth',
      'crossing tuck phase',
      'owner dominance',
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
      'four-macro-assay-count',
      'spherical-closure-anchors',
      'shaped-boundary-pressure-fields',
      'wrong-model-baseline-warning',
    ],
    effectiveParameters: {
      macroAssemblages,
      frontApertureOwnership: {
        lowerCupDepth: clamp(1 + preset.cupBias + stableNoise(`${normalizedVariantId}:${seed}:lower-cup`) * 0.12 * preset.amplitude, 0.82, 1.26),
        crossingTuckPhase: clamp(preset.tuckBias + stableNoise(`${normalizedVariantId}:${seed}:crossing-tuck`) * 0.18 * preset.amplitude, -0.24, 0.26),
        ownerDominance: clamp(1 + preset.dominanceBias + stableNoise(`${normalizedVariantId}:${seed}:owner-dominance`) * 0.1 * preset.amplitude, 0.84, 1.28),
        apertureBite: clamp(1 + stableNoise(`${normalizedVariantId}:${seed}:aperture-bite`) * 0.12 * preset.amplitude, 0.84, 1.18),
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
    promotedBodyScale: assemblage.role === 'crown-lock' ? 1.22 : assemblage.role === 'supporting-whorl' ? 1.34 : 1.28,
    subordinateAnatomy: [
      'internal-rail-ridge',
      'edge-lip-channel',
      'slit-gap-within-macro-body',
      'child-band-as-anatomy-not-object',
    ],
    closureContracts,
    failurePressure: 'visible-bands-must-not-remain-final-objects',
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
  return {
    schema: 'MacroBodyPromotionPlan',
    mode: 'macro-body-promotion-closure-v0',
    promotedBodies,
    lowerCupClosure: promotedBodies.find(body => body.lowerCupClosure)?.lowerCupClosure,
    crossingTuckIntegration: promotedBodies.find(body => body.crossingTuckIntegration)?.crossingTuckIntegration,
    closurePolicy: [
      'macro-bodies-own-visible-objecthood',
      'subordinate-bands-become-ridges-slots-and-lips',
      'lower-cup-socket-contiguous',
      'crossing-tuck-macro-body',
      'forbid-accidental-triangle-bottom-gap',
    ],
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
      'surface-attachment-proof',
    ],
  };
}

export function applyControlledOrbShellVariation(composition, descriptor) {
  const next = clone(composition);
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
  for (const assemblage of next.macroAssemblages) {
    assemblage.macroPromotedBody = next.macroBodyPromotion.promotedBodies.find(body => body.parentAssemblage === assemblage.id);
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
  next.channelThroughLineAudit = createChannelThroughLineAudit(next);
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

  const macroAssemblages = [
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
  ];

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
  const lat = control.startLat + (control.endLat - control.startLat) * t;
  const widthPressure = assemblage.sphericalTerritory.lonWidth * 0.12;
  const siblingOffset = bandMember.siblingOffset + Math.sin(Math.PI * t) * widthPressure * 0.18;
  const effectiveTwist = control.effectiveTwist ?? control.twist;
  const torsionWave = torsion
    ? Math.sin(TAU * t + torsion.phaseLag) * torsion.torsionGradient * Math.sin(Math.PI * t)
    : 0;
  const surfaceRollBias = torsion
    ? torsion.surfaceRoll * Math.sin(Math.PI * t) * (bandMember.siblingOffset || 0) * 0.9
    : 0;
  const lon = assemblage.sphericalTerritory.centerPhase
    + assemblage.handedness * effectiveTwist * (t - 0.5)
    + Math.sin(Math.PI * t) * control.bow
    + torsionWave
    + surfaceRollBias
    + siblingOffset;
  const layer = bandMember.layerIntervals.find(interval => t >= interval.t0 && t <= interval.t1)?.layer || 'outer';
  const layerBias = layer === 'inner-support' ? -0.045 : layer === 'under-neighbor' ? -0.025 : 0.02;
  return spherePoint(lat, lon, radius + layerBias);
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
  let strength = 0;
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
    const leftWidth = body.widthProfile.mid * scale * terminalScale * nearestCut.leftScale;
    const rightWidth = body.widthProfile.mid * scale * terminalScale * nearestCut.rightScale;
    const lift = body.thicknessProfile.mid * (0.85 + 0.75 * profile);
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

function makeAperturePressureRing(THREE, voidRecord) {
  const [cx, cy, cz] = voidRecord.center;
  const [rx, ry] = voidRecord.radius;
  const points = [];
  for (let i = 0; i <= 120; i++) {
    const a = (i / 120) * TAU;
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    const z = Math.max(cz * 0.8, Math.sqrt(Math.max(0.01, 1 - x * x - y * y))) + 0.05;
    points.push(new THREE.Vector3(x, y, z));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, true), 120, 0.006, 8, true);
}

function makeSeamGapHintGeometry(THREE, gap) {
  const seamShapes = {
    'primary-front-intentional-slit': [[-0.28, 0.42, 0.92], [-0.18, 0.16, 1.04], [-0.02, -0.12, 1.07], [0.16, -0.42, 0.9]],
    'crossing-tuck-overlap-receiver': [[-0.1, -0.1, 1.05], [0.08, -0.2, 1.08], [0.28, -0.34, 0.94]],
    'lower-cup-socket-join-gap': [[-0.28, -0.82, 0.67], [-0.05, -0.92, 0.58], [0.26, -0.82, 0.68]],
    'upper-crown-receiver-gap': [[-0.28, 0.9, 0.52], [0.02, 1.02, 0.34], [0.32, 0.88, 0.52]],
    'right-side-rim-reveal-gap': [[0.74, 0.3, 0.62], [0.86, 0.02, 0.58], [0.76, -0.24, 0.62]],
  };
  const points = (seamShapes[gap.id] || [[-0.2, 0, 1.02], [0, 0, 1.08], [0.2, 0, 1.02]])
    .map(point => new THREE.Vector3(...point).normalize().multiplyScalar(1.085));
  const radius = gap.type === 'lower-socket-join' ? 0.004 : 0.006;
  const curve = new THREE.CatmullRomCurve3(points);
  const geometry = new THREE.TubeGeometry(curve, 48, radius, 6, false);
  geometry.userData.MacroRegionSeamGapDescriptor = gap;
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
  let variationOptions = { variantId: 'baseline', variationSeed: 0 };
  let composition = createTargetOrbShellCompositionFixture(variationOptions);

  const sharedMaterials = new Set();
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x252c30, roughness: 0.24, metalness: 0.92, envMapIntensity: 2.4 });
  const territoryMaterial = new THREE.MeshStandardMaterial({
    color: 0x1b2225,
    roughness: 0.3,
    metalness: 0.88,
    envMapIntensity: 1.9,
    side: THREE.DoubleSide,
  });
  const railMaterial = new THREE.MeshStandardMaterial({ color: 0x6b777b, roughness: 0.2, metalness: 0.9, envMapIntensity: 2.8 });
  const hopMaterial = new THREE.MeshStandardMaterial({ color: 0x42302a, roughness: 0.28, metalness: 0.86, envMapIntensity: 2.2 });
  const apertureMaterial = new THREE.MeshBasicMaterial({ color: 0x61b8d9, transparent: true, opacity: 0.28, depthWrite: false });
  const terminationMaterial = new THREE.MeshBasicMaterial({ color: 0xff6a1c, transparent: true, opacity: 0.42 });
  const apertureOwnerBodyMaterial = new THREE.MeshStandardMaterial({ color: 0x20272a, roughness: 0.25, metalness: 0.9, envMapIntensity: 2.2, side: THREE.DoubleSide });
  const apertureOwnerRailMaterial = new THREE.MeshStandardMaterial({ color: 0x71828a, roughness: 0.18, metalness: 0.92, envMapIntensity: 3 });
  const crossingSubSurgeRailMaterial = new THREE.MeshStandardMaterial({ color: 0x1d2a2f, roughness: 0.44, metalness: 0.74, envMapIntensity: 0.9 });
  const promotedBodyMaterial = new THREE.MeshStandardMaterial({ color: 0x12171a, roughness: 0.24, metalness: 0.93, envMapIntensity: 2.5, side: THREE.DoubleSide });
  const crossingTuckBodyMaterial = new THREE.MeshStandardMaterial({ color: 0x1d2529, roughness: 0.22, metalness: 0.91, envMapIntensity: 2.6, side: THREE.DoubleSide });
  const seamGapHintMaterial = new THREE.MeshBasicMaterial({ color: 0x061015, transparent: true, opacity: 0.74, depthWrite: false });
  for (const material of [
    bodyMaterial,
    territoryMaterial,
    railMaterial,
    hopMaterial,
    apertureMaterial,
    terminationMaterial,
    apertureOwnerBodyMaterial,
    apertureOwnerRailMaterial,
    promotedBodyMaterial,
    crossingTuckBodyMaterial,
    seamGapHintMaterial,
  ]) sharedMaterials.add(material);

  function materialForBand(bandMember) {
    if (bandMember.role === 'body') return bodyMaterial;
    if (bandMember.role === 'hopping-member') return hopMaterial;
    return railMaterial;
  }

  function disposeGroup() {
    if (!group) return;
    scene.remove(group);
    group.traverse(child => disposeObject(child, sharedMaterials));
    group = null;
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
      const promotedMesh = new THREE.Mesh(makeMacroPromotedBodyGeometry(THREE, assemblage), promotedBodyMaterial);
      promotedMesh.name = `${assemblage.id}-macro-promoted-body`;
      promotedMesh.userData.MacroPromotedBody = assemblage.macroPromotedBody;
      promotedMesh.userData.MacroTorsionField = assemblage.macroTorsionField;
      macroGroup.add(promotedMesh);
      const territoryMesh = new THREE.Mesh(makeMacroTerritoryBodyGeometry(THREE, assemblage), territoryMaterial);
      territoryMesh.name = `${assemblage.id}-macro-territory-body`;
      territoryMesh.userData.MacroTerritoryBody = assemblage.territoryBodyOccupancy;
      territoryMesh.userData.MacroTorsionField = assemblage.macroTorsionField;
      macroGroup.add(territoryMesh);
      for (const bandMember of assemblage.childBandPlan) {
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

    for (const voidRecord of composition.AperturePressure.primaryVoids) {
      const ring = new THREE.Mesh(makeAperturePressureRing(THREE, voidRecord), apertureMaterial);
      ring.name = `${voidRecord.id}-aperture-pressure-ring`;
      ring.userData.AperturePressure = voidRecord;
      group.add(ring);
    }
    for (const gap of composition.expandedMacroRegionProxyPlan?.seamGaps || []) {
      const seam = new THREE.Mesh(makeSeamGapHintGeometry(THREE, gap), seamGapHintMaterial);
      seam.name = `${gap.id}-future-mesh-boundary-input`;
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
    onStatus?.({
      phase: 'built',
      identity: ORB_SHELL_COMPOSITION_IDENTITY,
      variantId: composition.effectiveVariation.variantId,
      variationSeed: composition.effectiveVariation.variationSeed,
      macroAssemblageCount: composition.macroAssemblages.length,
      channelAuditVerdict: composition.channelThroughLineAudit?.channelAuditVerdict,
      constantGapVerdict: composition.channelThroughLineAudit?.constantGapVerdict,
      channelCandidateCount: composition.channelThroughLineAudit?.channelCandidates?.length || 0,
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
        controlledVariation: composition.controlledVariation,
        effectiveVariation: composition.effectiveVariation,
        macroAssemblageCount: composition.macroAssemblages.length,
        channelAuditVerdict: composition.channelThroughLineAudit?.channelAuditVerdict,
        constantGapVerdict: composition.channelThroughLineAudit?.constantGapVerdict,
        channelCandidateCount: composition.channelThroughLineAudit?.channelCandidates?.length || 0,
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
