import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  STRUCTURAL_MATERIAL_ROUTE,
  STRUCTURAL_MATERIAL_SCHEMA,
  applyStructuralMaterialInteraction,
  bindStructuralMaterialConnectivity,
  createStructuralMaterialDragInteraction,
  createStructuralMaterialProxyPlane,
  summarizeStructuralMaterialState,
} from '../structural-material-core.js';

const root = new URL('..', import.meta.url).pathname;
const corePath = join(root, 'structural-material-core.js');
const witnessPath = join(root, 'structural-material-witness.mjs');
const pagePath = join(root, 'structural-material.html');

assert.ok(existsSync(corePath), 'structural-material core module exists');
assert.ok(existsSync(witnessPath), 'structural-material witness runner exists');
assert.ok(existsSync(pagePath), 'structural-material browser proxy witness exists');

const coreSource = readFileSync(corePath, 'utf8');
const witnessSource = readFileSync(witnessPath, 'utf8');
const pageSource = readFileSync(pagePath, 'utf8');

assert.equal(STRUCTURAL_MATERIAL_SCHEMA, 'kaminos.structural-material.sidecar.v0', 'schema identity is stable');
assert.equal(STRUCTURAL_MATERIAL_ROUTE, 'kaminos.structural-material.proxy-plane-fracture.v0', 'route identity is stable');
assert.match(coreSource, /deterministic-coarse-elastic-graph-force-fracture-v0/, 'solver authority is explicit');
assert.match(coreSource, /stress-concentration-notched-proxy-plane-v0/, 'notched geometry stress concentration identity is explicit');
assert.match(coreSource, /material-derived-sound-impulses-v0/, 'sound model authority is explicit');
assert.match(witnessSource, /requestedRoute/, 'witness records requested route identity');
assert.match(witnessSource, /effectiveRoute/, 'witness records effective route identity');
assert.match(pageSource, /pointermove/, 'browser witness has fast pointer-coupled force input');
assert.match(pageSource, /dragStart/, 'browser witness tracks a click-drag origin instead of treating every move as an isolated strike');
assert.match(pageSource, /dragCurrent/, 'browser witness preserves the current drag point for force-vector display');
assert.match(pageSource, /forceEnvelope/, 'browser witness surfaces live drag force-envelope telemetry');
assert.match(pageSource, /bindStructuralMaterialConnectivity/, 'browser witness exposes connectivity binding, not only fracture');

const force = {
  kind: 'screen-space-hand-drag',
  point: { x: 0.94, y: 0.50 },
  vector: { x: 1, y: 0.05 },
  magnitude: 1.35,
  radius: 0.24,
};

const notched = createStructuralMaterialProxyPlane({ columns: 13, rows: 7, notch: true });
const unnotched = createStructuralMaterialProxyPlane({ columns: 13, rows: 7, notch: false });
const lowForce = createStructuralMaterialProxyPlane({ columns: 13, rows: 7, notch: true });

const notchedAfter = applyStructuralMaterialInteraction(notched, force, { steps: 3 });
const unnotchedAfter = applyStructuralMaterialInteraction(unnotched, force, { steps: 3 });
const lowForceAfter = applyStructuralMaterialInteraction(lowForce, { ...force, magnitude: 0.32 }, { steps: 3 });

const shortDrag = createStructuralMaterialDragInteraction({
  start: { x: 0.48, y: 0.5 },
  current: { x: 0.55, y: 0.5 },
});
const longDrag = createStructuralMaterialDragInteraction({
  start: { x: 0.48, y: 0.5 },
  current: { x: 0.94, y: 0.56 },
});

assert.equal(shortDrag.kind, 'screen-space-hand-drag', 'drag mapping produces the same causal interaction kind as the material solver');
assert.ok(longDrag.magnitude > shortDrag.magnitude, 'longer click-drag gestures produce stronger force');
assert.ok(longDrag.radius >= shortDrag.radius, 'drag contact radius grows monotonically with gesture scale');
assert.ok(longDrag.vector.x > 0.9, 'drag vector preserves the horizontal pull direction');
assert.ok(longDrag.point.x > shortDrag.point.x, 'drag force point follows the current hand location');
assert.equal(longDrag.authority, 'screen-space-drag-force-envelope-v0', 'drag envelope authority is explicit');

const notchedSummary = summarizeStructuralMaterialState(notchedAfter);
const unnotchedSummary = summarizeStructuralMaterialState(unnotchedAfter);
const lowForceSummary = summarizeStructuralMaterialState(lowForceAfter);

assert.ok(notchedSummary.maxStress > lowForceSummary.maxStress * 2, 'stronger force raises structural stress before fracture');
assert.equal(lowForceSummary.brokenBondCount, 0, 'low force accumulates stress without cracking the object');
assert.ok(notchedSummary.brokenBondCount >= 2, 'notched proxy cracks multiple bonds under the witness force');
assert.ok(notchedSummary.componentCount >= 2, 'cracked proxy separates into more than one connectivity component');
assert.ok(notchedSummary.maxComponentSeparation > 0.05, 'component separation is persistent structural state, not only a drawn crack');
assert.ok(notchedSummary.crackPath.some(edge => edge.cause === 'stress-threshold'), 'crack path records stress-threshold causes');
assert.ok(notchedSummary.crackPath.some(edge => edge.geometryRole === 'notch-bridge'), 'crack localizes around the notched bridge geometry');
assert.ok(
  notchedSummary.brokenBondCount > unnotchedSummary.brokenBondCount,
  'same force damages the notched geometry more than the unnotched control',
);
assert.equal(unnotchedSummary.componentCount, 1, 'unnotched control stays connected under the same force');

assert.ok(notchedAfter.sound.events.some(event => event.kind === 'crack'), 'fracture emits material-derived crack sound events');
assert.ok(notchedAfter.sound.impulseEnergy > 0, 'fracture sound carries positive strain-release energy');
assert.ok(notchedAfter.sound.brightness > 0.2, 'fracture sound brightness derives from stressed bond strain');
assert.notEqual(notchedAfter.sound.signature, lowForceAfter.sound.signature, 'sound signature changes with structural damage state');

const bindPoint = notchedSummary.crackPath[0].midpoint;
const rebound = bindStructuralMaterialConnectivity(notchedAfter, {
  point: bindPoint,
  radius: 0.18,
  strength: 1.2,
});
const reboundSummary = summarizeStructuralMaterialState(rebound);

assert.ok(reboundSummary.repairedBondCount > 0, 'binding repairs at least one broken bond near the hand point');
assert.ok(reboundSummary.brokenBondCount < notchedSummary.brokenBondCount, 'binding reduces the broken connectivity set');
assert.ok(rebound.connectivityEpoch > notchedAfter.connectivityEpoch, 'binding advances the connectivity epoch');
assert.ok(rebound.sound.events.some(event => event.kind === 'bind'), 'binding emits a material-derived sound event');
