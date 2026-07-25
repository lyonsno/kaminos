import {
  measureFingerFluidLiveInletReleasePlan,
  planFingerFluidLiveInletEconomics,
} from './finger-fluid-webgpu-core.js';

export const KAMINOS_FINGER_FLUID_ANALYTIC_CARRIER_SCHEMA =
  'kaminos.finger-fluid.analytic-pre-impact-carrier.v1';
export const KAMINOS_FINGER_FLUID_ANALYTIC_IMPACT_HANDOFF_SCHEMA =
  'kaminos.finger-fluid.analytic-impact-handoff.v1';
export const KAMINOS_FINGER_FLUID_ANALYTIC_OWNERSHIP_CONTRACT =
  'exclusive-material-interval-carrier-to-particles-v0';
export const KAMINOS_FINGER_FLUID_ANALYTIC_CARRIER_ROUTE =
  'kaminos.finger-fluid.analytic-ballistic-carrier.v0';

const LIVE_INLET_ECONOMICS_SCHEMA = 'kaminos.finger-fluid.live-inlet-economics.v1';
const LIVE_INLET_RELEASE_CONTRACT = 'gpu-dormant-pool-source-flux-release-v0';
const SUPPORT_IDENTITY_FIELDS = Object.freeze([
  'schema',
  'sourceId',
  'providerRoute',
  'artifactSha256',
  'terrainId',
  'terrainGeneration',
  'transformEpoch',
  'topologyEpoch',
  'supportEpoch',
  'remapEpoch',
]);
const SOURCE_IDENTITY_FIELDS = Object.freeze([
  'packetId',
  'sourceRoute',
  'artifactSha256',
  'handId',
  'fingerId',
  'inletId',
  'generation',
  'sourceMechanicsRevision',
]);

function contractError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw contractError('non_finite_contract_value', `${label} must be finite`, { label, value });
  }
  return number;
}

function positiveNumber(value, label) {
  const number = finiteNumber(value, label);
  if (number <= 0) {
    throw contractError('non_positive_contract_value', `${label} must be positive`, { label, value });
  }
  return number;
}

function nonNegativeNumber(value, label) {
  const number = finiteNumber(value, label);
  if (number < 0) {
    throw contractError('negative_contract_value', `${label} cannot be negative`, { label, value });
  }
  return number;
}

function exactSha256(value, label) {
  const digest = String(value ?? '');
  if (!/^[0-9a-f]{64}$/i.test(digest)) {
    throw contractError(
      'invalid_artifact_digest',
      `${label} must be an exact SHA-256 digest`,
      { label, value },
    );
  }
  return digest;
}

function finiteVector(value, label) {
  if (!Array.isArray(value) || value.length !== 3) {
    throw contractError('invalid_vector', `${label} must be a three-component array`, { label, value });
  }
  return Object.freeze(value.map((component, index) => finiteNumber(component, `${label}[${index}]`)));
}

function normalizeVector(value, label) {
  const vector = finiteVector(value, label);
  const length = Math.hypot(...vector);
  if (length <= Number.EPSILON) {
    throw contractError('zero_vector', `${label} must have non-zero length`, { label, value });
  }
  return Object.freeze(vector.map(component => component / length));
}

function finiteInterval(value, label) {
  if (!Array.isArray(value) || value.length !== 2) {
    throw contractError('invalid_interval', `${label} must be [start, end]`, { label, value });
  }
  const start = finiteNumber(value[0], `${label}[0]`);
  const end = finiteNumber(value[1], `${label}[1]`);
  if (end <= start) {
    throw contractError('empty_interval', `${label} end must be greater than start`, { label, value });
  }
  return Object.freeze([start, end]);
}

function normalizeSupportIdentity(value) {
  if (!value || typeof value !== 'object') {
    throw contractError('missing_support_identity', 'analytic carrier requires exact support identity');
  }
  const identity = {};
  for (const field of SUPPORT_IDENTITY_FIELDS) {
    if (value[field] === null || value[field] === undefined || value[field] === '') {
      throw contractError('partial_support_identity', `support identity is missing ${field}`, { field });
    }
    identity[field] = value[field];
  }
  for (const field of ['terrainGeneration', 'transformEpoch', 'topologyEpoch', 'supportEpoch', 'remapEpoch']) {
    const epoch = finiteNumber(identity[field], `support identity ${field}`);
    if (!Number.isSafeInteger(epoch) || epoch < 0) {
      throw contractError('invalid_support_epoch', `support identity ${field} must be a non-negative safe integer`, {
        field,
        value: identity[field],
      });
    }
    identity[field] = epoch;
  }
  identity.artifactSha256 = exactSha256(
    identity.artifactSha256,
    'support artifact SHA-256',
  );
  if (value.stale === true) {
    throw contractError('stale_support_identity', 'analytic carrier refuses stale support identity');
  }
  if (value.stale !== false) {
    throw contractError(
      'partial_support_identity',
      'support identity must explicitly attest stale false',
    );
  }
  if (value.fallbackRoute !== null) {
    throw contractError('fallback_support_route', 'analytic carrier refuses fallback support authority', {
      fallbackRoute: value.fallbackRoute,
    });
  }
  identity.stale = false;
  identity.fallbackRoute = null;
  return Object.freeze(identity);
}

function assertSameSupportIdentity(expected, actual) {
  const normalized = normalizeSupportIdentity(actual);
  const mismatches = SUPPORT_IDENTITY_FIELDS.filter(field => expected[field] !== normalized[field]);
  if (mismatches.length > 0) {
    throw contractError('stale_support_identity', 'support query identity differs from carrier-bound support', {
      mismatches,
      expected,
      actual: normalized,
    });
  }
  return normalized;
}

function assertSameSourceIdentity(expected, actual) {
  if (!expected || !actual) {
    throw contractError('partial_source_identity', 'analytic handoff source identity is missing');
  }
  const mismatches = SOURCE_IDENTITY_FIELDS.filter(field => expected[field] !== actual[field]);
  if (mismatches.length > 0) {
    throw contractError('source_identity_mismatch', 'impact source differs from carrier source', {
      mismatches,
      expected,
      actual,
    });
  }
  return actual;
}

