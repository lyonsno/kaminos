import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createMotionRoutePlanFromTerrainAffordance,
  decodeHillMotionAffordancePacket,
} from '../motion-core.js';

const root = new URL('../', import.meta.url);
const packet = JSON.parse(await readFile(new URL('artifacts/motion-ready-719024/hill/motion-affordance-packet.json', root), 'utf8'));
const data = JSON.parse(await readFile(new URL('artifacts/motion-ready-719024/hill/motion-affordance-data.json', root), 'utf8'));
const page = await readFile(new URL('motion-ready-719024-witness.html', root), 'utf8');

const source = decodeHillMotionAffordancePacket({ packet, data });
assert.equal(source.sourceRef, 'lerms:cc/hill-of-hills-live-terrain-server-0702@81c5348');
assert.equal(source.authority, 'live_simulation');
assert.equal(source.producerSurface, 'lerms-hill-of-hills');
assert.equal(source.intendedConsumerSurface, 'kaminos-motion');
assert.equal(source.identityProjection, 'public-surface-identifiers-v0');
assert.equal(source.channelLayout.length, 22);

const bounds = source.worldBounds;
const start = [
  bounds.x.min + (bounds.x.max - bounds.x.min) * 0.13,
  0,
  bounds.z.min + (bounds.z.max - bounds.z.min) * 0.18,
];
const goal = [
  bounds.x.min + (bounds.x.max - bounds.x.min) * 0.82,
  0,
  bounds.z.min + (bounds.z.max - bounds.z.min) * 0.74,
];
const route = createMotionRoutePlanFromTerrainAffordance(source, {
  id: 'motion-ready-719024-hill-route',
  start,
  goal,
  costProfile: 'ridge-runner',
});
assert.ok(route.routePoints.length >= 8, 'Hill witness route must contain meaningful terrain travel');
assert.equal(route.source.sourceRef, source.sourceRef);
assert.equal(route.evidence.dynamicContinuity, 'not-claimed');

for (const required of [
  './artifacts/motion-ready-719024/creature.glb',
  './artifacts/motion-ready-719024/registration.json',
  './artifacts/motion-ready-719024/receipt.json',
  './artifacts/motion-ready-719024/hill/motion-affordance-packet.json',
  './artifacts/motion-ready-719024/hill/motion-affordance-data.json',
  'axial-parallel-transport-wave-v0',
  'window.kaminosMotionReady719024DebugState',
]) {
  assert.ok(page.includes(required), `witness must bind ${required}`);
}

assert.ok(page.includes('WebGPURenderer'), 'witness must use the Kaminos WebGPU renderer');
assert.ok(page.includes('requestAnimationFrame'), 'witness must animate the exact cast');
assert.ok(page.includes('consoleFailures'), 'witness state must expose console failure evidence');
assert.ok(page.includes('deformAxialGeometryBinding'), 'witness must use the allocation-free batch deformer');
assert.ok(page.includes('smoothedFps'), 'witness must expose measured motion cadence');
assert.ok(!page.includes('geometry.computeVertexNormals();\n    mesh.geometry.computeBoundingSphere();'), 'witness must not rebuild normals and bounds every frame');

console.log('motion-ready-719024 Hill witness contracts passed');
