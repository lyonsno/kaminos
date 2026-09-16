export const VOLUME_BASIN_DRIVE_SESSION_SCHEMA = 'kaminos.volume.basin-drive-session.v0';

export function createVolumeBasinDriveSessionRecorder(options = {}) {
  const sessionId = requiredString(options.sessionId, 'sessionId');
  const source = cloneJson(options.source, 'source');
  const controlSchema = cloneJson(options.controlSchema, 'controlSchema');
  const runtime = cloneJson(options.runtime, 'runtime');
  const initialState = cloneJson(options.initialState, 'initialState');
  const startedAt = requiredIsoTimestamp(options.startedAt, 'startedAt');
  const now = options.now || defaultMonotonicClock;
  if (typeof now !== 'function') throw new Error('now must be a monotonic clock function');

  validateSource(source);
  validateControlSchema(controlSchema);
  validateRuntime(runtime);
  validateControlState(initialState, controlSchema, 'initialState');

  const monotonicOrigin = readClock(now);
  let lastMonotonicMs = monotonicOrigin;
  let finished = false;
  const events = [];

  const nextTiming = () => {
    if (finished) throw new Error('basin drive session is already finished');
    const current = readClock(now);
    if (current < lastMonotonicMs) {
      throw new Error(`monotonic clock moved backward: ${current} < ${lastMonotonicMs}`);
    }
    lastMonotonicMs = current;
    return current - monotonicOrigin;
  };

  const appendAt = (event, elapsedMs) => {
    events.push({
      ...event,
      sequence: events.length,
      elapsedMs,
    });
    return events.at(-1).sequence;
  };

  const controlEvent = (input, transactionId, transactionIndex, transactionCount) => ({
    kind: 'control',
    axis: requiredControlAxis(input.axis, 'control axis'),
    controlId: requiredString(input.controlId, 'controlId'),
    param: requiredString(input.param, 'control param'),
    inputType: requiredString(input.inputType, 'control inputType'),
    requested: cloneJsonScalar(input.requested, 'control requested value'),
    effective: cloneJsonScalar(input.effective, 'control effective value'),
    gesture: validateGesture(cloneJson(input.gesture, 'control gesture'), 'control gesture'),
    transactionId,
    transactionIndex,
    transactionCount,
  });

  return Object.freeze({
    recordControl(input = {}) {
      const elapsedMs = nextTiming();
      const transactionId = requiredString(input.transactionId || `control-${events.length}`, 'transactionId');
      return appendAt(controlEvent(input, transactionId, 0, 1), elapsedMs);
    },

    recordControls(inputs = [], options = {}) {
      if (!Array.isArray(inputs) || inputs.length < 1) throw new Error('recordControls requires a nonempty control array');
      const transactionId = requiredString(options.transactionId, 'transactionId');
      const elapsedMs = nextTiming();
      const firstSequence = events.length;
      for (const [index, input] of inputs.entries()) {
        appendAt(controlEvent(input, transactionId, index, inputs.length), elapsedMs);
      }
      return firstSequence;
    },

    mark(input = {}) {
      return appendAt({
        kind: 'mark',
        label: requiredString(input.label, 'mark label'),
        state: cloneJson(input.state, 'mark state'),
      }, nextTiming());
    },

    finish(input = {}) {
      const elapsedMs = nextTiming();
      const finalState = cloneJson(input.finalState, 'finalState');
      validateControlState(finalState, controlSchema, 'finalState');
      const endedAt = requiredIsoTimestamp(input.endedAt, 'endedAt');
      finished = true;
      const session = {
        schema: VOLUME_BASIN_DRIVE_SESSION_SCHEMA,
        status: 'complete',
        sessionId,
        source,
        controlSchema,
        runtime,
        clock: {
          identity: 'monotonic-relative-ms',
        },
        startedAt,
        endedAt,
        durationMs: elapsedMs,
        initialState,
        events: cloneJson(events, 'events'),
        eventCount: events.length,
        controlEventCount: events.filter(event => event.kind === 'control').length,
        markCount: events.filter(event => event.kind === 'mark').length,
        finalState,
      };
      validateVolumeBasinDriveSession(session);
      return deepFreeze(session);
    },

    get eventCount() {
      return events.length;
    },
  });
}

