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
  const cellWidth = (terrain.xMax - terrain.xMin) / (terrain.columns - 1);
  const cellDepth = (terrain.zMax - terrain.zMin) / (terrain.rows - 1);
  const dhdx = mix(
    at(column1, row0) - at(column0, row0),
    at(column1, row1) - at(column0, row1),
    tz,
  ) / Math.max(EPSILON, cellWidth);
  const dhdz = mix(
    at(column0, row1) - at(column0, row0),
    at(column1, row1) - at(column1, row0),
    tx,
  ) / Math.max(EPSILON, cellDepth);
  const normal = normalize3([-dhdx, 1, -dhdz], [0, 1, 0]);
  return {
    schema: 'kaminos.hill-terrain-surface-sample.v0',
    world: [worldX, mix(near, far, tz), worldZ],
    height: mix(near, far, tz),
    normal,
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

const CRAWLER_CONTACT_PATCH_SPECS = Object.freeze([
  Object.freeze({ id: 'front-left', axialRegion: 'front', side: 'left', axialCenterT: 0.75, sideSign: 1, phaseOffset: 0 }),
  Object.freeze({ id: 'front-right', axialRegion: 'front', side: 'right', axialCenterT: 0.75, sideSign: -1, phaseOffset: 0.5 }),
  Object.freeze({ id: 'rear-left', axialRegion: 'rear', side: 'left', axialCenterT: 0.25, sideSign: 1, phaseOffset: 0.5 }),
  Object.freeze({ id: 'rear-right', axialRegion: 'rear', side: 'right', axialCenterT: 0.25, sideSign: -1, phaseOffset: 0 }),
]);
const VALIDATED_CRAWLER_CONTACT_ATLAS = Symbol('validated-crawler-contact-atlas');
const VALIDATED_CRAWLER_CONTACT_CARRIERS = Symbol('validated-crawler-contact-carriers');

function quantile(values, fraction) {
  if (!values.length) throw new Error('contact atlas candidate set is empty');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * clamp(fraction, 0, 1))];
}

function weightedPosition(positions, indices, weights) {
  const result = [0, 0, 0];
  for (let index = 0; index < indices.length; index++) {
    const offset = indices[index] * 3;
    const weight = weights[index];
    result[0] += positions[offset] * weight;
    result[1] += positions[offset + 1] * weight;
    result[2] += positions[offset + 2] * weight;
  }
  return result;
}

export function deriveCrawlerContactAtlas(originalPositions, registrationInput, sourceIdentity = {}, options = {}) {
  if (!ArrayBuffer.isView(originalPositions) || originalPositions.length % 3 !== 0) {
    throw new Error('contact atlas derivation requires a packed position buffer');
  }
  const registration = registrationInput?.axialSpan
    ? registrationInput
    : validateAxialCrawlerRegistration(registrationInput);
  const vertexCount = originalPositions.length / 3;
  const halfWidth = Math.max(
    Math.abs(Number(registration.bounds?.min?.[0]) || 0),
    Math.abs(Number(registration.bounds?.max?.[0]) || 0),
  );
  const axialWindow = Math.max(0.08, Number(options.axialWindow) || registration.axialSpan * 0.16);
  const innerSide = Math.max(0.01, Number(options.innerSide) || halfWidth * 0.19);
  const lowQuantile = clamp(Number(options.lowQuantile) || 0.015, 0.002, 0.08);
  const influenceRadii = [
    Math.max(0.02, Number(options.influenceRadiusX) || halfWidth * 0.47),
    Math.max(0.03, Number(options.influenceRadiusY) || 0.11),
    Math.max(0.03, Number(options.influenceRadiusZ) || registration.axialSpan * 0.12),
  ];
  const patches = CRAWLER_CONTACT_PATCH_SPECS.map(spec => {
    const centerZ = mix(registration.tailZ, registration.headZ, spec.axialCenterT);
    const candidates = [];
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const offset = vertex * 3;
      const x = originalPositions[offset];
      const z = originalPositions[offset + 2];
      if (spec.sideSign * x < innerSide || Math.abs(z - centerZ) > axialWindow) continue;
      candidates.push(vertex);
    }
    const thresholdY = quantile(
      candidates.map(vertex => originalPositions[vertex * 3 + 1]),
      lowQuantile,
    );
    const vertexIndices = candidates.filter(vertex => originalPositions[vertex * 3 + 1] <= thresholdY);
    if (vertexIndices.length < 32) throw new Error(`${spec.id} contact patch has insufficient geometry`);
    const weights = new Array(vertexIndices.length).fill(1 / vertexIndices.length);
    const restCentroid = weightedPosition(originalPositions, vertexIndices, weights);
    const influenceVertexIndices = [];
    const influenceWeights = [];
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const offset = vertex * 3;
      const dx = (originalPositions[offset] - restCentroid[0]) / influenceRadii[0];
      const dy = (originalPositions[offset + 1] - restCentroid[1]) / influenceRadii[1];
      const dz = (originalPositions[offset + 2] - restCentroid[2]) / influenceRadii[2];
      const radiusSquared = dx * dx + dy * dy + dz * dz;
      if (radiusSquared >= 1) continue;
      influenceVertexIndices.push(vertex);
      influenceWeights.push((1 - radiusSquared) ** 2);
    }
    if (influenceVertexIndices.length < vertexIndices.length) {
      throw new Error(`${spec.id} contact influence failed to contain its contact patch`);
    }
    return {
      id: spec.id,
      axialRegion: spec.axialRegion,
      side: spec.side,
      phaseOffset: spec.phaseOffset,
      restCentroid,
      vertexIndices,
      weights,
      influenceVertexIndices,
      influenceWeights,
      derivation: {
        axialCenterT: spec.axialCenterT,
        axialWindow,
        innerSide,
        lowQuantile,
        thresholdY,
        influenceRadii,
      },
    };
  });
  return {
    schema: 'kaminos.creature-contact-atlas.v0',
    version: 0,
    castId: String(sourceIdentity.castId || MOTION_READY_719024_CAST_ID),
    castHash: String(sourceIdentity.castHash || ''),
    registrationHash: String(sourceIdentity.registrationHash || ''),
    motionClass: 'elongated-crawler',
    authority: 'exact-cast-consumer-derived-contact-v0',
    vertexCount,
    patches,
  };
}

