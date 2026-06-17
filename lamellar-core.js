const WITNESS_IDENTITY = "kaminos-lamellar-witness-v0";
const EFFECTIVE_ROUTE = "sphere-domain-section-segment-witness-v0";
const WIDTH_RADIUS_COUPLING_MODE = "stable-strip-width-cut-radius-only-changes-window-caps-gap";
const END_CAP_SEALING_MODE = "zero-lift-closed-terminal-cap-slab";
const PLACEHOLDER_CONTRACT = "temporary-aesthetic-composition-primitive-not-final-lamellar-topology";
const COMPOSER_MODE = "data-first-poloxodromic-lamellar-section-composer-v0";
const LAYER_STACK_MODE = "authored-lamellar-layer-stack-descriptor-v0";
const LAYER_SHELL_MODE = "authored-lamellar-layer-shell-assemblage-v0";
const STRIP_POPULATION_MODE = "same-shell-direction-population-authoring-v0";
const POPULATION_COVERAGE_LAYOUT_MODE = "even-shell-coverage-layout-v0";
const STRIP_PROFILE_MODE = "selected-strip-profile-authoring-v0";
const SPHERE_CURVE_MODE = "sphere-curve-source-before-strip-mesh-v0";
const CURVE_INTERACTION_MODE = "sphere-curve-proximity-interaction-v0";
const LAMELLAR_ENVELOPE_MODE = "curve-family-envelope-loft-v0";
const LAMELLAR_ENVELOPE_COMPOSITION_MODE = "multi-eligible-population-envelope-composition-v0";
const LAMELLAR_ENVELOPE_EDGE_MODE = "smooth-envelope-body-crisp-rail-debug-v0";
const SHELL_ENCLOSURE_MODE = "sphere-shell-enclosure-composition-v0";
const STRIP_TOPOLOGY_MODE = "intra-strip-topology-members-v0";
const RIBBON_SHELL_OFFSET_MODE = "ribbon-shell-angular-offset-v0";
const SLICE_TOOL_MODE = "sphere-domain-lamellar-section-slicer-v0";
const CHANNEL_CUT_MODE = "neighbor-offset-envelope-terminal-channel-cut";
const CHANNEL_TERMINAL_CONTOUR_SOURCE = "neighbor-offset-envelope-rail-contour";
const CHANNEL_WITNESS_ANCHOR_MODE = "selected-neighbor-channel-closeup";
const GAP_PATTERNS = new Set(["solid", "single-window", "dashed", "crosscut"]);
const POPULATION_LAYOUT_PRESETS = new Set(["coverage", "cluster"]);
const MAX_LAYER_COUNT = 12;
const TAU = Math.PI * 2;
const MAX_COVERAGE_LANE_SPAN = 1.44;
const DEFAULT_POPULATION_RADIAL_SPACING = 0.04;
const MAX_POPULATION_RADIAL_SPACING = 0.14;
const MAX_POPULATION_RADIUS_OFFSET = 0.24;
const DIAGNOSTIC_LAYER_SEPARATION_SCALE = 2.15;

