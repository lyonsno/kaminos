export const MOTION_READY_719024_CAST_ID = 'motion-ready-719024';
export const MOTION_READY_719024_DEFORMATION_MODE = 'axial-parallel-transport-wave-v1';

const EPSILON = 1e-8;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / Math.max(EPSILON, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function length3(vector) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalize3(vector, fallback = [0, 0, -1]) {
  const length = length3(vector);
  if (length < EPSILON) return [...fallback];
  return vector.map(component => component / length);
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function requireVector3(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || value.some(component => !Number.isFinite(Number(component)))) {
    throw new Error(`${label} must be a finite vec3`);
  }
  return value.map(Number);
}

export function validateAxialCrawlerRegistration(registration) {
  if (registration?.schema !== 'kaminos.axial-crawler-registration.v0') {
    throw new Error('registration schema must be kaminos.axial-crawler-registration.v0');
  }
  const forward = requireVector3(registration.localForwardAxis, 'local forward axis');
  if (forward[0] !== 0 || forward[1] !== 0 || forward[2] !== -1) {
    throw new Error('local forward axis must be -Z');
  }
  const up = requireVector3(registration.localUpAxis, 'local up axis');
  if (up[0] !== 0 || up[1] !== 1 || up[2] !== 0) {
    throw new Error('local up axis must be +Y');
  }
  const stations = Array.isArray(registration.spineStations)
    ? registration.spineStations.map((station) => ({
      id: String(station.id || ''),
      t: Number(station.t),
      localPosition: requireVector3(station.localPosition, `spine station ${station.id || '?'}`),
    }))
    : [];
  if (stations.length !== 7) throw new Error('registration must contain exactly seven spine stations');
  for (let index = 0; index < stations.length; index++) {
    const station = stations[index];
    if (!Number.isFinite(station.t) || station.t < 0 || station.t > 1) {
      throw new Error(`spine station ${station.id} must have normalized t`);
    }
    if (index > 0 && station.localPosition[2] >= stations[index - 1].localPosition[2]) {
      throw new Error('spine stations must advance from tail to head along -Z');
    }
  }
  const tailZ = stations[0].localPosition[2];
  const headZ = stations[stations.length - 1].localPosition[2];
  if (!(tailZ > headZ)) throw new Error('tail must lie behind head on local Z');
  return {
    ...registration,
    localForwardAxis: forward,
    localUpAxis: up,
    spineStations: stations,
    contactPlaneY: Number(registration.contactPlaneY),
    tailZ,
    headZ,
    axialSpan: tailZ - headZ,
  };
}

export function createAxialSquirmState(options = {}) {
  const terrainSupportProfile = Array.isArray(options.terrainSupportProfile)
    ? options.terrainSupportProfile.map(sample => ({
      t: Number.isFinite(Number(sample.t)) ? Number(sample.t) : 0,
      localOffset: Number(sample.localOffset) || 0,
    }))
    : [];
  return {
    schema: 'kaminos.motion-ready-719024.axial-squirm-state.v1',
    castId: MOTION_READY_719024_CAST_ID,
    deformationMode: MOTION_READY_719024_DEFORMATION_MODE,
    amplitude: Math.max(0, Number(options.amplitude) || 0),
    verticalAmplitude: Math.max(0, Number(options.verticalAmplitude) || 0),
    phase: Number(options.phase) || 0,
    phaseVelocity: Math.max(0, Number(options.phaseVelocity) || 0),
    routeSpeed: Math.max(0, Number(options.routeSpeed) || 0),
    filteredRouteSpeed: Math.max(0, Number(options.filteredRouteSpeed) || 0),
    routeDistance: Math.max(0, Number(options.routeDistance) || 0),
    phaseOffset: Number(options.phaseOffset) || 0,
    phaseSource: options.phaseSource === 'route-distance-v0' ? options.phaseSource : 'velocity-integral-v0',
    terrainSupportProfile,
    terrainSupportRootLift: Math.max(0, Number(options.terrainSupportRootLift) || 0),
    terrainCompliance: options.terrainCompliance ? { ...options.terrainCompliance } : null,
  };
}

export function stepAxialSquirmController(previous, options = {}) {
  const prior = previous || createAxialSquirmState();
  const deltaSeconds = clamp(Number(options.deltaSeconds) || 0, 0, 0.1);
  const routeSpeed = Math.max(0, Number(options.routeSpeed) || 0);
  const speedRate = routeSpeed > prior.filteredRouteSpeed ? 9.5 : 4.2;
  const speedBlend = 1 - Math.exp(-speedRate * deltaSeconds);
  const filteredRouteSpeed = mix(prior.filteredRouteSpeed, routeSpeed, speedBlend);
  const motionWeight = smoothstep(0.025, 0.42, filteredRouteSpeed);
  const targetAmplitude = 0.082 * motionWeight;
  const targetVerticalAmplitude = 0.016 * motionWeight;
  const amplitudeRate = targetAmplitude > prior.amplitude ? 5.8 : 2.5;
  const amplitudeBlend = 1 - Math.exp(-amplitudeRate * deltaSeconds);
  const amplitude = mix(prior.amplitude, targetAmplitude, amplitudeBlend);
  const verticalAmplitude = mix(prior.verticalAmplitude, targetVerticalAmplitude, amplitudeBlend);
  const hasRouteDistance = Number.isFinite(Number(options.routeDistance));
  const routeDistance = hasRouteDistance
    ? Math.max(prior.routeDistance, Math.max(0, Number(options.routeDistance)))
    : prior.routeDistance;
  const phaseRadiansPerUnit = Math.max(0, Number(options.phaseRadiansPerUnit) || 2.35);
  const distanceDelta = Math.max(0, routeDistance - prior.routeDistance);
  const distancePhaseVelocity = deltaSeconds > EPSILON
    ? distanceDelta * phaseRadiansPerUnit / deltaSeconds
    : 0;
  const targetPhaseVelocity = hasRouteDistance ? distancePhaseVelocity : 6.2 * motionWeight;
  const holdsDistancePhase = !hasRouteDistance && prior.phaseSource === 'route-distance-v0';
  const effectiveTargetPhaseVelocity = holdsDistancePhase ? 0 : targetPhaseVelocity;
  const phaseRate = effectiveTargetPhaseVelocity > prior.phaseVelocity ? 7.5 : 3.4;
  const phaseBlend = 1 - Math.exp(-phaseRate * deltaSeconds);
  const phaseVelocity = mix(prior.phaseVelocity, effectiveTargetPhaseVelocity, phaseBlend);
  const phase = hasRouteDistance
    ? prior.phaseOffset + routeDistance * phaseRadiansPerUnit
    : holdsDistancePhase ? prior.phase : prior.phase + phaseVelocity * deltaSeconds;
  const support = options.terrainSupport;
  return createAxialSquirmState({
    amplitude,
    verticalAmplitude,
    phase,
    phaseVelocity,
    routeSpeed,
    filteredRouteSpeed,
    routeDistance,
    phaseOffset: prior.phaseOffset,
    phaseSource: hasRouteDistance ? 'route-distance-v0' : prior.phaseSource,
    terrainSupportProfile: support?.profile || prior.terrainSupportProfile,
    terrainSupportRootLift: support?.rootLift ?? prior.terrainSupportRootLift,
    terrainCompliance: support?.compliance || prior.terrainCompliance,
  });
}

function terrainSupportOffsetAtT(profile, t) {
  if (!Array.isArray(profile) || profile.length === 0) return 0;
  const normalizedT = clamp(t, 0, 1);
  let index = 0;
  while (index < profile.length - 2 && profile[index + 1].t < normalizedT) index++;
  const start = profile[index];
  const end = profile[Math.min(profile.length - 1, index + 1)];
  const span = Math.max(EPSILON, end.t - start.t);
  return mix(start.localOffset, end.localOffset, clamp((normalizedT - start.t) / span, 0, 1));
}

function axialEnvelope(t) {
  return 0.3 + 0.7 * Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.72);
}

