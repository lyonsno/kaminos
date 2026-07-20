export const MOTION_READY_719024_CAST_ID = 'motion-ready-719024';
export const MOTION_READY_719024_DEFORMATION_MODE = 'axial-parallel-transport-wave-v0';

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
      t: clamp(Number(sample.t) || 0, 0, 1),
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
  const phaseRate = targetPhaseVelocity > prior.phaseVelocity ? 7.5 : 3.4;
  const phaseBlend = 1 - Math.exp(-phaseRate * deltaSeconds);
  const phaseVelocity = mix(prior.phaseVelocity, targetPhaseVelocity, phaseBlend);
  const phase = hasRouteDistance
    ? prior.phaseOffset + routeDistance * phaseRadiansPerUnit
    : prior.phase + phaseVelocity * deltaSeconds;
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
  const longitudinalIntervals = Math.max(
    1,
    Math.ceil(registration.axialSpan * scale / supportSampleSpacing),
  );
  const tValues = new Map();
  for (let index = 0; index <= longitudinalIntervals; index++) {
    const t = index / longitudinalIntervals;
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
    const localZ = mix(registration.tailZ, registration.headZ, t);
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
  const exceeded = outOfBounds
    || maxEnvelopeLift > maxSuspensionLift
    || rootLiftAboveClearance > maxSuspensionLift
    || measuredBend > maxBendRadiansPerStation;
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
    },
    plannerDisposition: exceeded ? 'reroute-required' : 'local-support',
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
  const right = normalize3(cross3([0, 1, 0], tangentHeadward), [1, 0, 0]);
  const up = normalize3(cross3(tangentHeadward, right), [0, 1, 0]);
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
  const center = axialCenterAtT(t, registration, state);
  const frame = axialFrameAtT(t, registration, state);
  return [
    center[0] + frame.right[0] * point[0] + frame.up[0] * point[1],
    center[1] + frame.right[1] * point[0] + frame.up[1] * point[1],
    center[2] + frame.right[2] * point[0] + frame.up[2] * point[1],
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
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const t = clamp((registration.tailZ - originalPositions[vertex * 3 + 2]) / registration.axialSpan, 0, 1);
    const scaled = t * segments;
    const segment = Math.min(segments - 1, Math.floor(scaled));
    segmentIndices[vertex] = segment;
    segmentMix[vertex] = scaled - segment;
  }
  return {
    schema: 'kaminos.motion-ready-719024.axial-geometry-binding.v0',
    castId: MOTION_READY_719024_CAST_ID,
    deformationMode: MOTION_READY_719024_DEFORMATION_MODE,
    registration,
    segments,
    vertexCount,
    originalPositions,
    originalNormals,
    segmentIndices,
    segmentMix,
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
  if (binding?.schema !== 'kaminos.motion-ready-719024.axial-geometry-binding.v0') {
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
    outputPositions[vectorOffset] = centerX + rightX * localX + upX * localY;
    outputPositions[vectorOffset + 1] = centerY + rightY * localX + upY * localY;
    outputPositions[vectorOffset + 2] = centerZ + rightZ * localX + upZ * localY;

    const normalX = originalNormals[vectorOffset];
    const normalY = originalNormals[vectorOffset + 1];
    const normalZ = originalNormals[vectorOffset + 2];
    let deformedNormalX = rightX * normalX + upX * normalY + tangentX * normalZ;
    let deformedNormalY = rightY * normalX + upY * normalY + tangentY * normalZ;
    let deformedNormalZ = rightZ * normalX + upZ * normalY + tangentZ * normalZ;
    const normalLength = Math.hypot(deformedNormalX, deformedNormalY, deformedNormalZ) || 1;
    deformedNormalX /= normalLength;
    deformedNormalY /= normalLength;
    deformedNormalZ /= normalLength;
    outputNormals[vectorOffset] = deformedNormalX;
    outputNormals[vectorOffset + 1] = deformedNormalY;
    outputNormals[vectorOffset + 2] = deformedNormalZ;
  }
  return {
    schema: 'kaminos.motion-ready-719024.axial-geometry-deformation.v0',
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
