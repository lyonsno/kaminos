export const ORB_SHELL_COMPOSITION_IDENTITY = 'orb-shell-macro-grammar-grounding-v0';
export const ORB_SHELL_COMPOSITION_BASELINE = 'coherent-but-wrong-model-baseline';
export const ORB_SHELL_CONTROLLED_VARIATION_MODE = 'orb-shell-controlled-variation-assay-v0';

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

export function applyControlledOrbShellVariation(composition, descriptor) {
  const next = clone(composition);
  const macroParameters = descriptor.effectiveParameters.macroAssemblages;
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
  const frontParameters = descriptor.effectiveParameters.frontApertureOwnership;
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

function sampleSpine(THREE, assemblage, bandMember, t, radius = 1.04) {
  const control = assemblage.spine.control;
  const lat = control.startLat + (control.endLat - control.startLat) * t;
  const widthPressure = assemblage.sphericalTerritory.lonWidth * 0.12;
  const siblingOffset = bandMember.siblingOffset + Math.sin(Math.PI * t) * widthPressure * 0.18;
  const lon = assemblage.sphericalTerritory.centerPhase
    + assemblage.handedness * control.twist * (t - 0.5)
    + Math.sin(Math.PI * t) * control.bow
    + siblingOffset;
  const layer = bandMember.layerIntervals.find(interval => t >= interval.t0 && t <= interval.t1)?.layer || 'outer';
  const layerBias = layer === 'inner-support' ? -0.045 : layer === 'under-neighbor' ? -0.025 : 0.02;
  return makeVec3(THREE, spherePoint(lat, lon, radius + layerBias));
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
        .addScaledVector(side, q * sideWidth)
        .addScaledVector(normal, lift * crown);
      vertices.push(pos.x, pos.y, pos.z);
      normals.push(normal.x, normal.y, normal.z);
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

function makeFrontOwnerCurveGeometry(THREE, points, radius) {
  const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
  return new THREE.TubeGeometry(curve, 72, radius, 10, false);
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
  const cup = new THREE.Mesh(makeLowerFrontCupGeometry(THREE, variation.lowerCupDepth || 1), materials.ownerBody);
  cup.name = 'primary-front-aperture-lower-cupping-owner';
  cup.userData.PrimaryApertureFrame = frame;
  cup.userData.frontApertureOwnerRole = 'lower-cupping-owner';
  group.add(cup);

  const crossing = new THREE.Mesh(makeFrontOwnerCurveGeometry(THREE, [
    [-0.38, 0.38, 0.86],
    [-0.16 + (variation.crossingTuckPhase || 0) * 0.18, 0.12, 1.03],
    [0.1 + (variation.crossingTuckPhase || 0) * 0.24, -0.08, 1.08],
    [0.34, -0.33 + (variation.crossingTuckPhase || 0) * 0.12, 0.88],
  ], 0.026 * (variation.ownerDominance || 1)), materials.ownerRail);
  crossing.name = 'primary-front-aperture-crossing-tuck-owner';
  crossing.userData.PrimaryApertureFrame = frame;
  crossing.userData.frontApertureOwnerRole = 'crossing-tuck-owner';
  group.add(crossing);
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
  const terminationMaterial = new THREE.MeshBasicMaterial({ color: 0xff6a1c, transparent: true, opacity: 0.72 });
  const apertureOwnerBodyMaterial = new THREE.MeshStandardMaterial({ color: 0x20272a, roughness: 0.25, metalness: 0.9, envMapIntensity: 2.2, side: THREE.DoubleSide });
  const apertureOwnerRailMaterial = new THREE.MeshStandardMaterial({ color: 0x71828a, roughness: 0.18, metalness: 0.92, envMapIntensity: 3 });
  for (const material of [
    bodyMaterial,
    territoryMaterial,
    railMaterial,
    hopMaterial,
    apertureMaterial,
    terminationMaterial,
    apertureOwnerBodyMaterial,
    apertureOwnerRailMaterial,
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
      const territoryMesh = new THREE.Mesh(makeMacroTerritoryBodyGeometry(THREE, assemblage), territoryMaterial);
      territoryMesh.name = `${assemblage.id}-macro-territory-body`;
      territoryMesh.userData.MacroTerritoryBody = assemblage.territoryBodyOccupancy;
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
    addPrimaryApertureFrameGeometry(THREE, group, composition, {
      ownerBody: apertureOwnerBodyMaterial,
      ownerRail: apertureOwnerRailMaterial,
    });

    scene.add(group);
    onStatus?.({
      phase: 'built',
      identity: ORB_SHELL_COMPOSITION_IDENTITY,
      variantId: composition.effectiveVariation.variantId,
      variationSeed: composition.effectiveVariation.variationSeed,
      macroAssemblageCount: composition.macroAssemblages.length,
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
        bandMemberCount: composition.macroAssemblages.reduce((sum, item) => sum + item.childBandPlan.length, 0),
        territoryBodyCount: composition.macroAssemblages.filter(item => item.territoryBodyOccupancy).length,
        closureAnchorCount: composition.sphericalClosureAnchors.length,
        shapedBoundaryCount: composition.macroAssemblages.filter(item => item.territoryBodyOccupancy?.boundaryPressureField).length,
        frontApertureOwnershipCount: composition.frontApertureOwnership?.owners?.length || 0,
        PrimaryApertureFrame: composition.frontApertureOwnership,
        frontApertureOwnership: composition.frontApertureOwnership,
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