function axialCenterAtT(t, registration, state) {
  const normalizedT = clamp(t, 0, 1);
  const waveAngle = state.phase - normalizedT * Math.PI * 2.25;
  const envelope = axialEnvelope(normalizedT);
  return [
    state.amplitude * envelope * Math.sin(waveAngle),
    terrainSupportOffsetAtT(state.terrainSupportProfile, normalizedT)
      + state.verticalAmplitude * envelope * (0.5 + 0.5 * Math.cos(waveAngle - 0.35)),
    mix(registration.tailZ, registration.headZ, normalizedT),
  ];
}

function requireTerrainSource(source) {
  const columns = Math.round(Number(source?.grid?.columns));
  const rows = Math.round(Number(source?.grid?.rows));
  const heights = source?.channels?.height?.values;
  if (columns < 2 || rows < 2 || !heights || heights.length < columns * rows) {
    throw new Error('terrain source requires a complete height channel and grid');
  }
  const xMin = Number(source?.worldBounds?.x?.min);
  const xMax = Number(source?.worldBounds?.x?.max);
  const zMin = Number(source?.worldBounds?.z?.min);
  const zMax = Number(source?.worldBounds?.z?.max);
  if (![xMin, xMax, zMin, zMax].every(Number.isFinite) || xMax <= xMin || zMax <= zMin) {
    throw new Error('terrain source requires finite non-empty world bounds');
  }
  return { columns, rows, heights, xMin, xMax, zMin, zMax };
}

export function sampleHillTerrainSurface(source, worldXInput, worldZInput) {
  const terrain = requireTerrainSource(source);
  const worldX = Number(worldXInput);
  const worldZ = Number(worldZInput);
  if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) {
    throw new Error('terrain sample coordinates must be finite');
  }
  const gridX = (worldX - terrain.xMin) / (terrain.xMax - terrain.xMin) * (terrain.columns - 1);
  const gridZ = (worldZ - terrain.zMin) / (terrain.zMax - terrain.zMin) * (terrain.rows - 1);
  const clampedX = clamp(gridX, 0, terrain.columns - 1);
  const clampedZ = clamp(gridZ, 0, terrain.rows - 1);
  const column0 = Math.min(terrain.columns - 2, Math.floor(clampedX));
  const row0 = Math.min(terrain.rows - 2, Math.floor(clampedZ));
  const column1 = column0 + 1;
  const row1 = row0 + 1;
  const tx = clampedX - column0;
  const tz = clampedZ - row0;
  const at = (column, row) => Number(terrain.heights[row * terrain.columns + column]) || 0;
  const near = mix(at(column0, row0), at(column1, row0), tx);
  const far = mix(at(column0, row1), at(column1, row1), tx);
  return {
    schema: 'kaminos.hill-terrain-surface-sample.v0',
    world: [worldX, mix(near, far, tz), worldZ],
    height: mix(near, far, tz),
    grid: [clampedX, clampedZ],
    inBounds: gridX >= 0 && gridX <= terrain.columns - 1 && gridZ >= 0 && gridZ <= terrain.rows - 1,
  };
}