const VIEW_PRESETS = {
  cut_radius_coupling: { yaw: 0.72, pitch: 0.35, distance: 3.2 },
  cap_profile: { yaw: 1.42, pitch: 0.44, distance: 2.7 },
  malformed_contact_stress: { yaw: 0.86, pitch: 0.28, distance: 3.5 },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function chiralitySign(pattern, layerIndex, rand) {
  if (typeof pattern === "string" && /^[+-]+$/.test(pattern)) {
    return pattern[layerIndex % pattern.length] === "-" ? -1 : 1;
  }
  if (pattern === "alternating") return layerIndex % 2 === 0 ? 1 : -1;
  if (pattern === "counterpatch") return layerIndex === 1 ? -1 : 1;
  if (pattern === "mixed") return rand() > 0.52 ? 1 : -1;
  return 1;
}

function descriptorCurveOptions(descriptor) {
  return {
    theta0: descriptor.theta0,
    thetaTwist: descriptor.thetaTwist,
    phi0: descriptor.phi0,
    phiSlope: descriptor.phiSlope,
    phase: descriptor.phase,
    radius: descriptor.radius,
    width: descriptor.width,
    thickness: descriptor.thickness,
    widthVariance: descriptor.widthVariance,
    thicknessVariance: descriptor.thicknessVariance,
    edgeLift: descriptor.edgeLift,
    waviness: descriptor.waviness,
  };
}

function createChannelCutReceipt(descriptors, cutRadius, lower, upper) {
  const neighbor = descriptors.find(descriptor => descriptor.sliceParticipation === "cut-author-envelope")
    || descriptors.find(descriptor => descriptor.materialRole === "neighbor-envelope")
    || null;
  const selected = descriptors.find(descriptor => descriptor.sliceParticipation === "primary-cut-target")
    || descriptors.find(descriptor => descriptor.materialRole === "selected-source")
    || null;
  const gap = Number(clamp(cutRadius * 0.78, 0.018, 0.075).toFixed(4));
  const terminalRailStopCount = 30;
  const sampledClearanceBand = [Number((-gap * 0.02).toFixed(4)), Number((gap * 1.13).toFixed(4))];
  const affectedSegmentIds = selected ? [selected.id] : [];
  return {
    mode: CHANNEL_CUT_MODE,
    role: "cut-author-envelope",
    terminalContourSource: CHANNEL_TERMINAL_CONTOUR_SOURCE,
    channelGapRadius: gap,
    terminalRailStopCount,
    sampledClearanceBand,
    witnessAnchorMode: CHANNEL_WITNESS_ANCHOR_MODE,
    sourceSegmentId: neighbor?.id || null,
    sourceLayerSpecId: neighbor?.layerSpecId || null,
    sourceStripInstanceId: neighbor?.stripInstanceId || null,
    affectedSegmentIds,
    capTValues: [lower, upper],
  };
}

function createCutAuthorEnvelopeDescriptor(descriptor, channelCutReceipt) {
  if (!descriptor) return null;
  const envelopeDisplayWidth = Number(clamp(descriptor.width * 0.18, 0.012, 0.024).toFixed(4));
  return {
    role: "cut-author-envelope",
    mode: CHANNEL_CUT_MODE,
    sourceRole: descriptor.materialRole,
    sourceSegmentId: descriptor.id,
    sourceLayerSpecId: descriptor.layerSpecId,
    sourceStripInstanceId: descriptor.stripInstanceId,
    stripIndex: descriptor.stripIndex,
    layerIndex: descriptor.layerIndex,
    chunkiness: descriptor.chunkiness,
    authoredLayerWidth: descriptor.width,
    envelopeDisplayWidth,
    terminalContourSource: CHANNEL_TERMINAL_CONTOUR_SOURCE,
    channelGapRadius: channelCutReceipt.channelGapRadius,
    terminalRailStopCount: channelCutReceipt.terminalRailStopCount,
    sampledClearanceBand: channelCutReceipt.sampledClearanceBand,
    witnessAnchorMode: CHANNEL_WITNESS_ANCHOR_MODE,
  };
}

function clampPattern(pattern) {
  if (["same", "alternating", "counterpatch", "mixed"].includes(pattern)) return pattern;
  if (typeof pattern === "string" && /^[+-]+$/.test(pattern)) return pattern;
  return "same";
}

function normalizeLayerOverrides(overrides) {
  if (!Array.isArray(overrides)) return [];
  return overrides.map((override, layerIndex) => {
    const chirality = Number(override?.chirality);
    const chunkiness = Number(override?.chunkiness);
    const stripCount = Number(override?.stripCount);
    const radiusOffset = Number(override?.radiusOffset ?? override?.radius);
    return {
      layerIndex: Number.isFinite(Number(override?.layerIndex)) ? Math.round(Number(override.layerIndex)) : layerIndex,
      chirality: chirality < 0 ? -1 : 1,
      chunkiness: Number.isFinite(chunkiness) ? clamp(chunkiness, 0.05, 1) : null,
      stripCount: Number.isFinite(stripCount) ? Math.round(clamp(stripCount, 1, 4)) : null,
      radiusOffset: Number.isFinite(radiusOffset) ? Number(clamp(radiusOffset, -0.24, 0.24).toFixed(4)) : null,
    };
  });
}

function normalizeStripPopulations(populations) {
  if (!Array.isArray(populations)) return [];
  return populations.map((population, index) => {
    const layerIndex = Number(population?.layerIndex);
    const count = Number(population?.count);
    const chirality = Number(population?.chirality);
    const bearingOffset = Number(population?.bearingOffset);
    const bearingVariance = Number(population?.bearingVariance);
    const radialSpacingInput = Number(population?.radialSpacing);
    const radiusOffsetInput = Number(population?.radiusOffset ?? population?.radius);
    const role = ["lamella", "cutter", "accent"].includes(population?.role) ? population.role : "lamella";
    const layoutPreset = POPULATION_LAYOUT_PRESETS.has(population?.layoutPreset || population?.layout)
      ? (population.layoutPreset || population.layout)
      : "coverage";
    const normalizedCount = Number.isFinite(count) ? Math.round(clamp(count, 0, 16)) : 0;
    const spreadFallback = layoutPreset === "coverage" ? 1 : 0;
    const coverageSpread = Number.isFinite(bearingVariance)
      ? Number(clamp(bearingVariance, 0, 2).toFixed(4))
      : spreadFallback;
    const coverageSpacing = normalizedCount > 1 && layoutPreset === "coverage"
      ? Number((TAU * coverageSpread / normalizedCount).toFixed(4))
      : 0;
    const coverageSpan = normalizedCount > 1 && layoutPreset === "coverage"
      ? Number(clamp(coverageSpread * 0.84, 0, MAX_COVERAGE_LANE_SPAN).toFixed(4))
      : 0;
    const shellLaneSpacing = normalizedCount > 1 && layoutPreset === "coverage"
      ? Number((coverageSpan / (normalizedCount - 1)).toFixed(4))
      : 0;
    const radialSpacing = normalizedCount > 1
      ? Number((Number.isFinite(radialSpacingInput)
        ? clamp(radialSpacingInput, 0, MAX_POPULATION_RADIAL_SPACING)
        : DEFAULT_POPULATION_RADIAL_SPACING).toFixed(4))
      : 0;
    const radiusOffset = Number.isFinite(radiusOffsetInput)
      ? Number(clamp(radiusOffsetInput, -MAX_POPULATION_RADIUS_OFFSET, MAX_POPULATION_RADIUS_OFFSET).toFixed(4))
      : 0;
    const fallbackId = `strip-population-${Number.isFinite(layerIndex) ? Math.round(layerIndex) : 0}-${role}-${index}`;
    return {
      kind: "StripPopulationDescriptor",
      mode: STRIP_POPULATION_MODE,
      coverageLayoutMode: POPULATION_COVERAGE_LAYOUT_MODE,
      id: typeof population?.id === "string" && population.id ? population.id : fallbackId,
      layerIndex: Number.isFinite(layerIndex) ? Math.round(clamp(layerIndex, 0, MAX_LAYER_COUNT - 1)) : 0,
      role,
      layoutPreset,
      count: normalizedCount,
      chirality: chirality < 0 ? -1 : 1,
      bearingOffset: Number.isFinite(bearingOffset) ? Number(clamp(bearingOffset, -TAU, TAU).toFixed(4)) : 0,
      bearingVariance: coverageSpread,
      coverageSpacing,
      coverageSpan,
      shellLaneSpacing,
      radialSpacing,
      radiusOffset,
      gapPattern: normalizeGapPattern(population?.gapPattern),
      source: "macro-strip-population",
    };
  }).filter(population => population.count > 0);
}

function stripPopulationsFromMacroControls(input = {}) {
  const populationCount = Number(input.populationCount);
  const cutterCount = Number(input.cutterCount);
  const bearingVariance = Number(input.populationBearingVariance);
  if (!Number.isFinite(populationCount) && !Number.isFinite(cutterCount) && !Number.isFinite(bearingVariance)) return [];
  const baseCount = Number.isFinite(populationCount) ? Math.round(clamp(populationCount, 1, 16)) : 4;
  const cutters = Number.isFinite(cutterCount) ? Math.round(clamp(cutterCount, 0, 8)) : 0;
  const variance = Number.isFinite(bearingVariance) ? clamp(bearingVariance, 0.15, 2) : 1;
  const populations = [
    { layerIndex: 0, role: "lamella", count: baseCount, chirality: 1, layoutPreset: "coverage", bearingOffset: 0, bearingVariance: variance, gapPattern: "solid" },
  ];
  if (cutters > 0) {
    populations.push({ layerIndex: 0, role: "cutter", count: cutters, chirality: -1, layoutPreset: "coverage", bearingOffset: 0.44, bearingVariance: Math.max(0.15, variance * 0.55), gapPattern: "crosscut" });
  }
  return normalizeStripPopulations(populations);
}

function normalizeGapPattern(pattern) {
  return GAP_PATTERNS.has(pattern) ? pattern : "solid";
}

function normalizeStripProfileOverrides(overrides) {
  const list = Array.isArray(overrides) ? overrides : Object.values(overrides || {});
  return list.map(override => {
    const width = Number(override?.width);
    const thickness = Number(override?.thickness);
    const widthVariance = Number(override?.widthVariance);
    const thicknessVariance = Number(override?.thicknessVariance);
    const layerIndex = Number(override?.layerIndex);
    const stripIndex = Number(override?.stripIndex);
    return {
      kind: "StripProfileDescriptor",
      mode: STRIP_PROFILE_MODE,
      stripInstanceId: typeof override?.stripInstanceId === "string" ? override.stripInstanceId : null,
      layerIndex: Number.isFinite(layerIndex) ? Math.round(clamp(layerIndex, 0, 3)) : null,
      stripIndex: Number.isFinite(stripIndex) ? Math.round(clamp(stripIndex, 0, 7)) : null,
      width: Number.isFinite(width) ? Number(clamp(width, 0.006, 0.18).toFixed(4)) : null,
      thickness: Number.isFinite(thickness) ? Number(clamp(thickness, 0.002, 0.07).toFixed(4)) : null,
      widthVariance: Number.isFinite(widthVariance) ? Number(clamp(widthVariance, 0, 1).toFixed(4)) : 0,
      thicknessVariance: Number.isFinite(thicknessVariance) ? Number(clamp(thicknessVariance, 0, 1).toFixed(4)) : 0,
      gapPattern: normalizeGapPattern(override?.gapPattern),
      overrideSource: "ui-selected-strip-profile",
    };
  }).filter(override => override.stripInstanceId || (override.layerIndex !== null && override.stripIndex !== null));
}

function profileOverrideForStrip(overrides, strip) {
  return overrides.find(override => override.stripInstanceId === strip.id)
    || overrides.find(override => override.layerIndex === strip.layerIndex && override.stripIndex === strip.stripIndex)
    || null;
}

function splitStripByGapPattern(interval, gapPattern) {
  const [start, end] = interval;
  const span = end - start;
  const at = fraction => Number((start + span * fraction).toFixed(4));
  if (gapPattern === "single-window") return [[start, at(0.42)], [at(0.58), end]];
  if (gapPattern === "dashed") return [[start, at(0.22)], [at(0.38), at(0.62)], [at(0.78), end]];
  if (gapPattern === "crosscut") return [[start, at(0.34)], [at(0.4), at(0.6)], [at(0.66), end]];
  return [interval];
}

function emitStripDescriptors(output, descriptor) {
  const spans = splitStripByGapPattern(descriptor.interval, descriptor.gapPattern);
  if (spans.length === 1) {
    output.push(descriptor);
    return;
  }
  spans.forEach((span, gapIndex) => {
    output.push({
      ...descriptor,
      id: `${descriptor.id}-gap-${gapIndex}`,
      interval: span,
      gapIndex,
      gapSpanCount: spans.length,
      sourceSegmentId: descriptor.id,
    });
  });
}

function defaultStripCountForLayer(layerIndex, role) {
  if (role === "selected-source") return 2;
  if (role === "neighbor-envelope") return 2;
  return layerIndex === 2 ? 2 : 1;
}

export function generateLamellarLayerSpecs(input = {}) {
  const seed = Math.round(clamp(Number(input.seed ?? 17), 0, 99999));
  const numLayers = Math.round(clamp(Number(input.layerCount ?? input.numLayers ?? 2), 1, MAX_LAYER_COUNT));
  const depthSpacing = clamp(Number(input.depthSpacing ?? 0.035), 0.015, 0.09);
  const overlapBias = clamp(Number(input.overlapBias ?? 0.38), 0, 1);
  const chunkinessBase = clamp(Number(input.chunkinessBase ?? 0.48), 0.05, 1);
  const chunkinessVariance = clamp(Number(input.chunkinessVariance ?? 0.22), 0, 0.65);
  const chiralityPattern = clampPattern(input.chiralityPattern ?? input.chirality ?? "same");
  const layerOverrides = normalizeLayerOverrides(input.layerOverrides);
  const rand = mulberry32(seed ^ 0x9e3779b9);
  const layerSpecs = [];

  for (let layerIndex = 0; layerIndex < numLayers; layerIndex++) {
    const layerOverride = layerOverrides.find(override => override.layerIndex === layerIndex);
    const chirality = layerOverride?.chirality ?? chiralitySign(chiralityPattern, layerIndex, rand);
    const role = layerIndex === 0 ? "selected-source" : layerIndex === 1 ? "neighbor-envelope" : "nested-placeholder-shell";
    const depthStep = layerIndex === 0 ? 0 : depthSpacing * (layerIndex === 1 ? -0.35 : layerIndex);
    const depth = Number((depthStep * DIAGNOSTIC_LAYER_SEPARATION_SCALE).toFixed(4));
    const radiusOffset = Number((layerOverride?.radiusOffset ?? 0).toFixed(4));
    const layerWeight = layerIndex === 0 ? 0.15 : layerIndex === 1 ? 0.05 : -0.04 * layerIndex;
    const variance = (rand() * 2 - 1) * chunkinessVariance;
    const chunkiness = Number((layerOverride?.chunkiness ?? clamp(chunkinessBase + layerWeight + variance, 0.05, 1)).toFixed(3));
    const stripCount = layerOverride?.stripCount ?? defaultStripCountForLayer(layerIndex, role);
    const stripIds = Array.from({ length: stripCount }, (_, stripIndex) => `seed-${seed}-layer-${layerIndex}-strip-${stripIndex}`);
    layerSpecs.push({
      kind: "LamellarLayerSpec",
      shellKind: "LayerShellDescriptor",
      shellMode: LAYER_SHELL_MODE,
      id: `seed-${seed}-layer-${layerIndex}-spec`,
      layerIndex,
      enabled: true,
      materialRole: role,
      chirality,
      chiralityPattern,
      depth,
      radiusOffset,
      diagnosticLayerSeparationScale: DIAGNOSTIC_LAYER_SEPARATION_SCALE,
      chunkiness,
      width: Number((0.018 + chunkiness * (role === "selected-source" ? 0.095 : role === "neighbor-envelope" ? 0.08 : 0.045)).toFixed(4)),
      thickness: Number((0.006 + chunkiness * 0.022).toFixed(4)),
      stripCount,
      stripIds,
      segmentCount: stripCount,
      intervalBias: Number(((rand() - 0.5) * (0.12 + overlapBias * 0.1)).toFixed(4)),
      phase: Number((layerIndex * 0.57 + rand() * 0.9).toFixed(4)),
      overlapBias: Number(overlapBias.toFixed(4)),
      overrideSource: layerOverride ? "ui-layer-row" : "generated-layer-stack",
      sliceParticipation: role === "selected-source" ? "primary-cut-target" : role === "neighbor-envelope" ? "cut-author-envelope" : "background-layer",
    });
  }

  return {
    layerStackDescriptor: {
      kind: "LayerStackDescriptor",
      mode: LAYER_STACK_MODE,
      proceduralSeed: seed,
      numLayers,
      chiralityPattern,
      chunkinessBase: Number(chunkinessBase.toFixed(4)),
      chunkinessVariance: Number(chunkinessVariance.toFixed(4)),
      depthSpacing: Number(depthSpacing.toFixed(4)),
      diagnosticLayerSeparationScale: DIAGNOSTIC_LAYER_SEPARATION_SCALE,
      layerRadiusMode: "layer-shell-radius-offset-before-curve-mesh-derivation",
      overlapBias: Number(overlapBias.toFixed(4)),
      layerOverrides: layerOverrides.slice(0, numLayers),
      layerSpecIds: layerSpecs.map(spec => spec.id),
      layerShellKind: "LayerShellDescriptor",
      stripInstanceKind: "LamellarStripInstance",
      stripInstanceIds: layerSpecs.flatMap(spec => spec.stripIds),
      authoringModel: "layer-shells-own-strip-instances-before-section-generation",
    },
    layerSpecs,
  };
}

export function generateLamellarStripInstances(layerSpecs, input = {}) {
  const seed = Math.round(clamp(Number(input.seed ?? 17), 0, 99999));
  const stripProfileOverrides = normalizeStripProfileOverrides(input.stripProfileOverrides);
  const stripPopulationDescriptors = normalizeStripPopulations(input.stripPopulationDescriptors || input.stripPopulations);
  const stripInstances = [];

  for (const spec of layerSpecs) {
    const authoredPopulations = stripPopulationDescriptors.filter(population => population.layerIndex === spec.layerIndex);
    const populations = authoredPopulations.length
      ? authoredPopulations
      : [{
        id: `${spec.id}-default-population`,
        role: spec.materialRole === "neighbor-envelope" ? "cutter" : "lamella",
        count: spec.stripCount,
        chirality: spec.chirality,
        bearingOffset: 0,
        bearingVariance: 1,
        coverageSpacing: spec.stripCount > 1 ? Number((TAU / spec.stripCount).toFixed(4)) : 0,
        coverageSpan: spec.stripCount > 1 ? 0.84 : 0,
        shellLaneSpacing: spec.stripCount > 1 ? Number((0.84 / (spec.stripCount - 1)).toFixed(4)) : 0,
        radialSpacing: spec.stripCount > 1 ? DEFAULT_POPULATION_RADIAL_SPACING : 0,
        radiusOffset: 0,
        layoutPreset: "coverage",
        gapPattern: "solid",
        source: "layer-shell-default-population",
      }];
    let shellStripIndex = 0;
    for (const population of populations) {
      for (let populationIndex = 0; populationIndex < population.count; populationIndex++) {
        const stripIndex = shellStripIndex;
        const isPrimarySelected = spec.materialRole === "selected-source" && stripIndex === 0;
        const isCutAuthor = (spec.materialRole === "neighbor-envelope" && stripIndex === 0) || population.role === "cutter";
        const role = isCutAuthor ? "neighbor-envelope"
          : spec.materialRole === "neighbor-envelope" ? "neighbor-companion"
          : spec.materialRole;
        const authoredCount = populations.reduce((sum, item) => sum + item.count, 0);
        const localOffset = stripIndex - (authoredCount - 1) / 2;
        const layoutPreset = population.layoutPreset || "coverage";
        const populationSpread = Number(population.bearingVariance ?? 1);
        const coverageSpacing = population.count > 1 && layoutPreset === "coverage"
          ? Number((TAU * populationSpread / population.count).toFixed(4))
          : 0;
        const coverageSpan = population.count > 1 && layoutPreset === "coverage"
          ? Number(clamp((population.coverageSpan ?? populationSpread * 0.84), 0, MAX_COVERAGE_LANE_SPAN).toFixed(4))
          : 0;
        const shellLaneSpacing = population.count > 1 && layoutPreset === "coverage"
          ? Number((coverageSpan / (population.count - 1)).toFixed(4))
          : 0;
        const radialSpacing = population.count > 1
          ? Number(clamp(population.radialSpacing ?? DEFAULT_POPULATION_RADIAL_SPACING, 0, MAX_POPULATION_RADIAL_SPACING).toFixed(4))
          : 0;
        const centeredPopulationSlot = population.count > 1 ? populationIndex - (population.count - 1) / 2 : 0;
        const clusterJitter = population.count > 1
          ? ((populationIndex / Math.max(1, population.count - 1)) - 0.5) * populationSpread
          : 0;
        const bearingPhase = Number((population.bearingOffset + (layoutPreset === "coverage"
          ? centeredPopulationSlot * coverageSpacing
          : clusterJitter)).toFixed(4));
        const shellLaneOffset = Number((layoutPreset === "coverage"
          ? centeredPopulationSlot * shellLaneSpacing
          : centeredPopulationSlot * 0.024).toFixed(4));
        const radialOffset = Number((centeredPopulationSlot * radialSpacing).toFixed(4));
        const populationRadiusOffset = Number(clamp(population.radiusOffset ?? 0, -MAX_POPULATION_RADIUS_OFFSET, MAX_POPULATION_RADIUS_OFFSET).toFixed(4));
        const layerRadiusOffset = Number((spec.radiusOffset || 0).toFixed(4));
        const totalRadiusOffset = Number((layerRadiusOffset + populationRadiusOffset).toFixed(4));
        const baseStrip = {
          id: spec.stripIds[stripIndex] || `seed-${seed}-layer-${spec.layerIndex}-strip-${stripIndex}`,
          layerIndex: spec.layerIndex,
          stripIndex,
        };
        const override = profileOverrideForStrip(stripProfileOverrides, baseStrip);
        const baseWidth = Number((spec.width * (1 - Math.abs(localOffset) * 0.08)).toFixed(4));
        const baseThickness = spec.thickness;
        const gapPattern = override?.gapPattern ?? population.gapPattern ?? "solid";
        const stripProfileDescriptor = {
          kind: "StripProfileDescriptor",
          mode: STRIP_PROFILE_MODE,
          stripInstanceId: baseStrip.id,
          layerSpecId: spec.id,
          layerIndex: spec.layerIndex,
          stripIndex,
          width: override?.width ?? baseWidth,
          thickness: override?.thickness ?? baseThickness,
          widthVariance: override?.widthVariance ?? 0,
          thicknessVariance: override?.thicknessVariance ?? 0,
          gapPattern,
          overrideSource: override ? override.overrideSource : "layer-shell-derived-profile",
        };
        stripInstances.push({
          kind: "LamellarStripInstance",
          id: baseStrip.id,
          layerSpecId: spec.id,
          layerIndex: spec.layerIndex,
          stripIndex,
          populationId: population.id,
          populationRole: population.role,
          populationIndex,
          layoutPreset,
          coverageSpacing,
          coverageSpan,
          shellLaneSpacing,
          shellLaneOffset,
          radialSpacing,
          radialOffset,
          populationRadiusOffset,
          layerRadiusOffset,
          totalRadiusOffset,
          coverageSlot: populationIndex,
          bearingPhase,
          stripCount: authoredCount,
          materialRole: role,
          layerMaterialRole: spec.materialRole,
          sliceParticipation: isPrimarySelected ? "primary-cut-target" : isCutAuthor ? "cut-author-envelope" : "same-shell-companion",
          chirality: population.chirality,
          chunkiness: spec.chunkiness,
          depth: spec.depth,
          radiusOffset: totalRadiusOffset,
          effectiveDepth: Number((spec.depth + totalRadiusOffset + radialOffset).toFixed(4)),
          profileKind: "StripProfileDescriptor",
          stripProfileDescriptor,
          width: stripProfileDescriptor.width,
          thickness: stripProfileDescriptor.thickness,
          widthVariance: stripProfileDescriptor.widthVariance,
          thicknessVariance: stripProfileDescriptor.thicknessVariance,
          gapPattern,
          intervalOffset: Number((localOffset * 0.045 + stripIndex * 0.012).toFixed(4)),
          phaseOffset: Number((localOffset * 0.12 + bearingPhase).toFixed(4)),
        });
        shellStripIndex += 1;
      }
    }
  }

  return stripInstances;
}

function curveIntervalForStrip(strip, spec) {
  if (strip.layerIndex === 0) {
    const start = Number(clamp(0.12 + strip.intervalOffset, 0.08, 0.38).toFixed(4));
    const end = Number(clamp(0.9 + strip.intervalOffset * 0.4, 0.58, 0.94).toFixed(4));
    return [start, end];
  }
  const baseStart = spec.layerMaterialRole === "neighbor-envelope" || spec.materialRole === "neighbor-envelope"
    ? 0.24 + (0.42 - spec.overlapBias) * 0.18
    : 0.08 + (strip.stripIndex % 2) * 0.04;
  const baseEnd = spec.layerMaterialRole === "neighbor-envelope" || spec.materialRole === "neighbor-envelope"
    ? 0.72 + spec.overlapBias * 0.18
    : 0.82 + (strip.stripIndex % 2) * 0.04;
  return [
    Number(clamp(baseStart + spec.intervalBias + strip.intervalOffset, 0.08, 0.44).toFixed(4)),
    Number(clamp(baseEnd + spec.intervalBias + strip.intervalOffset * 0.6, 0.62, 0.94).toFixed(4)),
  ];
}

function applyShellEnclosureToShape(shape, strip, spec, shellEnclosure) {
  const amount = clamp(Number(shellEnclosure ?? 0), 0, 1);
  if (amount <= 0) return { ...shape, shellEnclosure: 0 };
  const layerBand = Math.sin(strip.bearingPhase + spec.layerIndex * 0.72 + strip.populationIndex * 0.38);
  const chiralityBand = (strip.chirality < 0 ? -1 : 1) * Math.cos(strip.bearingPhase * 0.5 + spec.layerIndex * 0.41);
  const enclosedPhi0 = shape.phi0 * 0.35 + layerBand * 0.58 + chiralityBand * 0.16;
  return {
    ...shape,
    thetaTwist: Number((shape.thetaTwist * (1 + amount * 0.14)).toFixed(6)),
    phi0: Number((shape.phi0 * (1 - amount) + enclosedPhi0 * amount).toFixed(6)),
    phiSlope: Number((shape.phiSlope * (1 + amount * 0.62)).toFixed(6)),
    waviness: Number(((shape.waviness ?? 0.085) * (1 + amount * 0.18)).toFixed(6)),
    shellEnclosure: Number(amount.toFixed(4)),
  };
}

function curveShapeForStrip(strip, spec, selectedShape, selectedPhase, shellEnclosure = 0) {
  const stripChirality = strip.chirality < 0 ? -1 : 1;
  if (strip.layerIndex === 0) {
    return applyShellEnclosureToShape({
      theta0: selectedShape.theta0 + strip.bearingPhase * 0.22,
      thetaTwist: Math.abs(selectedShape.thetaTwist) * stripChirality,
      phi0: selectedShape.phi0 + strip.intervalOffset * 0.12 + strip.shellLaneOffset + Math.sin(strip.bearingPhase) * 0.035,
      phiSlope: selectedShape.phiSlope,
      phase: selectedPhase + strip.phaseOffset,
      edgeLift: 0.018 + strip.stripIndex * 0.002,
      waviness: 0.085,
    }, strip, spec, shellEnclosure);
  }
  const isCutAuthor = strip.sliceParticipation === "cut-author-envelope";
  return applyShellEnclosureToShape({
    theta0: -0.98 + spec.layerIndex * 0.28 + strip.bearingPhase * 0.22 + (isCutAuthor ? 0 : 0.04),
    thetaTwist: stripChirality * (4.36 + strip.stripIndex * 0.08),
    phi0: -0.3 + spec.layerIndex * 0.035 + strip.intervalOffset * 0.12 + strip.shellLaneOffset + Math.sin(strip.bearingPhase) * 0.03,
    phiSlope: 0.86 + strip.stripIndex * 0.04,
    phase: spec.phase + strip.phaseOffset,
    edgeLift: strip.materialRole === "neighbor-envelope" ? 0.015 : 0.012,
    waviness: 0.085,
  }, strip, spec, shellEnclosure);
}

export function generateSphereCurveDescriptors(input = {}) {
  const {
    seed = 17,
    layerSpecs = [],
    stripInstances = [],
    composerDescriptor = {},
    selectedShape = {},
    selectedPhase = 0,
  } = input;
  const shellEnclosure = clamp(Number(composerDescriptor.shellEnclosure ?? input.shellEnclosure ?? 0), 0, 1);
  const selectedSpec = layerSpecs[0] || {};
  return stripInstances.map(strip => {
    const spec = layerSpecs.find(layerSpec => layerSpec.id === strip.layerSpecId) || selectedSpec;
    const shape = curveShapeForStrip(strip, spec, selectedShape, selectedPhase, shellEnclosure);
    const interval = curveIntervalForStrip(strip, spec);
    return {
      kind: "SphereCurveDescriptor",
      mode: SPHERE_CURVE_MODE,
      id: `${strip.id}-sphere-curve`,
      sourceStripInstanceId: strip.id,
      sourcePopulationId: strip.populationId,
      sourceLayerSpecId: spec.id,
      sourceStripKind: strip.kind,
      sourcePopulationRole: strip.populationRole,
      layerSpecId: spec.id,
      stripInstanceId: strip.id,
      stripIndex: strip.stripIndex,
      populationId: strip.populationId,
      populationRole: strip.populationRole,
      populationIndex: strip.populationIndex,
      layoutPreset: strip.layoutPreset,
      coverageSpacing: strip.coverageSpacing,
      coverageSpan: strip.coverageSpan,
      shellLaneSpacing: strip.shellLaneSpacing,
      shellLaneOffset: strip.shellLaneOffset,
      radialSpacing: strip.radialSpacing,
      radialOffset: strip.radialOffset,
      populationRadiusOffset: strip.populationRadiusOffset,
      layerRadiusOffset: strip.layerRadiusOffset,
      totalRadiusOffset: strip.totalRadiusOffset,
      coverageSlot: strip.coverageSlot,
      bearingPhase: strip.bearingPhase,
      materialRole: strip.materialRole,
      layerMaterialRole: strip.layerMaterialRole,
      sliceParticipation: strip.sliceParticipation,
      source: strip.layerIndex === 0 && strip.sliceParticipation === "primary-cut-target"
        ? "procedural-composer"
        : "layer-shell-strip-assemblage",
      layerIndex: strip.layerIndex,
      depth: strip.depth,
      radiusOffset: strip.radiusOffset || 0,
      populationRadiusOffset: strip.populationRadiusOffset || 0,
      layerRadiusOffset: strip.layerRadiusOffset || 0,
      totalRadiusOffset: strip.totalRadiusOffset || strip.radiusOffset || 0,
      effectiveDepth: strip.effectiveDepth,
      chirality: strip.chirality,
      chunkiness: strip.chunkiness,
      segmentCount: spec.segmentCount,
      stripCount: spec.stripCount,
      interval,
      curveLaw: composerDescriptor.curveLaw || "poloxodromic-sphere-strip-v0",
      capLaw: composerDescriptor.capLaw || END_CAP_SEALING_MODE,
      theta0: shape.theta0,
      thetaTwist: shape.thetaTwist,
      phi0: shape.phi0,
      phiSlope: shape.phiSlope,
      phase: shape.phase,
      shellEnclosure,
      shellEnclosureMode: SHELL_ENCLOSURE_MODE,
      radius: Number((1 + strip.effectiveDepth).toFixed(4)),
      width: strip.width,
      thickness: strip.thickness,
      widthVariance: strip.widthVariance,
      thicknessVariance: strip.thicknessVariance,
      gapPattern: strip.gapPattern,
      stripProfileKind: "StripProfileDescriptor",
      stripProfileDescriptor: strip.stripProfileDescriptor,
      edgeLift: shape.edgeLift,
      waviness: shape.waviness,
      proceduralSeed: seed,
    };
  });
}

function angularDelta(a, b) {
  const diff = Math.abs(a - b) % TAU;
  return diff > Math.PI ? TAU - diff : diff;
}

function intervalOverlapAmount(a, b) {
  return Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
}

function curvePointAt(curve, t) {
  const theta = curve.theta0 + curve.thetaTwist * t;
  const phi = curve.phi0 + curve.phiSlope * (t - 0.5) + Math.sin(t * Math.PI * 2 + curve.phase) * (curve.waviness ?? 0.08);
  return spherePoint(theta, phi, curve.radius || 1);
}

function pointDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function curveInteractionKind(a, b) {
  if (a.layerIndex !== b.layerIndex) return "cross-layer-proximity";
  if (a.sourcePopulationId === b.sourcePopulationId) return "same-population-proximity";
  return "same-layer-cross-population-proximity";
}

function vectorToArray(v) {
  return [Number(v.x.toFixed(5)), Number(v.y.toFixed(5)), Number(v.z.toFixed(5))];
}

function sortedPopulationCurves(curves) {
  return curves.slice().sort((a, b) => (a.populationIndex ?? a.stripIndex ?? 0) - (b.populationIndex ?? b.stripIndex ?? 0));
}

function sampleEnvelopeRows(curves, interval, rowCount = 24) {
  const ordered = sortedPopulationCurves(curves);
  const rows = [];
  for (let rowIndex = 0; rowIndex <= rowCount; rowIndex++) {
    const t = interval[0] + (interval[1] - interval[0]) * (rowIndex / rowCount);
    const points = ordered.map(curve => curvePointAt(curve, t));
    const first = points[0];
    const second = points[1] || points[0];
    const last = points[points.length - 1];
    const beforeLast = points[points.length - 2] || last;
    const firstOut = normalizeVector({ x: first.x - second.x, y: first.y - second.y, z: first.z - second.z });
    const lastOut = normalizeVector({ x: last.x - beforeLast.x, y: last.y - beforeLast.y, z: last.z - beforeLast.z });
    const edgePad = Math.max(...ordered.map(curve => curve.width || 0.04)) * 0.55;
    const outerStart = addScaledVector(first, firstOut, edgePad);
    const outerEnd = addScaledVector(last, lastOut, edgePad);
    const surfacePoints = [outerStart, ...points, outerEnd];
    const center = surfacePoints.reduce((acc, point) => ({
      x: acc.x + point.x / surfacePoints.length,
      y: acc.y + point.y / surfacePoints.length,
      z: acc.z + point.z / surfacePoints.length,
    }), { x: 0, y: 0, z: 0 });
    const radii = surfacePoints.map(point => vectorLength(point));
    rows.push({
      t: Number(t.toFixed(4)),
      center: vectorToArray(center),
      points: surfacePoints.map(vectorToArray),
      shellRadiusRange: [Number(Math.min(...radii).toFixed(4)), Number(Math.max(...radii).toFixed(4))],
    });
  }
  return rows;
}

export function generateLamellarEnvelopeDescriptors(sphereCurveDescriptors = []) {
  const groups = new Map();
  for (const curve of sphereCurveDescriptors) {
    if (curve.populationRole !== "lamella") continue;
    if (!curve.populationId) continue;
    const key = `${curve.layerSpecId}:${curve.populationId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(curve);
  }
  const descriptors = [];
  for (const curves of groups.values()) {
    const ordered = sortedPopulationCurves(curves);
    if (ordered.length < 3) continue;
    const interval = [
      Number(Math.max(...ordered.map(curve => curve.interval[0])).toFixed(4)),
      Number(Math.min(...ordered.map(curve => curve.interval[1])).toFixed(4)),
    ];
    if (interval[1] - interval[0] < 0.18) continue;
    const sampleRows = sampleEnvelopeRows(ordered, interval);
    const envelopeRails = [
      sampleRows.map(row => row.points[0]),
      sampleRows.map(row => row.points[row.points.length - 1]),
    ];
    const sourceCurveIds = ordered.map(curve => curve.id);
    const sourceStripInstanceIds = ordered.map(curve => curve.stripInstanceId);
    const widths = ordered.map(curve => curve.width || 0);
    const radii = sampleRows.flatMap(row => row.shellRadiusRange);
    descriptors.push({
      kind: "LamellarEnvelopeDescriptor",
      mode: LAMELLAR_ENVELOPE_MODE,
      compositionMode: LAMELLAR_ENVELOPE_COMPOSITION_MODE,
      enclosureMode: SHELL_ENCLOSURE_MODE,
      shellEnclosure: ordered[0].shellEnclosure ?? 0,
      edgeLegibilityMode: LAMELLAR_ENVELOPE_EDGE_MODE,
      id: `${ordered[0].populationId}-envelope-loft`,
      sourceCurveMode: SPHERE_CURVE_MODE,
      meshSource: "curve-family-envelope-before-strip-mesh",
      layerSpecId: ordered[0].layerSpecId,
      layerIndex: ordered[0].layerIndex,
      populationId: ordered[0].populationId,
      populationRole: ordered[0].populationRole,
      materialRole: "selected-envelope",
      sliceParticipation: "population-envelope-body",
      sourceCurveIds,
      sourceStripInstanceIds,
      sourcePopulationId: ordered[0].populationId,
      interval,
      capTValues: interval,
      envelopeRails,
      sampleRows,
      rowCount: sampleRows.length,
      columnCount: sampleRows[0]?.points.length || 0,
      widthRange: [Number(Math.min(...widths).toFixed(4)), Number(Math.max(...widths).toFixed(4))],
      shellRadiusRange: [Number(Math.min(...radii).toFixed(4)), Number(Math.max(...radii).toFixed(4))],
      mergePolicy: "skin-guide-curve-family-first",
      slicePolicy: "slice-envelope-after-curve-family-loft-next",
    });
  }
  return descriptors;
}

function createCurveInteractionReceipt(sphereCurveDescriptors) {
  const closeApproaches = [];
  for (let i = 0; i < sphereCurveDescriptors.length; i++) {
    for (let j = i + 1; j < sphereCurveDescriptors.length; j++) {
      const a = sphereCurveDescriptors[i];
      const b = sphereCurveDescriptors[j];
      const radiusDelta = Math.abs((a.radius || 0) - (b.radius || 0));
      const phiDelta = Math.abs((a.phi0 || 0) - (b.phi0 || 0));
      const thetaDelta = angularDelta(a.theta0 || 0, b.theta0 || 0);
      const intervalOverlap = intervalOverlapAmount(a.interval, b.interval);
      if (intervalOverlap <= 0.08) continue;
      const overlapStart = Math.max(a.interval[0], b.interval[0]);
      const overlapEnd = Math.min(a.interval[1], b.interval[1]);
      let closestDistance = Infinity;
      let closestT = overlapStart;
      for (let sampleIndex = 0; sampleIndex <= 6; sampleIndex++) {
        const t = overlapStart + (overlapEnd - overlapStart) * (sampleIndex / 6);
        const distance = pointDistance(curvePointAt(a, t), curvePointAt(b, t));
        if (distance < closestDistance) {
          closestDistance = distance;
          closestT = t;
        }
      }
      const domainClearance = radiusDelta + phiDelta + thetaDelta * 0.12;
      const minimumUsefulClearance = Math.max(0.035, (a.width + b.width) * 0.75);
      if (closestDistance < minimumUsefulClearance || domainClearance < minimumUsefulClearance) {
        closeApproaches.push({
          curveIds: [a.id, b.id],
          interactionKind: curveInteractionKind(a, b),
          populationIds: [a.sourcePopulationId, b.sourcePopulationId],
          layerIndexes: [a.layerIndex, b.layerIndex],
          radiusDelta: Number(radiusDelta.toFixed(4)),
          phiDelta: Number(phiDelta.toFixed(4)),
          thetaDelta: Number(thetaDelta.toFixed(4)),
          intervalOverlap: Number(intervalOverlap.toFixed(4)),
          closestDistance: Number(closestDistance.toFixed(4)),
          closestT: Number(closestT.toFixed(4)),
          minimumUsefulClearance: Number(minimumUsefulClearance.toFixed(4)),
          policyStatus: "observed-only-needs-topological-resolution",
        });
      }
    }
  }
  return {
    kind: "CurveInteractionReceipt",
    mode: CURVE_INTERACTION_MODE,
    policy: "detect-before-mesh-emission",
    curveSourceMode: SPHERE_CURVE_MODE,
    curveCount: sphereCurveDescriptors.length,
    populationIds: Array.from(new Set(sphereCurveDescriptors.map(curve => curve.sourcePopulationId).filter(Boolean))),
    closeApproachCount: closeApproaches.length,
    closeApproaches,
  };
}

function emitCurveSectionDescriptor(output, curve, seed) {
  emitStripDescriptors(output, {
    kind: "LamellarSectionSegment",
    stripKind: "LamellarStripInstance",
    stripProfileKind: "StripProfileDescriptor",
    sourceCurveKind: "SphereCurveDescriptor",
    sourceCurveId: curve.id,
    curveSourceMode: curve.mode,
    meshSource: "sphere-curve-descriptor",
    id: curve.topologyRole === "intra-strip-member"
      ? `${curve.id}-section`
      : curve.layerIndex === 0 && curve.sliceParticipation === "primary-cut-target"
      ? `seed-${seed}-layer-0-selected-source`
      : curve.layerIndex === 0
        ? `${curve.stripInstanceId}-selected-companion`
        : `${curve.stripInstanceId}-${curve.materialRole}`,
    topologyMode: curve.topologyMode || null,
    topologyRole: curve.topologyRole || null,
    topologyMemberIndex: curve.topologyMemberIndex ?? null,
    topologyMemberCount: curve.topologyMemberCount ?? null,
    sourceParentCurveId: curve.sourceParentCurveId || null,
    sourceParentStripInstanceId: curve.sourceParentStripInstanceId || null,
    layerSpecId: curve.layerSpecId,
    stripInstanceId: curve.stripInstanceId,
    stripIndex: curve.stripIndex,
    populationId: curve.populationId,
    populationRole: curve.populationRole,
    populationIndex: curve.populationIndex,
    layoutPreset: curve.layoutPreset,
    coverageSpacing: curve.coverageSpacing,
    coverageSpan: curve.coverageSpan,
    shellLaneSpacing: curve.shellLaneSpacing,
    shellLaneOffset: curve.shellLaneOffset,
    radialSpacing: curve.radialSpacing,
    radialOffset: curve.radialOffset,
    radiusOffset: curve.radiusOffset || 0,
    populationRadiusOffset: curve.populationRadiusOffset || 0,
    layerRadiusOffset: curve.layerRadiusOffset || 0,
    totalRadiusOffset: curve.totalRadiusOffset || curve.radiusOffset || 0,
    coverageSlot: curve.coverageSlot,
    bearingPhase: curve.bearingPhase,
    source: curve.source,
    materialRole: curve.materialRole,
    layerMaterialRole: curve.layerMaterialRole,
    sliceParticipation: curve.sliceParticipation,
    layerIndex: curve.layerIndex,
    depth: curve.depth,
    radiusOffset: curve.radiusOffset || 0,
    populationRadiusOffset: curve.populationRadiusOffset || 0,
    layerRadiusOffset: curve.layerRadiusOffset || 0,
    totalRadiusOffset: curve.totalRadiusOffset || curve.radiusOffset || 0,
    effectiveDepth: curve.effectiveDepth,
    chirality: curve.chirality,
    chunkiness: curve.chunkiness,
    segmentCount: curve.segmentCount,
    stripCount: curve.stripCount,
    interval: curve.interval,
    curveLaw: curve.curveLaw,
    capLaw: curve.capLaw,
    theta0: curve.theta0,
    thetaTwist: curve.thetaTwist,
    phi0: curve.phi0,
    phiSlope: curve.phiSlope,
    phase: curve.phase,
    radius: curve.radius,
    width: curve.width,
    thickness: curve.thickness,
    widthVariance: curve.widthVariance,
    thicknessVariance: curve.thicknessVariance,
    gapPattern: curve.gapPattern,
    stripProfileDescriptor: curve.stripProfileDescriptor,
    edgeLift: curve.edgeLift,
    waviness: curve.waviness,
  });
}

function normalizeStripTopologyCount(input = {}) {
  const count = typeof input === "number"
    ? input
    : Number(input.stripTopologyCount ?? input.topologyMemberCount ?? 0);
  return Number.isFinite(count) ? Math.round(clamp(count, 0, 4)) : 0;
}

function generateStripTopologyDescriptors(primaryCurves = [], input = {}) {
  const stripTopologyCount = normalizeStripTopologyCount(input);
  if (stripTopologyCount <= 0) return [];
  const topologyDescriptors = [];
  for (const curve of primaryCurves) {
    if (curve.populationRole !== "lamella") continue;
    if (curve.topologyRole) continue;
    for (let topologyMemberIndex = 0; topologyMemberIndex < stripTopologyCount; topologyMemberIndex++) {
      const centered = topologyMemberIndex - (stripTopologyCount - 1) / 2;
      const phiOffset = centered * Math.max(curve.width * 1.35, 0.045);
      const thetaOffset = centered * 0.038;
      const intervalInset = Math.min(0.024, Math.max(0.01, (curve.interval[1] - curve.interval[0]) * 0.04));
      const interval = [
        Number(clamp(curve.interval[0] + intervalInset, 0.06, 0.88).toFixed(4)),
        Number(clamp(curve.interval[1] - intervalInset, 0.12, 0.96).toFixed(4)),
      ];
      if (interval[1] - interval[0] < 0.12) continue;
      topologyDescriptors.push({
        ...curve,
        id: `${curve.id}-topology-${topologyMemberIndex}`,
        source: "intra-strip-topology-expansion",
        sourceStripKind: "LamellarStripTopologyMember",
        sourceParentCurveId: curve.id,
        sourceParentStripInstanceId: curve.stripInstanceId,
        topologyMode: STRIP_TOPOLOGY_MODE,
        topologyRole: "intra-strip-member",
        topologyMemberIndex,
        topologyMemberCount: stripTopologyCount,
        materialRole: "strip-topology-member",
        sliceParticipation: "same-shell-topology-member",
        interval,
        theta0: Number((curve.theta0 + thetaOffset).toFixed(6)),
        phi0: Number((curve.phi0 + phiOffset).toFixed(6)),
        phase: Number((curve.phase + centered * 0.31).toFixed(6)),
        width: Number(clamp(curve.width * 0.28, 0.006, 0.026).toFixed(4)),
        thickness: Number(clamp(curve.thickness * 0.68, 0.002, 0.05).toFixed(4)),
        edgeLift: Number(((curve.edgeLift ?? 0.012) + Math.abs(centered) * 0.004).toFixed(4)),
        gapPattern: "solid",
      });
    }
  }
  return topologyDescriptors;
}

export function generateLamellarSectionSegments(input = {}) {
  const seed = Math.round(clamp(Number(input.seed ?? 17), 0, 99999));
  const shellEnclosure = Number(clamp(Number(input.shellEnclosure ?? input.enclosure ?? 0), 0, 1).toFixed(4));
  const stripTopologyCount = normalizeStripTopologyCount(input);
  const layerStack = generateLamellarLayerSpecs(input);
  const { layerStackDescriptor, layerSpecs } = layerStack;
  const stripProfileOverrides = normalizeStripProfileOverrides(input.stripProfileOverrides);
  const explicitPopulations = normalizeStripPopulations(input.stripPopulations);
  const macroPopulations = stripPopulationsFromMacroControls(input);
  const stripPopulationDescriptors = explicitPopulations.length ? explicitPopulations : macroPopulations;
  const stripInstances = generateLamellarStripInstances(layerSpecs, { seed, stripProfileOverrides, stripPopulationDescriptors });
  const rand = mulberry32(seed);
  const descriptors = [];
  const composerDescriptor = {
    mode: COMPOSER_MODE,
    segmentKind: "LamellarSectionSegment",
    layerStackKind: "LayerStackDescriptor",
    layerShellKind: "LayerShellDescriptor",
    stripInstanceKind: "LamellarStripInstance",
    stripPopulationKind: "StripPopulationDescriptor",
    stripProfileKind: "StripProfileDescriptor",
    proceduralSeed: seed,
    chiralityPattern: layerStackDescriptor.chiralityPattern,
    layerCount: layerStackDescriptor.numLayers,
    numLayers: layerStackDescriptor.numLayers,
    chunkinessBase: layerStackDescriptor.chunkinessBase,
    chunkinessVariance: layerStackDescriptor.chunkinessVariance,
    depthSpacing: layerStackDescriptor.depthSpacing,
    overlapBias: layerStackDescriptor.overlapBias,
    shellEnclosure,
    shellEnclosureMode: SHELL_ENCLOSURE_MODE,
    stripTopologyMode: STRIP_TOPOLOGY_MODE,
    stripTopologyCount,
    curveLaw: "poloxodromic-sphere-strip-v0",
    capLaw: END_CAP_SEALING_MODE,
    sphereCurveKind: "SphereCurveDescriptor",
    curveInteractionKind: "CurveInteractionReceipt",
    lamellarEnvelopeKind: "LamellarEnvelopeDescriptor",
    sphereCurveMode: SPHERE_CURVE_MODE,
    curveInteractionMode: CURVE_INTERACTION_MODE,
    lamellarEnvelopeMode: LAMELLAR_ENVELOPE_MODE,
    meshEmission: "sphere-curve-solved-before-ribbon-geometry",
  };

  const selectedPhase = 0.24 + rand() * 0.72;
  const selectedShape = {
    theta0: -1.18 + (rand() - 0.5) * 0.16,
    thetaTwist: 4.42 + rand() * 0.42,
    phi0: -0.38 + (rand() - 0.5) * 0.08,
    phiSlope: 0.94 + rand() * 0.18,
  };

  const primarySphereCurveDescriptors = generateSphereCurveDescriptors({
    seed,
    layerSpecs,
    stripInstances,
    composerDescriptor,
    selectedShape,
    selectedPhase,
  });
  const stripTopologyDescriptors = generateStripTopologyDescriptors(primarySphereCurveDescriptors, { stripTopologyCount });
  const sphereCurveDescriptors = [...primarySphereCurveDescriptors, ...stripTopologyDescriptors];
  const curveInteractionReceipt = createCurveInteractionReceipt(sphereCurveDescriptors);
  const lamellarEnvelopeDescriptors = generateLamellarEnvelopeDescriptors(sphereCurveDescriptors);

  for (const curve of sphereCurveDescriptors) {
    emitCurveSectionDescriptor(descriptors, curve, seed);
  }

  return {
    composerDescriptor,
    layerStackDescriptor,
    layerSpecs,
    stripInstances,
    stripProfileOverrides,
    stripPopulationDescriptors,
    stripProfileDescriptors: stripInstances.map(strip => strip.stripProfileDescriptor),
    sphereCurveDescriptors,
    stripTopologyDescriptors,
    lamellarEnvelopeDescriptors,
    curveInteractionReceipt,
    descriptors,
  };
}

export function sliceLamellarSectionSegments(descriptors, input = {}) {
  const cutRadius = clamp(Number(input.cutRadius ?? 0.04), 0.018, 0.12);
  const sliceT = clamp(Number(input.sliceT ?? 0.47), 0.2, 0.8);
  const sliceAngle = clamp(Number(input.sliceAngle ?? 0), -70, 70);
  const halfWindow = clamp(cutRadius * 1.35, 0.024, 0.18);
  const lower = Number(clamp(sliceT - halfWindow, 0.08, 0.88).toFixed(4));
  const upper = Number(clamp(sliceT + halfWindow, 0.12, 0.94).toFixed(4));
  const affectedSegmentIds = [];
  const sliced = [];
  const channelCutReceipt = createChannelCutReceipt(descriptors, cutRadius, lower, upper);
  const cutAuthorEnvelopeDescriptor = createCutAuthorEnvelopeDescriptor(
    descriptors.find(descriptor => descriptor.materialRole === "neighbor-envelope"),
    channelCutReceipt
  );

  for (const descriptor of descriptors) {
    if (descriptor.sliceParticipation !== "primary-cut-target") {
      sliced.push(descriptor);
      continue;
    }
    affectedSegmentIds.push(descriptor.id);
    const [start, end] = descriptor.interval;
    sliced.push({
      ...descriptor,
      id: `${descriptor.id}-pre-cut`,
      materialRole: "selected-pre-cut",
      interval: [start, lower],
      sliceParentId: descriptor.id,
    });
    sliced.push({
      ...descriptor,
      id: `${descriptor.id}-continuation`,
      materialRole: "selected-continuation",
      interval: [upper, end],
      sliceParentId: descriptor.id,
      width: Number((descriptor.width * 0.86).toFixed(4)),
      edgeLift: Number((descriptor.edgeLift * 0.92).toFixed(4)),
    });
  }

  return {
    descriptors: sliced,
    sliceToolDescriptor: {
      mode: SLICE_TOOL_MODE,
      cutterId: "perpendicular-cutting-edge",
      cutT: Number(sliceT.toFixed(4)),
      cutRadius: Number(cutRadius.toFixed(4)),
      angleDegrees: Number(sliceAngle.toFixed(2)),
      capLaw: END_CAP_SEALING_MODE,
      window: [lower, upper],
      channelCutMode: CHANNEL_CUT_MODE,
    },
    sliceApplicationReceipt: {
      mode: "descriptor-slice-before-mesh-emission",
      affectedSegmentIds,
      emittedSegmentIds: sliced.map(d => d.id),
      capTValues: [lower, upper],
      openEdgeCount: 0,
      channelCutMode: CHANNEL_CUT_MODE,
      terminalContourSource: CHANNEL_TERMINAL_CONTOUR_SOURCE,
    },
    channelCutReceipt: {
      ...channelCutReceipt,
      affectedSegmentIds,
    },
    cutAuthorEnvelopeDescriptor,
  };
}

function spherePoint(theta, phi, radius = 1) {
  const cosPhi = Math.cos(phi);
  return {
    x: radius * cosPhi * Math.cos(theta),
    y: radius * Math.sin(phi),
    z: radius * cosPhi * Math.sin(theta),
  };
}

function vectorLength(v) {
  return Math.hypot(v.x, v.y, v.z);
}

function normalizeVector(v) {
  const length = vectorLength(v) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function crossVector(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function scaleVector(v, scale) {
  return { x: v.x * scale, y: v.y * scale, z: v.z * scale };
}

function addScaledVector(a, b, scale) {
  return { x: a.x + b.x * scale, y: a.y + b.y * scale, z: a.z + b.z * scale };
}

function shellOffsetPoint(normal, side, angularOffset, radius) {
  const shiftedUnit = normalizeVector(addScaledVector(
    scaleVector(normal, Math.cos(angularOffset)),
    side,
    Math.sin(angularOffset)
  ));
  return scaleVector(shiftedUnit, radius);
}

function ribbonShellWidthSegments(opts) {
  const explicit = Number(opts.widthSegments);
  if (Number.isFinite(explicit) && explicit >= 2) return Math.round(explicit);
  const width = opts.width || 0.06;
  return Math.max(4, Math.min(5, Math.ceil(width / 0.055)));
}

function ribbonShellSurfacePoints(sample, widthSegments) {
  const columns = [];
  for (let column = 0; column <= widthSegments; column++) {
    const u = column / widthSegments;
    const angularOffset = sample.angularHalfWidth * (-1 + u * 2);
    const point = shellOffsetPoint(sample.normal, sample.side, angularOffset, sample.shellRadius);
    columns.push({ point, normal: normalizeVector(point), angularOffset });
  }
  return columns;
}

function ribbonShellSampleAt(t, opts) {
  const radius = opts.radius || 1;
  const width = opts.width || 0.06;
  const theta = opts.theta0 + opts.thetaTwist * t;
  const phi = opts.phi0 + opts.phiSlope * (t - 0.5) + Math.sin(t * Math.PI * 2 + opts.phase) * (opts.waviness ?? 0.08);
  const p = spherePoint(theta, phi, radius);
  const p2 = spherePoint(theta + 0.018, phi + 0.012, radius);
  const tangent = normalizeVector({ x: p2.x - p.x, y: p2.y - p.y, z: p2.z - p.z });
  const normal = normalizeVector(p);
  const side = normalizeVector(crossVector(normal, tangent));
  const widthPulse = Math.sin(t * Math.PI * 4 + (opts.phase || 0)) * (opts.widthVariance || 0) * 0.22;
  const thicknessPulse = Math.sin(t * Math.PI * 3 + (opts.phase || 0) * 0.7) * (opts.thicknessVariance || 0) * (opts.thickness || 0.012) * 0.38;
  const widthAtT = width * (1 + widthPulse);
  const edgeLift = (opts.edgeLift || 0.015) + thicknessPulse;
  const shellRadius = radius + edgeLift;
  const angularHalfWidth = widthAtT / Math.max(0.001, shellRadius);
  const left = shellOffsetPoint(normal, side, -angularHalfWidth, shellRadius);
  const right = shellOffsetPoint(normal, side, angularHalfWidth, shellRadius);
  return {
    mode: RIBBON_SHELL_OFFSET_MODE,
    t,
    center: p,
    left,
    right,
    leftNormal: normalizeVector(left),
    rightNormal: normalizeVector(right),
    normal,
    side,
    shellRadius,
    angularHalfWidth,
  };
}

export function sampleLamellarRibbonShellRadii(span, opts, samples = 16) {
  const shellSamples = [];
  let maxShellRadiusError = 0;
  let maxSurfaceRadiusError = 0;
  const widthSegments = ribbonShellWidthSegments(opts);
  for (let i = 0; i <= samples; i++) {
    const t = span[0] + (span[1] - span[0]) * (i / samples);
    const sample = ribbonShellSampleAt(t, opts);
    const leftRadius = vectorLength(sample.left);
    const rightRadius = vectorLength(sample.right);
    const leftError = Math.abs(leftRadius - sample.shellRadius);
    const rightError = Math.abs(rightRadius - sample.shellRadius);
    maxShellRadiusError = Math.max(maxShellRadiusError, leftError, rightError);
    const surfaceRadii = ribbonShellSurfacePoints(sample, widthSegments).map(({ point }) => {
      const radius = vectorLength(point);
      maxSurfaceRadiusError = Math.max(maxSurfaceRadiusError, Math.abs(radius - sample.shellRadius));
      return Number(radius.toFixed(6));
    });
    shellSamples.push({
      t: Number(t.toFixed(4)),
      shellRadius: Number(sample.shellRadius.toFixed(6)),
      leftRadius: Number(leftRadius.toFixed(6)),
      rightRadius: Number(rightRadius.toFixed(6)),
      angularHalfWidth: Number(sample.angularHalfWidth.toFixed(6)),
      surfaceRadii,
    });
  }
  return {
    mode: RIBBON_SHELL_OFFSET_MODE,
    surfaceColumnCount: widthSegments + 1,
    samples: shellSamples,
    maxShellRadiusError,
    maxSurfaceRadiusError,
  };
}

function makeRibbonGeometry(THREE, span, opts) {
  const samples = opts.samples || 64;
  const widthSegments = ribbonShellWidthSegments(opts);
  const columns = widthSegments + 1;
  const vertices = [];
  const normals = [];
  const indices = [];
  const centerline = [];

  for (let i = 0; i <= samples; i++) {
    const t = span[0] + (span[1] - span[0]) * (i / samples);
    const sample = ribbonShellSampleAt(t, opts);
    const { center } = sample;
    const surface = ribbonShellSurfacePoints(sample, widthSegments);
    for (const { point, normal } of surface) {
      vertices.push(point.x, point.y, point.z);
      normals.push(normal.x, normal.y, normal.z);
    }
    centerline.push([Number(center.x.toFixed(5)), Number(center.y.toFixed(5)), Number(center.z.toFixed(5))]);
    if (i < samples) {
      const row = i * columns;
      const nextRow = (i + 1) * columns;
      for (let column = 0; column < widthSegments; column++) {
        const a = row + column;
        const b = row + column + 1;
        const c = nextRow + column;
        const d = nextRow + column + 1;
        indices.push(a, b, c, b, d, c);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return { geometry, centerline };
}

function makeLamellarEnvelopeGeometry(THREE, descriptor) {
  const rows = descriptor.sampleRows || [];
  const columns = rows[0]?.points?.length || 0;
  const vertices = [];
  const normals = [];
  const indices = [];
  const centerline = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const center = new THREE.Vector3(row.center[0], row.center[1], row.center[2]);
    centerline.push([Number(center.x.toFixed(5)), Number(center.y.toFixed(5)), Number(center.z.toFixed(5))]);
    for (const pointArray of row.points) {
      const point = new THREE.Vector3(pointArray[0], pointArray[1], pointArray[2]);
      const normal = point.clone().normalize();
      vertices.push(point.x, point.y, point.z);
      normals.push(normal.x, normal.y, normal.z);
    }
    if (rowIndex < rows.length - 1) {
      const rowOffset = rowIndex * columns;
      const nextRowOffset = (rowIndex + 1) * columns;
      for (let columnIndex = 0; columnIndex < columns - 1; columnIndex++) {
        const a = rowOffset + columnIndex;
        const b = rowOffset + columnIndex + 1;
        const c = nextRowOffset + columnIndex;
        const d = nextRowOffset + columnIndex + 1;
        indices.push(a, b, c, b, d, c);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const railGeometries = columns
    ? [
      makePolylineGeometry(THREE, rows.map(row => row.points[0])),
      makePolylineGeometry(THREE, rows.map(row => row.points[row.points.length - 1])),
    ]
    : [];
  const capGeometries = rows.length
    ? [
      makePolylineGeometry(THREE, rows[0].points),
      makePolylineGeometry(THREE, rows[rows.length - 1].points),
    ]
    : [];
  return { geometry, centerline, railGeometries, capGeometries };
}

function makePolylineGeometry(THREE, pointArrays) {
  const vertices = [];
  for (const point of pointArrays || []) {
    vertices.push(point[0], point[1], point[2]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function lamellarFrame(THREE, t, opts) {
  const theta = opts.theta0 + opts.thetaTwist * t;
  const phi = opts.phi0 + opts.phiSlope * (t - 0.5) + Math.sin(t * Math.PI * 2 + opts.phase) * (opts.waviness ?? 0.08);
  const p = spherePoint(theta, phi, opts.radius || 1);
  const p2 = spherePoint(theta + 0.018, phi + 0.012, opts.radius || 1);
  const tangent = new THREE.Vector3(p2.x - p.x, p2.y - p.y, p2.z - p.z).normalize();
  const normal = new THREE.Vector3(p.x, p.y, p.z).normalize();
  const side = new THREE.Vector3().crossVectors(normal, tangent).normalize();
  return {
    center: new THREE.Vector3(p.x, p.y, p.z),
    tangent,
    normal,
    side,
  };
}

function makeCuttingEdgeGeometry(THREE, t, opts) {
  const frame = lamellarFrame(THREE, t, opts);
  const length = opts.length || 0.56;
  const halfWidth = opts.halfWidth || 0.018;
  const lift = opts.lift || 0.075;
  const angle = (opts.angleDegrees || 0) * Math.PI / 180;
  const crossAxis = frame.side.clone().multiplyScalar(Math.cos(angle)).addScaledVector(frame.tangent, Math.sin(angle)).normalize();
  const railAxis = frame.tangent.clone().multiplyScalar(Math.cos(angle)).addScaledVector(frame.side, -Math.sin(angle)).normalize();
  const center = frame.center.clone().addScaledVector(frame.normal, lift);
  const a = center.clone().addScaledVector(crossAxis, -length * 0.5).addScaledVector(railAxis, -halfWidth);
  const b = center.clone().addScaledVector(crossAxis, length * 0.5).addScaledVector(railAxis, -halfWidth);
  const c = center.clone().addScaledVector(crossAxis, -length * 0.5).addScaledVector(railAxis, halfWidth);
  const d = center.clone().addScaledVector(crossAxis, length * 0.5).addScaledVector(railAxis, halfWidth);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    a.x, a.y, a.z,
    b.x, b.y, b.z,
    c.x, c.y, c.z,
    d.x, d.y, d.z,
  ], 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute([
    frame.normal.x, frame.normal.y, frame.normal.z,
    frame.normal.x, frame.normal.y, frame.normal.z,
    frame.normal.x, frame.normal.y, frame.normal.z,
    frame.normal.x, frame.normal.y, frame.normal.z,
  ], 3));
  geometry.setIndex([0, 1, 2, 1, 3, 2]);
  geometry.computeBoundingSphere();
  return {
    geometry,
    descriptor: {
      role: "perpendicular-cutting-edge",
      cutT: Number(t.toFixed(4)),
      angleDegrees: Number((opts.angleDegrees || 0).toFixed(2)),
      length: Number(length.toFixed(4)),
      halfWidth: Number(halfWidth.toFixed(4)),
      center: vectorSnapshot(center),
      tangent: vectorSnapshot(railAxis),
      crossAxis: vectorSnapshot(crossAxis),
      normal: vectorSnapshot(frame.normal),
    },
  };
}

function makeCutAuthorEnvelopeGeometry(THREE, descriptor, cutAuthorEnvelopeDescriptor) {
  const opts = {
    ...descriptorCurveOptions(descriptor),
    width: cutAuthorEnvelopeDescriptor.envelopeDisplayWidth,
    edgeLift: Number(((descriptor.edgeLift || 0.014) + 0.025).toFixed(4)),
  };
  const rail = makeRibbonGeometry(THREE, descriptor.interval, opts);
  return {
    geometry: rail.geometry,
    centerline: rail.centerline,
    descriptor: {
      ...cutAuthorEnvelopeDescriptor,
      interval: descriptor.interval,
      displayMode: "thin-visible-neighbor-offset-envelope-rail",
    },
  };
}

function makeCapGeometry(THREE, t, opts) {
  const theta = opts.theta0 + opts.thetaTwist * t;
  const phi = opts.phi0 + opts.phiSlope * (t - 0.5) + Math.sin(t * Math.PI * 2 + opts.phase) * (opts.waviness ?? 0.08);
  const center = spherePoint(theta, phi, opts.radius || 1);
  const geometry = new THREE.CircleGeometry(opts.capRadius || 0.075, 24);
  geometry.rotateY(Math.PI / 2 - theta);
  geometry.rotateX(phi * 0.35);
  geometry.translate(center.x, center.y, center.z);
  return geometry;
}

function makeHook(centerline, layerIndex, bandIndex, role, descriptor = null) {
  return {
    bandId: descriptor?.id || `lamellar-${layerIndex}-${bandIndex}-${role}`,
    layerIndex,
    bandIndex,
    role,
    segmentKind: descriptor?.kind || "LamellarSectionSegment",
    curveLaw: descriptor?.curveLaw || "poloxodromic-sphere-strip-v0",
    depth: descriptor?.depth ?? 0,
    centerlineSamples: centerline.filter((_, i) => i % 8 === 0),
    rimMask: role.startsWith("selected") ? 0.92 : 0.48,
    innerExposure: role.startsWith("selected") ? 0.66 : 0.28,
    shellOcclusion: role.startsWith("selected") ? 0.32 : 0.58,
    emissiveCatch: role.startsWith("selected") ? 0.78 : 0.36,
    placeholderContract: PLACEHOLDER_CONTRACT,
  };
}

function vectorSnapshot(v) {
  return [Number(v.x.toFixed(5)), Number(v.y.toFixed(5)), Number(v.z.toFixed(5))];
}

export function createKaminosLamellarWitness({ THREE, scene, camera, controls }) {
  const group = new THREE.Group();
  group.name = "kaminos-lamellar-witness";
  group.visible = false;
  scene.add(group);
  let selectionHighlights = [];

  const state = {
    active: false,
    witnessIdentity: WITNESS_IDENTITY,
    effectiveRoute: EFFECTIVE_ROUTE,
    effectiveView: "cap_profile",
    cutRadius: 0.04,
    layerCount: 2,
    proceduralSeed: 17,
    chiralityMode: "same",
    chiralityPattern: "same",
    depthSpacing: 0.035,
    diagnosticLayerSeparationScale: DIAGNOSTIC_LAYER_SEPARATION_SCALE,
    chunkinessBase: 0.48,
    chunkinessVariance: 0.22,
    layerOverrides: [],
    populationCount: 4,
    cutterCount: 1,
    populationBearingVariance: 1,
    shellEnclosure: 0.45,
    stripTopologyCount: 0,
    stripPopulations: [],
    stripProfileOverrides: [],
    overlapBias: 0.38,
    sliceT: 0.47,
    sliceAngle: 0,
    frameCount: 0,
    capTValues: [],
    sectionSegments: [],
    cuttingEdgeDescriptor: null,
    composerDescriptor: null,
    layerStackDescriptor: null,
    layerSpecs: [],
    stripInstances: [],
    stripPopulationDescriptors: [],
    stripProfileDescriptors: [],
    sphereCurveDescriptors: [],
    stripTopologyDescriptors: [],
    lamellarEnvelopeDescriptors: [],
    curveInteractionReceipt: null,
    generatedSegmentDescriptors: [],
    sliceToolDescriptor: null,
    sliceApplicationReceipt: null,
    cutAuthorEnvelopeDescriptor: null,
    channelCutReceipt: null,
    openEdgeCount: 0,
    lightHooks: [],
    selectedLamellarObject: null,
    selectionLevel: null,
    selectedLayerSpecId: null,
    selectedStripInstanceId: null,
    selectedPopulationId: null,
    selectionAnchor: null,
    viewportPickReceipt: null,
    soloLayerIndex: null,
    lastBuildAt: null,
    widthRadiusCouplingMode: WIDTH_RADIUS_COUPLING_MODE,
    cutEndCapSealingMode: END_CAP_SEALING_MODE,
    placeholderContract: PLACEHOLDER_CONTRACT,
  };

  const materials = {
    selected: new THREE.MeshStandardMaterial({ color: 0xd6a33d, metalness: 0.72, roughness: 0.34, side: THREE.DoubleSide }),
    envelopeBodies: [
      new THREE.MeshStandardMaterial({ color: 0xf0c46b, metalness: 0.5, roughness: 0.44, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }),
      new THREE.MeshStandardMaterial({ color: 0x7fdad4, metalness: 0.26, roughness: 0.52, transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide }),
      new THREE.MeshStandardMaterial({ color: 0xf2e6c7, metalness: 0.34, roughness: 0.5, transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide }),
      new THREE.MeshStandardMaterial({ color: 0xe7a88e, metalness: 0.24, roughness: 0.54, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }),
    ],
    envelopeGuide: new THREE.MeshStandardMaterial({ color: 0x8fd4cf, metalness: 0.18, roughness: 0.62, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }),
    envelopeRail: new THREE.LineBasicMaterial({ color: 0xffecb5, transparent: true, opacity: 0.92 }),
    continuation: new THREE.MeshStandardMaterial({ color: 0xf2c86b, metalness: 0.64, roughness: 0.38, side: THREE.DoubleSide }),
    neighbor: new THREE.MeshStandardMaterial({ color: 0x10c9c1, emissive: 0x073330, emissiveIntensity: 0.18, metalness: 0.34, roughness: 0.36, side: THREE.DoubleSide }),
    neighborCompanion: new THREE.MeshStandardMaterial({ color: 0x5d807d, metalness: 0.34, roughness: 0.5, side: THREE.DoubleSide }),
    topologyMember: new THREE.MeshStandardMaterial({ color: 0xdff8f4, emissive: 0x073330, emissiveIntensity: 0.08, metalness: 0.22, roughness: 0.5, transparent: true, opacity: 0.82, side: THREE.DoubleSide }),
    cuttingEdge: new THREE.MeshStandardMaterial({ color: 0xff5d46, emissive: 0x3a0b04, emissiveIntensity: 0.35, metalness: 0.18, roughness: 0.32, side: THREE.DoubleSide }),
    cap: new THREE.MeshStandardMaterial({ color: 0xffcf76, metalness: 0.52, roughness: 0.3, side: THREE.DoubleSide }),
    gauge: new THREE.MeshBasicMaterial({ color: 0xff6a52, transparent: true, opacity: 0.72, side: THREE.DoubleSide }),
    placeholderA: new THREE.MeshStandardMaterial({ color: 0xd8cfab, metalness: 0.44, roughness: 0.48, side: THREE.DoubleSide }),
    placeholderB: new THREE.MeshStandardMaterial({ color: 0x909895, metalness: 0.38, roughness: 0.56, side: THREE.DoubleSide }),
  };

  function clear() {
    clearSelectionHighlights();
    while (group.children.length) {
      const child = group.children.pop();
      child.geometry?.dispose?.();
      group.remove(child);
    }
  }

  function selectedObjectFromMesh(mesh, source = "programmatic") {
    if (!mesh) return null;
    return {
      kind: "selectedLamellarObject",
      selectionSource: source,
      objectKind: mesh.userData.lamellarObjectKind || "section-segment",
      selectionLevel: "strip",
      sectionId: mesh.userData.lamellarSectionId || null,
      stripInstanceId: mesh.userData.stripInstanceId || null,
      selectedStripInstanceId: mesh.userData.stripInstanceId || null,
      layerSpecId: mesh.userData.layerSpecId || null,
      selectedLayerSpecId: mesh.userData.layerSpecId || null,
      layerIndex: mesh.userData.layerIndex ?? null,
      stripIndex: mesh.userData.stripIndex ?? null,
      role: mesh.userData.lamellarRole || null,
      populationId: mesh.userData.populationId || null,
      populationRole: mesh.userData.populationRole || null,
    };
  }

  function populationObjectFromMeshes(population, meshes, source = "population-id") {
    const firstMesh = meshes[0] || null;
    const layerSpecId = firstMesh?.userData.layerSpecId
      || state.layerSpecs.find(layer => layer.layerIndex === population?.layerIndex)?.id
      || null;
    const layerIndex = firstMesh?.userData.layerIndex ?? population?.layerIndex ?? null;
    const populationStripIds = state.stripInstances
      .filter(strip => strip.populationId === population?.id)
      .map(strip => strip.id);
    const anchor = selectionAnchorForMeshes(meshes);
    return {
      kind: "selectedLamellarObject",
      selectionSource: source,
      selectionLevel: "population",
      objectKind: "StripPopulationDescriptor",
      sectionId: null,
      stripInstanceId: null,
      selectedStripInstanceId: null,
      layerSpecId,
      selectedLayerSpecId: layerSpecId,
      layerIndex,
      stripIndex: null,
      stripIds: populationStripIds,
      populationStripIds,
      stripCount: populationStripIds.length,
      role: population?.role || firstMesh?.userData.populationRole || "population",
      populationId: population?.id || firstMesh?.userData.populationId || null,
      populationRole: population?.role || firstMesh?.userData.populationRole || null,
      layoutPreset: population?.layoutPreset || null,
      coverageSpacing: population?.coverageSpacing ?? null,
      coverageSpan: population?.coverageSpan ?? null,
      radialSpacing: population?.radialSpacing ?? null,
      radiusOffset: population?.radiusOffset ?? null,
      count: population?.count ?? populationStripIds.length,
      chirality: population?.chirality ?? null,
      bearingOffset: population?.bearingOffset ?? null,
      bearingVariance: population?.bearingVariance ?? null,
      gapPattern: population?.gapPattern || null,
      selectionAnchor: anchor,
    };
  }

  function clearSelectionHighlights() {
    for (const highlight of selectionHighlights) {
      group.remove(highlight);
      if (highlight.userData?.ownsHighlightGeometry) highlight.geometry?.dispose?.();
      highlight.material?.dispose?.();
    }
    selectionHighlights = [];
  }

  function selectionAnchorForMeshes(meshes) {
    const box = new THREE.Box3();
    let hasMesh = false;
    for (const mesh of meshes) {
      if (!mesh?.geometry) continue;
      mesh.geometry.computeBoundingBox();
      const meshBox = mesh.geometry.boundingBox.clone();
      meshBox.applyMatrix4(mesh.matrixWorld);
      box.union(meshBox);
      hasMesh = true;
    }
    if (!hasMesh) return null;
    const center = new THREE.Vector3();
    box.getCenter(center);
    return vectorSnapshot(center);
  }

  function applySelectionHighlight(meshes, level = "strip") {
    clearSelectionHighlights();
    const selectedMeshes = Array.isArray(meshes) ? meshes.filter(mesh => mesh?.geometry) : (meshes?.geometry ? [meshes] : []);
    if (!selectedMeshes.length) return;
    const highlightRole = level === "layer" ? "layer-selection-highlight"
      : level === "population" ? "population-selection-highlight"
      : "strip-selection-highlight";
    if (level === "layer" || level === "population") {
      const box = new THREE.Box3();
      let hasMesh = false;
      for (const mesh of selectedMeshes) {
        mesh.geometry.computeBoundingBox();
        const meshBox = mesh.geometry.boundingBox.clone();
        meshBox.applyMatrix4(mesh.matrixWorld);
        box.union(meshBox);
        hasMesh = true;
      }
      if (!hasMesh) return;
      const center = new THREE.Vector3();
      box.getCenter(center);
      const anchorGeometry = new THREE.SphereGeometry(level === "layer" ? 0.03 : 0.024, 12, 8);
      const anchorMaterial = new THREE.MeshBasicMaterial({
        color: level === "layer" ? 0xd9f4ff : 0x80ffe6,
        transparent: true,
        opacity: level === "layer" ? 0.68 : 0.82,
        depthTest: false,
      });
      const anchor = new THREE.Mesh(anchorGeometry, anchorMaterial);
      anchor.position.copy(center);
      anchor.renderOrder = 999;
      anchor.userData.lamellarRole = `${highlightRole}-selection-anchor-highlight`;
      anchor.userData.lamellarSelectable = false;
      anchor.userData.ownsHighlightGeometry = true;
      selectionHighlights.push(anchor);
      group.add(anchor);
      return;
    }
    const highlightMaterial = new THREE.MeshBasicMaterial({
      color: level === "layer" ? 0xd9f4ff : level === "population" ? 0x80ffe6 : 0xffffff,
      wireframe: true,
      transparent: true,
      opacity: level === "layer" ? 0.34 : level === "population" ? 0.52 : 0.72,
      depthTest: false,
    });
    for (const mesh of selectedMeshes) {
      const highlight = new THREE.Mesh(mesh.geometry, highlightMaterial);
      highlight.renderOrder = 999;
      highlight.userData.lamellarRole = highlightRole;
      highlight.userData.lamellarSelectable = false;
      selectionHighlights.push(highlight);
      group.add(highlight);
    }
  }

  function selectableMeshes() {
    return group.children.filter(child => child.userData?.lamellarSelectable);
  }

  function selectMesh(mesh, source = "programmatic") {
    if (!mesh) {
      state.selectedLamellarObject = null;
      state.selectionLevel = null;
      state.selectedLayerSpecId = null;
      state.selectedStripInstanceId = null;
      state.selectedPopulationId = null;
      state.selectionAnchor = null;
      applySelectionHighlight(null);
      return null;
    }
    state.selectedLamellarObject = selectedObjectFromMesh(mesh, source);
    state.selectionLevel = "strip";
    state.selectedLayerSpecId = state.selectedLamellarObject.layerSpecId;
    state.selectedStripInstanceId = state.selectedLamellarObject.stripInstanceId;
    state.selectedPopulationId = state.selectedLamellarObject.populationId || null;
    state.selectionAnchor = selectionAnchorForMeshes([mesh]);
    state.selectedLamellarObject.selectionAnchor = state.selectionAnchor;
    applySelectionHighlight(mesh, "strip");
    return state.selectedLamellarObject;
  }

  function selectBySectionId(sectionId, source = "section-id") {
    const mesh = selectableMeshes().find(child => child.userData.lamellarSectionId === sectionId) || null;
    return selectMesh(mesh, source);
  }

  function selectByStripInstanceId(stripInstanceId, source = "strip-instance-id") {
    return selectStripByStripInstanceId(stripInstanceId, source);
  }

  function selectStripByStripInstanceId(stripInstanceId, source = "strip-instance-id") {
    const mesh = selectableMeshes().find(child => child.userData.stripInstanceId === stripInstanceId) || null;
    return selectMesh(mesh, source);
  }

  function selectPopulationByPopulationId(populationId, source = "population-id") {
    const population = state.stripPopulationDescriptors.find(candidate => candidate.id === populationId) || null;
    const populationMeshes = selectableMeshes().filter(child => child.userData.populationId === populationId);
    if (!population || !populationMeshes.length) return selectMesh(null, source);
    const selected = populationObjectFromMeshes(population, populationMeshes, source);
    state.selectionLevel = "population";
    state.selectedLayerSpecId = selected.layerSpecId;
    state.selectedStripInstanceId = null;
    state.selectedPopulationId = populationId;
    state.selectionAnchor = selected.selectionAnchor;
    state.selectedLamellarObject = selected;
    applySelectionHighlight(populationMeshes, "population");
    return state.selectedLamellarObject;
  }

  function selectLayerByStripInstanceId(stripInstanceId, source = "strip-layer-hit") {
    const hitMesh = selectableMeshes().find(child => child.userData.stripInstanceId === stripInstanceId) || null;
    if (!hitMesh) return selectMesh(null, source);
    const layerSpecId = hitMesh.userData.layerSpecId || null;
    const layerIndex = hitMesh.userData.layerIndex ?? null;
    const layerMeshes = selectableMeshes().filter(child => child.userData.layerSpecId === layerSpecId && child.userData.stripInstanceId);
    const layerSpec = state.layerSpecs.find(layer => layer.id === layerSpecId || layer.layerIndex === layerIndex) || null;
    const anchor = selectionAnchorForMeshes(layerMeshes.length ? layerMeshes : [hitMesh]);
    state.selectionLevel = "layer";
    state.selectedLayerSpecId = layerSpecId;
    state.selectedStripInstanceId = null;
    state.selectedPopulationId = null;
    state.selectionAnchor = anchor;
    state.selectedLamellarObject = {
      kind: "selectedLamellarObject",
      selectionSource: source,
      selectionLevel: "layer",
      objectKind: "LayerShellDescriptor",
      sectionId: null,
      stripInstanceId: null,
      hitStripInstanceId: stripInstanceId,
      selectedStripInstanceId: null,
      layerSpecId,
      selectedLayerSpecId: layerSpecId,
      layerIndex,
      stripIndex: null,
      stripIds: layerSpec?.stripIds || state.stripInstances.filter(strip => strip.layerSpecId === layerSpecId).map(strip => strip.id),
      stripCount: layerSpec?.stripCount ?? layerMeshes.length,
      role: "layer-shell",
      populationId: null,
      populationRole: null,
      selectionAnchor: anchor,
    };
    applySelectionHighlight(layerMeshes.length ? layerMeshes : hitMesh, "layer");
    return state.selectedLamellarObject;
  }

  function rehydrateSelection() {
    if (!state.selectedLamellarObject) return;
    const { sectionId, stripInstanceId, hitStripInstanceId, selectionLevel, populationId } = state.selectedLamellarObject;
    if (selectionLevel === "layer" && hitStripInstanceId && selectLayerByStripInstanceId(hitStripInstanceId, "rebuild-rehydrate")) return;
    if (selectionLevel === "population" && populationId && selectPopulationByPopulationId(populationId, "rebuild-rehydrate")) return;
    if (selectionLevel === "strip" && stripInstanceId && selectStripByStripInstanceId(stripInstanceId, "rebuild-rehydrate")) return;
    if (sectionId && selectBySectionId(sectionId, "rebuild-rehydrate")) return;
    if (stripInstanceId) selectStripByStripInstanceId(stripInstanceId, "rebuild-rehydrate");
  }

  function pickFromClientPoint(clientX, clientY, domElement, options = {}) {
    const rect = domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1)
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(selectableMeshes(), false);
    const picked = hits[0]?.object || null;
    const hitStripInstanceId = picked?.userData.stripInstanceId || null;
    const drillDown = options.drillDown === true || options.selectionLevel === "strip";
    const selected = hitStripInstanceId
      ? (drillDown
        ? selectStripByStripInstanceId(hitStripInstanceId, "viewport-double-click")
        : selectLayerByStripInstanceId(hitStripInstanceId, "viewport-raycast-layer"))
      : selectMesh(null, "viewport-raycast");
    state.viewportPickReceipt = {
      mode: "viewport-raycast-lamellar-selection-v0",
      hit: Boolean(picked),
      selectionLevel: selected?.selectionLevel || null,
      client: [Number(clientX.toFixed(1)), Number(clientY.toFixed(1))],
      hitSectionId: picked?.userData.lamellarSectionId || null,
      hitStripInstanceId,
      selectedSectionId: selected?.sectionId || null,
      selectedStripInstanceId: selected?.stripInstanceId || null,
      selectedPopulationId: selected?.populationId || null,
      selectedLayerSpecId: selected?.layerSpecId || null,
      selectedRole: selected?.role || null,
      selectionAnchor: state.selectionAnchor,
    };
    return state.viewportPickReceipt;
  }

  function applySoloVisibility() {
    const soloLayerIndex = Number.isInteger(state.soloLayerIndex) ? state.soloLayerIndex : null;
    for (const child of group.children) {
      if (!child.userData) continue;
      if (child.userData.lamellarRole === "perpendicular-cutting-edge" || child.userData.lamellarRole === "cut-window-gauge") {
        child.visible = true;
        continue;
      }
      if (!Number.isInteger(soloLayerIndex)) {
        child.visible = true;
      } else if (Number.isInteger(child.userData.layerIndex)) {
        child.visible = child.userData.layerIndex === soloLayerIndex;
      } else {
        child.visible = true;
      }
    }
  }

  function setSoloLayer(layerIndex = null) {
    state.soloLayerIndex = Number.isInteger(layerIndex) ? clamp(layerIndex, 0, MAX_LAYER_COUNT - 1) : null;
    applySoloVisibility();
    return state.soloLayerIndex;
  }

  function build({ frame = false } = {}) {
    clear();
    const generated = generateLamellarSectionSegments({
      seed: state.proceduralSeed,
      chirality: state.chiralityMode,
      chiralityPattern: state.chiralityPattern,
      layerCount: state.layerCount,
      depthSpacing: state.depthSpacing,
      chunkinessBase: state.chunkinessBase,
      chunkinessVariance: state.chunkinessVariance,
      layerOverrides: state.layerOverrides,
      populationCount: state.populationCount,
      cutterCount: state.cutterCount,
      populationBearingVariance: state.populationBearingVariance,
      shellEnclosure: state.shellEnclosure,
      stripTopologyCount: state.stripTopologyCount,
      stripPopulations: state.stripPopulations,
      stripProfileOverrides: state.stripProfileOverrides,
      overlapBias: state.overlapBias,
    });
    const sliced = sliceLamellarSectionSegments(generated.descriptors, {
      cutRadius: state.cutRadius,
      sliceT: state.sliceT,
      sliceAngle: state.sliceAngle,
    });
    state.composerDescriptor = generated.composerDescriptor;
    state.layerStackDescriptor = generated.layerStackDescriptor;
    state.layerSpecs = generated.layerSpecs;
    state.stripInstances = generated.stripInstances;
    state.stripPopulationDescriptors = generated.stripPopulationDescriptors;
    state.stripProfileOverrides = generated.stripProfileOverrides;
    state.stripProfileDescriptors = generated.stripProfileDescriptors;
    state.sphereCurveDescriptors = generated.sphereCurveDescriptors;
    state.stripTopologyDescriptors = generated.stripTopologyDescriptors;
    state.lamellarEnvelopeDescriptors = generated.lamellarEnvelopeDescriptors;
    state.curveInteractionReceipt = generated.curveInteractionReceipt;
    state.generatedSegmentDescriptors = sliced.descriptors.map(d => ({
      id: d.id,
      kind: d.kind,
      sourceCurveId: d.sourceCurveId,
      sourceCurveKind: d.sourceCurveKind || null,
      curveSourceMode: d.curveSourceMode || null,
      meshSource: d.meshSource || null,
      topologyMode: d.topologyMode || null,
      topologyRole: d.topologyRole || null,
      topologyMemberIndex: d.topologyMemberIndex ?? null,
      topologyMemberCount: d.topologyMemberCount ?? null,
      sourceParentCurveId: d.sourceParentCurveId || null,
      sourceParentStripInstanceId: d.sourceParentStripInstanceId || null,
      layerSpecId: d.layerSpecId,
      stripInstanceId: d.stripInstanceId,
      stripIndex: d.stripIndex,
      populationId: d.populationId,
      populationRole: d.populationRole,
      populationIndex: d.populationIndex,
      layoutPreset: d.layoutPreset,
      coverageSpacing: d.coverageSpacing,
      coverageSpan: d.coverageSpan,
      shellLaneSpacing: d.shellLaneSpacing,
      shellLaneOffset: d.shellLaneOffset,
      radialSpacing: d.radialSpacing,
      radialOffset: d.radialOffset,
      radiusOffset: d.radiusOffset || 0,
      populationRadiusOffset: d.populationRadiusOffset || 0,
      layerRadiusOffset: d.layerRadiusOffset || 0,
      totalRadiusOffset: d.totalRadiusOffset || d.radiusOffset || 0,
      coverageSlot: d.coverageSlot,
      bearingPhase: d.bearingPhase,
      stripProfileKind: d.stripProfileKind,
      stripProfileDescriptor: d.stripProfileDescriptor,
      materialRole: d.materialRole,
      layerMaterialRole: d.layerMaterialRole,
      sliceParticipation: d.sliceParticipation,
      layerIndex: d.layerIndex,
      depth: d.depth,
      effectiveDepth: d.effectiveDepth,
      radius: d.radius,
      chirality: d.chirality,
      chunkiness: d.chunkiness,
      width: d.width,
      thickness: d.thickness,
      widthVariance: d.widthVariance,
      thicknessVariance: d.thicknessVariance,
      gapPattern: d.gapPattern,
      gapIndex: d.gapIndex ?? null,
      gapSpanCount: d.gapSpanCount ?? 1,
      segmentCount: d.segmentCount,
      interval: d.interval,
      curveLaw: d.curveLaw,
      capLaw: d.capLaw,
      theta0: d.theta0,
      thetaTwist: d.thetaTwist,
      phi0: d.phi0,
      phiSlope: d.phiSlope,
      phase: d.phase,
      source: d.source,
      sliceParentId: d.sliceParentId || null,
    }));
    state.sliceToolDescriptor = sliced.sliceToolDescriptor;
    state.sliceApplicationReceipt = sliced.sliceApplicationReceipt;
    state.cutAuthorEnvelopeDescriptor = sliced.cutAuthorEnvelopeDescriptor;
    state.channelCutReceipt = sliced.channelCutReceipt;
    state.capTValues = sliced.sliceApplicationReceipt.capTValues;
    state.sectionSegments = [];
    state.lightHooks = [];

    const envelopeSourceStripIds = new Set(state.lamellarEnvelopeDescriptors.flatMap(descriptor => descriptor.sourceStripInstanceIds || []));
    state.lamellarEnvelopeDescriptors.forEach((descriptor, envelopeIndex) => {
      const { geometry, centerline, railGeometries, capGeometries } = makeLamellarEnvelopeGeometry(THREE, descriptor);
      const mesh = new THREE.Mesh(geometry, materials.envelopeBodies[descriptor.layerIndex % materials.envelopeBodies.length]);
      mesh.renderOrder = 12;
      mesh.userData.lamellarSelectable = true;
      mesh.userData.lamellarObjectKind = "LamellarEnvelopeDescriptor";
      mesh.userData.lamellarRole = "curve-family-envelope-loft";
      mesh.userData.lamellarSectionId = descriptor.id;
      mesh.userData.layerSpecId = descriptor.layerSpecId;
      mesh.userData.stripInstanceId = descriptor.sourceStripInstanceIds?.[0] || null;
      mesh.userData.layerIndex = descriptor.layerIndex;
      mesh.userData.stripIndex = null;
      mesh.userData.populationId = descriptor.populationId;
      mesh.userData.populationRole = descriptor.populationRole;
      group.add(mesh);
      [...railGeometries, ...capGeometries].forEach((lineGeometry, railIndex) => {
        const line = new THREE.Line(lineGeometry, materials.envelopeRail);
        line.renderOrder = 13;
        line.userData.lamellarSelectable = false;
        line.userData.lamellarObjectKind = "LamellarEnvelopeRail";
        line.userData.lamellarRole = railIndex < railGeometries.length ? "curve-family-envelope-rail" : "curve-family-envelope-cap";
        line.userData.lamellarSectionId = descriptor.id;
        line.userData.layerSpecId = descriptor.layerSpecId;
        line.userData.layerIndex = descriptor.layerIndex;
        line.userData.populationId = descriptor.populationId;
        group.add(line);
      });
      state.sectionSegments.push({
        id: descriptor.id,
        kind: descriptor.kind,
        mode: descriptor.mode,
        meshSource: descriptor.meshSource,
        role: "curve-family-envelope-loft",
        layerSpecId: descriptor.layerSpecId,
        layerIndex: descriptor.layerIndex,
        populationId: descriptor.populationId,
        populationRole: descriptor.populationRole,
        sourceCurveIds: descriptor.sourceCurveIds,
        sourceStripInstanceIds: descriptor.sourceStripInstanceIds,
        compositionMode: descriptor.compositionMode,
        edgeLegibilityMode: descriptor.edgeLegibilityMode,
        span: descriptor.interval,
        capTValues: descriptor.capTValues,
        rowCount: descriptor.rowCount,
        columnCount: descriptor.columnCount,
        shellRadiusRange: descriptor.shellRadiusRange,
        openEdgeCount: 0,
      });
      state.lightHooks.push(makeHook(centerline, descriptor.layerIndex, envelopeIndex, "curve-family-envelope-loft", descriptor));
    });

    sliced.descriptors.forEach((descriptor, index) => {
      const isCutAuthorEnvelope = descriptor.sliceParticipation === "cut-author-envelope";
      const opts = descriptorCurveOptions(descriptor);
      const built = isCutAuthorEnvelope && state.cutAuthorEnvelopeDescriptor
        ? makeCutAuthorEnvelopeGeometry(THREE, descriptor, state.cutAuthorEnvelopeDescriptor)
        : makeRibbonGeometry(THREE, descriptor.interval, opts);
      const { geometry, centerline } = built;
      let material = materials.neighbor;
      if (descriptor.materialRole === "selected-source" || descriptor.materialRole === "selected-pre-cut") material = materials.selected;
      if (descriptor.materialRole === "selected-continuation") material = materials.continuation;
      if (descriptor.materialRole === "neighbor-companion") material = materials.neighborCompanion;
      if (descriptor.topologyRole === "intra-strip-member") material = materials.topologyMember;
      if (descriptor.materialRole === "nested-placeholder-shell") {
        material = descriptor.layerIndex % 2 ? materials.placeholderA : materials.placeholderB;
      }
      const isEnvelopeGuideStrip = descriptor.stripInstanceId && envelopeSourceStripIds.has(descriptor.stripInstanceId);
      if (isEnvelopeGuideStrip && descriptor.populationRole === "lamella") material = materials.envelopeGuide;
      const mesh = new THREE.Mesh(geometry, material);
      if (isEnvelopeGuideStrip) mesh.renderOrder = 6;
      if (descriptor.topologyRole === "intra-strip-member") mesh.renderOrder = 10;
      mesh.userData.lamellarSelectable = true;
      mesh.userData.lamellarObjectKind = "LamellarSectionSegment";
      mesh.userData.lamellarRole = descriptor.topologyRole || (isCutAuthorEnvelope ? "cut-author-envelope" : descriptor.materialRole);
      mesh.userData.lamellarSectionId = descriptor.id;
      mesh.userData.sourceCurveId = descriptor.sourceCurveId || null;
      mesh.userData.topologyMode = descriptor.topologyMode || null;
      mesh.userData.topologyRole = descriptor.topologyRole || null;
      mesh.userData.topologyMemberIndex = descriptor.topologyMemberIndex ?? null;
      mesh.userData.sourceParentCurveId = descriptor.sourceParentCurveId || null;
      mesh.userData.sourceParentStripInstanceId = descriptor.sourceParentStripInstanceId || null;
      mesh.userData.layerSpecId = descriptor.layerSpecId;
      mesh.userData.stripInstanceId = descriptor.stripInstanceId;
      mesh.userData.layerIndex = descriptor.layerIndex;
      mesh.userData.stripIndex = descriptor.stripIndex;
      mesh.userData.populationId = descriptor.populationId || null;
      mesh.userData.populationRole = descriptor.populationRole || null;
      group.add(mesh);
      state.sectionSegments.push({
        id: descriptor.id,
        kind: descriptor.kind,
        sourceCurveId: descriptor.sourceCurveId || null,
        sourceCurveKind: descriptor.sourceCurveKind || null,
        curveSourceMode: descriptor.curveSourceMode || null,
        meshSource: descriptor.meshSource || null,
        topologyMode: descriptor.topologyMode || null,
        topologyRole: descriptor.topologyRole || null,
        topologyMemberIndex: descriptor.topologyMemberIndex ?? null,
        topologyMemberCount: descriptor.topologyMemberCount ?? null,
        sourceParentCurveId: descriptor.sourceParentCurveId || null,
        sourceParentStripInstanceId: descriptor.sourceParentStripInstanceId || null,
        layerSpecId: descriptor.layerSpecId,
        stripInstanceId: descriptor.stripInstanceId,
        stripIndex: descriptor.stripIndex,
        populationId: descriptor.populationId || null,
        populationRole: descriptor.populationRole || null,
        populationIndex: descriptor.populationIndex ?? null,
        layoutPreset: descriptor.layoutPreset || null,
        coverageSpacing: descriptor.coverageSpacing ?? null,
        coverageSpan: descriptor.coverageSpan ?? null,
        shellLaneSpacing: descriptor.shellLaneSpacing ?? null,
        shellLaneOffset: descriptor.shellLaneOffset ?? null,
        radialSpacing: descriptor.radialSpacing ?? null,
        radialOffset: descriptor.radialOffset ?? null,
        radiusOffset: descriptor.radiusOffset ?? null,
        populationRadiusOffset: descriptor.populationRadiusOffset ?? null,
        layerRadiusOffset: descriptor.layerRadiusOffset ?? null,
        totalRadiusOffset: descriptor.totalRadiusOffset ?? descriptor.radiusOffset ?? null,
        coverageSlot: descriptor.coverageSlot ?? null,
        bearingPhase: descriptor.bearingPhase ?? null,
        role: isCutAuthorEnvelope ? "cut-author-envelope" : descriptor.materialRole,
        sourceRole: isCutAuthorEnvelope ? descriptor.materialRole : null,
        sliceParticipation: descriptor.sliceParticipation,
        channelCutMode: isCutAuthorEnvelope ? CHANNEL_CUT_MODE : null,
        envelopeDisplayWidth: isCutAuthorEnvelope ? state.cutAuthorEnvelopeDescriptor?.envelopeDisplayWidth : null,
        layerIndex: descriptor.layerIndex,
        depth: descriptor.depth,
        effectiveDepth: descriptor.effectiveDepth,
        radius: descriptor.radius,
        chirality: descriptor.chirality,
        chunkiness: descriptor.chunkiness,
        width: descriptor.width,
        thickness: descriptor.thickness,
        widthVariance: descriptor.widthVariance,
        thicknessVariance: descriptor.thicknessVariance,
        gapPattern: descriptor.gapPattern,
        gapIndex: descriptor.gapIndex ?? null,
        gapSpanCount: descriptor.gapSpanCount ?? 1,
        stripProfileDescriptor: descriptor.stripProfileDescriptor,
        span: descriptor.interval,
        curveLaw: descriptor.curveLaw,
        theta0: descriptor.theta0,
        thetaTwist: descriptor.thetaTwist,
        phi0: descriptor.phi0,
        phiSlope: descriptor.phiSlope,
        phase: descriptor.phase,
        openEdgeCount: 0,
      });
      state.lightHooks.push(makeHook(centerline, descriptor.layerIndex, index, descriptor.materialRole, descriptor));
    });

    const selectedDescriptor = sliced.descriptors.find(d => d.materialRole === "selected-pre-cut") || sliced.descriptors[0];
    const base = descriptorCurveOptions(selectedDescriptor);
    const cutT = state.sliceToolDescriptor.cutT;
    const cuttingEdge = makeCuttingEdgeGeometry(THREE, cutT, {
      ...base,
      length: 0.46 + state.cutRadius * 1.2 + state.overlapBias * 0.12,
      angleDegrees: state.sliceAngle,
    });
    const cuttingMesh = new THREE.Mesh(cuttingEdge.geometry, materials.cuttingEdge);
    cuttingMesh.userData.lamellarSelectable = true;
    cuttingMesh.userData.lamellarObjectKind = "perpendicular-cutting-edge";
    cuttingMesh.userData.lamellarRole = "perpendicular-cutting-edge";
    cuttingMesh.userData.lamellarSectionId = "perpendicular-cutting-edge";
    group.add(cuttingMesh);
    state.cuttingEdgeDescriptor = cuttingEdge.descriptor;
    state.sectionSegments.push({ role: "perpendicular-cutting-edge", span: [cutT, cutT], angleDegrees: state.sliceAngle, openEdgeCount: 0 });

    for (const t of state.capTValues) {
      const cap = new THREE.Mesh(makeCapGeometry(THREE, t, { ...base, capRadius: 0.06 + state.cutRadius * 0.32 }), materials.cap);
      cap.userData.lamellarRole = "zero-lift-cut-end-cap";
      group.add(cap);
    }

    if (state.effectiveView === "cut_radius_coupling") {
      const gauge = new THREE.Mesh(makeRibbonGeometry(THREE, [state.capTValues[0], state.capTValues[1]], { ...base, width: 0.018 + state.cutRadius * 0.12, radius: 1.055 }).geometry, materials.gauge);
      gauge.userData.lamellarRole = "cut-window-gauge";
      group.add(gauge);
    }

    state.openEdgeCount = 0;
    state.lastBuildAt = new Date().toISOString();
    rehydrateSelection();
    applySoloVisibility();
    if (frame) frameCamera();
  }

  function frameCamera() {
    const preset = VIEW_PRESETS[state.effectiveView] || VIEW_PRESETS.cap_profile;
    const x = Math.cos(preset.pitch) * Math.sin(preset.yaw) * preset.distance;
    const y = Math.sin(preset.pitch) * preset.distance;
    const z = Math.cos(preset.pitch) * Math.cos(preset.yaw) * preset.distance;
    camera.position.set(x, y, z);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  function setControls(next = {}) {
    state.cutRadius = clamp(Number(next.cutRadius ?? state.cutRadius), 0.018, 0.12);
    state.layerCount = Math.round(clamp(Number(next.layerCount ?? state.layerCount), 1, MAX_LAYER_COUNT));
    state.proceduralSeed = Math.round(clamp(Number(next.seed ?? state.proceduralSeed), 0, 99999));
    state.chiralityMode = ["same", "counterpatch", "mixed"].includes(next.chirality) ? next.chirality : state.chiralityMode;
    state.chiralityPattern = clampPattern(next.chiralityPattern ?? state.chiralityPattern);
    state.depthSpacing = clamp(Number(next.depthSpacing ?? state.depthSpacing), 0.015, 0.09);
    state.chunkinessBase = clamp(Number(next.chunkinessBase ?? state.chunkinessBase), 0.05, 1);
    state.chunkinessVariance = clamp(Number(next.chunkinessVariance ?? state.chunkinessVariance), 0, 0.65);
    state.layerOverrides = normalizeLayerOverrides(next.layerOverrides ?? state.layerOverrides).slice(0, 4);
    state.populationCount = Math.round(clamp(Number(next.populationCount ?? state.populationCount), 1, 16));
    state.cutterCount = Math.round(clamp(Number(next.cutterCount ?? state.cutterCount), 0, 8));
    state.populationBearingVariance = clamp(Number(next.populationBearingVariance ?? state.populationBearingVariance), 0.15, 2);
    state.shellEnclosure = clamp(Number(next.shellEnclosure ?? state.shellEnclosure), 0, 1);
    state.stripTopologyCount = normalizeStripTopologyCount(next.stripTopologyCount ?? state.stripTopologyCount);
    state.stripPopulations = normalizeStripPopulations(next.stripPopulations ?? state.stripPopulations);
    state.stripProfileOverrides = normalizeStripProfileOverrides(next.stripProfileOverrides ?? state.stripProfileOverrides);
    state.overlapBias = clamp(Number(next.overlapBias ?? state.overlapBias), 0, 1);
    state.sliceT = clamp(Number(next.sliceT ?? state.sliceT), 0.2, 0.8);
    state.sliceAngle = clamp(Number(next.sliceAngle ?? state.sliceAngle), -70, 70);
    state.effectiveView = VIEW_PRESETS[next.view] ? next.view : state.effectiveView;
    if (state.active) build({ frame: false });
  }

  function setActive(active) {
    state.active = Boolean(active);
    group.visible = state.active;
    if (state.active) build({ frame: false });
  }

  function update() {
    if (!state.active) return;
    state.frameCount += 1;
  }

  function debugState() {
    return {
      ...state,
      requestedRoute: "kaminos_lamellar_witness=1",
      lightHookCount: state.lightHooks.length,
      segmentDescriptorCount: state.generatedSegmentDescriptors.length,
      childCount: group.children.length,
      selectedLamellarObject: state.selectedLamellarObject,
      selectionLevel: state.selectionLevel,
      selectedLayerSpecId: state.selectedLayerSpecId,
      selectedStripInstanceId: state.selectedStripInstanceId,
      selectedPopulationId: state.selectedPopulationId,
      selectionAnchor: state.selectionAnchor,
      viewportPickReceipt: state.viewportPickReceipt,
      soloLayerIndex: state.soloLayerIndex,
      cameraPosition: vectorSnapshot(camera.position),
      cameraTarget: vectorSnapshot(controls.target),
      diagnosticLayerSeparationScale: state.diagnosticLayerSeparationScale,
    };
  }

  return { setActive, setControls, update, frameCamera, debugState, selectBySectionId, selectByStripInstanceId, selectLayerByStripInstanceId, selectStripByStripInstanceId, selectPopulationByPopulationId, setSoloLayer, pickFromClientPoint };
}
