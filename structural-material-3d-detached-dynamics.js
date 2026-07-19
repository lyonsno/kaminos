import { STRUCTURAL_ASSET_SIDECAR_ROUTE } from './structural-material-3d-asset-sidecar.js';

export const DETACHED_DYNAMICS_SCHEMA = 'kaminos.structural-material.detached-dynamics.v0';
export const DETACHED_DYNAMICS_ROUTE = 'kaminos.structural-material.detached-dynamics.v0';
export const DETACHED_DYNAMICS_AUTHORITY = 'accepted-graph-separation-to-render-dynamics-v0';

const DEFAULTS = Object.freeze({
  fixedStepSeconds: 1 / 120,
  gravity: 2.4,
  groundPlaneY: 1.12,
  launchVelocityScale: 5.5,
  maximumLaunchSpeed: 1.8,
  restitution: 0.28,
  airDamping: 0.998,
  contactFriction: 0.82,
  contactAngularDamping: 0.84,
  settleNormalSpeed: 0.2,
  settleTangentSpeed: 0.025,
  settleAngularSpeed: 0.08,
});

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`detached dynamics requires finite ${label}`);
  return number;
}

function positive(value, label) {
  const number = finite(value, label);
  if (number <= 0) throw new Error(`detached dynamics requires positive ${label}`);
  return number;
}

function round(value, digits = 9) {
  const scale = 10 ** digits;
  return Math.round(finite(value, 'state value') * scale) / scale;
}

