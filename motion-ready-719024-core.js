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
  return {
    schema: 'kaminos.motion-ready-719024.axial-squirm-state.v0',
    castId: MOTION_READY_719024_CAST_ID,
    deformationMode: MOTION_READY_719024_DEFORMATION_MODE,
    amplitude: Math.max(0, Number(options.amplitude) || 0),
    verticalAmplitude: Math.max(0, Number(options.verticalAmplitude) || 0),
    phase: Number(options.phase) || 0,
    phaseVelocity: Math.max(0, Number(options.phaseVelocity) || 0),
    routeSpeed: Math.max(0, Number(options.routeSpeed) || 0),
  };
}

export function stepAxialSquirmController(previous, options = {}) {
  const prior = previous || createAxialSquirmState();
  const deltaSeconds = clamp(Number(options.deltaSeconds) || 0, 0, 0.1);
  const routeSpeed = Math.max(0, Number(options.routeSpeed) || 0);
  const motionWeight = smoothstep(0.025, 0.42, routeSpeed);
  const targetAmplitude = 0.082 * motionWeight;
  const targetVerticalAmplitude = 0.016 * motionWeight;
  const targetPhaseVelocity = 6.2 * motionWeight;
  const amplitudeRate = targetAmplitude > prior.amplitude ? 5.8 : 2.5;
  const phaseRate = targetPhaseVelocity > prior.phaseVelocity ? 7.5 : 3.4;
  const amplitudeBlend = 1 - Math.exp(-amplitudeRate * deltaSeconds);
  const phaseBlend = 1 - Math.exp(-phaseRate * deltaSeconds);
  const amplitude = mix(prior.amplitude, targetAmplitude, amplitudeBlend);
  const verticalAmplitude = mix(prior.verticalAmplitude, targetVerticalAmplitude, amplitudeBlend);
  const phaseVelocity = mix(prior.phaseVelocity, targetPhaseVelocity, phaseBlend);
  return createAxialSquirmState({
    amplitude,
    verticalAmplitude,
    phase: prior.phase + phaseVelocity * deltaSeconds,
    phaseVelocity,
    routeSpeed,
  });
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
    state.verticalAmplitude * envelope * (0.5 + 0.5 * Math.cos(waveAngle - 0.35)),
    mix(registration.tailZ, registration.headZ, normalizedT),
  ];
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
