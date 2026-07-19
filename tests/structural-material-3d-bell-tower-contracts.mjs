import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createLayeredStructuralMaterial } from '../structural-material-3d-core.js';
import {
  STRUCTURAL_ASSET_SIDECAR_AUTHORITY,
  buildStructuralAssetSidecar,
} from '../structural-material-3d-asset-sidecar.js';
import {
  STRUCTURAL_BELL_RING_AUTHORITY,
  advanceAcceptedStructuralBellTower,
  deriveAcceptedBellTowerState,
} from '../structural-material-3d-bell-tower.js';
import { buildEffigyTileGeometrySidecar } from '../structural-material-3d-geometry-sidecar.js';

const root = new URL('..', import.meta.url).pathname;
const pageSource = readFileSync(join(root, 'structural-material-3d.html'), 'utf8');
const witnessSource = readFileSync(join(root, 'structural-material-3d-webgpu-hot-sidecar-witness.mjs'), 'utf8');
const greenroomSource = readFileSync(
  join(root, 'structural-material-3d-bell-tower-greenroom-launch.mjs'),
  'utf8',
);

const topologyProfile = 'three-turret-bell-citadel-v0';
const bellCitadel = createLayeredStructuralMaterial({
  columns: 13,
  rows: 10,
  layers: 3,
  notch: true,
  profile: 'rib-upper-v0',
  topologyProfile,
});

assert.equal(bellCitadel.topologyProfile, topologyProfile);
assert.equal(bellCitadel.nodes.length, 217, 'the bell citadel contains 195 masonry, 21 frame, and one bell node');
assert.equal(bellCitadel.components.length, 1, 'the intact bell, frame, bridges, and three towers begin connected');

const nodeAt = (x, y, z) => bellCitadel.nodes.find(node =>
  Math.abs(node.x - x / 12) < 0.00001 &&
  Math.abs(node.y - y / 9) < 0.00001 &&
  Math.abs(node.z - z / 2) < 0.00001);

assert.equal(
  bellCitadel.nodes.filter(node => node.structuralRole === 'masonry').length,
  195,
  'the proven three-tower body remains the masonry substrate',
);
assert.equal(
  bellCitadel.nodes.filter(node => node.structuralRole === 'bell-frame').length,
  21,
  'the roof and paired posts are graph-owned frame members',
);
assert.equal(
  bellCitadel.nodes.filter(node => node.structuralRole === 'bell-body').length,
  1,
  'the authored bell consumes one stable graph anchor rather than replacing the tower',
);
assert.equal(nodeAt(6, 1, 1)?.structuralRole, 'bell-body', 'the bell hangs in the middle depth layer');
assert.equal(nodeAt(6, 2, 1), undefined, 'structural air remains below the hanging bell');
assert.equal(nodeAt(5, 2, 1)?.structuralRole, 'bell-frame', 'the left post reaches the center tower');
assert.equal(nodeAt(7, 2, 1)?.structuralRole, 'bell-frame', 'the right post reaches the center tower');
assert.equal(nodeAt(6, 3, 1)?.structuralRole, 'masonry', 'the center turret remains below the bell airspace');

const hangerBonds = bellCitadel.bonds.filter(bond => bond.geometryRole === 'bell-hanger');
assert.equal(hangerBonds.length, 1, 'the bell has exactly one mechanically intelligible crown hanger');
assert.equal(hangerBonds[0].bondKind, 'hanger');
assert.equal(hangerBonds[0].alive, true);
assert.ok(
  [hangerBonds[0].a, hangerBonds[0].b].includes(nodeAt(6, 1, 1).id),
  'the crown hanger owns the bell-body node',
);
assert.equal(
  bellCitadel.bonds.filter(bond =>
    [bond.a, bond.b].includes(nodeAt(6, 1, 1).id) && bond.geometryRole !== 'bell-hanger').length,
  0,
  'frame braces cannot secretly give the bell extra attachments',
);

