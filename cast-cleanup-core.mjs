import { createHash } from 'node:crypto';

export const CAST_CLEANUP_SPEC_SCHEMA = 'kaminos.cast-cleanup-spec.v0';
export const CAST_CLEANUP_REPORT_SCHEMA = 'kaminos.cast-cleanup-report.v0';
export const CAST_CLEANUP_ROUTE_ID = 'kaminos_blender_cast_cleanup';
export const CAST_CLEANUP_WORKER_ID = 'blender-cast-cleanup-v0';
export const CAST_CLEANUP_VIEW_IDS = Object.freeze(['left', 'right', 'front', 'rear']);

const PROFILE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'gentle',
    voxelSizeToMaxExtent: 0.003,
    smoothIterations: 2,
    smoothFactor: 0.2,
  }),
  Object.freeze({
    id: 'balanced',
    voxelSizeToMaxExtent: 0.0045,
    smoothIterations: 4,
    smoothFactor: 0.24,
  }),
  Object.freeze({
    id: 'strong',
    voxelSizeToMaxExtent: 0.0065,
    smoothIterations: 6,
    smoothFactor: 0.28,
  }),
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  if (typeof value === 'number' && Object.is(value, -0)) return 0;
  return value;
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function requireHash(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive integer`);
  return value;
}

function requireBounds(bounds, label) {
  requireObject(bounds, label);
  for (const key of ['min', 'max', 'extent']) {
    if (!Array.isArray(bounds[key]) || bounds[key].length !== 3 || bounds[key].some(value => !Number.isFinite(value))) {
      throw new TypeError(`${label}.${key} must contain three finite numbers`);
    }
  }
  if (bounds.extent.some(value => value <= 0)) throw new TypeError(`${label}.extent must be positive`);
  return structuredClone(bounds);
}

function requireSourceGeometry(geometry) {
  requireObject(geometry, 'source geometry');
  return {
    vertexCount: requirePositiveInteger(geometry.vertexCount, 'source geometry vertex count'),
    triangleCount: requirePositiveInteger(geometry.triangleCount, 'source geometry triangle count'),
    connectedComponentCount: requirePositiveInteger(
      geometry.connectedComponentCount,
      'source geometry connected component count',
    ),
    bounds: requireBounds(geometry.bounds, 'source geometry bounds'),
  };
}

export function buildCastCleanupSpec({
  sourcePath,
  sourceSha256,
  sourceByteLength,
  sourceGeometry,
  blenderScriptPath,
  blenderScriptSha256,
  outputDirectory,
}) {
  const geometry = requireSourceGeometry(sourceGeometry);
  const maxExtent = Math.max(...geometry.bounds.extent);
  const specCore = canonical({
    schema: CAST_CLEANUP_SPEC_SCHEMA,
    routeId: CAST_CLEANUP_ROUTE_ID,
    source: {
      path: requireString(sourcePath, 'source path'),
      sha256: requireHash(sourceSha256, 'source hash'),
      byteLength: requirePositiveInteger(sourceByteLength, 'source byte length'),
      geometry,
    },
    worker: {
      id: CAST_CLEANUP_WORKER_ID,
      path: requireString(blenderScriptPath, 'Blender worker path'),
      sha256: requireHash(blenderScriptSha256, 'Blender worker hash'),
    },
    outputDirectory: requireString(outputDirectory, 'output directory'),
    profiles: PROFILE_DEFINITIONS.map(profile => ({
      ...profile,
      voxelSize: maxExtent * profile.voxelSizeToMaxExtent,
      componentPolicy: 'largest-connected-surface',
      renderViews: [...CAST_CLEANUP_VIEW_IDS],
    })),
    claimCeiling: 'cleaned-temporary-deformation-carrier',
    sourceMutation: 'forbidden-copy-on-write',
  });
  return { ...specCore, specSha256: hashJson(specCore) };
}

function requireRouteIdentity(report, spec) {
  const requested = requireObject(report.requestedRoute, 'requested route');
  const effective = requireObject(report.effectiveRoute, 'effective route');
  if (requested.id !== CAST_CLEANUP_ROUTE_ID) throw new Error('requested route id mismatch');
  if (requested.sourcePath !== spec.source.path) throw new Error('requested source path mismatch');
  if (requested.sourceSha256 !== spec.source.sha256) throw new Error('requested source hash mismatch');
  if (requested.specSha256 !== spec.specSha256) throw new Error('requested spec hash mismatch');
  if (effective.id !== spec.worker.id) throw new Error('effective worker id mismatch');
  if (effective.sourcePath !== spec.source.path) throw new Error('effective source path mismatch');
  if (effective.sourceSha256 !== spec.source.sha256) throw new Error('effective source hash mismatch');
  if (effective.scriptPath !== spec.worker.path) throw new Error('effective worker path mismatch');
  if (effective.scriptSha256 !== spec.worker.sha256) throw new Error('effective worker hash mismatch');
  if (effective.specSha256 !== spec.specSha256) throw new Error('effective spec hash mismatch');
  requireString(effective.blenderVersion, 'effective Blender version');
}

function validateOutput(output, profile) {
  requireObject(output, `${profile.id} output`);
  if (output.profileId !== profile.id) throw new Error(`${profile.id} output profile id mismatch`);
  requireString(output.path, `${profile.id} output path`);
  requireHash(output.sha256, `${profile.id} output hash`);
  requirePositiveInteger(output.byteLength, `${profile.id} output byte length`);
  const geometry = requireSourceGeometry(output.geometry);
  if (geometry.connectedComponentCount !== 1) {
    throw new Error(`${profile.id} output must contain one connected surface`);
  }
  if (!Array.isArray(output.renders) || output.renders.length !== CAST_CLEANUP_VIEW_IDS.length) {
    throw new Error(`${profile.id} output must contain four matched views`);
  }
  for (let index = 0; index < CAST_CLEANUP_VIEW_IDS.length; index += 1) {
    const render = requireObject(output.renders[index], `${profile.id} matched view`);
    if (render.viewId !== CAST_CLEANUP_VIEW_IDS[index]) {
      throw new Error(`${profile.id} matched views must use the frozen view order`);
    }
    requireString(render.path, `${profile.id} ${render.viewId} render path`);
    requireHash(render.sha256, `${profile.id} ${render.viewId} render hash`);
    requirePositiveInteger(render.byteLength, `${profile.id} ${render.viewId} render byte length`);
  }
}

function validateSourceWitness(report, spec) {
  const witness = requireObject(report.sourceWitness, 'source witness');
  const geometry = requireSourceGeometry(witness.geometry);
  const expected = spec.source.geometry;
  if (geometry.vertexCount !== expected.vertexCount) throw new Error('source witness vertex count mismatch');
  if (geometry.triangleCount !== expected.triangleCount) throw new Error('source witness triangle count mismatch');
  if (geometry.connectedComponentCount !== expected.connectedComponentCount) {
    throw new Error('source witness connected component count mismatch');
  }
  const actualExtent = [...geometry.bounds.extent].sort((left, right) => left - right);
  const expectedExtent = [...expected.bounds.extent].sort((left, right) => left - right);
  for (let axis = 0; axis < 3; axis += 1) {
    const tolerance = Math.max(1e-6, Math.abs(expectedExtent[axis]) * 1e-5);
    if (Math.abs(actualExtent[axis] - expectedExtent[axis]) > tolerance) {
      throw new Error('source witness extent mismatch');
    }
  }
}

export function validateCastCleanupReport(report, spec) {
  requireObject(report, 'cleanup report');
  requireObject(spec, 'cleanup spec');
  if (report.schema !== CAST_CLEANUP_REPORT_SCHEMA) throw new Error('cleanup report schema mismatch');
  requireRouteIdentity(report, spec);
  requireString(report.lastTrustworthyEvidence, 'last trustworthy evidence');

  if (report.status === 'failed') {
    requireString(report.failurePhase, 'failure phase');
    if (!Array.isArray(report.outputs)) throw new TypeError('failed report outputs must be an array');
    return { accepted: false, status: 'failed', failurePhase: report.failurePhase };
  }
  if (report.status !== 'succeeded') throw new Error('cleanup report status must be succeeded or failed');
  if (report.failurePhase !== null) throw new Error('successful cleanup report cannot carry a failure phase');
  validateSourceWitness(report, spec);
  if (!Array.isArray(report.outputs) || report.outputs.length !== spec.profiles.length) {
    throw new Error('successful cleanup report must contain every profile output');
  }
  for (let index = 0; index < spec.profiles.length; index += 1) {
    validateOutput(report.outputs[index], spec.profiles[index]);
  }
  return {
    accepted: true,
    status: 'succeeded',
    profileIds: spec.profiles.map(profile => profile.id),
  };
}
