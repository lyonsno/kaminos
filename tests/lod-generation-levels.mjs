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
async function publishWith({ingest, register, targets = [200], existingLevels = [], completeMissing = false}) {
  const THREE = await import('three'), {MeshBVH} = await import('three-mesh-bvh'), {prepareGenerationLevels} = await import('../lod-generation-levels.mjs');
  const {finishTrellisMesh} = await import('../models/trellis2/trellis-material.js');
  const {createWasmXatlasUnwrapper} = await import('../models/trellis2/wasm-xatlas.js');
  const {NodeTrellisUVWorker} = await import('../models/trellis2/node-uv-worker.mjs');
  const coordinates = [], features = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { coordinates.push(i, j, 0); features.push(0.2, 0, 0, 0, 0.6, 1); }
  const calls = [], json = value => new Response(JSON.stringify(value), {headers: {'Content-Type': 'application/json'}});
  const fetch = async (url, init = {}) => {
    calls.push(`${init.method || 'GET'} ${url.split('?')[0]}`);
    if (url.startsWith('/api/mesh-lods') && !init.method) return json({levels: existingLevels});
    if (url.startsWith('/api/ingest-mesh')) return ingest(new Uint8Array(await new Response(init.body).arrayBuffer()), json);
    if (url.startsWith('/api/mesh-lods')) return register(JSON.parse(init.body), json);
    return new Response('unexpected', {status: 500});
  };
  const report = await prepareGenerationLevels({decode: {vertices: new Float32Array([0,0,0, 1,0,0, 0,1,0]), triangles: new Uint32Array([0,1,2])},
    materialFields: {features: new Float32Array(features), coordinates: new Int32Array(coordinates), resolution: 4}, source: 'a'.repeat(64), heroGLB: heroGLB(), fetch,
    THREE, MeshBVH, finish: finishTrellisMesh, unwrapMesh: createWasmXatlasUnwrapper(), WorkerClass: NodeTrellisUVWorker, targets, completeMissing});
  return {report, calls};
}
const html = () => new Response('<html>fallback</html>', {status: 200, headers: {'Content-Type': 'text/html'}});
const goodIngest = (bytes, json) => json({schema: 'kaminos.generated-mesh.v0', sha256: hex(bytes), bytes: bytes.length});
const goodRegister = (body, json) => json({schema: 'kaminos.lod-set.v0', source: body.source, level: body.level, retired: []});

test('automatic completion fills missing targets while retaining already published off-target rungs', async () => {
  const existingLevels = [{sha256:'b'.repeat(64), faces:1350, targetFaces:1000, route:'closed-remesh+projection+trellis-simplify'}];
  const {report} = await publishWith({ingest:goodIngest, register:goodRegister, targets:[1000,200], existingLevels, completeMissing:true});
  assert.equal(report.phase,'done', report.error?.message);
  assert.deepEqual(report.tiers.map(level=>level.target),[200]);
  assert.equal(report.tiers[0].targetFaces,200);
  const complete = await publishWith({ingest:goodIngest, register:goodRegister, targets:[1000], existingLevels, completeMissing:true});
  assert.equal(complete.report.phase,'done');
  assert.equal(complete.calls.some(call=>call.startsWith('POST')),false);
});

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

test('confirmation review: a registration response whose body cannot be read keeps the ingested digest, unconfirmed', async () => {
  const broken = () => new Response(new ReadableStream({start(c) { c.error(TypeError('connection reset while reading')); }}), {status: 200});
  const {report} = await publishWith({ingest: goodIngest, register: broken});
  assert.equal(report.phase, 'publish'); assert.match(report.error.message, /connection reset/);
  assert.equal(report.failedTier, 200); assert.match(report.unconfirmedRegistration, /^[a-f0-9]{64}$/);
});

