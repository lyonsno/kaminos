import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  STRUCTURAL_MATERIAL_3D_ROUTE,
  STRUCTURAL_MATERIAL_3D_SCHEMA,
  STRUCTURAL_MATERIAL_3D_SOLVER_AUTHORITY,
  STRUCTURAL_MATERIAL_3D_VISUAL_AUTHORITY,
  applyLayeredStructuralInteraction,
  bindLayeredStructuralConnectivity,
  buildLayeredStructuralWitnessScenario,
  createLayeredStructuralDragInteraction,
  createLayeredStructuralMaterial,
  createLayeredStructuralPickedDragInteraction,
  evaluateLayeredStructuralBondResponse,
  summarizeLayeredStructuralState,
} from '../structural-material-3d-core.js';

const root = new URL('..', import.meta.url).pathname;
const corePath = join(root, 'structural-material-3d-core.js');
const witnessPath = join(root, 'structural-material-3d-witness.mjs');
const cameraWitnessPath = join(root, 'structural-material-3d-camera-witness.mjs');
const pagePath = join(root, 'structural-material-3d.html');

assert.ok(existsSync(corePath), 'layered structural sidecar core module exists');
assert.ok(existsSync(witnessPath), 'layered structural sidecar witness runner exists');
assert.ok(existsSync(cameraWitnessPath), 'operator camera ownership has a reusable browser witness');
assert.ok(existsSync(pagePath), 'layered structural sidecar browser route exists');

const coreSource = readFileSync(corePath, 'utf8');
const witnessSource = readFileSync(witnessPath, 'utf8');
const cameraWitnessSource = readFileSync(cameraWitnessPath, 'utf8');
const pageSource = readFileSync(pagePath, 'utf8');

