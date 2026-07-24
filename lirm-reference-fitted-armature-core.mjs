let createHash;
let existsSync;
let readFileSync;
let statSync;
let mkdir;
let readFile;
let rename;
let writeFile;
let basename;
let dirname;
let isAbsolute;
let resolve;
let deflateSync;

if (typeof process !== 'undefined' && process.versions?.node) {
  ({ createHash } = await import('node:crypto'));
  ({ existsSync, readFileSync, statSync } = await import('node:fs'));
  ({ mkdir, readFile, rename, writeFile } = await import('node:fs/promises'));
  ({ basename, dirname, isAbsolute, resolve } = await import('node:path'));
  ({ deflateSync } = await import('node:zlib'));
}

export const REFERENCE_FIT_ROUTE = 'kaminos/reference-fitted-armature/software-glb-raster-plus-sdf-fit-v0';
export const REFERENCE_FIT_CAMERAS = Object.freeze(Array.from({ length: 8 }, (_, index) => Object.freeze({
  id: `az${String(index * 45).padStart(3, '0')}`,
  projection: 'orthographic',
  yaw: index * Math.PI / 4,
  pitch: 0.18,
  radius: 4,
  viewportWidth: 2.8,
  viewportHeight: 2.25,
  near: 2.25,
  far: 5.75,
})));

export const REFERENCE_FIT_PARAMETER_SPECS = Object.freeze([
  { id: 'bodyLength', semanticRole: 'axialExtent', initial: 0.92, min: 0.58, max: 1.58, step: 0.18 },
  { id: 'bodyWidth', semanticRole: 'lateralMass', initial: 0.46, min: 0.25, max: 0.92, step: 0.12 },
  { id: 'bodyHeight', semanticRole: 'verticalMass', initial: 0.36, min: 0.2, max: 0.78, step: 0.1 },
  { id: 'headScale', semanticRole: 'headOrientation', initial: 0.54, min: 0.3, max: 1.18, step: 0.13 },
  { id: 'bellyScale', semanticRole: 'bodyMass', initial: 0.72, min: 0.4, max: 1.42, step: 0.15 },
  { id: 'tailScale', semanticRole: 'posteriorTaper', initial: 0.42, min: 0.18, max: 0.95, step: 0.12 },
  { id: 'dorsalLift', semanticRole: 'dorsalProfile', initial: 0.04, min: -0.18, max: 0.36, step: 0.08 },
  { id: 'curveAmplitude', semanticRole: 'axialCurvature', initial: 0.04, min: 0, max: 0.34, step: 0.07 },
  { id: 'limbLength', semanticRole: 'contactLimb', initial: 0.28, min: 0.12, max: 0.68, step: 0.09 },
  { id: 'limbSpread', semanticRole: 'contactFootprint', initial: 0.54, min: 0.3, max: 1.02, step: 0.1 },
  { id: 'limbThickness', semanticRole: 'contactLimb', initial: 0.09, min: 0.045, max: 0.22, step: 0.035 },
  { id: 'contactHeight', semanticRole: 'groundContact', initial: -0.25, min: -0.62, max: -0.08, step: 0.08 },
  { id: 'headLift', semanticRole: 'headOrientation', initial: 0.04, min: -0.18, max: 0.34, step: 0.07 },
]);

export const CRAWLER_ARMATURE_PROGRAM = Object.freeze({
  id: 'kaminos.lirm-armature-program.crawler.v0',
  parameterVocabulary: 'kaminos.reference-fitted-armature.13-semantic-parameters.v0',
  parameterSpecs: REFERENCE_FIT_PARAMETER_SPECS,
  createPrimitives: createReferenceArmaturePrimitives,
});

const PRESERVED_PROXY_PARAMETER_SPECS = Object.freeze([
  { id: 'axialScale', semanticRole: 'axialExtent', initial: 1, min: 0.58, max: 1.62, step: 0.16 },
  { id: 'lateralScale', semanticRole: 'lateralMass', initial: 1, min: 0.58, max: 1.74, step: 0.16 },
  { id: 'verticalScale', semanticRole: 'verticalMass', initial: 1, min: 0.58, max: 1.74, step: 0.16 },
  { id: 'headScale', semanticRole: 'headOrientation', initial: 1, min: 0.62, max: 1.58, step: 0.14 },
  { id: 'limbLengthScale', semanticRole: 'contactLimb', initial: 1, min: 0.52, max: 1.82, step: 0.18 },
  { id: 'limbSpreadScale', semanticRole: 'contactFootprint', initial: 1, min: 0.52, max: 1.82, step: 0.18 },
  { id: 'dorsalLift', semanticRole: 'dorsalProfile', initial: 0, min: -0.22, max: 0.3, step: 0.08 },
  { id: 'contactDrop', semanticRole: 'groundContact', initial: 0, min: -0.28, max: 0.2, step: 0.08 },
]);

const PRESERVED_PROXY_ROLE_MAP = Object.freeze({
  body_mass: 'bodyMass',
  head_orientation: 'headOrientation',
  terminal_mouth: 'facialLandmark',
  limb_bud: 'contactLimb',
  shell_plate: 'dorsalProfile',
  contact_point: 'groundContact',
});

function sourceProxyAxis(primitive) {
  const side = primitive.side === 'right' ? 1 : primitive.side === 'left' ? -1 : 0.3;
  const forward = primitive.t ? (primitive.t - 0.5) * 0.28 : 0;
  return normalize(v3(forward, side, 0.18));
}

function fittedProxyPoint(source, parameters, role) {
  const lateralMultiplier = ['contactLimb', 'groundContact'].includes(role) ? parameters.limbSpreadScale : 1;
  const verticalOffset = role === 'dorsalProfile' ? parameters.dorsalLift
    : role === 'groundContact' ? parameters.contactDrop : 0;
  return v3(
    source.z * parameters.lateralScale * lateralMultiplier,
    source.y * parameters.verticalScale + verticalOffset,
    -source.x * parameters.axialScale,
  );
}

function fittedProxyPrimitive(source, index, candidateId, parameters) {
  const role = PRESERVED_PROXY_ROLE_MAP[source.role] ?? source.role;
  const sourcePrimitiveId = `${candidateId}:proxy-${index}`;
  const center = fittedProxyPoint(source.center, parameters, role);
  if (source.kind === 'capsule') {
    const axis = sourceProxyAxis(source);
    const halfLength = (source.length || source.radius || 0.08) * 0.48 * parameters.limbLengthScale;
    const sourceA = sub(source.center, mul(axis, halfLength));
    const sourceB = add(source.center, mul(axis, halfLength));
    return {
      kind: 'capsule', role, sourceRole: source.role, sourcePrimitiveId,
      a: fittedProxyPoint(sourceA, parameters, role),
      b: fittedProxyPoint(sourceB, parameters, role),
      radius: Math.max(0.012, source.radius * (parameters.lateralScale + parameters.verticalScale) * 0.5),
    };
  }
  if (source.kind === 'box') {
    const size = source.size ?? {};
    return {
      kind: 'ellipsoid', role, sourceRole: source.role, sourcePrimitiveId, center,
      radius: v3(
        Math.max(0.012, (size.z ?? 0.03) * 0.9 * parameters.lateralScale),
        Math.max(0.018, (size.y ?? 0.05) * 0.72 * parameters.verticalScale),
        Math.max(0.035, (size.x ?? 0.08) * 0.52 * parameters.axialScale),
      ),
    };
  }
  const radius = Math.max(0.018, source.radius ?? 0.04);
  const headMultiplier = role === 'headOrientation' ? parameters.headScale : 1;
  const lateralMultiplier = role === 'groundContact' ? parameters.limbSpreadScale : 1;
  return {
    kind: 'ellipsoid', role, sourceRole: source.role, sourcePrimitiveId, center,
    radius: v3(
      radius * parameters.lateralScale * lateralMultiplier * headMultiplier,
      radius * parameters.verticalScale * headMultiplier,
      radius * parameters.axialScale * headMultiplier,
    ),
  };
}

export function createPreservedProxyArmatureProgram(packet, { sourcePacketSha256 } = {}) {
  if (packet?.schema !== 'kaminos.lirm-speciation-armature-control-packet.v0') {
    throw new Error('preserved proxy armature requires an exact lirm control packet');
  }
  if (typeof packet.candidateId !== 'string' || !packet.candidateId.trim()) throw new Error('control packet requires candidateId');
  if (!Array.isArray(packet.proxyPrimitives) || packet.proxyPrimitives.length === 0) throw new Error('control packet has no proxy primitives');
  const sourcePrimitives = structuredClone(packet.proxyPrimitives);
  if (!/^sha256:[0-9a-f]{64}$/.test(sourcePacketSha256 ?? '')) {
    throw new Error('preserved proxy armature requires the exact source packet byte hash');
  }
  const program = {
    id: `kaminos.lirm-preserved-proxy-armature.${packet.candidateId}.v0`,
    parameterVocabulary: 'kaminos.lirm-preserved-proxy-armature.8-low-frequency-parameters.v0',
    parameterSpecs: PRESERVED_PROXY_PARAMETER_SPECS,
    sourceCandidateId: packet.candidateId,
    sourcePrimitiveCount: sourcePrimitives.length,
    sourcePacketSha256,
    createPrimitives(parameters) {
      const p = parameterObject(parameters, PRESERVED_PROXY_PARAMETER_SPECS);
      return sourcePrimitives.map((primitive, index) => fittedProxyPrimitive(primitive, index, packet.candidateId, p));
    },
  };
  return Object.freeze(program);
}

function proxySegmentFrame(a, b) {
  const tangent = normalize(sub(b, a));
  const reference = Math.abs(dot(tangent, v3(0, 1, 0))) > 0.92 ? v3(1, 0, 0) : v3(0, 1, 0);
  const lateral = normalize(cross(reference, tangent));
  const normal = normalize(cross(tangent, lateral));
  return { tangent, lateral, normal };
}

export function createFittedProxyRigRegistration({
  fitReport,
  fitReportPath,
  armatureProgram,
  expectedDonorSha256,
  requireEvidenceFiles = true,
}) {
  if (fitReport?.status !== 'assay-passed-inspected'
      || fitReport.acceptance?.visualInspection?.disposition !== 'accepted') {
    throw new Error('fitted proxy rig requires a visually inspected and accepted fit');
  }
  validateReferenceFitReport(fitReport, { requireFiles: requireEvidenceFiles, reportPath: fitReportPath });
  const { projection } = resolveArmatureProgram(armatureProgram);
  if (fitReport.effectiveArmatureProgramId !== projection.id || fitReport.requestedArmatureProgramId !== projection.id) {
    throw new Error('fitted proxy rig armature program identity mismatch');
  }
  if (fitReport.donor?.sha256 !== expectedDonorSha256) {
    throw new Error(`fitted proxy rig donor hash mismatch: ${fitReport.donor?.sha256} != ${expectedDonorSha256}`);
  }
  const primitives = armatureProgram.createPrimitives(fitReport.fittedParameters);
  const body = primitives.filter(primitive => primitive.role === 'bodyMass' && primitive.kind === 'ellipsoid');
  if (body.length < 3) throw new Error('fitted proxy rig requires at least three preserved body-mass stations');
  body.sort((left, right) => right.center.z - left.center.z);
  let cumulative = 0;
  const distances = body.slice(1).map((primitive, index) => {
    const distance = length3(sub(primitive.center, body[index].center));
    cumulative += distance;
    return distance;
  });
  const totalLength = Math.max(cumulative, 1e-9);
  cumulative = 0;
  const stations = body.map((primitive, index) => {
    if (index > 0) cumulative += distances[index - 1];
    return {
      id: `station-${String(index).padStart(2, '0')}`,
      sourcePrimitiveId: primitive.sourcePrimitiveId,
      t: cumulative / totalLength,
      position: { ...primitive.center },
      radius: { ...primitive.radius },
    };
  });
  return {
    schema: 'kaminos.lirm-fitted-proxy-rig-registration.v0',
    fitMode: 'semantic-sdf-held-out-multiview-v0',
    sourceCandidateId: armatureProgram.sourceCandidateId,
    sourcePacketSha256: armatureProgram.sourcePacketSha256,
    sourcePrimitiveCount: armatureProgram.sourcePrimitiveCount,
    armatureProgramId: projection.id,
    donorSha256: expectedDonorSha256,
    stationCount: stations.length,
    manualControlCount: 0,
    headDirection: '-Z',
    stations,
  };
}

function packedProxyPositions(positions) {
  if (!Array.isArray(positions) && !ArrayBuffer.isView(positions)) throw new TypeError('proxy rig binding requires positions');
  if (positions.length === 0) throw new Error('proxy rig binding requires at least one vertex');
  if (typeof positions[0] === 'number') {
    if (positions.length % 3 !== 0) throw new Error('packed position length must be divisible by three');
    return Float64Array.from(positions);
  }
  const packed = new Float64Array(positions.length * 3);
  positions.forEach((point, index) => {
    if (![point?.x, point?.y, point?.z].every(Number.isFinite)) throw new Error(`invalid position at ${index}`);
    packed[index * 3] = point.x; packed[index * 3 + 1] = point.y; packed[index * 3 + 2] = point.z;
  });
  return packed;
}

export function createFittedProxyRigBinding({ positions, registration }) {
  if (registration?.schema !== 'kaminos.lirm-fitted-proxy-rig-registration.v0' || registration.manualControlCount !== 0) {
    throw new Error('proxy rig binding requires an automatic fitted registration');
  }
  const restPositions = packedProxyPositions(positions);
  const vertexCount = restPositions.length / 3;
  const segmentIndices = new Uint16Array(vertexCount);
  const segmentMix = new Float64Array(vertexCount);
  const localCoordinates = new Float64Array(vertexCount * 3);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const point = v3(restPositions[vertex * 3], restPositions[vertex * 3 + 1], restPositions[vertex * 3 + 2]);
    let best = null;
    for (let segment = 0; segment < registration.stations.length - 1; segment += 1) {
      const a = registration.stations[segment].position;
      const b = registration.stations[segment + 1].position;
      const ab = sub(b, a);
      const mix = clamp(dot(sub(point, a), ab) / Math.max(dot(ab, ab), 1e-12), 0, 1);
      const anchor = add(a, mul(ab, mix));
      const distance = length3(sub(point, anchor));
      if (!best || distance < best.distance) best = { segment, mix, anchor, distance };
    }
    const a = registration.stations[best.segment].position;
    const b = registration.stations[best.segment + 1].position;
    const frame = proxySegmentFrame(a, b);
    const residual = sub(point, best.anchor);
    segmentIndices[vertex] = best.segment;
    segmentMix[vertex] = best.mix;
    localCoordinates[vertex * 3] = dot(residual, frame.lateral);
    localCoordinates[vertex * 3 + 1] = dot(residual, frame.normal);
    localCoordinates[vertex * 3 + 2] = dot(residual, frame.tangent);
  }
  return {
    schema: 'kaminos.lirm-fitted-proxy-rig-binding.v0',
    registration,
    vertexCount,
    manualControlCount: 0,
    restPositions,
    segmentIndices,
    segmentMix,
    localCoordinates,
  };
}

export function createFittedProxyRigPose({ registration, phase = 0, amplitude = 0.1 }) {
  if (registration?.schema !== 'kaminos.lirm-fitted-proxy-rig-registration.v0') throw new Error('proxy rig pose requires fitted registration');
  if (!Number.isFinite(phase) || !Number.isFinite(amplitude) || amplitude < 0 || amplitude > 0.35) {
    throw new Error('proxy rig pose requires finite phase and amplitude in [0, 0.35]');
  }
  const stationPositions = registration.stations.map((station, index) => {
    if (amplitude === 0) return { ...station.position };
    const previous = registration.stations[Math.max(0, index - 1)].position;
    const next = registration.stations[Math.min(registration.stations.length - 1, index + 1)].position;
    const frame = proxySegmentFrame(previous, next);
    const envelope = Math.sin(Math.PI * station.t);
    const wave = Math.sin((station.t * 1.6 + phase) * Math.PI * 2);
    const lift = Math.max(0, Math.cos((station.t * 1.6 + phase) * Math.PI * 2));
    return add(
      add(station.position, mul(frame.lateral, amplitude * envelope * wave)),
      mul(frame.normal, amplitude * 0.22 * envelope * lift),
    );
  });
  return {
    schema: 'kaminos.lirm-fitted-proxy-rig-pose.v0',
    sourceCandidateId: registration.sourceCandidateId,
    phase,
    amplitude,
    stationPositions,
  };
}

export function deformFittedProxyRigBinding({ binding, pose }) {
  if (binding?.schema !== 'kaminos.lirm-fitted-proxy-rig-binding.v0') throw new Error('proxy rig deformation requires fitted binding');
  if (pose?.schema !== 'kaminos.lirm-fitted-proxy-rig-pose.v0'
      || pose.stationPositions?.length !== binding.registration.stations.length) {
    throw new Error('proxy rig deformation pose does not match registration');
  }
  const output = new Float64Array(binding.vertexCount * 3);
  for (let vertex = 0; vertex < binding.vertexCount; vertex += 1) {
    const segment = binding.segmentIndices[vertex];
    const mix = binding.segmentMix[vertex];
    const a = pose.stationPositions[segment];
    const b = pose.stationPositions[segment + 1];
    const frame = proxySegmentFrame(a, b);
    const anchor = add(a, mul(sub(b, a), mix));
    const point = add(add(add(
      anchor,
      mul(frame.lateral, binding.localCoordinates[vertex * 3]),
    ), mul(frame.normal, binding.localCoordinates[vertex * 3 + 1])), mul(frame.tangent, binding.localCoordinates[vertex * 3 + 2]));
    output[vertex * 3] = point.x; output[vertex * 3 + 1] = point.y; output[vertex * 3 + 2] = point.z;
  }
  return output;
}

function lerpPoint(a, b, mix) {
  return add(a, mul(sub(b, a), mix));
}

function extrapolateEndpoint(endpoint, neighbor) {
  return add(endpoint, sub(endpoint, neighbor));
}