export function validateVolumeBasinDriveSession(session) {
  requiredRecord(session, 'session');
  if (session.schema !== VOLUME_BASIN_DRIVE_SESSION_SCHEMA) {
    throw new Error(`unsupported basin drive session schema: ${session.schema}`);
  }
  if (session.status !== 'complete') throw new Error(`basin drive session is not complete: ${session.status}`);
  requiredString(session.sessionId, 'sessionId');
  validateSource(session.source);
  validateControlSchema(session.controlSchema);
  validateRuntime(session.runtime);
  if (session.clock?.identity !== 'monotonic-relative-ms') throw new Error('session clock identity is not monotonic-relative-ms');
  requiredIsoTimestamp(session.startedAt, 'startedAt');
  requiredIsoTimestamp(session.endedAt, 'endedAt');
  requiredNonnegativeNumber(session.durationMs, 'durationMs');
  validateControlState(session.initialState, session.controlSchema, 'initialState');
  validateControlState(session.finalState, session.controlSchema, 'finalState');
  if (!Array.isArray(session.events)) throw new Error('session events must be an array');
  if (session.eventCount !== session.events.length) {
    throw new Error(`event count mismatch: ${session.eventCount} != ${session.events.length}`);
  }

  let previousElapsedMs = 0;
  let controlEventCount = 0;
  let markCount = 0;
  for (const [index, event] of session.events.entries()) {
    requiredRecord(event, `event ${index}`);
    if (event.sequence !== index) throw new Error(`event sequence mismatch at ${index}: ${event.sequence}`);
    requiredNonnegativeNumber(event.elapsedMs, `event ${index} elapsedMs`);
    if (event.elapsedMs < previousElapsedMs) {
      throw new Error(`event timing is not monotonic at sequence ${index}`);
    }
    if (event.elapsedMs > session.durationMs) {
      throw new Error(`event ${index} occurs after session duration`);
    }
    previousElapsedMs = event.elapsedMs;
    if (event.kind === 'control') {
      controlEventCount += 1;
      requiredControlAxis(event.axis, `event ${index} axis`);
      requiredString(event.controlId, `event ${index} controlId`);
      requiredString(event.param, `event ${index} param`);
      requiredString(event.inputType, `event ${index} inputType`);
      requiredJsonScalar(event.requested, `event ${index} requested`);
      requiredJsonScalar(event.effective, `event ${index} effective`);
      validateGesture(event.gesture, `event ${index} gesture`);
      validateControlEventInventory(event, session.controlSchema, `event ${index}`);
      requiredString(event.transactionId, `event ${index} transactionId`);
      if (!Number.isInteger(event.transactionIndex) || event.transactionIndex < 0) {
        throw new Error(`event ${index} transactionIndex must be a nonnegative integer`);
      }
      if (!Number.isInteger(event.transactionCount) || event.transactionCount < 1
        || event.transactionIndex >= event.transactionCount) {
        throw new Error(`event ${index} transactionCount is invalid`);
      }
    } else if (event.kind === 'mark') {
      markCount += 1;
      requiredString(event.label, `event ${index} mark label`);
      validateControlState(event.state, session.controlSchema, `event ${index} mark state`);
    } else {
      throw new Error(`unsupported event kind at sequence ${index}: ${event.kind}`);
    }
  }
  if (session.controlEventCount !== controlEventCount) {
    throw new Error(`control event count mismatch: ${session.controlEventCount} != ${controlEventCount}`);
  }
  if (session.markCount !== markCount) {
    throw new Error(`mark count mismatch: ${session.markCount} != ${markCount}`);
  }
  validateTransactions(session.events);
  return true;
}

export function serializeVolumeBasinDriveSession(session) {
  validateVolumeBasinDriveSession(session);
  return `${JSON.stringify(session, null, 2)}\n`;
}

export function parseVolumeBasinDriveSession(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('basin drive session document is empty');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`basin drive session JSON is invalid: ${error.message}`);
  }
  validateVolumeBasinDriveSession(parsed);
  return deepFreeze(cloneJson(parsed, 'session'));
}