function point(value, label) {
  return {
    x: round(value?.x ?? 0),
    y: round(value?.y ?? 0),
    z: round(value?.z ?? 0),
  };
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function magnitude(value) {
  return Math.hypot(value.x, value.y, value.z);
}

function scaleToMaximum(value, maximum) {
  const length = magnitude(value);
  const scale = length > maximum ? maximum / length : 1;
  return point({ x: value.x * scale, y: value.y * scale, z: value.z * scale }, 'scaled vector');
}

function normalize(value, fallback = { x: 0, y: 0, z: 1 }) {
  const length = magnitude(value);
  return length > 0.000000001
    ? point({ x: value.x / length, y: value.y / length, z: value.z / length }, 'normalized vector')
    : { ...fallback };
}

function cloneBody(body) {
  return {
    ...body,
    position: { ...body.position },
    linearVelocity: { ...body.linearVelocity },
    rotationAxis: { ...body.rotationAxis },
  };
}

function validateAssetProjection(sidecar, label) {
  if (sidecar?.status !== 'passed' || sidecar.route !== STRUCTURAL_ASSET_SIDECAR_ROUTE) {
    throw new Error(`detached dynamics requires passed ${label} asset projection`);
  }
  if (!Number.isInteger(sidecar.topologyEpoch) || !Number.isInteger(sidecar.connectivityEpoch) ||
      sidecar.topologyEpoch < 0 || sidecar.connectivityEpoch < 0) {
    throw new Error('detached dynamics requires asset epoch coherence');
  }
  for (const anchor of sidecar.anchors || []) {
    if (anchor.acceptedState?.topologyEpoch !== sidecar.topologyEpoch ||
        anchor.acceptedState?.connectivityEpoch !== sidecar.connectivityEpoch) {
      throw new Error('detached dynamics requires asset epoch coherence');
    }
  }
}

function configFrom(options = {}) {
  const config = Object.fromEntries(
    Object.entries(DEFAULTS).map(([key, fallback]) => [key, options[key] ?? fallback]),
  );
  config.fixedStepSeconds = positive(config.fixedStepSeconds, 'fixedStepSeconds');
  config.gravity = positive(config.gravity, 'gravity');
  config.groundPlaneY = finite(config.groundPlaneY, 'groundPlaneY');
  config.launchVelocityScale = positive(config.launchVelocityScale, 'launchVelocityScale');
  config.maximumLaunchSpeed = positive(config.maximumLaunchSpeed, 'maximumLaunchSpeed');
  config.restitution = finite(config.restitution, 'restitution');
  config.airDamping = positive(config.airDamping, 'airDamping');
  config.contactFriction = positive(config.contactFriction, 'contactFriction');
  config.contactAngularDamping = positive(config.contactAngularDamping, 'contactAngularDamping');
  config.settleNormalSpeed = positive(config.settleNormalSpeed, 'settleNormalSpeed');
  config.settleTangentSpeed = positive(config.settleTangentSpeed, 'settleTangentSpeed');
  config.settleAngularSpeed = positive(config.settleAngularSpeed, 'settleAngularSpeed');
  if (config.restitution < 0 || config.restitution > 1 ||
      config.airDamping > 1 || config.contactFriction > 1 || config.contactAngularDamping > 1) {
    throw new Error('detached dynamics damping and restitution must be within [0, 1]');
  }
  return config;
}

export function createDetachedDynamicsSidecar(options = {}) {
  return {
    schema: DETACHED_DYNAMICS_SCHEMA,
    route: DETACHED_DYNAMICS_ROUTE,
    authority: DETACHED_DYNAMICS_AUTHORITY,
    status: 'passed',
    generation: Number.isInteger(options.generation) ? options.generation : 0,
    elapsedSeconds: 0,
    stepCount: 0,
    contactEpoch: 0,
    lastAcceptedEventEpoch: null,
    launchKeys: [],
    bodies: [],
    retiredBodies: [],
    config: configFrom(options),
  };
}

export function rebaseDetachedDynamicsClockOrigin(nowMilliseconds, elapsedSeconds) {
  return finite(nowMilliseconds, 'wall clock milliseconds') -
    finite(elapsedSeconds, 'elapsedSeconds') * 1000;
}

function launchBody(previousAnchor, nextAnchor, transition, state) {
  const previousCenter = point(previousAnchor.acceptedBodyCenter, 'previous body center');
  const nextCenter = point(nextAnchor.acceptedBodyCenter, 'next body center');
  const acceptedDelta = subtract(nextCenter, previousCenter);
  const launchVelocity = scaleToMaximum({
    x: acceptedDelta.x * state.config.launchVelocityScale,
    y: acceptedDelta.y * state.config.launchVelocityScale,
    z: acceptedDelta.z * state.config.launchVelocityScale,
  }, state.config.maximumLaunchSpeed);
  const axisDelta = subtract(
    point(nextAnchor.acceptedBodyAxis, 'next body axis'),
    point(previousAnchor.acceptedBodyAxis, 'previous body axis'),
  );
  const rotationAxis = normalize({
    x: axisDelta.z + acceptedDelta.z * 0.35,
    y: acceptedDelta.x * 0.3,
    z: -axisDelta.x - acceptedDelta.x * 0.35,
  });
  const angularSpeed = round(Math.min(6, Math.max(0.35, magnitude(axisDelta) * 18 + magnitude(acceptedDelta) * 7)));
  const halfExtentY = round(Math.max(0.035, finite(nextAnchor.scale?.y ?? 0.1, 'anchor y scale') * 0.65));
  const groundCenterY = round(state.config.groundPlaneY - halfExtentY);
  return {
    id: `dynamics-body:${transition.objectIdentity}:${nextAnchor.id}:${transition.eventEpoch}`,
    launchKey: `${transition.objectIdentity}:${nextAnchor.id}:${nextAnchor.componentId}:${transition.eventEpoch}`,
    objectIdentity: transition.objectIdentity,
    assetAnchorId: nextAnchor.id,
    prototypeAssetId: nextAnchor.prototype.assetId,
    structuralNodeId: nextAnchor.structuralNodeId,
    componentId: nextAnchor.componentId,
    sourceTopologyEpoch: nextAnchor.acceptedState.topologyEpoch,
    sourceConnectivityEpoch: nextAnchor.acceptedState.connectivityEpoch,
    launchEventEpoch: transition.eventEpoch,
    launchOperation: transition.operation,
    launchStep: state.stepCount,
    position: nextCenter,
    linearVelocity: launchVelocity,
    rotationAxis,
    rotationAngle: 0,
    angularSpeed,
    halfExtentY,
    groundCenterY,
    contactEpoch: 0,
    inContact: false,
    phase: nextCenter.y >= groundCenterY ? 'contact' : 'airborne',
  };
}

export function reconcileAcceptedDetachedDynamics(
  current,
  previousAssets,
  nextAssets,
  transition = {},
) {
  if (current?.route !== DETACHED_DYNAMICS_ROUTE || current.status !== 'passed') {
    throw new Error('detached dynamics reconciliation requires a passed dynamics state');
  }
  if (transition.accepted !== true) {
    throw new Error('detached dynamics requires an accepted structural transition');
  }
  if (!Number.isInteger(transition.eventEpoch) || transition.eventEpoch < 0) {
    throw new Error('detached dynamics requires an accepted event epoch');
  }
  if (!transition.objectIdentity || !['shear', 'bind'].includes(transition.operation)) {
    throw new Error('detached dynamics requires object identity and shear/bind operation');
  }
  validateAssetProjection(previousAssets, 'previous');
  validateAssetProjection(nextAssets, 'next');
  if (nextAssets.topologyEpoch < previousAssets.topologyEpoch ||
      nextAssets.connectivityEpoch < previousAssets.connectivityEpoch) {
    throw new Error('detached dynamics requires asset epoch coherence');
  }
  if (current.lastAcceptedEventEpoch !== null && transition.eventEpoch < current.lastAcceptedEventEpoch) {
    throw new Error('detached dynamics rejected a regressed accepted event epoch');
  }

  const next = {
    ...current,
    lastAcceptedEventEpoch: Math.max(current.lastAcceptedEventEpoch ?? 0, transition.eventEpoch),
    launchKeys: [...current.launchKeys],
    bodies: current.bodies.map(cloneBody),
    retiredBodies: current.retiredBodies.map(cloneBody),
    config: { ...current.config },
  };
  const previousById = new Map(previousAssets.anchors.map(anchor => [anchor.id, anchor]));
  const nextById = new Map(nextAssets.anchors.map(anchor => [anchor.id, anchor]));

  for (let index = next.bodies.length - 1; index >= 0; index -= 1) {
    const body = next.bodies[index];
    const nextAnchor = nextById.get(body.assetAnchorId);
    if (!nextAnchor?.attached) continue;
    next.bodies.splice(index, 1);
    next.retiredBodies.push({
      ...body,
      phase: 'retired',
      retirementCause: 'accepted-structural-reattachment',
      retirementEventEpoch: transition.eventEpoch,
    });
  }

  for (const nextAnchor of nextAssets.anchors) {
    const previousAnchor = previousById.get(nextAnchor.id);
    if (!previousAnchor) continue;
    const launchCandidate = previousAnchor.attached === true &&
      nextAnchor.attached === false &&
      nextAnchor.tumbleEligible === true;
    if (!launchCandidate) continue;
    const body = launchBody(previousAnchor, nextAnchor, transition, next);
    if (next.launchKeys.includes(body.launchKey)) continue;
    next.launchKeys.push(body.launchKey);
    next.bodies.push(body);
  }

  next.bodies.sort((a, b) => a.id.localeCompare(b.id));
  return next;
}

function integrateBody(body, state) {
  if (body.phase === 'settled') return cloneBody(body);
  const dt = state.config.fixedStepSeconds;
  const next = cloneBody(body);
  next.linearVelocity.x = round(next.linearVelocity.x * state.config.airDamping);
  next.linearVelocity.z = round(next.linearVelocity.z * state.config.airDamping);
  next.linearVelocity.y = round(next.linearVelocity.y + state.config.gravity * dt);
  next.position.x = round(next.position.x + next.linearVelocity.x * dt);
  next.position.y = round(next.position.y + next.linearVelocity.y * dt);
  next.position.z = round(next.position.z + next.linearVelocity.z * dt);
  next.rotationAngle = round(next.rotationAngle + next.angularSpeed * dt);

  if (next.position.y < next.groundCenterY) {
    next.inContact = false;
    next.phase = 'airborne';
    return next;
  }

  const enteringContact = !body.inContact;
  const impactSpeed = Math.max(0, next.linearVelocity.y);
  next.position.y = next.groundCenterY;
  if (enteringContact) {
    next.contactEpoch += 1;
    state.contactEpoch += 1;
  }
  next.inContact = true;
  next.phase = 'contact';

  if (impactSpeed >= state.config.settleNormalSpeed) {
    next.linearVelocity.y = round(-impactSpeed * state.config.restitution);
    next.linearVelocity.x = round(next.linearVelocity.x * state.config.contactFriction);
    next.linearVelocity.z = round(next.linearVelocity.z * state.config.contactFriction);
    next.angularSpeed = round(next.angularSpeed * state.config.contactAngularDamping);
    next.inContact = false;
    return next;
  }

  next.linearVelocity.y = 0;
  next.linearVelocity.x = round(next.linearVelocity.x * state.config.contactFriction);
  next.linearVelocity.z = round(next.linearVelocity.z * state.config.contactFriction);
  next.angularSpeed = round(next.angularSpeed * state.config.contactAngularDamping);
  if (Math.hypot(next.linearVelocity.x, next.linearVelocity.z) <= state.config.settleTangentSpeed &&
      next.angularSpeed <= state.config.settleAngularSpeed) {
    next.linearVelocity = { x: 0, y: 0, z: 0 };
    next.angularSpeed = 0;
    next.phase = 'settled';
  }
  return next;
}

export function advanceDetachedDynamicsToTime(current, elapsedSeconds) {
  if (current?.route !== DETACHED_DYNAMICS_ROUTE || current.status !== 'passed') {
    throw new Error('detached dynamics advancement requires a passed dynamics state');
  }
  const targetTime = finite(elapsedSeconds, 'elapsedSeconds');
  if (targetTime < current.elapsedSeconds - 0.000000001) {
    throw new Error('detached dynamics cannot move backward in time');
  }
  const targetStep = Math.floor((targetTime + current.config.fixedStepSeconds * 0.000001) /
    current.config.fixedStepSeconds);
  const next = {
    ...current,
    bodies: current.bodies.map(cloneBody),
    retiredBodies: current.retiredBodies.map(cloneBody),
    launchKeys: [...current.launchKeys],
    config: { ...current.config },
  };
  while (next.stepCount < targetStep) {
    next.stepCount += 1;
    next.bodies = next.bodies.map(body => next.stepCount > body.launchStep
      ? integrateBody(body, next)
      : body);
  }
  next.elapsedSeconds = round(next.stepCount * next.config.fixedStepSeconds);
  return next;
}

export function resetDetachedDynamics(current) {
  if (current?.route !== DETACHED_DYNAMICS_ROUTE) {
    throw new Error('detached dynamics reset requires dynamics state');
  }
  return createDetachedDynamicsSidecar({
    ...current.config,
    generation: current.generation + 1,
  });
}