function catmullKnot(previous, next, knot) {
  return knot + Math.sqrt(Math.max(length3(sub(next, previous)), 1e-12));
}

function catmullBlend(a, b, ta, tb, t) {
  const span = Math.max(tb - ta, 1e-12);
  return add(mul(a, (tb - t) / span), mul(b, (t - ta) / span));
}

function evaluateCentripetalCatmullRom(points, segment, mix) {
  const p1 = points[segment];
  const p2 = points[segment + 1];
  const p0 = segment > 0 ? points[segment - 1] : extrapolateEndpoint(p1, p2);
  const p3 = segment + 2 < points.length ? points[segment + 2] : extrapolateEndpoint(p2, p1);
  const t0 = 0;
  const t1 = catmullKnot(p0, p1, t0);
  const t2 = catmullKnot(p1, p2, t1);
  const t3 = catmullKnot(p2, p3, t2);
  const t = t1 + (t2 - t1) * mix;
  const a1 = catmullBlend(p0, p1, t0, t1, t);
  const a2 = catmullBlend(p1, p2, t1, t2, t);
  const a3 = catmullBlend(p2, p3, t2, t3, t);
  const b1 = catmullBlend(a1, a2, t0, t2, t);
  const b2 = catmullBlend(a2, a3, t1, t3, t);
  return catmullBlend(b1, b2, t1, t2, t);
}

function rotateByMinimalTangentChange(vector, fromTangent, toTangent) {
  const cosine = clamp(dot(fromTangent, toTangent), -1, 1);
  const axisVector = cross(fromTangent, toTangent);
  const sine = length3(axisVector);
  if (sine < 1e-10) {
    if (cosine > 0) return { ...vector };
    const fallback = proxySegmentFrame(v3(), fromTangent).normal;
    return sub(mul(fallback, 2 * dot(fallback, vector)), vector);
  }
  const axis = mul(axisVector, 1 / sine);
  return add(
    add(mul(vector, cosine), mul(cross(axis, vector), sine)),
    mul(axis, dot(axis, vector) * (1 - cosine)),
  );
}

function orthonormalCurveFrame(tangent, lateralCandidate) {
  const exactTangent = normalize(tangent);
  let lateral = sub(lateralCandidate, mul(exactTangent, dot(lateralCandidate, exactTangent)));
  if (length3(lateral) < 1e-8) lateral = proxySegmentFrame(v3(), exactTangent).lateral;
  lateral = normalize(lateral);
  const normal = normalize(cross(exactTangent, lateral));
  return { tangent: exactTangent, lateral, normal };
}

export function createSmoothFittedProxyRigCurve({ stationPositions, sampleCount = 192 } = {}) {
  if (!Array.isArray(stationPositions) || stationPositions.length < 3
      || !stationPositions.every(point => [point?.x, point?.y, point?.z].every(Number.isFinite))) {
    throw new Error('smooth fitted curve requires at least three finite station positions');
  }
  if (!Number.isInteger(sampleCount) || sampleCount < 32 || sampleCount > 4096) {
    throw new Error('smooth fitted curve sampleCount must be an integer in [32, 4096]');
  }
  const samples = Array.from({ length: sampleCount }, (_, index) => {
    if (index === sampleCount - 1) return { ...stationPositions.at(-1) };
    const progress = index / (sampleCount - 1) * (stationPositions.length - 1);
    const segment = Math.min(stationPositions.length - 2, Math.floor(progress));
    return evaluateCentripetalCatmullRom(stationPositions, segment, progress - segment);
  });
  const cumulative = new Float64Array(sampleCount);
  for (let index = 1; index < sampleCount; index += 1) {
    cumulative[index] = cumulative[index - 1] + length3(sub(samples[index], samples[index - 1]));
  }
  const totalLength = cumulative.at(-1);
  if (!(totalLength > 1e-8)) throw new Error('smooth fitted curve collapsed to zero length');
  const arcCoordinates = Float64Array.from(cumulative, value => value / totalLength);
  arcCoordinates[0] = 0;
  arcCoordinates[arcCoordinates.length - 1] = 1;
  const tangents = samples.map((sample, index) => {
    const previous = samples[Math.max(0, index - 1)];
    const next = samples[Math.min(samples.length - 1, index + 1)];
    return normalize(sub(next, previous));
  });
  const frames = new Array(sampleCount);
  frames[0] = orthonormalCurveFrame(tangents[0], proxySegmentFrame(samples[0], samples[1]).lateral);
  for (let index = 1; index < sampleCount; index += 1) {
    const transported = rotateByMinimalTangentChange(
      frames[index - 1].lateral,
      frames[index - 1].tangent,
      tangents[index],
    );
    frames[index] = orthonormalCurveFrame(tangents[index], transported);
  }
  return {
    schema: 'kaminos.lirm-smooth-fitted-proxy-rig-curve.v0',
    sampleCount,
    samples,
    frames,
    arcCoordinates,
    totalLength,
  };
}

function smoothCurveInterval(curve, arcCoordinate) {
  const target = clamp(arcCoordinate, 0, 1);
  let low = 0;
  let high = curve.arcCoordinates.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (curve.arcCoordinates[middle] <= target) low = middle;
    else high = middle;
  }
  const start = curve.arcCoordinates[low];
  const end = curve.arcCoordinates[high];
  return { index: low, mix: clamp((target - start) / Math.max(end - start, 1e-12), 0, 1) };
}

function evaluateSmoothCurveFrame(curve, arcCoordinate) {
  const { index, mix } = smoothCurveInterval(curve, arcCoordinate);
  const center = lerpPoint(curve.samples[index], curve.samples[index + 1], mix);
  const tangent = normalize(lerpPoint(curve.frames[index].tangent, curve.frames[index + 1].tangent, mix));
  const lateralCandidate = normalize(lerpPoint(curve.frames[index].lateral, curve.frames[index + 1].lateral, mix));
  return { center, ...orthonormalCurveFrame(tangent, lateralCandidate) };
}

function monotonicAxialArcCoordinate(curve, axialPosition) {
  for (let index = 1; index < curve.samples.length; index += 1) {
    if (curve.samples[index].z > curve.samples[index - 1].z + 1e-8) {
      throw new Error('smooth fitted curve is not monotonic along the registered axial Z direction');
    }
  }
  if (axialPosition >= curve.samples[0].z) return 0;
  if (axialPosition <= curve.samples.at(-1).z) return 1;
  let low = 0;
  let high = curve.samples.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (curve.samples[middle].z >= axialPosition) low = middle;
    else high = middle;
  }
  const start = curve.samples[low].z;
  const end = curve.samples[high].z;
  const mix = clamp((start - axialPosition) / Math.max(start - end, 1e-12), 0, 1);
  return curve.arcCoordinates[low]
    + (curve.arcCoordinates[high] - curve.arcCoordinates[low]) * mix;
}

export function createSmoothFittedProxyRigBinding({
  positions,
  registration,
  sampleCount = 192,
  parameterization = 'monotonic-axial-z',
} = {}) {
  if (registration?.schema !== 'kaminos.lirm-fitted-proxy-rig-registration.v0' || registration.manualControlCount !== 0) {
    throw new Error('smooth proxy rig binding requires an automatic fitted registration');
  }
  const restPositions = packedProxyPositions(positions);
  const vertexCount = restPositions.length / 3;
  const restCurve = createSmoothFittedProxyRigCurve({
    stationPositions: registration.stations.map(station => station.position),
    sampleCount,
  });
  if (!['monotonic-axial-z', 'nearest-curve'].includes(parameterization)) {
    throw new Error(`unknown smooth proxy rig parameterization: ${parameterization}`);
  }
  const arcCoordinates = new Float64Array(vertexCount);
  const localCoordinates = new Float64Array(vertexCount * 3);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const point = v3(restPositions[vertex * 3], restPositions[vertex * 3 + 1], restPositions[vertex * 3 + 2]);
    let bestArc = monotonicAxialArcCoordinate(restCurve, point.z);
    if (parameterization === 'nearest-curve') {
      let bestDistanceSquared = Infinity;
      for (let segment = 0; segment < restCurve.samples.length - 1; segment += 1) {
        const a = restCurve.samples[segment];
        const b = restCurve.samples[segment + 1];
        const ab = sub(b, a);
        const mix = clamp(dot(sub(point, a), ab) / Math.max(dot(ab, ab), 1e-12), 0, 1);
        const anchor = lerpPoint(a, b, mix);
        const residual = sub(point, anchor);
        const distanceSquared = dot(residual, residual);
        if (distanceSquared < bestDistanceSquared) {
          bestDistanceSquared = distanceSquared;
          bestArc = restCurve.arcCoordinates[segment]
            + (restCurve.arcCoordinates[segment + 1] - restCurve.arcCoordinates[segment]) * mix;
        }
      }
    }
    const frame = evaluateSmoothCurveFrame(restCurve, bestArc);
    const residual = sub(point, frame.center);
    arcCoordinates[vertex] = bestArc;
    localCoordinates[vertex * 3] = dot(residual, frame.lateral);
    localCoordinates[vertex * 3 + 1] = dot(residual, frame.normal);
    localCoordinates[vertex * 3 + 2] = dot(residual, frame.tangent);
  }
  return {
    schema: 'kaminos.lirm-smooth-fitted-proxy-rig-binding.v0',
    registration,
    vertexCount,
    sampleCount,
    parameterization,
    manualControlCount: 0,
    restPositions,
    restCurve,
    arcCoordinates,
    localCoordinates,
  };
}

function rotateAroundAxis(vector, axis, angle) {
  const exactAxis = normalize(axis);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return add(
    add(mul(vector, cosine), mul(cross(exactAxis, vector), sine)),
    mul(exactAxis, dot(exactAxis, vector) * (1 - cosine)),
  );
}

function proceduralSegmentAngles(preset, t, maximumAngle) {
  if (preset === 'c-bend') return { yaw: maximumAngle * (t * 2 - 1), pitch: 0 };
  if (preset === 's-bend') return { yaw: maximumAngle * Math.sin(Math.PI * 2 * t), pitch: 0 };
  if (preset === 'asymmetric') {
    return {
      yaw: maximumAngle * (0.68 * Math.sin(Math.PI * 2 * (t - 0.11)) + 0.24 * (t * 2 - 1)),
      pitch: maximumAngle * 0.24 * Math.sin(Math.PI * t),
    };
  }
  throw new Error(`unknown smooth fitted proxy rig pose preset: ${preset}`);
}

function createAngleIntegratedStationPose(restPositions, stationParameters, preset, amplitude) {
  const baseFrame = proxySegmentFrame(restPositions[0], restPositions.at(-1));
  const maximumAngle = amplitude * 2;
  const transformedSegments = restPositions.slice(0, -1).map((point, index) => {
    const restSegment = sub(restPositions[index + 1], point);
    const t = (stationParameters[index] + stationParameters[index + 1]) * 0.5;
    const angles = proceduralSegmentAngles(preset, t, maximumAngle);
    const yawed = rotateAroundAxis(restSegment, baseFrame.normal, angles.yaw);
    return rotateAroundAxis(yawed, baseFrame.lateral, angles.pitch);
  });
  const output = new Array(restPositions.length);
  const middle = Math.floor((restPositions.length - 1) / 2);
  output[middle] = { ...restPositions[middle] };
  for (let index = middle + 1; index < output.length; index += 1) {
    output[index] = add(output[index - 1], transformedSegments[index - 1]);
  }
  for (let index = middle - 1; index >= 0; index -= 1) {
    output[index] = sub(output[index + 1], transformedSegments[index]);
  }
  return output;
}

function preserveStationChainLengths(restPositions, targetPositions) {
  const output = targetPositions.map(point => ({ ...point }));
  const middle = Math.floor((output.length - 1) / 2);
  for (let index = middle - 1; index >= 0; index -= 1) {
    const restLength = length3(sub(restPositions[index], restPositions[index + 1]));
    let direction = sub(targetPositions[index], output[index + 1]);
    if (length3(direction) < 1e-9) direction = sub(restPositions[index], restPositions[index + 1]);
    output[index] = add(output[index + 1], mul(normalize(direction), restLength));
  }
  for (let index = middle + 1; index < output.length; index += 1) {
    const restLength = length3(sub(restPositions[index], restPositions[index - 1]));
    let direction = sub(targetPositions[index], output[index - 1]);
    if (length3(direction) < 1e-9) direction = sub(restPositions[index], restPositions[index - 1]);
    output[index] = add(output[index - 1], mul(normalize(direction), restLength));
  }
  return output;
}

export function createSmoothFittedProxyRigPose({
  registration,
  preset = 'rest',
  amplitude = 0.28,
  stationOffsets = null,
} = {}) {
  if (registration?.schema !== 'kaminos.lirm-fitted-proxy-rig-registration.v0') {
    throw new Error('smooth proxy rig pose requires fitted registration');
  }
  if (!['rest', 'c-bend', 's-bend', 'asymmetric'].includes(preset)) {
    throw new Error(`unknown smooth fitted proxy rig pose preset: ${preset}`);
  }
  if (!Number.isFinite(amplitude) || amplitude < 0 || amplitude > 0.45) {
    throw new Error('smooth proxy rig pose amplitude must be finite in [0, 0.45]');
  }
  if (stationOffsets !== null && (!Array.isArray(stationOffsets)
      || stationOffsets.length !== registration.stationCount
      || !stationOffsets.every(point => [point?.x, point?.y, point?.z].every(Number.isFinite)))) {
    throw new Error('smooth proxy rig stationOffsets must match the fitted station count');
  }
  const restPositions = registration.stations.map(station => station.position);
  if (preset === 'rest' && stationOffsets === null) {
    return {
      schema: 'kaminos.lirm-smooth-fitted-proxy-rig-pose.v0',
      sourceCandidateId: registration.sourceCandidateId,
      preset,
      amplitude: 0,
      stationPositions: restPositions.map(point => ({ ...point })),
    };
  }
  const proceduralPositions = preset === 'rest'
    ? restPositions.map(point => ({ ...point }))
    : createAngleIntegratedStationPose(
      restPositions,
      registration.stations.map(station => station.t),
      preset,
      amplitude,
    );
  const targetPositions = proceduralPositions.map((point, index) => add(point, stationOffsets?.[index] ?? v3()));
  return {
    schema: 'kaminos.lirm-smooth-fitted-proxy-rig-pose.v0',
    sourceCandidateId: registration.sourceCandidateId,
    preset,
    amplitude,
    stationPositions: preserveStationChainLengths(restPositions, targetPositions),
  };
}

export function deformSmoothFittedProxyRigBinding({ binding, pose } = {}) {
  if (binding?.schema !== 'kaminos.lirm-smooth-fitted-proxy-rig-binding.v0') {
    throw new Error('smooth proxy rig deformation requires smooth fitted binding');
  }
  if (pose?.schema !== 'kaminos.lirm-smooth-fitted-proxy-rig-pose.v0'
      || pose.stationPositions?.length !== binding.registration.stationCount) {
    throw new Error('smooth proxy rig deformation pose does not match registration');
  }
  const poseCurve = createSmoothFittedProxyRigCurve({
    stationPositions: pose.stationPositions,
    sampleCount: binding.sampleCount,
  });
  const output = new Float64Array(binding.vertexCount * 3);
  for (let vertex = 0; vertex < binding.vertexCount; vertex += 1) {
    const frame = evaluateSmoothCurveFrame(poseCurve, binding.arcCoordinates[vertex]);
    const point = add(
      add(
        add(frame.center, mul(frame.lateral, binding.localCoordinates[vertex * 3])),
        mul(frame.normal, binding.localCoordinates[vertex * 3 + 1]),
      ),
      mul(frame.tangent, binding.localCoordinates[vertex * 3 + 2]),
    );
    output[vertex * 3] = point.x;
    output[vertex * 3 + 1] = point.y;
    output[vertex * 3 + 2] = point.z;
  }
  return output;
}

export const SMOOTH_FITTED_PHASE_ROUTE = 'kaminos/fitted-proxy-rig/arbitrary-phase-plus-semantic-probes-v0';
export const SMOOTH_FITTED_PHASE_SEQUENCE = Object.freeze([
  'rest',
  'c-bend',
  'rest',
  's-bend',
  'rest',
  'asymmetric',
  'rest',
]);

function normalizedCyclePhase(phase) {
  if (!Number.isFinite(phase)) throw new Error('smooth fitted cycle phase must be finite');
  return ((phase % 1) + 1) % 1;
}

function smoothstep(value) {
  const exact = clamp(value, 0, 1);
  return exact * exact * (3 - 2 * exact);
}

export function createSmoothFittedProxyRigCyclePose({
  registration,
  phase = 0,
  amplitude = 0.18,
} = {}) {
  if (registration?.schema !== 'kaminos.lirm-fitted-proxy-rig-registration.v0') {
    throw new Error('smooth fitted cycle pose requires fitted registration');
  }
  if (!Number.isFinite(amplitude) || amplitude < 0 || amplitude > 0.45) {
    throw new Error('smooth fitted cycle pose amplitude must be finite in [0, 0.45]');
  }
  const normalizedPhase = normalizedCyclePhase(phase);
  const rawSegmentPosition = normalizedPhase * (SMOOTH_FITTED_PHASE_SEQUENCE.length - 1);
  const nearestKeyframe = Math.round(rawSegmentPosition);
  const segmentPosition = Math.abs(rawSegmentPosition - nearestKeyframe) < 1e-12
    ? nearestKeyframe
    : rawSegmentPosition;
  const segment = Math.min(
    SMOOTH_FITTED_PHASE_SEQUENCE.length - 2,
    Math.floor(segmentPosition),
  );
  const linearMix = segmentPosition - segment;
  const mix = smoothstep(linearMix);
  const fromPreset = SMOOTH_FITTED_PHASE_SEQUENCE[segment];
  const toPreset = SMOOTH_FITTED_PHASE_SEQUENCE[segment + 1];
  const fromPose = createSmoothFittedProxyRigPose({ registration, preset: fromPreset, amplitude });
  const toPose = createSmoothFittedProxyRigPose({ registration, preset: toPreset, amplitude });
  let stationPositions;
  if (mix === 0) {
    stationPositions = fromPose.stationPositions.map(point => ({ ...point }));
  } else if (mix === 1) {
    stationPositions = toPose.stationPositions.map(point => ({ ...point }));
  } else {
    const restPositions = registration.stations.map(station => station.position);
    const blended = fromPose.stationPositions.map(
      (point, index) => lerpPoint(point, toPose.stationPositions[index], mix),
    );
    stationPositions = preserveStationChainLengths(restPositions, blended);
  }
  return {
    schema: 'kaminos.lirm-smooth-fitted-proxy-rig-pose.v0',
    sourceCandidateId: registration.sourceCandidateId,
    preset: 'cycle',
    amplitude,
    phase: normalizedPhase,
    segment,
    fromPreset,
    toPreset,
    linearMix,
    mix,
    stationPositions,
  };
}

