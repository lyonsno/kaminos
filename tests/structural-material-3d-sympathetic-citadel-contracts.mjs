import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createLayeredStructuralMaterial } from '../structural-material-3d-core.js';
import { buildEffigyTileGeometrySidecar } from '../structural-material-3d-geometry-sidecar.js';
import {
  STRUCTURAL_MATERIAL_3D_SYMPATHETIC_CITADEL_CONSUMER_ROUTE,
  STRUCTURAL_MATERIAL_3D_SYMPATHETIC_EFFIGY_CONSUMER_ROUTE,
  buildSympatheticCitadelProjection,
} from '../structural-material-3d-sympathetic-citadel.js';

const root = new URL('..', import.meta.url).pathname;
const pageSource = readFileSync(join(root, 'structural-material-3d.html'), 'utf8');
const witnessSource = readFileSync(join(root, 'structural-material-3d-webgpu-hot-sidecar-witness.mjs'), 'utf8');
const greenroomSource = readFileSync(
  join(root, 'structural-material-3d-sympathetic-citadel-greenroom-launch.mjs'),
  'utf8',
);
const topologyProfile = 'three-turret-citadel-v0';
const citadel = createLayeredStructuralMaterial({
  columns: 13,
  rows: 7,
  layers: 3,
  notch: true,
  profile: 'rib-upper-v0',
  topologyProfile,
});

assert.equal(
  citadel.topologyProfile,
  topologyProfile,
  'the sympathetic witness needs an explicit topology identity rather than a decorative shell mask',
);
assert.equal(citadel.components.length, 1, 'two bridges must connect all three turrets into one accepted component');
assert.equal(citadel.nodes.length, 195, 'the bounded citadel topology must contain exactly its three towers and two bridges');

const nodeAt = (x, y, z) => citadel.nodes.find(node =>
  Math.abs(node.x - x / 12) < 0.00001 &&
  Math.abs(node.y - y / 6) < 0.00001 &&
  Math.abs(node.z - z / 2) < 0.00001);
assert.ok(nodeAt(1, 1, 1), 'the left turret must occupy the full side-tower height');
assert.ok(nodeAt(6, 0, 1), 'the center turret must rise above the side turrets');
assert.ok(nodeAt(11, 1, 1), 'the right turret must occupy the full side-tower height');
assert.ok(nodeAt(3, 2, 1) && nodeAt(4, 3, 1), 'the left bridge must connect left and center turrets');
assert.ok(nodeAt(8, 2, 1) && nodeAt(9, 3, 1), 'the right bridge must connect center and right turrets');
assert.equal(nodeAt(3, 0, 1), undefined, 'bridge airspace cannot remain as invisible structural matter');
assert.equal(nodeAt(9, 5, 1), undefined, 'the lower bridge gap must remain structurally absent');

const bellSocket = citadel.authoredSockets?.find(socket => socket.id === 'center-bell-tower-v0');
assert.ok(bellSocket, 'the center turret must preserve an explicit future bell-tower attachment socket');
assert.ok(bellSocket.nodeIds.length > 0, 'the bell-tower socket needs stable structural node identities');
assert.ok(
  bellSocket.nodeIds.every(nodeId => citadel.nodes.some(node => node.id === nodeId)),
  'every bell-tower socket node must belong to the accepted structural graph',
);

const geometry = buildEffigyTileGeometrySidecar(citadel, { profile: 'rib-upper-v0' });
assert.equal(geometry.status, 'passed', 'the masked citadel must remain a valid dual-cell geometry source');
assert.equal(geometry.topologyProfile, topologyProfile);
assert.match(geometry.assetIdentity, /three-turret-citadel-v0/, 'asset identity must distinguish citadel topology from a full slab');
assert.equal(geometry.cells.length, citadel.nodes.length, 'geometry cannot add or omit accepted structural cells');

const projection = buildSympatheticCitadelProjection(citadel, geometry, { effigyPreviewActive: true });
assert.equal(projection.status, 'passed');
assert.equal(projection.consumers.effigy.route, STRUCTURAL_MATERIAL_3D_SYMPATHETIC_EFFIGY_CONSUMER_ROUTE);
assert.equal(projection.consumers.citadel.route, STRUCTURAL_MATERIAL_3D_SYMPATHETIC_CITADEL_CONSUMER_ROUTE);
assert.equal(projection.consumers.effigy.previewActive, true);
assert.equal(projection.consumers.citadel.previewActive, false);
assert.equal(projection.consumers.citadel.acceptedStateOnly, true);
assert.equal(projection.consumers.effigy.acceptedState, projection.consumers.citadel.acceptedState);
assert.equal(
  projection.consumers.effigy.acceptedState.structuralFingerprint,
  projection.consumers.citadel.acceptedState.structuralFingerprint,
  'both representations must consume one accepted structural fingerprint',
);
assert.deepEqual(projection.bellTowerSocket, bellSocket);

assert.match(pageSource, /sympatheticCitadelMode/, 'the product page needs an explicit additive citadel route');
assert.match(
  pageSource,
  /STRUCTURAL_MATERIAL_3D_SYMPATHETIC_EFFIGY_CONSUMER_ROUTE/,
  'the small pickable body needs an effective consumer identity',
);
assert.match(
  pageSource,
  /STRUCTURAL_MATERIAL_3D_SYMPATHETIC_CITADEL_CONSUMER_ROUTE/,
  'the represented world needs a distinct consumer identity',
);
assert.match(
  pageSource,
  /intersectObjects\(world\.children, false\)/,
  'picking must stay confined to the effigy rather than ambiguously selecting the represented citadel',
);
assert.match(
  witnessSource,
  /sympatheticCitadelInitialIdentity/,
  'browser evidence must reject missing, fallback, or independently identified citadel consumers',
);
assert.match(
  witnessSource,
  /sympatheticCitadelPreviewIsolation/,
  'browser evidence must prove provisional compliance stays on the effigy while GPU execution is held',
);
assert.match(
  witnessSource,
  /sympatheticCitadelAcceptedCorrespondence/,
  'browser evidence must prove accepted fracture appears from one fingerprint in both consumers',
);
assert.match(greenroomSource, /sympathetic-citadel-greenroom-r1/, 'citadel evidence needs a dedicated artifact identity');
assert.match(greenroomSource, /sympatheticCitadel=1/, 'Greenroom must request the paired product route explicitly');

console.log('structural-material-3d sympathetic citadel contracts passed');
