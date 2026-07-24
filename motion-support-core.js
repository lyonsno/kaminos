const EPSILON = 1e-8;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function mix(start, end, t) {
  return start + (end - start) * t;
}

function requireFinite(value, label) {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`${label} must be finite`);
  return result;
}

function requireVector3(value, label) {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
    throw new Error(`${label} must be a three-component vector`);
  }
  const result = Array.from(value, Number);
  if (result.length !== 3 || result.some(component => !Number.isFinite(component))) {
    throw new Error(`${label} must be a finite three-component vector`);
  }
  return result;
}

function normalize3(value, fallback = [0, 1, 0]) {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length <= EPSILON) return [...fallback];
  return value.map(component => component / length);
}

function requireIdentity(identity, label) {
  const id = String(identity?.id || '');
  const sourceRef = String(identity?.sourceRef || '');
  const revision = String(identity?.revision || '');
  if (!id || !sourceRef || !revision) {
    throw new Error(`${label} requires id, sourceRef, and revision`);
  }
  return Object.freeze({ id, sourceRef, revision });
}

function validateSupportSample(sample, surface) {
  if (sample?.schema !== 'kaminos.sampled-support-sample.v0') {
    throw new Error('support surface sampler returned the wrong schema');
  }
  if (sample.surfaceId !== surface.identity.id || sample.surfaceRevision !== surface.identity.revision) {
    throw new Error('support surface sampler identity mismatch');
  }
  const world = requireVector3(sample.world, 'support sample world point');
  const normal = normalize3(requireVector3(sample.normal, 'support sample normal'));
  if (normal[1] <= EPSILON) throw new Error('support sample normal must face the admitted side');
  return {
    ...sample,
    world,
    height: world[1],
    normal,
    inBounds: sample.inBounds === true,
  };
}

export function createSampledSupportSurface(options = {}) {
  const identity = requireIdentity(options.identity, 'support surface identity');
  const sampleSpacing = requireFinite(options.sampleSpacing, 'support surface sample spacing');
  if (sampleSpacing <= EPSILON) throw new Error('support surface sample spacing must be positive');
  if (typeof options.sample !== 'function') throw new Error('support surface requires a sample function');
  const surface = {
    schema: 'kaminos.sampled-support-surface.v0',
    kind: String(options.kind || 'single-valued-heightfield'),
    authority: 'world-space-support-sampling',
    identity,
    sampleSpacing,
    bounds: options.bounds ? structuredClone(options.bounds) : null,
    sample(worldX, worldZ) {
      return validateSupportSample(options.sample(worldX, worldZ), surface);
    },
  };
  return Object.freeze(surface);
}

function requireSupportSurface(surface, expectedRevision) {
  if (surface?.schema !== 'kaminos.sampled-support-surface.v0' || typeof surface.sample !== 'function') {
    throw new Error('motion support requires a sampled support surface');
  }
  requireIdentity(surface.identity, 'support surface identity');
  if (expectedRevision && surface.identity.revision !== expectedRevision) {
    throw new Error(
      `support surface revision mismatch: expected ${expectedRevision}, got ${surface.identity.revision}`,
    );
  }
  if (!Number.isFinite(surface.sampleSpacing) || surface.sampleSpacing <= EPSILON) {
    throw new Error('support surface sample spacing must be positive');
  }
  return surface;
}

function requireFootprint(footprint) {
  if (footprint?.schema !== 'kaminos.motion-support-footprint.v0') {
    throw new Error('motion support requires a body support footprint');
  }
  if (!footprint.id || !footprint.registrationId) {
    throw new Error('body support footprint requires body and registration identity');
  }
  if (!Array.isArray(footprint.stations) || footprint.stations.length < 2) {
    throw new Error('body support footprint requires at least two stations');
  }
  return footprint;
}