const towerRoot = bellCitadel.authoredSockets.find(socket => socket.id === 'center-bell-tower-v0');
const bellCrown = bellCitadel.authoredSockets.find(socket => socket.id === 'bell-crown-v0');
assert.equal(towerRoot?.kind, 'structural-subsystem-root');
assert.equal(towerRoot?.nodeIds.length, 9, 'the tower subsystem roots into the nine center-turret cap nodes');
assert.equal(bellCrown?.kind, 'authored-asset-attachment');
assert.deepEqual(
  new Set(bellCrown?.nodeIds),
  new Set([hangerBonds[0].a, hangerBonds[0].b]),
  'the authored bell crown names the exact structural hanger endpoints',
);

const geometry = buildEffigyTileGeometrySidecar(bellCitadel, { profile: 'rib-upper-v0' });
assert.equal(geometry.status, 'passed', 'the bell manifold remains a valid topology-derived surface');
assert.equal(geometry.cells.length, bellCitadel.nodes.length);
assert.equal(geometry.cells.find(cell => cell.structuralNodeId === nodeAt(6, 1, 1).id)?.structuralRole, 'bell-body');
assert.ok(
  geometry.faces
    .filter(face => face.structuralNodeId === nodeAt(6, 1, 1).id)
    .every(face => face.structuralRole === 'bell-body'),
  'bell surface faces preserve their structural role for authored-asset substitution',
);

const initialBell = deriveAcceptedBellTowerState(bellCitadel);
assert.equal(initialBell.attached, true);
assert.equal(initialBell.deflectionMagnitude, 0);
assert.equal(initialBell.hangerBondId, hangerBonds[0].id);

const initialAssets = buildStructuralAssetSidecar(bellCitadel, geometry);
assert.equal(initialAssets.status, 'passed');
assert.equal(initialAssets.authority, STRUCTURAL_ASSET_SIDECAR_AUTHORITY);
assert.equal(initialAssets.summary.anchorCount, 217);
assert.equal(initialAssets.summary.instancedAnchorCount, 216);
assert.equal(initialAssets.summary.authoredAnchorCount, 1);
assert.equal(initialAssets.summary.attachedBellCount, 1);
const bellAsset = initialAssets.anchors.find(anchor => anchor.structuralRole === 'bell-body');
const masonryAsset = initialAssets.anchors.find(anchor => anchor.structuralRole === 'masonry');
const masonryCell = geometry.cells.find(cell => cell.structuralNodeId === masonryAsset.structuralNodeId);
assert.equal(bellAsset.prototype.assetId, 'citadel-bell-v0');
assert.equal(bellAsset.prototype.visualStatus, 'awaiting-handy-candyman-cast');
assert.equal(bellAsset.pivotAuthority, 'bell-crown-v0');
assert.deepEqual(bellAsset.currentTranslation, initialBell.currentCrown);
assert.deepEqual(bellAsset.acceptedCrownPoint, initialBell.currentCrown);
assert.deepEqual(bellAsset.acceptedBodyCenter, initialBell.currentBellCenter);
assert.equal(bellAsset.tumbleEligible, false);
assert.deepEqual(
  masonryAsset.acceptedBodyCenter,
  {
    x: Math.round((masonryCell.restBounds.x.min + masonryCell.restBounds.x.max) * 500000) / 1000000,
    y: Math.round((masonryCell.restBounds.y.min + masonryCell.restBounds.y.max) * 500000) / 1000000,
    z: Math.round((masonryCell.restBounds.z.min + masonryCell.restBounds.z.max) * 500000) / 1000000,
  },
  'instance anchors use geometric cell centers rather than assuming boundary cells are node-centered',
);

const moved = structuredClone(bellCitadel);
const movedBellNode = moved.nodes.find(node => node.structuralRole === 'bell-body');
movedBellNode.displacement.x = 0.035;
const ringing = advanceAcceptedStructuralBellTower(bellCitadel, moved, {
  accepted: true,
  eventEpoch: 7,
  operation: 'shear',
});
assert.equal(ringing.bellTower.ringEmitted, true, 'accepted attached bell motion emits a causal ring');
assert.ok(ringing.bellTower.relativeMotion >= 0.035);
const ringEvent = ringing.sound.events.find(event => event.id === 'bell-ring:7');
assert.equal(ringEvent.authority, STRUCTURAL_BELL_RING_AUTHORITY);
assert.equal(ringEvent.hangerBondId, hangerBonds[0].id);
assert.equal(ringEvent.materialProfile, 'weathered-cast-bronze-v0');
assert.ok(ringEvent.energy > 0 && ringEvent.pitchHz > 0);
assert.ok(ringing.sound.resonance > 0, 'the material sound summary exposes bell resonance');