function sha256Digest(value, label) {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/i.test(value)) {
    throw new Error(`${label} must be an exact sha256 digest`);
  }
  return value.slice('sha256:'.length).toLowerCase();
}

export function createSmoothFittedProxyRigProbeBinding({
  binding,
  contactAtlas,
  contactAtlasSha256,
} = {}) {
  if (binding?.schema !== 'kaminos.lirm-smooth-fitted-proxy-rig-binding.v0') {
    throw new Error('smooth fitted probe binding requires a smooth fitted cast binding');
  }
  if (contactAtlas?.schema !== 'kaminos.creature-contact-atlas.v0'
      || !Array.isArray(contactAtlas.patches)
      || contactAtlas.patches.length === 0) {
    throw new Error('smooth fitted probe binding requires a nonempty creature contact atlas');
  }
  const atlasDigest = sha256Digest(contactAtlasSha256, 'contact atlas hash');
  const donorDigest = sha256Digest(binding.registration.donorSha256, 'binding donor hash');
  if (contactAtlas.castHash?.toLowerCase() !== donorDigest) {
    throw new Error(`contact atlas cast hash mismatch: ${contactAtlas.castHash} != ${donorDigest}`);
  }
  if (contactAtlas.vertexCount !== binding.vertexCount) {
    throw new Error(`contact atlas vertex count mismatch: ${contactAtlas.vertexCount} != ${binding.vertexCount}`);
  }
  const ids = new Set();
  const rigidCoreThreshold = 0.25;
  const rigidCoreOwners = new Map();
  const probes = contactAtlas.patches.map((patch, patchIndex) => {
    if (typeof patch.id !== 'string' || patch.id.length === 0 || ids.has(patch.id)) {
      throw new Error(`contact atlas patch ${patchIndex} requires a unique nonempty id`);
    }
    ids.add(patch.id);
    if (!Array.isArray(patch.vertexIndices) || !Array.isArray(patch.weights)
        || patch.vertexIndices.length === 0
        || patch.vertexIndices.length !== patch.weights.length) {
      throw new Error(`contact atlas patch ${patch.id} requires matching vertex indices and weights`);
    }
    const vertexIndices = Uint32Array.from(patch.vertexIndices);
    const rawWeights = Float64Array.from(patch.weights);
    let weightSum = 0;
    let arcCoordinate = 0;
    const localCoordinates = [0, 0, 0];
    for (let index = 0; index < vertexIndices.length; index += 1) {
      const vertex = vertexIndices[index];
      const weight = rawWeights[index];
      if (!Number.isInteger(patch.vertexIndices[index]) || vertex >= binding.vertexCount) {
        throw new Error(`contact atlas patch ${patch.id} has invalid vertex index ${patch.vertexIndices[index]}`);
      }
      if (!Number.isFinite(weight) || weight < 0) {
        throw new Error(`contact atlas patch ${patch.id} has invalid weight ${weight}`);
      }
      weightSum += weight;
      arcCoordinate += binding.arcCoordinates[vertex] * weight;
      for (let axis = 0; axis < 3; axis += 1) {
        localCoordinates[axis] += binding.localCoordinates[vertex * 3 + axis] * weight;
      }
    }
    if (!(weightSum > 0)) throw new Error(`contact atlas patch ${patch.id} has zero total weight`);
    const weights = Float64Array.from(rawWeights, weight => weight / weightSum);
    if (!Array.isArray(patch.influenceVertexIndices)
        || !Array.isArray(patch.influenceWeights)) {
      throw new Error(
        `contact atlas patch ${patch.id} requires exact influence vertex indices and weights`,
      );
    }
    const influenceVertexIndices = Uint32Array.from(patch.influenceVertexIndices);
    const rawInfluenceWeights = Float64Array.from(patch.influenceWeights);
    if (influenceVertexIndices.length !== rawInfluenceWeights.length
        || influenceVertexIndices.length === 0) {
      throw new Error(`contact atlas patch ${patch.id} requires matching influence indices and weights`);
    }
    const radialDirection = normalize(v3(localCoordinates[0], localCoordinates[1], 0));
    const influenceSamples = [];
    for (let index = 0; index < influenceVertexIndices.length; index += 1) {
      const vertex = influenceVertexIndices[index];
      const weight = rawInfluenceWeights[index];
      if (!Number.isInteger(patch.influenceVertexIndices[index])
          || vertex >= binding.vertexCount) {
        throw new Error(`contact atlas patch ${patch.id} has invalid influence vertex ${vertex}`);
      }
      if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
        throw new Error(`contact atlas patch ${patch.id} has invalid influence weight ${weight}`);
      }
      if (weight >= rigidCoreThreshold) {
        const existingOwner = rigidCoreOwners.get(vertex);
        if (existingOwner) {
          throw new Error(
            `rigid carrier core vertex ${vertex} belongs to both ${existingOwner} and ${patch.id}`,
          );
        }
        rigidCoreOwners.set(vertex, patch.id);
      }
      const local = v3(
        binding.localCoordinates[vertex * 3],
        binding.localCoordinates[vertex * 3 + 1],
        0,
      );
      influenceSamples.push({
        vertex,
        weight,
        radialProjection: dot(local, radialDirection),
      });
    }
    const eligibleAttachmentSamples = influenceSamples
      .filter(sample => sample.weight >= 0.1)
      .sort((left, right) => left.radialProjection - right.radialProjection);
    if (eligibleAttachmentSamples.length === 0) {
      throw new Error(`contact atlas patch ${patch.id} has no body-side attachment samples`);
    }
    const attachmentCount = Math.max(
      1,
      Math.ceil(eligibleAttachmentSamples.length * 0.2),
    );
    const attachmentSamples = eligibleAttachmentSamples.slice(0, attachmentCount);
    let attachmentWeightSum = 0;
    const attachmentWeights = Float64Array.from(attachmentSamples, sample => {
      const weight = Math.max(1e-6, sample.weight);
      attachmentWeightSum += weight;
      return weight;
    });
    for (let index = 0; index < attachmentWeights.length; index += 1) {
      attachmentWeights[index] /= attachmentWeightSum;
    }
    return {
      id: patch.id,
      axialRegion: patch.axialRegion ?? null,
      side: patch.side ?? null,
      phaseOffset: Number.isFinite(patch.phaseOffset) ? patch.phaseOffset : 0,
      vertexIndices,
      weights,
      arcCoordinate: arcCoordinate / weightSum,
      localCoordinates: localCoordinates.map(value => value / weightSum),
      carrier: {
        schema: 'kaminos.lirm-appendage-local-carrier-binding.v0',
        authority: 'exact-contact-atlas-influence-region',
        influenceVertexIndices,
        influenceWeights: rawInfluenceWeights,
        rigidCoreThreshold,
        attachmentVertexIndices: Uint32Array.from(
          attachmentSamples,
          sample => sample.vertex,
        ),
        attachmentWeights,
      },
    };
  });
  return {
    schema: 'kaminos.lirm-smooth-fitted-probe-binding.v0',
    sourceCandidateId: binding.registration.sourceCandidateId,
    sourceCastSha256: binding.registration.donorSha256,
    contactAtlasSha256: `sha256:${atlasDigest}`,
    contactAtlasRegistrationHash: contactAtlas.registrationHash ?? null,
    contactAtlasAuthority: contactAtlas.authority ?? null,
    contactAtlasCastId: contactAtlas.castId ?? null,
    vertexCount: binding.vertexCount,
    probes,
  };
}

function packedPoint(values, vertex) {
  return v3(values[vertex * 3], values[vertex * 3 + 1], values[vertex * 3 + 2]);
}

function validateRootFrame(rootFrame) {
  if (rootFrame?.schema !== 'kaminos.creature-root-frame.v0') {
    throw new Error('smooth fitted phase evaluation requires a creature root frame');
  }
  for (const [name, vector] of Object.entries({
    origin: rootFrame.origin,
    lateral: rootFrame.lateral,
    normal: rootFrame.normal,
    tangent: rootFrame.tangent,
  })) {
    if (![vector?.x, vector?.y, vector?.z].every(Number.isFinite)) {
      throw new Error(`creature root frame ${name} must be finite`);
    }
  }
  for (const name of ['lateral', 'normal', 'tangent']) {
    const magnitude = length3(rootFrame[name]);
    if (Math.abs(magnitude - 1) > 1e-6) throw new Error(`creature root frame ${name} must be unit length`);
  }
  if (Math.abs(dot(rootFrame.lateral, rootFrame.normal)) > 1e-6
      || Math.abs(dot(rootFrame.lateral, rootFrame.tangent)) > 1e-6
      || Math.abs(dot(rootFrame.normal, rootFrame.tangent)) > 1e-6
      || dot(cross(rootFrame.lateral, rootFrame.normal), rootFrame.tangent) < 1 - 1e-6) {
    throw new Error('creature root frame axes must be right-handed and orthonormal');
  }
  return rootFrame;
}

function transformRootPoint(rootFrame, point) {
  return add(
    add(
      add(rootFrame.origin, mul(rootFrame.lateral, point.x)),
      mul(rootFrame.normal, point.y),
    ),
    mul(rootFrame.tangent, point.z),
  );
}

function transformRootVector(rootFrame, vector) {
  return normalize(add(
    add(mul(rootFrame.lateral, vector.x), mul(rootFrame.normal, vector.y)),
    mul(rootFrame.tangent, vector.z),
  ));
}

function inverseTransformRootVector(rootFrame, vector) {
  return v3(
    dot(vector, rootFrame.lateral),
    dot(vector, rootFrame.normal),
    dot(vector, rootFrame.tangent),
  );
}

function pointArray(point) {
  return [point.x, point.y, point.z];
}

function evaluateSmoothFittedProxyRigPose({
  binding,
  probeBinding,
  pose,
  rootFrame,
  bodyPositionsOverride = null,
} = {}) {
  if (binding?.schema !== 'kaminos.lirm-smooth-fitted-proxy-rig-binding.v0') {
    throw new Error('smooth fitted phase evaluation requires a smooth fitted cast binding');
  }
  if (probeBinding?.schema !== 'kaminos.lirm-smooth-fitted-probe-binding.v0'
      || probeBinding.vertexCount !== binding.vertexCount
      || probeBinding.sourceCastSha256 !== binding.registration.donorSha256) {
    throw new Error('smooth fitted phase evaluation probe binding does not match the cast');
  }
  const exactRootFrame = validateRootFrame(rootFrame);
  if (pose?.schema !== 'kaminos.lirm-smooth-fitted-proxy-rig-pose.v0'
      || pose.stationPositions?.length !== binding.registration.stationCount) {
    throw new Error('smooth fitted phase evaluation pose does not match the cast');
  }
  const bodyPositions = bodyPositionsOverride ?? deformSmoothFittedProxyRigBinding({ binding, pose });
  if (!(bodyPositions instanceof Float64Array)
      || bodyPositions.length !== binding.vertexCount * 3) {
    throw new Error('smooth fitted phase evaluation body override must match the fitted cast');
  }
  const worldPositions = new Float64Array(bodyPositions.length);
  for (let vertex = 0; vertex < binding.vertexCount; vertex += 1) {
    const world = transformRootPoint(exactRootFrame, packedPoint(bodyPositions, vertex));
    worldPositions[vertex * 3] = world.x;
    worldPositions[vertex * 3 + 1] = world.y;
    worldPositions[vertex * 3 + 2] = world.z;
  }
  const poseCurve = createSmoothFittedProxyRigCurve({
    stationPositions: pose.stationPositions,
    sampleCount: binding.sampleCount,
  });
  const probes = probeBinding.probes.map(probe => {
    let bodyPosition = v3();
    for (let index = 0; index < probe.vertexIndices.length; index += 1) {
      bodyPosition = add(
        bodyPosition,
        mul(packedPoint(bodyPositions, probe.vertexIndices[index]), probe.weights[index]),
      );
    }
    const curveFrame = evaluateSmoothCurveFrame(poseCurve, probe.arcCoordinate);
    let bodyNormal = add(
      mul(curveFrame.lateral, probe.localCoordinates[0]),
      mul(curveFrame.normal, probe.localCoordinates[1]),
    );
    if (length3(bodyNormal) < 1e-8) bodyNormal = mul(curveFrame.normal, -1);
    bodyNormal = normalize(bodyNormal);
    return {
      id: probe.id,
      axialRegion: probe.axialRegion,
      side: probe.side,
      phaseOffset: probe.phaseOffset,
      vertexCount: probe.vertexIndices.length,
      bodyArcCoordinate: probe.arcCoordinate,
      bodyPosition: pointArray(bodyPosition),
      worldPosition: pointArray(transformRootPoint(exactRootFrame, bodyPosition)),
      bodyNormal: pointArray(bodyNormal),
      worldNormal: pointArray(transformRootVector(exactRootFrame, bodyNormal)),
      normalAuthority: 'deformation-derived-body-outward-v0',
    };
  });
  return {
    schema: 'kaminos.lirm-smooth-fitted-phase-packet.v0',
    requestedRoute: SMOOTH_FITTED_PHASE_ROUTE,
    effectiveRoute: SMOOTH_FITTED_PHASE_ROUTE,
    source: {
      candidateId: binding.registration.sourceCandidateId,
      castSha256: binding.registration.donorSha256,
      sourcePacketSha256: binding.registration.sourcePacketSha256,
      armatureProgramId: binding.registration.armatureProgramId,
      contactAtlasSha256: probeBinding.contactAtlasSha256,
      contactAtlasRegistrationHash: probeBinding.contactAtlasRegistrationHash,
      contactAtlasAuthority: probeBinding.contactAtlasAuthority,
    },
    pose: {
      phase: pose.phase,
      amplitude: pose.amplitude,
      segment: pose.segment,
      fromPreset: pose.fromPreset,
      toPreset: pose.toPreset,
      linearMix: pose.linearMix,
      mix: pose.mix,
      stationPositions: pose.stationPositions.map(pointArray),
      frameTransport: 'rotation-minimizing-parallel-transport-v0',
      bodyParameterization: binding.parameterization,
    },
    rootFrame: structuredClone(exactRootFrame),
    bodyPositions,
    worldPositions,
    probes,
  };
}

export function evaluateSmoothFittedProxyRigPhase({
  binding,
  probeBinding,
  phase = 0,
  amplitude = 0.18,
  rootFrame,
} = {}) {
  const pose = createSmoothFittedProxyRigCyclePose({
    registration: binding?.registration,
    phase,
    amplitude,
  });
  return evaluateSmoothFittedProxyRigPose({
    binding,
    probeBinding,
    pose,
    rootFrame,
  });
}

export const SMOOTH_FITTED_CONTACT_ROUTE = 'kaminos/fitted-proxy-rig/appendage-local-carrier-contact-v1';

function validateSmoothFittedContactConstraints(constraints, probeBinding) {
  if (constraints?.schema !== 'kaminos.motion-contact-constraints.v0'
      || constraints.authority !== 'world-space-contact-resolution') {
    throw new Error('smooth contact realization requires world-space contact constraints');
  }
  if (!Array.isArray(constraints.patches)
      || constraints.patches.length !== probeBinding.probes.length) {
    throw new Error('smooth contact realization requires exactly the bound probes');
  }
  const patchesById = new Map();
  for (const patch of constraints.patches) {
    if (typeof patch?.id !== 'string' || patchesById.has(patch.id)
        || !['stance', 'release', 'swing'].includes(patch.contactState)
        || patch.inBounds !== true) {
      throw new Error('smooth contact realization requires unique in-bounds patch states');
    }
    const terrainPoint = finiteVectorArray(patch.terrainPoint, `${patch.id} terrain point`);
    const terrainNormal = finiteVectorArray(patch.terrainNormal, `${patch.id} terrain normal`);
    const normalLength = Math.hypot(...terrainNormal);
    if (!(normalLength > 1e-8)) throw new Error(`${patch.id} terrain normal collapsed`);
    patchesById.set(patch.id, {
      ...patch,
      terrainPoint: v3(...terrainPoint),
      terrainNormal: mul(v3(...terrainNormal), 1 / normalLength),
    });
  }
  if (probeBinding.probes.some(probe => !patchesById.has(probe.id))) {
    throw new Error('smooth contact realization requires exactly the bound probes');
  }
  return patchesById;
}

function smoothContactStateGain(state) {
  if (state === 'stance') return 1;
  if (state === 'release') return 0.34;
  return 0.14;
}

function solveSmoothContactCorrection({
  signedDistance,
  contactState,
  clearance,
  correctionGain,
  maximumCorrection,
  iterationCount,
}) {
  let accumulated = 0;
  const residuals = [];
  for (let iteration = 0; iteration < iterationCount; iteration += 1) {
    let residual = clearance - (signedDistance + accumulated);
    if (contactState === 'swing') residual = Math.max(0, residual);
    residuals.push(residual);
    accumulated += clamp(
      residual * correctionGain * smoothContactStateGain(contactState),
      -maximumCorrection,
      maximumCorrection,
    );
  }
  return { accumulated, residuals };
}

function boundedVector(vector, maximumLength) {
  const magnitude = length3(vector);
  return magnitude > maximumLength
    ? mul(vector, maximumLength / magnitude)
    : vector;
}