export function validateCrawlerContactAtlas(atlas, expected = {}) {
  if (atlas?.schema !== 'kaminos.creature-contact-atlas.v0') {
    throw new Error('contact atlas schema must be kaminos.creature-contact-atlas.v0');
  }
  if (atlas.motionClass !== 'elongated-crawler') throw new Error('contact atlas motion class must be elongated-crawler');
  if (expected.castId && atlas.castId !== expected.castId) throw new Error('contact atlas cast id mismatch');
  if (expected.castHash && atlas.castHash !== expected.castHash) throw new Error('contact atlas cast hash mismatch');
  if (expected.registrationHash && atlas.registrationHash !== expected.registrationHash) {
    throw new Error('contact atlas registration hash mismatch');
  }
  if (expected.atlasHash && atlas.atlasHash && atlas.atlasHash !== expected.atlasHash) {
    throw new Error('contact atlas byte hash mismatch');
  }
  const vertexCount = Math.round(Number(expected.vertexCount ?? atlas.vertexCount));
  if (!Number.isInteger(vertexCount) || vertexCount <= 0 || atlas.vertexCount !== vertexCount) {
    throw new Error('contact atlas vertex count mismatch');
  }
  if (atlas[VALIDATED_CRAWLER_CONTACT_ATLAS]) return atlas;
  if (!Array.isArray(atlas.patches) || atlas.patches.length !== CRAWLER_CONTACT_PATCH_SPECS.length) {
    throw new Error('contact atlas requires exactly four crawler patches');
  }
  const patches = atlas.patches.map((patch, patchIndex) => {
    const spec = CRAWLER_CONTACT_PATCH_SPECS[patchIndex];
    if (patch.id !== spec.id || patch.axialRegion !== spec.axialRegion || patch.side !== spec.side) {
      throw new Error(`contact atlas patch ${patchIndex} identity/order mismatch`);
    }
    const restCentroid = requireVector3(patch.restCentroid, `${patch.id} rest centroid`);
    const vertexIndices = Array.from(patch.vertexIndices || [], Number);
    const weights = Array.from(patch.weights || [], Number);
    if (vertexIndices.length < 32 || vertexIndices.length !== weights.length) {
      throw new Error(`${patch.id} contact vertices and weights must align`);
    }
    if (vertexIndices.some(index => !Number.isInteger(index) || index < 0 || index >= vertexCount)) {
      throw new Error(`${patch.id} contact vertex index is out of bounds`);
    }
    if (weights.some(weight => !Number.isFinite(weight) || weight < 0)) {
      throw new Error(`${patch.id} contact weights must be finite and nonnegative`);
    }
    const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
    if (Math.abs(weightSum - 1) > 1e-5) throw new Error(`${patch.id} contact weights must sum to one`);
    const influenceVertexIndices = Array.from(patch.influenceVertexIndices || [], Number);
    const influenceWeights = Array.from(patch.influenceWeights || [], Number);
    if (influenceVertexIndices.length < vertexIndices.length || influenceVertexIndices.length !== influenceWeights.length) {
      throw new Error(`${patch.id} contact influence vertices and weights must align`);
    }
    if (influenceVertexIndices.some(index => !Number.isInteger(index) || index < 0 || index >= vertexCount)) {
      throw new Error(`${patch.id} contact influence vertex index is out of bounds`);
    }
    if (influenceWeights.some(weight => !Number.isFinite(weight) || weight < 0 || weight > 1 + EPSILON)) {
      throw new Error(`${patch.id} contact influence weights must remain in [0, 1]`);
    }
    return {
      ...patch,
      phaseOffset: Number.isFinite(Number(patch.phaseOffset)) ? Number(patch.phaseOffset) : spec.phaseOffset,
      restCentroid,
      vertexIndices,
      weights,
      influenceVertexIndices,
      influenceWeights,
      derivation: patch.derivation && typeof patch.derivation === 'object'
        ? {
          ...patch.derivation,
          influenceRadii: Array.from(patch.derivation.influenceRadii || [], Number),
        }
        : undefined,
    };
  });
  for (const patch of patches) {
    Object.freeze(patch.restCentroid);
    Object.freeze(patch.vertexIndices);
    Object.freeze(patch.weights);
    Object.freeze(patch.influenceVertexIndices);
    Object.freeze(patch.influenceWeights);
    if (patch.derivation) {
      Object.freeze(patch.derivation.influenceRadii);
      Object.freeze(patch.derivation);
    }
    Object.freeze(patch);
  }
  Object.freeze(patches);
  const validated = {
    ...atlas,
    atlasHash: String(expected.atlasHash || atlas.atlasHash || ''),
    patches,
  };
  Object.defineProperty(validated, VALIDATED_CRAWLER_CONTACT_ATLAS, { value: true });
  return Object.freeze(validated);
}