export async function replayVolumeBasinDriveSession(session, callbacks = {}) {
  validateVolumeBasinDriveSession(session);
  if (typeof callbacks.applyControl !== 'function') throw new Error('replay requires applyControl');
  if (typeof callbacks.applyInitialState !== 'function') throw new Error('replay requires applyInitialState');
  if (typeof callbacks.captureState !== 'function') throw new Error('replay requires captureState');
  if (typeof callbacks.waitUntilElapsed !== 'function') throw new Error('replay requires waitUntilElapsed');
  const observedInitialState = await callbacks.applyInitialState(deepFreeze(cloneJson(session.initialState, 'initialState')));
  if (!jsonEqual(observedInitialState, session.initialState)) throw new Error('replay initial state mismatch');
  const applied = [];
  const marks = [];
  for (const event of session.events) {
    await callbacks.waitUntilElapsed(event.elapsedMs);
    if (event.kind === 'control') {
      const observedEffective = await callbacks.applyControl(deepFreeze(cloneJson(event, 'control event')));
      if (!jsonEqual(observedEffective, event.effective)) {
        throw new Error(
          `effective value mismatch for ${event.controlId} at sequence ${event.sequence}: expected ${JSON.stringify(event.effective)}, observed ${JSON.stringify(observedEffective)}`,
        );
      }
      applied.push(event.sequence);
    } else {
      if (callbacks.applyMark) await callbacks.applyMark(deepFreeze(cloneJson(event, 'mark event')));
      marks.push(event.sequence);
    }
  }
  await callbacks.waitUntilElapsed(session.durationMs);

  const observedFinalState = await callbacks.captureState();
  const finalStateMatch = jsonEqual(observedFinalState, session.finalState);
  if (!finalStateMatch) throw new Error('replay final state mismatch');
  return deepFreeze({
    schema: 'kaminos.volume.basin-drive-replay-receipt.v0',
    status: 'replayed',
    sessionId: session.sessionId,
    sourceCommit: session.source.commit,
    eventCount: session.eventCount,
    initialStateApplied: true,
    initialStateMatch: true,
    timingApplied: true,
    appliedControlSequences: applied,
    markSequences: marks,
    effectiveMatch: true,
    finalStateMatch,
  });
}

function validateSource(source) {
  requiredRecord(source, 'source');
  requiredString(source.repository, 'source repository');
  const commit = requiredString(source.commit, 'source commit');
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error('source commit must be an exact 40-character Git identity');
  if (source.branch !== undefined) requiredString(source.branch, 'source branch');
  if (source.dirty !== false) throw new Error('source dirty must be explicitly false');
}

function validateControlSchema(controlSchema) {
  requiredRecord(controlSchema, 'controlSchema');
  if (controlSchema.identity !== 'kaminos-volume-settings-preset-schema-v2') {
    throw new Error(`unsupported controlSchema identity: ${controlSchema.identity}`);
  }
  const sha256 = requiredString(controlSchema.sha256, 'controlSchema sha256');
  if (!/^[0-9a-f]{64}$/i.test(sha256)) throw new Error('controlSchema sha256 must be an exact SHA-256 identity');
  if (!Number.isInteger(controlSchema.basinControlCount) || controlSchema.basinControlCount < 1) {
    throw new Error('controlSchema basinControlCount must be a positive integer');
  }
  for (const [field, expected] of [['basinControlCount', 192], ['rendererControlCount', 3], ['presentationControlCount', 1]]) {
    if (controlSchema[field] !== expected) throw new Error(`controlSchema ${field} must be exactly ${expected}`);
  }
  if (!Array.isArray(controlSchema.inventory)) throw new Error('controlSchema inventory must be an array');
  const expectedTotal = controlSchema.basinControlCount + controlSchema.rendererControlCount + controlSchema.presentationControlCount;
  if (controlSchema.inventory.length !== expectedTotal) throw new Error('controlSchema inventory count mismatch');
  const identities = new Set();
  const axisCounts = { basin: 0, renderer: 0, presentation: 0 };
  for (const [index, descriptor] of controlSchema.inventory.entries()) {
    requiredRecord(descriptor, `controlSchema inventory ${index}`);
    const axis = requiredControlAxis(descriptor.axis, `controlSchema inventory ${index} axis`);
    const id = requiredString(descriptor.id, `controlSchema inventory ${index} id`);
    requiredString(descriptor.param, `controlSchema inventory ${index} param`);
    requiredString(descriptor.type, `controlSchema inventory ${index} type`);
    const identity = `${axis}:${id}`;
    if (identities.has(identity)) throw new Error(`controlSchema inventory duplicates ${identity}`);
    identities.add(identity);
    axisCounts[axis] += 1;
  }
  for (const [axis, field] of [['basin', 'basinControlCount'], ['renderer', 'rendererControlCount'], ['presentation', 'presentationControlCount']]) {
    if (axisCounts[axis] !== controlSchema[field]) throw new Error(`controlSchema ${axis} inventory count mismatch`);
  }
}

function validateRuntime(runtime) {
  requiredRecord(runtime, 'runtime');
  for (const key of ['requestedRoute', 'effectiveRoute']) {
    const route = requiredString(runtime[key], `runtime ${key}`);
    try {
      new URL(route);
    } catch {
      throw new Error(`runtime ${key} must be an absolute URL`);
    }
  }
  requiredString(runtime.backend, 'runtime backend');
  requiredString(runtime.requestedStorePath, 'runtime requestedStorePath');
  requiredString(runtime.effectiveStorePath, 'runtime effectiveStorePath');
  if (runtime.requestedStorePath !== runtime.effectiveStorePath) throw new Error('runtime store path mismatch');
}

