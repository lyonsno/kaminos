export const STRUCTURAL_MATERIAL_3D_SYMPATHETIC_CITADEL_SCHEMA =
  'kaminos.structural-material.sympathetic-citadel-projection.v0';
export const STRUCTURAL_MATERIAL_3D_SYMPATHETIC_CITADEL_ROUTE =
  'kaminos.structural-material.sympathetic-citadel.v0';
export const STRUCTURAL_MATERIAL_3D_SYMPATHETIC_EFFIGY_CONSUMER_ROUTE =
  'kaminos.structural-material.sympathetic-effigy-consumer.v0';
export const STRUCTURAL_MATERIAL_3D_SYMPATHETIC_CITADEL_CONSUMER_ROUTE =
  'kaminos.structural-material.sympathetic-citadel-consumer.v0';
export const STRUCTURAL_MATERIAL_3D_SYMPATHETIC_CONSUMER_AUTHORITY =
  'one-accepted-structural-state-dual-geometry-consumers-v0';

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function sympatheticCitadelStructuralFingerprint(state) {
  if (!Array.isArray(state?.nodes) || !Array.isArray(state?.bonds)) {
    throw new Error('sympathetic citadel fingerprint requires structural state');
  }
  const payload = {
    topologyProfile: state.topologyProfile || null,
    topologyEpoch: state.topologyEpoch,
    connectivityEpoch: state.connectivityEpoch,
    nodes: state.nodes.map(node => [node.id, node.componentId]),
    bonds: state.bonds.map(bond => [bond.id, bond.a, bond.b, Boolean(bond.alive), Boolean(bond.repaired)]),
  };
  return `citadel-structural:${fnv1a(JSON.stringify(payload))}:n${state.nodes.length}:b${state.bonds.length}`;
}

export function buildSympatheticCitadelProjection(state, geometrySidecar, options = {}) {
  if (!['three-turret-citadel-v0', 'three-turret-bell-citadel-v0'].includes(state?.topologyProfile)) {
    throw new Error('sympathetic citadel projection requires a supported three-turret topology');
  }
  if (geometrySidecar?.status !== 'passed' || geometrySidecar.topologyProfile !== state.topologyProfile) {
    throw new Error('sympathetic citadel projection requires matching validated geometry');
  }
  if (
    geometrySidecar.topologyEpoch !== state.topologyEpoch ||
    geometrySidecar.connectivityEpoch !== state.connectivityEpoch ||
    geometrySidecar.cells.length !== state.nodes.length
  ) {
    throw new Error('sympathetic citadel projection rejected stale or partial geometry');
  }
  const structuralFingerprint = sympatheticCitadelStructuralFingerprint(state);
  const acceptedState = {
    topologyEpoch: state.topologyEpoch,
    connectivityEpoch: state.connectivityEpoch,
    structuralFingerprint,
    nodeCount: state.nodes.length,
    bondCount: state.bonds.length,
    aliveBondCount: state.bonds.filter(bond => bond.alive).length,
    componentCount: state.components.length,
  };
  const bellTowerSocket = geometrySidecar.authoredSockets
    .find(socket => socket.id === 'center-bell-tower-v0') || null;
  const bellCrownSocket = geometrySidecar.authoredSockets
    .find(socket => socket.id === 'bell-crown-v0') || null;
  return {
    schema: STRUCTURAL_MATERIAL_3D_SYMPATHETIC_CITADEL_SCHEMA,
    route: STRUCTURAL_MATERIAL_3D_SYMPATHETIC_CITADEL_ROUTE,
    authority: STRUCTURAL_MATERIAL_3D_SYMPATHETIC_CONSUMER_AUTHORITY,
    status: 'passed',
    sourceGeometryRoute: geometrySidecar.route,
    sourceGeometryAssetIdentity: geometrySidecar.assetIdentity,
    topologyProfile: state.topologyProfile,
    acceptedState,
    bellTowerSocket,
    bellCrownSocket,
    consumers: {
      effigy: {
        id: 'operator-effigy',
        route: STRUCTURAL_MATERIAL_3D_SYMPATHETIC_EFFIGY_CONSUMER_ROUTE,
        acceptedStateOnly: false,
        provisionalComplianceAllowed: true,
        pickAuthority: 'effigy-surface-only-v0',
        acceptedState,
        previewActive: options.effigyPreviewActive === true,
      },
      citadel: {
        id: 'represented-citadel',
        route: STRUCTURAL_MATERIAL_3D_SYMPATHETIC_CITADEL_CONSUMER_ROUTE,
        acceptedStateOnly: true,
        provisionalComplianceAllowed: false,
        pickAuthority: null,
        acceptedState,
        previewActive: false,
      },
    },
  };
}