function sameMaterial(expected, actual) {
  return expected?.id === actual?.id
    && Number(expected?.density) === Number(actual?.density)
    && JSON.stringify(expected?.chemistry ?? null) === JSON.stringify(actual?.chemistry ?? null);
}

function magnitude(vector) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function valuesNear(expected, actual, tolerance) {
  return Math.abs(expected - actual) <= tolerance;
}

function vectorsNear(expected, actual, tolerance) {
  return Array.isArray(expected)
    && Array.isArray(actual)
    && expected.length === 3
    && actual.length === 3
    && expected.every((value, index) => valuesNear(value, actual[index], tolerance));
}

function canonicalRecordsMatch(expected, actual) {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

function intervalsOverlap(a, b) {
  return Math.max(a[0], b[0]) < Math.min(a[1], b[1]);
}

function sampleSupport(query, position, worldTime) {
  if (typeof query?.sampleSignedDistance !== 'function') {
    throw contractError(
      'missing_support_query',
      'analytic first impact requires sampleSignedDistance(position, worldTime)',
    );
  }
  const sample = query.sampleSignedDistance(position, worldTime);
  const record = typeof sample === 'number' ? { distance: sample } : sample;
  if (!record || typeof record !== 'object') {
    throw contractError('partial_support_sample', 'support query returned no sample');
  }
  const distance = finiteNumber(record.distance, 'support signed distance');
  const point = record.point === undefined ? null : finiteVector(record.point, 'support point');
  const normal = record.normal === undefined ? null : normalizeVector(record.normal, 'support normal');
  return Object.freeze({ distance, point, normal });
}

export function createFingerFluidAnalyticJetDescriptor({
  packet,
  economics,
  releasePlan,
  publication,
  sourceMechanicsRevision,
  handId,
  fingerId,
  inletId,
  material,
  sourceTimeInterval,
  gravity = [0, -9.81, 0],
  supportIdentity,
  requestedRoute = KAMINOS_FINGER_FLUID_ANALYTIC_CARRIER_ROUTE,
  effectiveRoute = requestedRoute,
  fallbackRoute = null,
} = {}) {
  if (requestedRoute !== KAMINOS_FINGER_FLUID_ANALYTIC_CARRIER_ROUTE
    || effectiveRoute !== requestedRoute
    || fallbackRoute !== null) {
    throw contractError('fallback_carrier_route', 'analytic carrier route must be exact with explicit null fallback', {
      requestedRoute,
      effectiveRoute,
      fallbackRoute,
    });
  }
  if (economics?.schema !== LIVE_INLET_ECONOMICS_SCHEMA) {
    throw contractError('invalid_live_inlet_economics', 'analytic carrier requires canonical live-inlet economics');
  }
  if (releasePlan?.contract !== LIVE_INLET_RELEASE_CONTRACT) {
    throw contractError('invalid_live_inlet_release_plan', 'analytic carrier requires canonical live-inlet release plan');
  }
  const packetId = String(packet?.packet_id ?? packet?.packetId ?? '');
  const sourceRoute = String(packet?.route_identity ?? packet?.source_route ?? packet?.sourceRoute ?? '');
  const rawArtifactSha256 = packet?.artifact_sha256 ?? packet?.artifactSha256 ?? null;
  if (!packetId || !sourceRoute || !rawArtifactSha256) {
    throw contractError('partial_source_identity', 'analytic carrier requires packet, route, and artifact digest');
  }
  const artifactSha256 = exactSha256(rawArtifactSha256, 'source packet artifact SHA-256');
  if (
    economics.packetId !== packetId
    || economics.sourceRoute !== sourceRoute
    || economics.artifactSha256 !== artifactSha256
    || publication?.packetId !== packetId
    || publication?.sourceRoute !== sourceRoute
    || publication?.artifactSha256 !== artifactSha256
  ) {
    throw contractError('source_identity_mismatch', 'packet, economics, release plan, and publication identity differ', {
      packetId,
      sourceRoute,
      artifactSha256,
      economicsPacketId: economics.packetId,
      publication,
    });
  }
  if (releasePlan.economicsContract !== economics.contract) {
    throw contractError('source_economics_mismatch', 'release plan does not consume the supplied economics contract');
  }
  if (
    releasePlan.packetId !== packetId
    || releasePlan.sourceRoute !== sourceRoute
    || releasePlan.artifactSha256 !== artifactSha256
  ) {
    throw contractError('source_identity_mismatch', 'release plan does not belong to the supplied source packet', {
      expected: { packetId, sourceRoute, artifactSha256 },
      actual: {
        packetId: releasePlan.packetId,
        sourceRoute: releasePlan.sourceRoute,
        artifactSha256: releasePlan.artifactSha256,
      },
    });
  }
  if (
    !Number.isSafeInteger(economics.poolCapacity)
    || economics.poolCapacity <= 0
    || releasePlan.poolCapacity !== economics.poolCapacity
  ) {
    throw contractError(
      'source_economics_mismatch',
      'economics and release plan must share one positive canonical pool capacity',
      {
        economicsPoolCapacity: economics.poolCapacity,
        releasePlanPoolCapacity: releasePlan.poolCapacity,
      },
    );
  }
  const canonicalEconomics = planFingerFluidLiveInletEconomics(packet, economics.poolCapacity);
  const canonicalReleasePlan = measureFingerFluidLiveInletReleasePlan(
    packet,
    economics.poolCapacity,
  );
  if (
    !canonicalRecordsMatch(canonicalEconomics, economics)
    || !canonicalRecordsMatch(canonicalReleasePlan, releasePlan)
  ) {
    throw contractError(
      'source_economics_mismatch',
      'supplied economics and release plan differ from exact packet-derived canonical values',
    );
  }
  const generation = Number(publication?.generation);
  if (!Number.isSafeInteger(generation) || generation <= 0) {
    throw contractError('invalid_source_generation', 'analytic carrier requires a positive publication generation');
  }
  const inlet = canonicalEconomics.inlets?.find(candidate => candidate.id === inletId);
  const releaseInlet = canonicalReleasePlan.inlets?.find(candidate => candidate.id === inletId);
  if (!inlet || !releaseInlet || inlet.active !== true || releaseInlet.active !== true) {
    throw contractError('inactive_analytic_inlet', `analytic carrier inlet ${inletId} is not effectively active`);
  }
  const volumePerSecond = positiveNumber(releaseInlet.physicalSourceFlux, 'physical source flux');
  const density = positiveNumber(material?.density, 'material density');
  if (!material?.id) throw contractError('missing_material_identity', 'analytic carrier requires material id');
  const interval = finiteInterval(sourceTimeInterval, 'source time interval');
  const axis = normalizeVector(inlet.axis, 'inlet axis');
  const maximumSpeed = positiveNumber(inlet.maximumSpeed, 'inlet maximum speed');
  const sourceRevision = String(sourceMechanicsRevision || '');
  if (!/^[0-9a-f]{40}$/i.test(sourceRevision)) {
    throw contractError('invalid_source_mechanics_revision', 'source mechanics revision must be an exact Git SHA');
  }
  const support = normalizeSupportIdentity(supportIdentity);
  if (!handId || !fingerId || !inletId) {
    throw contractError(
      'partial_source_identity',
      'analytic carrier requires explicit hand, finger, and inlet identity',
    );
  }
  const materialRecord = Object.freeze({
    id: String(material.id),
    density,
    chemistry: Object.freeze([...(material.chemistry ?? [])].map(
      (value, index) => finiteNumber(value, `material chemistry[${index}]`),
    )),
  });
  return Object.freeze({
    schema: KAMINOS_FINGER_FLUID_ANALYTIC_CARRIER_SCHEMA,
    route: Object.freeze({
      requested: requestedRoute,
      effective: effectiveRoute,
      fallback: null,
    }),
    source: Object.freeze({
      packetId,
      sourceRoute,
      artifactSha256,
      handId: String(handId || ''),
      fingerId: String(fingerId || ''),
      inletId: String(inletId || ''),
      generation,
      sourceMechanicsRevision: sourceRevision,
    }),
    inlet: Object.freeze({
      origin: finiteVector(inlet.origin, 'inlet origin'),
      axis,
      tangent: normalizeVector(inlet.tangent, 'inlet tangent'),
      radius: positiveNumber(inlet.radius, 'inlet radius'),
      maximumSpeed,
      velocity: Object.freeze(axis.map(component => component * maximumSpeed)),
    }),
    gravity: finiteVector(gravity, 'gravity'),
    sourceTimeInterval: interval,
    flux: Object.freeze({
      volumePerSecond,
      particleVolume: positiveNumber(
        canonicalReleasePlan.particleVolume,
        'release-plan particle volume',
      ),
      particleReleaseRate: positiveNumber(
        releaseInlet.expectedParticleReleaseRate,
        'release-plan particle release rate',
      ),
      authority: inlet.effective.releaseAuthority,
    }),
    material: materialRecord,
    supportIdentity: support,
    opticalPolicyAuthority: 'consumer_owned_not_applied',
  });
}

export function sampleFingerFluidAnalyticJetAtTime(
  descriptor,
  flightSeconds,
  sourceEmissionTime = descriptor?.sourceTimeInterval?.[0],
) {
  if (descriptor?.schema !== KAMINOS_FINGER_FLUID_ANALYTIC_CARRIER_SCHEMA) {
    throw contractError('invalid_carrier_descriptor', 'analytic jet sample requires canonical descriptor');
  }
  const time = finiteNumber(flightSeconds, 'analytic flight seconds');
  if (time < 0) {
    throw contractError('negative_flight_time', 'analytic flight time cannot be negative', { flightSeconds });
  }
  sourceEmissionTime = finiteNumber(sourceEmissionTime, 'source emission time');
  if (
    sourceEmissionTime < descriptor.sourceTimeInterval[0]
    || sourceEmissionTime >= descriptor.sourceTimeInterval[1]
  ) {
    throw contractError(
      'source_emission_outside_history',
      'analytic jet sample emission time is outside active source history',
      { sourceEmissionTime, sourceTimeInterval: descriptor.sourceTimeInterval },
    );
  }
  const position = descriptor.inlet.origin.map((origin, axis) => (
    origin + descriptor.inlet.velocity[axis] * time + 0.5 * descriptor.gravity[axis] * time * time
  ));
  const velocity = descriptor.inlet.velocity.map(
    (component, axis) => component + descriptor.gravity[axis] * time,
  );
  return Object.freeze({
    flightSeconds: time,
    sourceEmissionTime,
    worldTime: sourceEmissionTime + time,
    position: Object.freeze(position),
    velocity: Object.freeze(velocity),
    volumeFlux: descriptor.flux.volumePerSecond,
    material: descriptor.material,
  });
}

export function measureFingerFluidAnalyticJetFirstImpact(descriptor, supportQuery, {
  maximumFlightSeconds = 2,
  bracketStepSeconds = 1 / 120,
  timeToleranceSeconds = 1e-6,
  sourceEmissionTime = descriptor?.sourceTimeInterval?.[0],
} = {}) {
  if (descriptor?.schema !== KAMINOS_FINGER_FLUID_ANALYTIC_CARRIER_SCHEMA) {
    throw contractError('invalid_carrier_descriptor', 'analytic first impact requires canonical descriptor');
  }
  const supportIdentity = assertSameSupportIdentity(
    descriptor.supportIdentity,
    supportQuery?.identity,
  );
  const maximumTime = positiveNumber(maximumFlightSeconds, 'maximum flight seconds');
  const bracketStep = positiveNumber(bracketStepSeconds, 'impact bracket step seconds');
  const tolerance = positiveNumber(timeToleranceSeconds, 'impact time tolerance seconds');
  const spatialLipschitz = positiveNumber(
    supportQuery?.maximumSpatialLipschitz,
    'support maximum spatial Lipschitz bound',
  );
  const signedDistanceRate = nonNegativeNumber(
    supportQuery?.maximumSignedDistanceRate,
    'support maximum signed-distance rate',
  );
  const maximumCarrierSpeed = (
    magnitude(descriptor.inlet.velocity)
    + magnitude(descriptor.gravity) * maximumTime
  );
  const maximumCombinedDistanceRate = positiveNumber(
    spatialLipschitz * maximumCarrierSpeed + signedDistanceRate,
    'combined carrier-to-support signed-distance rate',
  );
  const maximumUnresolvedDistance = positiveNumber(
    maximumCombinedDistanceRate * tolerance,
    'maximum unresolved impact distance',
  );
  const sampleAt = flightSeconds => {
    const jet = sampleFingerFluidAnalyticJetAtTime(descriptor, flightSeconds, sourceEmissionTime);
    const support = sampleSupport(supportQuery, jet.position, jet.worldTime);
    return { jet, support };
  };
  let previousTime = 0;
  let previous = sampleAt(previousTime);
  if (previous.support.distance <= 0) {
    throw contractError('carrier_starts_inside_support', 'analytic carrier source begins inside support');
  }
  let currentTime = 0;
  let current = previous;
  let resolution = 'signed_distance_crossing';
  while (
    current.support.distance > maximumUnresolvedDistance
    && currentTime < maximumTime
  ) {
    previousTime = currentTime;
    previous = current;
    const remaining = maximumTime - currentTime;
    const conservativeStep = Math.min(
      bracketStep,
      current.support.distance * 0.8 / maximumCombinedDistanceRate,
    );
    const nextTime = currentTime + Math.min(remaining, conservativeStep);
    if (nextTime === currentTime) {
      throw contractError(
        'conservative_advancement_stalled',
        'analytic first-impact advancement exhausted floating-point time resolution',
        { currentTime, signedDistance: current.support.distance },
      );
    }
    currentTime = nextTime;
    current = sampleAt(currentTime);
  }
  if (current.support.distance > maximumUnresolvedDistance) {
    throw contractError('no_first_support_hit', 'analytic carrier did not hit support within the flight horizon', {
      maximumFlightSeconds: maximumTime,
      finalSignedDistance: current.support.distance,
    });
  }
  let low = previousTime;
  let high = currentTime;
  if (current.support.distance > 0) {
    resolution = 'signed_distance_within_time_tolerance';
  } else {
    while (high - low > tolerance) {
      const middle = (low + high) * 0.5;
      const middleSample = sampleAt(middle);
      if (middleSample.support.distance > 0) {
        low = middle;
      } else {
        high = middle;
      }
    }
  }
  const hit = sampleAt(high);
  const point = hit.support.point ?? hit.jet.position;
  const normal = hit.support.normal;
  if (!normal) {
    throw contractError('partial_support_sample', 'first-hit support sample omitted its normal');
  }
  return Object.freeze({
    state: 'hit',
    source: descriptor.source,
    supportIdentity,
    sourceEmissionTime: hit.jet.sourceEmissionTime,
    flightSeconds: high,
    worldTime: hit.jet.worldTime,
    carrierCutParameter: high,
    carrierCutParameterization: 'flight_seconds',
    carrierPosition: hit.jet.position,
    point,
    normal,
    incomingVelocity: hit.jet.velocity,
    incomingVolumeFlux: descriptor.flux.volumePerSecond,
    signedDistance: hit.support.distance,
    bracket: Object.freeze([previousTime, currentTime]),
    stepping: Object.freeze({
      contract: 'signed-distance-spatiotemporal-conservative-advancement-v1',
      resolution,
      maximumSpatialLipschitz: spatialLipschitz,
      maximumSignedDistanceRate: signedDistanceRate,
      maximumCarrierSpeed,
      maximumCombinedDistanceRate,
      maximumUnresolvedDistance,
      maximumFlightSeconds: maximumTime,
      maximumStepSeconds: bracketStep,
      timeToleranceSeconds: tolerance,
    }),
  });
}

function revalidateFingerFluidAnalyticImpact(descriptor, impact, supportQuery) {
  if (impact?.state !== 'hit') {
    throw contractError('invalid_impact_receipt', 'analytic handoff requires the descriptor-bound first hit');
  }
  assertSameSourceIdentity(descriptor.source, impact.source);
  assertSameSupportIdentity(descriptor.supportIdentity, impact.supportIdentity);
  assertSameSupportIdentity(descriptor.supportIdentity, supportQuery?.identity);
  if (
    impact.stepping?.contract
    !== 'signed-distance-spatiotemporal-conservative-advancement-v1'
  ) {
    throw contractError('invalid_impact_receipt', 'impact omitted conservative first-hit evidence');
  }
  const canonicalImpact = measureFingerFluidAnalyticJetFirstImpact(descriptor, supportQuery, {
    maximumFlightSeconds: impact.stepping.maximumFlightSeconds,
    bracketStepSeconds: impact.stepping.maximumStepSeconds,
    timeToleranceSeconds: impact.stepping.timeToleranceSeconds,
    sourceEmissionTime: impact.sourceEmissionTime,
  });
  const canonicalStepping = canonicalImpact.stepping;
  const tolerance = 1e-6;
  if (
    !valuesNear(impact.sourceEmissionTime, canonicalImpact.sourceEmissionTime, tolerance)
    || !valuesNear(impact.flightSeconds, canonicalImpact.flightSeconds, tolerance)
    || !valuesNear(impact.worldTime, canonicalImpact.worldTime, tolerance)
    || !vectorsNear(impact.carrierPosition, canonicalImpact.carrierPosition, tolerance)
    || !vectorsNear(impact.incomingVelocity, canonicalImpact.incomingVelocity, tolerance)
    || !vectorsNear(impact.point, canonicalImpact.point, tolerance)
    || !vectorsNear(impact.normal, canonicalImpact.normal, tolerance)
    || !valuesNear(impact.signedDistance, canonicalImpact.signedDistance, tolerance)
    || impact.carrierCutParameterization !== 'flight_seconds'
    || !valuesNear(impact.carrierCutParameter, canonicalImpact.flightSeconds, tolerance)
    || impact.stepping.resolution !== canonicalStepping.resolution
    || impact.stepping.maximumSpatialLipschitz
      !== canonicalStepping.maximumSpatialLipschitz
    || impact.stepping.maximumSignedDistanceRate
      !== canonicalStepping.maximumSignedDistanceRate
    || impact.stepping.maximumCarrierSpeed !== canonicalStepping.maximumCarrierSpeed
    || impact.stepping.maximumCombinedDistanceRate
      !== canonicalStepping.maximumCombinedDistanceRate
    || impact.stepping.maximumUnresolvedDistance
      !== canonicalStepping.maximumUnresolvedDistance
    || impact.stepping.maximumFlightSeconds !== canonicalStepping.maximumFlightSeconds
    || impact.stepping.maximumStepSeconds !== canonicalStepping.maximumStepSeconds
    || impact.stepping.timeToleranceSeconds !== canonicalStepping.timeToleranceSeconds
  ) {
    throw contractError(
      'invalid_impact_receipt',
      'impact kinematics or support contact do not match the descriptor-bound support query',
      {
        suppliedFlightSeconds: impact.flightSeconds,
        canonicalFlightSeconds: canonicalImpact.flightSeconds,
      },
    );
  }
  return Object.freeze({
    sourceEmissionTime: canonicalImpact.sourceEmissionTime,
    flightSeconds: canonicalImpact.flightSeconds,
    worldTime: canonicalImpact.worldTime,
    carrierCutParameter: canonicalImpact.flightSeconds,
    carrierCutParameterization: 'flight_seconds',
    carrierPosition: canonicalImpact.carrierPosition,
    point: canonicalImpact.point,
    normal: canonicalImpact.normal,
    incomingVelocity: canonicalImpact.incomingVelocity,
    signedDistance: canonicalImpact.signedDistance,
    stepping: canonicalStepping,
  });
}

export function createFingerFluidAnalyticImpactHandoffReceipt({
  descriptor,
  impact,
  supportQuery,
  transitionGeneration,
  transitionInterval,
  particleAllocation,
  expectedParticleCount,
  predecessorReceiptId = null,
  carrierRetainedMaterialIntervals = [],
  tolerances = {},
} = {}) {
  if (descriptor?.schema !== KAMINOS_FINGER_FLUID_ANALYTIC_CARRIER_SCHEMA) {
    throw contractError('invalid_carrier_descriptor', 'analytic handoff requires canonical descriptor');
  }
  const validatedImpact = revalidateFingerFluidAnalyticImpact(descriptor, impact, supportQuery);
  const generation = Number(transitionGeneration);
  if (!Number.isSafeInteger(generation) || generation <= descriptor.source.generation) {
    throw contractError(
      'invalid_transition_generation',
      'transition generation must follow the source publication generation',
    );
  }
  const interval = finiteInterval(transitionInterval, 'transition interval');
  if (
    interval[0] < descriptor.sourceTimeInterval[0]
    || interval[1] > descriptor.sourceTimeInterval[1]
  ) {
    throw contractError('transition_outside_source_history', 'transition interval is outside active source history');
  }
  if (!valuesNear(interval[0], validatedImpact.sourceEmissionTime, 1e-9)) {
    throw contractError(
      'transition_impact_mismatch',
      'transition interval must begin at the source emission time measured at impact',
      {
        transitionStart: interval[0],
        sourceEmissionTime: validatedImpact.sourceEmissionTime,
      },
    );
  }
  const requiredParticleCount = Number(expectedParticleCount);
  if (!Number.isSafeInteger(requiredParticleCount) || requiredParticleCount <= 0) {
    throw contractError(
      'partial_particle_allocation',
      'expected particle count must be an explicit positive safe integer',
      { expectedParticleCount },
    );
  }
  const particleIds = particleAllocation?.particleIds;
  const velocities = particleAllocation?.velocities;
  if (!Array.isArray(particleIds) || !Array.isArray(velocities)) {
    throw contractError('partial_particle_allocation', 'particle allocation requires ids and velocities');
  }
  if (
    particleIds.length !== requiredParticleCount
    || velocities.length !== requiredParticleCount
    || new Set(particleIds).size !== particleIds.length
  ) {
    throw contractError('partial_particle_allocation', 'particle allocation is partial or has duplicate ids', {
      expectedParticleCount: requiredParticleCount,
      particleIdCount: particleIds.length,
      velocityCount: velocities.length,
    });
  }
  if (!particleAllocation?.allocationId) {
    throw contractError('partial_particle_allocation', 'particle allocation identity is missing');
  }
  if (!sameMaterial(descriptor.material, particleAllocation.material)) {
    throw contractError('material_identity_mismatch', 'particle allocation changed transferred material');
  }
  const retainedIntervals = carrierRetainedMaterialIntervals.map(
    (retained, index) => finiteInterval(retained, `carrier retained interval ${index}`),
  );
  if (retainedIntervals.some(retained => intervalsOverlap(retained, interval))) {
    throw contractError(
      'duplicate_material_ownership',
      'carrier and particles both claim the transferred material interval',
      { transitionInterval: interval, carrierRetainedMaterialIntervals: retainedIntervals },
    );
  }
  const duration = interval[1] - interval[0];
  const transferVolume = descriptor.flux.volumePerSecond * duration;
  const transferMass = transferVolume * descriptor.material.density;
  const expectedMomentum = validatedImpact.incomingVelocity.map(component => component * transferMass);
  const particleVolume = positiveNumber(particleAllocation.particleVolume, 'particle allocation volume');
  if (!valuesNear(particleVolume, descriptor.flux.particleVolume, 1e-12)) {
    throw contractError(
      'particle_allocation_volume_mismatch',
      'particle allocation volume differs from the canonical release-plan particle volume',
      { expected: descriptor.flux.particleVolume, actual: particleVolume },
    );
  }
  const countImpliedByVolume = transferVolume / descriptor.flux.particleVolume;
  if (
    !valuesNear(countImpliedByVolume, requiredParticleCount, 1e-6)
  ) {
    throw contractError(
      'partial_particle_allocation',
      'transition interval volume does not match the explicit canonical particle count',
      { requiredParticleCount, countImpliedByVolume, transferVolume },
    );
  }
  const introducedVolume = particleIds.length * particleVolume;
  const introducedMomentum = [0, 0, 0];
  const canonicalParticleVelocityTolerance = Math.max(
    1e-7,
    magnitude(validatedImpact.incomingVelocity) * 1e-6,
  );
  const introducedVelocities = [];
  velocities.forEach((velocity, particleIndex) => {
    const safeVelocity = finiteVector(velocity, `particle velocity ${particleIndex}`);
    if (!vectorsNear(
      validatedImpact.incomingVelocity,
      safeVelocity,
      canonicalParticleVelocityTolerance,
    )) {
      throw contractError(
        'noncanonical_particle_velocity',
        'particle introduction velocity differs from the descriptor-bound impact velocity',
        {
          particleIndex,
          expected: validatedImpact.incomingVelocity,
          actual: safeVelocity,
          tolerance: canonicalParticleVelocityTolerance,
        },
      );
    }
    introducedVelocities.push(safeVelocity);
    for (let axis = 0; axis < 3; axis += 1) {
      introducedMomentum[axis] += safeVelocity[axis] * descriptor.material.density * particleVolume;
    }
  });
  const volumeResidualAbsolute = Math.abs(introducedVolume - transferVolume);
  const momentumResidual = introducedMomentum.map(
    (component, axis) => component - expectedMomentum[axis],
  );
  const momentumResidualMagnitude = magnitude(momentumResidual);
  const volumeTolerance = tolerances.volumeAbsolute === undefined
    ? Math.max(1e-9, transferVolume * 1e-5)
    : positiveNumber(tolerances.volumeAbsolute, 'volume residual tolerance');
  const momentumTolerance = tolerances.momentumAbsolute === undefined
    ? Math.max(1e-8, magnitude(expectedMomentum) * 1e-5)
    : positiveNumber(tolerances.momentumAbsolute, 'momentum residual tolerance');
  if (volumeResidualAbsolute > volumeTolerance || momentumResidualMagnitude > momentumTolerance) {
    throw contractError('conservation_failure', 'analytic-to-particle transfer exceeded conservation tolerance', {
      transferVolume,
      introducedVolume,
      volumeResidualAbsolute,
      volumeTolerance,
      expectedMomentum,
      introducedMomentum,
      momentumResidualMagnitude,
      momentumTolerance,
    });
  }
  const receiptId = [
    descriptor.source.packetId,
    descriptor.source.inletId,
    descriptor.source.generation,
    generation,
    interval[0].toFixed(9),
    interval[1].toFixed(9),
  ].join(':');
  const receipt = Object.freeze({
    schema: KAMINOS_FINGER_FLUID_ANALYTIC_IMPACT_HANDOFF_SCHEMA,
    state: 'transferred',
    receiptId,
    predecessorReceiptId,
    successorReceiptId: receiptId,
    source: descriptor.source,
    supportIdentity: descriptor.supportIdentity,
    impact: Object.freeze({
      evidenceAuthority: 'producer_canonical_descriptor_bound_remeasurement',
      detachedValidationScope: 'structural_consistency_not_live_support_remeasurement',
      point: validatedImpact.point,
      normal: validatedImpact.normal,
      carrierPosition: validatedImpact.carrierPosition,
      sourceEmissionTime: validatedImpact.sourceEmissionTime,
      worldTime: validatedImpact.worldTime,
      flightSeconds: validatedImpact.flightSeconds,
      carrierCutParameter: validatedImpact.carrierCutParameter,
      carrierCutParameterization: validatedImpact.carrierCutParameterization,
      incomingVelocity: validatedImpact.incomingVelocity,
      signedDistance: validatedImpact.signedDistance,
      stepping: validatedImpact.stepping,
    }),
    transfer: Object.freeze({
      transitionGeneration: generation,
      interval,
      arrivalInterval: Object.freeze([
        interval[0] + validatedImpact.flightSeconds,
        interval[1] + validatedImpact.flightSeconds,
      ]),
      duration,
      volume: transferVolume,
      mass: transferMass,
      momentum: Object.freeze(expectedMomentum),
      material: descriptor.material,
      particleAllocationId: String(particleAllocation.allocationId),
      particleIds: Object.freeze([...particleIds]),
      particleCount: particleIds.length,
      particleVolume,
      particleVelocities: Object.freeze(introducedVelocities),
      particleVelocityTolerance: canonicalParticleVelocityTolerance,
      introducedVolume,
      introducedMomentum: Object.freeze(introducedMomentum),
    }),
    ownership: Object.freeze({
      contract: KAMINOS_FINGER_FLUID_ANALYTIC_OWNERSHIP_CONTRACT,
      transferredInterval: interval,
      carrierRetainedMaterialIntervals: Object.freeze(retainedIntervals),
      carrierOwnsTransferredInterval: false,
      particlesOwnTransferredInterval: true,
      analyticVisibleBeforeImpact: true,
      analyticVisibleAfterImpact: false,
      canonicalParticlesVisibleBeforeImpact: false,
      canonicalParticlesVisibleAfterImpact: true,
    }),
    conservation: Object.freeze({
      volumeResidualAbsolute,
      momentumResidual: Object.freeze(momentumResidual),
      momentumResidualMagnitude,
      tolerances: Object.freeze({
        volumeAbsolute: volumeTolerance,
        momentumAbsolute: momentumTolerance,
      }),
      valid: true,
    }),
  });
  validateFingerFluidAnalyticImpactHandoffReceipt(receipt);
  return receipt;
}

export function validateFingerFluidAnalyticImpactHandoffReceipt(receipt) {
  if (receipt?.schema !== KAMINOS_FINGER_FLUID_ANALYTIC_IMPACT_HANDOFF_SCHEMA) {
    throw contractError('invalid_handoff_schema', 'analytic impact handoff schema is invalid');
  }
  if (receipt.state !== 'transferred') {
    throw contractError('partial_handoff', 'analytic impact handoff did not reach transferred state');
  }
  if (
    receipt.impact?.evidenceAuthority
      !== 'producer_canonical_descriptor_bound_remeasurement'
    || receipt.impact?.detachedValidationScope
      !== 'structural_consistency_not_live_support_remeasurement'
  ) {
    throw contractError(
      'invalid_impact_receipt',
      'detached handoff misstates first-impact evidence authority',
    );
  }
  let impactNormal;
  try {
    finiteVector(receipt.impact?.point, 'receipt impact point');
    impactNormal = finiteVector(receipt.impact?.normal, 'receipt impact normal');
    finiteVector(receipt.impact?.carrierPosition, 'receipt impact carrier position');
  } catch (error) {
    throw contractError(
      'invalid_impact_receipt',
      'detached handoff impact geometry is malformed',
      { causeCode: error?.code },
    );
  }
  if (!valuesNear(magnitude(impactNormal), 1, 1e-6)) {
    throw contractError(
      'invalid_impact_receipt',
      'detached handoff impact normal must be normalized',
    );
  }
  const impactStepping = receipt.impact?.stepping;
  if (
    impactStepping?.contract
      !== 'signed-distance-spatiotemporal-conservative-advancement-v1'
    || (
      impactStepping.resolution !== 'signed_distance_crossing'
      && impactStepping.resolution !== 'signed_distance_within_time_tolerance'
    )
  ) {
    throw contractError(
      'invalid_impact_receipt',
      'detached handoff omitted canonical first-impact stepping evidence',
    );
  }
  const maximumSpatialLipschitz = positiveNumber(
    impactStepping.maximumSpatialLipschitz,
    'receipt support maximum spatial Lipschitz bound',
  );
  const maximumSignedDistanceRate = nonNegativeNumber(
    impactStepping.maximumSignedDistanceRate,
    'receipt support maximum signed-distance rate',
  );
  const maximumCarrierSpeed = positiveNumber(
    impactStepping.maximumCarrierSpeed,
    'receipt maximum carrier speed',
  );
  const maximumCombinedDistanceRate = positiveNumber(
    impactStepping.maximumCombinedDistanceRate,
    'receipt maximum combined distance rate',
  );
  const timeToleranceSeconds = positiveNumber(
    impactStepping.timeToleranceSeconds,
    'receipt impact time tolerance',
  );
  positiveNumber(
    impactStepping.maximumFlightSeconds,
    'receipt maximum flight seconds',
  );
  positiveNumber(
    impactStepping.maximumStepSeconds,
    'receipt maximum impact step seconds',
  );
  const maximumUnresolvedDistance = positiveNumber(
    impactStepping.maximumUnresolvedDistance,
    'receipt maximum unresolved distance',
  );
  const signedDistance = finiteNumber(
    receipt.impact?.signedDistance,
    'receipt impact signed distance',
  );
  if (
    maximumCombinedDistanceRate
      !== maximumSpatialLipschitz * maximumCarrierSpeed + maximumSignedDistanceRate
    || maximumUnresolvedDistance !== maximumCombinedDistanceRate * timeToleranceSeconds
    || (
      impactStepping.resolution === 'signed_distance_crossing'
      && signedDistance > 0
    )
    || (
      impactStepping.resolution === 'signed_distance_within_time_tolerance'
      && (signedDistance <= 0 || signedDistance > maximumUnresolvedDistance)
    )
  ) {
    throw contractError(
      'invalid_impact_receipt',
      'detached first-impact stepping evidence is internally inconsistent',
    );
  }
  if (
    receipt.ownership?.contract !== KAMINOS_FINGER_FLUID_ANALYTIC_OWNERSHIP_CONTRACT
    || receipt.ownership.carrierOwnsTransferredInterval !== false
    || receipt.ownership.particlesOwnTransferredInterval !== true
    || receipt.ownership.analyticVisibleBeforeImpact !== true
    || receipt.ownership.analyticVisibleAfterImpact !== false
    || receipt.ownership.canonicalParticlesVisibleBeforeImpact !== false
    || receipt.ownership.canonicalParticlesVisibleAfterImpact !== true
  ) {
    throw contractError('duplicate_material_ownership', 'handoff ownership is not exclusive');
  }
  const interval = finiteInterval(receipt.transfer?.interval, 'receipt transfer interval');
  if (
    !Array.isArray(receipt.ownership?.transferredInterval)
    || receipt.ownership.transferredInterval.length !== 2
    || !valuesNear(receipt.ownership.transferredInterval[0], interval[0], 1e-12)
    || !valuesNear(receipt.ownership.transferredInterval[1], interval[1], 1e-12)
    || !Array.isArray(receipt.ownership.carrierRetainedMaterialIntervals)
  ) {
    throw contractError(
      'duplicate_material_ownership',
      'detached ownership ledger does not exactly bind the transferred interval',
    );
  }
  const retained = receipt.ownership.carrierRetainedMaterialIntervals;
  if (retained.some(candidate => intervalsOverlap(finiteInterval(candidate, 'retained interval'), interval))) {
    throw contractError('duplicate_material_ownership', 'receipt retains transferred carrier material');
  }
  const transferVolume = positiveNumber(receipt.transfer?.volume, 'receipt transfer volume');
  const transferMass = positiveNumber(receipt.transfer?.mass, 'receipt transfer mass');
  const particleVolume = positiveNumber(
    receipt.transfer?.particleVolume,
    'receipt particle volume',
  );
  const transferMomentum = finiteVector(receipt.transfer?.momentum, 'receipt transfer momentum');
  const introducedMomentum = finiteVector(
    receipt.transfer?.introducedMomentum,
    'receipt introduced momentum',
  );
  const particleCount = Number(receipt.transfer?.particleCount);
  if (!Number.isSafeInteger(particleCount) || particleCount <= 0) {
    throw contractError('partial_particle_allocation', 'receipt particle count must be a positive safe integer');
  }
  const introducedVolume = particleCount * particleVolume;
  const volumeResidual = Math.abs(introducedVolume - transferVolume);
  const momentumResidualVector = introducedMomentum.map(
    (component, axis) => component - transferMomentum[axis],
  );
  const momentumResidual = magnitude(momentumResidualVector);
  const volumeTolerance = positiveNumber(
    receipt.conservation?.tolerances?.volumeAbsolute,
    'receipt volume residual tolerance',
  );
  const momentumTolerance = positiveNumber(
    receipt.conservation?.tolerances?.momentumAbsolute,
    'receipt momentum residual tolerance',
  );
  if (
    receipt.conservation?.valid !== true
    || !valuesNear(receipt.transfer?.introducedVolume, introducedVolume, 1e-12)
    || !valuesNear(receipt.conservation?.volumeResidualAbsolute, volumeResidual, 1e-12)
    || !vectorsNear(
      receipt.conservation?.momentumResidual,
      momentumResidualVector,
      1e-12,
    )
    || !valuesNear(receipt.conservation?.momentumResidualMagnitude, momentumResidual, 1e-12)
    || volumeResidual > volumeTolerance
    || momentumResidual > momentumTolerance
  ) {
    throw contractError('conservation_failure', 'receipt does not satisfy conservation tolerances');
  }
  if (
    !receipt.source?.packetId
    || !receipt.source?.sourceRoute
    || !receipt.source?.handId
    || !receipt.source?.fingerId
    || !receipt.source?.inletId
    || !Number.isSafeInteger(receipt.source?.generation)
    || receipt.source.generation <= 0
    || !/^[0-9a-f]{40}$/i.test(receipt.source?.sourceMechanicsRevision)
  ) {
    throw contractError('partial_source_identity', 'handoff receipt source identity is partial');
  }
  exactSha256(receipt.source.artifactSha256, 'receipt source artifact SHA-256');
  normalizeSupportIdentity(receipt.supportIdentity);
  const transitionGeneration = Number(receipt.transfer?.transitionGeneration);
  if (
    !Number.isSafeInteger(transitionGeneration)
    || transitionGeneration <= receipt.source.generation
  ) {
    throw contractError(
      'invalid_transition_generation',
      'receipt transition generation must follow the source publication generation',
    );
  }
  const canonicalReceiptId = [
    receipt.source.packetId,
    receipt.source.inletId,
    receipt.source.generation,
    transitionGeneration,
    interval[0].toFixed(9),
    interval[1].toFixed(9),
  ].join(':');
  if (
    receipt.receiptId !== canonicalReceiptId
    || receipt.successorReceiptId !== canonicalReceiptId
  ) {
    throw contractError(
      'invalid_receipt_identity',
      'detached receipt identity does not match its exact source transition',
    );
  }
  const duration = interval[1] - interval[0];
  const sourceEmissionTime = finiteNumber(
    receipt.impact?.sourceEmissionTime,
    'receipt impact source emission time',
  );
  const flightSeconds = finiteNumber(
    receipt.impact?.flightSeconds,
    'receipt impact flight seconds',
  );
  const worldTime = finiteNumber(
    receipt.impact?.worldTime,
    'receipt impact world time',
  );
  const carrierCutParameter = finiteNumber(
    receipt.impact?.carrierCutParameter,
    'receipt impact carrier cut parameter',
  );
  if (
    !valuesNear(worldTime, sourceEmissionTime + flightSeconds, 1e-12)
    || receipt.impact?.carrierCutParameterization !== 'flight_seconds'
    || !valuesNear(carrierCutParameter, flightSeconds, 1e-12)
  ) {
    throw contractError(
      'invalid_impact_receipt',
      'detached impact timing or carrier cut metadata is inconsistent',
    );
  }
  const arrivalInterval = receipt.transfer?.arrivalInterval;
  if (
    !valuesNear(sourceEmissionTime, interval[0], 1e-12)
    || !valuesNear(receipt.transfer?.duration, duration, 1e-12)
    || !Array.isArray(arrivalInterval)
    || arrivalInterval.length !== 2
    || !valuesNear(arrivalInterval[0], interval[0] + flightSeconds, 1e-12)
    || !valuesNear(arrivalInterval[1], interval[1] + flightSeconds, 1e-12)
  ) {
    throw contractError(
      'transition_impact_mismatch',
      'detached transition timing does not match the source impact cohort',
    );
  }
  if (
    !Array.isArray(receipt.transfer?.particleIds)
    || receipt.transfer.particleIds.length !== receipt.transfer.particleCount
    || new Set(receipt.transfer.particleIds).size !== receipt.transfer.particleIds.length
    || receipt.transfer.particleIds.some(
      particleId => !Number.isSafeInteger(particleId) || particleId < 0,
    )
  ) {
    throw contractError('partial_particle_allocation', 'handoff receipt particle allocation is partial');
  }
  if (!receipt.transfer?.particleAllocationId) {
    throw contractError('partial_particle_allocation', 'handoff receipt particle allocation identity is missing');
  }
  const particleVelocityTolerance = positiveNumber(
    receipt.transfer?.particleVelocityTolerance,
    'receipt particle velocity tolerance',
  );
  if (
    !Array.isArray(receipt.transfer?.particleVelocities)
    || receipt.transfer.particleVelocities.length !== particleCount
    || receipt.transfer.particleVelocities.some(
      velocity => !vectorsNear(receipt.impact?.incomingVelocity, velocity, particleVelocityTolerance),
    )
  ) {
    throw contractError(
      'noncanonical_particle_velocity',
      'detached particle introduction velocities differ from impact kinematics',
    );
  }
  const materialDensity = positiveNumber(
    receipt.transfer?.material?.density,
    'receipt material density',
  );
  if (!valuesNear(transferMass, transferVolume * materialDensity, 1e-12)) {
    throw contractError('conservation_failure', 'receipt transfer mass does not match volume and material');
  }
  if (
    !vectorsNear(
      transferMomentum,
      receipt.impact?.incomingVelocity?.map(component => component * transferMass),
      1e-10,
    )
  ) {
    throw contractError('conservation_failure', 'receipt transfer momentum does not match impact kinematics');
  }
  return true;
}
