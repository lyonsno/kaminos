import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createLayeredStructuralMaterial } from '../structural-material-3d-core.js';
import { buildStructuralAssetSidecar } from '../structural-material-3d-asset-sidecar.js';
import { advanceAcceptedStructuralBellTower } from '../structural-material-3d-bell-tower.js';
import {
  DETACHED_DYNAMICS_AUTHORITY,
  DETACHED_DYNAMICS_ROUTE,
  advanceDetachedDynamicsToTime,
  createDetachedDynamicsSidecar,
  rebaseDetachedDynamicsClockOrigin,
  reconcileAcceptedDetachedDynamics,
  resetDetachedDynamics,
} from '../structural-material-3d-detached-dynamics.js';
import { buildEffigyTileGeometrySidecar } from '../structural-material-3d-geometry-sidecar.js';

const root = new URL('..', import.meta.url).pathname;
const pageSource = readFileSync(join(root, 'structural-material-3d.html'), 'utf8');
const witnessSource = readFileSync(join(root, 'structural-material-3d-webgpu-hot-sidecar-witness.mjs'), 'utf8');
const greenroomSource = readFileSync(
  join(root, 'structural-material-3d-detached-dynamics-greenroom-launch.mjs'),
  'utf8',
);

function assetsFor(state) {
  return buildStructuralAssetSidecar(
    state,
    buildEffigyTileGeometrySidecar(state, { profile: 'rib-upper-v0' }),
  );
}

const attached = createLayeredStructuralMaterial({
  columns: 13,
  rows: 10,
  layers: 3,
  notch: true,
  profile: 'rib-upper-v0',
  topologyProfile: 'three-turret-bell-citadel-v0',
});
const separated = structuredClone(attached);
const bell = separated.nodes.find(node => node.structuralRole === 'bell-body');
const hanger = separated.bonds.find(bond => bond.geometryRole === 'bell-hanger');
bell.displacement.x = 0.16;
bell.displacement.y = 0.015;
bell.displacement.z = -0.11;
hanger.alive = false;
separated.topologyEpoch = 1;
separated.connectivityEpoch = 1;
bell.componentId = 'g-bell';
separated.components = [
  {
    ...separated.components[0],
    nodeIds: separated.components[0].nodeIds.filter(nodeId => nodeId !== bell.id),
  },
  {
    id: 'g-bell',
    nodeIds: [bell.id],
    pinned: false,
    center: { x: bell.x, y: bell.y, z: bell.z },
    nodeCount: 1,
  },
];
const acceptedSeparation = advanceAcceptedStructuralBellTower(attached, separated, {
  accepted: true,
  eventEpoch: 1,
  operation: 'shear',
});
const attachedAssets = assetsFor(attached);
const detachedAssets = assetsFor(acceptedSeparation);
const structuralInputsBefore = JSON.stringify({ attachedAssets, detachedAssets });

const initial = createDetachedDynamicsSidecar({ groundPlaneY: 1.12 });
assert.equal(initial.route, DETACHED_DYNAMICS_ROUTE);
assert.equal(initial.authority, DETACHED_DYNAMICS_AUTHORITY);
assert.equal(initial.bodies.length, 0);

assert.throws(
  () => reconcileAcceptedDetachedDynamics(initial, attachedAssets, detachedAssets, {
    accepted: false,
    eventEpoch: 1,
    operation: 'shear',
    objectIdentity: 'bell-citadel-contract',
  }),
  /accepted structural transition/,
  'preview or rejected structural state cannot launch a body',
);

const stillAttached = reconcileAcceptedDetachedDynamics(initial, attachedAssets, attachedAssets, {
  accepted: true,
  eventEpoch: 1,
  operation: 'shear',
  objectIdentity: 'bell-citadel-contract',
});
assert.equal(stillAttached.bodies.length, 0, 'an attached asset cannot fabricate a dynamics body');

const launched = reconcileAcceptedDetachedDynamics(initial, attachedAssets, detachedAssets, {
  accepted: true,
  eventEpoch: 1,
  operation: 'shear',
  objectIdentity: 'bell-citadel-contract',
});
assert.equal(launched.bodies.length, 1, 'accepted separation launches exactly one bell body');
assert.equal(launched.bodies[0].assetAnchorId, 'asset-anchor:n279');
assert.equal(launched.bodies[0].componentId, 'g-bell');
assert.equal(launched.bodies[0].launchEventEpoch, 1);
assert.equal(launched.bodies[0].phase, 'airborne');
assert.ok(Math.hypot(...Object.values(launched.bodies[0].linearVelocity)) > 0);
assert.equal(JSON.stringify({ attachedAssets, detachedAssets }), structuralInputsBefore, 'dynamics cannot mutate asset or graph inputs');

const replay = reconcileAcceptedDetachedDynamics(launched, attachedAssets, detachedAssets, {
  accepted: true,
  eventEpoch: 1,
  operation: 'shear',
  objectIdentity: 'bell-citadel-contract',
});
assert.equal(replay.bodies.length, 1, 'exact accepted launch replay is idempotent');
assert.deepEqual(replay.launchKeys, launched.launchKeys);