const replayed = advanceAcceptedStructuralBellTower(bellCitadel, ringing, {
  accepted: true,
  eventEpoch: 7,
  operation: 'shear',
});
assert.equal(replayed.sound.events.filter(event => event.id === 'bell-ring:7').length, 1, 'accepted epoch replay is silent');
assert.equal(replayed.bellTower.ringEmitted, false);

const detached = structuredClone(moved);
const detachedHanger = detached.bonds.find(bond => bond.geometryRole === 'bell-hanger');
detachedHanger.alive = false;
detached.topologyEpoch += 1;
detached.connectivityEpoch += 1;
const detachedBellNode = detached.nodes.find(node => node.structuralRole === 'bell-body');
detachedBellNode.componentId = 'c-detached-bell';
detached.components = [
  { ...detached.components[0], nodeIds: detached.components[0].nodeIds.filter(id => id !== detachedBellNode.id) },
  {
    id: 'c-detached-bell',
    nodeIds: [detachedBellNode.id],
    pinned: false,
    center: { x: detachedBellNode.x, y: detachedBellNode.y, z: detachedBellNode.z },
    nodeCount: 1,
  },
];
assert.equal(deriveAcceptedBellTowerState(detached).attached, false);
const silentDetached = advanceAcceptedStructuralBellTower(bellCitadel, detached, {
  accepted: true,
  eventEpoch: 8,
  operation: 'shear',
});
assert.equal(silentDetached.bellTower.ringEmitted, false, 'a detached bell cannot counterfeit an attached strike');
assert.equal(silentDetached.sound.events.some(event => event.id === 'bell-ring:8'), false);
const detachedGeometry = buildEffigyTileGeometrySidecar(silentDetached, { profile: 'rib-upper-v0' });
const detachedAssets = buildStructuralAssetSidecar(silentDetached, detachedGeometry);
const detachedBellAsset = detachedAssets.anchors.find(anchor => anchor.structuralRole === 'bell-body');
assert.equal(detachedBellAsset.attached, false);
assert.equal(detachedBellAsset.tumbleEligible, true, 'accepted separation makes the bell eligible for a later physics consumer');

assert.match(
  pageSource,
  /structuralRole: node\.structuralRole/,
  'projected browser targets must preserve graph role so bell evidence cannot use an arbitrary center pick',
);
assert.match(
  pageSource,
  /bellTowerMode[\s\S]+structuralRole === 'bell-body'/,
  'the bell route must target its graph-owned bell body for automated and operator drags',
);
assert.match(
  pageSource,
  /new THREE\.InstancedMesh/,
  'the represented citadel must consume repeated block anchors as actual instances rather than descriptor-only promises',
);
assert.match(
  pageSource,
  /kind: 'instanced-structural-blocks'/,
  'instanced block batches need inspectable consumer identity',
);
assert.match(
  witnessSource,
  /bellTowerRequested/,
  'the browser witness must record whether the requested route includes the structural bell tower',
);
assert.match(
  witnessSource,
  /bellTowerInitialIdentity/,
  'native WebGPU evidence must reject a fallback topology or missing asset-sidecar identity',
);
assert.match(
  witnessSource,
  /bellTowerAcceptedMotionAndRing/,
  'native WebGPU evidence must connect accepted bell motion to a material-derived ring event',
);
assert.match(greenroomSource, /structural-bell-tower-greenroom-r1/, 'bell evidence needs a dedicated artifact identity');
assert.match(greenroomSource, /bellTower=1/, 'Greenroom must request the structural bell route explicitly');

console.log('structural-material-3d bell tower contracts passed');
