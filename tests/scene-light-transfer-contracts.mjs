import assert from 'node:assert/strict';
import { createStaticLightTransfer } from '../scene-light-transfer.mjs';

const panel = { id: 'panel', position: [0, 0, 1], normal: [0, 0, -1], area: 1, albedo: [0.8, 0.4, 0.2] };
const smoke = { id: 'smoke', position: [0, 0, 0] };
const skyDirections = [{ direction: [0, 0, -1], weight: 1 }];
const open = createStaticLightTransfer({ triangles: [], surfaces: [panel], receivers: [smoke], skyDirections, emitters: [] });
const initialTraceCount = open.traceCount;
const lit = open.evaluate({ skyRadiance: [[1, 1, 1]], emitterRadiance: {} });
assert.ok(lit.surfaces.panel[0] > 0, 'open sky directly illuminates the panel');
assert.ok(lit.receivers.smoke.bounce[0] > 0, 'panel bounce reaches the smoke receiver');
assert.equal(lit.receivers.smoke.total[0], lit.receivers.smoke.bounce[0] + lit.receivers.smoke.directSky[0]);
assert.equal(open.traceCount, initialTraceCount, 'radiometric updates reuse cached visibility coefficients');
assert.ok(lit.receivers.smoke.bounce[0] > 0, 'isotropic smoke receives bounce without a receiver normal');
const brighter = open.evaluate({ skyRadiance: [[2, 2, 2]], emitterRadiance: {} });
assert.ok(brighter.receivers.smoke.bounce[0] > lit.receivers.smoke.bounce[0]);
assert.equal(open.traceCount, initialTraceCount);
assert.equal(open.coefficients.schema, 'scene-light-transfer/v2');
assert.equal(open.coefficients.surfaces[0].skyDirections[0].index, 0);
assert.equal(open.coefficients.surfaces[0].skyDirections[0].irradianceCoefficient, 1);
const recolored = open.evaluate({ skyRadiance: [[1, 1, 1]], emitterRadiance: {}, surfaceAlbedo: { panel: [0.1, 0.2, 0.3] } });
assert.ok(recolored.surfaces.panel[0] < lit.surfaces.panel[0], 'material albedo relights without rebuilding visibility');
assert.equal(open.traceCount, initialTraceCount);
const directional = createStaticLightTransfer({ triangles: [], surfaces: [
  { id: 'up', position: [0, 0, 0], normal: [0, 0, 1], area: 1, albedo: [1, 1, 1] },
  { id: 'down', position: [0, 0, 0], normal: [0, 0, -1], area: 1, albedo: [1, 1, 1] },
], receivers: [], skyDirections: [{ direction: [0, 0, 1], weight: 1 }, { direction: [0, 0, -1], weight: 1 }], emitters: [] });
const directionalCount = directional.traceCount;
const colored = directional.evaluate({ skyRadiance: [[1, 0, 0], [0, 0, 1]], emitterRadiance: {} });
const swapped = directional.evaluate({ skyRadiance: [[0, 0, 1], [1, 0, 0]], emitterRadiance: {} });
assert.ok(colored.surfaces.up[0] > 0 && colored.surfaces.up[2] === 0);
assert.ok(colored.surfaces.down[2] > 0 && colored.surfaces.down[0] === 0);
assert.deepEqual(swapped.surfaces.up, [0, 0, colored.surfaces.down[2]]);
assert.deepEqual(swapped.surfaces.down, [colored.surfaces.up[0], 0, 0]);
assert.equal(directional.traceCount, directionalCount, 'directional relighting reuses cached visibility');
assert.throws(() => directional.evaluate({ skyRadiance: [1, 1, 1], emitterRadiance: {} }), /one RGB array for each/i, 'scalar sky RGB is not accepted as a directional shortcut');
const blocked = createStaticLightTransfer({
  triangles: [{ a: [-2, -2, 0.5], b: [2, -2, 0.5], c: [0, 2, 0.5], identity: 'blocker' }],
  surfaces: [panel], receivers: [smoke], skyDirections, emitters: [],
});
assert.ok(blocked.traceCount > 0);
assert.equal(blocked.evaluate({ skyRadiance: [[1, 1, 1]], emitterRadiance: {} }).surfaces.panel[0], 0, 'wall blocks sky illumination');
assert.equal(blocked.coefficients.schema, 'scene-light-transfer/v2');
assert.equal(blocked.coefficients.receivers[0].bounce.length, 0, 'wall blocks the panel-to-receiver bounce');
assert.ok(Math.abs(open.coefficients.receivers[0].bounce[0].coefficient - 1 / (4 * Math.PI)) < 1e-12);
assert.ok(Math.abs(lit.receivers.smoke.bounce[0] - lit.surfaces.panel[0] / (4 * Math.PI)) < 1e-12,
  'isotropic smoke stores angular-mean incident radiance, not mesh irradiance');