function weightedPackedCentroid(positions, indices, weights) {
  let centroid = v3();
  for (let index = 0; index < indices.length; index += 1) {
    centroid = add(
      centroid,
      mul(packedPoint(positions, indices[index]), weights[index]),
    );
  }
  return centroid;
}

function minimalRotationBetween(fromDirection, toDirection, maximumAngle = Math.PI) {
  const from = normalize(fromDirection);
  const to = normalize(toDirection);
  const axis = cross(from, to);
  const sine = length3(axis);
  const cosine = clamp(dot(from, to), -1, 1);
  if (sine > 1e-8) {
    return {
      axis: mul(axis, 1 / sine),
      angle: Math.min(Math.atan2(sine, cosine), maximumAngle),
    };
  }
  if (cosine >= 0) return { axis: v3(1, 0, 0), angle: 0 };
  const reference = Math.abs(from.x) < 0.8 ? v3(1, 0, 0) : v3(0, 1, 0);
  return {
    axis: normalize(cross(from, reference)),
    angle: maximumAngle,
  };
}

function applyMinimalRotation(vector, rotation) {
  return rotation.angle > 1e-12
    ? rotateAroundAxis(vector, rotation.axis, rotation.angle)
    : { ...vector };
}

function createLowFrequencyBodyTransform({
  probes,
  patchesById,
  rootFrame,
  clearance,
  correctionGain,
  maximumCorrection,
  iterationCount,
  maximumTranslation,
  maximumRotation,
}) {
  const stance = probes.filter(
    probe => patchesById.get(probe.id).contactState === 'stance',
  );
  if (stance.length === 0) {
    return {
      pivot: v3(),
      rotation: { axis: v3(1, 0, 0), angle: 0 },
      translation: v3(),
      transform: point => ({ ...point }),
    };
  }
  const correspondences = stance.map(probe => {
    const constraint = patchesById.get(probe.id);
    const currentWorld = v3(...probe.worldPosition);
    const signedDistance = dot(
      sub(currentWorld, constraint.terrainPoint),
      constraint.terrainNormal,
    );
    const solved = solveSmoothContactCorrection({
      signedDistance,
      contactState: constraint.contactState,
      clearance,
      correctionGain,
      maximumCorrection,
      iterationCount,
    });
    const current = v3(...probe.bodyPosition);
    return {
      current,
      target: add(
        current,
        inverseTransformRootVector(
          rootFrame,
          mul(constraint.terrainNormal, solved.accumulated),
        ),
      ),
    };
  });
  const scale = 1 / correspondences.length;
  const currentCentroid = correspondences.reduce(
    (sum, entry) => add(sum, mul(entry.current, scale)),
    v3(),
  );
  const targetCentroid = correspondences.reduce(
    (sum, entry) => add(sum, mul(entry.target, scale)),
    v3(),
  );
  const rotation = correspondences.length >= 2
    ? minimalRotationBetween(
      sub(correspondences.at(-1).current, correspondences[0].current),
      sub(correspondences.at(-1).target, correspondences[0].target),
      maximumRotation,
    )
    : { axis: v3(1, 0, 0), angle: 0 };
  const translation = boundedVector(
    sub(targetCentroid, currentCentroid),
    maximumTranslation,
  );
  return {
    pivot: currentCentroid,
    rotation,
    translation,
    transform(point) {
      return add(
        add(
          currentCentroid,
          applyMinimalRotation(sub(point, currentCentroid), rotation),
        ),
        translation,
      );
    },
  };
}

function createAppendageCarrierTransform({
  probe,
  bodyPositions,
  bodyCorrection,
  maximumTranslation,
}) {
  const contact = weightedPackedCentroid(
    bodyPositions,
    probe.vertexIndices,
    probe.weights,
  );
  const pivot = weightedPackedCentroid(
    bodyPositions,
    probe.carrier.attachmentVertexIndices,
    probe.carrier.attachmentWeights,
  );
  const sourceLever = sub(contact, pivot);
  const desiredContact = add(contact, bodyCorrection);
  const desiredLever = sub(desiredContact, pivot);
  const rotation = minimalRotationBetween(sourceLever, desiredLever);
  const rotatedLever = applyMinimalRotation(sourceLever, rotation);
  const translation = boundedVector(
    sub(desiredLever, rotatedLever),
    maximumTranslation,
  );
  return {
    id: probe.id,
    pivot,
    sourceLever,
    desiredLever,
    rotation,
    translation,
    transform(point) {
      return add(
        add(
          pivot,
          applyMinimalRotation(sub(point, pivot), rotation),
        ),
        translation,
      );
    },
  };
}

function carrierSkinWeight(rawWeight, rigidCoreThreshold) {
  if (rawWeight >= rigidCoreThreshold) return 1;
  return smoothstep(rawWeight / rigidCoreThreshold);
}

function applyAppendageLocalCarriers({
  bodyPositions,
  probes,
  transforms,
}) {
  const candidates = Array.from(
    { length: bodyPositions.length / 3 },
    () => [],
  );
  for (const probe of probes) {
    const transform = transforms.get(probe.id);
    if (!transform) continue;
    const carrier = probe.carrier;
    for (let index = 0; index < carrier.influenceVertexIndices.length; index += 1) {
      const vertex = carrier.influenceVertexIndices[index];
      const skinWeight = carrierSkinWeight(
        carrier.influenceWeights[index],
        carrier.rigidCoreThreshold,
      );
      if (skinWeight <= 0) continue;
      candidates[vertex].push({
        skinWeight,
        point: transform.transform(packedPoint(bodyPositions, vertex)),
      });
    }
  }
  const realized = new Float64Array(bodyPositions);
  for (let vertex = 0; vertex < candidates.length; vertex += 1) {
    const exact = candidates[vertex];
    if (exact.length === 0) continue;
    const base = packedPoint(bodyPositions, vertex);
    const rigid = exact.find(candidate => candidate.skinWeight >= 1 - 1e-12);
    let point;
    if (rigid) {
      point = rigid.point;
    } else {
      const totalWeight = exact.reduce((sum, candidate) => sum + candidate.skinWeight, 0);
      const blendScale = totalWeight > 1 ? 1 / totalWeight : 1;
      point = mul(base, Math.max(0, 1 - totalWeight));
      for (const candidate of exact) {
        point = add(point, mul(candidate.point, candidate.skinWeight * blendScale));
      }
    }
    realized[vertex * 3] = point.x;
    realized[vertex * 3 + 1] = point.y;
    realized[vertex * 3 + 2] = point.z;
  }
  return realized;
}

export function evaluateSmoothFittedProxyRigContactPhase({
  binding,
  probeBinding,
  phase = 0,
  amplitude = 0.18,
  rootFrame,
  constraints,
  clearance = 0.008,
  correctionGain = 0.82,
  maximumCorrection = 0.18,
  iterationCount = 3,
  maximumBodyResidual = 0.12,
  maximumBodyRotation = 0.5,
  maximumCarrierTranslation = 0.035,
} = {}) {
  if (!Number.isFinite(clearance) || clearance < 0 || clearance > 0.08) {
    throw new Error('smooth contact clearance must be finite in [0, 0.08]');
  }
  if (!Number.isFinite(correctionGain) || correctionGain <= 0 || correctionGain > 1) {
    throw new Error('smooth contact correctionGain must be finite in (0, 1]');
  }
  if (!Number.isFinite(maximumCorrection) || maximumCorrection <= 0 || maximumCorrection > 0.4) {
    throw new Error('smooth contact maximumCorrection must be finite in (0, 0.4]');
  }
  if (!Number.isInteger(iterationCount) || iterationCount < 1 || iterationCount > 8) {
    throw new Error('smooth contact iterationCount must be an integer in [1, 8]');
  }
  if (!Number.isFinite(maximumBodyResidual)
      || maximumBodyResidual < 0
      || maximumBodyResidual > 0.15) {
    throw new Error('smooth contact maximumBodyResidual must be finite in [0, 0.15]');
  }
  if (!Number.isFinite(maximumBodyRotation)
      || maximumBodyRotation < 0
      || maximumBodyRotation > 0.65) {
    throw new Error('smooth contact maximumBodyRotation must be finite in [0, 0.65]');
  }
  if (!Number.isFinite(maximumCarrierTranslation)
      || maximumCarrierTranslation < 0
      || maximumCarrierTranslation > 0.06) {
    throw new Error('smooth contact maximumCarrierTranslation must be finite in [0, 0.06]');
  }
  const exactRootFrame = validateRootFrame(rootFrame);
  const patchesById = validateSmoothFittedContactConstraints(constraints, probeBinding);
  const basePose = createSmoothFittedProxyRigCyclePose({
    registration: binding.registration,
    phase,
    amplitude,
  });
  const baseline = evaluateSmoothFittedProxyRigPose({
    binding,
    probeBinding,
    pose: basePose,
    rootFrame: exactRootFrame,
  });
  const bodyTransform = createLowFrequencyBodyTransform({
    probes: baseline.probes,
    patchesById,
    rootFrame: exactRootFrame,
    clearance,
    correctionGain,
    maximumCorrection,
    iterationCount,
    maximumTranslation: maximumBodyResidual,
    maximumRotation: maximumBodyRotation,
  });
  const pose = {
    ...basePose,
    stationPositions: basePose.stationPositions.map(bodyTransform.transform),
  };
  const carrierBase = evaluateSmoothFittedProxyRigPose({
    binding,
    probeBinding,
    pose,
    rootFrame: exactRootFrame,
  });
  const transforms = new Map();
  const iterationResiduals = Array.from({ length: iterationCount }, () => 0);
  for (const packetProbe of carrierBase.probes) {
    const probe = probeBinding.probes.find(candidate => candidate.id === packetProbe.id);
    const constraint = patchesById.get(packetProbe.id);
    const signedDistance = dot(
      sub(v3(...packetProbe.worldPosition), constraint.terrainPoint),
      constraint.terrainNormal,
    );
    const solved = solveSmoothContactCorrection({
      signedDistance,
      contactState: constraint.contactState,
      clearance,
      correctionGain,
      maximumCorrection,
      iterationCount,
    });
    for (let iteration = 0; iteration < iterationCount; iteration += 1) {
      iterationResiduals[iteration] = Math.max(
        iterationResiduals[iteration],
        Math.abs(solved.residuals[iteration]),
      );
    }
    transforms.set(packetProbe.id, createAppendageCarrierTransform({
      probe,
      bodyPositions: carrierBase.bodyPositions,
      bodyCorrection: inverseTransformRootVector(
        exactRootFrame,
        mul(constraint.terrainNormal, solved.accumulated),
      ),
      maximumTranslation: maximumCarrierTranslation,
    }));
  }
  const realizedBodyPositions = applyAppendageLocalCarriers({
    bodyPositions: carrierBase.bodyPositions,
    probes: probeBinding.probes,
    transforms,
  });
  const packet = evaluateSmoothFittedProxyRigPose({
    binding,
    probeBinding,
    pose,
    rootFrame: exactRootFrame,
    bodyPositionsOverride: realizedBodyPositions,
  });
  return {
    ...packet,
    schema: 'kaminos.lirm-smooth-fitted-contact-phase-packet.v0',
    requestedRoute: SMOOTH_FITTED_CONTACT_ROUTE,
    effectiveRoute: SMOOTH_FITTED_CONTACT_ROUTE,
    contactRealization: {
      authority: 'appendage-local-rigid-carriers-plus-bounded-rigid-body-fit',
      constraintsId: constraints.id ?? null,
      clearance,
      correctionGain,
      maximumCorrection,
      iterationCount,
      iterationResiduals,
      maximumBodyResidual,
      maximumBodyRotation,
      maximumCarrierTranslation,
      maximumStationOffset: Math.max(
        ...basePose.stationPositions.map((position, index) => length3(
          sub(pose.stationPositions[index], position),
        )),
      ),
      bodyResidual: {
        authority: 'stance-pair-bounded-rigid-fit',
        pivot: pointArray(bodyTransform.pivot),
        rotationAxis: pointArray(bodyTransform.rotation.axis),
        rotationAngle: bodyTransform.rotation.angle,
        translation: pointArray(bodyTransform.translation),
      },
      directVertexTranslationCount: 0,
      carrierTransformCount: transforms.size,
      patches: packet.probes.map(probe => {
        const constraint = patchesById.get(probe.id);
        const transform = transforms.get(probe.id);
        const signedDistance = dot(
          sub(v3(...probe.worldPosition), constraint.terrainPoint),
          constraint.terrainNormal,
        );
        return {
          id: probe.id,
          contactState: constraint.contactState,
          signedDistance,
          residual: clearance - signedDistance,
          carrierAuthority: probeBinding.probes.find(
            candidate => candidate.id === probe.id,
          ).carrier.authority,
          rigidCoreThreshold: probeBinding.probes.find(
            candidate => candidate.id === probe.id,
          ).carrier.rigidCoreThreshold,
          carrierTranslation: pointArray(transform.translation),
        };
      }),
    },
  };
}

function finiteVectorArray(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || value.some(component => !Number.isFinite(component))) {
    throw new Error(`${label} must be a finite three-component vector`);
  }
  return value.map(Number);
}

function exactSupportSurfaceIdentity(actual, expected) {
  return actual?.id === expected?.id
    && actual?.sourceRef === expected?.sourceRef
    && actual?.revision === expected?.revision;
}

function exactBodyIdentity(actual, expected) {
  return actual?.id === expected?.id
    && actual?.registrationId === expected?.registrationId
    && Object.is(actual?.scale, expected?.scale);
}

function exactContactAtlasIdentity(actual, probeBinding) {
  return actual?.schema === 'kaminos.creature-contact-atlas.v0'
    && actual?.castId === probeBinding.contactAtlasCastId
    && actual?.sha256 === probeBinding.contactAtlasSha256
    && actual?.castHash?.toLowerCase() === sha256Digest(
      probeBinding.sourceCastSha256,
      'probe binding source cast hash',
    )
    && actual?.registrationHash === probeBinding.contactAtlasRegistrationHash;
}

export function evaluateMotionContactProbeRequest({
  binding,
  probeBinding,
  request,
  prepass,
  normalization,
  contactPlaneY,
  amplitude = 0.18,
  poseId,
} = {}) {
  if (request?.schema !== 'kaminos.motion-contact-probe-request.v0') {
    throw new Error('motion contact probe request schema mismatch');
  }
  if (prepass?.schema !== 'kaminos.motion-support-prepass.v0') {
    throw new Error('motion contact probe producer requires a support prepass');
  }
  if (request.prepassId !== prepass.id) {
    throw new Error('motion contact prepass identity mismatch');
  }
  if (!exactSupportSurfaceIdentity(request.supportSurface, prepass.supportSurface)) {
    throw new Error('motion contact support surface identity mismatch');
  }
  if (!Number.isFinite(request.body?.scale) || request.body.scale <= 0
      || !Number.isFinite(prepass.body?.scale) || prepass.body.scale <= 0) {
    throw new Error('motion contact body scale must be finite and positive');
  }
  if (!exactBodyIdentity(request.body, prepass.body)) {
    throw new Error('motion contact body identity mismatch');
  }
  if (!exactContactAtlasIdentity(request.contactAtlas, probeBinding)) {
    throw new Error('motion contact contact atlas identity mismatch');
  }
  if (typeof poseId !== 'string' || poseId.length === 0 || request.poseId !== poseId) {
    throw new Error('motion contact pose identity mismatch');
  }
  if (!Number.isFinite(request.phase)) {
    throw new Error('motion contact phase must be finite');
  }
  if (!Array.isArray(request.patches) || request.patches.length !== probeBinding?.probes?.length) {
    throw new Error('motion contact producer requires exactly the bound requested patches');
  }
  const boundProbeIds = new Set(probeBinding.probes.map(probe => probe.id));
  const requestedProbeIds = new Set();
  for (const patch of request.patches) {
    if (typeof patch?.id !== 'string' || patch.id.length === 0 || requestedProbeIds.has(patch.id)) {
      throw new Error('motion contact requested patch identity must be unique');
    }
    if (!boundProbeIds.has(patch.id) || !Number.isFinite(patch.phaseOffset)) {
      throw new Error('motion contact producer requires exactly the bound requested patches');
    }
    requestedProbeIds.add(patch.id);
  }
  if (requestedProbeIds.size !== boundProbeIds.size) {
    throw new Error('motion contact producer requires exactly the bound requested patches');
  }

  const center = finiteVectorArray(normalization?.center, 'motion contact normalization center');
  if (!Number.isFinite(normalization?.scale) || normalization.scale <= 0) {
    throw new Error('motion contact normalization scale must be positive and finite');
  }
  if (!Number.isFinite(contactPlaneY)) {
    throw new Error('motion contact contact plane must be finite');
  }
  if (!Number.isFinite(amplitude) || amplitude < 0) {
    throw new Error('motion contact amplitude must be finite and nonnegative');
  }
  const rootSurface = finiteVectorArray(prepass.rootSurface, 'motion contact root surface');
  const forward = finiteVectorArray(prepass.frame?.forward, 'motion contact forward');
  const right = finiteVectorArray(prepass.frame?.right, 'motion contact right');
  const up = finiteVectorArray(prepass.frame?.up, 'motion contact up');
  if (!Number.isFinite(prepass.support?.rootLift)) {
    throw new Error('motion contact support root lift must be finite');
  }
  const placementFrame = validateRootFrame({
    schema: 'kaminos.creature-root-frame.v0',
    origin: v3(),
    lateral: v3(...right),
    normal: v3(...up),
    tangent: mul(v3(...forward), -1),
  });
  const rootHeight = prepass.support.rootLift - contactPlaneY * request.body.scale;
  const rootOrigin = add(v3(...rootSurface), mul(placementFrame.normal, rootHeight));
  const identityRoot = {
    schema: 'kaminos.creature-root-frame.v0',
    origin: v3(),
    lateral: v3(1, 0, 0),
    normal: v3(0, 1, 0),
    tangent: v3(0, 0, 1),
  };
  const packet = evaluateSmoothFittedProxyRigPhase({
    binding,
    probeBinding,
    phase: request.phase / (Math.PI * 2),
    amplitude,
    rootFrame: identityRoot,
  });
  const probesById = new Map(packet.probes.map(probe => [probe.id, probe]));
  const patches = request.patches.map(requestedPatch => {
    const probe = probesById.get(requestedPatch.id);
    if (!probe) throw new Error(`motion contact producer is missing bound patch ${requestedPatch.id}`);
    const sourcePosition = probe.bodyPosition.map(
      (value, axis) => value / normalization.scale + center[axis],
    );
    const scaledPosition = sourcePosition.map(value => value * request.body.scale);
    const worldPosition = add(
      add(
        add(rootOrigin, mul(placementFrame.lateral, scaledPosition[0])),
        mul(placementFrame.normal, scaledPosition[1]),
      ),
      mul(placementFrame.tangent, scaledPosition[2]),
    );
    return {
      id: requestedPatch.id,
      worldPosition: pointArray(worldPosition),
    };
  });
  return {
    schema: 'kaminos.motion-contact-probe-set.v0',
    requestId: request.id,
    prepassId: request.prepassId,
    supportSurface: structuredClone(request.supportSurface),
    body: structuredClone(request.body),
    contactAtlas: structuredClone(request.contactAtlas),
    poseId: request.poseId,
    phase: request.phase,
    patches,
  };
}

