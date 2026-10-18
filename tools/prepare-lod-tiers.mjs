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
  // Loaded here so a missing dependency still ends in a written failure report.
  report.phase = 'load-modules'; save();
  const THREE = await import(process.env.KAMINOS_LOD_THREE_MODULE || 'three');
  const {MeshBVH} = await import('three-mesh-bvh');
  const {prepareLowTiers} = await import('../mesh-lod-ladder.mjs');
  const {finishTrellisMesh} = await import('../models/trellis2/trellis-material.js');
  const {createWasmXatlasUnwrapper} = await import('../models/trellis2/wasm-xatlas.js');
  const {NodeTrellisUVWorker} = await import('../models/trellis2/node-uv-worker.mjs');
  report.phase = 'read-input'; save();
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
  // Closest point plus that face's normal on a surface, through a BVH over it.
  const closestFor = (V, F) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(V, 3)); geometry.setIndex(new THREE.BufferAttribute(F, 1));
    const bvh = new MeshBVH(geometry), point = new THREE.Vector3(), hit = {};
    return (x, y, z) => {
      bvh.closestPointToPoint(point.set(x, y, z), hit);
      const t = hit.faceIndex * 3, a = F[t]*3, b = F[t+1]*3, c = F[t+2]*3;
      const ux = V[b]-V[a], uy = V[b+1]-V[a+1], uz = V[b+2]-V[a+2], wx = V[c]-V[a], wy = V[c+1]-V[a+1], wz = V[c+2]-V[a+2];
      const nx = uy*wz-uz*wy, ny = uz*wx-ux*wz, nz = ux*wy-uy*wx, l = Math.hypot(nx, ny, nz) || 1;
      return {point: [hit.point.x, hit.point.y, hit.point.z], normal: [nx/l, ny/l, nz/l]};
    };
  };
  const closestSource = closestFor(vertices, triangles);
  const closestPoint = (x, y, z) => closestSource(x, y, z).point;
  report.phase = 'tiers'; save();
  const started = performance.now();
  const tiers = await prepareLowTiers({mesh: {vertices, triangles}, materialFields, targets, closestPoint, finish: finishTrellisMesh,
    unwrapMesh: createWasmXatlasUnwrapper(), WorkerClass: NodeTrellisUVWorker, measure: {closestSource, closestFor}, provenance: {input: meta.source ?? input, route: meta.route}});
  report.tierSeconds = (performance.now() - started) / 1000;
  report.phase = 'publish'; save();
  for (const tier of tiers) {
    const body = async response => { const text = await response.text(); try { return JSON.parse(text); } catch { return {raw: text.slice(0, 500)}; } };
    const ingest = await fetch(`${server}/api/ingest-mesh`, {method: 'POST', body: Buffer.from(tier.glb)});
    const stored = await body(ingest);
    if (!ingest.ok) { report.failedTier = tier.target; throw Error(`ingest failed for ${tier.target} (HTTP ${ingest.status}): ${JSON.stringify(stored)}`); }
    const level = {sha256: stored.sha256, faces: tier.faces, route: tier.route, textureSize: tier.textureSize,
      closed: tier.closed, boundaryEdges: tier.boundaryEdges, nonManifoldEdges: tier.nonManifoldEdges, error: tier.error};
    const register = await fetch(`${server}/api/mesh-lods`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({source, level})});
    const registered = await body(register);
    if (!register.ok) { report.failedTier = tier.target; report.orphanedIngest = stored.sha256;
      throw Error(`register failed for ${tier.target} (HTTP ${register.status}): ${JSON.stringify(registered)}`); }
    report.tiers.push({target: tier.target, ...level, bytes: tier.glb.byteLength, timing: tier.timing}); save();
  }
  report.phase = 'done';
} catch (error) {
  report.error = {message: error.message, stack: error.stack}; process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({phase: report.phase, error: report.error?.message, tiers: report.tiers.map(t => [t.target, t.faces, t.sha256.slice(0, 8)])}));
}