assert.equal(STRUCTURAL_MATERIAL_3D_SCHEMA, 'kaminos.structural-material.layered-sidecar.v0');
assert.equal(STRUCTURAL_MATERIAL_3D_ROUTE, 'kaminos.structural-material.layered-slab-fracture.v0');
assert.equal(STRUCTURAL_MATERIAL_3D_SOLVER_AUTHORITY, 'deterministic-layered-graph-force-fracture-v0');
assert.equal(STRUCTURAL_MATERIAL_3D_VISUAL_AUTHORITY, 'threejs-sidecar-consumer-not-truth-v0');
assert.match(coreSource, /crossDepthBondCount/, 'sidecar summary exposes through-thickness connectivity');
assert.match(coreSource, /material-derived-sound-impulses-v0/, '3D path preserves material-derived sound authority');
assert.match(witnessSource, /failurePhase/, 'witness writes failure phase if primary output cannot complete');
assert.match(witnessSource, /requestedRoute/, 'witness records requested route identity');
assert.match(witnessSource, /effectiveRoute/, 'witness records effective route identity');
assert.match(cameraWitnessSource, /failurePhase/, 'camera witness records failure phase before primary evidence completes');
assert.match(cameraWitnessSource, /requestedRoute/, 'camera witness records requested structural route');
assert.match(cameraWitnessSource, /effectiveRoute/, 'camera witness records effective structural route');
assert.match(cameraWitnessSource, /materialDragPreservedCamera/, 'camera witness rejects material/camera ownership collisions');
assert.match(cameraWitnessSource, /orbitChangedCamera/, 'camera witness proves camera controls are not inert');
assert.match(cameraWitnessSource, /backgroundDragAuthoredNoForce/, 'camera witness rejects material force authored from an empty-canvas orbit');
assert.match(cameraWitnessSource, /postOrbitForceFollowedCamera/, 'camera witness proves post-orbit drag uses the current camera basis');
assert.match(cameraWitnessSource, /postOrbitContactStayedPicked/, 'camera witness proves drag remains anchored at its picked contact');
assert.match(cameraWitnessSource, /pixelProbe/, 'camera witness rejects blank visual output');
assert.match(cameraWitnessSource, /Network\.setCacheDisabled/, 'camera witness cannot consume stale module cache as current evidence');
assert.match(pageSource, /threejs-sidecar-consumer-not-truth-v0/, 'browser declares the Three.js consumer is not structural authority');
assert.match(pageSource, /window\.__structuralMaterial3dWitness/, 'browser exposes smoke witness state for automation');
assert.match(pageSource, /window\.__structuralMaterial3dPixelProbe/, 'browser exposes renderer pixel probe for visual smoke');
assert.match(pageSource, /pointermove/, 'browser route keeps click-drag interaction live');
assert.match(pageSource, /readPixels/, 'browser route supports canvas pixel evidence');
assert.match(pageSource, /OrbitControls/, 'browser provides independent operator camera controls');
assert.match(pageSource, /operator-camera-controls-v0/, 'browser reports operator camera-control authority');
assert.match(pageSource, /runStructuralMutation/, 'structural actions enforce camera-state isolation');
assert.match(pageSource, /new THREE\.Raycaster\(\)/, 'primary contact uses rendered-geometry picking');
assert.match(pageSource, /function pickStructuralContact\(/, 'material drag begins only from an explicit structural hit');
assert.match(pageSource, /function cameraBasisInMaterial\(/, 'screen drag is projected through the live camera basis');
assert.match(pageSource, /LEFT:\s*THREE\.MOUSE\.ROTATE/, 'primary drag on empty canvas belongs to operator orbit');
assert.match(pageSource, /pointerdown[^]*?pickStructuralContact[^]*?addEventListener\([^]*?true\s*\)/, 'material hit arbitration runs before OrbitControls consumes primary down');
assert.match(pageSource, /inputLoad[^]*?gpuPending/, 'browser witness separates immediate input load from GPU completion state');
assert.doesNotMatch(pageSource, /yaw\s*\+=\s*event\.movementX/, 'idle pointer motion cannot rotate the material or camera');
const resizeSource = pageSource.match(/function resize\(\) \{[\s\S]*?\n    \}/)?.[0] || '';
assert.ok(resizeSource, 'browser route exposes a bounded resize handler');
assert.doesNotMatch(resizeSource, /camera\.position/, 'viewport resize preserves the operator camera position');

const force = {
  kind: 'screen-space-layered-drag',
  point: { x: 0.92, y: 0.52, z: 0.85 },
  vector: { x: 1, y: 0.08, z: -0.64 },
  magnitude: 1.46,
  radius: 0.26,
};

const notched = createLayeredStructuralMaterial({ columns: 9, rows: 5, layers: 4, notch: true });
const unnotched = createLayeredStructuralMaterial({ columns: 9, rows: 5, layers: 4, notch: false });
const lowForce = createLayeredStructuralMaterial({ columns: 9, rows: 5, layers: 4, notch: true });

const initialSummary = summarizeLayeredStructuralState(notched);
assert.equal(initialSummary.layerCount, 4, 'layered material preserves requested depth layers');
assert.ok(initialSummary.crossDepthBondCount > 0, 'layered material has explicit cross-depth bonds');
assert.equal(initialSummary.sidecar.structuralTruthAuthority, STRUCTURAL_MATERIAL_3D_SOLVER_AUTHORITY);
assert.equal(initialSummary.sidecar.visualConsumerAuthority, STRUCTURAL_MATERIAL_3D_VISUAL_AUTHORITY);
assert.ok(initialSummary.sidecar.storageShape.nodeFields.includes('position3'), 'sidecar records 3D node storage fields');
assert.ok(initialSummary.sidecar.storageShape.bondFields.includes('alive'), 'sidecar records persistent bond liveness');

function stressLocus(state, interaction) {
  const weighted = state.bonds.map(bond => ({
    bond,
    stress: evaluateLayeredStructuralBondResponse(bond, interaction).stress,
  }));
  const totalStress = weighted.reduce((total, entry) => total + entry.stress, 0);
  const peak = weighted.reduce((best, entry) => entry.stress > best.stress ? entry : best, weighted[0]);
  return {
    centroidX: weighted.reduce((total, entry) => total + entry.bond.midpoint.x * entry.stress, 0) / totalStress,
    peakX: peak.bond.midpoint.x,
    fingerprint: weighted.map(entry => entry.stress.toFixed(6)).join(':'),
  };
}

const upperLeftContact = {
  ...force,
  point: { x: 0.18, y: 0.24, z: 0.5 },
  radius: 0.18,
};
const upperRightContact = {
  ...upperLeftContact,
  point: { ...upperLeftContact.point, x: 0.88 },
};
const upperLeftLocus = stressLocus(notched, upperLeftContact);
const upperRightLocus = stressLocus(notched, upperRightContact);
assert.notEqual(
  upperLeftLocus.fingerprint,
  upperRightLocus.fingerprint,
  'changing only picked x must change the solver stress field',
);
assert.ok(
  upperRightLocus.centroidX > upperLeftLocus.centroidX + 0.12,
  'force-equivalent separated picks move the weighted structural stress locus',
);
assert.ok(
  upperRightLocus.peakX > upperLeftLocus.peakX + 0.12,
  'force-equivalent separated picks move the peak structural stress neighborhood',
);
const nearAnchorLoci = [0, 0.02, 0.04].map(x => stressLocus(notched, {
  ...upperLeftContact,
  point: { ...upperLeftContact.point, x },
}));
assert.ok(
  nearAnchorLoci.every(locus => Number.isFinite(locus.centroidX) && locus.centroidX < 0.15),
  'near-zero contacts remain finite and localized on the anchor side of the material',
);
assert.ok(
  nearAnchorLoci[0].centroidX < nearAnchorLoci[1].centroidX &&
    nearAnchorLoci[1].centroidX < nearAnchorLoci[2].centroidX,
  'the deliberate contact-x floor stays continuous enough to preserve sub-floor contact ordering',
);

const coreModule = await import('../structural-material-3d-core.js');
assert.equal(
  typeof coreModule.resolveLayeredStructuralRestContact,
  'function',
  'picked rendered geometry has an explicit stable rest-material contact resolver',
);
const displacedNodeState = structuredClone(notched);
const displacedNode = displacedNodeState.nodes.find(node => !node.pinned && node.x > 0.7 && node.y < 0.3);
displacedNode.displacement = { x: -0.42, y: 0.17, z: -0.08 };
const displayedNodePoint = {
  x: displacedNode.x + displacedNode.displacement.x,
  y: displacedNode.y + displacedNode.displacement.y,
  z: displacedNode.z + displacedNode.displacement.z,
};
const resolvedNodeContact = coreModule.resolveLayeredStructuralRestContact(displacedNodeState, {
  kind: 'node',
  id: displacedNode.id,
  displayPoint: displayedNodePoint,
});
assert.deepEqual(
  resolvedNodeContact.point,
  { x: displacedNode.x, y: displacedNode.y, z: displacedNode.z },
  'a displaced node pick resolves to its authored rest-material point',
);
assert.deepEqual(
  resolvedNodeContact.displayPoint,
  displayedNodePoint,
  'a displaced node pick preserves the separately rendered contact point',
);

const pickedBond = displacedNodeState.bonds.find(bond => bond.a === displacedNode.id || bond.b === displacedNode.id);
const bondA = displacedNodeState.nodes.find(node => node.id === pickedBond.a);
const bondB = displacedNodeState.nodes.find(node => node.id === pickedBond.b);
const bondSegmentT = 0.25;
const resolvedBondContact = coreModule.resolveLayeredStructuralRestContact(displacedNodeState, {
  kind: 'bond',
  id: pickedBond.id,
  segmentT: bondSegmentT,
  displayPoint: { x: 0.13, y: 0.27, z: 0.41 },
});
assert.deepEqual(resolvedBondContact.point, {
  x: Number((bondA.x + (bondB.x - bondA.x) * bondSegmentT).toFixed(6)),
  y: Number((bondA.y + (bondB.y - bondA.y) * bondSegmentT).toFixed(6)),
  z: Number((bondA.z + (bondB.z - bondA.z) * bondSegmentT).toFixed(6)),
}, 'a displayed bond hit fraction interpolates authored endpoints');

const shortDrag = createLayeredStructuralDragInteraction({
  start: { x: 0.48, y: 0.5 },
  current: { x: 0.56, y: 0.51 },
});
const longDrag = createLayeredStructuralDragInteraction({
  start: { x: 0.48, y: 0.5 },
  current: { x: 0.93, y: 0.58 },
  depthBias: -0.7,
});
assert.equal(shortDrag.kind, 'screen-space-layered-drag');
assert.equal(longDrag.authority, 'screen-space-drag-to-layered-force-envelope-v0');
assert.ok(longDrag.magnitude > shortDrag.magnitude, 'longer drag gestures produce stronger layered force');
assert.ok(longDrag.point.z > shortDrag.point.z, 'depth bias can move the force toward the front/back skin');
assert.ok(longDrag.vector.z < -0.2, 'layered drag can include through-thickness shear');

const pickedContact = { x: 0.61, y: 0.44, z: 0.73 };
const pickedScreenDrag = createLayeredStructuralPickedDragInteraction({
  start: { x: 0.4, y: 0.5 },
  current: { x: 0.7, y: 0.65 },
  contactPoint: pickedContact,
  screenRight: { x: 1, y: 0, z: 0 },
  screenDown: { x: 0, y: 1, z: 0 },
});
assert.deepEqual(pickedScreenDrag.point, pickedContact, 'picked force remains anchored at the structural contact point');
assert.deepEqual(pickedScreenDrag.start, pickedContact, 'force visualization begins at the picked structural contact');
assert.ok(pickedScreenDrag.vector.x > 0.85 && pickedScreenDrag.vector.y > 0.4, 'screen delta composes through the supplied camera basis');
assert.equal(pickedScreenDrag.authority, 'camera-relative-picked-contact-force-envelope-v0');
assert.ok(pickedScreenDrag.inputLoad > 0, 'nonzero pointer displacement reports immediate input load');
assert.equal(pickedScreenDrag.contactRamp, 1, 'strong input reports saturated solver contact ramp separately');

const pickedAfterOrbit = createLayeredStructuralPickedDragInteraction({
  start: { x: 0.4, y: 0.5 },
  current: { x: 0.7, y: 0.5 },
  contactPoint: pickedContact,
  screenRight: { x: 0, y: 0, z: -1 },
  screenDown: { x: 0, y: 1, z: 0 },
});
assert.deepEqual(pickedAfterOrbit.point, pickedContact, 'camera changes do not move the picked contact');
assert.ok(pickedAfterOrbit.vector.z < -0.99, 'rightward screen drag follows the post-orbit camera right basis');
assert.ok(Math.abs(pickedAfterOrbit.vector.x) < 0.001, 'post-orbit drag does not leak the original structural x basis');

const displacedDisplayedContact = { x: -0.14, y: 0.72, z: 1.08 };
const pickedWithDisplacedDisplay = createLayeredStructuralPickedDragInteraction({
  start: { x: 0.4, y: 0.5 },
  current: { x: 0.7, y: 0.5 },
  contactPoint: pickedContact,
  displayContactPoint: displacedDisplayedContact,
  screenRight: { x: 1, y: 0, z: 0 },
  screenDown: { x: 0, y: 1, z: 0 },
});
assert.deepEqual(pickedWithDisplacedDisplay.point, pickedContact, 'solver contact remains in authored material coordinates');
assert.deepEqual(pickedWithDisplacedDisplay.displayPoint, displacedDisplayedContact, 'visible contact can remain outside the authored rest volume');
assert.deepEqual(pickedWithDisplacedDisplay.start, displacedDisplayedContact, 'force marker begins at the displaced rendered contact');

const pickedWithoutMotion = createLayeredStructuralPickedDragInteraction({
  start: { x: 0.4, y: 0.5 },
  current: { x: 0.4, y: 0.5 },
  contactPoint: pickedContact,
  screenRight: { x: 0, y: 0, z: -1 },
  screenDown: { x: 0, y: 1, z: 0 },
});
assert.equal(pickedWithoutMotion.inputLoad, 0, 'pointer down alone does not impersonate applied load');
assert.equal(pickedWithoutMotion.contactRamp, 0, 'zero input has no solver contact-ramp occupancy');

const notchedAfter = applyLayeredStructuralInteraction(notched, force, { steps: 4 });
const unnotchedAfter = applyLayeredStructuralInteraction(unnotched, force, { steps: 4 });
const lowForceAfter = applyLayeredStructuralInteraction(lowForce, { ...force, magnitude: 0.28 }, { steps: 4 });

const notchedSummary = summarizeLayeredStructuralState(notchedAfter);
const unnotchedSummary = summarizeLayeredStructuralState(unnotchedAfter);
const lowForceSummary = summarizeLayeredStructuralState(lowForceAfter);

assert.ok(notchedSummary.maxStress > lowForceSummary.maxStress * 2, 'stronger force raises 3D structural stress');
assert.equal(lowForceSummary.brokenBondCount, 0, 'low force does not fracture the layered material');
assert.ok(notchedSummary.brokenBondCount >= 4, 'notched layered slab cracks under the witness force');
assert.ok(notchedSummary.componentCount >= 2, '3D fracture produces persistent connectivity separation');
assert.ok(notchedSummary.brokenBondCount > unnotchedSummary.brokenBondCount, 'notched layered geometry damages more than unnotched control');
assert.equal(unnotchedSummary.componentCount, 1, 'unnotched 3D control stays connected under the same force');
assert.ok(notchedSummary.crackPath.some(edge => edge.geometryRole === 'notch-bridge'), 'crack path localizes at the notched bridge');
assert.ok(notchedSummary.crackPath.some(edge => edge.bondKind === 'depth'), 'witness can break through-thickness bonds, not only surface decoration');
assert.ok(notchedSummary.crackPath.some(edge => edge.midpoint.z > 0 && edge.midpoint.z < 1), 'crack path records depth coordinates');
assert.ok(notchedSummary.brokenDepthBondCount > 0, 'summary counts broken through-thickness bonds');
assert.ok(notchedAfter.sound.events.some(event => event.kind === 'crack' && Number.isFinite(event.midpoint.z)), 'sound events carry 3D crack locations');
assert.ok(notchedAfter.sound.impulseEnergy > 0, '3D fracture emits positive material-derived impulse energy');
assert.notEqual(notchedAfter.sound.signature, lowForceAfter.sound.signature, 'sound signature changes with 3D damage state');

const bindPoint = notchedSummary.crackPath.find(edge => edge.bondKind === 'depth')?.midpoint || notchedSummary.crackPath[0].midpoint;
const rebound = bindLayeredStructuralConnectivity(notchedAfter, {
  point: bindPoint,
  radius: 0.22,
  strength: 1.25,
});
const reboundSummary = summarizeLayeredStructuralState(rebound);

assert.ok(reboundSummary.repairedBondCount > 0, 'binding repairs at least one broken 3D bond');
assert.ok(reboundSummary.brokenBondCount < notchedSummary.brokenBondCount, 'binding reduces broken 3D connectivity');
assert.ok(rebound.connectivityEpoch > notchedAfter.connectivityEpoch, 'binding advances layered connectivity epoch');
assert.ok(rebound.sound.events.some(event => event.kind === 'bind' && Number.isFinite(event.midpoint.z)), 'binding emits 3D material-derived sound');

const scenario = buildLayeredStructuralWitnessScenario();
assert.equal(scenario.requestedRoute, STRUCTURAL_MATERIAL_3D_ROUTE);
assert.equal(scenario.effectiveRoute, STRUCTURAL_MATERIAL_3D_ROUTE);
assert.ok(scenario.summaries.cracked.brokenDepthBondCount > 0, 'default witness includes through-thickness fracture');
assert.ok(scenario.summaries.bound.repairedBondCount > 0, 'default witness includes binding repair');