export const FITTED_PROXY_RIG_PROOF_ROUTE = 'kaminos/fitted-proxy-rig/software-triangle-deformation-witness-v0';

function packedPositionsToTriangles(positions) {
  if (positions.length % 9 !== 0) throw new Error('deformed triangle soup lost topology');
  const triangles = [];
  for (let index = 0; index < positions.length; index += 9) {
    triangles.push([
      v3(positions[index], positions[index + 1], positions[index + 2]),
      v3(positions[index + 3], positions[index + 4], positions[index + 5]),
      v3(positions[index + 6], positions[index + 7], positions[index + 8]),
    ]);
  }
  return triangles;
}

const MECHANISM_WITNESS_COLUMNS = [
  'rest-cast',
  'rest-proxy-xray',
  'posed-proxy-xray',
  'posed-displacement-heat',
];

const MECHANISM_SEGMENT_COLORS = [
  [70, 121, 214], [54, 153, 211], [46, 176, 184], [59, 190, 143],
  [102, 197, 102], [160, 198, 73], [213, 188, 57], [238, 155, 55],
  [235, 111, 65], [215, 75, 91], [181, 65, 133], [137, 72, 169],
];

function blendWitnessPixel(pixels, width, height, x, y, color, alpha = 1) {
  const px = Math.round(x); const py = Math.round(y);
  if (px < 0 || px >= width || py < 0 || py >= height) return;
  const index = (py * width + px) * 3;
  for (let channel = 0; channel < 3; channel += 1) {
    pixels[index + channel] = Math.round(pixels[index + channel] * (1 - alpha) + color[channel] * alpha);
  }
}

function drawWitnessDisc(pixels, width, height, x, y, radius, color, alpha = 1) {
  const extent = Math.ceil(radius);
  for (let dy = -extent; dy <= extent; dy += 1) {
    for (let dx = -extent; dx <= extent; dx += 1) {
      if (dx * dx + dy * dy <= radius * radius) blendWitnessPixel(pixels, width, height, x + dx, y + dy, color, alpha);
    }
  }
}

function drawWitnessLine(pixels, width, height, a, b, color, thickness = 1, alpha = 1) {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 1.5));
  for (let step = 0; step <= steps; step += 1) {
    const mix = step / steps;
    drawWitnessDisc(
      pixels, width, height,
      a.x + (b.x - a.x) * mix,
      a.y + (b.y - a.y) * mix,
      thickness,
      color,
      alpha,
    );
  }
}

function stationPoseFrame(stationPositions, index) {
  const previous = stationPositions[Math.max(0, index - 1)];
  const next = stationPositions[Math.min(stationPositions.length - 1, index + 1)];
  return proxySegmentFrame(previous, next);
}

function drawProxyRigXray({ render, registration, pose }) {
  const stationPositions = pose.stationPositions;
  const projectedStations = stationPositions.map(point => projectPoint(point, render.frame, render.camera, render.width, render.height));
  for (let index = 0; index < projectedStations.length - 1; index += 1) {
    drawWitnessLine(render.pixels, render.width, render.height, projectedStations[index], projectedStations[index + 1], [255, 196, 54], 1.35, 0.96);
  }
  for (let index = 0; index < stationPositions.length; index += 1) {
    const center = stationPositions[index];
    const radius = registration.stations[index].radius;
    const frame = stationPoseFrame(stationPositions, index);
    const rings = [
      [frame.lateral, radius.x, frame.normal, radius.y],
      [frame.lateral, radius.x, frame.tangent, radius.z],
      [frame.normal, radius.y, frame.tangent, radius.z],
    ];
    for (const [axisA, radiusA, axisB, radiusB] of rings) {
      let previous = null;
      for (let sample = 0; sample <= 40; sample += 1) {
        const angle = sample / 40 * Math.PI * 2;
        const point = add(add(center, mul(axisA, Math.cos(angle) * radiusA)), mul(axisB, Math.sin(angle) * radiusB));
        const projected = projectPoint(point, render.frame, render.camera, render.width, render.height);
        if (previous) drawWitnessLine(render.pixels, render.width, render.height, previous, projected, [56, 225, 214], 0.65, 0.56);
        previous = projected;
      }
    }
    const endpointColor = index === 0
      ? [69, 143, 255]
      : index === stationPositions.length - 1 ? [255, 91, 90] : [255, 211, 73];
    drawWitnessDisc(render.pixels, render.width, render.height, projectedStations[index].x, projectedStations[index].y, 2.7, [12, 17, 22], 1);
    drawWitnessDisc(render.pixels, render.width, render.height, projectedStations[index].x, projectedStations[index].y, 1.75, endpointColor, 1);
  }
  return render;
}

function copyWitnessPanel(target, targetWidth, source, offsetX, offsetY) {
  for (let y = 0; y < source.height; y += 1) {
    const sourceStart = y * source.width * 3;
    const targetStart = ((offsetY + y) * targetWidth + offsetX) * 3;
    target.set(source.pixels.subarray(sourceStart, sourceStart + source.width * 3), targetStart);
  }
}

export function createFittedProxyRigMechanismWitness({
  restTriangles,
  posedTriangles,
  registration,
  restPose,
  posedPose,
  binding,
  posedPositions,
  width = 240,
  height = 196,
  cameraIds = ['az045', 'az090'],
} = {}) {
  if (!Array.isArray(restTriangles) || restTriangles.length === 0 || restTriangles.length !== posedTriangles?.length) {
    throw new Error('mechanism witness requires matching nonempty rest and posed triangle soups');
  }
  if (registration?.schema !== 'kaminos.lirm-fitted-proxy-rig-registration.v0'
      || restPose?.stationPositions?.length !== registration.stationCount
      || posedPose?.stationPositions?.length !== registration.stationCount) {
    throw new Error('mechanism witness requires matching fitted registration and station poses');
  }
  if (binding?.schema !== 'kaminos.lirm-fitted-proxy-rig-binding.v0'
      || posedPositions?.length !== binding.restPositions?.length
      || binding.vertexCount !== restTriangles.length * 3) {
    throw new Error('mechanism witness requires the exact fitted cast binding and posed positions');
  }
  if (!Number.isInteger(width) || width < 48 || !Number.isInteger(height) || height < 48) {
    throw new Error('mechanism witness panel dimensions must be integers >= 48');
  }
  const cameras = cameraIds.map(id => {
    const camera = REFERENCE_FIT_CAMERAS.find(candidate => candidate.id === id);
    if (!camera) throw new Error(`unknown mechanism witness camera: ${id}`);
    return camera;
  });
  if (new Set(cameraIds).size !== cameraIds.length || cameras.length === 0) throw new Error('mechanism witness requires distinct cameras');

  let maxDisplacement = 0;
  const displacement = new Float64Array(binding.vertexCount);
  for (let vertex = 0; vertex < binding.vertexCount; vertex += 1) {
    const offset = vertex * 3;
    displacement[vertex] = Math.hypot(
      posedPositions[offset] - binding.restPositions[offset],
      posedPositions[offset + 1] - binding.restPositions[offset + 1],
      posedPositions[offset + 2] - binding.restPositions[offset + 2],
    );
    maxDisplacement = Math.max(maxDisplacement, displacement[vertex]);
  }
  if (maxDisplacement <= 0) throw new Error('mechanism witness requires material posed displacement');

  const gap = 8; const header = 9;
  const outWidth = width * MECHANISM_WITNESS_COLUMNS.length + gap * (MECHANISM_WITNESS_COLUMNS.length + 1);
  const outHeight = (height + header) * cameras.length + gap * (cameras.length + 1);
  const pixels = new Uint8Array(outWidth * outHeight * 3).fill(13);
  const columnColors = [[133, 145, 153], [48, 210, 202], [81, 197, 145], [241, 145, 51]];
  cameras.forEach((camera, row) => {
    const rowY = gap + row * (height + header + gap);
    const panelY = rowY + header;
    const restClay = rasterizeFlatShadedTriangleSoup({
      triangles: restTriangles, camera, width, height,
      colorForTriangle: () => [126, 139, 148],
    });
    const restProxy = rasterizeFlatShadedTriangleSoup({
      triangles: restTriangles, camera, width, height,
      colorForTriangle: triangle => MECHANISM_SEGMENT_COLORS[binding.segmentIndices[triangle * 3] % MECHANISM_SEGMENT_COLORS.length],
    });
    drawProxyRigXray({ render: restProxy, registration, pose: restPose });
    const posedProxy = rasterizeFlatShadedTriangleSoup({
      triangles: posedTriangles, camera, width, height,
      colorForTriangle: triangle => MECHANISM_SEGMENT_COLORS[binding.segmentIndices[triangle * 3] % MECHANISM_SEGMENT_COLORS.length],
    });
    drawProxyRigXray({ render: posedProxy, registration, pose: posedPose });
    const heat = rasterizeFlatShadedTriangleSoup({
      triangles: posedTriangles, camera, width, height,
      colorForTriangle: triangle => {
        const vertex = triangle * 3;
        const value = clamp((displacement[vertex] + displacement[vertex + 1] + displacement[vertex + 2]) / (3 * maxDisplacement), 0, 1);
        return [
          Math.round(41 + value * 211),
          Math.round(86 + value * 82),
          Math.round(186 - value * 150),
        ];
      },
    });
    const panels = [restClay, restProxy, posedProxy, heat];
    panels.forEach((panel, column) => {
      const x = gap + column * (width + gap);
      for (let y = rowY; y < rowY + header - 2; y += 1) {
        for (let px = x; px < x + width; px += 1) pixels.set(columnColors[column], (y * outWidth + px) * 3);
      }
      copyWitnessPanel(pixels, outWidth, panel, x, panelY);
    });
  });
  return {
    width: outWidth,
    height: outHeight,
    bytes: encodeRgbPng(outWidth, outHeight, pixels),
    columns: [...MECHANISM_WITNESS_COLUMNS],
    cameraIds: [...cameraIds],
    stationCount: registration.stationCount,
    maxDisplacement,
  };
}

function createProxyRigWitnessSheet({ restById, posedById, width, height }) {
  const scale = 3; const gap = 4; const header = 6;
  const cellWidth = width * scale; const cellHeight = height * scale;
  const outWidth = cellWidth * 3 + gap * 4;
  const outHeight = (cellHeight + header) * REFERENCE_FIT_CAMERAS.length + gap * (REFERENCE_FIT_CAMERAS.length + 1);
  const pixels = new Uint8Array(outWidth * outHeight * 3).fill(18);
  REFERENCE_FIT_CAMERAS.forEach((camera, row) => {
    const rest = restById[camera.id]; const posed = posedById[camera.id];
    const y0 = gap + row * (cellHeight + header + gap) + header;
    const headerColor = row % 2 ? [70, 116, 104] : [186, 143, 61];
    for (let y = y0 - header; y < y0 - 1; y += 1) for (let x = gap; x < outWidth - gap; x += 1) {
      pixels.set(headerColor, (y * outWidth + x) * 3);
    }
    const sources = [
      index => rest.mask[index] ? [236, 232, 218] : [0, 0, 0],
      index => posed.mask[index] ? [90, 205, 177] : [0, 0, 0],
      index => rest.mask[index] && posed.mask[index] ? [242, 242, 238]
        : rest.mask[index] ? [232, 72, 74] : posed.mask[index] ? [65, 132, 236] : [0, 0, 0],
    ];
    sources.forEach((colorAt, column) => paintCell(
      pixels, outWidth, gap + column * (cellWidth + gap), y0, width, height, colorAt, scale,
    ));
  });
  return { width: outWidth, height: outHeight, bytes: encodeRgbPng(outWidth, outHeight, pixels) };
}

function createProxyRigDepthWitnessSheet({ restById, posedById, width, height }) {
  const scale = 3; const gap = 4; const header = 6;
  const cellWidth = width * scale; const cellHeight = height * scale;
  const outWidth = cellWidth * 3 + gap * 4;
  const outHeight = (cellHeight + header) * REFERENCE_FIT_CAMERAS.length + gap * (REFERENCE_FIT_CAMERAS.length + 1);
  const pixels = new Uint8Array(outWidth * outHeight * 3).fill(18);
  REFERENCE_FIT_CAMERAS.forEach((camera, row) => {
    const rest = restById[camera.id]; const posed = posedById[camera.id];
    const y0 = gap + row * (cellHeight + header + gap) + header;
    const headerColor = row % 2 ? [70, 116, 104] : [186, 143, 61];
    for (let y = y0 - header; y < y0 - 1; y += 1) for (let x = gap; x < outWidth - gap; x += 1) {
      pixels.set(headerColor, (y * outWidth + x) * 3);
    }
    const depthColor = render => index => {
      const value = render.mask[index] ? Math.round((1 - render.depth[index]) * 255) : 0;
      return [value, value, value];
    };
    const sources = [
      depthColor(rest),
      depthColor(posed),
      index => {
        if (!rest.mask[index] && !posed.mask[index]) return [0, 0, 0];
        if (!rest.mask[index]) return [45, 92, 225];
        if (!posed.mask[index]) return [225, 58, 65];
        const error = Math.min(255, Math.round(Math.abs(rest.depth[index] - posed.depth[index]) * 1400));
        return [error, 190 - Math.round(error * 0.45), 96];
      },
    ];
    sources.forEach((colorAt, column) => paintCell(
      pixels, outWidth, gap + column * (cellWidth + gap), y0, width, height, colorAt, scale,
    ));
  });
  return { width: outWidth, height: outHeight, bytes: encodeRgbPng(outWidth, outHeight, pixels) };
}