export function solveAxialTerrainSupportEnvelope(source, registrationInput, options = {}) {
  const terrain = requireTerrainSource(source);
  const registration = registrationInput?.axialSpan
    ? registrationInput
    : validateAxialCrawlerRegistration(registrationInput);
  const rootSurface = requireVector3(options.rootSurface, 'terrain support root surface');
  const scale = Math.max(EPSILON, Number(options.scale) || 1);
  const forwardInput = requireVector3(options.forward, 'terrain support forward');
  const forward = normalize3([forwardInput[0], 0, forwardInput[2]], [0, 0, -1]);
  const right = [-forward[2], 0, forward[0]];
  const clearance = Math.max(0, Number(options.clearance) || 0.018);
  const lateralExcursion = Math.max(0, Number(options.lateralExcursion) || 0);
  const bounds = registration.bounds || {};
  const halfWidth = Math.max(
    Math.abs(Number(bounds?.min?.[0]) || 0),
    Math.abs(Number(bounds?.max?.[0]) || 0),
  ) * scale;
  const corridorRadius = halfWidth + lateralExcursion;
  const maxPitchRadians = clamp(Number(options.maxPitchRadians) || Math.PI / 5, 0.05, Math.PI * 0.48);
  const maxBendRadiansPerStation = clamp(
    Number(options.maxBendRadiansPerStation) || Math.PI / 10,
    0.02,
    Math.PI * 0.48,
  );
  const maxSuspensionLift = Math.max(0, Number(options.maxSuspensionLift) || 0.09 * scale);
  const terrainCellWidth = Math.min(
    (terrain.xMax - terrain.xMin) / (terrain.columns - 1),
    (terrain.zMax - terrain.zMin) / (terrain.rows - 1),
  );
  const supportSampleSpacing = Math.max(EPSILON, terrainCellWidth * 0.75);
  const boundsMinZ = Number(bounds?.min?.[2]);
  const boundsMaxZ = Number(bounds?.max?.[2]);
  const exactTailZ = Number.isFinite(boundsMaxZ) ? Math.max(registration.tailZ, boundsMaxZ) : registration.tailZ;
  const exactHeadZ = Number.isFinite(boundsMinZ) ? Math.min(registration.headZ, boundsMinZ) : registration.headZ;
  const exactAxialSpan = exactTailZ - exactHeadZ;
  const longitudinalIntervals = Math.max(
    1,
    Math.ceil(exactAxialSpan * scale / supportSampleSpacing),
  );
  const tValues = new Map();
  for (let index = 0; index <= longitudinalIntervals; index++) {
    const localZ = mix(exactTailZ, exactHeadZ, index / longitudinalIntervals);
    const t = (registration.tailZ - localZ) / registration.axialSpan;
    tValues.set(t.toFixed(9), t);
  }
  for (const station of registration.spineStations) tValues.set(station.t.toFixed(9), station.t);
  const supportTs = [...tValues.values()].sort((a, b) => a - b);
  const lateralIntervals = corridorRadius > EPSILON
    ? Math.max(2, Math.ceil(corridorRadius * 2 / supportSampleSpacing))
    : 0;
  const lateralSamples = lateralIntervals > 0
    ? Array.from({ length: lateralIntervals + 1 }, (_, index) => mix(-corridorRadius, corridorRadius, index / lateralIntervals))
    : [0];
  const stations = supportTs.map((t, supportIndex) => {
    const authoredStation = registration.spineStations.find(station => Math.abs(station.t - t) < 1e-7);
    const localZ = registration.tailZ - t * registration.axialSpan;
    const longitudinal = -localZ * scale;
    const centerX = rootSurface[0] + forward[0] * longitudinal;
    const centerZ = rootSurface[2] + forward[2] * longitudinal;
    const corridor = lateralSamples.map(lateral => sampleHillTerrainSurface(
      source,
      centerX + right[0] * lateral,
      centerZ + right[2] * lateral,
    ));
    const terrainHeight = Math.max(...corridor.map(sample => sample.height));
    return {
      stationId: authoredStation?.id || `support-${supportIndex}`,
      t,
      longitudinal,
      terrainHeight,
      requiredOffset: terrainHeight + clearance - rootSurface[1],
      inBounds: corridor.every(sample => sample.inBounds),
      corridor: corridor.map(sample => sample.world),
    };
  });
  const maxPitchSlope = Math.tan(maxPitchRadians);
  // The maximum of support cones is the minimal envelope that stays above every
  // terrain sample without exceeding the creature's longitudinal pitch limit.
  // Unlike iterative constraint projection, it cannot ratchet upward on a
  // difficult profile: each value remains bounded by a real terrain demand.
  const supportOffsets = stations.map(station => Math.max(...stations.map(sourceStation => (
    sourceStation.requiredOffset
      - maxPitchSlope * Math.abs(station.longitudinal - sourceStation.longitudinal)
  ))));
  const rootIndex = stations.findIndex(station => station.t >= 0.5);
  const rootLift = Math.max(0, supportOffsets[Math.max(0, rootIndex)]);
  const profile = stations.map((station, index) => ({
    stationId: station.stationId,
    t: station.t,
    localOffset: (supportOffsets[index] - rootLift) / scale,
    worldOffset: supportOffsets[index] - rootLift,
  }));
  let measuredPitch = 0;
  let measuredBend = 0;
  let previousSlope = null;
  for (let index = 0; index < supportOffsets.length - 1; index++) {
    const spacing = Math.max(EPSILON, stations[index + 1].longitudinal - stations[index].longitudinal);
    const slope = (supportOffsets[index + 1] - supportOffsets[index]) / spacing;
    measuredPitch = Math.max(measuredPitch, Math.abs(Math.atan(slope)));
    if (previousSlope != null) measuredBend = Math.max(measuredBend, Math.abs(Math.atan(slope) - Math.atan(previousSlope)));
    previousSlope = slope;
  }
  const maxEnvelopeLift = Math.max(...stations.map((station, index) => supportOffsets[index] - station.requiredOffset));
  const rootLiftAboveClearance = Math.max(0, rootLift - clearance);
  const outOfBounds = stations.some(station => !station.inBounds);
  const suspensionDemand = Math.max(maxEnvelopeLift, rootLiftAboveClearance);
  const normalizedMargin = (limit, measured) => {
    const margin = limit > EPSILON
      ? (limit - measured) / limit
      : measured <= EPSILON ? 0 : -1;
    return Math.abs(margin) < 1e-10 ? 0 : margin;
  };
  const complianceMargins = {
    bounds: outOfBounds ? -1 : 1,
    suspension: normalizedMargin(maxSuspensionLift, suspensionDemand),
    pitch: normalizedMargin(maxPitchRadians, measuredPitch),
    bend: normalizedMargin(maxBendRadiansPerStation, measuredBend),
  };
  const minimumNormalizedMargin = Math.min(...Object.values(complianceMargins));
  const exceeded = outOfBounds
    || maxEnvelopeLift > maxSuspensionLift + EPSILON
    || rootLiftAboveClearance > maxSuspensionLift + EPSILON
    || measuredPitch > maxPitchRadians + EPSILON
    || measuredBend > maxBendRadiansPerStation + EPSILON;
  const samples = stations.map((station, index) => ({
    ...station,
    supportOffset: supportOffsets[index],
    supportedContactY: rootSurface[1] + supportOffsets[index],
  }));
  return {
    schema: 'kaminos.axial-terrain-support-envelope.v0',
    clearance,
    scale,
    corridorRadius,
    supportSampleSpacing,
    terrainCellWidth,
    rootLift,
    profile,
    samples,
    compliance: {
      exceeded,
      outOfBounds,
      maxEnvelopeLift,
      rootLiftAboveClearance,
      maxSuspensionLift,
      measuredPitchRadians: measuredPitch,
      measuredBendRadians: measuredBend,
      maxPitchRadians,
      maxBendRadiansPerStation,
      margins: complianceMargins,
      minimumNormalizedMargin,
    },
    plannerDisposition: exceeded ? 'reroute-required' : 'local-support',
  };
}