function buildMeshComponents(vertexCount, triangleIndices) {
  if (!ArrayBuffer.isView(triangleIndices) || triangleIndices.length % 3 !== 0) {
    throw new Error('contact carrier derivation requires packed triangle indices');
  }
  const parents = new Int32Array(vertexCount);
  const ranks = new Uint8Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex++) parents[vertex] = vertex;
  const find = vertex => {
    let root = vertex;
    while (parents[root] !== root) root = parents[root];
    while (parents[vertex] !== vertex) {
      const parent = parents[vertex];
      parents[vertex] = root;
      vertex = parent;
    }
    return root;
  };
  const unite = (left, right) => {
    let leftRoot = find(left);
    let rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    if (ranks[leftRoot] < ranks[rightRoot]) [leftRoot, rightRoot] = [rightRoot, leftRoot];
    parents[rightRoot] = leftRoot;
    if (ranks[leftRoot] === ranks[rightRoot]) ranks[leftRoot]++;
  };
  for (let index = 0; index < triangleIndices.length; index += 3) {
    const a = Number(triangleIndices[index]);
    const b = Number(triangleIndices[index + 1]);
    const c = Number(triangleIndices[index + 2]);
    if (![a, b, c].every(vertex => Number.isInteger(vertex) && vertex >= 0 && vertex < vertexCount)) {
      throw new Error('contact carrier triangle index is out of bounds');
    }
    unite(a, b);
    unite(b, c);
  }
  const components = new Map();
  const roots = new Int32Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const root = find(vertex);
    roots[vertex] = root;
    const vertices = components.get(root) || [];
    vertices.push(vertex);
    components.set(root, vertices);
  }
  return { components, roots };
}

export function deriveCrawlerContactCarriers(originalPositions, triangleIndices, atlasInput, sourceIdentity = {}, options = {}) {
  if (!ArrayBuffer.isView(originalPositions) || originalPositions.length % 3 !== 0) {
    throw new Error('contact carrier derivation requires a packed position buffer');
  }
  const vertexCount = originalPositions.length / 3;
  const atlas = validateCrawlerContactAtlas(atlasInput, { vertexCount });
  const { components, roots } = buildMeshComponents(vertexCount, triangleIndices);
  const collarThreshold = clamp(Number(options.collarThreshold) || 0.02, 0.001, 0.2);
  const componentOwner = new Map();
  const carrierRootsByPatch = new Map();
  for (const patch of atlas.patches) {
    const carrierRoots = new Set(patch.vertexIndices.map(vertex => roots[vertex]));
    carrierRootsByPatch.set(patch.id, carrierRoots);
    for (const root of carrierRoots) {
      const owner = componentOwner.get(root);
      if (owner && owner !== patch.id) throw new Error(`contact carrier component is shared by ${owner} and ${patch.id}`);
      componentOwner.set(root, patch.id);
    }
  }
  const collarCandidates = [];
  for (const patch of atlas.patches) {
    const sums = new Map();
    for (let index = 0; index < patch.influenceVertexIndices.length; index++) {
      const vertex = patch.influenceVertexIndices[index];
      const root = roots[vertex];
      if (componentOwner.has(root)) continue;
      sums.set(root, (sums.get(root) || 0) + patch.influenceWeights[index]);
    }
    for (const [root, sum] of sums) {
      const weight = sum / components.get(root).length;
      if (weight >= collarThreshold) collarCandidates.push({ patchId: patch.id, root, weight });
    }
  }
  collarCandidates.sort((left, right) => right.weight - left.weight || left.patchId.localeCompare(right.patchId));
  const collarByPatch = new Map(atlas.patches.map(patch => [patch.id, []]));
  for (const candidate of collarCandidates) {
    if (componentOwner.has(candidate.root)) continue;
    componentOwner.set(candidate.root, candidate.patchId);
    collarByPatch.get(candidate.patchId).push(candidate);
  }
  const patches = atlas.patches.map(patch => {
    const carrierRoots = [...carrierRootsByPatch.get(patch.id)].sort((a, b) => a - b);
    const carrierVertexIndices = carrierRoots.flatMap(root => components.get(root));
    const collars = collarByPatch.get(patch.id).sort((left, right) => left.root - right.root);
    const collarVertexIndices = [];
    const collarWeights = [];
    for (const collar of collars) {
      for (const vertex of components.get(collar.root)) {
        collarVertexIndices.push(vertex);
        collarWeights.push(collar.weight);
      }
    }
    return {
      id: patch.id,
      axialRegion: patch.axialRegion,
      side: patch.side,
      vertexIndices: [...patch.vertexIndices],
      carrierVertexIndices,
      carrierComponentCount: carrierRoots.length,
      collarVertexIndices,
      collarWeights,
      collarComponentCount: collars.length,
    };
  });
  return {
    schema: 'kaminos.creature-contact-carriers.v0',
    version: 0,
    castId: String(sourceIdentity.castId || atlas.castId),
    castHash: String(sourceIdentity.castHash || atlas.castHash),
    registrationHash: String(sourceIdentity.registrationHash || atlas.registrationHash),
    atlasHash: String(sourceIdentity.atlasHash || ''),
    authority: 'exact-cast-consumer-derived-topology-v0',
    vertexCount,
    triangleCount: triangleIndices.length / 3,
    componentCount: components.size,
    collarThreshold,
    patches,
  };
}