export async function runFittedProxyRigProof({
  donorPath,
  sourcePacketPath,
  fitReportPath,
  outDir,
  expectedDonorSha256,
  expectedFitReportSha256,
  phase = 0.21,
  amplitude = 0.1,
  width = 64,
  height = 52,
} = {}) {
  const outputRoot = resolve(outDir);
  await mkdir(outputRoot, { recursive: true });
  const reportPath = resolve(outputRoot, 'proof-report.json');
  const startedAtMs = Date.now();
  const report = {
    schema: 'kaminos.lirm-fitted-proxy-rig-proof.v0',
    status: 'running',
    failurePhase: null,
    requestedRoute: FITTED_PROXY_RIG_PROOF_ROUTE,
    effectiveRoute: null,
    expectedDonorSha256,
    expectedFitReportSha256,
    requestedConfig: { phase, amplitude, width, height },
    effectiveConfig: null,
    sourcePacket: { path: sourcePacketPath ? resolve(sourcePacketPath) : null, sha256: null },
    fitReport: { path: fitReportPath ? resolve(fitReportPath) : null, sha256: null },
    donor: { path: donorPath ? resolve(donorPath) : null, sha256: null, triangleCount: null },
    timing: { startedAt: new Date(startedAtMs).toISOString(), finishedAt: null, durationSeconds: null },
    lastTrustworthyEvidence: 'invocation recorded; source packet not yet admitted',
    outputInventory: { registration: null, primaryWitness: null, depthWitness: null, mechanismWitness: null },
  };
  await writeJsonAtomic(reportPath, report);
  let activePhase = 'source-packet-admission';
  try {
    if (!existsSync(sourcePacketPath)) throw new Error(`missing source packet: ${sourcePacketPath}`);
    const packetBytes = await readFile(sourcePacketPath);
    const packet = JSON.parse(packetBytes.toString('utf8'));
    report.sourcePacket.sha256 = `sha256:${createHash('sha256').update(packetBytes).digest('hex')}`;
    const program = createPreservedProxyArmatureProgram(packet, { sourcePacketSha256: report.sourcePacket.sha256 });
    report.sourcePacket.candidateId = packet.candidateId;
    report.sourcePacket.primitiveCount = packet.proxyPrimitives.length;
    report.lastTrustworthyEvidence = 'exact source packet admitted; fit report not yet admitted';
    activePhase = 'fit-report-admission';
    await writeJsonAtomic(reportPath, report);

    if (!existsSync(fitReportPath)) throw new Error(`missing fit report: ${fitReportPath}`);
    const fitBytes = await readFile(fitReportPath);
    const fitReport = JSON.parse(fitBytes.toString('utf8'));
    report.fitReport.sha256 = `sha256:${createHash('sha256').update(fitBytes).digest('hex')}`;
    if (report.fitReport.sha256 !== expectedFitReportSha256) {
      throw new Error(`fit report hash mismatch: ${report.fitReport.sha256} != ${expectedFitReportSha256}`);
    }
    const registration = createFittedProxyRigRegistration({
      fitReport,
      fitReportPath,
      armatureProgram: program,
      expectedDonorSha256,
      requireEvidenceFiles: true,
    });
    report.fitReport.status = fitReport.status;
    report.fitReport.armatureProgramId = fitReport.effectiveArmatureProgramId;
    report.lastTrustworthyEvidence = 'accepted held-out fit admitted; donor bytes not yet admitted';
    activePhase = 'donor-admission';
    await writeJsonAtomic(reportPath, report);

    if (!existsSync(donorPath)) throw new Error(`missing donor: ${donorPath}`);
    const donor = await loadGlbTriangleSoup(donorPath);
    if (donor.sha256 !== expectedDonorSha256) throw new Error(`donor hash mismatch: ${donor.sha256} != ${expectedDonorSha256}`);
    report.donor.sha256 = donor.sha256;
    report.donor.triangleCount = donor.triangleCount;
    report.lastTrustworthyEvidence = `${donor.triangleCount} normalized donor triangles admitted; binding not yet computed`;
    activePhase = 'binding-and-zero-pose';
    await writeJsonAtomic(reportPath, report);

    const restObjects = donor.triangles.flat();
    const binding = createFittedProxyRigBinding({ positions: restObjects, registration });
    const restPose = createFittedProxyRigPose({ registration, phase: 0, amplitude: 0 });
    const restPacked = deformFittedProxyRigBinding({ binding, pose: restPose });
    let maxRestError = 0;
    for (let index = 0; index < restPacked.length; index += 1) {
      maxRestError = Math.max(maxRestError, Math.abs(restPacked[index] - binding.restPositions[index]));
    }
    if (maxRestError > 1e-9) throw new Error(`zero pose reconstruction error exceeded contract: ${maxRestError}`);
    const pose = createFittedProxyRigPose({ registration, phase, amplitude });
    const posedPacked = deformFittedProxyRigBinding({ binding, pose });
    let maxDisplacement = 0; let displacementSum = 0;
    for (let vertex = 0; vertex < binding.vertexCount; vertex += 1) {
      const dx = posedPacked[vertex * 3] - restPacked[vertex * 3];
      const dy = posedPacked[vertex * 3 + 1] - restPacked[vertex * 3 + 1];
      const dz = posedPacked[vertex * 3 + 2] - restPacked[vertex * 3 + 2];
      const displacement = Math.hypot(dx, dy, dz);
      if (!Number.isFinite(displacement)) throw new Error(`non-finite deformation at vertex ${vertex}`);
      maxDisplacement = Math.max(maxDisplacement, displacement);
      displacementSum += displacement;
    }
    if (maxDisplacement < Math.max(0.005, amplitude * 0.15)) throw new Error('active pose produced no material deformation');
    report.lastTrustworthyEvidence = 'zero pose exact and active deformation finite; visual witness not yet written';
    activePhase = 'visual-witness';
    await writeJsonAtomic(reportPath, report);

    const posedTriangles = packedPositionsToTriangles(posedPacked);
    const restById = {}; const posedById = {};
    for (const camera of REFERENCE_FIT_CAMERAS) {
      restById[camera.id] = rasterizeTriangleSoup({ triangles: donor.triangles, camera, width, height });
      posedById[camera.id] = rasterizeTriangleSoup({ triangles: posedTriangles, camera, width, height });
      const restPixels = restById[camera.id].mask.reduce((sum, value) => sum + value, 0);
      const posedPixels = posedById[camera.id].mask.reduce((sum, value) => sum + value, 0);
      if (restPixels < 8 || posedPixels < 8) throw new Error(`blank or partial deformation witness for ${camera.id}`);
    }
    const witness = createProxyRigWitnessSheet({ restById, posedById, width, height });
    const depthWitness = createProxyRigDepthWitnessSheet({ restById, posedById, width, height });
    const mechanismWitness = createFittedProxyRigMechanismWitness({
      restTriangles: donor.triangles,
      posedTriangles,
      registration,
      restPose,
      posedPose: pose,
      binding,
      posedPositions: posedPacked,
    });
    const witnessPath = resolve(outputRoot, 'deformation-witness.png');
    const depthWitnessPath = resolve(outputRoot, 'deformation-depth-witness.png');
    const mechanismWitnessPath = resolve(outputRoot, 'mechanism-witness.png');
    await writeFile(witnessPath, witness.bytes);
    await writeFile(depthWitnessPath, depthWitness.bytes);
    await writeFile(mechanismWitnessPath, mechanismWitness.bytes);
    const registrationPath = resolve(outputRoot, 'registration.json');
    await writeJsonAtomic(registrationPath, registration);
    const registrationBytes = await readFile(registrationPath);
    report.status = 'proof-passed-uninspected';
    report.effectiveRoute = FITTED_PROXY_RIG_PROOF_ROUTE;
    report.effectiveConfig = { phase, amplitude, width, height };
    report.registration = {
      schema: registration.schema,
      fitMode: registration.fitMode,
      stationCount: registration.stationCount,
      manualControlCount: registration.manualControlCount,
      headDirection: registration.headDirection,
    };
    report.binding = {
      kind: 'nearest-rest-centerline-segment-with-local-frame',
      vertexCount: binding.vertexCount,
      maxInfluenceStations: 2,
      manualControlCount: binding.manualControlCount,
    };
    report.metrics = {
      zeroPoseMaxError: maxRestError,
      activePoseMaxDisplacement: maxDisplacement,
      activePoseMeanDisplacement: displacementSum / binding.vertexCount,
      topologyPreserved: posedTriangles.length === donor.triangleCount,
      finite: true,
    };
    report.outputInventory = {
      registration: {
        path: registrationPath,
        bytes: registrationBytes.length,
        sha256: `sha256:${createHash('sha256').update(registrationBytes).digest('hex')}`,
      },
      primaryWitness: {
        path: witnessPath,
        bytes: witness.bytes.length,
        sha256: `sha256:${createHash('sha256').update(witness.bytes).digest('hex')}`,
        columns: ['rest-cast', 'posed-cast', 'rest-posed-overlay'],
        cameraIds: REFERENCE_FIT_CAMERAS.map(camera => camera.id),
      },
      depthWitness: {
        path: depthWitnessPath,
        bytes: depthWitness.bytes.length,
        sha256: `sha256:${createHash('sha256').update(depthWitness.bytes).digest('hex')}`,
        columns: ['rest-depth', 'posed-depth', 'depth-change'],
        cameraIds: REFERENCE_FIT_CAMERAS.map(camera => camera.id),
      },
      mechanismWitness: {
        path: mechanismWitnessPath,
        bytes: mechanismWitness.bytes.length,
        sha256: `sha256:${createHash('sha256').update(mechanismWitness.bytes).digest('hex')}`,
        columns: mechanismWitness.columns,
        cameraIds: mechanismWitness.cameraIds,
        stationCount: mechanismWitness.stationCount,
        maxDisplacement: mechanismWitness.maxDisplacement,
      },
    };
    report.lastTrustworthyEvidence = 'exact rest reconstruction and finite active deformation witnessed across all eight canonical cameras; visual inspection pending';
    const finishedAtMs = Date.now();
    report.timing.finishedAt = new Date(finishedAtMs).toISOString();
    report.timing.durationSeconds = (finishedAtMs - startedAtMs) / 1000;
    await writeJsonAtomic(reportPath, report);
    return report;
  } catch (error) {
    report.status = 'failed';
    report.failurePhase = activePhase;
    report.error = String(error?.stack ?? error);
    const finishedAtMs = Date.now();
    report.timing.finishedAt = new Date(finishedAtMs).toISOString();
    report.timing.durationSeconds = (finishedAtMs - startedAtMs) / 1000;
    await writeJsonAtomic(reportPath, report);
    throw error;
  }
}

export async function recordFittedProxyRigProofVisualInspection({
  reportPath,
  disposition,
  visibleDelta,
  limitations = [],
}) {
  if (!['accepted', 'rejected'].includes(disposition)) throw new Error('proxy rig visual disposition must be accepted or rejected');
  if (typeof visibleDelta !== 'string' || visibleDelta.trim().length < 20) {
    throw new Error('proxy rig visual inspection requires a concrete visible delta');
  }
  if (!Array.isArray(limitations)) throw new TypeError('proxy rig visual inspection limitations must be an array');
  const exactPath = resolve(reportPath);
  const report = JSON.parse(await readFile(exactPath, 'utf8'));
  if (report.schema !== 'kaminos.lirm-fitted-proxy-rig-proof.v0' || report.status !== 'proof-passed-uninspected') {
    throw new Error('proxy rig visual inspection requires an uninspected passed proof');
  }
  if (report.requestedRoute !== FITTED_PROXY_RIG_PROOF_ROUTE || report.effectiveRoute !== FITTED_PROXY_RIG_PROOF_ROUTE) {
    throw new Error('proxy rig proof route identity mismatch');
  }
  if (report.metrics?.topologyPreserved !== true || report.metrics?.finite !== true
      || report.metrics?.zeroPoseMaxError > 1e-9 || report.registration?.manualControlCount !== 0) {
    throw new Error('proxy rig proof mechanical contract is not satisfied');
  }
  const artifacts = [];
  for (const item of [
    report.outputInventory?.registration,
    report.outputInventory?.primaryWitness,
    report.outputInventory?.depthWitness,
    report.outputInventory?.mechanismWitness,
  ]) {
    if (!item?.path || !existsSync(item.path)) throw new Error(`missing proxy rig visual artifact: ${item?.path ?? 'unknown'}`);
    const bytes = await readFile(item.path);
    const sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (bytes.length !== item.bytes || sha256 !== item.sha256) throw new Error(`proxy rig visual artifact drift: ${item.path}`);
    artifacts.push({ path: item.path, bytes: bytes.length, sha256 });
  }
  report.visualInspection = {
    disposition,
    visibleDelta: visibleDelta.trim(),
    limitations: [...limitations],
    artifacts,
  };
  report.status = disposition === 'accepted' ? 'proof-passed-inspected' : 'proof-visual-rejected';
  report.lastTrustworthyEvidence = disposition === 'accepted'
    ? 'silhouette, depth, and mechanism-bearing deformation witnesses visually inspected and accepted'
    : 'silhouette, depth, and mechanism-bearing deformation witnesses visually inspected and rejected';
  await writeJsonAtomic(exactPath, report);
  return report;
}

const COMPONENTS = {
  5120: { bytes: 1, read: 'getInt8' },
  5121: { bytes: 1, read: 'getUint8' },
  5122: { bytes: 2, read: 'getInt16' },
  5123: { bytes: 2, read: 'getUint16' },
  5125: { bytes: 4, read: 'getUint32' },
  5126: { bytes: 4, read: 'getFloat32' },
};
const TYPE_COUNTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a, scalar) => v3(a.x * scalar, a.y * scalar, a.z * scalar);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const length3 = value => Math.hypot(value.x, value.y, value.z);
const normalize = value => mul(value, 1 / Math.max(length3(value), 1e-9));

function canonicalCamera(camera) {
  const expected = REFERENCE_FIT_CAMERAS.find(item => item.id === camera?.id);
  if (!expected) throw new Error(`unknown camera: ${camera?.id ?? 'missing'}`);
  for (const key of ['projection', 'yaw', 'pitch', 'radius', 'viewportWidth', 'viewportHeight', 'near', 'far']) {
    if (camera[key] !== expected[key]) throw new Error(`camera substitution rejected for ${camera.id}: ${key}`);
  }
  return expected;
}

export function assertReferenceFitCameraSplit({ fitViewIds, heldOutViewIds }) {
  if (!Array.isArray(fitViewIds) || !Array.isArray(heldOutViewIds)) throw new TypeError('camera split requires arrays');
  const known = new Set(REFERENCE_FIT_CAMERAS.map(camera => camera.id));
  const fit = new Set(fitViewIds);
  const held = new Set(heldOutViewIds);
  if (fit.size !== fitViewIds.length || held.size !== heldOutViewIds.length) throw new Error('camera split contains duplicate IDs');
  for (const id of [...fit, ...held]) if (!known.has(id)) throw new Error(`unknown camera: ${id}`);
  for (const id of fit) if (held.has(id)) throw new Error(`camera split overlap: ${id}`);
  if (fit.size + held.size !== known.size || [...known].some(id => !fit.has(id) && !held.has(id))) {
    throw new Error('camera split must cover all eight canonical cameras');
  }
}

function armatureProgramProjection(armatureProgram) {
  if (!armatureProgram || typeof armatureProgram !== 'object') throw new TypeError('armature program is required');
  if (typeof armatureProgram.id !== 'string' || !armatureProgram.id.trim()) throw new Error('armature program requires stable id');
  if (typeof armatureProgram.parameterVocabulary !== 'string' || !armatureProgram.parameterVocabulary.trim()) {
    throw new Error('armature program requires parameter vocabulary');
  }
  if (!Array.isArray(armatureProgram.parameterSpecs) || armatureProgram.parameterSpecs.length === 0) {
    throw new Error('armature program requires parameter specs');
  }
  const ids = new Set();
  for (const spec of armatureProgram.parameterSpecs) {
    if (typeof spec?.id !== 'string' || !/^[a-z][a-zA-Z0-9]*$/.test(spec.id) || ids.has(spec.id)) {
      throw new Error(`invalid or duplicate armature parameter id: ${spec?.id}`);
    }
    ids.add(spec.id);
    if (typeof spec.semanticRole !== 'string' || !spec.semanticRole.trim()) throw new Error(`missing semantic role for ${spec.id}`);
    if (![spec.initial, spec.min, spec.max, spec.step].every(Number.isFinite)
        || spec.min >= spec.max || spec.initial < spec.min || spec.initial > spec.max || spec.step <= 0) {
      throw new Error(`invalid parameter bounds for ${spec.id}`);
    }
  }
  return {
    id: armatureProgram.id,
    parameterVocabulary: armatureProgram.parameterVocabulary,
    parameterSpecs: armatureProgram.parameterSpecs,
  };
}

function resolveArmatureProgram(armatureProgram = CRAWLER_ARMATURE_PROGRAM) {
  const projection = armatureProgramProjection(armatureProgram);
  if (typeof armatureProgram.createPrimitives !== 'function') throw new Error('armature program requires primitive factory');
  return { program: armatureProgram, projection };
}

export function createReferenceFitAssayPlan({
  donorPath,
  donorSha256,
  fitViewIds,
  heldOutViewIds,
  armatureProgram = CRAWLER_ARMATURE_PROGRAM,
}) {
  assertReferenceFitCameraSplit({ fitViewIds, heldOutViewIds });
  const { projection } = resolveArmatureProgram(armatureProgram);
  return {
    schema: 'kaminos.lirm-reference-fitted-armature-plan.v0',
    requestedRoute: REFERENCE_FIT_ROUTE,
    donor: { path: resolve(donorPath), sha256: donorSha256 },
    requestedCameraIds: REFERENCE_FIT_CAMERAS.map(camera => camera.id),
    fitViewIds: [...fitViewIds],
    heldOutViewIds: [...heldOutViewIds],
    requestedArmatureProgramId: projection.id,
    armatureProgram: projection,
    parameterSpecs: projection.parameterSpecs,
    evidencePredicate: {
      allowCameraFallback: false,
      allowMissingOrPartialDonorEvidence: false,
      heldOutViewsMayInfluenceOptimization: false,
      requireHeldOutSilhouetteImprovementCount: 3,
      requireHeldOutMeanDepthImprovement: true,
    },
    falseClosureGuards: {
      productionCreatureClaim: 'forbidden',
      meshCopyClaim: 'forbidden',
      learnedPriorClaim: 'not_trained',
      topologySelectionClaim: 'not_assayed',
    },
  };
}

function identity4() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiply4(a, b) {
  const out = Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let k = 0; k < 4; k += 1) out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
    }
  }
  return out;
}

function trsMatrix(node) {
  if (Array.isArray(node.matrix)) return [...node.matrix];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const xx = x * x; const yy = y * y; const zz = z * z;
  const xy = x * y; const xz = x * z; const yz = y * z;
  const wx = w * x; const wy = w * y; const wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * sx, (2 * (xy + wz)) * sx, (2 * (xz - wy)) * sx, 0,
    (2 * (xy - wz)) * sy, (1 - 2 * (xx + zz)) * sy, (2 * (yz + wx)) * sy, 0,
    (2 * (xz + wy)) * sz, (2 * (yz - wx)) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function transformPoint(matrix, point) {
  return v3(
    matrix[0] * point.x + matrix[4] * point.y + matrix[8] * point.z + matrix[12],
    matrix[1] * point.x + matrix[5] * point.y + matrix[9] * point.z + matrix[13],
    matrix[2] * point.x + matrix[6] * point.y + matrix[10] * point.z + matrix[14],
  );
}

function parseGlb(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) {
    throw new Error('donor is not a GLB v2 file');
  }
  const declaredLength = bytes.readUInt32LE(8);
  if (declaredLength !== bytes.length) throw new Error(`GLB length mismatch: ${declaredLength} != ${bytes.length}`);
  let offset = 12;
  let json = null;
  let binary = null;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (data.length !== length) throw new Error('truncated GLB chunk');
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8').replace(/\0+\s*$/, ''));
    if (type === 0x004e4942) binary = data;
    offset += 8 + length;
  }
  if (!json || !binary) throw new Error('GLB requires JSON and BIN chunks');
  return { json, binary };
}

function readAccessor(gltf, binary, accessorIndex) {
  const accessor = gltf.accessors?.[accessorIndex];
  if (!accessor || accessor.sparse) throw new Error(`unsupported or missing accessor ${accessorIndex}`);
  const view = gltf.bufferViews?.[accessor.bufferView];
  const component = COMPONENTS[accessor.componentType];
  const count = TYPE_COUNTS[accessor.type];
  if (!view || !component || !count) throw new Error(`unsupported accessor layout ${accessorIndex}`);
  const stride = view.byteStride ?? component.bytes * count;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const dataView = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const rows = [];
  for (let index = 0; index < accessor.count; index += 1) {
    const row = [];
    for (let item = 0; item < count; item += 1) {
      row.push(dataView[component.read](start + index * stride + item * component.bytes, true));
    }
    rows.push(row);
  }
  return rows;
}

