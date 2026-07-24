export const WEBGPU_COOPERATIVE_BOUNDARY_MANIFEST_SCHEMA =
  'kaminos.webgpu-cooperative-boundary-manifest.v0';

const BOUNDARY_KINDS = new Set(['gpu-command', 'cpu-work']);
const COMMAND_DUTY_KINDS = new Set(['compute', 'copy', 'render', 'mixed']);
const HOST_PHASES = new Set([
  'cpu-preprocess',
  'command-encoding',
  'queue-submission',
  'readback',
  'presentation',
  'other',
]);
const YIELD_POLICIES = new Set(['after-duty', 'none']);
const TOP_LEVEL_KEYS = new Set(['manifestId', 'routeId', 'phases', 'metadata']);
const PHASE_KEYS = new Set(['phaseId', 'boundaries', 'metadata']);
const BOUNDARY_KEYS = new Set([
  'boundaryId',
  'kind',
  'unit',
  'totalItems',
  'progressWeight',
  'commandDutyKind',
  'hostPhase',
  'chunking',
  'yieldPolicy',
  'resources',
  'metadata',
]);

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireIdentity(name, value) {
  if (!isNonEmptyString(value)) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function requirePositiveSafeInteger(name, value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function rejectUnsupportedKeys(value, allowed, name) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${name} has unsupported field ${key}`);
  }
}

function normalizeMetadata(value, name) {
  if (value == null) return {};
  if (!isPlainObject(value)) throw new TypeError(`${name} must be an object when provided`);
  return clone(value);
}

function normalizeResourceList(value, name) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  const resources = value.map((resource, index) => requireIdentity(`${name}[${index}]`, resource));
  if (new Set(resources).size !== resources.length) {
    throw new TypeError(`${name} must not contain duplicate resource identities`);
  }
  return resources;
}

function normalizeResources(value, name) {
  if (value == null) return { retain: [], produce: [], release: [] };
  if (!isPlainObject(value)) throw new TypeError(`${name} must be an object when provided`);
  rejectUnsupportedKeys(value, new Set(['retain', 'produce', 'release']), name);
  return {
    retain: normalizeResourceList(value.retain, `${name}.retain`),
    produce: normalizeResourceList(value.produce, `${name}.produce`),
    release: normalizeResourceList(value.release, `${name}.release`),
  };
}

function normalizeChunking(value, kind, name) {
  if (!isPlainObject(value)) throw new TypeError(`${name} must be an object`);
  if (value.mode === 'fixed') {
    rejectUnsupportedKeys(value, new Set(['mode', 'chunkItems']), name);
    return {
      mode: 'fixed',
      chunkItems: requirePositiveSafeInteger(`${name}.chunkItems`, value.chunkItems),
    };
  }
  if (value.mode !== 'adaptive') {
    throw new TypeError(`${name}.mode must be fixed or adaptive`);
  }
  if (kind !== 'gpu-command') {
    throw new TypeError(`${name}.mode adaptive is supported only for gpu-command boundaries`);
  }
  rejectUnsupportedKeys(
    value,
    new Set(['mode', 'initialItems', 'minItems', 'maxItems', 'targetDurationMs']),
    name,
  );
  const initialItems = requirePositiveSafeInteger(`${name}.initialItems`, value.initialItems);
  const minItems = requirePositiveSafeInteger(`${name}.minItems`, value.minItems);
  const maxItems = requirePositiveSafeInteger(`${name}.maxItems`, value.maxItems);
  if (maxItems < minItems) throw new TypeError(`${name}.maxItems must be at least minItems`);
  if (initialItems < minItems || initialItems > maxItems) {
    throw new TypeError(`${name}.initialItems must be within minItems and maxItems`);
  }
  if (!Number.isFinite(value.targetDurationMs) || value.targetDurationMs <= 0) {
    throw new TypeError(`${name}.targetDurationMs must be finite and greater than zero`);
  }
  return {
    mode: 'adaptive',
    initialItems,
    minItems,
    maxItems,
    targetDurationMs: value.targetDurationMs,
  };
}

function normalizeBoundary(value, phaseId, boundaryIds, index) {
  const name = `phases.${phaseId}.boundaries[${index}]`;
  if (!isPlainObject(value)) throw new TypeError(`${name} must be an object`);
  rejectUnsupportedKeys(value, BOUNDARY_KEYS, name);
  const boundaryId = requireIdentity(`${name}.boundaryId`, value.boundaryId);
  if (boundaryIds.has(boundaryId)) throw new TypeError(`duplicate boundaryId: ${boundaryId}`);
  boundaryIds.add(boundaryId);

  if (!BOUNDARY_KINDS.has(value.kind)) {
    throw new TypeError(`${name}.kind must be gpu-command or cpu-work`);
  }
  const totalItems = value.totalItems == null
    ? null
    : requirePositiveSafeInteger(`${name}.totalItems`, value.totalItems);
  if (!Number.isFinite(value.progressWeight) || value.progressWeight <= 0) {
    throw new TypeError(`${name}.progressWeight must be finite and greater than zero`);
  }
  const yieldPolicy = value.yieldPolicy || 'after-duty';
  if (!YIELD_POLICIES.has(yieldPolicy)) {
    throw new TypeError(`${name}.yieldPolicy must be after-duty or none`);
  }

  let commandDutyKind = null;
  let hostPhase = null;
  if (value.kind === 'gpu-command') {
    commandDutyKind = value.commandDutyKind || 'compute';
    if (!COMMAND_DUTY_KINDS.has(commandDutyKind)) {
      throw new TypeError(`${name}.commandDutyKind is unsupported`);
    }
    if (value.hostPhase != null) throw new TypeError(`${name}.hostPhase belongs only to cpu-work boundaries`);
  } else {
    hostPhase = value.hostPhase || 'other';
    if (!HOST_PHASES.has(hostPhase)) throw new TypeError(`${name}.hostPhase is unsupported`);
    if (value.commandDutyKind != null) {
      throw new TypeError(`${name}.commandDutyKind belongs only to gpu-command boundaries`);
    }
  }

  return {
    boundaryId,
    kind: value.kind,
    unit: requireIdentity(`${name}.unit`, value.unit),
    totalItems,
    progressWeight: value.progressWeight,
    commandDutyKind,
    hostPhase,
    chunking: normalizeChunking(value.chunking, value.kind, `${name}.chunking`),
    yieldPolicy,
    resources: normalizeResources(value.resources, `${name}.resources`),
    metadata: normalizeMetadata(value.metadata, `${name}.metadata`),
  };
}

export function defineWebGpuCooperativeBoundaryManifest(input = {}) {
  if (!isPlainObject(input)) throw new TypeError('cooperative boundary manifest input must be an object');
  rejectUnsupportedKeys(input, TOP_LEVEL_KEYS, 'cooperative boundary manifest');
  const manifestId = requireIdentity('manifestId', input.manifestId);
  const routeId = requireIdentity('routeId', input.routeId);
  if (!Array.isArray(input.phases) || input.phases.length === 0) {
    throw new TypeError('phases must be a non-empty array');
  }

  const phaseIds = new Set();
  const boundaryIds = new Set();
  const phases = input.phases.map((phase, phaseIndex) => {
    const name = `phases[${phaseIndex}]`;
    if (!isPlainObject(phase)) throw new TypeError(`${name} must be an object`);
    rejectUnsupportedKeys(phase, PHASE_KEYS, name);
    const phaseId = requireIdentity(`${name}.phaseId`, phase.phaseId);
    if (phaseIds.has(phaseId)) throw new TypeError(`duplicate phaseId: ${phaseId}`);
    phaseIds.add(phaseId);
    if (!Array.isArray(phase.boundaries) || phase.boundaries.length === 0) {
      throw new TypeError(`${name}.boundaries must be a non-empty array`);
    }
    const boundaries = phase.boundaries.map((boundary, boundaryIndex) => (
      normalizeBoundary(boundary, phaseId, boundaryIds, boundaryIndex)
    ));
    return {
      phaseId,
      progressWeight: boundaries.reduce((sum, boundary) => sum + boundary.progressWeight, 0),
      boundaries,
      metadata: normalizeMetadata(phase.metadata, `${name}.metadata`),
    };
  });

  return deepFreeze({
    schema: WEBGPU_COOPERATIVE_BOUNDARY_MANIFEST_SCHEMA,
    manifestId,
    routeId,
    progressWeight: phases.reduce((sum, phase) => sum + phase.progressWeight, 0),
    phases,
    metadata: normalizeMetadata(input.metadata, 'metadata'),
  });
}
