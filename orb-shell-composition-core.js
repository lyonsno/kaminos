export const ORB_SHELL_COMPOSITION_IDENTITY = 'orb-shell-macro-grammar-grounding-v0';
export const ORB_SHELL_COMPOSITION_BASELINE = 'coherent-but-wrong-model-baseline';
export const ORB_SHELL_CONTROLLED_VARIATION_MODE = 'orb-shell-controlled-variation-assay-v0';
export const ORB_SHELL_MACRO_TORSION_MODE = 'macro-torsion-field-v0';
export const ORB_SHELL_MACRO_FAMILY_SUBSTRIP_MODE = 'parent-owned-lamellar-substrip-decomposition-v0';
export const ORB_SHELL_APERTURE_TERMINATION_MODE = 'aperture-relative-lamellar-termination-v0';
export const ORB_SHELL_APERTURE_TANGENCY_WITNESS_MODE = 'aperture-tangency-witness-v0';
export const ORB_SHELL_APERTURE_AWARE_TERMINUS_MODE = 'aperture-aware-terminus-v0';
export const ORB_SHELL_APERTURE_ORBIT_CAPTURE_MODE = 'macro-aperture-orbit-capture-v0';
export const ORB_SHELL_LOWER_SOCKET_RENDER_INVENTORY_MODE = 'lower-socket-semantic-render-inventory-v0';
export const ORB_SHELL_SOCKET_TONGUE_PROVENANCE_MODE = 'socket-tongue-provenance-v0';
export const ORB_SHELL_SOCKET_TONGUE_GENERATIVE_INVARIANT_MODE = 'socket-tongue-generative-invariants-v0';
export const ORB_SHELL_SOCKET_TONGUE_REPRODUCTION_MODE = 'socket-tongue-reproduction-probe-v0';
export const ORB_SHELL_SOCKET_TONGUE_POST_STRIP_HONESTY_MODE = 'socket-tongue-post-strip-honesty-preservation-v0';
export const ORB_SHELL_MACRO_MORPHOLOGY_INVENTORY_MODE = 'macro-curve-vs-promoted-body-diagnostic-v0';
export const ORB_SHELL_PROCEDURAL_ARCHITECTURE_INVENTORY_MODE = 'curve-first-semantic-architecture-xray-v0';
export const ORB_SHELL_LAW_CONTROLS_SCHEMA = 'OrbShellLawControls';

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
const LOWER_SOCKET_RENDER_CLASS_COLORS = {
  MacroPromotedBody: 0x5bc0eb,
  LiveMacroSideWall: 0xfde74c,
  LiveMacroTerminalCap: 0xf45b69,
  MacroFamilySubstrip: 0x9bc53d,
  MacroFamilySubstripSideWall: 0xe55934,
  MacroFamilySubstripTerminalCap: 0xfa7921,
  BandMember: 0x7b2cbf,
  TerminationSocketGraph: 0xff8c42,
  LamellarChannelStripMesh: 0x00bbf9,
  LamellarPlateLip: 0xfee440,
  LamellarPlateBoundaryMesh: 0x00f5d4,
  LamellarInnerReturnSidePlaneMesh: 0x9b5de5,
  MacroRegionSeamGapDescriptor: 0xf15bb5,
};

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

function normalizedBoolean(value, defaultValue = true) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['1', 'true', 'on', 'yes', 'enabled'].includes(String(value).toLowerCase());
}

function normalizedUnit(value, defaultValue = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, 0, 1) : defaultValue;
}

function normalizedLawDebugMode(value) {
  const mode = String(value || '').trim();
  return [
    'none',
    'orbit-delta',
    'cap-envelope',
    'all-law-impact',
  ].includes(mode)
    ? mode
    : 'all-law-impact';
}

