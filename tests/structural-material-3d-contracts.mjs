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
  summarizeLayeredStructuralState,
} from '../structural-material-3d-core.js';

const root = new URL('..', import.meta.url).pathname;
const corePath = join(root, 'structural-material-3d-core.js');
const witnessPath = join(root, 'structural-material-3d-witness.mjs');
const pagePath = join(root, 'structural-material-3d.html');

assert.ok(existsSync(corePath), 'layered structural sidecar core module exists');
assert.ok(existsSync(witnessPath), 'layered structural sidecar witness runner exists');
assert.ok(existsSync(pagePath), 'layered structural sidecar browser route exists');

const coreSource = readFileSync(corePath, 'utf8');
const witnessSource = readFileSync(witnessPath, 'utf8');
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
assert.match(pageSource, /threejs-sidecar-consumer-not-truth-v0/, 'browser declares the Three.js consumer is not structural authority');
assert.match(pageSource, /window\.__structuralMaterial3dWitness/, 'browser exposes smoke witness state for automation');
assert.match(pageSource, /window\.__structuralMaterial3dPixelProbe/, 'browser exposes renderer pixel probe for visual smoke');
assert.match(pageSource, /pointermove/, 'browser route keeps click-drag interaction live');
assert.match(pageSource, /readPixels/, 'browser route supports canvas pixel evidence');

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