const quarterSecond = advanceDetachedDynamicsToTime(launched, 0.25);
assert.equal(quarterSecond.bodies[0].phase, 'airborne');
assert.ok(quarterSecond.bodies[0].position.y > launched.bodies[0].position.y, 'positive material y falls toward ground');
assert.ok(quarterSecond.bodies[0].rotationAngle > 0, 'accepted shear seeds visible tumble');

const directOneSecond = advanceDetachedDynamicsToTime(launched, 1);
let sampledOneSecond = launched;
for (const time of [0.17, 0.41, 0.66, 0.83, 1]) {
  sampledOneSecond = advanceDetachedDynamicsToTime(sampledOneSecond, time);
}
assert.deepEqual(
  sampledOneSecond.bodies,
  directOneSecond.bodies,
  'absolute fixed-step advancement is independent of animation-frame sampling',
);

const settled = advanceDetachedDynamicsToTime(launched, 8);
const settledBell = settled.bodies[0];
assert.equal(settledBell.phase, 'settled');
assert.ok(settledBell.contactEpoch > 0, 'ground contact is explicit causal state');
assert.equal(settledBell.position.y, settledBell.groundCenterY, 'settled body cannot penetrate the authored plane');
assert.deepEqual(settledBell.linearVelocity, { x: 0, y: 0, z: 0 });
assert.equal(settledBell.angularSpeed, 0);

const reboundState = structuredClone(attached);
reboundState.topologyEpoch = 2;
reboundState.connectivityEpoch = 2;
const reboundAssets = assetsFor(reboundState);
const rebound = reconcileAcceptedDetachedDynamics(settled, detachedAssets, reboundAssets, {
  accepted: true,
  eventEpoch: 2,
  operation: 'bind',
  objectIdentity: 'bell-citadel-contract',
});
assert.equal(rebound.bodies.length, 0, 'accepted reattachment retires the detached render body');
assert.equal(rebound.retiredBodies.at(-1).retirementCause, 'accepted-structural-reattachment');
assert.equal(rebound.retiredBodies.at(-1).retirementEventEpoch, 2);

const reset = resetDetachedDynamics(launched);
assert.equal(reset.bodies.length, 0);
assert.equal(reset.retiredBodies.length, 0);
assert.equal(reset.generation, launched.generation + 1);
assert.equal('generation' in reset.config, false, 'lifecycle identity cannot leak into integrator config');

const secondLaunchOrigin = rebaseDetachedDynamicsClockOrigin(12_000, settled.elapsedSeconds);
assert.equal(secondLaunchOrigin, 4_000, 'new launch rebases wall time to current dynamics elapsed time');
assert.ok(
  Math.abs((12_016 - secondLaunchOrigin) / 1000 - 8.016) < 0.000001,
  'the first new frame advances from current fixed-step time rather than page age',
);

const staleAssets = structuredClone(detachedAssets);
staleAssets.connectivityEpoch = -1;
assert.throws(
  () => reconcileAcceptedDetachedDynamics(initial, attachedAssets, staleAssets, {
    accepted: true,
    eventEpoch: 1,
    operation: 'shear',
    objectIdentity: 'bell-citadel-contract',
  }),
  /epoch coherence/,
  'stale asset projection cannot launch post-separation motion',
);

assert.match(pageSource, /reconcileAcceptedDetachedDynamics/, 'accepted page mutations must reconcile dynamics state');
assert.match(pageSource, /advanceDetachedDynamicsToTime/, 'the represented world must advance fixed-step dynamics');
assert.match(pageSource, /applyDetachedDynamicsTransforms/, 'dynamics receipts must reach rendered authored assets');
assert.match(pageSource, /resetDetachedDynamics/, 'Reset must destroy detached bodies');
assert.match(pageSource, /DETACHED_DYNAMICS_AUTHORITY/, 'the page must expose dynamics authority');
assert.match(witnessSource, /detachedDynamicsAcceptedLaunch/, 'native witness must require accepted launch identity');
assert.match(witnessSource, /detachedDynamicsSettledContact/, 'native witness must require collision and settlement evidence');
assert.match(witnessSource, /detachedDynamicsRenderAgreement/, 'native witness must reject report-only body motion');
assert.match(
  witnessSource,
  /detachedDynamicsScreenshotEvidence/,
  'screenshot visibility must be diagnosed independently from render and camera agreement',
);
assert.match(
  witnessSource,
  /MIN_SETTLED_DYNAMICS_STRUCTURAL_COLOR_PIXELS = 24/,
  'settled screenshot calibration must preserve a measured structural-color floor',
);
assert.match(witnessSource, /detachedDynamicsSecondLaunchClock/, 'native witness must exercise a second launch episode');
assert.match(greenroomSource, /detached-dynamics-greenroom-r1/, 'dynamics evidence needs a dedicated artifact identity');
assert.match(greenroomSource, /bellTower=1/, 'dynamics Greenroom must request the structural bell route');

console.log('structural-material-3d detached dynamics contracts passed');
