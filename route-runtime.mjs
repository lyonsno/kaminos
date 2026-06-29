export const ROUTE_JOB_SCHEMA = 'kaminos.route-job.v0';
export const ROUTE_RUN_SCHEMA = 'kaminos.route-run.v0';

export const BACKEND_EXECUTOR_KINDS = Object.freeze([
  'webgpu-local',
  'native-greenroom',
  'local-command',
  'http-job',
  'websocket-job',
  'comfyui-workflow',
  'fixture',
]);

const ROUTE_JOB_STATUSES = new Set([
  'pending',
  'reserved',
  'running',
  'checkpointing',
  'checkpoint_paused',
  'paused_at_checkpoint',
  'done',
  'failed',
  'cancelled',
  'degraded',
]);

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function cloneJsonish(value, fallback) {
  if (value === undefined) return fallback;
  return value == null ? value : structuredClone(value);
}

export function normalizeRouteJobStatus(status) {
  return ROUTE_JOB_STATUSES.has(status) ? status : 'degraded';
}

export function normalizeBackendExecutor(executor, label = 'executor') {
  if (!executor || typeof executor !== 'object') {
    throw new TypeError(`${label} must be an object`);
  }
  if (!BACKEND_EXECUTOR_KINDS.includes(executor.kind)) {
    throw new TypeError(`unknown executor kind: ${executor.kind}`);
  }
  return structuredClone(executor);
}

export function createRouteJob({
  id,
  routeId,
  executor,
  priorityClass = 'normal',
  status = 'pending',
  inputArtifacts = [],
  outputPolicy = null,
  resumability = { kind: 'unknown' },
  labels = {},
  metadata = {},
} = {}) {
  assertNonEmptyString(id, 'id');
  assertNonEmptyString(routeId, 'routeId');
  assertNonEmptyString(priorityClass, 'priorityClass');

  return {
    schema: ROUTE_JOB_SCHEMA,
    id,
    routeId,
    executor: normalizeBackendExecutor(executor),
    priorityClass,
    status: normalizeRouteJobStatus(status),
    inputArtifacts: cloneJsonish(inputArtifacts, []),
    outputPolicy: cloneJsonish(outputPolicy, null),
    resumability: cloneJsonish(resumability, { kind: 'unknown' }),
    labels: cloneJsonish(labels, {}),
    metadata: cloneJsonish(metadata, {}),
  };
}

export function createRouteRunReceipt({
  job,
  status,
  effectiveExecutor,
  artifacts = [],
  timings = {},
  warnings = [],
  error = null,
} = {}) {
  if (!job || typeof job !== 'object') {
    throw new TypeError('job must be an object');
  }
  if (job.schema !== ROUTE_JOB_SCHEMA) {
    throw new TypeError(`job must use schema ${ROUTE_JOB_SCHEMA}`);
  }

  const normalizedTimings = cloneJsonish(timings, {});
  if (
    Number.isFinite(normalizedTimings.startedAt)
    && Number.isFinite(normalizedTimings.finishedAt)
    && normalizedTimings.durationSeconds === undefined
  ) {
    normalizedTimings.durationSeconds = normalizedTimings.finishedAt - normalizedTimings.startedAt;
  }

  return {
    schema: ROUTE_RUN_SCHEMA,
    jobId: job.id,
    routeId: job.routeId,
    status: normalizeRouteJobStatus(status),
    priorityClass: job.priorityClass,
    requestedExecutor: normalizeBackendExecutor(job.executor, 'job.executor'),
    effectiveExecutor: normalizeBackendExecutor(effectiveExecutor, 'effectiveExecutor'),
    artifacts: cloneJsonish(artifacts, []),
    timings: normalizedTimings,
    warnings: cloneJsonish(warnings, []),
    error: cloneJsonish(error, null),
  };
}
