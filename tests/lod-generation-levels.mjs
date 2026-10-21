// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';

const hex = a => createHash('sha256').update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest('hex');

test('the generation-level module runs in a page: no Node-only imports or globals', () => {
  const source = fs.readFileSync(new URL('../lod-generation-levels.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"]node:|require\(|\bprocess\.|\bBuffer\b|import\(['"]node:/);
});

// A stored hero holding the decoded triangle, with the TRELLIS encoder's -90 deg about X node and
// shading normals, so its world frame matches the levels'.
function heroGLB() {
  const pos = new Float32Array([0,0,0, 1,0,0, 0,1,0]), idx = new Uint32Array([0,1,2]), nrm = new Float32Array([0,0,1, 0,0,1, 0,0,1]);
  const parts = [pos, idx, nrm], bin = new Uint8Array(parts.reduce((n, a) => n + a.byteLength, 0)); let at = 0; const bufferViews = [];
  for (const a of parts) { bin.set(new Uint8Array(a.buffer), at); bufferViews.push({buffer: 0, byteOffset: at, byteLength: a.byteLength}); at += a.byteLength; }
  const json = {asset: {version: '2.0'}, scene: 0, scenes: [{nodes: [0]}], nodes: [{mesh: 0, matrix: [1,0,0,0, 0,0,-1,0, 0,1,0,0, 0,0,0,1]}],
    meshes: [{primitives: [{attributes: {POSITION: 0, NORMAL: 2}, indices: 1}]}], buffers: [{byteLength: bin.length}], bufferViews,
    accessors: [{bufferView: 0, componentType: 5126, count: 3, type: 'VEC3'}, {bufferView: 1, componentType: 5125, count: 3, type: 'SCALAR'}, {bufferView: 2, componentType: 5126, count: 3, type: 'VEC3'}]};
  const text = new TextEncoder().encode(JSON.stringify(json)), tl = Math.ceil(text.length / 4) * 4, out = new Uint8Array(28 + tl + bin.length), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true); dv.setUint32(12, tl, true); dv.setUint32(16, 0x4e4f534a, true);
  out.fill(32, 20, 20 + tl); out.set(text, 20); dv.setUint32(20 + tl, bin.length, true); dv.setUint32(24 + tl, 0x004e4942, true); out.set(bin, 28 + tl);
  return out.buffer;
}

test('from an in-memory decode and fields to published, registered levels through the given fetch', async () => {
  const THREE = await import('three'), {MeshBVH} = await import('three-mesh-bvh');
  const {prepareGenerationLevels} = await import('../lod-generation-levels.mjs');
  const {finishTrellisMesh} = await import('../models/trellis2/trellis-material.js');
  const {createWasmXatlasUnwrapper} = await import('../models/trellis2/wasm-xatlas.js');
  const {NodeTrellisUVWorker} = await import('../models/trellis2/node-uv-worker.mjs');
  const vertices = new Float32Array([0,0,0, 1,0,0, 0,1,0]), triangles = new Uint32Array([0,1,2]);
  const coordinates = [], features = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { coordinates.push(i, j, 0); features.push(0.2, 0, 0, 0, 0.6, 1); }
  const source = 'a'.repeat(64), calls = [], stored = [];
  // Stand-in for the page's same-origin fetch: no server, no Node HTTP.
  const fetch = async (url, init = {}) => {
    calls.push(`${init.method || 'GET'} ${url.split('?')[0]}`);
    const json = value => new Response(JSON.stringify(value), {headers: {'Content-Type': 'application/json'}});
    if (url.startsWith('/api/mesh-lods') && !init.method) return json({levels: []});
    if (url.startsWith('/api/ingest-mesh')) { const bytes = new Uint8Array(await new Response(init.body).arrayBuffer()); stored.push(bytes); return json({sha256: hex(bytes)}); }
    if (url.startsWith('/api/mesh-lods')) { const {source: src, level} = JSON.parse(init.body); return json({schema: 'kaminos.lod-set.v0', source: src, level, retired: []}); }
    return new Response('unexpected', {status: 500});
  };
  const phases = [];
  const report = await prepareGenerationLevels({decode: {vertices, triangles}, materialFields: {features: new Float32Array(features), coordinates: new Int32Array(coordinates), resolution: 4},
    source, heroGLB: heroGLB(), fetch, THREE, MeshBVH, finish: finishTrellisMesh, unwrapMesh: createWasmXatlasUnwrapper(), WorkerClass: NodeTrellisUVWorker,
    targets: [200], input: 'in-memory test decode', onPhase: r => phases.push(r.phase)});
  assert.equal(report.phase, 'done', report.error?.message);
  // onPhase also fires after each published tier, so the caller can save progress.
  assert.deepEqual(phases.filter((p, i) => p !== phases[i - 1]), ['preflight', 'bvh', 'tiers', 'frame-check', 'normal-map', 'publish', 'done']);
  assert.ok(!calls.some(c => c.includes('/api/read')), 'a hero passed in is not fetched again');
  assert.equal(calls.filter(c => c === 'POST /api/ingest-mesh').length, 1);
  assert.equal(report.tiers[0].sha256, hex(stored[0]));
  assert.equal(report.tiers[0].error.reference.kind, 'hero');
  assert.deepEqual(report.tiers[0].errorAgainstRawDecode.reference.digests, {'vertices.f32': hex(vertices), 'triangles.u32': hex(triangles)});
  assert.equal(report.tiers[0].normalMap.source.sha256, source);
});

test('a failure leaves the report at its phase with the error, and nothing is stored', async () => {
  const THREE = await import('three'), {MeshBVH} = await import('three-mesh-bvh'), {prepareGenerationLevels} = await import('../lod-generation-levels.mjs');
  const calls = [], fetch = async (url, init = {}) => { calls.push(`${init.method || 'GET'} ${url.split('?')[0]}`);
    return new Response(JSON.stringify({levels: [{sha256: 'b'.repeat(64), faces: 200, route: 'closed-remesh+projection+trellis-simplify'}]}), {headers: {'Content-Type': 'application/json'}}); };
  const report = await prepareGenerationLevels({decode: {vertices: new Float32Array(9), triangles: new Uint32Array([0, 1, 2])}, materialFields: {}, source: 'a'.repeat(64),
    heroGLB: heroGLB(), fetch, THREE, MeshBVH, finish: () => {}, targets: [200]});
  assert.equal(report.phase, 'preflight'); assert.match(report.error.message, /already registered/);
  assert.ok(!calls.some(c => c.startsWith('POST')));
});

// Review M1/N1/N2: publication counts only with receipts that name what was stored and registered.
async function publishWith({ingest, register, targets = [200]}) {
  const THREE = await import('three'), {MeshBVH} = await import('three-mesh-bvh'), {prepareGenerationLevels} = await import('../lod-generation-levels.mjs');
  const {finishTrellisMesh} = await import('../models/trellis2/trellis-material.js');
  const {createWasmXatlasUnwrapper} = await import('../models/trellis2/wasm-xatlas.js');
  const {NodeTrellisUVWorker} = await import('../models/trellis2/node-uv-worker.mjs');
  const coordinates = [], features = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { coordinates.push(i, j, 0); features.push(0.2, 0, 0, 0, 0.6, 1); }
  const calls = [], json = value => new Response(JSON.stringify(value), {headers: {'Content-Type': 'application/json'}});
  const fetch = async (url, init = {}) => {
    calls.push(`${init.method || 'GET'} ${url.split('?')[0]}`);
    if (url.startsWith('/api/mesh-lods') && !init.method) return json({levels: []});
    if (url.startsWith('/api/ingest-mesh')) return ingest(new Uint8Array(await new Response(init.body).arrayBuffer()), json);
    if (url.startsWith('/api/mesh-lods')) return register(JSON.parse(init.body), json);
    return new Response('unexpected', {status: 500});
  };
  const report = await prepareGenerationLevels({decode: {vertices: new Float32Array([0,0,0, 1,0,0, 0,1,0]), triangles: new Uint32Array([0,1,2])},
    materialFields: {features: new Float32Array(features), coordinates: new Int32Array(coordinates), resolution: 4}, source: 'a'.repeat(64), heroGLB: heroGLB(), fetch,
    THREE, MeshBVH, finish: finishTrellisMesh, unwrapMesh: createWasmXatlasUnwrapper(), WorkerClass: NodeTrellisUVWorker, targets});
  return {report, calls};
}
const html = () => new Response('<html>fallback</html>', {status: 200, headers: {'Content-Type': 'text/html'}});
const goodIngest = (bytes, json) => json({schema: 'kaminos.generated-mesh.v0', sha256: hex(bytes), bytes: bytes.length});
const goodRegister = (body, json) => json({schema: 'kaminos.lod-set.v0', source: body.source, level: body.level, retired: []});

test('review M1: an ingest success without a receipt naming the stored bytes is not publication', async () => {
  for (const ingest of [() => html(), (bytes, json) => json({sha256: 'f'.repeat(64)}), (bytes, json) => json({})]) {
    const {report, calls} = await publishWith({ingest, register: goodRegister});
    assert.equal(report.phase, 'publish'); assert.match(report.error.message, /ingest receipt/);
    assert.equal(report.tiers.length, 0); assert.ok(!calls.includes('POST /api/mesh-lods'), 'nothing registered');
  }
});

test('review M1: a registration success without a receipt for this source and level is not publication', async () => {
  for (const register of [() => html(), (body, json) => json({retired: []}), (body, json) => json({schema: 'kaminos.lod-set.v0', source: body.source, level: {...body.level, sha256: 'e'.repeat(64)}})]) {
    const {report} = await publishWith({ingest: goodIngest, register});
    assert.equal(report.phase, 'publish'); assert.match(report.error.message, /registration receipt/);
    assert.equal(report.tiers.length, 0); assert.match(report.orphanedIngest, /^[a-f0-9]{64}$/);
  }
});

test('review N2: a registration that fails in transport keeps the ingested digest, unconfirmed', async () => {
  const {report} = await publishWith({ingest: goodIngest, register: () => { throw TypeError('network failure on register'); }});
  assert.equal(report.phase, 'publish'); assert.match(report.error.message, /network failure/);
  assert.equal(report.failedTier, 200); assert.match(report.unconfirmedRegistration, /^[a-f0-9]{64}$/); assert.equal(report.orphanedIngest, undefined);
});

test('review N1: an empty target list is refused, not a successful no-op', async () => {
  const {report, calls} = await publishWith({ingest: goodIngest, register: goodRegister, targets: []});
  assert.notEqual(report.phase, 'done'); assert.match(report.error.message, /at least one target/); assert.equal(calls.length, 0);
});