function supportStations(surface, footprint, rootSurface, forward, right, corridorRadius) {
  const supportSampleSpacing = Math.max(EPSILON, surface.sampleSpacing * 0.75);
  const longitudinalIntervals = Math.max(
    1,
    Math.ceil(footprint.axialSpan * footprint.scale / supportSampleSpacing),
  );
  const stationByT = new Map();
  for (let index = 0; index <= longitudinalIntervals; index++) {
    const localZ = mix(footprint.tailZ, footprint.headZ, index / longitudinalIntervals);
    const t = (footprint.registrationTailZ - localZ) / footprint.registrationAxialSpan;
    stationByT.set(t.toFixed(9), {
      stationId: `support-${index}`,
      t,
      localZ,
    });
  }
  for (const station of footprint.stations) stationByT.set(station.t.toFixed(9), station);
  const stations = [...stationByT.values()].sort((a, b) => a.t - b.t);
  const lateralIntervals = corridorRadius > EPSILON
    ? Math.max(2, Math.ceil(corridorRadius * 2 / supportSampleSpacing))
    : 0;
  const lateralSamples = lateralIntervals > 0
    ? Array.from(
      { length: lateralIntervals + 1 },
      (_, index) => mix(-corridorRadius, corridorRadius, index / lateralIntervals),
    )
    : [0];
  return {
    supportSampleSpacing,
    stations: stations.map((station, supportIndex) => {
      const longitudinal = -station.localZ * footprint.scale;
      const centerX = rootSurface[0] + forward[0] * longitudinal;
      const centerZ = rootSurface[2] + forward[2] * longitudinal;
      const corridor = lateralSamples.map(lateral => surface.sample(
        centerX + right[0] * lateral,
        centerZ + right[2] * lateral,
      ));
      const terrainHeight = Math.max(...corridor.map(sample => sample.height));
      return {
        stationId: station.authored ? station.stationId : `support-${supportIndex}`,
        t: station.t,
        longitudinal,
        terrainHeight,
        requiredOffset: terrainHeight - rootSurface[1],
        inBounds: corridor.every(sample => sample.inBounds),
        corridor: corridor.map(sample => sample.world),
      };
    }),
  };
}

export function solveMotionSupportPrepass(surfaceInput, footprintInput, options = {}) {
  const surface = requireSupportSurface(surfaceInput, options.expectedSurfaceRevision);
  const footprint = requireFootprint(footprintInput);
  const id = String(options.id || '');
  if (!id) throw new Error('motion support prepass requires an id');
  const rootSurface = requireVector3(options.rootSurface, 'motion support root surface');
  const forwardInput = requireVector3(options.forward, 'motion support forward');
  const forward = normalize3([forwardInput[0], 0, forwardInput[2]], [0, 0, -1]);
  const right = [-forward[2], 0, forward[0]];
  const clearance = Math.max(0, Number(options.clearance) || 0.018);
  const lateralExcursion = Math.max(0, Number(options.lateralExcursion) || 0);
  const corridorRadius = footprint.halfWidth + lateralExcursion;
  const maxPitchRadians = clamp(
    Number(options.maxPitchRadians) || Math.PI / 5,
    0.05,
    Math.PI * 0.48,
  );
  const maxBendRadiansPerStation = clamp(
    Number(options.maxBendRadiansPerStation) || Math.PI / 10,
    0.02,
    Math.PI * 0.48,
  );
  const maxSuspensionLift = Math.max(
    0,
    Number(options.maxSuspensionLift) || 0.09 * footprint.scale,
  );
  const sampled = supportStations(
    surface,
    footprint,
    rootSurface,
    forward,
    right,
    corridorRadius,
  );
  const stations = sampled.stations.map(station => ({
    ...station,
    requiredOffset: station.requiredOffset + clearance,
  }));
  const maxPitchSlope = Math.tan(maxPitchRadians);
  const supportOffsets = stations.map(station => Math.max(...stations.map(sourceStation => (
    sourceStation.requiredOffset
      - maxPitchSlope * Math.abs(station.longitudinal - sourceStation.longitudinal)
  ))));
  const rootIndex = stations.findIndex(station => station.t >= 0.5);
  const rootLift = Math.max(0, supportOffsets[Math.max(0, rootIndex)]);
  const profile = stations.map((station, index) => ({
    stationId: station.stationId,
    t: station.t,
    localOffset: (supportOffsets[index] - rootLift) / footprint.scale,
    worldOffset: supportOffsets[index] - rootLift,
  }));
  let measuredPitch = 0;
  let measuredBend = 0;
  let previousSlope = null;
  for (let index = 0; index < supportOffsets.length - 1; index++) {
    const spacing = Math.max(
      EPSILON,
      stations[index + 1].longitudinal - stations[index].longitudinal,
    );
    const slope = (supportOffsets[index + 1] - supportOffsets[index]) / spacing;
    measuredPitch = Math.max(measuredPitch, Math.abs(Math.atan(slope)));
    if (previousSlope != null) {
      measuredBend = Math.max(
        measuredBend,
        Math.abs(Math.atan(slope) - Math.atan(previousSlope)),
      );
    }
    previousSlope = slope;
  }
  const maxEnvelopeLift = Math.max(
    ...stations.map((station, index) => supportOffsets[index] - station.requiredOffset),
  );
  const rootLiftAboveClearance = Math.max(0, rootLift - clearance);
  const outOfBounds = stations.some(station => !station.inBounds);
  const suspensionDemand = Math.max(maxEnvelopeLift, rootLiftAboveClearance);
  const normalizedMargin = (limit, measured) => {
    const margin = limit > EPSILON
      ? (limit - measured) / limit
      : measured <= EPSILON ? 0 : -1;
    return Math.abs(margin) < 1e-10 ? 0 : margin;
  };
  const margins = {
    bounds: outOfBounds ? -1 : 1,
    suspension: normalizedMargin(maxSuspensionLift, suspensionDemand),
    pitch: normalizedMargin(maxPitchRadians, measuredPitch),
    bend: normalizedMargin(maxBendRadiansPerStation, measuredBend),
  };
  const minimumNormalizedMargin = Math.min(...Object.values(margins));
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
    schema: 'kaminos.motion-support-prepass.v0',
    id,
    authority: 'world-space-support-only',
    supportSurface: { ...surface.identity },
    body: {
      id: footprint.id,
      registrationId: footprint.registrationId,
      scale: footprint.scale,
    },
    rootSurface,
    frame: {
      forward,
      right,
      up: [0, 1, 0],
    },
    support: {
      schema: 'kaminos.motion-support-envelope.v0',
      clearance,
      scale: footprint.scale,
      corridorRadius,
      supportSampleSpacing: sampled.supportSampleSpacing,
      terrainCellWidth: surface.sampleSpacing,
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
        margins,
        minimumNormalizedMargin,
      },
      plannerDisposition: exceeded ? 'reroute-required' : 'local-support',
    },
  };
}

