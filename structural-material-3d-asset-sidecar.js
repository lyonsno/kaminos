import { deriveAcceptedBellTowerState } from './structural-material-3d-bell-tower.js';

export const STRUCTURAL_ASSET_SIDECAR_SCHEMA = 'kaminos.structural-material.asset-sidecar.v0';
export const STRUCTURAL_ASSET_SIDECAR_ROUTE = 'kaminos.structural-material.asset-sidecar.v0';
export const STRUCTURAL_ASSET_SIDECAR_AUTHORITY = 'accepted-graph-to-render-asset-anchors-not-connectivity-v0';

const PROTOTYPES = {
  masonry: {
    assetId: 'citadel-masonry-block-v0',
    instancePolicy: 'shared-instanced-prototype',
    visualStatus: 'deterministic-block-fallback',
  },
  'bell-frame': {
    assetId: 'citadel-bell-frame-block-v0',
    instancePolicy: 'shared-instanced-prototype',
    visualStatus: 'deterministic-block-fallback',
  },
  'bell-body': {
    assetId: 'citadel-bell-v0',
    instancePolicy: 'single-authored-asset',
    visualStatus: 'awaiting-handy-candyman-cast',
    visualRef: null,
    proxyRef: null,
    attachmentSocketId: 'bell-crown-v0',
    materialProfile: 'weathered-cast-bronze-v0',
  },
};

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`structural asset sidecar requires finite ${label}`);
  return number;
}

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(finite(value, 'rounded value') * scale) / scale;
}

function roundedPoint(value) {
  return { x: round(value.x), y: round(value.y), z: round(value.z) };
}

function cellScale(cell) {
  return {
    x: round(cell.restBounds.x.max - cell.restBounds.x.min),
    y: round(cell.restBounds.y.max - cell.restBounds.y.min),
    z: round(cell.restBounds.z.max - cell.restBounds.z.min),
  };
}

function cellAssetCenter(cell, accepted) {
  return roundedPoint({
    x: (cell.restBounds.x.min + cell.restBounds.x.max) * 0.5 + accepted.displacement.x,
    y: (cell.restBounds.y.min + cell.restBounds.y.max) * 0.5 + accepted.displacement.y,
    z: (cell.restBounds.z.min + cell.restBounds.z.max) * 0.5 + accepted.displacement.z,
  });
}

export function buildStructuralAssetSidecar(state, geometrySidecar) {
  if (geometrySidecar?.status !== 'passed') {
    throw new Error('structural asset sidecar requires validated geometry');
  }
  if (
    geometrySidecar.topologyProfile !== state?.topologyProfile ||
    geometrySidecar.topologyEpoch !== state?.topologyEpoch ||
    geometrySidecar.connectivityEpoch !== state?.connectivityEpoch ||
    geometrySidecar.cells.length !== state?.nodes?.length
  ) {
    throw new Error('structural asset sidecar rejected stale or partial structural geometry');
  }
  const componentById = new Map((state.components || []).map(component => [component.id, component]));
  const bell = state.topologyProfile === 'three-turret-bell-citadel-v0'
    ? deriveAcceptedBellTowerState(state)
    : null;
  const nodeById = new Map(state.nodes.map(node => [node.id, node]));
  const anchors = geometrySidecar.cells.map(cell => {
    const role = cell.structuralRole || 'masonry';
    const prototype = PROTOTYPES[role];
    if (!prototype) throw new Error(`structural asset sidecar has no prototype for role ${role}`);
    const component = componentById.get(cell.componentId) || null;
    const bellBody = role === 'bell-body';
    const acceptedNode = nodeById.get(cell.structuralNodeId);
    if (!acceptedNode) throw new Error(`structural asset sidecar has no accepted node ${cell.structuralNodeId}`);
    const blockRestCenter = cellAssetCenter(cell, { displacement: { x: 0, y: 0, z: 0 } });
    const blockCurrentCenter = cellAssetCenter(cell, acceptedNode);
    return {
      id: `asset-anchor:${cell.structuralNodeId}`,
      structuralNodeId: cell.structuralNodeId,
      structuralRole: role,
      componentId: cell.componentId,
      prototype: { ...prototype },
      acceptedState: {
        topologyEpoch: state.topologyEpoch,
        connectivityEpoch: state.connectivityEpoch,
      },
      restTranslation: bellBody ? { ...bell.restCrown } : blockRestCenter,
      currentTranslation: bellBody ? { ...bell.currentCrown } : blockCurrentCenter,
      acceptedCrownPoint: bellBody ? { ...bell.currentCrown } : null,
      acceptedBodyCenter: bellBody ? { ...bell.currentBellCenter } : blockCurrentCenter,
      acceptedBodyAxis: bellBody ? { ...bell.currentAxis } : null,
      scale: cellScale(cell),
      rotationQuaternion: bellBody ? [0, 0, 1, 0] : [0, 0, 0, 1],
      pivotAuthority: bellBody ? 'bell-crown-v0' : 'structural-cell-center-v0',
      motionAuthority: 'accepted-structural-node-displacement-v0',
      separationAuthority: 'accepted-structural-component-id-v0',
      attached: bellBody ? bell.attached : true,
      tumbleEligible: Boolean(component && !component.pinned),
    };
  });
  const bellAnchors = anchors.filter(anchor => anchor.structuralRole === 'bell-body');
  const status = state.topologyProfile === 'three-turret-bell-citadel-v0' && bellAnchors.length !== 1
    ? 'failed'
    : 'passed';
  return {
    schema: STRUCTURAL_ASSET_SIDECAR_SCHEMA,
    route: STRUCTURAL_ASSET_SIDECAR_ROUTE,
    authority: STRUCTURAL_ASSET_SIDECAR_AUTHORITY,
    status,
    sourceGeometryRoute: geometrySidecar.route,
    sourceGeometryAssetIdentity: geometrySidecar.assetIdentity,
    topologyProfile: state.topologyProfile,
    topologyEpoch: state.topologyEpoch,
    connectivityEpoch: state.connectivityEpoch,
    assetKit: Object.values(PROTOTYPES).map(prototype => ({ ...prototype })),
    anchors,
    bell,
    summary: {
      anchorCount: anchors.length,
      instancedAnchorCount: anchors.filter(anchor => anchor.prototype.instancePolicy === 'shared-instanced-prototype').length,
      authoredAnchorCount: anchors.filter(anchor => anchor.prototype.instancePolicy === 'single-authored-asset').length,
      tumbleEligibleCount: anchors.filter(anchor => anchor.tumbleEligible).length,
      attachedBellCount: bellAnchors.filter(anchor => anchor.attached).length,
    },
  };
}
