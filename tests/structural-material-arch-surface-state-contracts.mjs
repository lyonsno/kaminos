import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildArchStructuralProxy,
  solveArchStructuralForce,
} from '../structural-material-arch-core.js';
import {
  advanceArchSurfaceState,
  resolveArchCameraFacingLayer,
} from '../structural-material-arch-geometry-sidecar.js';

const profilePath = 'artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness/arch-surface-depth-profile.json';
const source = readFileSync(profilePath, 'utf8');
const profile = JSON.parse(source);
const graphOptions = { layers: 3, depthMode: 'surface-envelope' };
const base = buildArchStructuralProxy(profile, graphOptions);
assert.equal(resolveArchCameraFacingLayer(3, 0, base.layers), 2);
assert.equal(resolveArchCameraFacingLayer(-3, 0, base.layers), 0);
assert.throws(() => resolveArchCameraFacingLayer(1, 0, 0), /at least one depth layer/);
const load = {
  x: -0.05,
  y: 0.29,
  force: 0.75,
  patchRadius: 0.01,
  contactDepthMode: 'camera-facing-surface',
  contactLayer: 0,
  iterations: 600,
};

const backFace = solveArchStructuralForce(base, load);
assert.ok(backFace.load.loadedNodeLayers.every(layer => layer === 0),
  'camera-facing contact must load the selected back-face structural layer');

const firstAccepted = advanceArchSurfaceState(base, { ...load, contactLayer: base.layers - 1 }, { threshold: 0.12 });
const secondAccepted = advanceArchSurfaceState(firstAccepted, { ...load, contactLayer: base.layers - 1 }, { threshold: 0.12 });
const repeatedFromIntact = advanceArchSurfaceState(base, { ...load, contactLayer: base.layers - 1 }, { threshold: 0.12 });
assert.equal(firstAccepted.connectivityEpoch, 1);
assert.equal(secondAccepted.connectivityEpoch, 2,
  'a second accepted load must advance the retained connectivity epoch');
assert.notDeepEqual(secondAccepted.bonds, repeatedFromIntact.bonds,
  'the second load must solve through the first load’s accepted broken bonds');

const page = readFileSync('structural-material-arch-geometry.html', 'utf8');
assert.match(page, /const startingState = viewer\.state \?\? viewer\.base;/,
  'Apply must select the last accepted state, falling back to intact only before the first load');
assert.match(page, /advanceArchSurfaceState\(startingState,/,
  'Apply must pass its selected starting state into the structural transaction');
assert.match(page, /stateRetention: 'accepted connectivity and event history; displacement recomputed per Apply'/,
  'the receipt must distinguish retained topology from recomputed elastic displacement');
assert.match(page, /viewer\.state = viewer\.base;/,
  'Reset must be the explicit transition back to intact topology');
assert.match(page, /contactLayer,\s*iterations: 600/,
  'the current camera-facing layer must reach the structural solver');
assert.match(page, /side: continuous\.contactLayer === viewers\.continuous\.base\.layers - 1 \? '\+z' : '-z'/,
  'the effective loaded face must be named in the operator receipt');
assert.match(page, /import\('three'\)/,
  'external modules must be loaded inside the startup error boundary');
assert.match(page, /Startup failed during \$\{startupPhase\}/,
  'module and renderer startup failures must replace the indefinite Loading state');
assert.match(page, /const compact = width \/ height < 1\.15;/,
  'portrait canvas layouts must stack the paired cases without changing the camera');
assert.match(page, /continuous\.root\.position\.y = compact \? 0\.5 : 0;/,
  'the portrait layout must stack the paired cases rather than crop them');
assert.match(page, /camera\.position\.(?:set|z)/,
  'responsive layout must not rewrite the operator-owned camera');

console.log('structural arch surface state contracts passed');