// Surfels-only runs (no finished mesh): levels keyed to the surfel asset's sha, referenced to the raw decode.
test('raw-decode reference: no hero, error and normal maps from the decode, registered under the given source', async () => {
  const THREE = await import('three'), {MeshBVH} = await import('three-mesh-bvh'), {prepareGenerationLevels} = await import('../lod-generation-levels.mjs');
  const {finishTrellisMesh} = await import('../models/trellis2/trellis-material.js');
  const {createWasmXatlasUnwrapper} = await import('../models/trellis2/wasm-xatlas.js');
  const {NodeTrellisUVWorker} = await import('../models/trellis2/node-uv-worker.mjs');
  const coordinates = [], features = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { coordinates.push(i, j, 0); features.push(0.2, 0, 0, 0, 0.6, 1); }
  const surfelSha = 'c'.repeat(64), calls = [], registrations = [], json = value => new Response(JSON.stringify(value), {headers: {'Content-Type': 'application/json'}});
  const fetch = async (url, init = {}) => { calls.push(`${init.method || 'GET'} ${url.split('?')[0]}`);
    if (url.startsWith('/api/mesh-lods') && !init.method) return json({levels: []});
    if (url.startsWith('/api/ingest-mesh')) return goodIngest(new Uint8Array(await new Response(init.body).arrayBuffer()), json);
    if (url.startsWith('/api/mesh-lods')) { const body = JSON.parse(init.body); registrations.push(body); return goodRegister(body, json); }
    return new Response('unexpected', {status: 500}); };
  const vertices = new Float32Array([0,0,0, 1,0,0, 0,1,0]), triangles = new Uint32Array([0,1,2]);
  const report = await prepareGenerationLevels({decode: {vertices, triangles}, materialFields: {features: new Float32Array(features), coordinates: new Int32Array(coordinates), resolution: 4},
    source: surfelSha, reference: 'raw-decode', fetch, THREE, MeshBVH, finish: finishTrellisMesh, unwrapMesh: createWasmXatlasUnwrapper(), WorkerClass: NodeTrellisUVWorker, targets: [200]});
  assert.equal(report.phase, 'done', report.error?.message);
  assert.ok(!calls.some(c => c.includes('/api/read')), 'no hero is read');
  const tier = report.tiers[0];
  assert.equal(tier.error.reference.kind, 'raw-decode');
  assert.deepEqual(tier.error.reference.digests, {'vertices.f32': hex(vertices), 'triangles.u32': hex(triangles)});
  assert.equal(tier.errorAgainstRawDecode, undefined, 'the error already is the raw-decode error');
  assert.deepEqual(tier.normalMap.source, {kind: 'raw-decode', digests: tier.error.reference.digests});
  assert.ok(tier.frameDrift <= 0.1);
  assert.equal(registrations[0].source, surfelSha);
});

test('raw-decode reference refuses a hero, and an unknown reference is refused', async () => {
  const THREE = await import('three'), {MeshBVH} = await import('three-mesh-bvh'), {prepareGenerationLevels} = await import('../lod-generation-levels.mjs');
  const base = {decode: {vertices: new Float32Array(9), triangles: new Uint32Array([0, 1, 2])}, materialFields: {}, source: 'c'.repeat(64), THREE, MeshBVH, finish: () => {}, targets: [200],
    fetch: async () => { throw Error('no request expected'); }};
  const withHero = await prepareGenerationLevels({...base, reference: 'raw-decode', heroGLB: heroGLB()});
  assert.match(withHero.error.message, /raw-decode reference takes no hero/);
  const unknown = await prepareGenerationLevels({...base, reference: 'surfels'});
  assert.match(unknown.error.message, /reference must be one of hero, raw-decode/);
});

test('the module declares the references it accepts, and that declaration is what it checks', async () => {
  const mod = await import('../lod-generation-levels.mjs');
  assert.deepEqual(mod.GENERATION_LEVEL_REFERENCES, ['hero', 'raw-decode']);
  assert.ok(Object.isFrozen(mod.GENERATION_LEVEL_REFERENCES));
  const THREE = await import('three'), {MeshBVH} = await import('three-mesh-bvh');
  const report = await mod.prepareGenerationLevels({decode: {vertices: new Float32Array(9), triangles: new Uint32Array([0, 1, 2])}, materialFields: {}, source: 'c'.repeat(64),
    THREE, MeshBVH, finish: () => {}, targets: [200], reference: 'surfels', fetch: async () => { throw Error('no request expected'); }});
  assert.match(report.error.message, /reference must be one of hero, raw-decode/);
});