function requirePrepass(prepass) {
  if (prepass?.schema !== 'kaminos.motion-support-prepass.v0') {
    throw new Error('motion contact requires a support prepass');
  }
  return prepass;
}

export function createMotionContactProbeRequest(prepassInput, contactAtlas, options = {}) {
  const prepass = requirePrepass(prepassInput);
  const id = String(options.id || '');
  const poseId = String(options.poseId || '');
  const phase = requireFinite(options.phase, 'motion contact phase');
  if (!id || !poseId) throw new Error('motion contact probe request requires id and poseId');
  if (!Array.isArray(contactAtlas?.patches) || contactAtlas.patches.length === 0) {
    throw new Error('motion contact probe request requires named contact patches');
  }
  const contactAtlasIdentity = {
    schema: String(contactAtlas.schema || ''),
    castId: String(contactAtlas.castId || ''),
    castHash: String(contactAtlas.castHash || ''),
    registrationHash: String(contactAtlas.registrationHash || ''),
  };
  if (Object.values(contactAtlasIdentity).some(value => !value)) {
    throw new Error('motion contact probe request requires exact contact atlas identity');
  }
  const seen = new Set();
  const patches = contactAtlas.patches.map(patch => {
    const patchId = String(patch?.id || '');
    if (!patchId || seen.has(patchId)) throw new Error('contact patch identity must be unique');
    seen.add(patchId);
    return {
      id: patchId,
      phaseOffset: requireFinite(patch.phaseOffset, `${patchId} phase offset`),
    };
  });
  return {
    schema: 'kaminos.motion-contact-probe-request.v0',
    id,
    authority: 'probe-request-only',
    prepassId: prepass.id,
    supportSurface: { ...prepass.supportSurface },
    body: { ...prepass.body },
    contactAtlas: contactAtlasIdentity,
    poseId,
    phase,
    patches,
  };
}

function requireSameIdentity(actual, expected, label) {
  if (
    actual?.id !== expected?.id
    || actual?.revision !== expected?.revision
    || (expected?.sourceRef && actual?.sourceRef !== expected.sourceRef)
  ) {
    throw new Error(`${label} mismatch`);
  }
}