const skyReceivers = createStaticLightTransfer({ triangles: [], surfaces: [], receivers: [
  { id: 'mesh', position: [0, 0, 0], normal: [0, 0, 1] }, smoke,
], skyDirections: [{ direction: [0, 0, 1], weight: 1 }], emitters: [] });
const skyReceived = skyReceivers.evaluate({ skyRadiance: [[1, 0, 0]], emitterRadiance: {} });
assert.equal(skyReceived.receivers.mesh.directSky[0], 1, 'mesh receives visible directional sky irradiance');
assert.ok(Math.abs(skyReceived.receivers.smoke.directSky[0] - 1 / (4 * Math.PI)) < 1e-12,
  'smoke receives directional sky angular mean');
assert.ok(Object.isFrozen(open.coefficients.surfaces[0]), 'cached coefficient records are immutable');
const black = createStaticLightTransfer({ triangles: [], surfaces: [{ ...panel, albedo: [0, 0, 0] }], receivers: [smoke], skyDirections, emitters: [] });
assert.deepEqual(black.evaluate({ skyRadiance: [[1, 1, 1]], emitterRadiance: {} }).receivers.smoke.bounce, [0, 0, 0]);
const sided = createStaticLightTransfer({ triangles: [], surfaces: [panel], receivers: [smoke, { id: 'backface', position: [0, 0, 0], normal: [0, 0, -1] }], skyDirections, emitters: [] });
assert.ok(sided.evaluate({ skyRadiance: [[1, 1, 1]], emitterRadiance: {} }).receivers.smoke.bounce[0] > 0);
assert.deepEqual(sided.evaluate({ skyRadiance: [[1, 1, 1]], emitterRadiance: {} }).receivers.backface.bounce, [0, 0, 0]);
const emitter = createStaticLightTransfer({ triangles: [], surfaces: [{ ...panel, normal: [0, 0, 1], position: [0, 0, 0] }], receivers: [{ id: 'mesh', position: [0, 0, 2], normal: [0, 0, -1] }, smoke], skyDirections: [], emitters: [{ id: 'lamp', position: [0, 0, 1], normal: [0, 0, -1], area: 0.1 }] });
const emitterCount = emitter.traceCount;
assert.equal(emitter.coefficients.emitterSampling, 'sample-coefficients-aggregated-by-emitter-id');
const one = emitter.evaluate({ skyRadiance: [], emitterRadiance: { lamp: [1, 1, 1] } });
const two = emitter.evaluate({ skyRadiance: [], emitterRadiance: { lamp: [2, 2, 2] } });
assert.ok(two.surfaces.panel[0] > one.surfaces.panel[0], 'emitter radiance updates cached direct lighting');
assert.equal(emitter.traceCount, emitterCount);
assert.ok(one.receivers.smoke.directEmitter[0] > 0, 'isotropic smoke receives direct emitter light');
assert.deepEqual(one.receivers.mesh.directEmitter, [0, 0, 0], 'back-facing mesh receiver rejects direct emitter light');
const sourceBlocked = createStaticLightTransfer({ triangles: [{ a: [-2, -2, 0.5], b: [2, -2, 0.5], c: [0, 2, 0.5], identity: 'segment-blocker' }], surfaces: [{ ...panel, position: [0, 0, 0], normal: [0, 0, 1] }], receivers: [], skyDirections: [], emitters: [{ id: 'lamp', position: [0, 0, 1], area: 1 }] });
assert.equal(sourceBlocked.evaluate({ skyRadiance: [], emitterRadiance: { lamp: [1, 1, 1] } }).surfaces.panel[0], 0, 'segment ray blocks emitter illumination');
const endpointGeometry = [
  { a: [0, 0, 1], b: [2, 0, 1], c: [0, 2, 1], identity: 'source-surface' },
  { a: [0, 0, 0], b: [2, 0, 0], c: [0, 2, 0], identity: 'receiver-surface' },
];
const endpointTransfer = createStaticLightTransfer({ triangles: endpointGeometry, surfaces: [panel], receivers: [smoke], skyDirections: [], emitters: [] });
assert.ok(Math.abs(endpointTransfer.coefficients.receivers[0].bounce[0].coefficient - 1 / (4 * Math.PI)) < 1e-12,
  'endpoint self-hits at source and receiver vertices are excluded by segment bounds');
assert.throws(() => createStaticLightTransfer({ triangles: [], surfaces: [{ ...panel, area: Infinity }], receivers: [], skyDirections: [], emitters: [] }), /finite/i);
assert.throws(() => open.evaluate({ skyRadiance: [[NaN, 1, 1]], emitterRadiance: {} }), /finite/i);
assert.throws(() => createStaticLightTransfer({ triangles: [], surfaces: [{ ...panel, position: [Infinity, 0, 0] }], receivers: [], skyDirections: [], emitters: [] }), /finite/i);
console.log('scene light transfer contracts passed');