export async function loadGlbTriangleSoup(path) {
  const bytes = await readFile(path);
  const { json, binary } = parseGlb(bytes);
  const triangles = [];
  const scene = json.scenes?.[json.scene ?? 0];
  const roots = scene?.nodes ?? json.nodes?.map((_node, index) => index) ?? [];
  const visit = (nodeIndex, parentMatrix) => {
    const node = json.nodes?.[nodeIndex];
    if (!node) throw new Error(`missing GLB node ${nodeIndex}`);
    const world = multiply4(parentMatrix, trsMatrix(node));
    if (Number.isInteger(node.mesh)) {
      const mesh = json.meshes?.[node.mesh];
      for (const primitive of mesh?.primitives ?? []) {
        if ((primitive.mode ?? 4) !== 4 || !Number.isInteger(primitive.attributes?.POSITION)) continue;
        const positions = readAccessor(json, binary, primitive.attributes.POSITION)
          .map(([x, y, z]) => transformPoint(world, v3(x, y, z)));
        const indices = Number.isInteger(primitive.indices)
          ? readAccessor(json, binary, primitive.indices).map(([value]) => value)
          : positions.map((_value, index) => index);
        for (let index = 0; index + 2 < indices.length; index += 3) {
          triangles.push([positions[indices[index]], positions[indices[index + 1]], positions[indices[index + 2]]]);
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const root of roots) visit(root, identity4());
  if (triangles.length === 0) throw new Error('GLB donor produced no triangles');
  const points = triangles.flat();
  const mins = v3(Infinity, Infinity, Infinity);
  const maxs = v3(-Infinity, -Infinity, -Infinity);
  for (const point of points) {
    mins.x = Math.min(mins.x, point.x); mins.y = Math.min(mins.y, point.y); mins.z = Math.min(mins.z, point.z);
    maxs.x = Math.max(maxs.x, point.x); maxs.y = Math.max(maxs.y, point.y); maxs.z = Math.max(maxs.z, point.z);
  }
  const center = mul(add(mins, maxs), 0.5);
  const diagonal = Math.max(length3(sub(maxs, mins)), 1e-8);
  const scale = 2.15 / diagonal;
  const normalized = triangles.map(triangle => triangle.map(point => mul(sub(point, center), scale)));
  return {
    triangles: normalized,
    triangleCount: normalized.length,
    sourceBounds: { min: mins, max: maxs, center, diagonal },
    normalization: { kind: 'bbox-center-diagonal-scale', targetDiagonal: 2.15, scale },
    bytes: bytes.length,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

function cameraFrame(camera) {
  const position = v3(
    Math.sin(camera.yaw) * camera.radius * Math.cos(camera.pitch),
    Math.sin(camera.pitch) * camera.radius,
    Math.cos(camera.yaw) * camera.radius * Math.cos(camera.pitch),
  );
  const forward = normalize(mul(position, -1));
  const right = normalize(cross(forward, v3(0, 1, 0)));
  const up = normalize(cross(right, forward));
  return { position, forward, right, up };
}

function projectPoint(point, frame, camera, width, height) {
  const relative = sub(point, frame.position);
  return {
    x: (dot(relative, frame.right) / camera.viewportWidth + 0.5) * width,
    y: (0.5 - dot(relative, frame.up) / camera.viewportHeight) * height,
    depth: dot(relative, frame.forward),
  };
}

function rasterizeTriangleSoup({ triangles, camera, width, height }) {
  const exact = canonicalCamera(camera);
  const frame = cameraFrame(exact);
  const depth = new Float64Array(width * height).fill(Infinity);
  const mask = new Uint8Array(width * height);
  for (const triangle of triangles) {
    const [a, b, c] = triangle.map(point => projectPoint(point, frame, exact, width, height));
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(area) < 1e-9) continue;
    const minX = clamp(Math.floor(Math.min(a.x, b.x, c.x)), 0, width - 1);
    const maxX = clamp(Math.ceil(Math.max(a.x, b.x, c.x)), 0, width - 1);
    const minY = clamp(Math.floor(Math.min(a.y, b.y, c.y)), 0, height - 1);
    const maxY = clamp(Math.ceil(Math.max(a.y, b.y, c.y)), 0, height - 1);
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5; const py = y + 0.5;
        const w0 = ((b.x - px) * (c.y - py) - (b.y - py) * (c.x - px)) / area;
        const w1 = ((c.x - px) * (a.y - py) - (c.y - py) * (a.x - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-7 || w1 < -1e-7 || w2 < -1e-7) continue;
        const z = w0 * a.depth + w1 * b.depth + w2 * c.depth;
        const index = y * width + x;
        if (z < depth[index]) { depth[index] = z; mask[index] = 1; }
      }
    }
  }
  const normalizedDepth = new Float64Array(width * height);
  for (let index = 0; index < depth.length; index += 1) {
    normalizedDepth[index] = mask[index] ? clamp((depth[index] - exact.near) / (exact.far - exact.near), 0, 1) : 1;
  }
  return { cameraId: exact.id, width, height, mask, depth: normalizedDepth };
}

function rasterizeFlatShadedTriangleSoup({ triangles, camera, width, height, colorForTriangle }) {
  const exact = canonicalCamera(camera);
  const frame = cameraFrame(exact);
  const depth = new Float64Array(width * height).fill(Infinity);
  const pixels = new Uint8Array(width * height * 3);
  for (let index = 0; index < width * height; index += 1) pixels.set([18, 22, 27], index * 3);
  const light = normalize(v3(-0.42, 0.78, 0.47));
  for (let triangleIndex = 0; triangleIndex < triangles.length; triangleIndex += 1) {
    const triangle = triangles[triangleIndex];
    const [a, b, c] = triangle.map(point => projectPoint(point, frame, exact, width, height));
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(area) < 1e-9) continue;
    const normal = normalize(cross(sub(triangle[1], triangle[0]), sub(triangle[2], triangle[0])));
    const shade = 0.28 + 0.72 * Math.abs(dot(normal, light));
    const base = colorForTriangle?.(triangleIndex, triangle) ?? [126, 139, 148];
    const color = base.map(value => clamp(Math.round(value * shade), 0, 255));
    const minX = clamp(Math.floor(Math.min(a.x, b.x, c.x)), 0, width - 1);
    const maxX = clamp(Math.ceil(Math.max(a.x, b.x, c.x)), 0, width - 1);
    const minY = clamp(Math.floor(Math.min(a.y, b.y, c.y)), 0, height - 1);
    const maxY = clamp(Math.ceil(Math.max(a.y, b.y, c.y)), 0, height - 1);
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5; const py = y + 0.5;
        const w0 = ((b.x - px) * (c.y - py) - (b.y - py) * (c.x - px)) / area;
        const w1 = ((c.x - px) * (a.y - py) - (c.y - py) * (a.x - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-7 || w1 < -1e-7 || w2 < -1e-7) continue;
        const z = w0 * a.depth + w1 * b.depth + w2 * c.depth;
        const pixelIndex = y * width + x;
        if (z >= depth[pixelIndex]) continue;
        depth[pixelIndex] = z;
        pixels.set(color, pixelIndex * 3);
      }
    }
  }
  return { cameraId: exact.id, camera: exact, frame, width, height, pixels, depth };
}

function parameterObject(parameters, parameterSpecs) {
  const out = {};
  for (const spec of parameterSpecs) {
    const value = Number(parameters?.[spec.id]);
    if (!Number.isFinite(value)) throw new Error(`missing semantic parameter: ${spec.id}`);
    out[spec.id] = clamp(value, spec.min, spec.max);
  }
  return out;
}

function capsuleDistance(point, primitive) {
  const pa = sub(point, primitive.a);
  const ba = sub(primitive.b, primitive.a);
  const t = clamp(dot(pa, ba) / Math.max(dot(ba, ba), 1e-8), 0, 1);
  return length3(sub(pa, mul(ba, t))) - primitive.radius;
}

function ellipsoidDistance(point, primitive) {
  const q = sub(point, primitive.center);
  const normalized = v3(q.x / primitive.radius.x, q.y / primitive.radius.y, q.z / primitive.radius.z);
  return (length3(normalized) - 1) * Math.min(primitive.radius.x, primitive.radius.y, primitive.radius.z);
}

function smoothMin(a, b, radius = 0.065) {
  const h = clamp(0.5 + 0.5 * (b - a) / radius, 0, 1);
  return b * (1 - h) + a * h - radius * h * (1 - h);
}

export function createReferenceArmaturePrimitives(parameters) {
  const p = parameterObject(parameters, REFERENCE_FIT_PARAMETER_SPECS);
  const primitives = [];
  const segmentCount = 5;
  for (let index = 0; index < segmentCount; index += 1) {
    const t = index / (segmentCount - 1);
    const axial = (t - 0.5) * p.bodyLength;
    const belly = Math.exp(-((t - 0.52) ** 2) / 0.085) * (p.bellyScale - 0.45);
    const posterior = t < 0.28 ? p.tailScale : 1;
    const anterior = t > 0.7 ? 0.82 + p.headScale * 0.18 : 1;
    const lateralCurve = Math.sin((t - 0.5) * Math.PI) * p.curveAmplitude;
    primitives.push({
      kind: 'ellipsoid', role: 'bodyMass',
      center: v3(lateralCurve, p.dorsalLift * (0.35 + 0.65 * t), axial),
      radius: v3(
        p.bodyWidth * (0.62 + belly * 0.42) * posterior * anterior,
        p.bodyHeight * (0.67 + belly * 0.34) * posterior,
        p.bodyLength * 0.19,
      ),
    });
  }
  const frontZ = p.bodyLength * 0.54;
  primitives.push({
    kind: 'ellipsoid', role: 'headOrientation',
    center: v3(p.curveAmplitude * 0.7, p.headLift + p.dorsalLift, frontZ),
    radius: v3(p.bodyWidth * (0.42 + p.headScale * 0.28), p.bodyHeight * (0.45 + p.headScale * 0.3), p.bodyLength * (0.13 + p.headScale * 0.05)),
  });
  const limbZs = [-0.27, 0.28];
  for (const longitudinal of limbZs) {
    for (const side of [-1, 1]) {
      const shoulder = v3(side * p.bodyWidth * 0.45, -p.bodyHeight * 0.18, longitudinal * p.bodyLength);
      const contactTarget = v3(side * p.limbSpread, p.contactHeight, longitudinal * p.bodyLength + (longitudinal > 0 ? 0.06 : -0.03));
      const foot = add(shoulder, mul(normalize(sub(contactTarget, shoulder)), p.limbLength));
      primitives.push({ kind: 'capsule', role: 'contactLimb', a: shoulder, b: foot, radius: p.limbThickness });
      primitives.push({
        kind: 'ellipsoid', role: 'groundContact', center: foot,
        radius: v3(p.limbThickness * 1.55, p.limbThickness * 0.72, p.limbThickness * 1.8),
      });
    }
  }
  return primitives;
}

function fieldDistance(point, primitives) {
  let distance = Infinity;
  for (const primitive of primitives) {
    const current = primitive.kind === 'capsule' ? capsuleDistance(point, primitive) : ellipsoidDistance(point, primitive);
    distance = distance === Infinity ? current : smoothMin(distance, current);
  }
  return distance;
}

export function renderReferenceArmature({
  parameters,
  armatureProgram = CRAWLER_ARMATURE_PROGRAM,
  camera,
  width = 40,
  height = 32,
}) {
  const exact = canonicalCamera(camera);
  const { program, projection } = resolveArmatureProgram(armatureProgram);
  const primitives = program.createPrimitives(parameterObject(parameters, projection.parameterSpecs));
  if (!Array.isArray(primitives) || primitives.length === 0) throw new Error('armature primitive factory returned no primitives');
  const semanticRoles = [...new Set(primitives.map(primitive => primitive.role))];
  const frame = cameraFrame(exact);
  const mask = new Uint8Array(width * height);
  const depth = new Float64Array(width * height).fill(1);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const horizontal = ((x + 0.5) / width - 0.5) * exact.viewportWidth;
      const vertical = (0.5 - (y + 0.5) / height) * exact.viewportHeight;
      const origin = add(add(frame.position, mul(frame.right, horizontal)), mul(frame.up, vertical));
      let travel = exact.near;
      for (let step = 0; step < 72 && travel <= exact.far; step += 1) {
        const point = add(origin, mul(frame.forward, travel));
        const distance = fieldDistance(point, primitives);
        if (distance < 0.007) {
          const index = y * width + x;
          mask[index] = 1;
          depth[index] = clamp((travel - exact.near) / (exact.far - exact.near), 0, 1);
          break;
        }
        travel += clamp(distance * 0.72, 0.012, 0.11);
      }
    }
  }
  return { cameraId: exact.id, width, height, mask, depth, semanticRoles, primitiveCount: primitives.length };
}

function viewMetrics(donor, armature) {
  let intersection = 0; let union = 0; let donorCount = 0; let armatureCount = 0;
  let depthError = 0; let depthCount = 0;
  for (let index = 0; index < donor.mask.length; index += 1) {
    const a = donor.mask[index] ? 1 : 0;
    const b = armature.mask[index] ? 1 : 0;
    intersection += a && b ? 1 : 0;
    union += a || b ? 1 : 0;
    donorCount += a; armatureCount += b;
    if (a && b) { depthError += Math.abs(donor.depth[index] - armature.depth[index]); depthCount += 1; }
  }
  const iou = intersection / Math.max(union, 1);
  const depthMae = depthError / Math.max(depthCount, 1);
  const occupancyError = Math.abs(donorCount - armatureCount) / Math.max(donorCount, 1);
  return { iou, depthMae, occupancyError, donorPixels: donorCount, armaturePixels: armatureCount };
}

function aggregateMetrics(viewIds, donorById, armatureById) {
  const byView = {};
  for (const id of viewIds) byView[id] = viewMetrics(donorById[id], armatureById[id]);
  const values = Object.values(byView);
  return {
    byView,
    meanIou: values.reduce((sum, item) => sum + item.iou, 0) / values.length,
    meanDepthMae: values.reduce((sum, item) => sum + item.depthMae, 0) / values.length,
    meanOccupancyError: values.reduce((sum, item) => sum + item.occupancyError, 0) / values.length,
  };
}

function objective(metrics) {
  return (1 - metrics.meanIou) + metrics.meanDepthMae * 0.42 + metrics.meanOccupancyError * 0.12;
}

function renderViews(parameters, viewIds, width, height, armatureProgram) {
  return Object.fromEntries(viewIds.map(id => {
    const camera = REFERENCE_FIT_CAMERAS.find(item => item.id === id);
    return [id, renderReferenceArmature({ parameters, armatureProgram, camera, width, height })];
  }));
}

function fitReferenceArmature({ donorById, fitViewIds, width, height, armatureProgram, passes = 4 }) {
  const { projection } = resolveArmatureProgram(armatureProgram);
  const parameterSpecs = projection.parameterSpecs;
  let parameters = Object.fromEntries(parameterSpecs.map(spec => [spec.id, spec.initial]));
  const steps = Object.fromEntries(parameterSpecs.map(spec => [spec.id, spec.step]));
  let renders = renderViews(parameters, fitViewIds, width, height, armatureProgram);
  let metrics = aggregateMetrics(fitViewIds, donorById, renders);
  let score = objective(metrics);
  const trace = [{ pass: -1, parameterId: null, direction: 0, score, accepted: true }];
  for (let pass = 0; pass < passes; pass += 1) {
    for (const spec of parameterSpecs) {
      let best = { parameters, renders, metrics, score, direction: 0 };
      for (const direction of [-1, 1]) {
        const candidate = { ...parameters, [spec.id]: clamp(parameters[spec.id] + steps[spec.id] * direction, spec.min, spec.max) };
        if (candidate[spec.id] === parameters[spec.id]) continue;
        const candidateRenders = renderViews(candidate, fitViewIds, width, height, armatureProgram);
        const candidateMetrics = aggregateMetrics(fitViewIds, donorById, candidateRenders);
        const candidateScore = objective(candidateMetrics);
        if (candidateScore + 1e-8 < best.score) {
          best = { parameters: candidate, renders: candidateRenders, metrics: candidateMetrics, score: candidateScore, direction };
        }
      }
      const accepted = best.direction !== 0;
      ({ parameters, renders, metrics, score } = best);
      trace.push({ pass, parameterId: spec.id, direction: best.direction, value: parameters[spec.id], score, accepted });
    }
    for (const spec of parameterSpecs) steps[spec.id] *= 0.58;
  }
  return { parameters, renders, metrics, score, trace };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const kind = Buffer.from(type);
  const header = Buffer.alloc(4); header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([kind, data])));
  return Buffer.concat([header, kind, data, checksum]);
}

