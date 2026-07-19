import { buildLayeredStructuralSound } from './structural-material-3d-core.js';

export const STRUCTURAL_BELL_TOWER_SCHEMA = 'kaminos.structural-material.bell-tower-state.v0';
export const STRUCTURAL_BELL_TOWER_ROUTE = 'kaminos.structural-material.bell-tower.v0';
export const STRUCTURAL_BELL_TOWER_AUTHORITY = 'accepted-structural-crown-body-relative-motion-v0';
export const STRUCTURAL_BELL_RING_AUTHORITY = 'accepted-bell-relative-motion-to-material-ring-event-v0';

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(finite(value) * scale) / scale;
}

function currentPoint(node) {
  return {
    x: finite(node.x) + finite(node.displacement?.x),
    y: finite(node.y) + finite(node.displacement?.y),
    z: finite(node.z) + finite(node.displacement?.z),
  };
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function roundedPoint(value) {
  return { x: round(value.x), y: round(value.y), z: round(value.z) };
}

function magnitude(value) {
  return Math.hypot(value.x, value.y, value.z);
}

function requireBellParts(state) {
  if (state?.topologyProfile !== 'three-turret-bell-citadel-v0') {
    throw new Error('bell tower state requires three-turret-bell-citadel-v0 topology');
  }
  const bellNode = state.nodes.find(node => node.structuralRole === 'bell-body');
  const hanger = state.bonds.find(bond => bond.geometryRole === 'bell-hanger');
  if (!bellNode || !hanger) throw new Error('bell tower state requires one bell body and crown hanger');
  const crownNodeId = hanger.a === bellNode.id ? hanger.b : hanger.a;
  const crownNode = state.nodes.find(node => node.id === crownNodeId);
  if (!crownNode || crownNode.structuralRole !== 'bell-frame') {
    throw new Error('bell tower crown hanger must terminate at a frame node');
  }
  return { bellNode, crownNode, hanger };
}

export function deriveAcceptedBellTowerState(state) {
  const { bellNode, crownNode, hanger } = requireBellParts(state);
  const restAxis = subtract(bellNode, crownNode);
  const currentCrown = currentPoint(crownNode);
  const currentBell = currentPoint(bellNode);
  const currentAxis = subtract(currentBell, currentCrown);
  const deflection = subtract(currentAxis, restAxis);
  const attached = Boolean(hanger.alive) && bellNode.componentId === crownNode.componentId;
  return {
    schema: STRUCTURAL_BELL_TOWER_SCHEMA,
    route: STRUCTURAL_BELL_TOWER_ROUTE,
    authority: STRUCTURAL_BELL_TOWER_AUTHORITY,
    status: 'passed',
    topologyProfile: state.topologyProfile,
    topologyEpoch: state.topologyEpoch,
    connectivityEpoch: state.connectivityEpoch,
    bellNodeId: bellNode.id,
    crownNodeId: crownNode.id,
    hangerBondId: hanger.id,
    hangerAlive: Boolean(hanger.alive),
    attached,
    componentId: bellNode.componentId,
    crownComponentId: crownNode.componentId,
    restCrown: roundedPoint(crownNode),
    currentCrown: roundedPoint(currentCrown),
    restBellCenter: roundedPoint(bellNode),
    currentBellCenter: roundedPoint(currentBell),
    restAxis: roundedPoint(restAxis),
    currentAxis: roundedPoint(currentAxis),
    deflection: roundedPoint(deflection),
    deflectionMagnitude: round(magnitude(deflection)),
  };
}

export function advanceAcceptedStructuralBellTower(previousState, nextState, accepted = {}) {
  if (nextState?.topologyProfile !== 'three-turret-bell-citadel-v0') return nextState;
  if (accepted.accepted !== true) throw new Error('bell tower transition requires accepted structural state');
  if (!Number.isInteger(accepted.eventEpoch) || accepted.eventEpoch < 0) {
    throw new Error('bell tower transition requires accepted event epoch');
  }
  const previous = deriveAcceptedBellTowerState(previousState);
  const current = deriveAcceptedBellTowerState(nextState);
  const relativeDelta = subtract(current.deflection, previous.deflection);
  const relativeMotion = magnitude(relativeDelta);
  const threshold = Math.max(0.000001, finite(accepted.strikeThreshold, 0.012));
  const eventId = `bell-ring:${accepted.eventEpoch}`;
  const priorEvents = Array.isArray(nextState.sound?.events) ? nextState.sound.events : [];
  const duplicate = priorEvents.some(event => event.id === eventId);
  const shouldRing = accepted.operation === 'shear' && current.attached && relativeMotion >= threshold && !duplicate;
  const energy = shouldRing
    ? round(relativeMotion * relativeMotion * 22 + current.deflectionMagnitude * 0.18)
    : 0;
  const ringEvent = shouldRing
    ? {
        id: eventId,
        kind: 'ring',
        authority: STRUCTURAL_BELL_RING_AUTHORITY,
        source: 'structural-bell-tower',
        bellNodeId: current.bellNodeId,
        crownNodeId: current.crownNodeId,
        hangerBondId: current.hangerBondId,
        eventEpoch: accepted.eventEpoch,
        topologyEpoch: nextState.topologyEpoch,
        connectivityEpoch: nextState.connectivityEpoch,
        materialProfile: 'weathered-cast-bronze-v0',
        relativeMotion: round(relativeMotion),
        deflection: current.deflection,
        strain: round(relativeMotion / Math.max(0.000001, magnitude(current.restAxis))),
        energy,
        pitchHz: round(392 + Math.min(132, relativeMotion * 880), 3),
        midpoint: current.currentBellCenter,
        cause: 'accepted-relative-crown-body-motion',
      }
    : null;
  const events = ringEvent ? [...priorEvents, ringEvent] : priorEvents;
  const brokenBondCount = nextState.bonds.filter(bond => !bond.alive).length;
  const repairedBondCount = nextState.bonds.filter(bond => bond.repaired).length;
  return {
    ...nextState,
    bellTower: {
      ...current,
      acceptedEventEpoch: accepted.eventEpoch,
      operation: accepted.operation || null,
      relativeMotion: round(relativeMotion),
      strikeThreshold: round(threshold),
      ringEventId: ringEvent?.id || null,
      ringEmitted: Boolean(ringEvent),
    },
    sound: buildLayeredStructuralSound(events, brokenBondCount, repairedBondCount),
  };
}