export function validateMotionContactProbeSet(request, probeSet) {
  if (probeSet?.schema !== 'kaminos.motion-contact-probe-set.v0') {
    throw new Error('motion contact probe set schema mismatch');
  }
  if (probeSet.requestId !== request.id) throw new Error('motion contact probe request id mismatch');
  if (probeSet.prepassId !== request.prepassId) throw new Error('motion contact prepass id mismatch');
  requireSameIdentity(probeSet.supportSurface, request.supportSurface, 'motion contact support surface');
  if (
    probeSet.body?.id !== request.body.id
    || probeSet.body?.registrationId !== request.body.registrationId
    || probeSet.body?.scale !== request.body.scale
  ) {
    throw new Error('motion contact body identity mismatch');
  }
  if (probeSet.poseId !== request.poseId) throw new Error('motion contact pose identity mismatch');
  if (
    probeSet.contactAtlas?.schema !== request.contactAtlas.schema
    || probeSet.contactAtlas?.castId !== request.contactAtlas.castId
    || probeSet.contactAtlas?.castHash !== request.contactAtlas.castHash
    || probeSet.contactAtlas?.registrationHash !== request.contactAtlas.registrationHash
  ) {
    throw new Error('motion contact atlas identity mismatch');
  }
  if (Math.abs(requireFinite(probeSet.phase, 'motion contact probe phase') - request.phase) > 1e-9) {
    throw new Error('motion contact phase mismatch');
  }
  if (!Array.isArray(probeSet.patches) || probeSet.patches.length !== request.patches.length) {
    throw new Error('motion contact probe set requires exactly the requested patches');
  }
  const seen = new Set();
  const patches = probeSet.patches.map(patch => {
    const id = String(patch?.id || '');
    if (seen.has(id)) throw new Error(`motion contact probe set has duplicate patch ${id}`);
    seen.add(id);
    if (!request.patches.some(requested => requested.id === id)) {
      throw new Error(`motion contact probe set has mismatched patch ${id}`);
    }
    return { id, worldPosition: requireVector3(patch.worldPosition, `${id} probe world position`) };
  });
  for (const patch of request.patches) {
    if (!seen.has(patch.id)) throw new Error(`motion contact probe set missing patch ${patch.id}`);
  }
  return { ...probeSet, patches };
}

function contactStateAtPhase(phase, phaseOffset, options) {
  const stanceFraction = clamp(Number(options.stanceFraction) || 0.58, 0.4, 0.72);
  const releaseFraction = clamp(
    Number(options.releaseFraction) || 0.08,
    0.03,
    stanceFraction * 0.35,
  );
  const cycle = ((phase / (Math.PI * 2) + phaseOffset) % 1 + 1) % 1;
  return {
    cycle,
    state: cycle < stanceFraction - releaseFraction
      ? 'stance'
      : cycle < stanceFraction ? 'release' : 'swing',
  };
}

export function resolveMotionContactConstraints(
  surfaceInput,
  prepassInput,
  request,
  probeSetInput,
  options = {},
) {
  const surface = requireSupportSurface(surfaceInput, request?.supportSurface?.revision);
  const prepass = requirePrepass(prepassInput);
  if (request?.schema !== 'kaminos.motion-contact-probe-request.v0') {
    throw new Error('motion contact probe request schema mismatch');
  }
  if (request.prepassId !== prepass.id) throw new Error('motion contact prepass identity mismatch');
  requireSameIdentity(request.supportSurface, prepass.supportSurface, 'motion contact prepass surface');
  requireSameIdentity(surface.identity, request.supportSurface, 'motion contact runtime surface');
  const probeSet = validateMotionContactProbeSet(request, probeSetInput);
  const patches = request.patches.map(requestPatch => {
    const probe = probeSet.patches.find(candidate => candidate.id === requestPatch.id);
    const terrain = surface.sample(probe.worldPosition[0], probe.worldPosition[2]);
    if (!terrain.inBounds) {
      throw new Error(`${requestPatch.id} probe is outside the admitted support surface`);
    }
    const delta = probe.worldPosition.map((value, axis) => value - terrain.world[axis]);
    const signedDistance = delta.reduce(
      (sum, value, axis) => sum + value * terrain.normal[axis],
      0,
    );
    const contact = contactStateAtPhase(request.phase, requestPatch.phaseOffset, options);
    return {
      id: requestPatch.id,
      contactState: contact.state,
      cycle: contact.cycle,
      probeWorldPosition: [...probe.worldPosition],
      terrainPoint: [...terrain.world],
      terrainNormal: [...terrain.normal],
      signedDistance,
      inBounds: true,
    };
  });
  return {
    schema: 'kaminos.motion-contact-constraints.v0',
    id: `${request.id}:constraints`,
    authority: 'world-space-contact-resolution',
    requestId: request.id,
    prepassId: prepass.id,
    supportSurface: { ...surface.identity },
    body: { ...request.body },
    contactAtlas: { ...request.contactAtlas },
    poseId: request.poseId,
    phase: request.phase,
    patches,
  };
}