function encodeRgbPng(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1); raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 3;
      raw[row + 1 + x * 3] = pixels[source];
      raw[row + 2 + x * 3] = pixels[source + 1];
      raw[row + 3 + x * 3] = pixels[source + 2];
    }
  }
  return Buffer.concat([
    Buffer.from('\x89PNG\r\n\x1a\n', 'binary'), pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function paintCell(target, targetWidth, cellX, cellY, sourceWidth, sourceHeight, colorAt, scale = 3) {
  for (let y = 0; y < sourceHeight; y += 1) for (let x = 0; x < sourceWidth; x += 1) {
    const color = colorAt(y * sourceWidth + x);
    for (let yy = 0; yy < scale; yy += 1) for (let xx = 0; xx < scale; xx += 1) {
      const tx = cellX + x * scale + xx; const ty = cellY + y * scale + yy;
      const index = (ty * targetWidth + tx) * 3;
      target[index] = color[0]; target[index + 1] = color[1]; target[index + 2] = color[2];
    }
  }
}

function createWitnessSheet({ donorById, initialById, fittedById, width, height, mode }) {
  const scale = 3; const gap = 4; const header = 6;
  const cellWidth = width * scale; const cellHeight = height * scale;
  const outWidth = cellWidth * 5 + gap * 6;
  const outHeight = (cellHeight + header) * 8 + gap * 9;
  const pixels = new Uint8Array(outWidth * outHeight * 3).fill(18);
  REFERENCE_FIT_CAMERAS.forEach((camera, row) => {
    const donor = donorById[camera.id]; const initial = initialById[camera.id]; const fitted = fittedById[camera.id];
    const y0 = gap + row * (cellHeight + header + gap) + header;
    const headerColor = row % 2 ? [70, 116, 104] : [186, 143, 61];
    for (let y = y0 - header; y < y0 - 1; y += 1) for (let x = gap; x < outWidth - gap; x += 1) {
      const index = (y * outWidth + x) * 3; pixels.set(headerColor, index);
    }
    const sources = mode === 'depth'
      ? [
        index => { const value = donor.mask[index] ? Math.round((1 - donor.depth[index]) * 255) : 0; return [value, value, value]; },
        index => { const value = initial.mask[index] ? Math.round((1 - initial.depth[index]) * 255) : 0; return [value, value, value]; },
        index => { const value = fitted.mask[index] ? Math.round((1 - fitted.depth[index]) * 255) : 0; return [value, value, value]; },
        index => donor.mask[index] && fitted.mask[index] ? [Math.round(Math.abs(donor.depth[index] - fitted.depth[index]) * 900), 210, 110] : [0, 0, 0],
        index => donor.mask[index] && initial.mask[index] ? [Math.round(Math.abs(donor.depth[index] - initial.depth[index]) * 900), 120, 220] : [0, 0, 0],
      ]
      : [
        index => donor.mask[index] ? [238, 238, 232] : [0, 0, 0],
        index => initial.mask[index] ? [217, 156, 78] : [0, 0, 0],
        index => fitted.mask[index] ? [98, 208, 173] : [0, 0, 0],
        index => donor.mask[index] && fitted.mask[index] ? [240, 240, 240] : donor.mask[index] ? [230, 60, 68] : fitted.mask[index] ? [60, 126, 235] : [0, 0, 0],
        index => donor.mask[index] && initial.mask[index] ? [240, 240, 240] : donor.mask[index] ? [230, 60, 68] : initial.mask[index] ? [60, 126, 235] : [0, 0, 0],
      ];
    sources.forEach((colorAt, column) => paintCell(pixels, outWidth, gap + column * (cellWidth + gap), y0, width, height, colorAt, scale));
  });
  return { width: outWidth, height: outHeight, bytes: encodeRgbPng(outWidth, outHeight, pixels) };
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

function resolveReportArtifactPath(recordedPath, reportPath) {
  if (typeof recordedPath !== 'string' || !reportPath) return recordedPath;
  if (!isAbsolute(recordedPath)) return recordedPath;
  if (existsSync(recordedPath)) return recordedPath;
  return resolve(dirname(resolve(reportPath)), basename(recordedPath));
}

export function validateReferenceFitReport(report, { requireFiles = true, reportPath = null } = {}) {
  if (report?.schema !== 'kaminos.lirm-reference-fitted-armature-assay.v0') throw new Error('unexpected reference-fit report schema');
  if (report.requestedRoute !== REFERENCE_FIT_ROUTE || report.effectiveRoute !== REFERENCE_FIT_ROUTE) {
    throw new Error('reference-fit route identity mismatch');
  }
  const carriesProgramIdentity = report.requestedArmatureProgramId !== undefined
    || report.effectiveArmatureProgramId !== undefined
    || report.armatureProgram !== undefined;
  let programProjection;
  if (carriesProgramIdentity) {
    programProjection = armatureProgramProjection(report.armatureProgram);
    if (report.requestedArmatureProgramId !== programProjection.id
        || report.effectiveArmatureProgramId !== programProjection.id) {
      throw new Error('reference-fit armature program identity mismatch');
    }
    if (report.plan?.requestedArmatureProgramId !== programProjection.id
        || JSON.stringify(report.plan?.armatureProgram) !== JSON.stringify(programProjection)) {
      throw new Error('reference-fit plan/program identity mismatch');
    }
  } else {
    programProjection = armatureProgramProjection(CRAWLER_ARMATURE_PROGRAM);
    if (JSON.stringify(report.parameterSpecs) !== JSON.stringify(programProjection.parameterSpecs)) {
      throw new Error('legacy reference-fit report is not the exact crawler vocabulary');
    }
  }
  const expectedCameraIds = REFERENCE_FIT_CAMERAS.map(camera => camera.id);
  if (JSON.stringify(report.requestedCameraIds) !== JSON.stringify(expectedCameraIds)
    || JSON.stringify(report.effectiveCameraIds) !== JSON.stringify(expectedCameraIds)) {
    throw new Error('effective camera coverage does not exactly match requested camera coverage');
  }
  assertReferenceFitCameraSplit({ fitViewIds: report.fitViewIds, heldOutViewIds: report.heldOutViewIds });
  if (typeof report.donor?.sha256 !== 'string' || !report.donor.sha256.startsWith('sha256:')) throw new Error('report requires donor hash');
  if (!Number.isInteger(report.donor?.triangleCount) || report.donor.triangleCount <= 0) throw new Error('report requires admitted donor triangles');
  if (JSON.stringify(report.parameterSpecs) !== JSON.stringify(programProjection.parameterSpecs)) {
    throw new Error('reference-fit parameter specification mismatch');
  }
  const parameterIds = programProjection.parameterSpecs.map(spec => spec.id);
  for (const field of ['initialParameters', 'fittedParameters']) {
    if (JSON.stringify(Object.keys(report[field] ?? {})) !== JSON.stringify(parameterIds)) {
      throw new Error(`${field} semantic parameter IDs drifted`);
    }
  }
  if (!report.metrics?.initial?.heldOut || !report.metrics?.fitted?.heldOut) throw new Error('report requires held-out metrics');
  const startedAt = Date.parse(report.timing?.startedAt);
  const finishedAt = Date.parse(report.timing?.finishedAt);
  const durationSeconds = Number(report.timing?.durationSeconds);
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt
    || !Number.isFinite(durationSeconds) || durationSeconds < 0
    || Math.abs(durationSeconds - (finishedAt - startedAt) / 1000) > 0.02) {
    throw new Error('report timing is missing, non-monotonic, or inconsistent');
  }
  if (report.acceptance?.heldOutSilhouetteImprovementCount < 3 || report.acceptance?.heldOutDepthImproved !== true) {
    throw new Error('report does not satisfy held-out acceptance predicate');
  }
  const evidenceIds = report.outputInventory?.donorEvidence?.map(item => item.cameraId);
  if (JSON.stringify(evidenceIds) !== JSON.stringify(expectedCameraIds)) throw new Error('donor evidence camera coverage mismatch');
  const artifacts = [report.outputInventory?.primaryWitness, report.outputInventory?.depthWitness];
  for (const artifact of artifacts) {
    if (typeof artifact?.path !== 'string' || !Number.isInteger(artifact.bytes) || artifact.bytes <= 0) throw new Error('report requires nonempty witness artifacts');
    if (requireFiles) {
      const artifactPath = resolveReportArtifactPath(artifact.path, reportPath);
      if (!existsSync(artifactPath)) throw new Error(`missing witness artifact: ${artifact.path}`);
      if (statSync(artifactPath).size !== artifact.bytes) throw new Error(`witness artifact byte drift: ${artifact.path}`);
    }
  }
  if (report.status === 'assay-passed-inspected') {
    const inspection = report.acceptance?.visualInspection;
    if (!inspection || inspection.disposition !== 'accepted' || !Array.isArray(inspection.artifacts) || inspection.artifacts.length !== 2) {
      throw new Error('inspected status requires accepted inspection disposition and artifact hashes');
    }
    for (let index = 0; index < artifacts.length; index += 1) {
      const expected = artifacts[index];
      const inspected = inspection.artifacts[index];
      if (inspected?.path !== expected.path || inspected?.bytes !== expected.bytes) {
        throw new Error(`inspection artifact inventory mismatch: ${expected.path}`);
      }
      if (typeof inspected.sha256 !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(inspected.sha256)) {
        throw new Error(`inspection artifact hash is missing or malformed: ${expected.path}`);
      }
      if (requireFiles) {
        const artifactPath = resolveReportArtifactPath(expected.path, reportPath);
        const currentHash = `sha256:${createHash('sha256').update(readFileSync(artifactPath)).digest('hex')}`;
        if (currentHash !== inspected.sha256) throw new Error(`inspection artifact hash mismatch: ${expected.path}`);
      }
    }
  }
  return report;
}

export async function recordReferenceFitVisualInspection({ reportPath, disposition, visibleDelta, limitations = [] }) {
  if (!['accepted', 'rejected'].includes(disposition)) throw new Error('visual inspection disposition must be accepted or rejected');
  if (typeof visibleDelta !== 'string' || visibleDelta.trim().length < 20) throw new Error('visual inspection requires a concrete visible delta');
  if (!Array.isArray(limitations)) throw new TypeError('visual inspection limitations must be an array');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  validateReferenceFitReport(report, { reportPath });
  const artifacts = [];
  for (const item of [report.outputInventory.primaryWitness, report.outputInventory.depthWitness]) {
    const artifactPath = resolveReportArtifactPath(item.path, reportPath);
    const bytes = await readFile(artifactPath);
    if (bytes.length !== item.bytes) throw new Error(`witness artifact byte drift: ${item.path}`);
    artifacts.push({
      path: item.path,
      bytes: bytes.length,
      sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    });
  }
  report.acceptance.visualInspection = {
    disposition,
    visibleDelta: visibleDelta.trim(),
    limitations: [...limitations],
    artifacts,
  };
  report.status = disposition === 'accepted' ? 'assay-passed-inspected' : 'assay-visual-rejected';
  report.lastTrustworthyEvidence = disposition === 'accepted'
    ? 'exact-camera residual witnesses visually inspected and accepted'
    : 'exact-camera residual witnesses visually inspected and rejected';
  await writeJsonAtomic(resolve(reportPath), report);
  if (disposition === 'accepted') validateReferenceFitReport(report, { reportPath });
  return report;
}

export async function runReferenceFittedArmatureAssay({
  donorPath,
  outDir,
  fitViewIds = ['az000', 'az090', 'az180', 'az270'],
  heldOutViewIds = ['az045', 'az135', 'az225', 'az315'],
  width = 40,
  height = 32,
  passes = 4,
  armatureProgram = CRAWLER_ARMATURE_PROGRAM,
} = {}) {
  const outputRoot = resolve(outDir);
  await mkdir(outputRoot, { recursive: true });
  const startedAtMs = Date.now();
  const reportPath = resolve(outputRoot, 'report.json');
  const report = {
    schema: 'kaminos.lirm-reference-fitted-armature-assay.v0',
    status: 'running',
    failurePhase: null,
    requestedRoute: REFERENCE_FIT_ROUTE,
    effectiveRoute: null,
    requestedArmatureProgramId: armatureProgram?.id ?? null,
    effectiveArmatureProgramId: null,
    armatureProgram: null,
    requestedCameraIds: REFERENCE_FIT_CAMERAS.map(camera => camera.id),
    effectiveCameraIds: null,
    requestedFitViewIds: Array.isArray(fitViewIds) ? [...fitViewIds] : fitViewIds,
    requestedHeldOutViewIds: Array.isArray(heldOutViewIds) ? [...heldOutViewIds] : heldOutViewIds,
    fitViewIds: null,
    heldOutViewIds: null,
    timing: { startedAt: new Date(startedAtMs).toISOString(), finishedAt: null, durationSeconds: null },
    lastTrustworthyEvidence: 'invocation arguments recorded; camera split not yet validated',
    outputInventory: { primaryWitness: null, depthWitness: null, donorEvidence: [] },
  };
  await writeJsonAtomic(reportPath, report);
  let activePhase = 'armature-program-validation';
  try {
    const { projection } = resolveArmatureProgram(armatureProgram);
    report.armatureProgram = projection;
    report.effectiveArmatureProgramId = projection.id;
    report.lastTrustworthyEvidence = 'armature program identity and parameter vocabulary validated; camera split not yet validated';
    activePhase = 'camera-split-validation';
    await writeJsonAtomic(reportPath, report);
    assertReferenceFitCameraSplit({ fitViewIds, heldOutViewIds });
    report.fitViewIds = [...fitViewIds];
    report.heldOutViewIds = [...heldOutViewIds];
    report.lastTrustworthyEvidence = 'camera split validated; donor not yet admitted';
    activePhase = 'donor-admission';
    await writeJsonAtomic(reportPath, report);
    if (!existsSync(donorPath)) throw new Error(`missing donor: ${donorPath}`);
    const donor = await loadGlbTriangleSoup(donorPath);
    report.donor = {
      path: resolve(donorPath), bytes: donor.bytes, sha256: donor.sha256,
      triangleCount: donor.triangleCount, sourceBounds: donor.sourceBounds, normalization: donor.normalization,
    };
    report.plan = createReferenceFitAssayPlan({
      donorPath,
      donorSha256: donor.sha256,
      fitViewIds,
      heldOutViewIds,
      armatureProgram,
    });
    report.lastTrustworthyEvidence = `${donor.triangleCount} donor triangles admitted and normalized`;
    activePhase = 'donor-evidence';
    await writeJsonAtomic(reportPath, report);

    const donorById = {};
    for (const camera of REFERENCE_FIT_CAMERAS) {
      donorById[camera.id] = rasterizeTriangleSoup({ triangles: donor.triangles, camera, width, height });
      const foreground = donorById[camera.id].mask.reduce((sum, item) => sum + item, 0);
      if (foreground < Math.max(8, width * height * 0.01)) throw new Error(`partial donor evidence for ${camera.id}: ${foreground} pixels`);
    }
    report.effectiveCameraIds = REFERENCE_FIT_CAMERAS.map(camera => camera.id);
    report.effectiveRoute = REFERENCE_FIT_ROUTE;
    report.lastTrustworthyEvidence = 'all eight exact-camera donor mask/depth views admitted';
    activePhase = 'fit-or-witness';
    await writeJsonAtomic(reportPath, report);

    const parameterSpecs = projection.parameterSpecs;
    const initialParameters = Object.fromEntries(parameterSpecs.map(spec => [spec.id, spec.initial]));
    const allViewIds = REFERENCE_FIT_CAMERAS.map(camera => camera.id);
    const initialById = renderViews(initialParameters, allViewIds, width, height, armatureProgram);
    const fit = fitReferenceArmature({ donorById, fitViewIds, width, height, armatureProgram, passes });
    const fittedById = renderViews(fit.parameters, allViewIds, width, height, armatureProgram);
    const initialFitMetrics = aggregateMetrics(fitViewIds, donorById, initialById);
    const fittedFitMetrics = aggregateMetrics(fitViewIds, donorById, fittedById);
    const initialHeldOutMetrics = aggregateMetrics(heldOutViewIds, donorById, initialById);
    const fittedHeldOutMetrics = aggregateMetrics(heldOutViewIds, donorById, fittedById);
    const heldOutSilhouetteImprovementCount = heldOutViewIds.filter(id => (
      fittedHeldOutMetrics.byView[id].iou > initialHeldOutMetrics.byView[id].iou + 1e-6
    )).length;
    const heldOutDepthImproved = fittedHeldOutMetrics.meanDepthMae < initialHeldOutMetrics.meanDepthMae;
    const boundPinnedParameters = parameterSpecs.filter(spec => (
      Math.abs(fit.parameters[spec.id] - spec.min) < 1e-8 || Math.abs(fit.parameters[spec.id] - spec.max) < 1e-8
    )).map(spec => spec.id);

    const silhouetteSheet = createWitnessSheet({ donorById, initialById, fittedById, width, height, mode: 'silhouette' });
    const depthSheet = createWitnessSheet({ donorById, initialById, fittedById, width, height, mode: 'depth' });
    const silhouettePath = resolve(outputRoot, 'silhouette-residual-witness.png');
    const depthPath = resolve(outputRoot, 'depth-residual-witness.png');
    await writeFile(silhouettePath, silhouetteSheet.bytes);
    await writeFile(depthPath, depthSheet.bytes);
    report.status = heldOutSilhouetteImprovementCount >= 3 && heldOutDepthImproved ? 'assay-passed-uninspected' : 'assay-missed-threshold-uninspected';
    report.initialParameters = initialParameters;
    report.fittedParameters = fit.parameters;
    report.parameterSpecs = parameterSpecs;
    report.optimization = { kind: 'deterministic-bounded-coordinate-search', passes, objective: fit.score, trace: fit.trace };
    report.metrics = { initial: { fit: initialFitMetrics, heldOut: initialHeldOutMetrics }, fitted: { fit: fittedFitMetrics, heldOut: fittedHeldOutMetrics } };
    report.acceptance = {
      heldOutSilhouetteImprovementCount,
      requiredHeldOutSilhouetteImprovementCount: 3,
      heldOutDepthImproved,
      boundPinnedParameters,
      semanticParameterIdsStable: true,
      visualInspection: 'pending',
    };
    report.outputInventory = {
      primaryWitness: { path: silhouettePath, bytes: silhouetteSheet.bytes.length, columns: ['donor', 'initial', 'fitted', 'fitted-overlay', 'initial-overlay'] },
      depthWitness: { path: depthPath, bytes: depthSheet.bytes.length, columns: ['donor', 'initial', 'fitted', 'fitted-depth-error', 'initial-depth-error'] },
      donorEvidence: allViewIds.map(id => ({ cameraId: id, kind: 'software-raster-mask-depth', width, height })),
    };
    report.falseClosureGuards = report.plan.falseClosureGuards;
    report.lastTrustworthyEvidence = 'fit and held-out metrics computed; visual witness written but not inspected';
    const finishedAtMs = Date.now();
    report.timing.finishedAt = new Date(finishedAtMs).toISOString();
    report.timing.durationSeconds = (finishedAtMs - startedAtMs) / 1000;
    if (report.status === 'assay-passed-uninspected') validateReferenceFitReport(report);
    await writeJsonAtomic(reportPath, report);
    return report;
  } catch (error) {
    report.status = 'failed';
    report.failurePhase = activePhase;
    report.error = String(error?.stack ?? error);
    const finishedAtMs = Date.now();
    report.timing.finishedAt = new Date(finishedAtMs).toISOString();
    report.timing.durationSeconds = (finishedAtMs - startedAtMs) / 1000;
    await writeJsonAtomic(reportPath, report);
    throw error;
  }
}
