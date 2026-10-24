// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Execute the production route with deterministic model/device dependencies.
// No neural-network or crop math is replaced in the browser witness.
const calls = { mesh: 0, detector: 0 };
const device = {
  createTexture: ({ size }) => ({ width: size[0], height: size[1], destroy() {} }),
  createBuffer: ({ size }) => ({ async mapAsync() {}, getMappedRange: () => new ArrayBuffer(size), unmap() {}, destroy() {} }),
  createCommandEncoder: () => ({ copyBufferToBuffer() {}, finish() { return {}; } }),
  queue: { copyExternalImageToTexture() {}, submit() {} },
};
globalThis.GPUBufferUsage = { MAP_READ: 1, COPY_DST: 8, TEXTURE_BINDING: 4, RENDER_ATTACHMENT: 16 };
globalThis.GPUTextureUsage = globalThis.GPUBufferUsage;
globalThis.GPUMapMode = { READ: 1 };
const dependencies = {
  MOBRECON_ROUTE_ID: 'mesh', HAND_DETECTOR_ROUTE_ID: 'detector',
  loadMobRecon: async () => ({ identity: {}, faces: [], release() {}, network: { input: {}, outputs: { mesh: { buffer: {}, offset: 0 }, uv: { buffer: {}, offset: 0 } }, encode() { calls.mesh++; } } }),
  loadHandDetector: async () => ({ identity: {}, release() {}, async detect() { calls.detector++; return []; } }),
  createMobReconCrop: () => ({ dispose() {}, encode() {} }), squareCrop: () => [],
};
globalThis.__handMeshMissTest = dependencies;
let source = await fs.readFile(new URL('../models/mobrecon/hand-mesh-route.js', import.meta.url), 'utf8');
source = source.replace(/import \{([^}]+)\} from '[^']+';/g, (_, names) => `const {${names}} = globalThis.__handMeshMissTest;`);
const { createBrowserHandMeshRoute } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const route = await createBrowserHandMeshRoute({ session: { async registerRoute() { return { runtime: { device } }; }, unregisterRoute() {} } });
const input = { source: {}, width: 640, height: 480, handedness: 'right', acquisition: { mode: 'detector', manualBox: [0, 0, 128, 128], onMiss: 'skip' } };
const missed = await route.infer(input);
assert.equal(calls.mesh, 0, 'skip policy must not reconstruct a detector miss');
assert.equal(missed.hasHand, false);
assert.equal(missed.acquisition.source, 'no_detection');
assert.equal(missed.acquisition.fallback, false);
assert.equal(missed.nativeVertices, undefined, 'a miss must not carry invented vertices');
assert.equal(missed.timings.mobreconMs, 0);
const fallback = await route.infer({ ...input, acquisition: { ...input.acquisition, onMiss: 'manual' } });
assert.equal(calls.mesh, 1, 'explicit diagnostic fallback preserves reconstruction');
assert.equal(fallback.acquisition.source, 'manual_crop_fallback_no_detection');
await route.infer({ ...input, acquisition: { mode: 'manual', manualBox: [0, 0, 128, 128] } });
assert.equal(calls.detector, 2, 'manual mode does not invoke the detector');
await assert.rejects(route.infer({ ...input, acquisition: { ...input.acquisition, onMiss: 'invented' } }), /miss policy/i);
route.release();
// Distinct application instances use separate resource routes in one session.
const registered = new Set();
const session = { async registerRoute({ routeId }) {
  assert.ok(!registered.has(routeId), `duplicate route ${routeId}`); registered.add(routeId); return { runtime: { device } };
}, unregisterRoute(routeId) { registered.delete(routeId); } };
const a = await createBrowserHandMeshRoute({ session, routeId: 'hand-a' });
const b = await createBrowserHandMeshRoute({ session, routeId: 'hand-b' });
assert.equal(registered.size, 4); a.release(); assert.equal(registered.size, 2);
const duties = [], settlements = [];
const schedule = { control: { runDuty: work => work() }, invocation: {}, runtime: {
  async prepareCommandDutyAtBoundary(duty) { duties.push(duty.phase); return duty; },
  settleCommandDuty(duty, result) { settlements.push([duty.phase, result.status]); },
} };
await b.infer({ ...input, acquisition: { ...input.acquisition, onMiss: 'manual' }, schedule });
assert.deepEqual(duties, ['hand-detector', 'mobrecon']);
assert.deepEqual(settlements, [['hand-detector', 'encoded'], ['mobrecon', 'encoded']]);
const before = calls.mesh;
await b.infer({ ...input, schedule });
assert.equal(calls.mesh, before, 'scheduled detector miss also skips reconstruction');
assert.equal(duties.at(-1), 'hand-detector');
b.release(); assert.equal(registered.size, 0);
delete globalThis.__handMeshMissTest;
console.log('hand mesh detector-miss contracts passed');