function requiredControlAxis(value, name) {
  const axis = requiredString(value, name);
  if (!['basin', 'renderer', 'presentation'].includes(axis)) {
    throw new Error(`${name} must be basin, renderer, or presentation`);
  }
  return axis;
}

function validateGesture(gesture, name) {
  requiredRecord(gesture, name);
  requiredString(gesture.eventType, `${name} eventType`);
  requiredString(gesture.targetId, `${name} targetId`);
  if (typeof gesture.targeted !== 'boolean') throw new Error(`${name} targeted must be boolean`);
  if (typeof gesture.trusted !== 'boolean') throw new Error(`${name} trusted must be boolean`);
  if (typeof gesture.commandDriven !== 'boolean') throw new Error(`${name} commandDriven must be boolean`);
  if (gesture.commandDriven === gesture.targeted) throw new Error(`${name} targeted and commandDriven must be opposites`);
  return gesture;
}

function controlInventoryMap(controlSchema) {
  return new Map(controlSchema.inventory.map(descriptor => [`${descriptor.axis}:${descriptor.id}`, descriptor]));
}

function validateControlEventInventory(event, controlSchema, name) {
  const descriptor = controlInventoryMap(controlSchema).get(`${event.axis}:${event.controlId}`);
  if (!descriptor) throw new Error(`${name} control is outside the canonical inventory: ${event.axis}:${event.controlId}`);
  if (event.param !== descriptor.param || event.inputType !== descriptor.type) {
    throw new Error(`${name} control descriptor mismatch for ${event.controlId}`);
  }
}

function validateControlState(state, controlSchema, name) {
  requiredRecord(state, name);
  if (state.schema !== 'kaminos.volume.basin-drive-control-state.v0') throw new Error(`${name} schema mismatch`);
  const expected = { basin: [], renderer: [], presentation: [] };
  for (const descriptor of controlSchema.inventory) expected[descriptor.axis].push(descriptor.id);
  for (const axis of Object.keys(expected)) {
    requiredRecord(state[axis], `${name} ${axis}`);
    const actualKeys = Object.keys(state[axis]).sort();
    const expectedKeys = expected[axis].sort();
    if (!jsonEqual(actualKeys, expectedKeys)) throw new Error(`${name} ${axis} inventory mismatch`);
    for (const id of actualKeys) requiredJsonScalar(state[axis][id], `${name} ${axis} ${id}`);
  }
  requiredString(state.route, `${name} route`);
  try {
    new URL(state.route);
  } catch {
    throw new Error(`${name} route must be an absolute URL`);
  }
  requiredRecord(state.effectivePresentation, `${name} effectivePresentation`);
  for (const id of expected.presentation) {
    const receipt = requiredRecord(state.effectivePresentation[id], `${name} effectivePresentation ${id}`);
    requiredString(receipt.effective, `${name} effectivePresentation ${id} effective`);
    if (receipt.fallbackReason !== null) throw new Error(`${name} effectivePresentation ${id} has fallback`);
  }
  return state;
}

function validateTransactions(events) {
  const groups = new Map();
  for (const event of events.filter(candidate => candidate.kind === 'control')) {
    const group = groups.get(event.transactionId) || [];
    group.push(event);
    groups.set(event.transactionId, group);
  }
  for (const [transactionId, group] of groups) {
    const count = group[0].transactionCount;
    if (group.length !== count
      || group.some((event, index) => event.transactionIndex !== index || event.transactionCount !== count)
      || group.some((event, index) => index > 0 && event.sequence !== group[index - 1].sequence + 1)
      || group.some(event => event.elapsedMs !== group[0].elapsedMs)) {
      throw new Error(`control transaction is incomplete or reordered: ${transactionId}`);
    }
  }
}

function cloneJson(value, name) {
  if (value === undefined) throw new Error(`${name} is required`);
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new Error(`${name} is not JSON-serializable: ${error.message}`);
  }
  if (serialized === undefined) throw new Error(`${name} is not JSON-serializable`);
  return JSON.parse(serialized);
}

function cloneJsonScalar(value, name) {
  requiredJsonScalar(value, name);
  return cloneJson(value, name);
}

function requiredJsonScalar(value, name) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error(`${name} must be a finite JSON scalar`);
}

function requiredRecord(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value;
}

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value;
}

function requiredIsoTimestamp(value, name) {
  const timestamp = requiredString(value, name);
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error(`${name} must be an ISO timestamp`);
  return timestamp;
}

function requiredNonnegativeNumber(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a nonnegative finite number`);
  return value;
}

function readClock(now) {
  const value = Number(now());
  if (!Number.isFinite(value)) throw new Error('monotonic clock returned a non-finite value');
  return value;
}

function defaultMonotonicClock() {
  if (globalThis.performance?.now) return globalThis.performance.now();
  return Date.now();
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