export function normalizeOrbShellLawControls(input = {}) {
  const curvature = input.curvatureWidthCap || {};
  const aperture = input.apertureOrbitCapture || {};
  const viewMode = input.viewMode === 'curve-on-sphere' ? 'curve-on-sphere' : 'geometry';
  return {
    schema: ORB_SHELL_LAW_CONTROLS_SCHEMA,
    mode: 'operator-visible-procedural-law-controls-v0',
    viewMode,
    debugMode: normalizedLawDebugMode(input.debugMode),
    curvatureWidthCap: {
      id: 'curvature-width-cap',
      label: 'Curvature width cap',
      enabled: normalizedBoolean(input.curvatureWidthCapEnabled ?? curvature.enabled, true),
      strength: normalizedUnit(input.curvatureWidthCapStrength ?? curvature.strength, 1),
      lawSchema: 'CurvatureWidthCapLaw',
    },
    apertureOrbitCapture: {
      id: 'aperture-orbit-capture',
      label: 'Aperture orbit capture',
      enabled: normalizedBoolean(input.apertureOrbitCaptureEnabled ?? aperture.enabled, true),
      strength: normalizedUnit(input.apertureOrbitCaptureStrength ?? aperture.strength, 1),
      lawSchema: 'ApertureOrbitCaptureLaw',
    },
  };
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
        ? 'provisional-visible-until-receiver-owned-tuck'
        : 'absorbed-no-visible-terminal-cap',
      terminalCapVisibilityPolicy: hasEquatorialSocket
        ? 'visible-until-receiver-owned-occlusion-or-absorption'
        : 'hidden-after-absorption',
      receiverOwnedTuckDisposition: null,
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
  const roleTotal = activeEffects.reduce((total, item) => {
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
  const plateLaw = assemblage.lowerSocketPlateBodyHonestyLaw
    || assemblage.macroPromotedBody?.lowerSocketPlateBodyHonestyLaw;
  const plateInfluence = lowerSocketPlateBodyHonestyInfluence(plateLaw, t);
  if (!plateInfluence) return roleTotal;
  return {
    ...roleTotal,
    widthScale: Math.max(roleTotal.widthScale, plateLaw.roleWidthScaleFloor * plateInfluence),
    terminalAbsorption: roleTotal.terminalAbsorption * (1 - plateInfluence),
    activeEffectIds: [...roleTotal.activeEffectIds, plateLaw.id],
  };
}

function createLowerSocketStripHonestyLaw(composition) {
  const lowerSocket = composition.macroAssemblages.find(assemblage => assemblage.id === 'lower-socket-keel');
  const roleLaw = composition.lowerSocketFamilyRoleLaw;
  if (!lowerSocket || roleLaw?.selectedRole !== 'tuck-tongue') return null;
  const socketTongueIdentityPreservation = {
    mode: 'socket-tongue-aware-kink-budget-v0',
    protectedCandidateIds: [
      'lower-socket-keel-promoted-body-socket-tongue-candidate',
    ],
    protectedSignalClasses: [
      'terminal-hook-signal',
      'subordinate-sheet-objecthood',
      'protected-terminal-cap-authority',
      'receiver-dependent-disappearance',
    ],
    protectedSignalSpans: [
      {
        signal: 'subordinate-sheet-body',
        t0: 0.05,
        t1: 0.86,
        strengthScale: 0.68,
      },
      {
        signal: 'terminal-hook-pressure',
        t0: 0.72,
        t1: 1,
        strengthScale: 0.42,
      },
    ],
    requiresReceiverOwnedAbsorptionDisposition: true,
    silentErasureAllowed: false,
    reason: 'socket-tongue invariant work marked this lower-socket phenotype as vocabulary; strip honesty may reduce crumple but may not erase hook/tongue identity without an explicit receiver-owned absorption record',
  };
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
      'directed-socket-return-spine',
      'smooth-side-curves-before-merge',
      'bounded-repeated-kink-budget',
      'bounded-terminal-width-recovery',
      'no-visible-rim-exit-for-tuck-role',
    ],
    centerlinePathLaw: {
      mode: 'law-owned-directed-socket-return-spine-v0',
      maxLateralWanderRatio: 0.065,
      sourceClampLateralWanderRatio: 0.065,
      straighteningStrength: 1,
      fairingIterations: 14,
      fairingStrength: 0.58,
      protectedEndpointT: 0.04,
      reason: 'semantic render inventory showed the promoted body was born as a wandering mini-macro; tuck-tongue must own one directed socket-return spine before tuck/merge solving',
    },
    sideCurveSmoothing: {
      mode: 'law-owned-visible-strip-smoothing-v0',
      iterations: 14,
      strength: 0.58,
      protectedEndpointT: 0.035,
      smoothingT0: 0.04,
      smoothingT1: 0.94,
      postTerminalFairingPass: true,
      postTerminalFairingMode: 'law-owned-post-terminal-fairing-v0',
      visibleEdgeLocalFairing: {
        mode: 'law-owned-visible-edge-local-fairing-v0',
        t0: 0.7,
        t1: 0.84,
        iterations: 9,
        strength: 0.48,
        reason: 'after centerline honesty, one visible edge can still inherit local frame waviness; fair the readable sheet band without changing terminal destiny',
      },
      kinkBudgetSolver: {
        mode: 'law-owned-kink-budget-solver-v0',
        iterations: 42,
        strength: 0.36,
        maxTurnLimit: 0.92,
        visibleT0: 0.08,
        visibleT1: 0.88,
        visibleKinkThreshold: 0.18,
        repeatedKinkThreshold: 0.29,
        repeatedKinkCountLimit: 4,
        repeatedKinkEnergyLimit: 2.2,
        socketTongueIdentityPreservation,
        reason: 'strip honesty is a procedural constraint, not an aesthetic suggestion; iteratively reduce measured kink budget before tuck/merge solving',
      },
      repeatedKinkCountLimit: 4,
      repeatedKinkEnergyLimit: 2.2,
      reason: 'semantic inventory pinned visible offender to promoted-body/live-sidewall path; smooth that source path rather than editing downstream renderables',
    },
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

function createLowerSocketPlateBodyHonestyLaw(composition) {
  const lowerSocket = composition.macroAssemblages.find(assemblage => assemblage.id === 'lower-socket-keel');
  const stripLaw = composition.lowerSocketStripHonestyLaw;
  if (!lowerSocket || stripLaw?.role !== 'tuck-tongue') return null;
  return {
    schema: 'LowerSocketPlateBodyHonestyLaw',
    id: 'lower-socket-plate-body-honesty-law',
    mode: 'lower-socket-visible-plate-body-before-tuck-v0',
    targetMacroId: 'lower-socket-keel',
    visiblePlateT0: 0.05,
    visiblePlateT1: 1,
    visiblePlateWidthFloor: 0.045,
    visiblePlateMeanWidthFloor: 0.065,
    roleWidthScaleFloor: 0.78,
    anatomyWidthScaleFloor: 0.72,
    promotedBodyScaleFloor: 0.92,
    terminalWidthScaleFloor: 0.62,
    cordLikeShrinkageForbidden: true,
    tuckDisappearancePolicy: 'defer-until-bottom-ownership-or-occlusion-solved',
    generatedBy: [
      'LowerSocketStripHonestyLaw',
      'operator-smoke-cord-like-lower-socket-rejection',
      'five-macro-stress-width-probe',
    ],
    deferredUntil: [
      'bottom-ownership-or-occlusion-solved',
      'boolean-or-trim-merge',
      'neighbor-lip-receiver-exists',
    ],
    visualContract: 'lower socket reads as a sheet-bodied lamellar plate before any tuck disappearance is allowed',
  };
}

function lowerSocketPlateBodyHonestyInfluence(law, t) {
  if (!law) return 0;
  const start = law.visiblePlateT0 ?? 0.05;
  const end = law.visiblePlateT1 ?? 0.82;
  const fade = 0.08;
  const inRamp = smoothStep(start - fade, start + fade, t);
  if (end >= 0.999) return inRamp;
  const outRamp = 1 - smoothStep(end - fade, end + fade, t);
  return inRamp * outRamp;
}

function attachLowerSocketPlateBodyHonestyLaw(composition) {
  const law = composition.lowerSocketPlateBodyHonestyLaw;
  if (!law) return;
  const lowerSocket = composition.macroAssemblages.find(assemblage => assemblage.id === law.targetMacroId);
  if (!lowerSocket) return;
  lowerSocket.lowerSocketPlateBodyHonestyLaw = law;
  lowerSocket.plateBodyHonestyVerdict = 'lower-socket-visible-plate-body-preserved-before-tuck';
  if (lowerSocket.macroPromotedBody) {
    lowerSocket.macroPromotedBody.lowerSocketPlateBodyHonestyLaw = law;
    lowerSocket.macroPromotedBody.promotedBodyScale = Math.max(
      lowerSocket.macroPromotedBody.promotedBodyScale || 0,
      law.promotedBodyScaleFloor,
    );
    lowerSocket.macroPromotedBody.sideSilhouettePolicy = {
      ...lowerSocket.macroPromotedBody.sideSilhouettePolicy,
      plateBodyHonestyLawId: law.id,
      plateBodyHonestyMode: law.mode,
      terminalWidthScale: Math.max(
        lowerSocket.macroPromotedBody.sideSilhouettePolicy?.terminalWidthScale ?? 0,
        law.terminalWidthScaleFloor,
      ),
      visiblePlateWidthFloor: law.visiblePlateWidthFloor,
      visiblePlateMeanWidthFloor: law.visiblePlateMeanWidthFloor,
      tuckDisappearancePolicy: law.tuckDisappearancePolicy,
      plateBodyHonestyContract: law.visualContract,
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
  let widthScale = law.widthProfile.terminalWidthScale
    + (law.widthProfile.midScale - law.widthProfile.terminalWidthScale) * profile;
  const plateLaw = assemblage.lowerSocketPlateBodyHonestyLaw
    || assemblage.macroPromotedBody?.lowerSocketPlateBodyHonestyLaw;
  const plateInfluence = lowerSocketPlateBodyHonestyInfluence(plateLaw, t);
  if (plateInfluence) {
    widthScale = Math.max(widthScale, plateLaw.anatomyWidthScaleFloor * plateInfluence);
  }
  const terminalTaperPressure = 1 - smoothStep(0.62, 1, profile);
  const terminalCutPressure = smoothStep(law.terminationDecision.terminalCutStartT, 1, t);
  const terminalPressure = 1 - ((1 - terminalTaperPressure) * (1 - terminalCutPressure));
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

function curvatureWidthCapEffectAt(assemblage) {
  const law = assemblage.curvatureWidthCapLaw || assemblage.macroPromotedBody?.curvatureWidthCapLaw;
  if (!law?.capApplied) {
    return {
      widthScale: 1,
      lawId: law?.id || null,
      capApplied: false,
    };
  }
  return {
    widthScale: clamp(law.widthScale ?? 1, 0, 1),
    lawId: law.id,
    capApplied: true,
  };
}

function continueTerminalPoint(prev2, prev1) {
  const tangent = normalizePoint(subtractPoints(prev1, prev2));
  const length = pointDistance(prev1, prev2);
  return addScaledPoint(prev1, tangent, length);
}

function smoothLowerSocketStripHonestySideWallSamples(assemblage, samples, passMode = null) {
  const law = assemblage.lowerSocketStripHonestyLaw
    || assemblage.macroPromotedBody?.lowerSocketStripHonestyLaw;
  const smoothing = law?.sideCurveSmoothing;
  if (!smoothing || samples.length < 5) return samples;
  const iterations = Math.max(1, Math.round(smoothing.iterations || 1));
  const strength = clamp(smoothing.strength ?? 0.35, 0, 0.72);
  const protectedEndpointT = smoothing.protectedEndpointT ?? 0.035;
  const smoothingT0 = smoothing.smoothingT0 ?? 0.04;
  const smoothingT1 = smoothing.smoothingT1 ?? 0.94;
  const next = samples.map(sample => ({
    ...sample,
    outer: [...sample.outer],
    inner: [...sample.inner],
  }));
  for (let iteration = 0; iteration < iterations; iteration++) {
    const previous = next.map(sample => ({
      outer: [...sample.outer],
      inner: [...sample.inner],
    }));
    for (let index = 1; index < next.length - 1; index++) {
      const t = next[index].t;
      if (t < smoothingT0 || t > smoothingT1) continue;
      if (t <= protectedEndpointT || t >= 1 - protectedEndpointT) continue;
      const endpointFade = smoothStep(protectedEndpointT, protectedEndpointT + 0.12, t)
        * (1 - smoothStep(1 - protectedEndpointT - 0.12, 1 - protectedEndpointT, t));
      const localStrength = strength * endpointFade;
      for (const key of ['outer', 'inner']) {
        const neighborAverage = lerpPoint(previous[index - 1][key], previous[index + 1][key], 0.5);
        next[index][key] = lerpPoint(previous[index][key], neighborAverage, localStrength);
      }
      next[index].stripHonestySmoothingMode = passMode || smoothing.mode;
      next[index].stripHonestySmoothingPasses = [
        ...(next[index].stripHonestySmoothingPasses || []),
        passMode || smoothing.mode,
      ];
    }
  }
  let faired = next;
  for (const fairing of [
    smoothing.visibleEdgeLocalFairing,
  ].filter(Boolean)) {
    faired = fairLowerSocketVisibleEdgeSamples(fairing, faired);
  }
  faired = solveLowerSocketKinkBudget(smoothing, faired);
  return faired.map(sample => ({
    ...sample,
    thickness: pointDistance(sample.outer, sample.inner),
  }));
}

function socketTongueIdentityStrengthScale(policy, t) {
  if (!policy?.protectedSignalSpans) return 1;
  return policy.protectedSignalSpans.reduce((scale, span) => {
    if (t < span.t0 || t > span.t1) return scale;
    const edgeFade = smoothStep(span.t0, span.t0 + 0.05, t)
      * (1 - smoothStep(span.t1 - 0.05, span.t1, t));
    const spanScale = 1 - (1 - (span.strengthScale ?? 1)) * edgeFade;
    return Math.min(scale, spanScale);
  }, 1);
}

function solveLowerSocketKinkBudget(smoothing, samples) {
  const solver = smoothing.kinkBudgetSolver;
  if (!solver || samples.length < 5) return samples;
  let next = samples.map(sample => ({
    ...sample,
    outer: [...sample.outer],
    inner: [...sample.inner],
  }));
  let metrics = sideCurveBudgetMetrics(next, solver);
  const iterations = Math.max(1, Math.round(solver.iterations || 1));
  const strength = clamp(solver.strength ?? 0.25, 0, 0.72);
  for (let iteration = 0; iteration < iterations; iteration++) {
    if (
      metrics.maxTurn <= (solver.maxTurnLimit ?? Number.POSITIVE_INFINITY)
      && metrics.visibleKinkCount <= (solver.repeatedKinkCountLimit ?? Number.POSITIVE_INFINITY)
      && metrics.visibleKinkEnergy <= (solver.repeatedKinkEnergyLimit ?? Number.POSITIVE_INFINITY)
    ) {
      break;
    }
    let bestCandidate = null;
    let bestMetrics = metrics;
    for (const item of metrics.offenders) {
      const index = item.index;
      if (index <= 0 || index >= next.length - 1) continue;
      const candidate = next.map(sample => ({
        ...sample,
        outer: [...sample.outer],
        inner: [...sample.inner],
      }));
      const identityScale = item.angle > (solver.maxTurnLimit ?? Number.POSITIVE_INFINITY)
        ? 1
        : socketTongueIdentityStrengthScale(
          solver.socketTongueIdentityPreservation,
          next[index].t,
        );
      const localStrength = strength * identityScale;
      for (const key of ['outer', 'inner']) {
        const neighborAverage = lerpPoint(next[index - 1][key], next[index + 1][key], 0.5);
        candidate[index][key] = lerpPoint(next[index][key], neighborAverage, localStrength);
      }
      candidate[index].stripHonestyKinkBudgetSolverMode = solver.mode;
      if (solver.socketTongueIdentityPreservation) {
        candidate[index].socketTongueIdentityPreservationMode = solver.socketTongueIdentityPreservation.mode;
        candidate[index].socketTongueIdentityPreservationStrengthScale = localStrength / (strength || 1);
      }
      const candidateMetrics = sideCurveBudgetMetrics(candidate, solver);
      if (candidateMetrics.score < bestMetrics.score) {
        bestCandidate = candidate;
        bestMetrics = candidateMetrics;
      }
    }
    if (!bestCandidate) break;
    next = bestCandidate;
    metrics = bestMetrics;
  }
  return next.map(sample => ({
    ...sample,
    stripHonestyKinkBudgetScore: metrics.score,
    stripHonestyKinkBudgetMaxTurn: metrics.maxTurn,
    stripHonestyKinkBudgetVisibleEnergy: metrics.visibleKinkEnergy,
    stripHonestyKinkBudgetVisibleCount: metrics.visibleKinkCount,
  }));
}

function sideCurveBudgetMetrics(samples, solver) {
  const visibleT0 = solver.visibleT0 ?? 0.08;
  const visibleT1 = solver.visibleT1 ?? 0.88;
  const energyThreshold = solver.visibleKinkThreshold ?? 0.18;
  const countThreshold = solver.repeatedKinkThreshold ?? 0.29;
  let maxTurn = 0;
  let visibleKinkEnergy = 0;
  let visibleKinkCount = 0;
  const offenders = [];
  for (let index = 1; index < samples.length - 1; index++) {
    const angle = sideCurveTurnAngle(samples, index, 'outer');
    maxTurn = Math.max(maxTurn, angle);
    const t = samples[index].t;
    const isVisible = t >= visibleT0 && t <= visibleT1;
    if (isVisible && angle >= energyThreshold) visibleKinkEnergy += angle;
    if (isVisible && angle >= countThreshold) visibleKinkCount++;
    if (
      angle > (solver.maxTurnLimit ?? Number.POSITIVE_INFINITY)
      || (isVisible && angle >= energyThreshold)
    ) {
      offenders.push({ index, angle });
    }
  }
  offenders.sort((a, b) => b.angle - a.angle);
  const maxTurnOverage = Math.max(0, maxTurn - (solver.maxTurnLimit ?? maxTurn));
  const countOverage = Math.max(0, visibleKinkCount - (solver.repeatedKinkCountLimit ?? visibleKinkCount));
  const energyOverage = Math.max(0, visibleKinkEnergy - (solver.repeatedKinkEnergyLimit ?? visibleKinkEnergy));
  return {
    maxTurn,
    visibleKinkEnergy,
    visibleKinkCount,
    offenders: offenders.slice(0, 8),
    score: maxTurnOverage * 8 + countOverage * 2 + energyOverage,
  };
}

function sideCurveTurnAngle(samples, index, key) {
  const previous = normalizePoint(subtractPoints(samples[index][key], samples[index - 1][key]));
  const next = normalizePoint(subtractPoints(samples[index + 1][key], samples[index][key]));
  return Math.acos(clamp(dotPoints(previous, next), -1, 1));
}

function fairLowerSocketVisibleEdgeSamples(fairing, samples) {
  if (!fairing || samples.length < 5) return samples;
  const t0 = fairing.t0 ?? 0.7;
  const t1 = fairing.t1 ?? 0.84;
  if (t1 <= t0) return samples;
  const strength = clamp(fairing.strength ?? 0, 0, 0.72);
  if (strength <= 0) return samples;
  const iterations = Math.max(1, Math.round(fairing.iterations || 1));
  const currentEnergy = sideCurveKinkEnergy(samples, t0, t1);
  let next = samples.map(sample => ({
    ...sample,
    outer: [...sample.outer],
    inner: [...sample.inner],
  }));
  for (let iteration = 0; iteration < iterations; iteration++) {
    const previous = next.map(sample => ({
      outer: [...sample.outer],
      inner: [...sample.inner],
    }));
    for (let index = 1; index < next.length - 1; index++) {
      const t = next[index].t;
      if (t < t0 || t > t1) continue;
      const u = clamp((t - t0) / (t1 - t0), 0, 1);
      const windowFade = smoothStep(0, 0.25, u) * (1 - smoothStep(0.75, 1, u));
      for (const key of ['outer', 'inner']) {
        const neighborAverage = lerpPoint(previous[index - 1][key], previous[index + 1][key], 0.5);
        next[index][key] = lerpPoint(previous[index][key], neighborAverage, strength * windowFade);
      }
      next[index].stripHonestyVisibleEdgeFairingMode = fairing.mode;
    }
  }
  const candidateEnergy = sideCurveKinkEnergy(next, t0, t1);
  if (candidateEnergy > currentEnergy) return samples;
  return next.map(sample => ({
    ...sample,
    stripHonestyVisibleEdgeFairingEnergyBefore: currentEnergy,
    stripHonestyVisibleEdgeFairingEnergyAfter: candidateEnergy,
  }));
}

function sideCurveKinkEnergy(samples, t0, t1, threshold = 0.18) {
  let energy = 0;
  for (let index = 1; index < samples.length - 1; index++) {
    const t = samples[index].t;
    if (t < t0 || t > t1) continue;
    for (const key of ['outer', 'inner']) {
      const previous = normalizePoint(subtractPoints(samples[index][key], samples[index - 1][key]));
      const next = normalizePoint(subtractPoints(samples[index + 1][key], samples[index][key]));
      const angle = Math.acos(clamp(dotPoints(previous, next), -1, 1));
      if (angle >= threshold) energy += angle;
    }
  }
  return energy;
}

function applyLowerSocketRenderedEdgePathLaw(assemblage, samples) {
  if (!lowerSocketCenterlinePathLawFor(assemblage) || samples.length < 4) return samples;
  const outerPoints = applyLowerSocketCenterlinePathLaw(
    assemblage,
    samples.map(sample => sample.outer),
  );
  const innerPoints = applyLowerSocketCenterlinePathLaw(
    assemblage,
    samples.map(sample => sample.inner),
  );
  return samples.map((sample, index) => ({
    ...sample,
    outer: outerPoints[index],
    inner: innerPoints[index],
    renderedEdgePathLawMode: lowerSocketCenterlinePathLawFor(assemblage).mode,
    thickness: pointDistance(outerPoints[index], innerPoints[index]),
  }));
}

function smoothLowerSocketPlateBodyTerminalSamples(assemblage, samples) {
  const law = assemblage.lowerSocketPlateBodyHonestyLaw
    || assemblage.macroPromotedBody?.lowerSocketPlateBodyHonestyLaw;
  if (!law || samples.length < 4) return samples;
  const next = samples.map(sample => ({
    ...sample,
    outer: [...sample.outer],
    inner: [...sample.inner],
  }));
  const last = next.length - 1;
  next[last] = {
    ...next[last],
    outer: continueTerminalPoint(next[last - 2].outer, next[last - 1].outer),
    inner: continueTerminalPoint(next[last - 2].inner, next[last - 1].inner),
    terminalContinuationMode: 'plate-body-honesty-prev-tangent-continuation',
  };
  return next;
}

function lowerSocketCenterlinePathLawFor(assemblage) {
  const stripLaw = assemblage.lowerSocketStripHonestyLaw
    || assemblage.macroPromotedBody?.lowerSocketStripHonestyLaw;
  return stripLaw?.centerlinePathLaw || null;
}

function applyLowerSocketCenterlinePathLaw(assemblage, points) {
  const law = lowerSocketCenterlinePathLawFor(assemblage);
  if (!law || points.length < 4) return points;
  const start = points[0];
  const end = points[points.length - 1];
  const chord = pointDistance(start, end);
  if (chord < 1e-6) return points;
  const axis = normalizePoint(subtractPoints(end, start));
  const maxLateralWander = chord * (
    law.sourceClampLateralWanderRatio
    ?? law.maxLateralWanderRatio
    ?? 0.065
  );
  const protectedEndpointT = law.protectedEndpointT ?? 0.04;
  const strength = clamp(law.straighteningStrength ?? 1, 0, 1);
  const clampedPoints = points.map((point, index) => {
    const t = index / (points.length - 1);
    if (t <= protectedEndpointT || t >= 1 - protectedEndpointT) return point;
    const relative = subtractPoints(point, start);
    const progress = dotPoints(relative, axis);
    const projected = addScaledPoint(start, axis, progress);
    const lateral = subtractPoints(point, projected);
    const lateralDistance = Math.hypot(...lateral);
    if (lateralDistance <= maxLateralWander) return point;
    const endpointFade = smoothStep(protectedEndpointT, protectedEndpointT + 0.1, t)
      * (1 - smoothStep(1 - protectedEndpointT - 0.1, 1 - protectedEndpointT, t));
    const clamped = addScaledPoint(projected, normalizePoint(lateral), maxLateralWander);
    return lerpPoint(point, clamped, strength * endpointFade);
  });
  const fairingIterations = Math.max(0, Math.round(law.fairingIterations || 0));
  const fairingStrength = clamp(law.fairingStrength ?? 0, 0, 0.72);
  if (!fairingIterations || fairingStrength <= 0) return clampedPoints;
  let next = clampedPoints.map(point => [...point]);
  for (let iteration = 0; iteration < fairingIterations; iteration++) {
    const previous = next.map(point => [...point]);
    for (let index = 1; index < next.length - 1; index++) {
      const t = index / (next.length - 1);
      if (t <= protectedEndpointT || t >= 1 - protectedEndpointT) continue;
      const endpointFade = smoothStep(protectedEndpointT, protectedEndpointT + 0.12, t)
        * (1 - smoothStep(1 - protectedEndpointT - 0.12, 1 - protectedEndpointT, t));
      next[index] = lerpPoint(
        previous[index],
        lerpPoint(previous[index - 1], previous[index + 1], 0.5),
        fairingStrength * endpointFade,
      );
    }
  }
  return next;
}

function macroPromotedBodyCenterlinePoints(assemblage, rowCount = 72, radius = 1.045, options = {}) {
  const rawPoints = [];
  for (let row = 0; row < rowCount; row++) {
    const t = row / (rowCount - 1);
    rawPoints.push(sampleSpinePoint(assemblage, {
      siblingOffset: 0,
      layerIntervals: assemblage.layerItinerary.intervals,
    }, t, radius, options));
  }
  return applyLowerSocketCenterlinePathLaw(assemblage, rawPoints);
}

function macroPromotedBodyEdgeSamples(assemblage, targetEdge, rowCount = 72) {
  const body = assemblage.territoryBodyOccupancy;
  const promoted = assemblage.macroPromotedBody;
  const cutProfile = body.boundaryCutProfile || [];
  const sideSign = targetEdge === 'right-promoted-body-edge' ? 1 : -1;
  const centerline = macroPromotedBodyCenterlinePoints(assemblage, rowCount, 1.045);

  const samples = centerline.map((center, row) => {
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
    const curvatureCap = curvatureWidthCapEffectAt(assemblage);
    const widthScale = interlock.widthScale * lowerSocket.widthScale * sharedSeam.widthScale * roleEffect.widthScale * curvatureCap.widthScale;
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
      curvatureWidthCapLawId: curvatureCap.lawId,
      curvatureWidthCapApplied: curvatureCap.capApplied,
    };
  });
  const pathLawSamples = applyLowerSocketRenderedEdgePathLaw(assemblage, samples);
  const stripSmoothedSamples = smoothLowerSocketStripHonestySideWallSamples(
    assemblage,
    pathLawSamples,
  );
  const terminalContinuedSamples = smoothLowerSocketPlateBodyTerminalSamples(
    assemblage,
    stripSmoothedSamples,
  );
  const smoothing = assemblage.lowerSocketStripHonestyLaw?.sideCurveSmoothing
    || assemblage.macroPromotedBody?.lowerSocketStripHonestyLaw?.sideCurveSmoothing;
  if (!smoothing?.postTerminalFairingPass) return terminalContinuedSamples;
  return smoothLowerSocketStripHonestySideWallSamples(
    assemblage,
    terminalContinuedSamples,
    smoothing.postTerminalFairingMode || smoothing.mode,
  );
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
  const tuckRefinement = roleLaw?.tuckTongueRefinement || null;
  const terminalCapAuthority = tuckRefinement?.terminalCapAuthority || 'visible-promoted-body-terminal-cap';
  const receiverOwnedTuckDisposition = tuckRefinement?.receiverOwnedTuckDisposition || null;
  const provisionalSocketTongueVisible = terminalCapAuthority === 'provisional-visible-until-receiver-owned-tuck'
    && !receiverOwnedTuckDisposition;
  const normalRenderVisible = terminalCapAuthority === 'visible-promoted-body-terminal-cap'
    || provisionalSocketTongueVisible;
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
    terminalCapVisibilityPolicy: tuckRefinement?.terminalCapVisibilityPolicy || null,
    receiverOwnedTuckDisposition,
    provisionalSocketTongueVisible,
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
    visualContract: provisionalSocketTongueVisible
      ? 'normal live render preserves provisional socket-tongue terminal evidence until a receiver-owned tuck disposition exists'
      : normalRenderVisible
        ? 'normal live render shows a closed solid end on the promoted shell strip'
        : 'topology cap exists but normal render hides it under an explicit receiver or seam authority',
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
  const curvatureCap = curvatureWidthCapEffectAt(assemblage);
  const widthScale = interlock.widthScale * lowerSocket.widthScale * sharedSeam.widthScale * roleEffect.widthScale * curvatureCap.widthScale;
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

function apertureOrbitLanePoint(lane, angle) {
  const [cx, cy, cz] = lane.center;
  const [rx, ry] = lane.radius;
  const x = cx + Math.cos(angle) * rx;
  const y = cy + Math.sin(angle) * ry;
  const z = Math.max(cz * 0.76, Math.sqrt(Math.max(0.01, 1 - x * x - y * y))) + (lane.zLift ?? 0.05);
  return [x, y, z];
}

function apertureOrbitLanePointAndTangent(lane, angle) {
  const point = apertureOrbitLanePoint(lane, angle);
  const next = apertureOrbitLanePoint(lane, angle + 0.01);
  const prev = apertureOrbitLanePoint(lane, angle - 0.01);
  return {
    point,
    tangent: normalizePoint(subtractPoints(next, prev)),
  };
}

function nearestApertureOrbitLaneSample(lane, point, steps = 180) {
  let nearest = null;
  for (let index = 0; index < steps; index++) {
    const angle = (index / steps) * TAU;
    const ring = apertureOrbitLanePointAndTangent(lane, angle);
    const distance = pointDistance(point, ring.point);
    if (!nearest || distance < nearest.distance) nearest = { ...ring, angle, distance };
  }
  return nearest;
}

function createApertureOrbitLanes(composition) {
  const primaryVoid = composition.AperturePressure?.primaryVoids?.[0] || {};
  const center = primaryVoid.center || [0.02, -0.02, 0.98];
  const radius = primaryVoid.radius || [0.34, 0.55];
  const sourceApertureId = primaryVoid.id || 'primary-front-teardrop-void';
  const laneSpecs = [
    {
      id: 'front-primary-orbit',
      captureRole: 'visible-aperture-reference-orbit',
      radiusScale: [1, 1],
      zLift: 0.05,
    },
    {
      id: 'outer-capture-lane',
      captureRole: 'macro-terminal-outer-orbit-capture',
      radiusScale: [1.16, 1.08],
      zLift: 0.065,
    },
    {
      id: 'inner-return-lane',
      captureRole: 'macro-terminal-underpass-return',
      radiusScale: [0.78, 0.82],
      zLift: 0.025,
    },
  ];
  return laneSpecs.map(spec => ({
    schema: 'ApertureOrbitLane',
    mode: ORB_SHELL_APERTURE_ORBIT_CAPTURE_MODE,
    id: spec.id,
    sourceApertureId,
    center,
    radius: [radius[0] * spec.radiusScale[0], radius[1] * spec.radiusScale[1]],
    zLift: spec.zLift,
    captureRole: spec.captureRole,
    overlayGeometryId: `${spec.id}-orbit-lane`,
    semanticRole: 'positive-terminal-destination-not-negative-space-mask',
  }));
}

function defaultApertureOrbitRoleSpec(assemblage) {
  const specs = {
    'north-west-dominant-thrust': {
      terminalRole: 'orbit-tangent',
      targetLaneId: 'outer-capture-lane',
      targetPhase: 0.74 * TAU,
      terminalSpan: [0.64, 1],
      pointBlend: 0.44,
      tangentBlend: 0.72,
      radialDelta: 0.018,
    },
    'north-east-counter-thrust': {
      terminalRole: 'counter-curve',
      targetLaneId: 'front-primary-orbit',
      targetPhase: 0.15 * TAU,
      terminalSpan: [0.62, 1],
      pointBlend: 0.2,
      tangentBlend: 0.34,
      counterCurveOffset: 0.08,
    },
    'equatorial-cupping-whorl': {
      terminalRole: 'underpass-return',
      targetLaneId: 'inner-return-lane',
      targetPhase: 0.56 * TAU,
      terminalSpan: [0.58, 1],
      pointBlend: 0.4,
      tangentBlend: 0.48,
      radialDelta: -0.055,
    },
    'polar-crown-lock': {
      terminalRole: 'rim-segment',
      targetLaneId: 'outer-capture-lane',
      targetPhase: 0.98 * TAU,
      terminalSpan: [0.7, 1],
      pointBlend: 0.32,
      tangentBlend: 0.42,
      radialDelta: 0.01,
    },
    'lower-socket-keel': {
      terminalRole: 'socket-latch',
      targetLaneId: 'inner-return-lane',
      targetPhase: 0.68 * TAU,
      terminalSpan: [0.6, 1],
      pointBlend: 0.36,
      tangentBlend: 0.46,
      radialDelta: -0.035,
    },
  };
  return specs[assemblage.id] || {
    terminalRole: 'orbit-tangent',
    targetLaneId: 'front-primary-orbit',
    targetPhase: 0.5 * TAU,
    terminalSpan: [0.64, 1],
    pointBlend: 0.28,
    tangentBlend: 0.4,
  };
}

function createApertureOrbitCaptureLaw(composition, controls = composition.lawControls?.apertureOrbitCapture) {
  const sourceApertureId = composition.AperturePressure?.primaryVoids?.[0]?.id || 'primary-front-teardrop-void';
  const orbitLanes = createApertureOrbitLanes(composition);
  const laneById = new Map(orbitLanes.map(lane => [lane.id, lane]));
  const controlStrength = normalizedUnit(controls?.strength, 1);
  const terminalRoles = composition.macroAssemblages.map(assemblage => {
    const spec = defaultApertureOrbitRoleSpec(assemblage);
    const lane = laneById.get(spec.targetLaneId) || orbitLanes[0];
    const target = apertureOrbitLanePointAndTangent(lane, spec.targetPhase);
    const id = `${assemblage.id}-aperture-terminal-role`;
    return {
      schema: 'MacroApertureTerminalRole',
      mode: ORB_SHELL_APERTURE_ORBIT_CAPTURE_MODE,
      id,
      parentAssemblage: assemblage.id,
      macroRole: assemblage.role,
      terminalRole: spec.terminalRole,
      sourceApertureId,
      targetLaneId: lane.id,
      targetPhase: spec.targetPhase,
      terminalSpan: spec.terminalSpan,
      targetPoint: target.point,
      targetTangent: target.tangent,
      targetNormal: normalizePoint(target.point),
      pointBlend: spec.pointBlend * controlStrength,
      tangentBlend: spec.tangentBlend * controlStrength,
      radialDelta: (spec.radialDelta || 0) * controlStrength,
      counterCurveOffset: (spec.counterCurveOffset || 0) * controlStrength,
      controlStrength,
      overlayGeometryIds: [
        `${id}-target-point`,
        `${id}-target-tangent`,
        lane.overlayGeometryId,
      ],
      semanticIntent: `${spec.terminalRole}-relative-to-primary-aperture`,
    };
  });
  return {
    schema: 'ApertureOrbitCaptureLaw',
    mode: ORB_SHELL_APERTURE_ORBIT_CAPTURE_MODE,
    id: 'primary-front-aperture-orbit-capture-law',
    sourceApertureId,
    orbitLanes,
    terminalRoles,
    terminalRoleCount: terminalRoles.length,
    controlStrength,
    semanticPrimitive: 'macro-terminal-destiny-around-aperture',
    captureContract: 'each-live-macro-declares-a-positive-aperture-relative-terminal-role',
    failureModes: [
      'floating-strip-without-aperture-destination',
      'constraint-only-avoidance-without-designed-terminal-intent',
      'orbit-looking-curve-without-target-lane-or-tangent-witness',
    ],
  };
}

function attachApertureOrbitCaptureLaw(composition) {
  const law = composition.apertureOrbitCaptureLaw;
  if (!law) return;
  const roleByParent = new Map(law.terminalRoles.map(role => [role.parentAssemblage, role]));
  for (const assemblage of composition.macroAssemblages) {
    const role = roleByParent.get(assemblage.id);
    if (!role) continue;
    assemblage.apertureOrbitCapture = role;
    if (assemblage.macroPromotedBody) assemblage.macroPromotedBody.apertureOrbitCapture = role;
  }
}

function apertureOrbitCaptureBlendAt(role, t) {
  if (!role) return 0;
  const [start, end] = role.terminalSpan || [1, 1];
  if (end <= start) return t >= start ? 1 : 0;
  return smoothStep(start, end, t);
}

function apertureOrbitCaptureLinearT(role, t) {
  if (!role) return 0;
  const [start, end] = role.terminalSpan || [1, 1];
  if (end <= start) return t >= start ? 1 : 0;
  return clamp((t - start) / (end - start), 0, 1);
}

function applyApertureOrbitCapturePoint(assemblage, t, point) {
  const role = assemblage.apertureOrbitCapture || assemblage.macroPromotedBody?.apertureOrbitCapture;
  const blend = apertureOrbitCaptureBlendAt(role, t);
  if (blend <= 0) return point;
  const linearT = apertureOrbitCaptureLinearT(role, t);
  const targetTangent = normalizePoint(role.targetTangent || [1, 0, 0]);
  const tangentLead = (role.tangentBlend ?? 0.42) * 0.42;
  const landingTarget = addScaledPoint(role.targetPoint, targetTangent, -tangentLead * (1 - linearT));
  const pointBlend = clamp((role.pointBlend ?? 0.34) * blend, 0, 0.78);
  let next = lerpPoint(point, landingTarget, pointBlend);
  if (role.terminalRole === 'counter-curve') {
    const localNormal = normalizePoint(point);
    let refusal = normalizePoint(crossPoints(localNormal, role.targetTangent));
    if (Math.hypot(...refusal) < 1e-8) refusal = normalizePoint(crossPoints(localNormal, [0, 1, 0]));
    if (dotPoints(refusal, subtractPoints(point, role.targetPoint)) < 0) refusal = scalePoint(refusal, -1);
    next = addScaledPoint(next, refusal, (role.counterCurveOffset ?? 0.06) * blend);
  }
  const radialDelta = (role.radialDelta || 0) * blend;
  if (Math.abs(radialDelta) > 1e-6) {
    const radius = Math.max(0.2, Math.hypot(...next) + radialDelta);
    next = scalePoint(normalizePoint(next), radius);
  }
  return next;
}

function createApertureOrbitCaptureWitnessPlan(composition) {
  const law = composition.apertureOrbitCaptureLaw;
  if (!law) {
    const disabledByControls = composition.lawControls?.apertureOrbitCapture?.enabled === false;
    return {
      schema: 'ApertureOrbitCaptureWitnessPlan',
      mode: ORB_SHELL_APERTURE_ORBIT_CAPTURE_MODE,
      id: 'primary-front-aperture-orbit-capture-witness-plan',
      status: disabledByControls ? 'disabled-by-law-controls' : 'missing-aperture-orbit-capture-law',
      measuredLawId: null,
      sampleCount: 0,
      samples: [],
      overlayGeometryIds: [],
      failureModes: [disabledByControls ? 'disabled-by-law-controls' : 'missing-aperture-orbit-capture-law'],
    };
  }
  const laneById = new Map(law.orbitLanes.map(lane => [lane.id, lane]));
  const samples = law.terminalRoles.map(role => {
    const assemblage = composition.macroAssemblages.find(item => item.id === role.parentAssemblage);
    const centerline = assemblage ? macroPromotedBodyCenterlinePoints(assemblage, 48, 1.045) : [];
    const terminalPoint = centerline.at(-1) || role.targetPoint;
    const previousPoint = centerline.at(-2) || terminalPoint;
    const terminalTangent = normalizePoint(subtractPoints(terminalPoint, previousPoint));
    const lane = laneById.get(role.targetLaneId) || law.orbitLanes[0];
    const nearest = nearestApertureOrbitLaneSample(lane, terminalPoint);
    const tangentOrbitAlignment = Math.abs(dotPoints(terminalTangent, nearest.tangent));
    const captureRadiusError = nearest.distance;
    const roleVerdict = role.terminalRole === 'orbit-tangent'
      ? (
        tangentOrbitAlignment >= 0.6 && captureRadiusError <= 0.42
          ? 'macro-orbit-tangent-coupling-visible'
          : 'macro-orbit-tangent-not-yet-proven'
      )
      : role.terminalRole === 'counter-curve'
        ? (
          tangentOrbitAlignment <= 0.86 || role.counterCurveOffset > 0
            ? 'macro-counter-curve-intent-visible'
            : 'macro-counter-curve-not-yet-proven'
        )
        : 'macro-aperture-destination-assigned';
    const id = `${role.parentAssemblage}-aperture-orbit-capture-sample`;
    return {
      schema: 'MacroApertureTerminalCaptureSample',
      mode: ORB_SHELL_APERTURE_ORBIT_CAPTURE_MODE,
      id,
      parentAssemblage: role.parentAssemblage,
      terminalRole: role.terminalRole,
      targetLaneId: role.targetLaneId,
      terminalPoint,
      terminalTangent,
      nearestLanePoint: nearest.point,
      nearestLaneAngleRadians: nearest.angle,
      nearestLaneTangent: nearest.tangent,
      targetPoint: role.targetPoint,
      targetTangent: role.targetTangent,
      tangentOrbitAlignment,
      captureRadiusError,
      roleVerdict,
      overlayGeometryIds: role.overlayGeometryIds,
    };
  });
  const verdictCounts = samples.reduce((counts, sample) => {
    counts[sample.roleVerdict] = (counts[sample.roleVerdict] || 0) + 1;
    return counts;
  }, {});
  return {
    schema: 'ApertureOrbitCaptureWitnessPlan',
    mode: ORB_SHELL_APERTURE_ORBIT_CAPTURE_MODE,
    id: 'primary-front-aperture-orbit-capture-witness-plan',
    measuredLawId: law.id,
    measuredApertureSourceId: law.sourceApertureId,
    visualOverlayMode: 'macro-target-lanes-and-terminal-tangent-rays',
    sampleCount: samples.length,
    samples,
    verdictCounts,
    overlayGeometryIds: [
      ...law.orbitLanes.map(lane => lane.overlayGeometryId),
      ...samples.flatMap(sample => sample.overlayGeometryIds),
    ],
    failureModes: law.failureModes,
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

function apertureAwareTerminusRoleForSubstrip(substrip) {
  const terminationClass = substrip.apertureTermination?.terminationClass;
  const siblingRole = substrip.siblingRole || substrip.apertureTermination?.siblingRole;
  if (terminationClass === 'counter-curve-blade') {
    return substrip.apertureTermination?.ownsFurthestVisibleTip ? 'counter-curve' : 'socket-latch';
  }
  if (terminationClass === 'orbit-capture') {
    if (siblingRole === 'lead') return 'orbit-tangent';
    if (siblingRole === 'inner') return 'underpass-return';
    return 'socket-latch';
  }
  return 'rim-segment';
}

function terminalBlendSpanForApertureAwareTerminus(role) {
  if (role === 'counter-curve') return [0.62, 1];
  if (role === 'underpass-return') return [0.56, 1];
  if (role === 'socket-latch') return [0.6, 1];
  if (role === 'rim-segment') return [0.66, 1];
  return [0.58, 1];
}

function apertureAwareTerminusRenderPull(role) {
  if (role === 'orbit-tangent') return 0.082;
  if (role === 'socket-latch') return 0.09;
  if (role === 'underpass-return') return 0.072;
  if (role === 'counter-curve') return 0.058;
  return 0.064;
}

function apertureAwareTerminusTangentPull(role) {
  if (role === 'orbit-tangent') return 0.036;
  if (role === 'socket-latch') return 0.02;
  if (role === 'underpass-return') return -0.024;
  if (role === 'counter-curve') return -0.032;
  return 0.014;
}

function apertureAwareTerminusPlaneForRole(role) {
  return `${role}-aperture-contour-terminal-plane`;
}

function shapeApertureAwareTerminusCapSamples(cap, record) {
  const genericCapSamples = clone(cap.capSamples);
  const targetContourPull = apertureAwareTerminusRenderPull(record.terminusRole);
  const tangentPull = apertureAwareTerminusTangentPull(record.terminusRole);
  const terminalPoint = record.terminalPoint || genericCapSamples.outerMid;
  const contourDirection = normalizePoint(subtractPoints(record.targetPoint, terminalPoint));
  const targetTangent = normalizePoint(record.targetTangent || record.terminalTangent || [0, 0, 1]);
  const terminalTangent = normalizePoint(record.terminalTangent || record.targetTangent || [0, 0, 1]);
  const tangentAxis = normalizePoint(lerpPoint(terminalTangent, targetTangent, 0.72));
  const normalAxis = normalizePoint(record.targetNormal || genericCapSamples.outerMid);
  const contourDelta = scalePoint(contourDirection, targetContourPull);
  const tangentDelta = scalePoint(tangentAxis, tangentPull);
  const innerContourDelta = scalePoint(contourDirection, targetContourPull * 0.62);
  const innerTangentDelta = scalePoint(tangentAxis, tangentPull * 0.44);
  const edgeContourDelta = scalePoint(contourDirection, targetContourPull * 0.34);
  const edgeTangentDelta = scalePoint(tangentAxis, tangentPull * 0.22);
  const normalRelief = scalePoint(normalAxis, record.terminusRole === 'socket-latch' ? -0.006 : 0.004);
  const shapedCapSamples = {
    outerLeft: addPoints(addPoints(genericCapSamples.outerLeft, edgeContourDelta), edgeTangentDelta),
    outerRight: addPoints(addPoints(genericCapSamples.outerRight, edgeContourDelta), edgeTangentDelta),
    innerLeft: addPoints(genericCapSamples.innerLeft, scalePoint(edgeContourDelta, 0.72)),
    innerRight: addPoints(genericCapSamples.innerRight, scalePoint(edgeContourDelta, 0.72)),
    outerMid: addPoints(addPoints(addPoints(genericCapSamples.outerMid, contourDelta), tangentDelta), normalRelief),
    innerMid: addPoints(addPoints(genericCapSamples.innerMid, innerContourDelta), innerTangentDelta),
  };
  return {
    schema: 'ApertureAwareTerminusRenderConsumer',
    mode: `${ORB_SHELL_APERTURE_AWARE_TERMINUS_MODE}-render-consumer-v0`,
    recordId: record.id,
    sourceSubstripId: record.sourceSubstripId,
    sourceApertureId: record.sourceApertureId,
    role: record.terminusRole,
    targetContourPull,
    tangentPull,
    terminalTangentAlignment: Math.abs(dotPoints(tangentAxis, targetTangent)),
    contourDirection,
    tangentAxis,
    genericCapSamples,
    shapedCapSamples,
    renderConsumptionVerdict: 'end-cap-samples-shaped-by-aperture-aware-terminus',
  };
}

function applyApertureAwareTerminusToEndCap(endCap, record) {
  if (!endCap) return null;
  const renderConsumer = shapeApertureAwareTerminusCapSamples(endCap, record);
  endCap.apertureAwareRenderConsumer = renderConsumer;
  endCap.capSamples = clone(renderConsumer.shapedCapSamples);
  endCap.geometryKind = 'aperture-contour-aware-substrip-end-cap';
  endCap.terminalPlane = record.terminalPlane;
  endCap.renderConsumptionVerdict = renderConsumer.renderConsumptionVerdict;
  return renderConsumer;
}

function createApertureAwareTerminusPlan(composition, apertureRelativeTerminationPlan, substrips) {
  const primaryVoid = composition.AperturePressure?.primaryVoids?.[0];
  const apertureField = apertureRelativeTerminationPlan?.apertureField;
  if (!primaryVoid || !apertureField) {
    return {
      schema: 'ApertureAwareTerminusPlan',
      mode: ORB_SHELL_APERTURE_AWARE_TERMINUS_MODE,
      id: 'limited-two-family-aperture-aware-terminus-plan',
      sourceApertureId: primaryVoid?.id || null,
      sourceApertureRadius: primaryVoid?.radius || null,
      recordCount: 0,
      records: [],
      roleCounts: {},
      failureModes: ['missing-visible-aperture-source', 'generic-strip-cap-without-contour-destiny'],
    };
  }
  const records = substrips.map(substrip => {
    const terminalSample = substrip.edgeSamples.at(-1);
    const nearest = nearestAperturePressureRingSample(primaryVoid, terminalSample.center);
    const terminusRole = apertureAwareTerminusRoleForSubstrip(substrip);
    const endCap = substrip.terminalCaps.find(cap => cap.endRole === 'end-terminus');
    const id = `${substrip.id}-aperture-aware-terminus`;
    const record = {
      schema: 'ApertureAwareTerminus',
      mode: ORB_SHELL_APERTURE_AWARE_TERMINUS_MODE,
      id,
      sourceSubstripId: substrip.id,
      parentAssemblage: substrip.parentAssemblage,
      siblingRole: substrip.siblingRole,
      terminusRole,
      terminationClass: substrip.apertureTermination?.terminationClass,
      terminalVisibility: substrip.apertureTermination?.terminalVisibility,
      sourceApertureId: primaryVoid.id,
      sourceApertureFieldId: apertureField.id,
      sourceApertureRadius: primaryVoid.radius,
      targetPoint: nearest.point,
      targetTangent: nearest.tangent,
      targetNormal: normalizePoint(nearest.point),
      nearestApertureAngleRadians: nearest.angle,
      terminalPoint: terminalSample.center,
      terminalTangent: normalizePoint(terminalSample.tangent),
      terminalBlendSpan: terminalBlendSpanForApertureAwareTerminus(terminusRole),
      terminalPlane: apertureAwareTerminusPlaneForRole(terminusRole),
      renderedGeometryIds: [
        substrip.id,
        endCap?.id,
      ].filter(Boolean),
      witnessGeometryIds: [
        `${id}-target-point`,
        `${id}-target-tangent`,
        `${id}-terminal-tangent`,
      ],
      law: `${terminusRole}-relative-to-non-circular-aperture-contour`,
      falseClosureBlocked: 'role-label-without-rendered-terminus-consumer',
    };
    substrip.apertureAwareTerminus = record;
    if (endCap) {
      endCap.apertureAwareTerminus = record;
      record.renderConsumer = applyApertureAwareTerminusToEndCap(endCap, record);
    }
    return record;
  });
  const roleCounts = records.reduce((counts, record) => {
    counts[record.terminusRole] = (counts[record.terminusRole] || 0) + 1;
    return counts;
  }, {});
  return {
    schema: 'ApertureAwareTerminusPlan',
    mode: ORB_SHELL_APERTURE_AWARE_TERMINUS_MODE,
    id: 'limited-two-family-aperture-aware-terminus-plan',
    sourceApertureId: primaryVoid.id,
    sourceApertureFieldId: apertureField.id,
    sourceApertureRadius: primaryVoid.radius,
    sourceContourLaw: 'non-circular-socket-contour-is-terminal-destiny-source',
    recordCount: records.length,
    records,
    roleCounts,
    renderedGeometryIds: records.flatMap(record => record.renderedGeometryIds),
    witnessGeometryIds: records.flatMap(record => record.witnessGeometryIds),
    failureModes: [
      'generic-strip-cap-without-contour-destiny',
      'role-label-without-rendered-terminus-consumer',
      'circular-orbit-assumption-after-non-circular-socket-authority',
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
  const apertureAwareTerminusPlan = createApertureAwareTerminusPlan(
    composition,
    apertureRelativeTerminationPlan,
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
    apertureAwareTerminusPlan,
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

function lowerSocketRenderClassLegend() {
  return Object.entries(LOWER_SOCKET_RENDER_CLASS_COLORS).map(([renderClass, color]) => ({
    renderClass,
    color,
    colorHex: `#${color.toString(16).padStart(6, '0')}`,
  }));
}

function lowerSocketInventoryRecord({
  renderClass,
  sourceId,
  meshName = sourceId,
  parentAssemblage = 'lower-socket-keel',
  renderRole = null,
  normalRenderExpected = false,
  sourcePath = null,
  sourceState = 'present-in-current-plan',
  suppressionAuthority = null,
  lowerSocketRelevance = 'direct-parent',
  suspiciousIfVisible = false,
}) {
  return {
    schema: 'LowerSocketRenderInventoryRecord',
    mode: ORB_SHELL_LOWER_SOCKET_RENDER_INVENTORY_MODE,
    renderClass,
    sourceId,
    meshName,
    parentAssemblage,
    renderRole,
    normalRenderExpected,
    sourcePath,
    sourceState,
    suppressionAuthority,
    lowerSocketRelevance,
    suspiciousIfVisible,
    diagnosticColor: LOWER_SOCKET_RENDER_CLASS_COLORS[renderClass],
    diagnosticColorHex: `#${LOWER_SOCKET_RENDER_CLASS_COLORS[renderClass].toString(16).padStart(6, '0')}`,
  };
}

function lowerSocketAbsenceRecord(renderClass, reason, sourcePath = null) {
  return lowerSocketInventoryRecord({
    renderClass,
    sourceId: `lower-socket-keel-no-current-${renderClass}`,
    meshName: `lower-socket-keel-no-current-${renderClass}`,
    renderRole: 'absence-placeholder',
    normalRenderExpected: false,
    sourcePath,
    sourceState: 'absent-in-current-plan',
    lowerSocketRelevance: reason,
    suspiciousIfVisible: false,
  });
}

function isLowerSocketRelevantRecord(record) {
  if (!record) return false;
  return record.parentAssemblage === 'lower-socket-keel'
    || record.targetBoundaryId === 'lower-cup-socket-join-gap'
    || record.sourceGapDescriptorId === 'lower-cup-socket-join-gap'
    || record.id === 'lower-cup-socket-join-gap'
    || JSON.stringify(record).includes('lower-socket')
    || JSON.stringify(record).includes('lower-cup-socket');
}

function createLowerSocketRenderInventoryPlan(composition) {
  const expectedRecords = [];
  const lowerSocket = composition.macroAssemblages.find(assemblage => assemblage.id === 'lower-socket-keel');
  const sideWallPlan = composition.liveMacroSideWallPlan;
  const substripPlan = composition.macroFamilySubstripPlan;
  const channelPlan = composition.lamellarChannelMeshPlan;
  const boundaryPlan = composition.lamellarPlateBoundaryPlan;
  const returnPlan = composition.lamellarInnerReturnPlan;
  const seamGaps = composition.expandedMacroRegionProxyPlan?.seamGaps || [];

  if (lowerSocket?.macroPromotedBody) {
    expectedRecords.push(lowerSocketInventoryRecord({
      renderClass: 'MacroPromotedBody',
      sourceId: lowerSocket.macroPromotedBody.id,
      meshName: 'lower-socket-keel-macro-promoted-body',
      renderRole: 'promoted-body-surface',
      normalRenderExpected: !(substripPlan?.visibleParentRetirementPolicy?.retiredParentAssemblageIds || []).includes('lower-socket-keel'),
      sourcePath: 'macroAssemblages.lower-socket-keel.macroPromotedBody',
      suspiciousIfVisible: false,
    }));
  } else {
    expectedRecords.push(lowerSocketAbsenceRecord('MacroPromotedBody', 'lower-socket-retired-or-not-selected', 'macroAssemblages.lower-socket-keel.macroPromotedBody'));
  }

  const liveSideWalls = (sideWallPlan?.sideWalls || []).filter(wall => wall.parentAssemblage === 'lower-socket-keel');
  for (const wall of liveSideWalls) {
    expectedRecords.push(lowerSocketInventoryRecord({
      renderClass: 'LiveMacroSideWall',
      sourceId: wall.id,
      meshName: wall.id,
      renderRole: wall.targetEdge,
      normalRenderExpected: expectedRecords.find(record => record.renderClass === 'MacroPromotedBody')?.normalRenderExpected || false,
      sourcePath: 'liveMacroSideWallPlan.sideWalls',
      suspiciousIfVisible: false,
    }));
  }
  if (!liveSideWalls.length) expectedRecords.push(lowerSocketAbsenceRecord('LiveMacroSideWall', 'no-live-sidewall-for-lower-socket', 'liveMacroSideWallPlan.sideWalls'));

  const terminalCaps = (sideWallPlan?.terminalCaps || []).filter(cap => cap.parentAssemblage === 'lower-socket-keel');
  for (const cap of terminalCaps) {
    expectedRecords.push(lowerSocketInventoryRecord({
      renderClass: 'LiveMacroTerminalCap',
      sourceId: cap.id,
      meshName: cap.id,
      renderRole: cap.targetEdge,
      normalRenderExpected: cap.normalRenderVisible !== false,
      sourcePath: 'liveMacroSideWallPlan.terminalCaps',
      suppressionAuthority: cap.normalRenderVisible === false ? 'LowerSocketFamilyRoleLaw.hidden-terminal-cap-authority' : null,
      suspiciousIfVisible: cap.normalRenderVisible === false,
    }));
  }
  if (!terminalCaps.length) expectedRecords.push(lowerSocketAbsenceRecord('LiveMacroTerminalCap', 'no-live-terminal-caps-for-lower-socket', 'liveMacroSideWallPlan.terminalCaps'));

  const substrips = (substripPlan?.substrips || []).filter(strip => strip.parentAssemblage === 'lower-socket-keel');
  for (const substrip of substrips) {
    expectedRecords.push(lowerSocketInventoryRecord({
      renderClass: 'MacroFamilySubstrip',
      sourceId: substrip.id,
      meshName: substrip.id,
      renderRole: substrip.role,
      normalRenderExpected: true,
      sourcePath: 'macroFamilySubstripPlan.substrips',
    }));
    for (const sideName of ['left', 'right']) {
      expectedRecords.push(lowerSocketInventoryRecord({
        renderClass: 'MacroFamilySubstripSideWall',
        sourceId: `${substrip.id}-${sideName}-sidewall`,
        meshName: `${substrip.id}-${sideName}-sidewall`,
        renderRole: `${substrip.role}:${sideName}`,
        normalRenderExpected: true,
        sourcePath: 'macroFamilySubstripPlan.substrips.sideWallSamples',
      }));
    }
    for (const cap of substrip.terminalCaps || []) {
      expectedRecords.push(lowerSocketInventoryRecord({
        renderClass: 'MacroFamilySubstripTerminalCap',
        sourceId: cap.id,
        meshName: cap.id,
        renderRole: cap.capRole,
        normalRenderExpected: true,
        sourcePath: 'macroFamilySubstripPlan.substrips.terminalCaps',
      }));
    }
  }
  if (!substrips.length) {
    expectedRecords.push(lowerSocketAbsenceRecord('MacroFamilySubstrip', 'lower-socket-not-decomposed-by-current-substrip-plan', 'macroFamilySubstripPlan.substrips'));
    expectedRecords.push(lowerSocketAbsenceRecord('MacroFamilySubstripSideWall', 'lower-socket-not-decomposed-by-current-substrip-plan', 'macroFamilySubstripPlan.substrips.sideWallSamples'));
    expectedRecords.push(lowerSocketAbsenceRecord('MacroFamilySubstripTerminalCap', 'lower-socket-not-decomposed-by-current-substrip-plan', 'macroFamilySubstripPlan.substrips.terminalCaps'));
  }

  for (const bandMember of lowerSocket?.childBandPlan || []) {
    const suppressed = sideWallPlan?.suppressedLegacyRoundBandIds?.includes(bandMember.id) || false;
    expectedRecords.push(lowerSocketInventoryRecord({
      renderClass: 'BandMember',
      sourceId: bandMember.id,
      meshName: bandMember.id,
      renderRole: bandMember.role,
      normalRenderExpected: !suppressed,
      sourcePath: 'macroAssemblages.lower-socket-keel.childBandPlan',
      suppressionAuthority: suppressed ? 'LiveMacroSideWallPlan.suppressedLegacyRoundBandIds' : null,
      suspiciousIfVisible: suppressed || bandMember.role !== 'body',
    }));
    for (const endpoint of ['start', 'end']) {
      const socketId = `${bandMember.id}-${endpoint}-termination-socket`;
      const socketSuppressed = sideWallPlan?.suppressedLegacyTerminationSocketIds?.includes(socketId) || suppressed;
      expectedRecords.push(lowerSocketInventoryRecord({
        renderClass: 'TerminationSocketGraph',
        sourceId: socketId,
        meshName: socketId,
        renderRole: `${bandMember.role}:${endpoint}`,
        normalRenderExpected: !socketSuppressed,
        sourcePath: `macroAssemblages.lower-socket-keel.childBandPlan.${endpoint}Termination`,
        suppressionAuthority: socketSuppressed ? 'LiveMacroSideWallPlan.suppressedLegacyTerminationSocketIds' : null,
        suspiciousIfVisible: socketSuppressed,
      }));
    }
  }
  if (!lowerSocket?.childBandPlan?.length) {
    expectedRecords.push(lowerSocketAbsenceRecord('BandMember', 'lower-socket-retired-or-no-child-bands', 'macroAssemblages.lower-socket-keel.childBandPlan'));
    expectedRecords.push(lowerSocketAbsenceRecord('TerminationSocketGraph', 'lower-socket-retired-or-no-child-bands', 'macroAssemblages.lower-socket-keel.childBandPlan.*Termination'));
  }

  const lowerChannelStrips = (channelPlan?.stripMeshes || []).filter(isLowerSocketRelevantRecord);
  for (const strip of lowerChannelStrips) {
    expectedRecords.push(lowerSocketInventoryRecord({
      renderClass: 'LamellarChannelStripMesh',
      sourceId: strip.id,
      meshName: `${strip.id}-flat-lamellar-channel-strip`,
      parentAssemblage: strip.parentAssemblage || 'lower-socket-keel',
      renderRole: strip.renderRole,
      normalRenderExpected: true,
      sourcePath: 'lamellarChannelMeshPlan.stripMeshes',
      lowerSocketRelevance: strip.parentAssemblage === 'lower-socket-keel' ? 'direct-parent' : 'lower-socket-adjacent-channel',
    }));
    for (const lip of strip.plateLips || []) {
      expectedRecords.push(lowerSocketInventoryRecord({
        renderClass: 'LamellarPlateLip',
        sourceId: lip.id,
        meshName: lip.id,
        parentAssemblage: strip.parentAssemblage || 'lower-socket-keel',
        renderRole: lip.edgeRole,
        normalRenderExpected: !boundaryPlan?.suppressedProxyFeatureIds?.includes(lip.id),
        sourcePath: 'lamellarChannelMeshPlan.stripMeshes.plateLips',
        lowerSocketRelevance: strip.parentAssemblage === 'lower-socket-keel' ? 'direct-parent' : 'lower-socket-adjacent-channel',
        suppressionAuthority: boundaryPlan?.suppressedProxyFeatureIds?.includes(lip.id) ? 'LamellarPlateBoundaryPlan.suppressedProxyFeatureIds' : null,
      }));
    }
  }
  if (!lowerChannelStrips.length) {
    expectedRecords.push(lowerSocketAbsenceRecord('LamellarChannelStripMesh', 'no-current-lower-socket-channel-strip-mesh', 'lamellarChannelMeshPlan.stripMeshes'));
    expectedRecords.push(lowerSocketAbsenceRecord('LamellarPlateLip', 'no-current-lower-socket-channel-strip-mesh', 'lamellarChannelMeshPlan.stripMeshes.plateLips'));
  }

  const lowerBoundaries = (boundaryPlan?.boundaryMeshes || []).filter(isLowerSocketRelevantRecord);
  for (const boundary of lowerBoundaries) {
    expectedRecords.push(lowerSocketInventoryRecord({
      renderClass: 'LamellarPlateBoundaryMesh',
      sourceId: boundary.id,
      meshName: boundary.id,
      parentAssemblage: 'lower-socket-keel',
      renderRole: boundary.boundaryRole || boundary.boundaryMode,
      normalRenderExpected: true,
      sourcePath: 'lamellarPlateBoundaryPlan.boundaryMeshes',
      lowerSocketRelevance: 'lower-cup-socket-join-gap',
    }));
  }
  if (!lowerBoundaries.length) expectedRecords.push(lowerSocketAbsenceRecord('LamellarPlateBoundaryMesh', 'no-lower-cup-boundary-mesh', 'lamellarPlateBoundaryPlan.boundaryMeshes'));

  const lowerReturnPlanes = (returnPlan?.sidePlaneMeshes || []).filter(isLowerSocketRelevantRecord);
  for (const sidePlane of lowerReturnPlanes) {
    expectedRecords.push(lowerSocketInventoryRecord({
      renderClass: 'LamellarInnerReturnSidePlaneMesh',
      sourceId: sidePlane.id,
      meshName: sidePlane.id,
      parentAssemblage: 'lower-socket-keel',
      renderRole: sidePlane.boundaryRole,
      normalRenderExpected: true,
      sourcePath: 'lamellarInnerReturnPlan.sidePlaneMeshes',
      lowerSocketRelevance: 'lower-socket-adjacent-return-plane',
    }));
  }
  if (!lowerReturnPlanes.length) expectedRecords.push(lowerSocketAbsenceRecord('LamellarInnerReturnSidePlaneMesh', 'no-current-lower-socket-inner-return-plane', 'lamellarInnerReturnPlan.sidePlaneMeshes'));

  const lowerSeamGaps = seamGaps.filter(isLowerSocketRelevantRecord);
  for (const gap of lowerSeamGaps) {
    expectedRecords.push(lowerSocketInventoryRecord({
      renderClass: 'MacroRegionSeamGapDescriptor',
      sourceId: gap.id,
      meshName: `${gap.id}-future-mesh-boundary-input`,
      parentAssemblage: 'lower-socket-keel',
      renderRole: gap.role,
      normalRenderExpected: !boundaryPlan?.suppressedDecorativeHintIds?.includes(`${gap.id}-future-mesh-boundary-input`),
      sourcePath: 'expandedMacroRegionProxyPlan.seamGaps',
      lowerSocketRelevance: 'lower-cup-socket-join-gap',
      suppressionAuthority: boundaryPlan?.suppressedDecorativeHintIds?.includes(`${gap.id}-future-mesh-boundary-input`)
        ? 'LamellarPlateBoundaryPlan.suppressedDecorativeHintIds'
        : null,
      suspiciousIfVisible: boundaryPlan?.suppressedDecorativeHintIds?.includes(`${gap.id}-future-mesh-boundary-input`) || false,
    }));
  }
  if (!lowerSeamGaps.length) expectedRecords.push(lowerSocketAbsenceRecord('MacroRegionSeamGapDescriptor', 'no-lower-cup-seam-gap-descriptor', 'expandedMacroRegionProxyPlan.seamGaps'));

  const expectedRenderClasses = Array.from(new Set(expectedRecords.map(record => record.renderClass)));
  return {
    schema: 'LowerSocketRenderInventoryPlan',
    mode: ORB_SHELL_LOWER_SOCKET_RENDER_INVENTORY_MODE,
    targetAssemblage: 'lower-socket-keel',
    diagnosticQuestion: 'which concrete render path produced the visible lower-socket appendage',
    runtimeTraversalRequired: true,
    isolationWitnessMode: 'lower-socket-semantic-render-inventory-isolated-v0',
    classColorLegend: lowerSocketRenderClassLegend().filter(entry => expectedRenderClasses.includes(entry.renderClass)),
    expectedRecords,
    expectedRecordCount: expectedRecords.length,
    expectedRenderClasses,
    normalRenderExpectedVisibleIds: expectedRecords.filter(record => record.normalRenderExpected).map(record => record.meshName),
    suppressedExpectedIds: expectedRecords.filter(record => record.suppressionAuthority).map(record => record.meshName),
    absentClassCount: expectedRecords.filter(record => record.sourceState === 'absent-in-current-plan').length,
    failureClassesIfVisible: [
      'stale-subordinate-anatomy-visible',
      'suppressed-legacy-band-or-socket-visible',
      'hidden-terminal-cap-visible',
      'decorative-seam-hint-visible-after-boundary-mesh',
      'wrong-global-render-path-misread-as-lower-socket-body',
    ],
    inventoryCompletenessVerdict: 'lower-socket-render-paths-enumerated-before-next-shape-edit',
  };
}

function socketTongueRepeatabilityInput(composition) {
  return {
    schema: 'SocketTongueRepeatabilityInput',
    variantId: composition.effectiveVariation?.variantId || composition.controlledVariation?.variantId || 'baseline',
    variationSeed: composition.effectiveVariation?.variationSeed ?? composition.controlledVariation?.variationSeed ?? 0,
    variationLeafCount: composition.effectiveVariation?.variationLeafCount ?? composition.controlledVariation?.variationLeafCount ?? 10,
    selectedMacroAssemblageIds: composition.macroAssemblageCountLaw?.selectedMacroAssemblageIds || composition.macroAssemblages.map(item => item.id),
  };
}

function maxCapWidthExpansionRatio(terminalCaps = []) {
  return terminalCaps.reduce((maxRatio, cap) => {
    const min = cap.capWidthStats?.min || 0;
    const max = cap.capWidthStats?.max || 0;
    if (!min || !max) return maxRatio;
    return Math.max(maxRatio, max / min);
  }, 0);
}

function socketTongueGenerativeKnobs(candidate, lowerSocket) {
  return [
    {
      name: 'socketTongueArcLength',
      sourceField: 'LowerSocketFamilyRoleLaw.tuckTongueRefinement.visibleArcLimitT',
      observedValue: lowerSocket.lowerSocketFamilyRoleLaw?.tuckTongueRefinement?.visibleArcLimitT ?? null,
      guidance: 'controls how much subordinate tongue remains visible before receiver/owner attachment',
    },
    {
      name: 'terminalHookPressure',
      sourceField: 'SocketTongueAnatomyMetrics.endCapWidthExpansionRatio',
      observedValue: candidate.anatomyMetrics.endCapWidthExpansionRatio,
      guidance: 'controls how strongly the terminal flares into a hook rather than a blunt strip end',
    },
    {
      name: 'receiverSeamPull',
      sourceField: 'LowerSocketFamilyRoleLaw.geometryEffect.socketAlignmentPull',
      observedValue: lowerSocket.lowerSocketFamilyRoleLaw?.geometryEffect?.socketAlignmentPull ?? null,
      guidance: 'pulls the tongue toward the lower/equatorial socket seam receiver',
    },
    {
      name: 'sidewallThickness',
      sourceField: 'SocketTongueAnatomyMetrics.meanSideWallThickness',
      observedValue: candidate.anatomyMetrics.meanSideWallThickness,
      guidance: 'keeps the tongue readable as lamellar sheet thickness instead of a line',
    },
    {
      name: 'visiblePlateWidthFloor',
      sourceField: 'LowerSocketPlateBodyHonestyLaw.visiblePlateWidthFloor',
      observedValue: lowerSocket.lowerSocketPlateBodyHonestyLaw?.visiblePlateWidthFloor ?? null,
      guidance: 'prevents the subordinate tongue from collapsing into a cord before a receiver exists',
    },
  ];
}

function createSocketTongueGenerativeInvariantRecord(candidate, lowerSocket) {
  return {
    schema: 'SocketTongueGenerativeInvariantRecord',
    mode: ORB_SHELL_SOCKET_TONGUE_GENERATIVE_INVARIANT_MODE,
    id: `${candidate.id}-generative-invariants`,
    candidateId: candidate.id,
    recipeIntent: 'regenerate-secondary-underpass-socket-tongue-on-purpose',
    ontologyConfiguration: {
      schema: 'SocketTongueOntologyConfiguration',
      sourceMacroId: lowerSocket.id,
      selectedRole: lowerSocket.lowerSocketFamilyRoleLaw?.selectedRole || null,
      visibleAuthority: lowerSocket.macroPromotedBody?.visibleAuthority || null,
      sourceObjecthood: 'subordinate-socket-insert-not-primary-macro',
      receiverExpectation: 'lower-equatorial-shared-socket-seam-or-aperture-owner',
    },
    hardPrerequisites: [
      'lower-socket-keel-selected',
      'equatorial-cupping-whorl-selected',
      'lower-equatorial-shared-socket-seam-active',
      'lower-socket-role-is-tuck-tongue',
      'plate-body-honesty-prevents-cord-collapse',
      'terminal-caps-protected-by-receiver-or-provisional-visibility',
      'live-promoted-body-sidewalls-present',
    ],
    preservedInvariants: [
      'subordinate-objecthood-not-full-macro-lamella',
      'visible-body-remains-sheetlike-before-tuck',
      'terminal-cap-authority-protected',
      'sidewalls-remain-live-readable-thickness-surfaces',
      'receiver-or-aperture-owner-required-before-disappearance',
    ],
    geometricConstraints: [
      {
        name: 'sheet-thickness-regime',
        observedBasis: 'meanSideWallThickness',
        constraint: 'tongue must remain visibly thick enough to read as lamellar sheet anatomy',
      },
      {
        name: 'terminal-hook-pressure',
        observedBasis: 'endCapWidthExpansionRatio',
        constraint: 'terminal may flare into hook pressure but must not claim visible cap objecthood',
      },
      {
        name: 'subordinate-width-regime',
        observedBasis: 'visiblePlateWidthFloor plus promotedBodyScale',
        constraint: 'body width is preserved enough to avoid cord collapse while staying subordinate',
      },
      {
        name: 'receiver-dependent-disappearance',
        observedBasis: 'protectedTerminalCapIds plus tuckDisappearancePolicy',
        constraint: 'disappearance is legal only when a receiver seam or aperture owner exists',
      },
    ],
    tunableKnobs: socketTongueGenerativeKnobs(candidate, lowerSocket),
    observedMetricBands: {
      schema: 'SocketTongueObservedMetricBands',
      meanSideWallThickness: [candidate.anatomyMetrics.meanSideWallThickness],
      endCapWidthExpansionRatio: [candidate.anatomyMetrics.endCapWidthExpansionRatio],
      sideWallThicknessRelativeVariationMax: [candidate.anatomyMetrics.sideWallThicknessRelativeVariationMax],
      promotedBodyScale: [candidate.anatomyMetrics.promotedBodyScale],
      terminalWidthScale: [candidate.anatomyMetrics.terminalWidthScale],
      interpretation: 'single observed stress point, not final allowed range',
    },
    forbiddenFailureClasses: [
      'promote-to-full-macro-lamella',
      'collapse-to-cord',
      'show-unowned-terminal-cap-as-settled-object',
      'smooth-away-hook-signal',
      'leave-without-receiver-or-aperture-owner',
    ],
    futureSolverHooks: [
      'socket-tongue-receiver-selection',
      'aperture-contour-attachment',
      'underpass-depth-field',
      'sheet-preserving-smoothing',
    ],
  };
}

function createSocketTongueGenerativeInvariantPlan(candidates, lowerSocket) {
  const records = lowerSocket
    ? candidates.map(candidate => (
      candidate.generativeInvariantRecord || createSocketTongueGenerativeInvariantRecord(candidate, lowerSocket)
    ))
    : [];
  return {
    schema: 'SocketTongueGenerativeInvariantPlan',
    mode: ORB_SHELL_SOCKET_TONGUE_GENERATIVE_INVARIANT_MODE,
    targetAssemblage: 'lower-socket-keel',
    purpose: 'extract causal recipe constraints from the accidental socket tongue phenotype',
    records,
    recordCount: records.length,
    bestRecipeCandidateIds: records.map(record => record.candidateId),
    invariantExtractionVerdict: records.length
      ? 'socket-tongue-generative-invariants-extracted'
      : 'socket-tongue-generative-invariants-not-active',
  };
}

function createSocketTonguePostStripHonestyPreservationRecord(candidate, lowerSocket, identityPolicy) {
  const invariantRecord = candidate.generativeInvariantRecord || createSocketTongueGenerativeInvariantRecord(candidate, lowerSocket);
  const metrics = candidate.anatomyMetrics || {};
  const failureClasses = [];
  const hasHookPressure = (metrics.endCapWidthExpansionRatio || 0) >= 2;
  const hasSheetBody = (metrics.meanSideWallThickness || 0) >= 0.045
    && invariantRecord.preservedInvariants.includes('visible-body-remains-sheetlike-before-tuck');
  const hasProtectedCaps = (metrics.protectedTerminalCapCount || metrics.hiddenTerminalCapCount || 0) >= 2;
  const hasLiveSidewalls = (metrics.sideWallCount || 0) >= 2;
  const receiverOwnedAbsorptionDisposition = null;
  if (!hasHookPressure) failureClasses.push('smooth-away-hook-signal');
  if (!hasSheetBody) failureClasses.push('collapse-to-cord');
  if (!hasProtectedCaps) failureClasses.push('show-unowned-terminal-cap-as-settled-object');
  if (!hasLiveSidewalls) failureClasses.push('failed-crumple');
  if (
    candidate.provisionalDisposition === 'preserve-as-secondary-vocabulary-candidate'
    && !receiverOwnedAbsorptionDisposition
    && !hasHookPressure
  ) {
    failureClasses.push('erase-secondary-socket-tongue-without-receiver-disposition');
  }
  return {
    schema: 'SocketTonguePostStripHonestyPreservationRecord',
    mode: ORB_SHELL_SOCKET_TONGUE_POST_STRIP_HONESTY_MODE,
    id: `${candidate.id}-post-strip-honesty-preservation`,
    candidateId: candidate.id,
    stripHonestyLawId: lowerSocket.lowerSocketStripHonestyLaw?.id || null,
    invariantRecordId: invariantRecord.id,
    identityPolicyMode: identityPolicy?.mode || null,
    preStripDisposition: candidate.provisionalDisposition,
    receiverOwnedAbsorptionDisposition,
    provisionalVisibleCapAuthority: lowerSocket.lowerSocketFamilyRoleLaw?.tuckTongueRefinement?.terminalCapAuthority || null,
    terminalCapVisibilityPolicy: lowerSocket.lowerSocketFamilyRoleLaw?.tuckTongueRefinement?.terminalCapVisibilityPolicy || null,
    silentErasureAllowed: false,
    protectedSignalSpans: identityPolicy?.protectedSignalSpans || [
      { signal: 'subordinate-sheet-body', t0: 0.05, t1: 0.86 },
      { signal: 'terminal-hook-pressure', t0: 0.72, t1: 1 },
    ],
    smoothingMayChange: [
      'high-frequency-sidewall-kinks',
      'local-visible-edge-waviness',
      'centerline-lateral-wander',
    ],
    smoothingMayNotChange: [
      'secondary-socket-tongue-objecthood',
      'terminal-hook-signal',
      'protected-terminal-cap-authority',
      'receiver-dependent-disappearance-contract',
    ],
    preservationEvidence: {
      schema: 'SocketTonguePostStripHonestyEvidence',
      candidateScore: candidate.candidateScore,
      sideWallCount: metrics.sideWallCount || 0,
      hiddenTerminalCapCount: metrics.hiddenTerminalCapCount || 0,
      protectedTerminalCapCount: metrics.protectedTerminalCapCount || metrics.hiddenTerminalCapCount || 0,
      provisionalVisibleTerminalCapCount: metrics.provisionalVisibleTerminalCapCount || 0,
      meanSideWallThickness: metrics.meanSideWallThickness || 0,
      endCapWidthExpansionRatio: metrics.endCapWidthExpansionRatio || 0,
      protectedCandidateIds: identityPolicy?.protectedCandidateIds || [],
    },
    failureClasses,
    identityPreservationVerdict: failureClasses.length
      ? 'socket-tongue-preservation-failed-after-strip-honesty'
      : 'protected-secondary-socket-tongue-preserved-after-strip-honesty',
  };
}

function createSocketTonguePostStripHonestyPreservationPlan(candidates, lowerSocket) {
  const identityPolicy = lowerSocket?.lowerSocketStripHonestyLaw
    ?.sideCurveSmoothing
    ?.kinkBudgetSolver
    ?.socketTongueIdentityPreservation || null;
  const records = lowerSocket
    ? candidates.map(candidate => createSocketTonguePostStripHonestyPreservationRecord(candidate, lowerSocket, identityPolicy))
    : [];
  const protectedFailureClasses = [
    'smooth-away-hook-signal',
    'erase-secondary-socket-tongue-without-receiver-disposition',
    'collapse-to-cord',
    'show-unowned-terminal-cap-as-settled-object',
  ];
  return {
    schema: 'SocketTonguePostStripHonestyPreservationPlan',
    mode: ORB_SHELL_SOCKET_TONGUE_POST_STRIP_HONESTY_MODE,
    targetAssemblage: 'lower-socket-keel',
    targetCandidateId: candidates[0]?.id || 'lower-socket-keel-promoted-body-socket-tongue-candidate',
    stripHonestyLawId: lowerSocket?.lowerSocketStripHonestyLaw?.id || null,
    purpose: 'make strip-honesty smoothing accountable to preserved secondary socket-tongue vocabulary',
    identityPolicyMode: identityPolicy?.mode || null,
    protectedFailureClasses,
    records,
    recordCount: records.length,
    erasurePolicy: 'candidate disappearance is legal only with explicit receiver-owned absorption or tuck disposition',
    preservationVerdict: records.length && records.every(record => record.identityPreservationVerdict === 'protected-secondary-socket-tongue-preserved-after-strip-honesty')
      ? 'socket-tongue-identity-preserved-after-strip-honesty'
      : records.length
        ? 'socket-tongue-identity-risk-after-strip-honesty'
        : 'socket-tongue-preservation-not-active',
  };
}

function createSocketTongueProvenancePlan(composition) {
  const targetAssemblage = 'lower-socket-keel';
  const repeatabilityInputs = [socketTongueRepeatabilityInput(composition)];
  const lowerSocket = composition.macroAssemblages.find(assemblage => assemblage.id === targetAssemblage);
  const sideWalls = (composition.liveMacroSideWallPlan?.sideWalls || [])
    .filter(wall => wall.parentAssemblage === targetAssemblage);
  const terminalCaps = (composition.liveMacroSideWallPlan?.terminalCaps || [])
    .filter(cap => cap.parentAssemblage === targetAssemblage);
  const hiddenTerminalCaps = terminalCaps.filter(cap => cap.normalRenderVisible === false);
  const provisionalVisibleTerminalCaps = terminalCaps.filter(cap => cap.provisionalSocketTongueVisible === true);
  const protectedTerminalCaps = terminalCaps.filter(cap => (
    cap.normalRenderVisible === false
    || cap.provisionalSocketTongueVisible === true
  ));
  const inventoryRecords = (composition.lowerSocketRenderInventoryPlan?.expectedRecords || [])
    .filter(record => record.parentAssemblage === targetAssemblage);

  if (!lowerSocket?.macroPromotedBody) {
    return {
      schema: 'SocketTongueProvenancePlan',
      mode: ORB_SHELL_SOCKET_TONGUE_PROVENANCE_MODE,
      targetAssemblage,
      diagnosticQuestion: 'what procedural source created the lower-left hooked socket tongue',
      repeatabilityInputs,
      candidates: [],
      candidateCount: 0,
      bestCandidateId: null,
      generativeInvariantPlan: createSocketTongueGenerativeInvariantPlan([], null),
      postStripHonestyPreservationPlan: createSocketTonguePostStripHonestyPreservationPlan([], null),
      supportingInventoryRecordIds: inventoryRecords.map(record => record.sourceId),
      provenanceVerdict: 'socket-tongue-source-not-selected',
      followupQuestions: [
        'which selected stress inputs should intentionally request secondary socket tongues',
      ],
    };
  }

  const meanSideWallThickness = sideWalls.length
    ? sideWalls.reduce((sum, wall) => sum + (wall.sideWallThicknessStats?.mean || 0), 0) / sideWalls.length
    : 0;
  const endCapWidthExpansionRatio = maxCapWidthExpansionRatio(terminalCaps);
  const roleLaw = lowerSocket.lowerSocketFamilyRoleLaw || lowerSocket.macroPromotedBody.lowerSocketFamilyRoleLaw;
  const plateLaw = lowerSocket.lowerSocketPlateBodyHonestyLaw || lowerSocket.macroPromotedBody.lowerSocketPlateBodyHonestyLaw;
  const stripLaw = lowerSocket.lowerSocketStripHonestyLaw || lowerSocket.macroPromotedBody.lowerSocketStripHonestyLaw;
  const scoreParts = [
    roleLaw?.selectedRole === 'tuck-tongue' ? 0.26 : 0,
    sideWalls.length >= 2 ? 0.18 : 0,
    protectedTerminalCaps.length >= 2 ? 0.18 : 0,
    meanSideWallThickness > 0.045 ? 0.12 : 0,
    endCapWidthExpansionRatio > 2 ? 0.18 : 0,
    plateLaw ? 0.08 : 0,
  ];
  const candidateScore = clamp(scoreParts.reduce((sum, value) => sum + value, 0), 0, 1);
  const candidate = {
    schema: 'SocketTongueCandidate',
    mode: ORB_SHELL_SOCKET_TONGUE_PROVENANCE_MODE,
    id: `${targetAssemblage}-promoted-body-socket-tongue-candidate`,
    candidateClass: 'secondary-underpass-socket-tongue-candidate',
    provisionalDisposition: 'preserve-as-secondary-vocabulary-candidate',
    parentAssemblage: targetAssemblage,
    sourceClass: 'MacroPromotedBody',
    sourceId: lowerSocket.macroPromotedBody.id,
    sourcePath: 'macroAssemblages.lower-socket-keel.macroPromotedBody',
    roleLawId: roleLaw?.id || null,
    stripHonestyLawId: stripLaw?.id || null,
    plateBodyHonestyLawId: plateLaw?.id || null,
    sideWallIds: sideWalls.map(wall => wall.id),
    hiddenTerminalCapIds: hiddenTerminalCaps.map(cap => cap.id),
    provisionalVisibleTerminalCapIds: provisionalVisibleTerminalCaps.map(cap => cap.id),
    protectedTerminalCapIds: protectedTerminalCaps.map(cap => cap.id),
    supportingInventoryRecordIds: inventoryRecords.map(record => record.sourceId),
    supportingEvidenceClasses: [
      'MacroPromotedBody',
      ...(sideWalls.length ? ['LiveMacroSideWall'] : []),
      ...(terminalCaps.length ? ['LiveMacroTerminalCap'] : []),
      ...(roleLaw ? ['LowerSocketFamilyRoleLaw'] : []),
      ...(stripLaw ? ['LowerSocketStripHonestyLaw'] : []),
      ...(plateLaw ? ['LowerSocketPlateBodyHonestyLaw'] : []),
    ],
    whyInteresting: [
      'hooked-lower-socket-return',
      'narrow-subordinate-underpass-body',
      'socket-adjacent-secondary-anatomy',
      'visible-signal-emerged-from-lawful-lower-socket-stack',
    ],
    notMacroLamellaBecause: [
      roleLaw?.selectedRole === 'tuck-tongue' ? 'selected-role-is-tuck-tongue' : 'not-selected-as-primary-macro-family',
      protectedTerminalCaps.length ? 'protected-terminal-caps-deny-independent-objecthood' : 'terminal-cap-authority-not-full-objecthood',
      'source-is-subordinate-lower-socket-keel',
      'requires-future-receiver-or-aperture-owner-before-final-tuck',
    ],
    anatomyMetrics: {
      schema: 'SocketTongueAnatomyMetrics',
      sideWallCount: sideWalls.length,
      hiddenTerminalCapCount: hiddenTerminalCaps.length,
      provisionalVisibleTerminalCapCount: provisionalVisibleTerminalCaps.length,
      protectedTerminalCapCount: protectedTerminalCaps.length,
      terminalCapCount: terminalCaps.length,
      meanSideWallThickness,
      sideWallThicknessRelativeVariationMax: sideWalls.reduce((max, wall) => Math.max(max, wall.sideWallThicknessStats?.relativeVariation || 0), 0),
      endCapWidthExpansionRatio,
      visibleAuthority: lowerSocket.macroPromotedBody.visibleAuthority || null,
      promotedBodyScale: lowerSocket.macroPromotedBody.promotedBodyScale || null,
      terminalWidthScale: lowerSocket.macroPromotedBody.sideSilhouettePolicy?.terminalWidthScale || null,
    },
    candidateScore,
    repeatabilityInputs,
  };
  const generativeInvariantRecord = createSocketTongueGenerativeInvariantRecord(candidate, lowerSocket);
  candidate.generativeInvariantRecord = generativeInvariantRecord;
  const generativeInvariantPlan = createSocketTongueGenerativeInvariantPlan([candidate], lowerSocket);
  const postStripHonestyPreservationPlan = createSocketTonguePostStripHonestyPreservationPlan([candidate], lowerSocket);
  candidate.postStripHonestyPreservationRecord = postStripHonestyPreservationPlan.records.find(record => record.candidateId === candidate.id) || null;

  return {
    schema: 'SocketTongueProvenancePlan',
    mode: ORB_SHELL_SOCKET_TONGUE_PROVENANCE_MODE,
    targetAssemblage,
    diagnosticQuestion: 'what procedural source created the lower-left hooked socket tongue',
    repeatabilityInputs,
    candidates: [candidate],
    candidateCount: 1,
    bestCandidateId: candidate.id,
    generativeInvariantPlan,
    postStripHonestyPreservationPlan,
    supportingInventoryRecordIds: inventoryRecords.map(record => record.sourceId),
    provenanceVerdict: candidateScore >= 0.72
      ? 'socket-tongue-candidate-source-identified'
      : 'socket-tongue-source-present-but-not-yet-coherent',
    followupQuestions: [
      'how should secondary socket tongues intentionally attach to aperture/socket contour owners',
      'which receiver owns the underpass or latch when the lower socket tongue disappears',
      'which variation knobs request this vocabulary without turning it into a full macro lamella',
    ],
  };
}

export const DEFAULT_SOCKET_TONGUE_REPRODUCTION_PROBE_CONFIGS = [
  { variantId: 'wide-cup', variationSeed: 6, variationLeafCount: 11, label: 'reference-wide-cup-six-eleven' },
  { variantId: 'wide-cup', variationSeed: 8, variationLeafCount: 12, label: 'wide-cup-neighbor-eight-twelve' },
  { variantId: 'wide-cup', variationSeed: 10, variationLeafCount: 14, label: 'wide-cup-negative-no-lower-socket' },
  { variantId: 'wide-cup', variationSeed: 14, variationLeafCount: 14, label: 'wide-cup-dense-fourteen' },
  { variantId: 'left-heavy-rim', variationSeed: 12, variationLeafCount: 11, label: 'left-heavy-rim-cross-variant' },
  { variantId: 'asymmetric-tuck', variationSeed: 11, variationLeafCount: 14, label: 'asymmetric-tuck-dense' },
  { variantId: 'tight-crown', variationSeed: 18, variationLeafCount: 14, label: 'tight-crown-dense' },
];

function socketTongueProbeConfigKey(config) {
  return `${config.variantId}:seed-${config.variationSeed}:leaf-${config.variationLeafCount}`;
}

function socketTongueCandidateMetrics(candidate) {
  const metrics = candidate?.anatomyMetrics || {};
  return {
    schema: 'SocketTongueReproductionMetrics',
    candidateScore: candidate?.candidateScore || 0,
    sideWallCount: metrics.sideWallCount || 0,
    hiddenTerminalCapCount: metrics.hiddenTerminalCapCount || 0,
    provisionalVisibleTerminalCapCount: metrics.provisionalVisibleTerminalCapCount || 0,
    protectedTerminalCapCount: metrics.protectedTerminalCapCount || metrics.hiddenTerminalCapCount || 0,
    terminalCapCount: metrics.terminalCapCount || 0,
    meanSideWallThickness: metrics.meanSideWallThickness || 0,
    sideWallThicknessRelativeVariationMax: metrics.sideWallThicknessRelativeVariationMax || 0,
    endCapWidthExpansionRatio: metrics.endCapWidthExpansionRatio || 0,
    promotedBodyScale: metrics.promotedBodyScale || null,
    terminalWidthScale: metrics.terminalWidthScale || null,
  };
}

function createSocketTongueReproductionProbeCase(config, composition, referenceCandidateId) {
  const selectedMacroAssemblageIds = composition.macroAssemblages.map(assemblage => assemblage.id);
  const provenancePlan = composition.socketTongueProvenancePlan || createSocketTongueProvenancePlan(composition);
  const candidate = provenancePlan.candidates?.[0] || null;
  const lowerSocket = composition.macroAssemblages.find(assemblage => assemblage.id === 'lower-socket-keel') || null;
  const roleLaw = lowerSocket?.lowerSocketFamilyRoleLaw || composition.lowerSocketFamilyRoleLaw || null;
  const plateLaw = lowerSocket?.lowerSocketPlateBodyHonestyLaw || null;
  const invariantRecord = candidate?.generativeInvariantRecord || null;
  const metrics = socketTongueCandidateMetrics(candidate);
  const receiverPresent = Boolean(
    selectedMacroAssemblageIds.includes('equatorial-cupping-whorl')
      && (
        roleLaw?.requiredRelations?.includes('lower-socket-tucks-under-equatorial-lip')
        || composition.lowerEquatorialSeamLaw?.schema
        || composition.apertureOwnership?.schema
      ),
  );
  const contractFlags = {
    schema: 'SocketTongueReproductionContractFlags',
    lowerSocketSelected: selectedMacroAssemblageIds.includes('lower-socket-keel'),
    receiverPresent,
    subordinateObjecthood: Boolean(
      roleLaw?.visibleAuthority === 'subordinate-socket-insert'
        || invariantRecord?.preservedInvariants?.includes('subordinate-objecthood-not-full-macro-lamella')
    ),
    sheetlikeBody: Boolean(
      metrics.meanSideWallThickness >= 0.045
        && (plateLaw?.cordLikeShrinkageForbidden || invariantRecord?.preservedInvariants?.includes('visible-body-remains-sheetlike-before-tuck'))
    ),
    protectedTerminalCaps: metrics.protectedTerminalCapCount >= 2,
    liveSidewalls: metrics.sideWallCount >= 2,
    hookPressure: metrics.endCapWidthExpansionRatio >= 2,
    sourceCandidatePresent: Boolean(candidate),
  };
  const failureClasses = [];
  if (!contractFlags.lowerSocketSelected) failureClasses.push('failed-no-lower-socket');
  if (contractFlags.lowerSocketSelected && !contractFlags.receiverPresent) failureClasses.push('failed-no-receiver');
  if (candidate && !contractFlags.sheetlikeBody) failureClasses.push('failed-cord-collapse');
  if (candidate && !contractFlags.subordinateObjecthood) failureClasses.push('failed-full-macro');
  if (candidate && !contractFlags.liveSidewalls) failureClasses.push('failed-crumple');
  if (candidate && !contractFlags.protectedTerminalCaps) failureClasses.push('show-unowned-terminal-cap-as-settled-object');
  if (candidate && !contractFlags.hookPressure) failureClasses.push('smooth-away-hook-signal');

  const requiredFlags = [
    'lowerSocketSelected',
    'receiverPresent',
    'subordinateObjecthood',
    'sheetlikeBody',
    'protectedTerminalCaps',
    'liveSidewalls',
    'hookPressure',
    'sourceCandidatePresent',
  ];
  const satisfiedFlagCount = requiredFlags.filter(flag => contractFlags[flag]).length;
  const disposition = failureClasses.length === 0 && satisfiedFlagCount === requiredFlags.length
    ? 'reproduced'
    : candidate && satisfiedFlagCount >= 5
      ? 'partial'
      : failureClasses[0] || 'failed-crumple';
  return {
    schema: 'SocketTongueReproductionProbeCase',
    mode: ORB_SHELL_SOCKET_TONGUE_REPRODUCTION_MODE,
    id: `socket-tongue-reproduction-${socketTongueProbeConfigKey(config)}`,
    label: config.label || socketTongueProbeConfigKey(config),
    config: {
      variantId: config.variantId || 'baseline',
      variationSeed: Number(config.variationSeed) || 0,
      variationLeafCount: Number(config.variationLeafCount) || 10,
    },
    isReferenceCase: Boolean(candidate?.id && candidate.id === referenceCandidateId && config.variantId === 'wide-cup' && Number(config.variationSeed) === 6 && Number(config.variationLeafCount) === 11),
    selectedMacroAssemblageIds,
    candidateId: candidate?.id || null,
    provenanceVerdict: provenancePlan.provenanceVerdict || null,
    invariantRecordId: invariantRecord?.id || null,
    contractFlags,
    metrics,
    disposition,
    failureClasses,
    nextSlicePressure: disposition === 'reproduced'
      ? 'candidate-generalizes-now-attack-smoothness-and-receiver-geometry'
      : 'law-or-selection-repair-before-smoothing',
  };
}

export function createSocketTongueReproductionProbeMatrix(configs = DEFAULT_SOCKET_TONGUE_REPRODUCTION_PROBE_CONFIGS) {
  const referenceCandidateId = 'lower-socket-keel-promoted-body-socket-tongue-candidate';
  const cases = configs.map(config => {
    const composition = createTargetOrbShellCompositionFixture(config);
    return createSocketTongueReproductionProbeCase(config, composition, referenceCandidateId);
  });
  const reproducedCases = cases.filter(item => item.disposition === 'reproduced');
  const reproducedExcludingReference = reproducedCases.filter(item => !item.isReferenceCase);
  const partialCases = cases.filter(item => item.disposition === 'partial');
  const failedCases = cases.filter(item => item.disposition.startsWith('failed'));
  const failureClassCounts = cases.reduce((counts, item) => {
    for (const failureClass of item.failureClasses) {
      counts[failureClass] = (counts[failureClass] || 0) + 1;
    }
    return counts;
  }, {});
  const geometryUnlocked = reproducedExcludingReference.length >= 2;
  return {
    schema: 'SocketTongueReproductionProbeMatrix',
    mode: ORB_SHELL_SOCKET_TONGUE_REPRODUCTION_MODE,
    referenceCandidateId,
    purpose: 'test whether the socket-tongue invariant recipe can be reproduced beyond the original beautiful accident',
    probeConfigs: configs.map(config => ({
      variantId: config.variantId || 'baseline',
      variationSeed: Number(config.variationSeed) || 0,
      variationLeafCount: Number(config.variationLeafCount) || 10,
      label: config.label || socketTongueProbeConfigKey(config),
    })),
    cases,
    caseCount: cases.length,
    summary: {
      schema: 'SocketTongueReproductionProbeSummary',
      reproducedCount: reproducedCases.length,
      reproducedExcludingReferenceCount: reproducedExcludingReference.length,
      partialCount: partialCases.length,
      failureCount: failedCases.length,
      failureClassCounts,
      reproducedCaseIds: reproducedCases.map(item => item.id),
      reproducedExcludingReferenceCaseIds: reproducedExcludingReference.map(item => item.id),
    },
    geometryGate: {
      schema: 'SocketTongueReproductionGeometryGate',
      verdict: geometryUnlocked ? 'geometry-repair-unlocked' : 'law-repair-required-before-geometry',
      requiredNonReferenceReproductions: 2,
      observedNonReferenceReproductions: reproducedExcludingReference.length,
      acceptanceEvidence: reproducedExcludingReference.map(item => item.id),
      nextRecommendedSlice: geometryUnlocked
        ? 'lower-socket-smoothness-and-receiver-geometry-repair'
        : 'socket-tongue-selection-or-receiver-law-repair',
    },
  };
}

function sampleEarlySphereCurvePoint(assemblage, t, radius = 1.045) {
  const control = assemblage.spine.control;
  const torsion = assemblage.macroTorsionField;
  const lat = control.startLat + (control.endLat - control.startLat) * t;
  const effectiveTwist = control.effectiveTwist ?? control.twist;
  const torsionWave = torsion
    ? Math.sin(TAU * t + torsion.phaseLag) * torsion.torsionGradient * Math.sin(Math.PI * t)
    : 0;
  const surfaceRollBias = torsion
    ? torsion.surfaceRoll * Math.sin(Math.PI * t) * 0.04
    : 0;
  const lon = assemblage.sphericalTerritory.centerPhase
    + assemblage.handedness * effectiveTwist * (t - 0.5)
    + Math.sin(Math.PI * t) * control.bow
    + torsionWave
    + surfaceRollBias;
  return spherePoint(lat, lon, radius);
}

function createMacroSphereCurveDecomposition(assemblage, sampleCount = 48, radius = 1.045) {
  const samples = [];
  for (let index = 0; index < sampleCount; index++) {
    const t = index / (sampleCount - 1);
    const point = sampleEarlySphereCurvePoint(assemblage, t, radius);
    const pointRadius = Math.hypot(...point);
    samples.push({
      t,
      point,
      pointRadius,
      radiusError: pointRadius - radius,
    });
  }
  return {
    schema: 'MacroSphereCurveDecomposition',
    mode: ORB_SHELL_MACRO_MORPHOLOGY_INVENTORY_MODE,
    id: `${assemblage.id}-early-sphere-curve`,
    parentAssemblage: assemblage.id,
    generationStage: 'post-variation-pre-promotion-sphere-line',
    referenceRadius: radius,
    sampleCount,
    samples,
    maxAbsRadiusError: Math.max(...samples.map(sample => Math.abs(sample.radiusError))),
    visualOverlayId: `${assemblage.id}-early-sphere-curve-line`,
    sourceControl: {
      proceduralFamily: assemblage.spine.proceduralFamily,
      impulseLine: assemblage.spine.impulseLine,
      startLat: assemblage.spine.control.startLat,
      endLat: assemblage.spine.control.endLat,
      effectiveTwist: assemblage.spine.control.effectiveTwist ?? assemblage.spine.control.twist,
      bow: assemblage.spine.control.bow,
      torsionFieldId: assemblage.macroTorsionField?.id || null,
    },
  };
}

function lawImpactPointDeltaMetrics(basePoints, affectedPoints) {
  const count = Math.min(basePoints.length, affectedPoints.length);
  const deltas = [];
  for (let index = 0; index < count; index++) {
    deltas.push(pointDistance(basePoints[index], affectedPoints[index]));
  }
  const maxPointDelta = Math.max(0, ...deltas);
  const maxIndex = deltas.findIndex(delta => delta === maxPointDelta);
  const meanPointDelta = deltas.length
    ? deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length
    : 0;
  return {
    schema: 'MacroLawImpactPointDeltaMetrics',
    sampleCount: count,
    maxPointDelta,
    maxPointDeltaT: count > 1 && maxIndex >= 0 ? maxIndex / (count - 1) : 0,
    meanPointDelta,
  };
}

function createMacroLawImpactCurveDecomposition(assemblage, sampleCount = 48, radius = 1.045) {
  const basePoints = macroPromotedBodyCenterlinePoints(assemblage, sampleCount, radius, {
    apertureOrbitCapture: false,
  });
  const affectedPoints = macroPromotedBodyCenterlinePoints(assemblage, sampleCount, radius, {
    apertureOrbitCapture: true,
  });
  const baseSamples = basePoints.map((point, index) => ({
    t: index / (basePoints.length - 1),
    point,
  }));
  const affectedSamples = affectedPoints.map((point, index) => ({
    t: index / (affectedPoints.length - 1),
    point,
    basePoint: basePoints[index],
    pointDelta: pointDistance(basePoints[index], point),
  }));
  const role = assemblage.apertureOrbitCapture || assemblage.macroPromotedBody?.apertureOrbitCapture || null;
  const deltaMetrics = lawImpactPointDeltaMetrics(basePoints, affectedPoints);
  return {
    schema: 'MacroLawImpactCurveDecomposition',
    mode: 'base-promoted-vs-aperture-orbit-affected-centerline-v0',
    id: `${assemblage.id}-law-impact-curve`,
    parentAssemblage: assemblage.id,
    generationStage: 'post-promotion-rule-impact-centerline',
    ruleFamily: 'ApertureOrbitCaptureLaw',
    activeRuleId: role?.id || null,
    apertureOrbitCaptureControlStrength: role?.controlStrength ?? 0,
    basePromotedCurve: {
      schema: 'MacroLawImpactCurveStage',
      stage: 'post-promotion-before-aperture-orbit-capture',
      sampleCount,
      samples: baseSamples,
    },
    apertureOrbitCaptureCurve: {
      schema: 'MacroLawImpactCurveStage',
      stage: 'post-promotion-after-aperture-orbit-capture',
      visualOverlayId: `${assemblage.id}-aperture-orbit-law-impact-curve-line`,
      sampleCount,
      samples: affectedSamples,
    },
    apertureOrbitCaptureDeltaMetrics: deltaMetrics,
    visualIntent: 'show whether aperture orbit capture bends the source curve into a crimp before mesh sidewalls are involved',
  };
}

function createMacroLawOrbitDisplacementVectors(lawImpactCurve, stride = 6) {
  const affectedSamples = lawImpactCurve?.apertureOrbitCaptureCurve?.samples || [];
  const vectors = [];
  for (let index = 0; index < affectedSamples.length; index += stride) {
    const sample = affectedSamples[index];
    if (!sample?.basePoint || !sample?.point) continue;
    const length = pointDistance(sample.basePoint, sample.point);
    if (length < 1e-5) continue;
    vectors.push({
      schema: 'MacroLawOrbitDisplacementVector',
      mode: 'pre-to-post-aperture-orbit-centerline-delta-v0',
      id: `${lawImpactCurve.parentAssemblage}-orbit-displacement-vector-${String(index).padStart(2, '0')}`,
      parentAssemblage: lawImpactCurve.parentAssemblage,
      lawImpactCurveId: lawImpactCurve.id,
      t: sample.t,
      startPoint: sample.basePoint,
      endPoint: sample.point,
      length,
      visualOverlayId: `${lawImpactCurve.parentAssemblage}-orbit-displacement-vector-${String(index).padStart(2, '0')}`,
    });
  }
  return vectors;
}

function capEnvelopeRailSamples(assemblage, sideSign, capWidthScale, sampleCount = 48, radius = 1.045) {
  const body = assemblage.territoryBodyOccupancy;
  const promoted = assemblage.macroPromotedBody;
  const cutProfile = body.boundaryCutProfile || [];
  const centerline = macroPromotedBodyCenterlinePoints(assemblage, sampleCount, radius);
  return centerline.map((center, index) => {
    const t = index / (sampleCount - 1);
    const prev = centerline[Math.max(0, index - 1)];
    const next = centerline[Math.min(sampleCount - 1, index + 1)];
    const normal = normalizePoint(center);
    const tangent = normalizePoint(subtractPoints(next, prev));
    let side = normalizePoint(crossPoints(normal, tangent));
    if (Math.hypot(...side) < 1e-8) side = [1, 0, 0];
    const frame = torsionSurfaceFramePoints(assemblage, side, normal, t, 1);
    const profile = Math.pow(Math.sin(Math.PI * t), 0.34);
    const terminalScale = 0.52 + 0.48 * profile;
    const nearestCut = nearestCutProfileSample(cutProfile, t);
    const expanded = assemblage.expandedRegionProxy;
    const scale = (promoted?.promotedBodyScale || 1.22) * (expanded?.coverageScale || 1);
    const interlock = macroInterlockEffectAt(assemblage, t);
    const lowerSocket = lowerSocketAnatomyEffectAt(assemblage, t);
    const sharedSeam = sharedSocketSeamEffectAt(assemblage, t);
    const roleEffect = lowerSocketFamilyRoleEffectAt(assemblage, t);
    const nonCapWidthScale = interlock.widthScale * lowerSocket.widthScale * sharedSeam.widthScale * roleEffect.widthScale;
    const sideName = sideSign < 0 ? 'left' : 'right';
    const sideWidth = body.widthProfile.mid
      * scale
      * terminalScale
      * promotedBodySideScale(promoted, sideName, nearestCut)
      * nonCapWidthScale
      * capWidthScale;
    const lift = body.thicknessProfile.mid * (0.85 + 0.75 * profile)
      + interlock.normalLiftDelta
      + lowerSocket.normalLiftDelta
      + sharedSeam.normalLiftDelta
      + roleEffect.normalLiftDelta;
    const point = addScaledPoint(
      addScaledPoint(center, frame.side, sideSign * sideWidth),
      frame.normal,
      lift * 0.82,
    );
    return {
      t,
      point,
      centerPoint: center,
      side: sideName,
      sideWidth,
      capWidthScale,
    };
  });
}

function createMacroLawCapEnvelopeRails(assemblage, sampleCount = 48, radius = 1.045) {
  const curvatureCap = curvatureWidthCapEffectAt(assemblage);
  const capScale = curvatureCap.capApplied ? curvatureCap.widthScale : 1;
  const rails = [];
  for (const [sideName, sideSign] of [['left', -1], ['right', 1]]) {
    rails.push({
      schema: 'MacroLawCapEnvelopeRail',
      mode: 'curvature-width-cap-envelope-rail-v0',
      id: `${assemblage.id}-${sideName}-pre-cap-envelope-rail`,
      parentAssemblage: assemblage.id,
      ruleFamily: 'CurvatureWidthCapLaw',
      activeRuleId: curvatureCap.lawId,
      stage: 'pre-cap-envelope',
      side: sideName,
      capApplied: false,
      capWidthScale: 1,
      visualOverlayId: `${assemblage.id}-${sideName}-pre-cap-envelope-rail`,
      samples: capEnvelopeRailSamples(assemblage, sideSign, 1, sampleCount, radius),
    });
    rails.push({
      schema: 'MacroLawCapEnvelopeRail',
      mode: 'curvature-width-cap-envelope-rail-v0',
      id: `${assemblage.id}-${sideName}-post-cap-envelope-rail`,
      parentAssemblage: assemblage.id,
      ruleFamily: 'CurvatureWidthCapLaw',
      activeRuleId: curvatureCap.lawId,
      stage: 'post-cap-envelope',
      side: sideName,
      capApplied: curvatureCap.capApplied,
      capWidthScale: capScale,
      visualOverlayId: `${assemblage.id}-${sideName}-post-cap-envelope-rail`,
      samples: capEnvelopeRailSamples(assemblage, sideSign, capScale, sampleCount, radius),
    });
  }
  return rails;
}

function capEnvelopeDeltaMetrics(rails) {
  let maxRailDelta = 0;
  let meanRailDelta = 0;
  let deltaCount = 0;
  for (const side of ['left', 'right']) {
    const pre = rails.find(rail => rail.side === side && rail.stage === 'pre-cap-envelope');
    const post = rails.find(rail => rail.side === side && rail.stage === 'post-cap-envelope');
    const count = Math.min(pre?.samples?.length || 0, post?.samples?.length || 0);
    for (let index = 0; index < count; index++) {
      const delta = pointDistance(pre.samples[index].point, post.samples[index].point);
      maxRailDelta = Math.max(maxRailDelta, delta);
      meanRailDelta += delta;
      deltaCount += 1;
    }
  }
  return {
    schema: 'MacroLawCapEnvelopeDeltaMetrics',
    mode: 'pre-vs-post-curvature-width-cap-rail-delta-v0',
    sampleCount: deltaCount,
    maxRailDelta,
    meanRailDelta: deltaCount ? meanRailDelta / deltaCount : 0,
  };
}

function createMacroLawDebugDecomposition(assemblage, lawImpactCurve) {
  const orbitDisplacementVectors = createMacroLawOrbitDisplacementVectors(lawImpactCurve);
  const capEnvelopeRails = createMacroLawCapEnvelopeRails(assemblage);
  return {
    schema: 'MacroLawDebugDecomposition',
    mode: 'law-specific-visual-predicates-v0',
    id: `${assemblage.id}-law-debug-decomposition`,
    parentAssemblage: assemblage.id,
    lawImpactCurveId: lawImpactCurve?.id || null,
    debugFamilies: [
      'orbit-delta',
      'cap-envelope',
    ],
    orbitDisplacementVectors,
    orbitDisplacementVectorCount: orbitDisplacementVectors.length,
    capEnvelopeRails,
    capEnvelopeRailCount: capEnvelopeRails.length,
    capEnvelopeDeltaMetrics: capEnvelopeDeltaMetrics(capEnvelopeRails),
    visualIntent: 'separate displacement laws from envelope laws so toggles change the correct diagnostic surface',
  };
}

function triangleCircumradius(a, b, c) {
  const ab = pointDistance(a, b);
  const bc = pointDistance(b, c);
  const ca = pointDistance(c, a);
  const cross = crossPoints(subtractPoints(b, a), subtractPoints(c, a));
  const doubleArea = Math.hypot(...cross);
  if (doubleArea < 1e-8 || ab < 1e-8 || bc < 1e-8 || ca < 1e-8) return Infinity;
  return (ab * bc * ca) / (2 * doubleArea);
}

function curveMorphologyMetrics(points) {
  const finitePoints = (points || []).filter(point => (
    Array.isArray(point)
    && point.length === 3
    && point.every(Number.isFinite)
  ));
  if (finitePoints.length < 3) {
    return {
      schema: 'MacroCurveMorphologyMetrics',
      sampleCount: finitePoints.length,
      length: 0,
      chordLength: 0,
      lateralChordRatio: 0,
      maxTurnAngle: 0,
      meanTurnAngle: 0,
      turnEnergy: 0,
      estimatedInflectionCount: 0,
      minimumCurvatureRadius: Infinity,
      maximumCurvature: 0,
    };
  }
  let length = 0;
  for (let index = 1; index < finitePoints.length; index++) {
    length += pointDistance(finitePoints[index - 1], finitePoints[index]);
  }
  const start = finitePoints[0];
  const end = finitePoints[finitePoints.length - 1];
  const chordLength = Math.max(1e-6, pointDistance(start, end));
  const axis = normalizePoint(subtractPoints(end, start));
  const lateralDistances = finitePoints.map(point => {
    const relative = subtractPoints(point, start);
    const progress = dotPoints(relative, axis);
    const projected = addScaledPoint(start, axis, progress);
    return pointDistance(point, projected);
  });
  const turnAngles = [];
  const signedTurns = [];
  const referenceNormal = normalizePoint(addPoints(start, end));
  for (let index = 1; index < finitePoints.length - 1; index++) {
    const previous = normalizePoint(subtractPoints(finitePoints[index], finitePoints[index - 1]));
    const next = normalizePoint(subtractPoints(finitePoints[index + 1], finitePoints[index]));
    const dot = clamp(dotPoints(previous, next), -1, 1);
    const angle = Math.acos(dot);
    turnAngles.push(angle);
    const turnNormal = crossPoints(previous, next);
    const signed = dotPoints(turnNormal, referenceNormal);
    if (Math.abs(signed) > 1e-5) signedTurns.push(Math.sign(signed));
  }
  let estimatedInflectionCount = 0;
  for (let index = 1; index < signedTurns.length; index++) {
    if (signedTurns[index] !== signedTurns[index - 1]) estimatedInflectionCount += 1;
  }
  const turnEnergy = turnAngles.reduce((sum, angle) => sum + Math.abs(angle), 0);
  const maxTurnAngle = Math.max(0, ...turnAngles);
  const curvatureRadii = [];
  for (let index = 1; index < finitePoints.length - 1; index++) {
    const radius = triangleCircumradius(finitePoints[index - 1], finitePoints[index], finitePoints[index + 1]);
    if (Number.isFinite(radius)) curvatureRadii.push(radius);
  }
  const minimumCurvatureRadius = curvatureRadii.length ? Math.min(...curvatureRadii) : Infinity;
  return {
    schema: 'MacroCurveMorphologyMetrics',
    sampleCount: finitePoints.length,
    length,
    chordLength,
    lengthToChordRatio: length / chordLength,
    maxLateralChordDistance: Math.max(...lateralDistances),
    meanLateralChordDistance: lateralDistances.reduce((sum, value) => sum + value, 0) / lateralDistances.length,
    lateralChordRatio: Math.max(...lateralDistances) / chordLength,
    maxTurnAngle,
    meanTurnAngle: turnAngles.length ? turnEnergy / turnAngles.length : 0,
    turnEnergy,
    estimatedInflectionCount,
    minimumCurvatureRadius,
    maximumCurvature: Number.isFinite(minimumCurvatureRadius) && minimumCurvatureRadius > 0
      ? 1 / minimumCurvatureRadius
      : 0,
  };
}

function createCurvatureWidthCapLaw(assemblage, controls = {}) {
  const earlySphereCurve = createMacroSphereCurveDecomposition(assemblage);
  const sourceCurveMetrics = curveMorphologyMetrics(earlySphereCurve.samples.map(sample => sample.point));
  const body = assemblage.territoryBodyOccupancy;
  const promoted = assemblage.macroPromotedBody;
  const expanded = assemblage.expandedRegionProxy;
  const curvatureRadiusWidthRatio = 0.22;
  const controlStrength = normalizedUnit(controls.strength, 1);
  const uncappedPeakSideWidth = (body?.widthProfile?.mid || 0.16)
    * (promoted?.promotedBodyScale || 1.22)
    * (expanded?.coverageScale || 1);
  const minimumCurvatureRadius = sourceCurveMetrics.minimumCurvatureRadius;
  const curvatureLimitedSideWidth = Number.isFinite(minimumCurvatureRadius)
    ? minimumCurvatureRadius * curvatureRadiusWidthRatio
    : uncappedPeakSideWidth;
  const fullyCappedSideWidth = Math.min(uncappedPeakSideWidth, curvatureLimitedSideWidth);
  const maxSideWidth = uncappedPeakSideWidth + (fullyCappedSideWidth - uncappedPeakSideWidth) * controlStrength;
  const widthScale = uncappedPeakSideWidth > 1e-6
    ? clamp(maxSideWidth / uncappedPeakSideWidth, 0, 1)
    : 1;
  return {
    schema: 'CurvatureWidthCapLaw',
    mode: 'macrostrip-width-limited-by-source-curve-curvature-v0',
    sourceStage: 'post-variation-pre-promotion-sphere-line',
    parentAssemblage: assemblage.id,
    sourceCurveId: earlySphereCurve.id,
    curvatureRadiusWidthRatio,
    minimumCurvatureRadius,
    maximumCurvature: sourceCurveMetrics.maximumCurvature,
    uncappedPeakSideWidth,
    curvatureLimitedSideWidth,
    fullyCappedSideWidth,
    maxSideWidth,
    widthScale,
    controlStrength,
    capApplied: controlStrength > 0 && widthScale < 0.995,
    visualIntent: 'prevent a wide promoted macrostrip from crimping across a tighter source curve than it can physically carry',
  };
}

function attachCurvatureWidthCapLaws(composition, controls = composition.lawControls?.curvatureWidthCap) {
  for (const assemblage of composition.macroAssemblages || []) {
    if (!assemblage.macroPromotedBody) continue;
    const law = createCurvatureWidthCapLaw(assemblage, controls || {});
    assemblage.curvatureWidthCapLaw = law;
    assemblage.macroPromotedBody.curvatureWidthCapLaw = law;
  }
  return composition;
}

function aggregateSideWallMetrics(sideWalls) {
  const metrics = (sideWalls || []).map(wall => ({
    sideWallId: wall.id,
    targetEdge: wall.targetEdge,
    metrics: curveMorphologyMetrics((wall.outerSurfaceEdge || []).map(sample => sample.point)),
  }));
  return {
    schema: 'MacroSideWallMorphologyMetrics',
    sideWallCount: metrics.length,
    maxTurnAngle: Math.max(0, ...metrics.map(record => record.metrics.maxTurnAngle)),
    maxLateralChordRatio: Math.max(0, ...metrics.map(record => record.metrics.lateralChordRatio)),
    maxTurnEnergy: Math.max(0, ...metrics.map(record => record.metrics.turnEnergy)),
    sideWalls: metrics,
  };
}

function aggregateSubstripMetrics(substrips) {
  const metrics = (substrips || []).map(substrip => {
    const points = (substrip.edgeSamples || []).map(sample => lerpPoint(sample.leftEdge, sample.rightEdge, 0.5));
    return {
      substripId: substrip.id,
      role: substrip.role,
      metrics: curveMorphologyMetrics(points),
    };
  });
  return {
    schema: 'MacroSubstripMorphologyMetrics',
    substripCount: metrics.length,
    maxTurnAngle: Math.max(0, ...metrics.map(record => record.metrics.maxTurnAngle)),
    maxLateralChordRatio: Math.max(0, ...metrics.map(record => record.metrics.lateralChordRatio)),
    maxTurnEnergy: Math.max(0, ...metrics.map(record => record.metrics.turnEnergy)),
    substrips: metrics,
  };
}

function createMacroMorphologyInventoryRecord(composition, assemblage) {
  const retiredParentIds = composition.macroFamilySubstripPlan?.visibleParentRetirementPolicy?.retiredParentAssemblageIds || [];
  const sideWalls = (composition.liveMacroSideWallPlan?.sideWalls || []).filter(wall => wall.parentAssemblage === assemblage.id);
  const substrips = (composition.macroFamilySubstripPlan?.substrips || []).filter(strip => strip.parentAssemblage === assemblage.id);
  const earlySphereCurve = createMacroSphereCurveDecomposition(assemblage);
  const lawImpactCurve = createMacroLawImpactCurveDecomposition(assemblage);
  const lawDebugDecomposition = createMacroLawDebugDecomposition(assemblage, lawImpactCurve);
  const promotedPoints = macroPromotedBodyCenterlinePoints(assemblage, 48, 1.045);
  const promotedCenterline = {
    schema: 'MacroPromotedCenterlineDecomposition',
    mode: ORB_SHELL_MACRO_MORPHOLOGY_INVENTORY_MODE,
    id: `${assemblage.id}-promoted-centerline`,
    parentAssemblage: assemblage.id,
    generationStage: 'post-promotion-post-anatomy-centerline',
    sampleCount: promotedPoints.length,
    samples: promotedPoints.map((point, index) => ({ t: index / (promotedPoints.length - 1), point })),
  };
  const sourceCurveMetrics = curveMorphologyMetrics(earlySphereCurve.samples.map(sample => sample.point));
  const promotedCenterlineMetrics = curveMorphologyMetrics(promotedPoints);
  const sideWallMetrics = aggregateSideWallMetrics(sideWalls);
  const substripFamilyMetrics = aggregateSubstripMetrics(substrips);
  const curvatureWidthCapLaw = assemblage.macroPromotedBody?.curvatureWidthCapLaw || assemblage.curvatureWidthCapLaw || null;
  const renderClassComparison = retiredParentIds.includes(assemblage.id) && substrips.length
    ? 'parent-owned-substrip-family'
    : retiredParentIds.includes(assemblage.id)
      ? 'retired-or-support-body'
      : 'direct-wide-promoted-body';
  const pathologyClasses = [];
  if (sourceCurveMetrics.lateralChordRatio > 0.16 || sourceCurveMetrics.maxTurnAngle > 0.32) {
    pathologyClasses.push('source-curve-high-curvature-risk');
  }
  if (
    promotedCenterlineMetrics.lateralChordRatio > Math.max(0.12, sourceCurveMetrics.lateralChordRatio + 0.04)
    || promotedCenterlineMetrics.maxTurnAngle > Math.max(0.34, sourceCurveMetrics.maxTurnAngle + 0.1)
  ) {
    pathologyClasses.push('wide-body-squiggle-risk');
  }
  if (
    sideWallMetrics.maxTurnAngle > promotedCenterlineMetrics.maxTurnAngle + 0.12
    || sideWallMetrics.maxLateralChordRatio > promotedCenterlineMetrics.lateralChordRatio + 0.045
  ) {
    pathologyClasses.push('sidewall-frame-crease-risk');
  }
  if (renderClassComparison === 'parent-owned-substrip-family' && substrips.length >= 2) {
    pathologyClasses.push('strip-family-visually-forgiving');
  }
  if (curvatureWidthCapLaw?.capApplied) {
    pathologyClasses.push('curvature-width-cap-applied');
  }
  if (assemblage.id === 'lower-socket-keel') {
    pathologyClasses.push('wandering-s-hook-visible-offender');
  }
  return {
    schema: 'MacroMorphologyInventoryRecord',
    mode: ORB_SHELL_MACRO_MORPHOLOGY_INVENTORY_MODE,
    id: `${assemblage.id}-morphology-record`,
    parentAssemblage: assemblage.id,
    role: assemblage.role,
    renderClassComparison,
    earlySphereCurve,
    lawImpactCurve,
    lawDebugDecomposition,
    promotedCenterline,
    sourceCurveMetrics,
    promotedCenterlineMetrics,
    sideWallMetrics,
    substripFamilyMetrics,
    curvatureWidthCapLaw,
    pathologyClasses: [...new Set(pathologyClasses)],
    diagnosticQuestion: [
      assemblage.id === 'lower-socket-keel'
        ? 'is the lower-socket squiggle born in the source curve or promoted later'
        : 'does this macro stay clean as a source curve before promotion',
      substrips.length
        ? 'does substrip decomposition hide or solve wide-body curvature pressure'
        : 'does the wide promoted body carry visible curvature honestly',
      'which stage should own the next repair',
    ],
  };
}

function createMacroMorphologyInventory(composition) {
  const records = composition.macroAssemblages.map(assemblage => (
    createMacroMorphologyInventoryRecord(composition, assemblage)
  ));
  const pathologyClassCounts = {};
  for (const record of records) {
    for (const pathologyClass of record.pathologyClasses) {
      pathologyClassCounts[pathologyClass] = (pathologyClassCounts[pathologyClass] || 0) + 1;
    }
  }
  return {
    schema: 'OrbShellMorphologyInventory',
    mode: ORB_SHELL_MACRO_MORPHOLOGY_INVENTORY_MODE,
    visualDecompositionMode: 'source-curve-plus-law-impact-curve',
    referenceSphereRadius: 1.045,
    sourceStage: 'post-variation-pre-promotion-sphere-line',
    comparedStages: [
      'post-variation-pre-promotion-sphere-line',
      'post-promotion-before-aperture-orbit-capture',
      'post-promotion-after-aperture-orbit-capture',
      'post-promotion-post-anatomy-centerline',
      'live-sidewall-outer-edges',
      'parent-owned-substrip-centerlines',
    ],
    records,
    recordCount: records.length,
    curveDecompositions: records.map(record => record.earlySphereCurve),
    lawImpactCurveDecompositions: records.map(record => record.lawImpactCurve),
    lawDebugDecompositions: records.map(record => record.lawDebugDecomposition),
    pathologyClassCounts,
    failurePressure: [
      'do-not-spot-fix-lower-socket-before-source-curve-inventory',
      'do-not-treat-decomposed-family-visual-success-as-wide-body-success',
      'do-not-let-materials-or-sidewalls-stand-in-for-source-curve-coherence',
    ],
    diagnosticVerdict: 'morphology-inventory-before-next-geometry-repair',
  };
}

function countBy(records, field) {
  const counts = {};
  for (const record of records || []) {
    const key = record?.[field] || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function compactProceduralArchitectureInventory(inventory) {
  if (!inventory) return null;
  return {
    schema: inventory.schema,
    mode: inventory.mode,
    stressCaseId: inventory.stressCaseId,
    activeRepairPosture: inventory.activeRepairPosture,
    visualDecompositionMode: inventory.visualDecompositionMode,
    recordCount: inventory.recordCount,
    layerCounts: inventory.layerCounts,
    semanticClassCounts: inventory.semanticClassCounts,
    sourceStageCounts: inventory.sourceStageCounts,
    externalRouteXrayCount: inventory.externalRouteXrayCount,
    externalRouteXrays: (inventory.externalRouteXrays || []).map(xray => ({
      id: xray.id,
      schema: xray.schema,
      mode: xray.mode,
      sourceDiaulos: xray.sourceDiaulos,
      routeIdentity: xray.routeIdentity,
      yieldingContract: xray.yieldingContract,
      positiveSmokeEvidence: xray.positiveSmokeEvidence,
      evidenceBoundary: xray.evidenceBoundary,
      sourceReceipts: xray.sourceReceipts,
    })),
    unresolvedArchitectureQuestions: inventory.unresolvedArchitectureQuestions,
    diagnosticVerdict: inventory.diagnosticVerdict,
    records: (inventory.records || []).map(record => ({
      id: record.id,
      parentAssemblage: record.parentAssemblage,
      semanticRole: record.semanticRole,
      semanticClass: record.semanticClass,
      objectLayer: record.objectLayer,
      sourceCurve: record.sourceCurve ? {
        id: record.sourceCurve.id,
        sourceCurveId: record.sourceCurve.sourceCurveId,
        stage: record.sourceCurve.stage,
        proceduralFamily: record.sourceCurve.proceduralFamily,
        impulseLine: record.sourceCurve.impulseLine,
        sampleCount: record.sourceCurve.sampleCount,
        visualOverlayId: record.sourceCurve.visualOverlayId,
      } : null,
      territory: record.territory ? {
        id: record.territory.id,
        territoryId: record.territory.territoryId,
        source: record.territory.source,
        bodyOccupancyId: record.territory.bodyOccupancyId,
        boundaryPressureFieldId: record.territory.boundaryPressureFieldId,
      } : null,
      widthProfile: record.widthProfile ? {
        id: record.widthProfile.id,
        source: record.widthProfile.source,
        laneOffset: record.widthProfile.laneOffset ?? null,
        widthScale: record.widthProfile.widthScale ?? null,
        curvatureWidthCapId: record.widthProfile.curvatureWidthCapId ?? null,
      } : null,
      terminal: record.terminal,
      receiverRelation: record.receiverRelation,
      meshDerivation: record.meshDerivation,
      localMorphologyTuningAllowed: record.localMorphologyTuningAllowed,
      failureClasses: record.failureClasses,
      pathologyClasses: record.pathologyClasses,
      diagnosticQuestions: record.diagnosticQuestions,
    })),
  };
}

function architectureTerminalRole(composition, parentAssemblage) {
  const apertureRole = composition.apertureOrbitCaptureLaw?.terminalRoles?.find(role => (
    role.parentAssemblage === parentAssemblage
    || role.macroId === parentAssemblage
    || role.sourceMacroId === parentAssemblage
  ));
  return apertureRole || null;
}

function architectureSourceCurveRef(morphologyRecord, assemblage) {
  const curve = morphologyRecord?.earlySphereCurve || createMacroSphereCurveDecomposition(assemblage);
  return {
    id: curve.id,
    sourceCurveId: curve.id,
    stage: curve.generationStage,
    proceduralFamily: curve.sourceControl?.proceduralFamily || assemblage?.spine?.proceduralFamily || null,
    impulseLine: curve.sourceControl?.impulseLine || assemblage?.spine?.impulseLine || null,
    sampleCount: curve.sampleCount,
    visualOverlayId: curve.visualOverlayId,
  };
}

function architectureTerritoryRef(assemblage) {
  const territory = assemblage?.sphericalTerritory || {};
  return {
    id: `${assemblage.id}-spherical-territory`,
    territoryId: `${assemblage.id}-spherical-territory`,
    source: 'sphericalTerritory',
    centerPhase: territory.centerPhase,
    angularWidth: territory.angularWidth,
    bodyOccupancyId: assemblage?.territoryBodyOccupancy?.id || null,
    boundaryPressureFieldId: assemblage?.territoryBodyOccupancy?.boundaryPressureField?.id || null,
  };
}

function architectureWidthProfileRef(assemblage, source = 'territoryBodyOccupancy.widthProfile') {
  const profile = assemblage?.territoryBodyOccupancy?.widthProfile || {};
  return {
    id: `${assemblage.id}-width-profile`,
    source,
    start: profile.start ?? null,
    mid: profile.mid ?? null,
    end: profile.end ?? null,
    curvatureWidthCapId: assemblage?.curvatureWidthCapLaw?.sourceCurveId || assemblage?.macroPromotedBody?.curvatureWidthCapLaw?.sourceCurveId || null,
  };
}

function createMacroFamilyArchitectureRecord(composition, assemblage) {
  const morphologyRecord = composition.macroMorphologyInventory?.records?.find(record => record.parentAssemblage === assemblage.id);
  const terminalRole = architectureTerminalRole(composition, assemblage.id);
  return {
    schema: 'ProceduralArchitectureInventoryRecord',
    mode: ORB_SHELL_PROCEDURAL_ARCHITECTURE_INVENTORY_MODE,
    id: `${assemblage.id}-macro-family-architecture-record`,
    parentAssemblage: assemblage.id,
    semanticRole: assemblage.role || 'macro-shell-family',
    semanticClass: 'macro-family',
    objectLayer: 'semantic-object',
    sourceCurve: architectureSourceCurveRef(morphologyRecord, assemblage),
    territory: architectureTerritoryRef(assemblage),
    widthProfile: architectureWidthProfileRef(assemblage),
    terminal: {
      mode: terminalRole?.terminalMode || terminalRole?.terminationMode || 'macro-family-terminal-role-pending',
      roleId: terminalRole?.id || null,
      apertureRelation: terminalRole?.apertureRelation || terminalRole?.role || null,
    },
    receiverRelation: {
      mode: assemblage.id === 'lower-socket-keel'
        ? 'receiver-required-but-not-owned'
        : terminalRole?.receiverRelation || 'not-required-or-not-yet-measured',
      receiverId: terminalRole?.receiverId || null,
    },
    meshDerivation: {
      mode: morphologyRecord?.renderClassComparison || 'direct-wide-promoted-body',
      promotedBodyId: assemblage.macroPromotedBody?.id || null,
      localTuningAllowed: assemblage.id !== 'lower-socket-keel',
    },
    localMorphologyTuningAllowed: assemblage.id !== 'lower-socket-keel',
    pathologyClasses: morphologyRecord?.pathologyClasses || [],
    diagnosticQuestions: [
      assemblage.id === 'lower-socket-keel'
        ? 'is the lower-socket failure born in source curve, width profile, terminal law, receiver law, or mesh derivation'
        : 'which layer owns this macro family before mesh promotion',
      'can this visible form be explained without inspecting final material shading',
    ],
  };
}

function createSubstripArchitectureRecord(composition, substrip) {
  const assemblage = composition.macroAssemblages.find(item => item.id === substrip.parentAssemblage);
  const morphologyRecord = composition.macroMorphologyInventory?.records?.find(record => record.parentAssemblage === substrip.parentAssemblage);
  return {
    schema: 'ProceduralArchitectureInventoryRecord',
    mode: ORB_SHELL_PROCEDURAL_ARCHITECTURE_INVENTORY_MODE,
    id: `${substrip.id}-architecture-record`,
    parentAssemblage: substrip.parentAssemblage,
    semanticRole: substrip.role || 'macro-family-substrip',
    semanticClass: 'macro-family-substrip',
    objectLayer: 'semantic-object',
    sourceCurve: architectureSourceCurveRef(morphologyRecord, assemblage),
    territory: architectureTerritoryRef(assemblage),
    widthProfile: {
      id: `${substrip.id}-width-profile`,
      source: 'macroFamilySubstripPlan.substrips.edgeSamples',
      laneOffset: substrip.laneOffset ?? null,
      widthScale: substrip.widthScale ?? null,
    },
    terminal: {
      mode: substrip.apertureAwareTerminus?.terminalMode || substrip.terminalMode || 'substrip-terminal-caps-derived',
      terminalCapCount: substrip.terminalCaps?.length || 0,
    },
    receiverRelation: {
      mode: substrip.apertureAwareTerminus?.receiverRelation || 'inherits-parent-aperture-field',
      receiverId: substrip.apertureAwareTerminus?.receiverId || null,
    },
    meshDerivation: {
      mode: 'parent-owned-substrip-family-mesh',
      sourcePlan: 'macroFamilySubstripPlan',
      localTuningAllowed: true,
    },
    localMorphologyTuningAllowed: true,
    pathologyClasses: [],
    diagnosticQuestions: [
      'does substrip decomposition solve a source law or merely hide wide-body failure',
    ],
  };
}

function createTerminalCapArchitectureRecord(composition, cap) {
  const assemblage = composition.macroAssemblages.find(item => item.id === cap.parentAssemblage);
  const morphologyRecord = composition.macroMorphologyInventory?.records?.find(record => record.parentAssemblage === cap.parentAssemblage);
  return {
    schema: 'ProceduralArchitectureInventoryRecord',
    mode: ORB_SHELL_PROCEDURAL_ARCHITECTURE_INVENTORY_MODE,
    id: `${cap.id}-architecture-record`,
    parentAssemblage: cap.parentAssemblage,
    semanticRole: cap.role || cap.capRole || 'live-terminal-cap',
    semanticClass: 'live-terminal-cap',
    objectLayer: 'render-artifact',
    sourceCurve: architectureSourceCurveRef(morphologyRecord, assemblage),
    territory: architectureTerritoryRef(assemblage),
    widthProfile: {
      id: `${cap.id}-cap-width-profile`,
      source: 'liveMacroSideWallPlan.terminalCaps',
      width: cap.width || cap.capWidth || null,
      terminalWidthScale: cap.terminalWidthScale ?? null,
    },
    terminal: {
      mode: cap.terminalCapAuthority || cap.terminalCapVisibilityPolicy || 'terminal-cap-derived-from-sidewall',
      visibilityPolicy: cap.terminalCapVisibilityPolicy || null,
      provisionalVisible: !!cap.provisionalSocketTongueVisible,
    },
    receiverRelation: {
      mode: cap.receiverOwnedTuckDisposition ? 'receiver-owned' : 'receiver-required-but-not-owned',
      receiverId: cap.receiverOwnedTuckDisposition?.receiverId || null,
      disposition: cap.receiverOwnedTuckDisposition || null,
    },
    meshDerivation: {
      mode: 'terminal-cap-render-artifact-from-live-sidewall',
      sourcePlan: 'liveMacroSideWallPlan.terminalCaps',
      localTuningAllowed: false,
    },
    localMorphologyTuningAllowed: false,
    pathologyClasses: cap.provisionalSocketTongueVisible ? ['provisional-terminal-evidence'] : [],
    diagnosticQuestions: [
      'is this cap a terminal semantic claim or merely a render closure artifact',
    ],
  };
}

function createSocketTongueStressArchitectureRecord(composition, candidate) {
  const assemblage = composition.macroAssemblages.find(item => item.id === candidate.parentAssemblage);
  const morphologyRecord = composition.macroMorphologyInventory?.records?.find(record => record.parentAssemblage === candidate.parentAssemblage);
  return {
    schema: 'ProceduralArchitectureInventoryRecord',
    mode: ORB_SHELL_PROCEDURAL_ARCHITECTURE_INVENTORY_MODE,
    id: `${candidate.id}-architecture-record`,
    parentAssemblage: candidate.parentAssemblage,
    semanticRole: 'provisional lower-socket tongue stress case',
    semanticClass: 'provisional-socket-tongue-stress-case',
    objectLayer: 'semantic-object',
    sourceCurve: architectureSourceCurveRef(morphologyRecord, assemblage),
    territory: architectureTerritoryRef(assemblage),
    widthProfile: {
      id: `${candidate.id}-stress-width-profile`,
      source: 'socketTongueProvenancePlan.candidates.anatomyMetrics',
      meanSideWallThickness: candidate.anatomyMetrics?.meanSideWallThickness ?? null,
      endCapWidthExpansionRatio: candidate.anatomyMetrics?.endCapWidthExpansionRatio ?? null,
    },
    terminal: {
      mode: 'provisional-visible-until-receiver-owned-tuck',
      protectedTerminalCapIds: candidate.protectedTerminalCapIds || [],
      provisionalVisibleTerminalCapIds: candidate.provisionalVisibleTerminalCapIds || [],
    },
    receiverRelation: {
      mode: 'receiver-required-but-not-owned',
      receiverId: null,
      disposition: null,
    },
    meshDerivation: {
      mode: 'stress-case-derived-from-promoted-body-sidewalls-and-provisional-caps',
      sourcePath: candidate.sourcePath,
      localTuningAllowed: false,
    },
    localMorphologyTuningAllowed: false,
    failureClasses: [
      'downstream-constraint-soup-risk',
      'local-morphology-loop-demoted',
    ],
    pathologyClasses: [
      'downstream-constraint-soup-risk',
      'local-morphology-loop-demoted',
    ],
    diagnosticQuestions: [
      'which layer owns lower-socket tongue repair',
      'is the visible appendage born from curve law, terminal law, receiver law, or render closure',
    ],
  };
}

function createCranialYieldingRouteXray() {
  return {
    schema: 'ExternalYieldingRouteXray',
    mode: 'cranial-phase-program-yielding-route-xray-v0',
    id: 'cranial-depth-enema-yielding-route-xray',
    sourceDiaulos: 'cranial-depth-enema',
    sourceReceipts: [
      'webgpu-kit-phase-program-019-landed-2026-07-05',
      'cranial-webgpu-kit-phase-program-landing-2026-07-05',
      'cranial-sharp-vit-block-chunking-2026-07-05',
      'cranial-sharp-vit2-positive-smoke-rerun-2026-07-05',
      'cranial-sharp-vit2-contention-failure-2026-07-05',
    ],
    routeIdentity: {
      package: '@kaminos/webgpu-inference-kit',
      packageVersion: '0.1.9',
      mainCommit: '874ac000d57e865ef500f2f84a3110c2014e4008',
      phaseProgramSchema: 'kaminos.webgpu-phase-program.v0',
      phaseProgramRunSchema: 'kaminos.webgpu-phase-program-run.v0',
      schedulerVerificationReceiptSchema: 'kaminos.webgpu-scheduler-verification-receipt.v0',
      sharpRouteId: 'sharp.image-to-splat.webgpu-local.v0',
      sharpVitBlockChunkCommit: '614e42f444fe0a8782e5f7e585465f7fb2a32019',
    },
    localSubstrate: {
      packagePath: 'webgpu-inference-kit/src/index.js',
      packageVersion: '0.1.9',
      functionAvailability: {
        defineWebGpuPhaseProgram: 'function',
        runWebGpuPhaseProgram: 'function',
        createCooperativeYield: 'function',
      },
    },
    yieldingContract: {
      primitive: 'createCooperativeYield',
      phaseProgramFields: [
        'phase.yieldAfter',
        'phase.yieldReason',
        'yieldPolicy.afterEachKernel',
      ],
      schedulerFields: [
        'phaseChunkSize.vitBlock',
        'vitBlockChunkSize',
        'phaseChunkSize.spnPatch',
        'spnPatchChunkSize',
      ],
      observedBoundaries: [
        'vit-block-chunk',
        'queue-work-done-start',
        'queue-work-done-end',
        'yield-start',
        'yield-end',
      ],
      routeStageBoundary: 'phase-edge-yield-after-kernel-or-readback',
    },
    positiveSmokeEvidence: {
      source: 'sharp-vit-block-chunking positive coherent-output smoke',
      routeEvidence: 'authoritative-live-webgpu',
      valid: 'OK',
      plyAvailable: true,
      gaussianCount: 1179648,
      schedulerVerificationState: 'verified',
      scheduler: {
        mode: 'cooperative',
        spnPatchChunkSize: 1,
        vitBlockChunkSize: 2,
        yieldMs: 0,
      },
      witness: '/tmp/sharp-vit2-positive-smoke-rerun.json',
    },
    evidenceBoundary: {
      contentionPastGaussianPostSpn: 'not-proven',
      accelerationClaim: 'not-claimed',
      lamellarGeometryImpact: 'diagnostic-substrate-only',
      currentUse: 'xray-route-identity-before-consumption',
      failureEvidence: 'contended full-route witness reached gaussian/post-SPN work then failed with Waiting failed',
    },
    xrayDisposition: 'local-substrate-visible-consumption-not-yet-integrated',
  };
}

function createProceduralArchitectureInventory(composition) {
  const records = [];
  for (const assemblage of composition.macroAssemblages || []) {
    records.push(createMacroFamilyArchitectureRecord(composition, assemblage));
  }
  for (const substrip of composition.macroFamilySubstripPlan?.substrips || []) {
    records.push(createSubstripArchitectureRecord(composition, substrip));
  }
  for (const cap of composition.liveMacroSideWallPlan?.terminalCaps || []) {
    records.push(createTerminalCapArchitectureRecord(composition, cap));
  }
  for (const candidate of composition.socketTongueProvenancePlan?.candidates || []) {
    if (candidate.id === 'lower-socket-keel-promoted-body-socket-tongue-candidate') {
      records.push(createSocketTongueStressArchitectureRecord(composition, candidate));
    }
  }
  const externalRouteXrays = [
    createCranialYieldingRouteXray(),
  ];
  return {
    schema: 'OrbShellProceduralArchitectureInventory',
    mode: ORB_SHELL_PROCEDURAL_ARCHITECTURE_INVENTORY_MODE,
    stressCaseId: 'lower-socket-keel-promoted-body-socket-tongue-candidate',
    activeRepairPosture: 'diagnose-upstream-laws-before-local-morphology-tuning',
    visualDecompositionMode: 'curve-first-semantic-objects-before-mesh-caps-materials',
    records,
    recordCount: records.length,
    externalRouteXrays,
    externalRouteXrayCount: externalRouteXrays.length,
    layerCounts: countBy(records, 'objectLayer'),
    semanticClassCounts: countBy(records, 'semanticClass'),
    sourceStageCounts: records.reduce((counts, record) => {
      const key = record.sourceCurve?.stage || 'unknown';
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {}),
    unresolvedArchitectureQuestions: [
      'which layer owns lower-socket tongue repair',
      'where do macro families stop being real objects and become implied territories',
      'which terminal modes are semantic laws versus render closures',
    ],
    diagnosticVerdict: 'architecture-inventory-before-next-morphology-edit',
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

function applyControlledAperturePressureVariation(composition, frontParameters) {
  for (const voidRecord of composition.AperturePressure.primaryVoids) {
    voidRecord.radius = [
      clamp(voidRecord.radius[0] * frontParameters.apertureBite, 0.26, 0.42),
      clamp(voidRecord.radius[1] * frontParameters.lowerCupDepth, 0.46, 0.68),
    ];
    voidRecord.effectiveVariation = {
      apertureBite: frontParameters.apertureBite,
      lowerCupDepth: frontParameters.lowerCupDepth,
    };
  }
}

export function applyControlledOrbShellVariation(composition, descriptor) {
  const next = clone(composition);
  next.lawControls = normalizeOrbShellLawControls(next.lawControls);
  next.controlledVariation = descriptor;
  next.effectiveVariation = descriptor;
  const macroParameters = descriptor.effectiveParameters.macroAssemblages;
  const frontParameters = descriptor.effectiveParameters.frontApertureOwnership;
  applyControlledAperturePressureVariation(next, frontParameters);
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
  next.apertureOrbitCaptureLaw = next.lawControls.apertureOrbitCapture.enabled
    ? createApertureOrbitCaptureLaw(next, next.lawControls.apertureOrbitCapture)
    : null;
  if (next.apertureOrbitCaptureLaw) attachApertureOrbitCaptureLaw(next);
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
  next.lowerSocketPlateBodyHonestyLaw = createLowerSocketPlateBodyHonestyLaw(next);
  attachLowerSocketPlateBodyHonestyLaw(next);
  next.lowerSocketPlateBodyHonestyVerdict = next.lowerSocketPlateBodyHonestyLaw
    ? 'lower-socket-visible-plate-body-preserved-before-tuck'
    : 'lower-socket-plate-body-honesty-law-not-active';
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
  if (next.lawControls.curvatureWidthCap.enabled) {
    attachCurvatureWidthCapLaws(next, next.lawControls.curvatureWidthCap);
  } else {
    for (const assemblage of next.macroAssemblages || []) {
      assemblage.curvatureWidthCapLaw = null;
      if (assemblage.macroPromotedBody) assemblage.macroPromotedBody.curvatureWidthCapLaw = null;
    }
  }
  next.macroContactMap = createMacroContactMap(next);
  next.liveMacroSideWallPlan = createLiveMacroSideWallPlan(next);
  next.macroFamilySubstripPlan = createMacroFamilySubstripPlan(next);
  next.channelThroughLineAudit = createChannelThroughLineAudit(next);
  next.channelThroughLinePlan = createChannelThroughLinePlan(next, next.channelThroughLineAudit);
  next.lamellarChannelMeshPlan = createLamellarChannelMeshPlan(next.channelThroughLinePlan);
  next.lamellarPlateBoundaryPlan = createLamellarPlateBoundaryPlan(next);
  next.lamellarInnerReturnPlan = createLamellarInnerReturnPlan(next);
  next.lowerSocketRenderInventoryPlan = createLowerSocketRenderInventoryPlan(next);
  next.socketTongueProvenancePlan = createSocketTongueProvenancePlan(next);
  next.apertureOrbitCaptureWitnessPlan = createApertureOrbitCaptureWitnessPlan(next);
  next.macroMorphologyInventory = createMacroMorphologyInventory(next);
  next.proceduralArchitectureInventory = createProceduralArchitectureInventory(next);
  next.frontApertureOwnership.effectiveVariation = frontParameters;
  for (const owner of next.frontApertureOwnership.owners) {
    owner.preservedByVariation = true;
    if (owner.role === 'lower-cupping-owner') owner.ownerDominance = frontParameters.ownerDominance;
    if (owner.role === 'crossing-tuck-owner') owner.crossingTuckPhase = frontParameters.crossingTuckPhase;
  }
  next.controlledVariation = descriptor;
  next.effectiveVariation = descriptor;
  return next;
}

export function createTargetOrbShellCompositionFixture(options = {}) {
  const controlledVariation = createControlledOrbShellVariationDescriptor(options);
  const lawControls = normalizeOrbShellLawControls(options.lawControls);
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
    lawControls,
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

function sampleSpinePoint(assemblage, bandMember, t, radius = 1.04, options = {}) {
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
  const point = spherePoint(lat, lon, radius + layerBias - interlock.depthInset - lowerSocket.radialInset + sharedSeam.radialDelta + roleEffect.radialDelta);
  return options.apertureOrbitCapture === false
    ? point
    : applyApertureOrbitCapturePoint(assemblage, t, point);
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
  const centerline = macroPromotedBodyCenterlinePoints(assemblage, rowCount, 1.045)
    .map(point => makeVec3(THREE, point));

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
    const curvatureCap = curvatureWidthCapEffectAt(assemblage);
    const widthScale = interlock.widthScale * lowerSocket.widthScale * sharedSeam.widthScale * roleEffect.widthScale * curvatureCap.widthScale;
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

function makeApertureOrbitLaneGeometry(THREE, lane, radius = 0.0055) {
  const points = [];
  for (let i = 0; i <= 144; i++) {
    const a = (i / 144) * TAU;
    points.push(new THREE.Vector3(...apertureOrbitLanePoint(lane, a)));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, true), 144, radius, 8, true);
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

function makeMacroSphereCurveLineGeometry(THREE, decomposition, radius = 0.0065) {
  const points = (decomposition.samples || []).map(sample => new THREE.Vector3(...sample.point));
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), Math.max(16, points.length * 2), radius, 8, false);
}

function makeMacroLawOrbitDisplacementVectorGeometry(THREE, vector, radius = 0.0034) {
  return new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(...vector.startPoint),
      new THREE.Vector3(...vector.endPoint),
    ]),
    1,
    radius,
    6,
    false,
  );
}

function makeMacroLawCapEnvelopeRailGeometry(THREE, rail, radius = 0.0038) {
  const points = (rail.samples || []).map(sample => new THREE.Vector3(...sample.point));
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), Math.max(16, points.length * 2), radius, 7, false);
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
  geometry.userData.ApertureAwareTerminus = cap.apertureAwareTerminus || null;
  geometry.userData.ApertureAwareTerminusRenderConsumer = cap.apertureAwareRenderConsumer || null;
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
  const apertureOrbitLaneMaterial = new THREE.MeshBasicMaterial({ color: 0x4fd3ff, transparent: true, opacity: 0.74, depthWrite: false, depthTest: false });
  const apertureOrbitTargetPointMaterial = new THREE.MeshBasicMaterial({ color: 0xfde74c, transparent: true, opacity: 0.98, depthWrite: false, depthTest: false });
  const apertureOrbitTargetTangentMaterial = new THREE.MeshBasicMaterial({ color: 0xff7a25, transparent: true, opacity: 0.98, depthWrite: false, depthTest: false });
  const macroContactIntersectMaterial = new THREE.MeshBasicMaterial({ color: 0xff3f5f, transparent: true, opacity: 0.96, depthWrite: false, depthTest: false });
  const macroContactNearMaterial = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false });
  const macroContactClearMaterial = new THREE.MeshBasicMaterial({ color: 0x63d7ff, transparent: true, opacity: 0.62, depthWrite: false, depthTest: false });
  const macroMorphologyReferenceSphereMaterial = new THREE.MeshBasicMaterial({ color: 0x1b3941, transparent: true, opacity: 0.18, wireframe: true, depthWrite: false });
  const macroMorphologyCleanCurveMaterial = new THREE.MeshBasicMaterial({ color: 0x63d7ff, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false });
  const macroMorphologyRiskCurveMaterial = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.98, depthWrite: false, depthTest: false });
  const macroMorphologyOffenderCurveMaterial = new THREE.MeshBasicMaterial({ color: 0xff4f7a, transparent: true, opacity: 1, depthWrite: false, depthTest: false });
  const macroMorphologySubstripCurveMaterial = new THREE.MeshBasicMaterial({ color: 0x9bc53d, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false });
  const macroMorphologyLawImpactCurveMaterial = new THREE.MeshBasicMaterial({ color: 0xff7a25, transparent: true, opacity: 0.98, depthWrite: false, depthTest: false });
  const macroMorphologyOrbitDeltaVectorMaterial = new THREE.MeshBasicMaterial({ color: 0xff4f7a, transparent: true, opacity: 0.98, depthWrite: false, depthTest: false });
  const macroMorphologyCapEnvelopeMaterial = new THREE.MeshBasicMaterial({ color: 0x63d7ff, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false });
  const macroMorphologyCapEnvelopePostMaterial = new THREE.MeshBasicMaterial({ color: 0xfde74c, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false });
  const spatialTruthMaterialPolicy = {
    schema: 'SpatialTruthMaterialPolicy',
    mode: 'env-lit-neutral-clay-spatial-truth-v1',
    materialClass: 'MeshStandardMaterial',
    diagnosticPasses: ['clay', 'normal', 'depth', 'object-id'],
    defaultDiagnosticPass: 'clay',
    environmentLit: true,
    ambientOcclusionDefault: false,
    roughness: 0.66,
    metalness: 0.0,
    envMapIntensity: 0.45,
    exposure: 0.9,
    color: '#737d80',
    witnessIntent: 'make-geometry-curvature-sidewalls-and-object-placement-legible-without-aesthetic-material-noise',
  };
  const spatialTruthViewSet = {
    schema: 'SpatialTruthViewSet',
    id: 'spatial-truth-default-v0',
    defaultViewId: 'front',
    views: [
      { id: 'front', label: 'Front', position: [0.28, 0.06, 3.28], target: [0.02, -0.05, 0.64] },
      { id: 'front-left', label: 'Front Left', position: [-1.18, 0.18, 2.78], target: [-0.18, -0.04, 0.46] },
      { id: 'front-right', label: 'Front Right', position: [1.32, 0.14, 2.66], target: [0.18, -0.04, 0.48] },
      { id: 'left', label: 'Left Profile', position: [-2.35, 0.22, 1.1], target: [-0.48, -0.08, 0.32] },
      { id: 'right', label: 'Right Profile', position: [2.28, 0.16, 1.02], target: [0.48, -0.08, 0.34] },
      { id: 'high-front', label: 'High Front', position: [0.12, 1.45, 2.55], target: [0, 0.02, 0.34] },
      { id: 'lower-socket-close', label: 'Lower Socket Close', position: [-1.72, 0.18, 1.56], target: [-0.66, -0.42, 0.32] },
    ],
  };
  let spatialTruthLastState = null;
  const spatialTruthClayMaterial = neutralPbrMaterial({
    color: 0x737d80,
    roughness: spatialTruthMaterialPolicy.roughness,
    metalness: spatialTruthMaterialPolicy.metalness,
    envMapIntensity: spatialTruthMaterialPolicy.envMapIntensity,
    side: THREE.DoubleSide,
  });
  const spatialTruthNormalMaterial = new THREE.MeshNormalMaterial({
    side: THREE.DoubleSide,
    flatShading: false,
  });
  const spatialTruthDepthMaterial = new THREE.MeshDepthMaterial({
    side: THREE.DoubleSide,
  });
  const spatialTruthObjectIdMaterials = new Map();
  const spatialTruthCameraDepthMaterials = new Map();
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
  const lowerSocketInventoryMaterials = new Map(
    Object.entries(LOWER_SOCKET_RENDER_CLASS_COLORS).map(([renderClass, color]) => ([
      renderClass,
      new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.92,
        depthWrite: true,
      }),
    ])),
  );
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
    apertureOrbitLaneMaterial,
    apertureOrbitTargetPointMaterial,
    apertureOrbitTargetTangentMaterial,
    macroContactIntersectMaterial,
    macroContactNearMaterial,
    macroContactClearMaterial,
    macroMorphologyReferenceSphereMaterial,
    macroMorphologyCleanCurveMaterial,
    macroMorphologyRiskCurveMaterial,
    macroMorphologyOffenderCurveMaterial,
    macroMorphologySubstripCurveMaterial,
    macroMorphologyLawImpactCurveMaterial,
    macroMorphologyOrbitDeltaVectorMaterial,
    macroMorphologyCapEnvelopeMaterial,
    macroMorphologyCapEnvelopePostMaterial,
    spatialTruthClayMaterial,
    spatialTruthNormalMaterial,
    spatialTruthDepthMaterial,
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
    ...lowerSocketInventoryMaterials.values(),
  ]) sharedMaterials.add(material);

  const SPATIAL_TRUTH_OBJECT_ID_COLORS = {
    MacroPromotedBody: 0x6ac8ff,
    LiveMacroSideWall: 0xc6d2d6,
    LiveMacroTerminalCap: 0xff9f66,
    MacroFamilySubstrip: 0x9ee493,
    MacroFamilySubstripSideWall: 0x4fb286,
    MacroFamilySubstripTerminalCap: 0xffd166,
    LamellarChannelStripMesh: 0xb8c7d9,
    LamellarPlateLip: 0xf2f7f8,
    LamellarPlateBoundaryMesh: 0xd06c6c,
    LamellarInnerReturnSidePlaneMesh: 0x8395a7,
    BandMember: 0xa37acc,
    TerminationSocketGraph: 0xff6a1c,
    AperturePressure: 0x4fd3ff,
    MacroTerritoryBody: 0x394449,
    UnknownShellMesh: 0x858d90,
  };

  function materialForBand(bandMember) {
    if (bandMember.role === 'body') return bodyMaterial;
    if (bandMember.role === 'hopping-member') return hopMaterial;
    return railMaterial;
  }

  function materialForMorphologyRecord(record) {
    if (record?.pathologyClasses?.includes('wandering-s-hook-visible-offender')) return macroMorphologyOffenderCurveMaterial;
    if (
      record?.pathologyClasses?.includes('wide-body-squiggle-risk')
      || record?.pathologyClasses?.includes('sidewall-frame-crease-risk')
      || record?.pathologyClasses?.includes('source-curve-high-curvature-risk')
    ) return macroMorphologyRiskCurveMaterial;
    if (record?.pathologyClasses?.includes('strip-family-visually-forgiving')) return macroMorphologySubstripCurveMaterial;
    return macroMorphologyCleanCurveMaterial;
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

  function lowerSocketSemanticRecordForMesh(mesh) {
    if (!mesh?.isMesh) return null;
    const parentGroupName = mesh.parent?.name || null;
    const promoted = mesh.userData?.MacroPromotedBody;
    const liveSideWall = mesh.userData?.LiveMacroSideWall;
    const liveTerminalCap = mesh.userData?.LiveMacroTerminalCap;
    const substrip = mesh.userData?.MacroFamilySubstrip;
    const substripSideWall = mesh.userData?.MacroFamilySubstripSideWall;
    const substripTerminalCap = mesh.userData?.MacroFamilySubstripTerminalCap;
    const bandMember = mesh.userData?.BandMember;
    const socket = mesh.userData?.TerminationSocketGraph;
    const channelStrip = mesh.userData?.LamellarChannelStripMesh;
    const plateLip = mesh.userData?.LamellarPlateLip;
    const plateBoundary = mesh.userData?.LamellarPlateBoundaryMesh;
    const innerReturn = mesh.userData?.LamellarInnerReturnSidePlaneMesh;
    const seamGap = mesh.userData?.MacroRegionSeamGapDescriptor;
    let source = null;
    let renderClass = null;
    let parentAssemblage = null;
    let renderRole = null;
    let sourcePath = null;
    let lowerSocketRelevance = null;
    if (substripTerminalCap) {
      source = substripTerminalCap;
      renderClass = 'MacroFamilySubstripTerminalCap';
      parentAssemblage = substrip?.parentAssemblage || promoted?.parentAssemblage || parentGroupName;
      renderRole = substripTerminalCap.capRole || 'substrip-terminal-cap';
      sourcePath = 'macroFamilySubstripPlan.substrips.terminalCaps';
    } else if (substripSideWall) {
      source = substripSideWall;
      renderClass = 'MacroFamilySubstripSideWall';
      parentAssemblage = substrip?.parentAssemblage || promoted?.parentAssemblage || parentGroupName;
      renderRole = `${substrip?.role || 'substrip'}:${substripSideWall.sideName}`;
      sourcePath = 'macroFamilySubstripPlan.substrips.sideWallSamples';
    } else if (substrip) {
      source = substrip;
      renderClass = 'MacroFamilySubstrip';
      parentAssemblage = substrip.parentAssemblage;
      renderRole = substrip.role;
      sourcePath = 'macroFamilySubstripPlan.substrips';
    } else if (liveTerminalCap) {
      source = liveTerminalCap;
      renderClass = 'LiveMacroTerminalCap';
      parentAssemblage = liveTerminalCap.parentAssemblage;
      renderRole = liveTerminalCap.targetEdge;
      sourcePath = 'liveMacroSideWallPlan.terminalCaps';
    } else if (liveSideWall) {
      source = liveSideWall;
      renderClass = 'LiveMacroSideWall';
      parentAssemblage = liveSideWall.parentAssemblage;
      renderRole = liveSideWall.targetEdge;
      sourcePath = 'liveMacroSideWallPlan.sideWalls';
    } else if (bandMember) {
      source = bandMember;
      renderClass = 'BandMember';
      parentAssemblage = bandMember.parentAssemblage || parentGroupName;
      renderRole = bandMember.role;
      sourcePath = 'macroAssemblages.childBandPlan';
    } else if (socket) {
      source = socket;
      renderClass = 'TerminationSocketGraph';
      parentAssemblage = parentGroupName;
      renderRole = socket.type;
      sourcePath = 'macroAssemblages.childBandPlan.*Termination';
    } else if (plateLip) {
      source = plateLip;
      renderClass = 'LamellarPlateLip';
      parentAssemblage = channelStrip?.parentAssemblage || null;
      renderRole = plateLip.edgeRole;
      sourcePath = 'lamellarChannelMeshPlan.stripMeshes.plateLips';
      lowerSocketRelevance = parentAssemblage === 'lower-socket-keel' ? 'direct-parent' : null;
    } else if (channelStrip) {
      source = channelStrip;
      renderClass = 'LamellarChannelStripMesh';
      parentAssemblage = channelStrip.parentAssemblage;
      renderRole = channelStrip.renderRole;
      sourcePath = 'lamellarChannelMeshPlan.stripMeshes';
      lowerSocketRelevance = parentAssemblage === 'lower-socket-keel' ? 'direct-parent' : null;
    } else if (plateBoundary) {
      source = plateBoundary;
      renderClass = 'LamellarPlateBoundaryMesh';
      parentAssemblage = 'lower-socket-keel';
      renderRole = plateBoundary.boundaryMode;
      sourcePath = 'lamellarPlateBoundaryPlan.boundaryMeshes';
      lowerSocketRelevance = plateBoundary.targetBoundaryId === 'lower-cup-socket-join-gap' ? 'lower-cup-socket-join-gap' : null;
    } else if (innerReturn) {
      source = innerReturn;
      renderClass = 'LamellarInnerReturnSidePlaneMesh';
      parentAssemblage = innerReturn.targetBoundaryId === 'lower-cup-socket-join-gap' ? 'lower-socket-keel' : null;
      renderRole = innerReturn.boundaryRole;
      sourcePath = 'lamellarInnerReturnPlan.sidePlaneMeshes';
      lowerSocketRelevance = innerReturn.targetBoundaryId === 'lower-cup-socket-join-gap' ? 'lower-cup-socket-join-gap' : null;
    } else if (seamGap) {
      source = seamGap;
      renderClass = 'MacroRegionSeamGapDescriptor';
      parentAssemblage = 'lower-socket-keel';
      renderRole = seamGap.role;
      sourcePath = 'expandedMacroRegionProxyPlan.seamGaps';
      lowerSocketRelevance = seamGap.id === 'lower-cup-socket-join-gap' ? 'lower-cup-socket-join-gap' : null;
    } else if (promoted) {
      source = promoted;
      renderClass = 'MacroPromotedBody';
      parentAssemblage = promoted.parentAssemblage || parentGroupName;
      renderRole = 'promoted-body-surface';
      sourcePath = 'macroBodyPromotion.promotedBodies';
    }
    if (!renderClass) return null;
    const isDirectLowerSocket = parentAssemblage === 'lower-socket-keel';
    const sourceId = source?.id || '';
    const boundaryId = source?.targetBoundaryId || source?.sourceGapDescriptorId || sourceId;
    const isRelevantBoundary = lowerSocketRelevance === 'lower-cup-socket-join-gap'
      || boundaryId === 'lower-cup-socket-join-gap'
      || mesh.name.startsWith('lower-cup-socket-join-gap-');
    if (!isDirectLowerSocket && !isRelevantBoundary) return null;
    const expectedRecord = composition.lowerSocketRenderInventoryPlan?.expectedRecords?.find(record => (
      record.meshName === mesh.name
      || record.sourceId === source?.id
      || record.sourceId === mesh.name
    ));
    return {
      schema: 'LowerSocketSemanticRenderInventoryRuntimeRecord',
      mode: 'lower-socket-semantic-render-inventory-v0',
      meshName: mesh.name,
      renderClass,
      sourceId: source?.id || mesh.name,
      parentAssemblage,
      renderRole,
      sourcePath,
      lowerSocketRelevance: lowerSocketRelevance || (isDirectLowerSocket ? 'direct-parent' : 'lower-socket-adjacent'),
      visibleBeforeIsolation: mesh.visible,
      normalRenderExpected: expectedRecord?.normalRenderExpected ?? mesh.visible,
      suppressionAuthority: expectedRecord?.suppressionAuthority || null,
      suspiciousIfVisible: expectedRecord?.suspiciousIfVisible || false,
      diagnosticColor: LOWER_SOCKET_RENDER_CLASS_COLORS[renderClass],
      diagnosticColorHex: `#${LOWER_SOCKET_RENDER_CLASS_COLORS[renderClass].toString(16).padStart(6, '0')}`,
    };
  }

  function lowerSocketSemanticRenderInventory() {
    const records = [];
    group?.traverse(child => {
      const record = lowerSocketSemanticRecordForMesh(child);
      if (record) records.push(record);
    });
    const classCounts = {};
    for (const record of records) classCounts[record.renderClass] = (classCounts[record.renderClass] || 0) + 1;
    return {
      schema: 'LowerSocketSemanticRenderInventory',
      mode: 'lower-socket-semantic-render-inventory-v0',
      targetAssemblage: 'lower-socket-keel',
      plan: composition.lowerSocketRenderInventoryPlan,
      runtimeRecordCount: records.length,
      classCounts,
      runtimeRecords: records,
      visibleRuntimeRecords: records.filter(record => record.visibleBeforeIsolation),
      suspectVisibleRecords: records.filter(record => record.visibleBeforeIsolation && record.suspiciousIfVisible),
      inventoryCompletenessVerdict: composition.lowerSocketRenderInventoryPlan?.inventoryCompletenessVerdict,
    };
  }

  function spatialTruthRenderClassForMesh(mesh) {
    if (mesh.userData?.LiveMacroSideWall) return 'LiveMacroSideWall';
    if (mesh.userData?.LiveMacroTerminalCap) return 'LiveMacroTerminalCap';
    if (mesh.userData?.MacroFamilySubstripTerminalCap) return 'MacroFamilySubstripTerminalCap';
    if (mesh.userData?.MacroFamilySubstripSideWall) return 'MacroFamilySubstripSideWall';
    if (mesh.userData?.MacroFamilySubstrip) return 'MacroFamilySubstrip';
    if (mesh.userData?.LamellarChannelStripMesh) return 'LamellarChannelStripMesh';
    if (mesh.userData?.LamellarPlateLip) return 'LamellarPlateLip';
    if (mesh.userData?.LamellarPlateBoundaryMesh) return 'LamellarPlateBoundaryMesh';
    if (mesh.userData?.LamellarInnerReturnSidePlaneMesh) return 'LamellarInnerReturnSidePlaneMesh';
    if (mesh.userData?.BandMember) return 'BandMember';
    if (mesh.userData?.TerminationSocketGraph) return 'TerminationSocketGraph';
    if (mesh.userData?.AperturePressure) return 'AperturePressure';
    if (mesh.userData?.MacroTerritoryBody) return 'MacroTerritoryBody';
    if (mesh.userData?.MacroPromotedBody) return 'MacroPromotedBody';
    return 'UnknownShellMesh';
  }

  function spatialTruthIsOverlayMesh(mesh) {
    return !!(
      mesh.userData?.ApertureOrbitLane
      || mesh.userData?.MacroApertureTerminalRole
      || mesh.userData?.ApertureTangencySample
      || mesh.userData?.MacroContactSample
      || mesh.userData?.MacroMorphologyReferenceSphere
      || mesh.userData?.MacroSphereCurveDecomposition
      || mesh.userData?.MacroLawOrbitDisplacementVector
      || mesh.userData?.MacroLawCapEnvelopeRail
    );
  }

  function spatialTruthObjectIdMaterial(renderClass) {
    if (!spatialTruthObjectIdMaterials.has(renderClass)) {
      const material = new THREE.MeshBasicMaterial({
        color: SPATIAL_TRUTH_OBJECT_ID_COLORS[renderClass] || SPATIAL_TRUTH_OBJECT_ID_COLORS.UnknownShellMesh,
        side: THREE.DoubleSide,
      });
      spatialTruthObjectIdMaterials.set(renderClass, material);
      sharedMaterials.add(material);
    }
    return spatialTruthObjectIdMaterials.get(renderClass);
  }

  function spatialTruthDiagnosticMaterial(pass, mesh) {
    if (pass === 'normal') return spatialTruthNormalMaterial;
    if (pass === 'depth') return spatialTruthDepthMaterial;
    if (pass === 'object-id') return spatialTruthObjectIdMaterial(spatialTruthRenderClassForMesh(mesh));
    return spatialTruthClayMaterial;
  }

  function spatialTruthCameraDepthMaterial(mesh, normalizedDepth) {
    const key = mesh.uuid || mesh.name;
    if (!spatialTruthCameraDepthMaterials.has(key)) {
      const material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      spatialTruthCameraDepthMaterials.set(key, material);
      sharedMaterials.add(material);
    }
    const material = spatialTruthCameraDepthMaterials.get(key);
    const contrastDepth = Math.pow(Math.max(0, Math.min(1, normalizedDepth)), 0.72);
    const gray = Math.round(245 - contrastDepth * 215);
    material.color.setRGB(gray / 255, gray / 255, gray / 255);
    material.needsUpdate = true;
    return material;
  }

  function refreshSpatialTruthDepthMaterials() {
    if (spatialTruthLastState?.diagnosticPass !== 'depth' || !group) return null;
    const meshes = [];
    group.traverse(child => {
      if (child.isMesh && child.visible && !spatialTruthIsOverlayMesh(child)) meshes.push(child);
    });
    if (!meshes.length) return null;
    const distances = meshes.map(mesh => {
      const center = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
      return center.distanceTo(camera.position);
    });
    const minDistance = Math.min(...distances);
    const maxDistance = Math.max(...distances);
    const span = Math.max(0.001, maxDistance - minDistance);
    meshes.forEach((mesh, index) => {
      const normalizedDepth = (distances[index] - minDistance) / span;
      mesh.material = spatialTruthCameraDepthMaterial(mesh, normalizedDepth);
      mesh.userData.SpatialTruthDiagnosticPass = {
        ...(mesh.userData.SpatialTruthDiagnosticPass || {}),
        readableDepthMode: 'camera-normalized-grayscale-depth-v0',
        normalizedDepth,
      };
    });
    spatialTruthLastState.depthRange = {
      schema: 'SpatialTruthDepthRange',
      mode: 'camera-normalized-grayscale-depth-v0',
      minDistance,
      maxDistance,
      meshCount: meshes.length,
    };
    return spatialTruthLastState.depthRange;
  }

  function compactMacroMorphologyInventory() {
    const inventory = composition.macroMorphologyInventory;
    if (!inventory) return null;
    return {
      schema: inventory.schema,
      mode: inventory.mode,
      referenceSphereRadius: inventory.referenceSphereRadius,
      visualDecompositionMode: inventory.visualDecompositionMode,
      recordCount: inventory.recordCount,
      stressCaseId: inventory.stressCaseId,
      comparedStages: inventory.comparedStages,
      pathologyClassCounts: inventory.pathologyClassCounts || {},
      curveDecompositions: (inventory.curveDecompositions || []).map(curve => ({
        schema: curve.schema,
        id: curve.id,
        parentAssemblage: curve.parentAssemblage,
        generationStage: curve.generationStage,
        visualOverlayId: curve.visualOverlayId,
        maxAbsRadiusError: curve.maxAbsRadiusError,
        sampleCount: curve.sampleCount,
        sourceControl: curve.sourceControl,
      })),
      lawImpactCurveSummaries: (inventory.lawImpactCurveDecompositions || []).map(curve => ({
        schema: curve.schema,
        id: curve.id,
        parentAssemblage: curve.parentAssemblage,
        ruleFamily: curve.ruleFamily,
        activeRuleId: curve.activeRuleId,
        apertureOrbitCaptureControlStrength: curve.apertureOrbitCaptureControlStrength,
        apertureOrbitCaptureDeltaMetrics: curve.apertureOrbitCaptureDeltaMetrics,
        visualOverlayId: curve.apertureOrbitCaptureCurve?.visualOverlayId || null,
      })),
      lawDebugSummaries: (inventory.lawDebugDecompositions || []).map(debug => ({
        schema: debug.schema,
        id: debug.id,
        parentAssemblage: debug.parentAssemblage,
        debugFamilies: debug.debugFamilies,
        orbitDisplacementVectorCount: debug.orbitDisplacementVectorCount,
        capEnvelopeRailCount: debug.capEnvelopeRailCount,
        capEnvelopeDeltaMetrics: debug.capEnvelopeDeltaMetrics,
      })),
    };
  }

  function setSpatialTruthMaterialPolicy(options = {}) {
    const envMapIntensity = Number.isFinite(Number(options.envMapIntensity))
      ? Math.max(0, Math.min(3, Number(options.envMapIntensity)))
      : spatialTruthMaterialPolicy.envMapIntensity;
    spatialTruthClayMaterial.roughness = Number.isFinite(Number(options.roughness))
      ? Math.max(0, Math.min(1, Number(options.roughness)))
      : spatialTruthMaterialPolicy.roughness;
    spatialTruthClayMaterial.metalness = spatialTruthMaterialPolicy.metalness;
    spatialTruthClayMaterial.envMapIntensity = envMapIntensity;
    spatialTruthClayMaterial.needsUpdate = true;
    return {
      ...spatialTruthMaterialPolicy,
      roughness: spatialTruthClayMaterial.roughness,
      envMapIntensity,
      exposure: Number.isFinite(Number(options.exposure))
        ? Math.max(0.2, Math.min(2.5, Number(options.exposure)))
        : spatialTruthMaterialPolicy.exposure,
    };
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

    const morphologySphere = new THREE.Mesh(
      new THREE.SphereGeometry(composition.macroMorphologyInventory?.referenceSphereRadius || 1.045, 64, 32),
      macroMorphologyReferenceSphereMaterial,
    );
    morphologySphere.name = 'macro-morphology-reference-sphere';
    morphologySphere.visible = false;
    morphologySphere.userData.MacroMorphologyReferenceSphere = true;
    morphologySphere.userData.OrbShellMorphologyInventory = composition.macroMorphologyInventory;
    group.add(morphologySphere);

    for (const record of composition.macroMorphologyInventory?.records || []) {
      const curveMesh = new THREE.Mesh(
        makeMacroSphereCurveLineGeometry(THREE, record.earlySphereCurve),
        materialForMorphologyRecord(record),
      );
      curveMesh.name = record.earlySphereCurve.visualOverlayId;
      curveMesh.visible = false;
      curveMesh.userData.OrbShellMorphologyInventory = composition.macroMorphologyInventory;
      curveMesh.userData.MacroMorphologyInventoryRecord = record;
      curveMesh.userData.MacroSphereCurveDecomposition = record.earlySphereCurve;
      group.add(curveMesh);

      const lawImpactCurve = record.lawImpactCurve?.apertureOrbitCaptureCurve;
      if (lawImpactCurve) {
        const lawImpactMesh = new THREE.Mesh(
          makeMacroSphereCurveLineGeometry(THREE, lawImpactCurve, 0.0048),
          macroMorphologyLawImpactCurveMaterial,
        );
        lawImpactMesh.name = lawImpactCurve.visualOverlayId;
        lawImpactMesh.visible = false;
        lawImpactMesh.userData.OrbShellMorphologyInventory = composition.macroMorphologyInventory;
        lawImpactMesh.userData.MacroMorphologyInventoryRecord = record;
        lawImpactMesh.userData.MacroLawImpactCurveDecomposition = record.lawImpactCurve;
        group.add(lawImpactMesh);
      }

      for (const vector of record.lawDebugDecomposition?.orbitDisplacementVectors || []) {
        const vectorMesh = new THREE.Mesh(
          makeMacroLawOrbitDisplacementVectorGeometry(THREE, vector),
          macroMorphologyOrbitDeltaVectorMaterial,
        );
        vectorMesh.name = vector.visualOverlayId;
        vectorMesh.visible = false;
        vectorMesh.userData.OrbShellMorphologyInventory = composition.macroMorphologyInventory;
        vectorMesh.userData.MacroMorphologyInventoryRecord = record;
        vectorMesh.userData.MacroLawDebugDecomposition = record.lawDebugDecomposition;
        vectorMesh.userData.MacroLawOrbitDisplacementVector = vector;
        group.add(vectorMesh);
      }

      for (const rail of record.lawDebugDecomposition?.capEnvelopeRails || []) {
        const railMesh = new THREE.Mesh(
          makeMacroLawCapEnvelopeRailGeometry(THREE, rail),
          rail.stage === 'post-cap-envelope'
            ? macroMorphologyCapEnvelopePostMaterial
            : macroMorphologyCapEnvelopeMaterial,
        );
        railMesh.name = rail.visualOverlayId;
        railMesh.visible = false;
        railMesh.userData.OrbShellMorphologyInventory = composition.macroMorphologyInventory;
        railMesh.userData.MacroMorphologyInventoryRecord = record;
        railMesh.userData.MacroLawDebugDecomposition = record.lawDebugDecomposition;
        railMesh.userData.MacroLawCapEnvelopeRail = rail;
        group.add(railMesh);
      }
    }

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
          capMesh.userData.ApertureAwareTerminus = cap.apertureAwareTerminus || null;
          capMesh.userData.ApertureAwareTerminusRenderConsumer = cap.apertureAwareRenderConsumer || null;
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
    for (const lane of composition.apertureOrbitCaptureLaw?.orbitLanes || []) {
      const laneMesh = new THREE.Mesh(makeApertureOrbitLaneGeometry(THREE, lane), apertureOrbitLaneMaterial);
      laneMesh.name = lane.overlayGeometryId;
      laneMesh.visible = false;
      laneMesh.userData.ApertureOrbitCaptureLaw = composition.apertureOrbitCaptureLaw;
      laneMesh.userData.ApertureOrbitLane = lane;
      laneMesh.userData.apertureOrbitCaptureOverlayRole = 'orbit-lane';
      group.add(laneMesh);
    }
    for (const role of composition.apertureOrbitCaptureLaw?.terminalRoles || []) {
      const targetPoint = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 8), apertureOrbitTargetPointMaterial);
      targetPoint.name = `${role.id}-target-point`;
      targetPoint.position.set(...role.targetPoint);
      targetPoint.visible = false;
      targetPoint.userData.ApertureOrbitCaptureLaw = composition.apertureOrbitCaptureLaw;
      targetPoint.userData.MacroApertureTerminalRole = role;
      targetPoint.userData.apertureOrbitCaptureOverlayRole = 'target-point';
      group.add(targetPoint);

      const targetTangent = new THREE.Mesh(
        makeApertureTangencyVectorGeometry(THREE, role.targetPoint, role.targetTangent, 0.22, 0.006),
        apertureOrbitTargetTangentMaterial,
      );
      targetTangent.name = `${role.id}-target-tangent`;
      targetTangent.visible = false;
      targetTangent.userData.ApertureOrbitCaptureLaw = composition.apertureOrbitCaptureLaw;
      targetTangent.userData.MacroApertureTerminalRole = role;
      targetTangent.userData.apertureOrbitCaptureOverlayRole = 'target-tangent';
      group.add(targetTangent);
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
      lawControls: composition.lawControls,
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
      LowerSocketPlateBodyHonestyLaw: composition.lowerSocketPlateBodyHonestyLaw,
      lowerSocketPlateBodyHonestyLaw: composition.lowerSocketPlateBodyHonestyLaw,
      lowerSocketPlateBodyHonestyVerdict: composition.lowerSocketPlateBodyHonestyVerdict,
      LowerSocketRenderInventoryPlan: composition.lowerSocketRenderInventoryPlan,
      lowerSocketRenderInventoryPlan: composition.lowerSocketRenderInventoryPlan,
      lowerSocketRenderInventoryExpectedClasses: composition.lowerSocketRenderInventoryPlan?.expectedRenderClasses || [],
      lowerSocketRenderInventoryExpectedRecordCount: composition.lowerSocketRenderInventoryPlan?.expectedRecordCount || 0,
      SocketTongueProvenancePlan: composition.socketTongueProvenancePlan,
      socketTongueProvenancePlan: composition.socketTongueProvenancePlan,
      socketTongueCandidateCount: composition.socketTongueProvenancePlan?.candidateCount || 0,
      socketTongueBestCandidateId: composition.socketTongueProvenancePlan?.bestCandidateId || null,
      MacroContactMap: composition.macroContactMap,
      macroContactMap: composition.macroContactMap,
      macroContactCount: composition.macroContactMap?.contactCount || 0,
      macroClosestContactIds: composition.macroContactMap?.closestContactIds || [],
      macroGeometryCoherenceWatchCount: composition.macroContactMap?.geometryCoherenceWatchCount || 0,
      OrbShellMorphologyInventory: composition.macroMorphologyInventory,
      macroMorphologyInventory: composition.macroMorphologyInventory,
      MacroSphereCurveDecomposition: composition.macroMorphologyInventory?.curveDecompositions || [],
      macroMorphologyRecordCount: composition.macroMorphologyInventory?.recordCount || 0,
      macroMorphologyPathologyClassCounts: composition.macroMorphologyInventory?.pathologyClassCounts || {},
      OrbShellProceduralArchitectureInventory: composition.proceduralArchitectureInventory,
      proceduralArchitectureInventory: composition.proceduralArchitectureInventory,
      proceduralArchitectureInventoryRecordCount: composition.proceduralArchitectureInventory?.recordCount || 0,
      proceduralArchitectureInventoryLayerCounts: composition.proceduralArchitectureInventory?.layerCounts || {},
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
      ApertureAwareTerminusPlan: composition.macroFamilySubstripPlan?.apertureAwareTerminusPlan,
      apertureAwareTerminusPlan: composition.macroFamilySubstripPlan?.apertureAwareTerminusPlan,
      ApertureAwareTerminus: composition.macroFamilySubstripPlan?.apertureAwareTerminusPlan?.records || [],
      apertureAwareTerminusCount: composition.macroFamilySubstripPlan?.apertureAwareTerminusPlan?.recordCount || 0,
      apertureAwareTerminusRoleCounts: composition.macroFamilySubstripPlan?.apertureAwareTerminusPlan?.roleCounts || {},
      apertureAwareTerminusWitnessGeometryIds: composition.macroFamilySubstripPlan?.apertureAwareTerminusPlan?.witnessGeometryIds || [],
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
      SpatialTruthMaterialPolicy: spatialTruthMaterialPolicy,
      spatialTruthMaterialPolicy,
      SpatialTruthViewSet: spatialTruthViewSet,
      spatialTruthLastState,
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
        lawControls: normalizeOrbShellLawControls(next.lawControls ?? variationOptions.lawControls),
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
    frameApertureOrbitCaptureWitness() {
      camera.position.set(0.28, 0.06, 3.28);
      controls.target.set(0.02, -0.05, 0.64);
      controls.update();
      onDirty?.();
    },
    frameMacroContactMap() {
      camera.position.set(-0.28, 0.34, 3.1);
      controls.target.set(-0.16, -0.05, 0.48);
      controls.update();
      onDirty?.();
    },
    frameMacroMorphologyInventory() {
      camera.position.set(0.08, 0.2, 3.35);
      controls.target.set(0, 0.02, 0.15);
      controls.update();
      onDirty?.();
    },
    frameMacroMorphologySurveyPose(options = {}) {
      const target = Array.isArray(options.target) && options.target.length === 3
        ? options.target.map(Number)
        : [0, 0.02, 0.15];
      const distance = Number.isFinite(Number(options.distance)) && Number(options.distance) > 0
        ? Number(options.distance)
        : 3.35;
      const elevationDeg = Number.isFinite(Number(options.elevationDeg)) ? Number(options.elevationDeg) : 0;
      const azimuthDeg = Number.isFinite(Number(options.azimuthDeg)) ? Number(options.azimuthDeg) : 0;
      const elevationRad = elevationDeg * Math.PI / 180;
      const azimuthRad = azimuthDeg * Math.PI / 180;
      const horizontal = Math.cos(elevationRad) * distance;
      const position = [
        target[0] + Math.sin(azimuthRad) * horizontal,
        target[1] + Math.sin(elevationRad) * distance,
        target[2] + Math.cos(azimuthRad) * horizontal,
      ];
      camera.position.set(...position);
      controls.target.set(...target);
      controls.update();
      onDirty?.();
      return {
        schema: 'MacroMorphologySurveyCellFrame',
        mode: 'macro-morphology-elevation-azimuth-camera-pose-v0',
        elevationDeg,
        azimuthDeg,
        cameraPose: {
          position,
          target,
          distance,
        },
      };
    },
    frameSpatialTruthView(viewId = spatialTruthViewSet.defaultViewId) {
      const view = spatialTruthViewSet.views.find(item => item.id === viewId)
        || spatialTruthViewSet.views.find(item => item.id === spatialTruthViewSet.defaultViewId)
        || spatialTruthViewSet.views[0];
      camera.position.set(...view.position);
      controls.target.set(...view.target);
      controls.update();
      const depthRange = refreshSpatialTruthDepthMaterials();
      onDirty?.();
      return {
        schema: 'SpatialTruthViewFrame',
        viewSetId: spatialTruthViewSet.id,
        requestedViewId: viewId,
        effectiveViewId: view.id,
        label: view.label,
        cameraPosition: view.position,
        cameraTarget: view.target,
        depthRange,
      };
    },
    frameSpatialTruthSurveyPose(options = {}) {
      const target = Array.isArray(options.target) && options.target.length === 3
        ? options.target.map(Number)
        : [0.02, -0.05, 0.64];
      const distance = Number.isFinite(Number(options.distance)) && Number(options.distance) > 0
        ? Number(options.distance)
        : 3.15;
      const elevationDeg = Number.isFinite(Number(options.elevationDeg)) ? Number(options.elevationDeg) : 0;
      const azimuthDeg = Number.isFinite(Number(options.azimuthDeg)) ? Number(options.azimuthDeg) : 0;
      const elevationRad = elevationDeg * Math.PI / 180;
      const azimuthRad = azimuthDeg * Math.PI / 180;
      const horizontal = Math.cos(elevationRad) * distance;
      const position = [
        target[0] + Math.sin(azimuthRad) * horizontal,
        target[1] + Math.sin(elevationRad) * distance,
        target[2] + Math.cos(azimuthRad) * horizontal,
      ];
      camera.position.set(...position);
      controls.target.set(...target);
      controls.update();
      onDirty?.();
      return {
        schema: 'SpatialTruthSurveyCellFrame',
        mode: 'elevation-azimuth-camera-pose-v0',
        elevationDeg,
        azimuthDeg,
        cameraPose: {
          position,
          target,
          distance,
        },
      };
    },
    frameLowerSocketAnatomy() {
      camera.position.set(-1.72, 0.18, 1.56);
      controls.target.set(-0.66, -0.42, 0.32);
      controls.update();
      onDirty?.();
    },
    enableSpatialTruthWitness(options = {}) {
      const requestedPass = String(options.diagnosticPass || options.pass || spatialTruthMaterialPolicy.defaultDiagnosticPass);
      const diagnosticPass = spatialTruthMaterialPolicy.diagnosticPasses.includes(requestedPass)
        ? requestedPass
        : spatialTruthMaterialPolicy.defaultDiagnosticPass;
      const includeOverlays = !!options.includeOverlays;
      const effectiveMaterialPolicy = setSpatialTruthMaterialPolicy(options);
      scene.children.forEach(child => {
        if (child !== group) {
          child.userData.spatialTruthWitnessHidden = true;
          child.visible = false;
        }
      });
      let visibleMeshCount = 0;
      let hiddenMeshCount = 0;
      let materialOverrideCount = 0;
      let hiddenOverlayCount = 0;
      const visibleRoleCounts = {};
      group?.traverse(child => {
        if (child.isLight) {
          child.visible = true;
          return;
        }
        if (!child.isMesh) return;
        const isOverlay = spatialTruthIsOverlayMesh(child);
        child.visible = includeOverlays || !isOverlay;
        if (!child.visible) {
          hiddenMeshCount += 1;
          if (isOverlay) hiddenOverlayCount += 1;
          return;
        }
        const renderClass = spatialTruthRenderClassForMesh(child);
        child.material = spatialTruthDiagnosticMaterial(diagnosticPass, child);
        child.userData.SpatialTruthDiagnosticPass = {
          schema: 'SpatialTruthDiagnosticPass',
          diagnosticPass,
          renderClass,
          materialPolicyMode: effectiveMaterialPolicy.mode,
        };
        child.material.needsUpdate = true;
        visibleMeshCount += 1;
        materialOverrideCount += 1;
        visibleRoleCounts[renderClass] = (visibleRoleCounts[renderClass] || 0) + 1;
      });
      spatialTruthLastState = {
        schema: 'SpatialTruthWitnessState',
        mode: 'spatial-truth-env-lit-diagnostic-v0',
        diagnosticPass,
        requestedPass,
        includeOverlays,
        materialPolicy: effectiveMaterialPolicy,
        SpatialTruthMaterialPolicy: effectiveMaterialPolicy,
        SpatialTruthViewSet: spatialTruthViewSet,
        visibleMeshCount,
        hiddenMeshCount,
        materialOverrideCount,
        hiddenOverlayCount,
        visibleRoleCounts,
        diagnosticPassRecord: {
          schema: 'SpatialTruthDiagnosticPass',
          diagnosticPass,
          materialClass: diagnosticPass === 'normal'
            ? 'MeshNormalMaterial'
            : diagnosticPass === 'depth'
              ? 'MeshDepthMaterial plus camera-normalized MeshBasicMaterial grayscale'
              : diagnosticPass === 'object-id'
                ? 'MeshBasicMaterial'
                : 'MeshStandardMaterial',
        },
      };
      onDirty?.();
      return spatialTruthLastState;
    },
    lowerSocketSemanticRenderInventory,
    enableLowerSocketSemanticRenderInventoryWitness() {
      scene.children.forEach(child => {
        if (child !== group) {
          child.userData.lowerSocketSemanticRenderInventoryHidden = true;
          child.visible = false;
        }
      });
      let visibleCount = 0;
      let hiddenCount = 0;
      const visibleMeshIds = [];
      const runtimeRecords = [];
      group?.traverse(child => {
        if (!child.isMesh) return;
        const record = lowerSocketSemanticRecordForMesh(child);
        if (record) {
          child.visible = true;
          child.material = lowerSocketInventoryMaterials.get(record.renderClass) || child.material;
          child.userData.LowerSocketSemanticRenderInventoryRuntimeRecord = record;
          visibleCount += 1;
          visibleMeshIds.push(child.name);
          runtimeRecords.push({
            ...record,
            visibleAfterIsolation: true,
          });
        } else {
          child.visible = false;
          hiddenCount += 1;
        }
      });
      this.frameLowerSocketAnatomy();
      const classCounts = {};
      for (const record of runtimeRecords) classCounts[record.renderClass] = (classCounts[record.renderClass] || 0) + 1;
      return {
        schema: 'LowerSocketSemanticRenderInventoryWitnessState',
        mode: 'lower-socket-semantic-render-inventory-isolated-v0',
        targetAssemblage: 'lower-socket-keel',
        materialMode: 'semantic-class-basic-color',
        plan: composition.lowerSocketRenderInventoryPlan,
        visibleCount,
        hiddenCount,
        visibleMeshIds,
        classCounts,
        runtimeRecords,
        suspectVisibleRecords: runtimeRecords.filter(record => record.suspiciousIfVisible),
        colorLegend: composition.lowerSocketRenderInventoryPlan?.classColorLegend || [],
        diagnosticQuestion: composition.lowerSocketRenderInventoryPlan?.diagnosticQuestion,
      };
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
        semanticRenderInventory: lowerSocketSemanticRenderInventory(),
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
    enableMacroMorphologyInventoryWitness(options = {}) {
      scene.children.forEach(child => {
        if (child !== group) {
          child.userData.macroMorphologyInventoryWitnessHidden = true;
          child.visible = false;
        }
      });
      let visibleCount = 0;
      let hiddenCount = 0;
      const visibleCurveIds = [];
      const visibleLawImpactCurveIds = [];
      const visibleOrbitDisplacementVectorIds = [];
      const visibleCapEnvelopeRailIds = [];
      const visibleReferenceIds = [];
      const visibleRecords = [];
      const visibleRecordIds = new Set();
      const debugMode = composition.lawControls?.debugMode || 'all-law-impact';
      group?.traverse(child => {
        if (!child.isMesh) return;
        const curve = child.userData?.MacroSphereCurveDecomposition;
        const lawImpactCurve = child.userData?.MacroLawImpactCurveDecomposition;
        const orbitDisplacementVector = child.userData?.MacroLawOrbitDisplacementVector;
        const capEnvelopeRail = child.userData?.MacroLawCapEnvelopeRail;
        const record = child.userData?.MacroMorphologyInventoryRecord;
        const isReferenceSphere = !!child.userData?.MacroMorphologyReferenceSphere;
        const isAperture = !!child.userData?.AperturePressure;
        const showOrbitDebug = debugMode === 'orbit-delta' || debugMode === 'all-law-impact';
        const showCapDebug = debugMode === 'cap-envelope' || debugMode === 'all-law-impact';
        child.visible = !!curve
          || (showOrbitDebug && !!lawImpactCurve)
          || (showOrbitDebug && !!orbitDisplacementVector)
          || (showCapDebug && !!capEnvelopeRail)
          || isReferenceSphere
          || isAperture;
        if (child.visible) {
          visibleCount += 1;
          if (curve) visibleCurveIds.push(child.name);
          if (lawImpactCurve) visibleLawImpactCurveIds.push(child.name);
          if (orbitDisplacementVector) visibleOrbitDisplacementVectorIds.push(child.name);
          if (capEnvelopeRail) visibleCapEnvelopeRailIds.push(child.name);
          if (isReferenceSphere) visibleReferenceIds.push(child.name);
          if (record && !visibleRecordIds.has(record.id)) {
            visibleRecordIds.add(record.id);
            visibleRecords.push({
              parentAssemblage: record.parentAssemblage,
              visualOverlayId: record.earlySphereCurve.visualOverlayId,
              lawImpactVisualOverlayId: record.lawImpactCurve?.apertureOrbitCaptureCurve?.visualOverlayId || null,
              lawDebugSummary: {
                schema: 'MacroLawDebugSummary',
                debugDecompositionId: record.lawDebugDecomposition?.id || null,
                orbitDisplacementVectorCount: record.lawDebugDecomposition?.orbitDisplacementVectorCount || 0,
                capEnvelopeRailCount: record.lawDebugDecomposition?.capEnvelopeRailCount || 0,
                capEnvelopeDeltaMetrics: record.lawDebugDecomposition?.capEnvelopeDeltaMetrics || null,
              },
              renderClassComparison: record.renderClassComparison,
              pathologyClasses: record.pathologyClasses,
              sourceCurveMetrics: record.sourceCurveMetrics,
              promotedCenterlineMetrics: record.promotedCenterlineMetrics,
              lawImpactCurveMetrics: record.lawImpactCurve?.apertureOrbitCaptureDeltaMetrics || null,
            });
          }
        } else {
          hiddenCount += 1;
        }
      });
      if (options.frame !== false) this.frameMacroMorphologyInventory();
      else {
        controls.update();
        onDirty?.();
      }
      return {
        schema: 'MacroMorphologyInventoryWitnessState',
        mode: 'macro-morphology-inventory-isolated-v0',
        visualDecompositionMode: 'source-curve-plus-law-specific-debug-predicates',
        lawDebugMode: debugMode,
        inventory: compactMacroMorphologyInventory(),
        visibleCount,
        hiddenCount,
        visibleCurveCount: visibleCurveIds.length,
        visibleCurveIds,
        visibleLawImpactCurveCount: visibleLawImpactCurveIds.length,
        visibleLawImpactCurveIds,
        visibleOrbitDisplacementVectorCount: visibleOrbitDisplacementVectorIds.length,
        visibleOrbitDisplacementVectorIds,
        visibleCapEnvelopeRailCount: visibleCapEnvelopeRailIds.length,
        visibleCapEnvelopeRailIds,
        visibleReferenceIds,
        visibleRecords,
        colorLegend: [
          { role: 'source-curve', color: '#9be8ff' },
          { role: 'post-orbit-capture-curve', color: '#ffb24a' },
          { role: 'orbit-displacement-vector', color: '#ff6aa6' },
          { role: 'pre-cap-envelope-rail', color: '#9be8ff' },
          { role: 'post-cap-envelope-rail', color: '#fff06a' },
          { role: 'aperture-reference', color: '#4fc3e6' },
        ],
        pathologyClassCounts: composition.macroMorphologyInventory?.pathologyClassCounts || {},
        diagnosticQuestion: [
          'do early sphere curves already squiggle',
          'does promotion or sidewall framing introduce the visible kink',
          'which macro family should own the next repair',
        ],
      };
    },
    enableProceduralArchitectureInventoryWitness() {
      scene.children.forEach(child => {
        if (child !== group) {
          child.userData.proceduralArchitectureInventoryWitnessHidden = true;
          child.visible = false;
        }
      });
      let visibleCount = 0;
      let hiddenCount = 0;
      const visibleCurveIds = [];
      const visibleSemanticMeshIds = [];
      const visibleReferenceIds = [];
      group?.traverse(child => {
        if (!child.isMesh) return;
        const curve = child.userData?.MacroSphereCurveDecomposition;
        const isReferenceSphere = !!child.userData?.MacroMorphologyReferenceSphere;
        const promoted = child.userData?.MacroPromotedBody;
        const substrip = child.userData?.MacroFamilySubstrip;
        const terminalCap = child.userData?.LiveMacroTerminalCap;
        const aperture = child.userData?.AperturePressure;
        const isSemanticContext = !!promoted || !!substrip || !!terminalCap || !!aperture;
        child.visible = !!curve || isReferenceSphere || isSemanticContext;
        if (child.visible) {
          visibleCount += 1;
          if (curve) visibleCurveIds.push(child.name);
          if (isReferenceSphere) visibleReferenceIds.push(child.name);
          if (isSemanticContext && !curve && !isReferenceSphere) visibleSemanticMeshIds.push(child.name);
        } else {
          hiddenCount += 1;
        }
      });
      this.frameMacroMorphologyInventory();
      return {
        schema: 'ProceduralArchitectureInventoryWitnessState',
        mode: 'procedural-architecture-inventory-isolated-v0',
        visualDecompositionMode: composition.proceduralArchitectureInventory?.visualDecompositionMode,
        inventory: compactProceduralArchitectureInventory(composition.proceduralArchitectureInventory),
        visibleCount,
        hiddenCount,
        visibleCurveCount: visibleCurveIds.length,
        visibleCurveIds,
        visibleSemanticMeshIds,
        visibleReferenceIds,
        stressCaseId: composition.proceduralArchitectureInventory?.stressCaseId,
        layerCounts: composition.proceduralArchitectureInventory?.layerCounts || {},
        semanticClassCounts: composition.proceduralArchitectureInventory?.semanticClassCounts || {},
        diagnosticQuestion: [
          'what semantic object produced each visible mesh',
          'which curve and territory does each generated element claim',
          'which layer owns lower-socket tongue repair',
        ],
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
    enableApertureOrbitCaptureWitness() {
      scene.children.forEach(child => {
        if (child !== group) {
          child.userData.apertureOrbitCaptureWitnessHidden = true;
          child.visible = false;
        }
      });
      let visibleCount = 0;
      let hiddenCount = 0;
      const visibleOverlayIds = [];
      const visibleMacroIds = [];
      group?.traverse(child => {
        if (!child.isMesh) return;
        const isOverlay = !!child.userData?.ApertureOrbitLane || !!child.userData?.MacroApertureTerminalRole;
        const isAperture = !!child.userData?.AperturePressure;
        const promotedBody = child.userData?.MacroPromotedBody;
        const isMeasuredMacro = !!promotedBody && composition.apertureOrbitCaptureLaw?.terminalRoles?.some(role => (
          role.parentAssemblage === promotedBody.parentAssemblage
        ));
        child.visible = isOverlay || isAperture || isMeasuredMacro;
        if (child.visible) {
          visibleCount += 1;
          if (isOverlay) visibleOverlayIds.push(child.name);
          if (isMeasuredMacro) visibleMacroIds.push(child.name);
        } else {
          hiddenCount += 1;
        }
      });
      this.frameApertureOrbitCaptureWitness();
      return {
        schema: 'ApertureOrbitCaptureWitnessState',
        mode: 'macro-aperture-orbit-capture-overlay-v0',
        witnessPlanId: composition.apertureOrbitCaptureWitnessPlan?.id,
        measuredLawId: composition.apertureOrbitCaptureWitnessPlan?.measuredLawId,
        measuredApertureSourceId: composition.apertureOrbitCaptureWitnessPlan?.measuredApertureSourceId,
        visualOverlayMode: composition.apertureOrbitCaptureWitnessPlan?.visualOverlayMode,
        visibleCount,
        hiddenCount,
        visibleOverlayIds,
        visibleMacroIds,
        sampleCount: composition.apertureOrbitCaptureWitnessPlan?.sampleCount || 0,
        verdictCounts: composition.apertureOrbitCaptureWitnessPlan?.verdictCounts || {},
        colorLegend: [
          { role: 'orbit-lane', color: '#4fd3ff' },
          { role: 'target-point', color: '#fde74c' },
          { role: 'target-tangent', color: '#ff7a25' },
        ],
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
    proceduralArchitectureInventoryDebugState() {
      const compactInventory = compactProceduralArchitectureInventory(composition.proceduralArchitectureInventory);
      return {
        schema: 'ProceduralArchitectureInventoryDebugState',
        identity: ORB_SHELL_COMPOSITION_IDENTITY,
        active,
        baselineDisposition: ORB_SHELL_COMPOSITION_BASELINE,
        variantId: composition.effectiveVariation.variantId,
        variationSeed: composition.effectiveVariation.variationSeed,
        variationLeafCount: composition.effectiveVariation.variationLeafCount,
        uiControlSource: composition.effectiveVariation.uiControlSource,
        macroAssemblageCount: composition.macroAssemblages.length,
        macroAssemblageIds: composition.macroAssemblages.map(item => item.id),
        selectedMacroAssemblageIds: composition.macroAssemblageCountLaw?.selectedMacroAssemblageIds || [],
        retiredMacroAssemblageIds: composition.macroAssemblageCountLaw?.retiredMacroAssemblageIds || [],
        macroMorphologyRecordCount: composition.macroMorphologyInventory?.recordCount || 0,
        macroMorphologyPathologyClassCounts: composition.macroMorphologyInventory?.pathologyClassCounts || {},
        MacroSphereCurveDecomposition: (composition.macroMorphologyInventory?.curveDecompositions || []).map(curve => ({
          id: curve.id,
          parentAssemblage: curve.parentAssemblage,
          generationStage: curve.generationStage,
          visualOverlayId: curve.visualOverlayId,
          sampleCount: curve.sampleCount,
          sourceControl: curve.sourceControl,
          pathologyClasses: curve.pathologyClasses,
        })),
        OrbShellProceduralArchitectureInventory: compactInventory,
        proceduralArchitectureInventory: compactInventory,
        proceduralArchitectureInventoryRecordCount: compactInventory?.recordCount || 0,
        proceduralArchitectureInventoryLayerCounts: compactInventory?.layerCounts || {},
        proceduralArchitectureInventorySemanticClassCounts: compactInventory?.semanticClassCounts || {},
        proceduralArchitectureInventorySourceStageCounts: compactInventory?.sourceStageCounts || {},
        stressCaseId: compactInventory?.stressCaseId || null,
        diagnosticQuestion: compactInventory?.unresolvedArchitectureQuestions || [],
        OrbShellComposition: {
          schema: 'OrbShellCompositionDebugSummary',
          identity: ORB_SHELL_COMPOSITION_IDENTITY,
          macroAssemblageCount: composition.macroAssemblages.length,
          macroAssemblageIds: composition.macroAssemblages.map(item => item.id),
          variantId: composition.effectiveVariation.variantId,
          variationSeed: composition.effectiveVariation.variationSeed,
          variationLeafCount: composition.effectiveVariation.variationLeafCount,
          macroMorphologyRecordCount: composition.macroMorphologyInventory?.recordCount || 0,
          diagnosticCompactionReason: 'architecture-inventory-focus-uses-dedicated-compact-state',
        },
      };
    },
    debugState() {
      const compactMorphologyInventory = compactMacroMorphologyInventory();
      return {
        identity: ORB_SHELL_COMPOSITION_IDENTITY,
        active,
        baselineDisposition: ORB_SHELL_COMPOSITION_BASELINE,
        variantId: composition.effectiveVariation.variantId,
        variationSeed: composition.effectiveVariation.variationSeed,
        variationLeafCount: composition.effectiveVariation.variationLeafCount,
        uiControlSource: composition.effectiveVariation.uiControlSource,
        lawControls: composition.lawControls,
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
        LowerSocketPlateBodyHonestyLaw: composition.lowerSocketPlateBodyHonestyLaw,
        lowerSocketPlateBodyHonestyLaw: composition.lowerSocketPlateBodyHonestyLaw,
        lowerSocketPlateBodyHonestyVerdict: composition.lowerSocketPlateBodyHonestyVerdict,
        LowerSocketRenderInventoryPlan: composition.lowerSocketRenderInventoryPlan,
        lowerSocketRenderInventoryPlan: composition.lowerSocketRenderInventoryPlan,
        lowerSocketRenderInventory: lowerSocketSemanticRenderInventory(),
        lowerSocketRenderInventoryExpectedClasses: composition.lowerSocketRenderInventoryPlan?.expectedRenderClasses || [],
        lowerSocketRenderInventoryExpectedRecordCount: composition.lowerSocketRenderInventoryPlan?.expectedRecordCount || 0,
        SocketTongueProvenancePlan: composition.socketTongueProvenancePlan,
        socketTongueProvenancePlan: composition.socketTongueProvenancePlan,
        SocketTongueCandidate: composition.socketTongueProvenancePlan?.candidates || [],
        socketTongueCandidateCount: composition.socketTongueProvenancePlan?.candidateCount || 0,
        socketTongueBestCandidateId: composition.socketTongueProvenancePlan?.bestCandidateId || null,
        MacroContactMap: composition.macroContactMap,
        macroContactMap: composition.macroContactMap,
        MacroContactSample: composition.macroContactMap?.contacts || [],
        macroContactCount: composition.macroContactMap?.contactCount || 0,
        macroClosestContactIds: composition.macroContactMap?.closestContactIds || [],
        macroGeometryCoherenceWatch: composition.macroContactMap?.geometryCoherenceWatch || [],
        macroGeometryCoherenceWatchCount: composition.macroContactMap?.geometryCoherenceWatchCount || 0,
        OrbShellMorphologyInventory: compactMorphologyInventory,
        macroMorphologyInventory: compactMorphologyInventory,
        MacroSphereCurveDecomposition: compactMorphologyInventory?.curveDecompositions || [],
        macroMorphologyRecordCount: composition.macroMorphologyInventory?.recordCount || 0,
        macroMorphologyPathologyClassCounts: composition.macroMorphologyInventory?.pathologyClassCounts || {},
        OrbShellProceduralArchitectureInventory: composition.proceduralArchitectureInventory,
        proceduralArchitectureInventory: composition.proceduralArchitectureInventory,
        proceduralArchitectureInventoryRecordCount: composition.proceduralArchitectureInventory?.recordCount || 0,
        proceduralArchitectureInventoryLayerCounts: composition.proceduralArchitectureInventory?.layerCounts || {},
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
        ApertureAwareTerminusPlan: composition.macroFamilySubstripPlan?.apertureAwareTerminusPlan,
        apertureAwareTerminusPlan: composition.macroFamilySubstripPlan?.apertureAwareTerminusPlan,
        ApertureAwareTerminus: composition.macroFamilySubstripPlan?.apertureAwareTerminusPlan?.records || [],
        apertureAwareTerminusCount: composition.macroFamilySubstripPlan?.apertureAwareTerminusPlan?.recordCount || 0,
        apertureAwareTerminusRoleCounts: composition.macroFamilySubstripPlan?.apertureAwareTerminusPlan?.roleCounts || {},
        ApertureAwareTerminusRenderConsumer: (composition.macroFamilySubstripPlan?.apertureAwareTerminusPlan?.records || []).map(record => record.renderConsumer).filter(Boolean),
        apertureAwareTerminusRenderConsumerCount: (composition.macroFamilySubstripPlan?.apertureAwareTerminusPlan?.records || []).filter(record => record.renderConsumer).length,
        apertureAwareTerminusWitnessGeometryIds: composition.macroFamilySubstripPlan?.apertureAwareTerminusPlan?.witnessGeometryIds || [],
        ApertureTangencyWitnessPlan: composition.macroFamilySubstripPlan?.apertureTangencyWitnessPlan,
        apertureTangencyWitnessPlan: composition.macroFamilySubstripPlan?.apertureTangencyWitnessPlan,
        ApertureTangencySample: composition.macroFamilySubstripPlan?.apertureTangencyWitnessPlan?.samples || [],
        apertureTangencySampleCount: composition.macroFamilySubstripPlan?.apertureTangencyWitnessPlan?.sampleCount || 0,
        apertureTangencyVerdictCounts: composition.macroFamilySubstripPlan?.apertureTangencyWitnessPlan?.verdictCounts || {},
        apertureTangencyMeasuredApertureSourceId: composition.macroFamilySubstripPlan?.apertureTangencyWitnessPlan?.measuredApertureSourceId,
        apertureTangencyOverlayGeometryIds: composition.macroFamilySubstripPlan?.apertureTangencyWitnessPlan?.overlayGeometryIds || [],
        ApertureOrbitCaptureLaw: composition.apertureOrbitCaptureLaw,
        apertureOrbitCaptureLaw: composition.apertureOrbitCaptureLaw,
        ApertureOrbitLane: composition.apertureOrbitCaptureLaw?.orbitLanes || [],
        MacroApertureTerminalRole: composition.apertureOrbitCaptureLaw?.terminalRoles || [],
        apertureOrbitCaptureRoleCount: composition.apertureOrbitCaptureLaw?.terminalRoles?.length || 0,
        apertureOrbitLaneCount: composition.apertureOrbitCaptureLaw?.orbitLanes?.length || 0,
        ApertureOrbitCaptureWitnessPlan: composition.apertureOrbitCaptureWitnessPlan,
        apertureOrbitCaptureWitnessPlan: composition.apertureOrbitCaptureWitnessPlan,
        MacroApertureTerminalCaptureSample: composition.apertureOrbitCaptureWitnessPlan?.samples || [],
        apertureOrbitCaptureSampleCount: composition.apertureOrbitCaptureWitnessPlan?.sampleCount || 0,
        apertureOrbitCaptureVerdictCounts: composition.apertureOrbitCaptureWitnessPlan?.verdictCounts || {},
        apertureOrbitCaptureOverlayGeometryIds: composition.apertureOrbitCaptureWitnessPlan?.overlayGeometryIds || [],
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
        SpatialTruthMaterialPolicy: spatialTruthMaterialPolicy,
        spatialTruthMaterialPolicy,
        SpatialTruthViewSet: spatialTruthViewSet,
        spatialTruthLastState,
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