export function createAxialTerrainRouteTransitionEvaluator(source, registrationInput, options = {}) {
  const terrain = requireTerrainSource(source);
  const registration = registrationInput?.axialSpan
    ? registrationInput
    : validateAxialCrawlerRegistration(registrationInput);
  const terrainCellWidth = Math.min(
    (terrain.xMax - terrain.xMin) / (terrain.columns - 1),
    (terrain.zMax - terrain.zMin) / (terrain.rows - 1),
  );
  const transitionSampleSpacing = Math.max(
    EPSILON,
    Number(options.transitionSampleSpacing) || terrainCellWidth * 0.5,
  );
  const supportOptions = {
    scale: Math.max(EPSILON, Number(options.scale) || 1),
    clearance: Math.max(0, Number(options.clearance) || 0.018),
    lateralExcursion: Math.max(0, Number(options.lateralExcursion) || 0),
    maxPitchRadians: Number(options.maxPitchRadians) || Math.PI / 5,
    maxBendRadiansPerStation: Number(options.maxBendRadiansPerStation) || Math.PI / 10,
    maxSuspensionLift: Math.max(0, Number(options.maxSuspensionLift) || 0.09 * (Number(options.scale) || 1)),
  };
  const marginCostWeight = Math.max(0, Number(options.marginCostWeight) || 0.9);
  const liftCostWeight = Math.max(0, Number(options.liftCostWeight) || 0.35);
  const requiredMinimumNormalizedMargin = Math.max(
    0,
    Number(options.requiredMinimumNormalizedMargin) || 0,
  );
  const evaluateHeadingSweep = options.evaluateHeadingSweep === true;
  const cache = new Map();
  const evaluate = transition => {
    const from = requireVector3(transition?.from?.world, 'route transition from world');
    const to = requireVector3(transition?.to?.world, 'route transition to world');
    const headingInput = transition?.heading
      ? requireVector3(transition.heading, 'route transition heading')
      : [to[0] - from[0], 0, to[2] - from[2]];
    const heading = normalize3([headingInput[0], 0, headingInput[2]], [0, 0, -1]);
    const previousHeadingInput = evaluateHeadingSweep && Array.isArray(transition?.previousHeading)
      ? requireVector3(transition.previousHeading, 'route transition previous heading')
      : heading;
    const previousHeading = normalize3(
      [previousHeadingInput[0], 0, previousHeadingInput[2]],
      heading,
    );
    const cacheKey = `${transition?.from?.index ?? from.join(',')}:${transition?.to?.index ?? to.join(',')}:${transition?.previousDirectionIndex ?? 'start'}:${transition?.directionIndex ?? heading.join(',')}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const transitionLength = Math.hypot(to[0] - from[0], to[2] - from[2]);
    const intervals = Math.max(1, Math.ceil(transitionLength / transitionSampleSpacing));
    const supports = [];
    for (let index = 0; index <= intervals; index++) {
      const t = index / intervals;
      const x = mix(from[0], to[0], t);
      const z = mix(from[2], to[2], t);
      const surface = sampleHillTerrainSurface(source, x, z);
      const startAngle = Math.atan2(previousHeading[0], previousHeading[2]);
      const endAngle = Math.atan2(heading[0], heading[2]);
      const turnDelta = Math.atan2(Math.sin(endAngle - startAngle), Math.cos(endAngle - startAngle));
      const sampleAngle = startAngle + turnDelta * t;
      const sampleHeading = [Math.sin(sampleAngle), 0, Math.cos(sampleAngle)];
      supports.push(solveAxialTerrainSupportEnvelope(source, registration, {
        ...supportOptions,
        rootSurface: [x, surface.height, z],
        forward: sampleHeading,
      }));
    }
    const minimumNormalizedMargin = Math.min(
      ...supports.map(support => support.compliance.minimumNormalizedMargin),
    );
    const maximumRootLift = Math.max(...supports.map(support => support.rootLift));
    const rejectedSupportIndex = supports.findIndex(support => support.plannerDisposition !== 'local-support');
    const admissible = rejectedSupportIndex < 0
      && minimumNormalizedMargin >= requiredMinimumNormalizedMargin;
    const result = {
      schema: 'kaminos.axial-terrain-route-transition-evaluation.v0',
      admissible,
      additionalCost: admissible
        ? marginCostWeight * (1 - clamp(minimumNormalizedMargin, 0, 1))
          + liftCostWeight * maximumRootLift / Math.max(EPSILON, supportOptions.maxSuspensionLift)
        : 0,
      evidence: {
        schema: 'kaminos.axial-terrain-route-transition-evidence.v0',
        supportPolicy: 'full-body-corridor-v0',
        headingPolicy: evaluateHeadingSweep ? 'transition-sweep-v0' : 'candidate-heading-v0',
        sampleCount: supports.length,
        minimumNormalizedMargin,
        requiredMinimumNormalizedMargin,
        maximumRootLift,
        rejectedSupportIndex,
        plannerDisposition: admissible ? 'local-support' : 'reroute-required',
      },
    };
    cache.set(cacheKey, result);
    return result;
  };
  evaluate.schema = 'kaminos.axial-terrain-route-transition-evaluator.v0';
  evaluate.policy = 'full-body-corridor-v0';
  evaluate.cache = cache;
  return evaluate;
}

function routePointWorld(point, index) {
  if (Array.isArray(point)) return requireVector3(point, `route point ${index}`);
  return requireVector3(point?.world, `route point ${index} world`);
}

function hermiteRoutePoint(points, segment, t, tangentScale) {
  const start = points[segment];
  const end = points[segment + 1];
  const before = points[Math.max(0, segment - 1)];
  const after = points[Math.min(points.length - 1, segment + 2)];
  const startTangent = [
    (end[0] - before[0]) * 0.5 * tangentScale,
    0,
    (end[2] - before[2]) * 0.5 * tangentScale,
  ];
  const endTangent = [
    (after[0] - start[0]) * 0.5 * tangentScale,
    0,
    (after[2] - start[2]) * 0.5 * tangentScale,
  ];
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return [
    h00 * start[0] + h10 * startTangent[0] + h01 * end[0] + h11 * endTangent[0],
    0,
    h00 * start[2] + h10 * startTangent[2] + h01 * end[2] + h11 * endTangent[2],
  ];
}

function cumulativeRouteLengths(points) {
  const cumulative = [0];
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    length += length3([
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1],
      points[index][2] - points[index - 1][2],
    ]);
    cumulative.push(length);
  }
  return { cumulative, length };
}

function interpolateRouteDistance(points, cumulative, distance) {
  let segment = 0;
  while (segment < cumulative.length - 2 && cumulative[segment + 1] < distance) segment++;
  const span = Math.max(EPSILON, cumulative[segment + 1] - cumulative[segment]);
  const t = clamp((distance - cumulative[segment]) / span, 0, 1);
  return [
    mix(points[segment][0], points[segment + 1][0], t),
    mix(points[segment][1], points[segment + 1][1], t),
    mix(points[segment][2], points[segment + 1][2], t),
  ];
}

function signedHeadingDelta(a, b) {
  return Math.atan2(a[0] * b[2] - a[2] * b[0], a[0] * b[0] + a[2] * b[2]);
}

function requireLocomotionRailTransitionEvaluation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('locomotion rail transition evaluator must return an object with explicit boolean admissible');
  }
  if (typeof value.admissible !== 'boolean') {
    throw new Error('locomotion rail transition evaluator must return an explicit boolean admissible');
  }
  if (!value.evidence || typeof value.evidence !== 'object' || Array.isArray(value.evidence)) {
    throw new Error('locomotion rail transition evaluator must return routeable evidence');
  }
  const additionalCost = value.additionalCost == null ? 0 : Number(value.additionalCost);
  if (!Number.isFinite(additionalCost) || additionalCost < 0) {
    throw new Error('locomotion rail transition evaluator additionalCost must be a finite nonnegative number');
  }
  return {
    admissible: value.admissible,
    additionalCost,
    evidence: value.evidence,
  };
}

export function compileCreatureScaleLocomotionRail(source, registrationInput, routePlan, options = {}) {
  const terrain = requireTerrainSource(source);
  const registration = registrationInput?.axialSpan
    ? registrationInput
    : validateAxialCrawlerRegistration(registrationInput);
  if (
    routePlan?.evidence?.transitionAdmission !== 'caller-evaluated'
    || !Array.isArray(routePlan?.routePoints)
    || routePlan.routePoints.slice(1).some(point => !point?.transitionEvidence)
  ) {
    throw new Error('locomotion rail requires a caller-evaluated route plan with transition evidence');
  }
  const transitionEvaluator = options.transitionEvaluator;
  if (typeof transitionEvaluator !== 'function') {
    throw new Error('locomotion rail requires the route transition evaluator for dense revalidation');
  }
  const raw = (routePlan?.routePoints || []).map(routePointWorld).filter((point, index, points) => (
    index === 0 || Math.hypot(point[0] - points[index - 1][0], point[2] - points[index - 1][2]) > EPSILON
  ));
  if (raw.length < 2) throw new Error('locomotion rail requires at least two distinct route points');
  const terrainCellWidth = Math.min(
    (terrain.xMax - terrain.xMin) / (terrain.columns - 1),
    (terrain.zMax - terrain.zMin) / (terrain.rows - 1),
  );
  const sampleSpacing = Math.max(EPSILON, Number(options.sampleSpacing) || terrainCellWidth * 0.65);
  const denseSpacing = Math.min(sampleSpacing * 0.35, terrainCellWidth * 0.3);
  const supportOptions = {
    scale: Math.max(EPSILON, Number(options.scale) || 1),
    clearance: Math.max(0, Number(options.clearance) || 0.018),
    lateralExcursion: Math.max(0, Number(options.lateralExcursion) || 0),
    maxPitchRadians: Number(options.maxPitchRadians) || Math.PI / 5,
    maxBendRadiansPerStation: Number(options.maxBendRadiansPerStation) || Math.PI / 10,
    maxSuspensionLift: Math.max(0, Number(options.maxSuspensionLift) || 0.09 * (Number(options.scale) || 1)),
  };
  const tangentScales = Array.isArray(options.tangentScales)
    ? options.tangentScales.map(value => clamp(Number(value) || 0, 0, 1))
    : [0.9, 0.65, 0.4, 0.2, 0.08];
  let bestFailure = null;
  for (const tangentScale of tangentScales) {
    const dense = [];
    for (let segment = 0; segment < raw.length - 1; segment++) {
      const segmentLength = Math.hypot(
        raw[segment + 1][0] - raw[segment][0],
        raw[segment + 1][2] - raw[segment][2],
      );
      const intervals = Math.max(2, Math.ceil(segmentLength / denseSpacing));
      for (let step = segment === 0 ? 0 : 1; step <= intervals; step++) {
        const point = hermiteRoutePoint(raw, segment, step / intervals, tangentScale);
        const surface = sampleHillTerrainSurface(source, point[0], point[2]);
        dense.push([point[0], surface.height, point[2]]);
      }
    }
    const denseLengths = cumulativeRouteLengths(dense);
    const intervals = Math.max(2, Math.ceil(denseLengths.length / sampleSpacing));
    const positions = Array.from({ length: intervals + 1 }, (_, index) => interpolateRouteDistance(
      dense,
      denseLengths.cumulative,
      denseLengths.length * index / intervals,
    ));
    const tangents = positions.map((position, index) => {
      const before = positions[Math.max(0, index - 1)];
      const after = positions[Math.min(positions.length - 1, index + 1)];
      return normalize3([after[0] - before[0], 0, after[2] - before[2]], [0, 0, -1]);
    });
    const denseTransitionEvaluations = positions.slice(1).map((position, index) => (
      requireLocomotionRailTransitionEvaluation(transitionEvaluator({
        source,
        from: {
          index: `locomotion-rail:${tangentScale}:${index}`,
          grid: null,
          world: positions[index],
          interpolation: 'locomotion-rail',
        },
        to: {
          index: `locomotion-rail:${tangentScale}:${index + 1}`,
          grid: null,
          world: position,
          interpolation: 'locomotion-rail',
        },
        heading: tangents[index + 1],
        previousHeading: tangents[index],
        directionIndex: null,
        previousDirectionIndex: null,
      }))
    ));
    const rejectedTransitionIndex = denseTransitionEvaluations.findIndex(evaluation => !evaluation.admissible);
    if (rejectedTransitionIndex >= 0) {
      bestFailure = {
        tangentScale,
        rejectedIndex: rejectedTransitionIndex + 1,
        margin: denseTransitionEvaluations[rejectedTransitionIndex].evidence.minimumNormalizedMargin ?? -Infinity,
        reason: 'dense transition admission',
      };
      continue;
    }
    const supports = positions.map((position, index) => solveAxialTerrainSupportEnvelope(
      source,
      registration,
      {
        ...supportOptions,
        rootSurface: position,
        forward: tangents[index],
      },
    ));
    const rejectedIndex = supports.findIndex(support => support.plannerDisposition !== 'local-support');
    if (rejectedIndex >= 0) {
      const margin = supports[rejectedIndex].compliance.minimumNormalizedMargin;
      if (!bestFailure || margin > bestFailure.margin) bestFailure = { tangentScale, rejectedIndex, margin };
      continue;
    }
    const spacing = denseLengths.length / intervals;
    let maximumHeadingDeltaRadians = 0;
    let maximumCurvatureDelta = 0;
    let maximumSupportCorrectionDelta = 0;
    let previousCurvature = 0;
    const samples = positions.map((position, index) => {
      const headingDelta = index > 0 ? signedHeadingDelta(tangents[index - 1], tangents[index]) : 0;
      const curvature = index > 0 ? headingDelta / Math.max(EPSILON, spacing) : 0;
      maximumHeadingDeltaRadians = Math.max(maximumHeadingDeltaRadians, Math.abs(headingDelta));
      if (index > 1) maximumCurvatureDelta = Math.max(maximumCurvatureDelta, Math.abs(curvature - previousCurvature));
      if (index > 0) {
        maximumSupportCorrectionDelta = Math.max(
          maximumSupportCorrectionDelta,
          Math.abs(supports[index].rootLift - supports[index - 1].rootLift),
        );
      }
      previousCurvature = curvature;
      return {
        index,
        sourceDistance: denseLengths.length * index / intervals,
        position,
        tangent: tangents[index],
        curvature,
        support: supports[index],
        transitionEvidence: index > 0 ? denseTransitionEvaluations[index - 1].evidence : null,
      };
    });
    return {
      schema: 'kaminos.creature-scale-locomotion-rail.v0',
      id: options.id || `${routePlan?.id || 'route'}-creature-rail`,
      authority: 'creature-scale-route-compilation',
      source: routePlan?.source || null,
      routePlanId: routePlan?.id || null,
      supportPolicy: 'full-body-corridor-v0',
      interpolation: 'cubic-hermite-arc-length-v0',
      tangentScale,
      sampleSpacing: spacing,
      length: denseLengths.length,
      samples,
      continuity: {
        maximumHeadingDeltaRadians,
        maximumCurvatureDelta,
        maximumSupportCorrectionDelta,
      },
      evidence: {
        rawPointCount: raw.length,
        sampleCount: samples.length,
        minimumSupportMargin: Math.min(...supports.map(support => support.compliance.minimumNormalizedMargin)),
        rejectedSampleCount: 0,
        transitionAdmission: 'caller-evaluated-dense-revalidation',
        denseTransitionCount: denseTransitionEvaluations.length,
      },
    };
  }
  throw new Error(
    `locomotion rail compilation failed: ${bestFailure?.reason || 'full-body support'} rejected sample ${bestFailure?.rejectedIndex ?? 'unknown'} at tangent scale ${bestFailure?.tangentScale ?? 'none'} with margin ${bestFailure?.margin ?? 'unknown'}`,
  );
}

function interpolateSupportEnvelope(start, end, t) {
  const interpolateProfile = (startProfile, endProfile) => startProfile.map((sample, index) => {
    const next = endProfile[index];
    if (!next || next.stationId !== sample.stationId) {
      throw new Error('locomotion rail support profiles must retain station identity');
    }
    return {
      stationId: sample.stationId,
      t: mix(sample.t, next.t, t),
      localOffset: mix(sample.localOffset, next.localOffset, t),
      worldOffset: mix(sample.worldOffset, next.worldOffset, t),
    };
  });
  const interpolateCorridor = (startCorridor, endCorridor) => startCorridor.map((point, index) => {
    const next = endCorridor[index];
    if (!next) throw new Error('locomotion rail support corridors must retain sample identity');
    return point.map((component, axis) => mix(component, next[axis], t));
  });
  const interpolateSamples = (startSamples, endSamples) => startSamples.map((sample, index) => {
    const next = endSamples[index];
    if (!next || next.stationId !== sample.stationId) {
      throw new Error('locomotion rail support samples must retain station identity');
    }
    return {
      stationId: sample.stationId,
      t: mix(sample.t, next.t, t),
      longitudinal: mix(sample.longitudinal, next.longitudinal, t),
      terrainHeight: mix(sample.terrainHeight, next.terrainHeight, t),
      requiredOffset: mix(sample.requiredOffset, next.requiredOffset, t),
      inBounds: sample.inBounds && next.inBounds,
      corridor: interpolateCorridor(sample.corridor, next.corridor),
      supportOffset: mix(sample.supportOffset, next.supportOffset, t),
      supportedContactY: mix(sample.supportedContactY, next.supportedContactY, t),
    };
  });
  const marginNames = new Set([
    ...Object.keys(start.compliance.margins || {}),
    ...Object.keys(end.compliance.margins || {}),
  ]);
  const margins = Object.fromEntries([...marginNames].map(name => [
    name,
    mix(start.compliance.margins?.[name] ?? 0, end.compliance.margins?.[name] ?? 0, t),
  ]));
  const compliance = {
    exceeded: start.compliance.exceeded || end.compliance.exceeded,
    outOfBounds: start.compliance.outOfBounds || end.compliance.outOfBounds,
    maxEnvelopeLift: mix(start.compliance.maxEnvelopeLift, end.compliance.maxEnvelopeLift, t),
    rootLiftAboveClearance: mix(start.compliance.rootLiftAboveClearance, end.compliance.rootLiftAboveClearance, t),
    maxSuspensionLift: mix(start.compliance.maxSuspensionLift, end.compliance.maxSuspensionLift, t),
    measuredPitchRadians: mix(start.compliance.measuredPitchRadians, end.compliance.measuredPitchRadians, t),
    measuredBendRadians: mix(start.compliance.measuredBendRadians, end.compliance.measuredBendRadians, t),
    maxPitchRadians: mix(start.compliance.maxPitchRadians, end.compliance.maxPitchRadians, t),
    maxBendRadiansPerStation: mix(
      start.compliance.maxBendRadiansPerStation,
      end.compliance.maxBendRadiansPerStation,
      t,
    ),
    margins,
    minimumNormalizedMargin: Math.min(...Object.values(margins)),
  };
  return {
    schema: 'kaminos.axial-terrain-support-envelope.v0',
    clearance: mix(start.clearance, end.clearance, t),
    scale: mix(start.scale, end.scale, t),
    corridorRadius: mix(start.corridorRadius, end.corridorRadius, t),
    supportSampleSpacing: mix(start.supportSampleSpacing, end.supportSampleSpacing, t),
    terrainCellWidth: mix(start.terrainCellWidth, end.terrainCellWidth, t),
    rootLift: mix(start.rootLift, end.rootLift, t),
    profile: interpolateProfile(start.profile, end.profile),
    samples: interpolateSamples(start.samples, end.samples),
    compliance,
    plannerDisposition: compliance.exceeded ? 'reroute-required' : 'local-support',
    interpolation: 'locomotion-rail-linear-support-v0',
  };
}

export function sampleCreatureScaleLocomotionRail(rail, distanceInput = 0, options = {}) {
  if (rail?.schema !== 'kaminos.creature-scale-locomotion-rail.v0' || !Array.isArray(rail.samples) || rail.samples.length < 2) {
    throw new Error('creature-scale locomotion rail is required');
  }
  const sourceDistance = clamp(Number(distanceInput) || 0, 0, rail.length);
  let segment = 0;
  while (
    segment < rail.samples.length - 2
    && rail.samples[segment + 1].sourceDistance < sourceDistance
  ) segment++;
  const start = rail.samples[segment];
  const end = rail.samples[segment + 1];
  const span = Math.max(EPSILON, end.sourceDistance - start.sourceDistance);
  const t = clamp((sourceDistance - start.sourceDistance) / span, 0, 1);
  const position = [
    mix(start.position[0], end.position[0], t),
    mix(start.position[1], end.position[1], t),
    mix(start.position[2], end.position[2], t),
  ];
  const tangent = normalize3([
    mix(start.tangent[0], end.tangent[0], t),
    0,
    mix(start.tangent[2], end.tangent[2], t),
  ]);
  const right = normalize3([-tangent[2], 0, tangent[0]], [1, 0, 0]);
  const attentionTarget = Array.isArray(options.attentionTarget)
    ? requireVector3(options.attentionTarget, 'attention target')
    : null;
  const attentionDirection = attentionTarget
    ? normalize3([
      attentionTarget[0] - position[0],
      attentionTarget[1] - position[1],
      attentionTarget[2] - position[2],
    ], tangent)
    : [...tangent];
  const horizontalAttention = normalize3([attentionDirection[0], 0, attentionDirection[2]], tangent);
  return {
    schema: 'kaminos.creature-scale-locomotion-rail-sample.v0',
    railId: rail.id,
    sourceDistance,
    progress: rail.length > EPSILON ? sourceDistance / rail.length : 0,
    segmentIndex: segment,
    position,
    tangent,
    curvature: mix(start.curvature, end.curvature, t),
    support: interpolateSupportEnvelope(start.support, end.support, t),
    locomotionFrame: {
      forward: tangent,
      right,
      up: [0, 1, 0],
    },
    attention: {
      target: attentionTarget,
      direction: attentionDirection,
      yawFromLocomotionRadians: signedHeadingDelta(tangent, horizontalAttention),
      authority: attentionTarget ? 'target-relative' : 'locomotion-forward-default',
    },
  };
}

function axialFrameAtT(t, registration, state) {
  const step = 1e-4;
  const before = axialCenterAtT(clamp(t - step, 0, 1), registration, state);
  const after = axialCenterAtT(clamp(t + step, 0, 1), registration, state);
  const tangentHeadward = normalize3([
    after[0] - before[0],
    after[1] - before[1],
    after[2] - before[2],
  ], [0, 0, -1]);
  const right = normalize3(cross3(tangentHeadward, [0, 1, 0]), [1, 0, 0]);
  const up = normalize3(cross3(right, tangentHeadward), [0, 1, 0]);
  return { right, up, tangentHeadward };
}

export function deformAxialPoint(pointInput, registrationInput, stateInput) {
  const point = requireVector3(pointInput, 'axial point');
  const registration = registrationInput?.axialSpan
    ? registrationInput
    : validateAxialCrawlerRegistration(registrationInput);
  const state = stateInput?.deformationMode
    ? stateInput
    : createAxialSquirmState(stateInput);
  const t = clamp((registration.tailZ - point[2]) / registration.axialSpan, 0, 1);
  const restCenterZ = mix(registration.tailZ, registration.headZ, t);
  const signedAxialResidual = restCenterZ - point[2];
  const center = axialCenterAtT(t, registration, state);
  const frame = axialFrameAtT(t, registration, state);
  return [
    center[0] + frame.right[0] * point[0] + frame.up[0] * point[1] + frame.tangentHeadward[0] * signedAxialResidual,
    center[1] + frame.right[1] * point[0] + frame.up[1] * point[1] + frame.tangentHeadward[1] * signedAxialResidual,
    center[2] + frame.right[2] * point[0] + frame.up[2] * point[1] + frame.tangentHeadward[2] * signedAxialResidual,
  ];
}

export function createAxialGeometryBinding(originalPositions, originalNormals, registrationInput, options = {}) {
  if (!ArrayBuffer.isView(originalPositions) || originalPositions.length % 3 !== 0) {
    throw new Error('original positions must be a packed numeric vec3 buffer');
  }
  if (!ArrayBuffer.isView(originalNormals) || originalNormals.length !== originalPositions.length) {
    throw new Error('original normals must match the packed position buffer');
  }
  const registration = registrationInput?.axialSpan
    ? registrationInput
    : validateAxialCrawlerRegistration(registrationInput);
  const segments = Math.max(16, Math.round(Number(options.segments) || 128));
  const vertexCount = originalPositions.length / 3;
  const segmentIndices = new Uint16Array(vertexCount);
  const segmentMix = new Float32Array(vertexCount);
  const axialResiduals = new Float32Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const t = clamp((registration.tailZ - originalPositions[vertex * 3 + 2]) / registration.axialSpan, 0, 1);
    const restCenterZ = mix(registration.tailZ, registration.headZ, t);
    const scaled = t * segments;
    const segment = Math.min(segments - 1, Math.floor(scaled));
    segmentIndices[vertex] = segment;
    segmentMix[vertex] = scaled - segment;
    axialResiduals[vertex] = restCenterZ - originalPositions[vertex * 3 + 2];
  }
  return {
    schema: 'kaminos.motion-ready-719024.axial-geometry-binding.v1',
    castId: MOTION_READY_719024_CAST_ID,
    deformationMode: MOTION_READY_719024_DEFORMATION_MODE,
    registration,
    segments,
    vertexCount,
    originalPositions,
    originalNormals,
    segmentIndices,
    segmentMix,
    axialResiduals,
    frameLut: new Float32Array((segments + 1) * 12),
  };
}

function writeAxialFrameLut(binding, state) {
  const { registration, segments, frameLut } = binding;
  for (let sample = 0; sample <= segments; sample++) {
    const t = sample / segments;
    const center = axialCenterAtT(t, registration, state);
    const frame = axialFrameAtT(t, registration, state);
    const offset = sample * 12;
    frameLut[offset] = center[0];
    frameLut[offset + 1] = center[1];
    frameLut[offset + 2] = center[2];
    frameLut[offset + 3] = frame.right[0];
    frameLut[offset + 4] = frame.right[1];
    frameLut[offset + 5] = frame.right[2];
    frameLut[offset + 6] = frame.up[0];
    frameLut[offset + 7] = frame.up[1];
    frameLut[offset + 8] = frame.up[2];
    frameLut[offset + 9] = frame.tangentHeadward[0];
    frameLut[offset + 10] = frame.tangentHeadward[1];
    frameLut[offset + 11] = frame.tangentHeadward[2];
  }
}

export function deformAxialGeometryBinding(binding, stateInput, outputPositions, outputNormals) {
  if (binding?.schema !== 'kaminos.motion-ready-719024.axial-geometry-binding.v1') {
    throw new Error('axial geometry binding is required');
  }
  if (!ArrayBuffer.isView(outputPositions) || outputPositions.length !== binding.originalPositions.length) {
    throw new Error('output positions must match the bound position buffer');
  }
  if (!ArrayBuffer.isView(outputNormals) || outputNormals.length !== binding.originalNormals.length) {
    throw new Error('output normals must match the bound normal buffer');
  }
  const state = stateInput?.deformationMode
    ? stateInput
    : createAxialSquirmState(stateInput);
  writeAxialFrameLut(binding, state);
  const {
    frameLut,
    originalNormals,
    originalPositions,
    segmentIndices,
    segmentMix,
    axialResiduals,
    vertexCount,
  } = binding;
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const vectorOffset = vertex * 3;
    const frameOffset = segmentIndices[vertex] * 12;
    const nextFrameOffset = frameOffset + 12;
    const blend = segmentMix[vertex];
    const inverseBlend = 1 - blend;
    const centerX = frameLut[frameOffset] * inverseBlend + frameLut[nextFrameOffset] * blend;
    const centerY = frameLut[frameOffset + 1] * inverseBlend + frameLut[nextFrameOffset + 1] * blend;
    const centerZ = frameLut[frameOffset + 2] * inverseBlend + frameLut[nextFrameOffset + 2] * blend;
    const rightX = frameLut[frameOffset + 3] * inverseBlend + frameLut[nextFrameOffset + 3] * blend;
    const rightY = frameLut[frameOffset + 4] * inverseBlend + frameLut[nextFrameOffset + 4] * blend;
    const rightZ = frameLut[frameOffset + 5] * inverseBlend + frameLut[nextFrameOffset + 5] * blend;
    const upX = frameLut[frameOffset + 6] * inverseBlend + frameLut[nextFrameOffset + 6] * blend;
    const upY = frameLut[frameOffset + 7] * inverseBlend + frameLut[nextFrameOffset + 7] * blend;
    const upZ = frameLut[frameOffset + 8] * inverseBlend + frameLut[nextFrameOffset + 8] * blend;
    const tangentX = frameLut[frameOffset + 9] * inverseBlend + frameLut[nextFrameOffset + 9] * blend;
    const tangentY = frameLut[frameOffset + 10] * inverseBlend + frameLut[nextFrameOffset + 10] * blend;
    const tangentZ = frameLut[frameOffset + 11] * inverseBlend + frameLut[nextFrameOffset + 11] * blend;
    const localX = originalPositions[vectorOffset];
    const localY = originalPositions[vectorOffset + 1];
    const signedAxialResidual = axialResiduals[vertex];
    outputPositions[vectorOffset] = centerX + rightX * localX + upX * localY + tangentX * signedAxialResidual;
    outputPositions[vectorOffset + 1] = centerY + rightY * localX + upY * localY + tangentY * signedAxialResidual;
    outputPositions[vectorOffset + 2] = centerZ + rightZ * localX + upZ * localY + tangentZ * signedAxialResidual;

    const normalX = originalNormals[vectorOffset];
    const normalY = originalNormals[vectorOffset + 1];
    const normalZ = originalNormals[vectorOffset + 2];
    let deformedNormalX = rightX * normalX + upX * normalY - tangentX * normalZ;
    let deformedNormalY = rightY * normalX + upY * normalY - tangentY * normalZ;
    let deformedNormalZ = rightZ * normalX + upZ * normalY - tangentZ * normalZ;
    const normalLength = Math.hypot(deformedNormalX, deformedNormalY, deformedNormalZ) || 1;
    deformedNormalX /= normalLength;
    deformedNormalY /= normalLength;
    deformedNormalZ /= normalLength;
    outputNormals[vectorOffset] = deformedNormalX;
    outputNormals[vectorOffset + 1] = deformedNormalY;
    outputNormals[vectorOffset + 2] = deformedNormalZ;
  }
  return {
    schema: 'kaminos.motion-ready-719024.axial-geometry-deformation.v1',
    castId: MOTION_READY_719024_CAST_ID,
    deformationMode: MOTION_READY_719024_DEFORMATION_MODE,
    vertexCount,
    segments: binding.segments,
  };
}

export function samplePolylineRoute(pointsInput, progressInput = 0) {
  const points = Array.isArray(pointsInput) ? pointsInput.map((point, index) => requireVector3(point, `route point ${index}`)) : [];
  if (points.length < 2) throw new Error('route requires at least two points');
  const cumulative = [0];
  let routeLength = 0;
  for (let index = 1; index < points.length; index++) {
    routeLength += length3([
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1],
      points[index][2] - points[index - 1][2],
    ]);
    cumulative.push(routeLength);
  }
  if (routeLength < EPSILON) throw new Error('route length must be positive');
  const progress = clamp(Number(progressInput) || 0, 0, 1);
  const distance = progress * routeLength;
  let segmentIndex = 0;
  while (segmentIndex < cumulative.length - 2 && cumulative[segmentIndex + 1] < distance) segmentIndex++;
  const start = points[segmentIndex];
  const end = points[segmentIndex + 1];
  const segmentLength = Math.max(EPSILON, cumulative[segmentIndex + 1] - cumulative[segmentIndex]);
  const segmentT = clamp((distance - cumulative[segmentIndex]) / segmentLength, 0, 1);
  const forward = normalize3([
    end[0] - start[0],
    end[1] - start[1],
    end[2] - start[2],
  ]);
  return {
    schema: 'kaminos.motion-ready-719024.route-sample.v0',
    progress,
    distance,
    routeLength,
    segmentIndex,
    position: [
      mix(start[0], end[0], segmentT),
      mix(start[1], end[1], segmentT),
      mix(start[2], end[2], segmentT),
    ],
    forward,
  };
}