export function validateCrawlerContactCarriers(carriers, expected = {}) {
  if (carriers?.schema !== 'kaminos.creature-contact-carriers.v0') {
    throw new Error('contact carriers schema must be kaminos.creature-contact-carriers.v0');
  }
  if (expected.castId && carriers.castId !== expected.castId) throw new Error('contact carriers cast id mismatch');
  if (expected.castHash && carriers.castHash !== expected.castHash) throw new Error('contact carriers cast hash mismatch');
  if (expected.registrationHash && carriers.registrationHash !== expected.registrationHash) {
    throw new Error('contact carriers registration hash mismatch');
  }
  if (expected.atlasHash && carriers.atlasHash !== expected.atlasHash) throw new Error('contact carriers atlas hash mismatch');
  const vertexCount = Math.round(Number(expected.vertexCount ?? carriers.vertexCount));
  if (!Number.isInteger(vertexCount) || vertexCount <= 0 || carriers.vertexCount !== vertexCount) {
    throw new Error('contact carriers vertex count mismatch');
  }
  if (carriers[VALIDATED_CRAWLER_CONTACT_CARRIERS]) return carriers;
  if (!Array.isArray(carriers.patches) || carriers.patches.length !== CRAWLER_CONTACT_PATCH_SPECS.length) {
    throw new Error('contact carriers require exactly four crawler patches');
  }
  const claimedVertices = new Set();
  const patches = carriers.patches.map((patch, patchIndex) => {
    const spec = CRAWLER_CONTACT_PATCH_SPECS[patchIndex];
    if (patch.id !== spec.id || patch.axialRegion !== spec.axialRegion || patch.side !== spec.side) {
      throw new Error(`contact carriers patch ${patchIndex} identity/order mismatch`);
    }
    const vertexIndices = Array.from(patch.vertexIndices || [], Number);
    const carrierVertexIndices = Array.from(patch.carrierVertexIndices || [], Number);
    const collarVertexIndices = Array.from(patch.collarVertexIndices || [], Number);
    const collarWeights = Array.from(patch.collarWeights || [], Number);
    if (!vertexIndices.length || carrierVertexIndices.length < vertexIndices.length) {
      throw new Error(`${patch.id} carrier must contain its contact vertices`);
    }
    if (collarVertexIndices.length !== collarWeights.length) throw new Error(`${patch.id} collar vertices and weights must align`);
    const allIndices = [...carrierVertexIndices, ...collarVertexIndices];
    if (allIndices.some(index => !Number.isInteger(index) || index < 0 || index >= vertexCount)) {
      throw new Error(`${patch.id} carrier vertex index is out of bounds`);
    }
    if (!vertexIndices.every(index => carrierVertexIndices.includes(index))) {
      throw new Error(`${patch.id} carrier omits a contact vertex`);
    }
    if (collarWeights.some(weight => !Number.isFinite(weight) || weight <= 0 || weight > 1)) {
      throw new Error(`${patch.id} collar weights must remain in (0, 1]`);
    }
    for (const vertex of allIndices) {
      if (claimedVertices.has(vertex)) throw new Error(`contact carrier vertex ${vertex} has multiple owners`);
      claimedVertices.add(vertex);
    }
    const validatedPatch = {
      ...patch,
      vertexIndices,
      carrierVertexIndices,
      carrierComponentCount: Math.max(1, Math.round(Number(patch.carrierComponentCount) || 0)),
      collarVertexIndices,
      collarWeights,
      collarComponentCount: Math.max(0, Math.round(Number(patch.collarComponentCount) || 0)),
    };
    for (const key of ['vertexIndices', 'carrierVertexIndices', 'collarVertexIndices', 'collarWeights']) {
      Object.freeze(validatedPatch[key]);
    }
    return Object.freeze(validatedPatch);
  });
  Object.freeze(patches);
  const validated = { ...carriers, patches };
  Object.defineProperty(validated, VALIDATED_CRAWLER_CONTACT_CARRIERS, { value: true });
  return Object.freeze(validated);
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function computeCrawlerContactKinematics(patchDefinitions, atlasCastId, locomotorPhaseInput = 0, options = {}) {
  const locomotorPhase = Number(locomotorPhaseInput) || 0;
  const coupling = clamp(Number(options.coupling) || 0, 0, 1);
  const scale = Math.max(EPSILON, Number(options.scale) || 1);
  const stanceFraction = clamp(Number(options.stanceFraction) || 0.58, 0.4, 0.72);
  const releaseFraction = clamp(Number(options.releaseFraction) || 0.08, 0.03, stanceFraction * 0.35);
  const stride = Math.max(0, Number(options.stride) || 0.13 / scale) * coupling;
  const swingHeight = Math.max(0, Number(options.swingHeight) || 0.045 / scale) * coupling;
  const supportOffsets = options.supportOffsets instanceof Map
    ? options.supportOffsets
    : new Map(Object.entries(options.supportOffsets || {}));
  const cycleTurns = locomotorPhase / (Math.PI * 2);
  const patches = patchDefinitions.map(patch => {
    const cycle = positiveModulo(cycleTurns + patch.phaseOffset, 1);
    let state = 'swing';
    let localZ = 0;
    let localY = 0;
    if (cycle < stanceFraction - releaseFraction) {
      state = 'stance';
      const stanceT = cycle / Math.max(EPSILON, stanceFraction - releaseFraction);
      localZ = mix(-stride * 0.5, stride * 0.5, stanceT);
    } else if (cycle < stanceFraction) {
      state = 'release';
      const releaseT = (cycle - (stanceFraction - releaseFraction)) / releaseFraction;
      localZ = stride * 0.5;
      localY = swingHeight * 0.3 * smoothstep(0, 1, releaseT);
    } else {
      const swingT = (cycle - stanceFraction) / Math.max(EPSILON, 1 - stanceFraction);
      localZ = mix(stride * 0.5, -stride * 0.5, smoothstep(0, 1, swingT));
      localY = swingHeight * Math.sin(Math.PI * swingT);
    }
    return {
      id: patch.id,
      state,
      cycle,
      localOffset: [0, localY + (Number(supportOffsets.get(patch.id)) || 0), localZ],
    };
  });
  return {
    schema: 'kaminos.crawler-contact-kinematics.v0',
    atlasCastId,
    locomotorPhase,
    coupling,
    stanceFraction,
    releaseFraction,
    stride,
    swingHeight,
    patches,
  };
}

export function createCrawlerContactKinematics(atlasInput, locomotorPhaseInput = 0, options = {}) {
  const atlas = validateCrawlerContactAtlas(atlasInput);
  return computeCrawlerContactKinematics(atlas.patches, atlas.castId, locomotorPhaseInput, options);
}

export function applyCrawlerContactPatchDeformation(atlasInput, kinematics, outputPositions) {
  const atlas = validateCrawlerContactAtlas(atlasInput);
  if (kinematics?.schema !== 'kaminos.crawler-contact-kinematics.v0') {
    throw new Error('crawler contact kinematics are required');
  }
  if (!ArrayBuffer.isView(outputPositions) || outputPositions.length !== atlas.vertexCount * 3) {
    throw new Error('contact patch deformation output must match atlas vertex count');
  }
  for (const patch of atlas.patches) {
    const motion = kinematics.patches.find(candidate => candidate.id === patch.id);
    if (!motion) throw new Error(`contact kinematics missing patch ${patch.id}`);
    const offset = requireVector3(motion.localOffset, `${patch.id} contact local offset`);
    for (let index = 0; index < patch.influenceVertexIndices.length; index++) {
      const vectorOffset = patch.influenceVertexIndices[index] * 3;
      const weight = patch.influenceWeights[index];
      outputPositions[vectorOffset] += offset[0] * weight;
      outputPositions[vectorOffset + 1] += offset[1] * weight;
      outputPositions[vectorOffset + 2] += offset[2] * weight;
    }
  }
  return {
    schema: 'kaminos.crawler-contact-patch-deformation.v0',
    atlasCastId: atlas.castId,
    patchCount: atlas.patches.length,
    coupling: kinematics.coupling,
  };
}

export function applyCrawlerContactCarrierDeformation(atlasInput, carriersInput, kinematics, outputPositions) {
  const atlas = validateCrawlerContactAtlas(atlasInput);
  if (!atlas.atlasHash) throw new Error('contact atlas byte hash is required for carrier deformation');
  const carriers = validateCrawlerContactCarriers(carriersInput, {
    castId: atlas.castId,
    castHash: atlas.castHash,
    registrationHash: atlas.registrationHash,
    atlasHash: atlas.atlasHash,
    vertexCount: atlas.vertexCount,
  });
  if (kinematics?.schema !== 'kaminos.crawler-contact-kinematics.v0') {
    throw new Error('crawler contact kinematics are required');
  }
  if (!ArrayBuffer.isView(outputPositions) || outputPositions.length !== atlas.vertexCount * 3) {
    throw new Error('contact carrier deformation output must match atlas vertex count');
  }
  let carrierVertexCount = 0;
  let collarVertexCount = 0;
  for (let patchIndex = 0; patchIndex < carriers.patches.length; patchIndex++) {
    const patch = carriers.patches[patchIndex];
    const atlasPatch = atlas.patches[patchIndex];
    if (
      patch.vertexIndices.length !== atlasPatch.vertexIndices.length
      || patch.vertexIndices.some((vertex, index) => vertex !== atlasPatch.vertexIndices[index])
    ) {
      throw new Error(`${patch.id} carrier contact vertices do not match the atlas patch`);
    }
    const motion = kinematics.patches.find(candidate => candidate.id === patch.id);
    if (!motion) throw new Error(`contact kinematics missing patch ${patch.id}`);
    const offset = requireVector3(motion.localOffset, `${patch.id} contact local offset`);
    for (const vertex of patch.carrierVertexIndices) {
      const vectorOffset = vertex * 3;
      outputPositions[vectorOffset] += offset[0];
      outputPositions[vectorOffset + 1] += offset[1];
      outputPositions[vectorOffset + 2] += offset[2];
    }
    for (let index = 0; index < patch.collarVertexIndices.length; index++) {
      const vectorOffset = patch.collarVertexIndices[index] * 3;
      const weight = patch.collarWeights[index];
      outputPositions[vectorOffset] += offset[0] * weight;
      outputPositions[vectorOffset + 1] += offset[1] * weight;
      outputPositions[vectorOffset + 2] += offset[2] * weight;
    }
    carrierVertexCount += patch.carrierVertexIndices.length;
    collarVertexCount += patch.collarVertexIndices.length;
  }
  return {
    schema: 'kaminos.crawler-contact-carrier-deformation.v0',
    atlasCastId: atlas.castId,
    carrierAuthority: carriers.authority,
    patchCount: carriers.patches.length,
    carrierVertexCount,
    collarVertexCount,
    coupling: kinematics.coupling,
  };
}

export function sampleCrawlerContactPatches(atlasInput, deformedPositions, terrainSource, options = {}) {
  const atlas = validateCrawlerContactAtlas(atlasInput);
  if (!ArrayBuffer.isView(deformedPositions) || deformedPositions.length !== atlas.vertexCount * 3) {
    throw new Error('deformed contact sample positions must match atlas vertex count');
  }
  const rootPosition = requireVector3(options.rootPosition, 'contact sample root position');
  const scale = Math.max(EPSILON, Number(options.scale) || 1);
  const frame = options.locomotionFrame;
  const forward = normalize3(requireVector3(frame?.forward, 'contact locomotion forward'));
  const right = normalize3(requireVector3(frame?.right, 'contact locomotion right'), [1, 0, 0]);
  const up = normalize3(requireVector3(frame?.up, 'contact locomotion up'), [0, 1, 0]);
  const patches = atlas.patches.map(patch => {
    const localPosition = weightedPosition(deformedPositions, patch.vertexIndices, patch.weights);
    const worldPosition = [
      rootPosition[0] + scale * (right[0] * localPosition[0] + up[0] * localPosition[1] - forward[0] * localPosition[2]),
      rootPosition[1] + scale * (right[1] * localPosition[0] + up[1] * localPosition[1] - forward[1] * localPosition[2]),
      rootPosition[2] + scale * (right[2] * localPosition[0] + up[2] * localPosition[1] - forward[2] * localPosition[2]),
    ];
    const terrain = sampleHillTerrainSurface(terrainSource, worldPosition[0], worldPosition[2]);
    const terrainPosition = [worldPosition[0], terrain.height, worldPosition[2]];
    const terrainDistance = (
      (worldPosition[0] - terrainPosition[0]) * terrain.normal[0]
      + (worldPosition[1] - terrainPosition[1]) * terrain.normal[1]
      + (worldPosition[2] - terrainPosition[2]) * terrain.normal[2]
    );
    return {
      id: patch.id,
      axialRegion: patch.axialRegion,
      side: patch.side,
      localPosition,
      worldPosition,
      terrainPosition,
      terrainNormal: terrain.normal,
      terrainDistance,
      inBounds: terrain.inBounds,
    };
  });
  return {
    schema: 'kaminos.crawler-contact-samples.v0',
    atlasCastId: atlas.castId,
    patches,
  };
}

export function createCrawlerContactLocomotionState(atlasInput, options = {}) {
  const atlas = validateCrawlerContactAtlas(atlasInput);
  const maximumSpeed = Math.max(0.05, Number(options.maximumSpeed) || 1.6);
  const maximumAcceleration = Math.max(0.05, Number(options.maximumAcceleration) || 4.2);
  const maximumJerk = Math.max(0.1, Number(options.maximumJerk) || 72);
  return {
    schema: 'kaminos.crawler-contact-locomotion-state.v0',
    atlasCastId: atlas.castId,
    routeDistance: 0,
    desiredDistance: 0,
    routeSpeed: 0,
    acceleration: 0,
    jerk: 0,
    rootCorrectionDistance: 0,
    traction: 0,
    coupling: 0,
    limits: { maximumSpeed, maximumAcceleration, maximumJerk },
    patches: atlas.patches.map(patch => ({
      id: patch.id,
      phaseOffset: patch.phaseOffset,
      state: 'swing',
      anchor: null,
      anchorRouteOffset: 0,
      previousWorldPosition: null,
      slip: 0,
      rawSlip: 0,
      clearance: 0,
      cycle: 0,
      supportOffset: 0,
      supportTarget: 0,
      metrics: {
        plantCount: 0,
        releaseCount: 0,
        maximumExtension: 0,
      },
    })),
    metrics: {
      plantCount: 0,
      releaseCount: 0,
      stanceSlipSum: 0,
      stanceSlipSamples: 0,
      meanStanceSlip: 0,
      maximumStanceSlip: 0,
      maximumSwingClearance: 0,
    },
  };
}

export function stepCrawlerContactLocomotion(previous, options = {}) {
  if (previous?.schema !== 'kaminos.crawler-contact-locomotion-state.v0') {
    throw new Error('crawler contact locomotion state is required');
  }
  if (options.contactSamples?.schema !== 'kaminos.crawler-contact-samples.v0') {
    throw new Error('crawler contact locomotion requires contact samples');
  }
  const deltaSeconds = clamp(Number(options.deltaSeconds) || 0, 0, 0.1);
  const desiredDistance = Math.max(previous.desiredDistance, Number(options.desiredDistance) || 0);
  const desiredSpeed = Math.max(0, Number(options.desiredSpeed) || 0);
  const railLength = Math.max(EPSILON, Number(options.railLength) || desiredDistance || 1);
  const coupling = clamp(Number(options.coupling) || 0, 0, 1);
  const frameForward = normalize3(requireVector3(options.locomotionFrame?.forward, 'contact governor locomotion forward'));
  const frameUp = normalize3(requireVector3(options.locomotionFrame?.up, 'contact governor locomotion up'), [0, 1, 0]);
  const scale = Math.max(EPSILON, Number(options.scale) || 1);
  const targetClearance = clamp(Number(options.targetClearance) || 0.018, 0.002, 0.03);
  const maximumSupportExtension = Math.max(0.01, Number(options.maximumSupportExtension) || 0.07) / scale;
  const maximumSupportSpeed = Math.max(0.02, Number(options.maximumSupportSpeed) || 0.55) / scale;
  const kinematics = computeCrawlerContactKinematics(
    previous.patches,
    previous.atlasCastId,
    Number(options.locomotorPhase) || 0,
    { coupling },
  );
  const provisionalOffset = previous.routeDistance - previous.desiredDistance;
  const patches = previous.patches.map(priorPatch => {
    const sample = options.contactSamples.patches.find(candidate => candidate.id === priorPatch.id);
    const motion = kinematics.patches.find(candidate => candidate.id === priorPatch.id);
    if (!sample || !motion) throw new Error(`contact governor missing patch ${priorPatch.id}`);
    const terrainNormal = normalize3(requireVector3(sample.terrainNormal, `${priorPatch.id} terrain normal`), [0, 1, 0]);
    const supportProjection = Math.max(
      0.2,
      frameUp[0] * terrainNormal[0] + frameUp[1] * terrainNormal[1] + frameUp[2] * terrainNormal[2],
    ) * scale;
    const supportTarget = motion.state === 'stance' && sample.inBounds !== false
      ? clamp(
        priorPatch.supportOffset + (targetClearance - sample.terrainDistance) / supportProjection,
        -maximumSupportExtension,
        0,
      ) * coupling
      : 0;
    const maximumSupportDelta = maximumSupportSpeed * deltaSeconds;
    const supportOffset = coupling <= EPSILON
      ? 0
      : priorPatch.supportOffset + clamp(
        supportTarget - priorPatch.supportOffset,
        -maximumSupportDelta,
        maximumSupportDelta,
      );
    const appliedSupportDelta = supportOffset - priorPatch.supportOffset;
    const supportedTerrainDistance = sample.terrainDistance + appliedSupportDelta * supportProjection;
    const supportedWorldPosition = [
      sample.worldPosition[0] + frameUp[0] * appliedSupportDelta * scale,
      sample.worldPosition[1] + frameUp[1] * appliedSupportDelta * scale,
      sample.worldPosition[2] + frameUp[2] * appliedSupportDelta * scale,
    ];
    const canPlant = motion.state === 'stance'
      && sample.inBounds !== false
      && supportedTerrainDistance <= 0.035;
    let state = motion.state;
    let anchor = priorPatch.anchor ? [...priorPatch.anchor] : null;
    let anchorRouteOffset = priorPatch.anchorRouteOffset;
    let planted = false;
    let released = false;
    if (canPlant && priorPatch.state !== 'stance') {
      state = 'stance';
      anchor = supportedWorldPosition;
      anchorRouteOffset = provisionalOffset;
      planted = true;
    } else if (priorPatch.state === 'stance' && motion.state !== 'stance') {
      state = motion.state;
      anchor = null;
      released = true;
    } else if (priorPatch.state === 'stance' && canPlant) {
      state = 'stance';
    } else if (!canPlant) {
      state = motion.state === 'stance' ? 'swing' : motion.state;
      anchor = null;
    }
    const rawSlip = anchor
      ? (
        (supportedWorldPosition[0] - anchor[0]) * frameForward[0]
        + (supportedWorldPosition[1] - anchor[1]) * frameForward[1]
        + (supportedWorldPosition[2] - anchor[2]) * frameForward[2]
      )
      : 0;
    return {
      id: priorPatch.id,
      phaseOffset: priorPatch.phaseOffset,
      state,
      anchor,
      anchorRouteOffset,
      previousWorldPosition: supportedWorldPosition,
      rawSlip,
      slip: rawSlip,
      clearance: supportedTerrainDistance,
      cycle: motion.cycle,
      supportOffset,
      supportTarget,
      metrics: {
        plantCount: priorPatch.metrics.plantCount + (planted ? 1 : 0),
        releaseCount: priorPatch.metrics.releaseCount + (released ? 1 : 0),
        maximumExtension: Math.max(priorPatch.metrics.maximumExtension, Math.abs(supportOffset)),
      },
      planted,
      released,
    };
  });
  const plantedPatches = patches.filter(patch => patch.state === 'stance' && patch.anchor);
  const meanRawSlip = plantedPatches.length
    ? plantedPatches.reduce((sum, patch) => sum + patch.rawSlip, 0) / plantedPatches.length
    : 0;
  const correctionLimit = Math.max(0.002, Number(options.maximumCorrectionDistance) || 0.075);
  const driveEngagement = smoothstep(0, 0.12, desiredSpeed);
  const rootCorrectionDistance = clamp(
    -meanRawSlip * coupling * driveEngagement * 0.82,
    -correctionLimit,
    correctionLimit,
  );
  const targetDistance = clamp(desiredDistance + rootCorrectionDistance, previous.routeDistance, railLength);
  const targetSpeed = deltaSeconds > EPSILON
    ? clamp((targetDistance - previous.routeDistance) / deltaSeconds, 0, previous.limits.maximumSpeed)
    : 0;
  const commandedSpeed = coupling > 0
    ? mix(desiredSpeed, targetSpeed, coupling)
    : desiredSpeed;
  const targetAcceleration = deltaSeconds > EPSILON
    ? clamp(
      (commandedSpeed - previous.routeSpeed) / deltaSeconds,
      -previous.limits.maximumAcceleration,
      previous.limits.maximumAcceleration,
    )
    : 0;
  const accelerationDelta = clamp(
    targetAcceleration - previous.acceleration,
    -previous.limits.maximumJerk * deltaSeconds,
    previous.limits.maximumJerk * deltaSeconds,
  );
  let acceleration = clamp(
    previous.acceleration + accelerationDelta,
    -previous.limits.maximumAcceleration,
    previous.limits.maximumAcceleration,
  );
  let jerk = deltaSeconds > EPSILON ? accelerationDelta / deltaSeconds : 0;
  let routeSpeed = clamp(previous.routeSpeed + acceleration * deltaSeconds, 0, previous.limits.maximumSpeed);
  let routeDistance = clamp(
    Math.min(targetDistance, previous.routeDistance + routeSpeed * deltaSeconds),
    previous.routeDistance,
    railLength,
  );
  if (coupling <= EPSILON) {
    routeDistance = clamp(desiredDistance, previous.routeDistance, railLength);
    routeSpeed = desiredSpeed;
    const baselineAcceleration = deltaSeconds > EPSILON ? (routeSpeed - previous.routeSpeed) / deltaSeconds : 0;
    jerk = deltaSeconds > EPSILON ? (baselineAcceleration - previous.acceleration) / deltaSeconds : 0;
    acceleration = baselineAcceleration;
  }
  const routeOffset = routeDistance - desiredDistance;
  for (const patch of patches) {
    if (patch.state === 'stance' && patch.anchor) {
      patch.slip = patch.rawSlip + routeOffset - patch.anchorRouteOffset;
    }
  }
  const stanceSlips = patches.filter(patch => patch.state === 'stance' && patch.anchor).map(patch => Math.abs(patch.slip));
  const stanceSlipSum = previous.metrics.stanceSlipSum + stanceSlips.reduce((sum, slip) => sum + slip, 0);
  const stanceSlipSamples = previous.metrics.stanceSlipSamples + stanceSlips.length;
  const traction = plantedPatches.length
    ? clamp(1 - (stanceSlips.reduce((sum, slip) => sum + slip, 0) / plantedPatches.length) / 0.12, 0, 1)
    : 0;
  return {
    ...previous,
    routeDistance,
    desiredDistance,
    routeSpeed,
    acceleration,
    jerk,
    rootCorrectionDistance,
    traction,
    coupling,
    patches: patches.map(({ planted, released, ...patch }) => patch),
    metrics: {
      plantCount: previous.metrics.plantCount + patches.filter(patch => patch.planted).length,
      releaseCount: previous.metrics.releaseCount + patches.filter(patch => patch.released).length,
      stanceSlipSum,
      stanceSlipSamples,
      meanStanceSlip: stanceSlipSamples ? stanceSlipSum / stanceSlipSamples : 0,
      maximumStanceSlip: Math.max(previous.metrics.maximumStanceSlip, ...stanceSlips, 0),
      maximumSwingClearance: Math.max(
        previous.metrics.maximumSwingClearance,
        ...patches.filter(patch => patch.state === 'swing').map(patch => patch.clearance),
        0,
      ),
    },
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