test('surfelFactors builds, measures and registers merged surfel levels with hero normals under SURFEL_TIER_ROUTE', async () => {
  const THREE = await import('three'), {MeshBVH} = await import('three-mesh-bvh');
  const {prepareGenerationLevels, SURFEL_TIER_ROUTE} = await import('../lod-generation-levels.mjs');
  const {readSurfelGLBExtension} = await import('../trellis-surfels.mjs');
  assert.equal(SURFEL_TIER_ROUTE, 'trellis-surfels+hero-normals');
  // A sheet across a 32-grid at z=16, matching a hero mesh at the same world bounds.
  const resolution = 32, coords = [[2,2,16],[29,2,16],[2,29,16],[29,29,16]];
  const vertices = new Float32Array(coords.flatMap(c => c.map(v => (v + 0.5) / resolution - 0.5)));
  const triangles = new Uint32Array([0,1,3, 0,3,2]);
  const materialFields = {resolution, coordinates: new Int32Array(coords.flat()), features: new Float32Array(coords.flatMap(() => [0.2, -0.2, 0.4, -1, 0.6, 1]))};
  // Hero GLB covering the same sheet in source space under the TRELLIS node matrix, with tilted shading normals.
  const nrm = new Float32Array(coords.flatMap(() => [0.6, 0, 0.8])), parts = [vertices, triangles, nrm];
  const bin = new Uint8Array(parts.reduce((n, a) => n + a.byteLength, 0)); let at = 0; const bufferViews = [];
  for (const a of parts) { bin.set(new Uint8Array(a.buffer), at); bufferViews.push({buffer: 0, byteOffset: at, byteLength: a.byteLength}); at += a.byteLength; }
  const doc = {asset: {version: '2.0'}, scene: 0, scenes: [{nodes: [0]}], nodes: [{mesh: 0, matrix: [1,0,0,0, 0,0,-1,0, 0,1,0,0, 0,0,0,1]}],
    meshes: [{primitives: [{attributes: {POSITION: 0, NORMAL: 2}, indices: 1}]}], buffers: [{byteLength: bin.length}], bufferViews,
    accessors: [{bufferView: 0, componentType: 5126, count: 4, type: 'VEC3'}, {bufferView: 1, componentType: 5125, count: 6, type: 'SCALAR'}, {bufferView: 2, componentType: 5126, count: 4, type: 'VEC3'}]};
  const text = new TextEncoder().encode(JSON.stringify(doc)), tl = Math.ceil(text.length / 4) * 4, hero = new Uint8Array(28 + tl + bin.length), dv = new DataView(hero.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, hero.length, true); dv.setUint32(12, tl, true); dv.setUint32(16, 0x4e4f534a, true);
  hero.fill(32, 20, 20 + tl); hero.set(text, 20); dv.setUint32(20 + tl, bin.length, true); dv.setUint32(24 + tl, 0x004e4942, true); hero.set(bin, 28 + tl);
  const stored = [], registered = [], json = value => new Response(JSON.stringify(value), {headers: {'Content-Type': 'application/json'}});
  const fetch = async (url, init = {}) => {
    if (url.startsWith('/api/mesh-lods') && !init.method) return json({levels: []});
    if (url.startsWith('/api/ingest-mesh')) { const bytes = new Uint8Array(await new Response(init.body).arrayBuffer()); stored.push(bytes); return goodIngest(bytes, json); }
    if (url.startsWith('/api/mesh-lods')) { const body = JSON.parse(init.body); registered.push(body); return goodRegister(body, json); }
    return new Response('unexpected', {status: 500});
  };
  const report = await prepareGenerationLevels({decode: {vertices, triangles, coordinates: new Int32Array(coords.flat())}, materialFields, source: 'd'.repeat(64), heroGLB: hero.buffer,
    fetch, THREE, MeshBVH, finish: () => {}, targets: [], surfelFactors: [2, 4]});
  assert.equal(report.phase, 'done', report.error?.message);
  assert.equal(registered.length, 2);
  assert.deepEqual(registered.map(r => r.level.mergeFactor), [2, 4]);
  for (const [i, r] of registered.entries()) {
    assert.equal(r.level.route, SURFEL_TIER_ROUTE);
    assert.equal(r.level.representation, 'trellis-surfels');
    assert.equal(r.level.error.reference.kind, 'hero');
    assert.equal(r.level.normalMap.source.sha256, 'd'.repeat(64));
    const ext = readSurfelGLBExtension(stored[i].buffer.slice(stored[i].byteOffset, stored[i].byteOffset + stored[i].byteLength));
    assert.equal(ext.field.count, r.level.faces);
  }
  // Review M2: shuffled material rows and a material-coordinate superset must produce identical surfel positions and colors,
  // and missing decode.coordinates must be refused when surfelFactors are requested.
  const shuffledOrder = [3, 1, 0, 2];
  const supersetCoords = new Int32Array([...shuffledOrder.flatMap(i => coords[i]), 10, 10, 16]);
  const supersetFeatures = new Float32Array([...shuffledOrder.flatMap(i => [0.2 + i * 0.1, -0.2, 0.4, -1, 0.6, 1]), -1, -1, -1, -1, -1, 1]);
  const unshuffledFeatures = new Float32Array([0, 1, 2, 3].flatMap(i => [0.2 + i * 0.1, -0.2, 0.4, -1, 0.6, 1]));
  const storedA = [], storedB = [];
  const makeFetch = bucket => async (url, init = {}) => {
    if (url.startsWith('/api/mesh-lods') && !init.method) return json({levels: []});
    if (url.startsWith('/api/ingest-mesh')) { const bytes = new Uint8Array(await new Response(init.body).arrayBuffer()); bucket.push(bytes); return goodIngest(bytes, json); }
    if (url.startsWith('/api/mesh-lods')) return goodRegister(JSON.parse(init.body), json);
    return new Response('unexpected', {status: 500});
  };
  const repA = await prepareGenerationLevels({decode: {vertices, triangles, coordinates: new Int32Array(coords.flat())},
    materialFields: {resolution, coordinates: new Int32Array(coords.flat()), features: unshuffledFeatures},
    source: 'd'.repeat(64), heroGLB: hero.buffer, fetch: makeFetch(storedA), THREE, MeshBVH, finish: () => {}, targets: [], surfelFactors: [1]});
  const repB = await prepareGenerationLevels({decode: {vertices, triangles, coordinates: new Int32Array(coords.flat())},
    materialFields: {resolution, coordinates: supersetCoords, features: supersetFeatures},
    source: 'd'.repeat(64), heroGLB: hero.buffer, fetch: makeFetch(storedB), THREE, MeshBVH, finish: () => {}, targets: [], surfelFactors: [1]});
  assert.equal(repA.phase, 'done', repA.error?.message);
  assert.equal(repB.phase, 'done', repB.error?.message);
  const extA = readSurfelGLBExtension(storedA[0].buffer.slice(storedA[0].byteOffset, storedA[0].byteOffset + storedA[0].byteLength));
  const extB = readSurfelGLBExtension(storedB[0].buffer.slice(storedB[0].byteOffset, storedB[0].byteOffset + storedB[0].byteLength));
  assert.deepEqual([...extB.field.cells], [...extA.field.cells]);
  assert.deepEqual([...extB.field.offsets], [...extA.field.offsets]);
  assert.deepEqual([...extB.field.color], [...extA.field.color]);
  const missingCoords = await prepareGenerationLevels({decode: {vertices, triangles}, materialFields, source: 'd'.repeat(64), heroGLB: hero.buffer,
    fetch: makeFetch([]), THREE, MeshBVH, finish: () => {}, targets: [], surfelFactors: [2]});
  assert.notEqual(missingCoords.phase, 'done');
  assert.match(missingCoords.error.message, /decode\.coordinates/);
});

