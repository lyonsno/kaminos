// Prepare low LOD tiers for one TRELLIS generation and publish them to a Kaminos server.
//
//   node tools/prepare-lod-tiers.mjs --input <dir> --source <sha256> --server http://127.0.0.1:8484 \
//     [--targets 5000,1000,500] --report <path>
//
// <dir> holds the generation's raw mesh and material field: vertices.f32, triangles.u32,
// material.features.f32, material.coordinates.i32 and meta.json {materialResolution}.
// <sha256> is the stored mesh the levels belong to (normally the generation's hero GLB).
// Each tier is ingested through /api/ingest-mesh and registered through /api/mesh-lods.
// The report is written at every phase, including on failure.
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {prepareLowTiers} from '../mesh-lod-ladder.mjs';
import {finishTrellisMesh} from '../models/trellis2/trellis-material.js';
import {createWasmXatlasUnwrapper} from '../models/trellis2/wasm-xatlas.js';
import {NodeTrellisUVWorker} from '../models/trellis2/node-uv-worker.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const input = args.get('--input'), source = args.get('--source'), server = args.get('--server'), reportPath = args.get('--report');
const targets = (args.get('--targets') || '5000,1000,500').split(',').map(Number);
const report = {schema: 'kaminos.lod-tiers-report.v0', phase: 'admission', input, source, server, targets, startedAt: new Date().toISOString(), tiers: []};
const save = () => reportPath && fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
try {
  if (!input || !server || !reportPath || !/^[a-f0-9]{64}$/.test(source || '')) throw Error('--input, --source <sha256>, --server and --report are required');
  if (!targets.every(t => Number.isSafeInteger(t) && t > 0)) throw Error('--targets must be positive integers');
  save();
  const read = (n, T) => { const b = fs.readFileSync(path.join(input, n)); return new T(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
  const meta = JSON.parse(fs.readFileSync(path.join(input, 'meta.json'), 'utf8'));
  report.inputMeta = meta;
  const vertices = read('vertices.f32', Float32Array), triangles = read('triangles.u32', Uint32Array);
  const materialFields = {features: read('material.features.f32', Float32Array), coordinates: read('material.coordinates.i32', Int32Array), resolution: meta.materialResolution};
  report.raw = {vertices: vertices.length / 3, faces: triangles.length / 3};
  const sourceCheck = await fetch(`${server}/api/read?root=generated-meshes&path=${source}.glb`);
  await sourceCheck.body?.cancel();
  if (!sourceCheck.ok) throw Error(`source mesh ${source} is not stored on ${server} (HTTP ${sourceCheck.status})`);
  report.phase = 'bvh'; save();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3)); geometry.setIndex(new THREE.BufferAttribute(triangles, 1));
  const bvh = new MeshBVH(geometry), point = new THREE.Vector3(), hit = {};
  const closestPoint = (x, y, z) => { bvh.closestPointToPoint(point.set(x, y, z), hit); return [hit.point.x, hit.point.y, hit.point.z]; };
  report.phase = 'tiers'; save();
  const started = performance.now();
  const tiers = await prepareLowTiers({mesh: {vertices, triangles}, materialFields, targets, closestPoint, finish: finishTrellisMesh,
    unwrapMesh: createWasmXatlasUnwrapper(), WorkerClass: NodeTrellisUVWorker, provenance: {input: meta.source ?? input, route: meta.route}});
  report.tierSeconds = (performance.now() - started) / 1000;
  report.phase = 'publish'; save();
  for (const tier of tiers) {
    const ingest = await fetch(`${server}/api/ingest-mesh`, {method: 'POST', body: Buffer.from(tier.glb)});
    const stored = await ingest.json();
    if (!ingest.ok) throw Error(`ingest failed for ${tier.target}: ${JSON.stringify(stored)}`);
    const level = {sha256: stored.sha256, faces: tier.faces, route: tier.route, textureSize: tier.textureSize,
      closed: tier.closed, boundaryEdges: tier.boundaryEdges, nonManifoldEdges: tier.nonManifoldEdges};
    const register = await fetch(`${server}/api/mesh-lods`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({source, level})});
    const registered = await register.json();
    if (!register.ok) throw Error(`register failed for ${tier.target}: ${JSON.stringify(registered)}`);
    report.tiers.push({target: tier.target, ...level, bytes: tier.glb.byteLength}); save();
  }
  report.phase = 'done';
} catch (error) {
  report.error = {message: error.message, stack: error.stack}; process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({phase: report.phase, error: report.error?.message, tiers: report.tiers.map(t => [t.target, t.faces, t.sha256.slice(0, 8)])}));
}