test('arbitrary GLB (no decode or materialFields): remeshes, bakes PBR textures + gated normal map from the source GLB in its world frame', async () => {
  const THREE = await import('three'), {MeshBVH} = await import('three-mesh-bvh');
  const {prepareGenerationLevels} = await import('../lod-generation-levels.mjs');
  const {finishTrellisMesh, encodeTrellisTexturePNG} = await import('../models/trellis2/trellis-material.js');
  const {createWasmXatlasUnwrapper} = await import('../models/trellis2/wasm-xatlas.js');
  const {NodeTrellisUVWorker} = await import('../models/trellis2/node-uv-worker.mjs');
  const {decodePNGBytes} = await import('../lod-mesh-bake.mjs');

  const bakeMod = fs.readFileSync(new URL('../lod-mesh-bake.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(bakeMod, /from ['"]node:|require\(|\bprocess\.|\bBuffer\b|import\(['"]node:/);

  // Build an arbitrary GLB with identity node matrix (not TRELLIS -90 deg X), embedded 4x4 PNG baseColor and metallicRoughness textures, UV0 and vertex normals.
  const basePng = new Uint8Array(await encodeTrellisTexturePNG({pixels: new Uint8Array(16 * 4).map((_, i) => [40, 180, 90, 255][i % 4]), width: 4, height: 4}));
  const mrPng = new Uint8Array(await encodeTrellisTexturePNG({pixels: new Uint8Array(16 * 4).map((_, i) => [0, 140, 60, 255][i % 4]), width: 4, height: 4}));
  const pos = new Float32Array([0,0,0, 1,0,0, 1,1,0, 0,1,0]);
  const nrm = new Float32Array([0,0,1, 0,0,1, 0,0,1, 0,0,1]);
  const uv = new Float32Array([0,0, 1,0, 1,1, 0,1]);
  const idx = new Uint32Array([0,1,2, 0,2,3]);
  const pad4 = b => { const u = new Uint8Array(b.buffer ?? b, b.byteOffset ?? 0, b.byteLength); const out = new Uint8Array(Math.ceil(u.length / 4) * 4); out.set(u); return {raw: u, padded: out}; };
  const chunks = [pos, nrm, uv, idx, basePng, mrPng].map(pad4);
  const bin = new Uint8Array(chunks.reduce((s, c) => s + c.padded.length, 0));
  const bufferViews = []; let at = 0;
  for (const c of chunks) { bin.set(c.padded, at); bufferViews.push({buffer: 0, byteOffset: at, byteLength: c.raw.length}); at += c.padded.length; }
  const doc = {
    asset: {version: '2.0'}, scene: 0, scenes: [{nodes: [0]}],
    nodes: [{name: 'arbitrary-world-node', mesh: 0}],
    meshes: [{primitives: [{attributes: {POSITION: 0, NORMAL: 1, TEXCOORD_0: 2}, indices: 3, material: 0}]}],
    materials: [{pbrMetallicRoughness: {baseColorTexture: {index: 0}, metallicRoughnessTexture: {index: 1}, baseColorFactor: [1, 1, 1, 1], metallicFactor: 1, roughnessFactor: 1}}],
    textures: [{source: 0}, {source: 1}],
    images: [{bufferView: 4, mimeType: 'image/png'}, {bufferView: 5, mimeType: 'image/png'}],
    buffers: [{byteLength: bin.length}], bufferViews,
    accessors: [
      {bufferView: 0, componentType: 5126, count: 4, type: 'VEC3'},
      {bufferView: 1, componentType: 5126, count: 4, type: 'VEC3'},
      {bufferView: 2, componentType: 5126, count: 4, type: 'VEC2'},
      {bufferView: 3, componentType: 5125, count: 6, type: 'SCALAR'},
    ],
  };
  const text = new TextEncoder().encode(JSON.stringify(doc)), tl = Math.ceil(text.length / 4) * 4;
  const glb = new Uint8Array(28 + tl + bin.length), dv = new DataView(glb.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, glb.length, true);
  dv.setUint32(12, tl, true); dv.setUint32(16, 0x4e4f534a, true); glb.fill(32, 20, 20 + tl); glb.set(text, 20);
  dv.setUint32(20 + tl, bin.length, true); dv.setUint32(24 + tl, 0x004e4942, true); glb.set(bin, 28 + tl);

  const source = 'e'.repeat(64), stored = [], registered = [], json = value => new Response(JSON.stringify(value), {headers: {'Content-Type': 'application/json'}});
  const fetch = async (url, init = {}) => {
    if (url.startsWith('/api/mesh-lods') && !init.method) return json({levels: []});
    if (url.startsWith('/api/read')) return new Response(glb.buffer);
    if (url.startsWith('/api/ingest-mesh')) { const bytes = new Uint8Array(await new Response(init.body).arrayBuffer()); stored.push(bytes); return goodIngest(bytes, json); }
    if (url.startsWith('/api/mesh-lods')) { const body = JSON.parse(init.body); registered.push(body); return goodRegister(body, json); }
    return new Response('unexpected', {status: 500});
  };
  const report = await prepareGenerationLevels({
    source, fetch, THREE, MeshBVH, finish: finishTrellisMesh,
    unwrapMesh: createWasmXatlasUnwrapper(), WorkerClass: NodeTrellisUVWorker, targets: [200], textureSizeFor: () => 32,
  });
  assert.equal(report.phase, 'done', report.error?.message);
  assert.equal(report.raw.fromHeroGLB, true);
  assert.equal(report.tiers.length, 1);
  const tier = report.tiers[0];
  assert.ok(tier.frameDrift <= 0.1, `expected frameDrift <= 0.1 on non-TRELLIS node transform, got ${tier.frameDrift}`);
  assert.deepEqual(tier.error.reference, {kind: 'hero', sha256: source, faces: 2});
  assert.equal(tier.errorAgainstRawDecode, undefined);
  assert.deepEqual(tier.normalMap.source, {kind: 'hero', sha256: source});

  // Verify the baked baseColor and metallicRoughness PNGs in the published tier GLB match the source GLB's textures
  const tierBytes = stored[0], tierDv = new DataView(tierBytes.buffer, tierBytes.byteOffset, tierBytes.byteLength);
  const tierJsonLen = tierDv.getUint32(12, true), tierDoc = JSON.parse(new TextDecoder().decode(tierBytes.subarray(20, 20 + tierJsonLen)));
  const tierBin = 28 + tierJsonLen;
  const imgBytes = idx => { const bv = tierDoc.bufferViews[tierDoc.images[idx].bufferView]; return tierBytes.subarray(tierBin + (bv.byteOffset || 0), tierBin + (bv.byteOffset || 0) + bv.byteLength); };
  const bakedBase = await decodePNGBytes(imgBytes(0));
  const bakedMR = await decodePNGBytes(imgBytes(1));
  assert.deepEqual([...bakedBase.rgba.subarray(0, 4)], [40, 180, 90, 255]);
  assert.deepEqual([...bakedMR.rgba.subarray(0, 4)], [0, 140, 60, 255]);

  // Review M1: linear baseColorFactor and COLOR_0 vertex colors must be multiplied in linear light and encoded to sRGB
  const {readGLBLocalSurfaceAndMaterials, createGLBMeshMaterialBaker} = await import('../lod-mesh-bake.mjs');
  const col = new Float32Array([0.5, 1.0, 0.25, 1, 0.5, 1.0, 0.25, 1, 0.5, 1.0, 0.25, 1, 0.5, 1.0, 0.25, 1]);
  const colChunks = [pos, nrm, uv, idx, col].map(pad4);
  const colBin = new Uint8Array(colChunks.reduce((s, c) => s + c.padded.length, 0));
  const colViews = []; let colAt = 0;
  for (const c of colChunks) { colBin.set(c.padded, colAt); colViews.push({buffer: 0, byteOffset: colAt, byteLength: c.raw.length}); colAt += c.padded.length; }
  const colDoc = {
    asset: {version: '2.0'}, scene: 0, scenes: [{nodes: [0]}],
    nodes: [{name: 'factor-and-color-node', mesh: 0}],
    meshes: [{primitives: [{attributes: {POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, COLOR_0: 4}, indices: 3, material: 0}]}],
    materials: [{pbrMetallicRoughness: {baseColorFactor: [0.5, 0.25, 1.0, 1.0], metallicFactor: 0.4, roughnessFactor: 0.6}}],
    buffers: [{byteLength: colBin.length}], bufferViews: colViews,
    accessors: [
      {bufferView: 0, componentType: 5126, count: 4, type: 'VEC3'},
      {bufferView: 1, componentType: 5126, count: 4, type: 'VEC3'},
      {bufferView: 2, componentType: 5126, count: 4, type: 'VEC2'},
      {bufferView: 3, componentType: 5125, count: 6, type: 'SCALAR'},
      {bufferView: 4, componentType: 5126, count: 4, type: 'VEC4'},
    ],
  };
  const colText = new TextEncoder().encode(JSON.stringify(colDoc)), colTl = Math.ceil(colText.length / 4) * 4;
  const colGlb = new Uint8Array(28 + colTl + colBin.length), colDv = new DataView(colGlb.buffer);
  colDv.setUint32(0, 0x46546c67, true); colDv.setUint32(4, 2, true); colDv.setUint32(8, colGlb.length, true);
  colDv.setUint32(12, colTl, true); colDv.setUint32(16, 0x4e4f534a, true); colGlb.fill(32, 20, 20 + colTl); colGlb.set(colText, 20);
  colDv.setUint32(20 + colTl, colBin.length, true); colDv.setUint32(24 + colTl, 0x004e4942, true); colGlb.set(colBin, 28 + colTl);
  const colSurface = await readGLBLocalSurfaceAndMaterials(colGlb);
  const colBaker = createGLBMeshMaterialBaker(colSurface, {THREE, MeshBVH});
  const colBaked = colBaker({vertices: colSurface.vertices, triangles: colSurface.triangles, uvs: uv, textureSize: 4});
  // Linear RGB is [0.5 * 0.5, 0.25 * 1.0, 1.0 * 0.25] = [0.25, 0.25, 0.25]. In sRGB, 0.25 -> round((1.055 * 0.25^(1/2.4) - 0.055) * 255) = 137 (NOT 64!)
  assert.deepEqual([...colBaked.baseColor.subarray(0, 4)], [137, 137, 137, 255]);

  // Review N1: truncated PNG chunks and empty/sparse/compressed GLB surfaces fail loud with explicit messages
  await assert.rejects(() => decodePNGBytes(basePng.subarray(0, basePng.length - 6)), /truncated PNG chunk/);
});
