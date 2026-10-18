// Prepare low LOD tiers for one TRELLIS generation and publish them to a Kaminos server.
//
//   node tools/prepare-lod-tiers.mjs --input <dir> --source <sha256> --server http://127.0.0.1:8484 \
//     [--targets 5000,1000,500] [--replace true] --report <path>
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
const targets = (args.get('--targets') || '5000,1000,500').split(',').map(Number), replace = args.get('--replace') === 'true';
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
  const {prepareLowTiers, readGLBWorldMesh, measureGeometricError} = await import('../mesh-lod-ladder.mjs');
  const {createHash} = await import('node:crypto');
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
  const heroResponse = await fetch(`${server}/api/read?root=generated-meshes&path=${source}.glb`);
  if (!heroResponse.ok) throw Error(`source mesh ${source} is not stored on ${server} (HTTP ${heroResponse.status})`);
  const heroGLB = await heroResponse.arrayBuffer();
  const digest = name => createHash('sha256').update(fs.readFileSync(path.join(input, name))).digest('hex');
  const inputDigests = {'vertices.f32': digest('vertices.f32'), 'triangles.u32': digest('triangles.u32')};
  // Refuse taken slots before storing anything (unless replacing): the server keeps one level per
  // (faces, route), and a tier stored but then refused would linger as an unregistered mesh.
  report.phase = 'preflight'; save();
  const ROUTE = 'closed-remesh+projection+trellis-simplify';
  const existing = await fetch(`${server}/api/mesh-lods?source=${source}`);
  if (!existing.ok) throw Error(`cannot read existing levels (HTTP ${existing.status})`);
  const existingLevels = (await existing.json()).levels;
  const slotTaken = faces => existingLevels.find(l => l.route === ROUTE && l.faces === faces);
  const taken = targets.map(slotTaken).filter(Boolean);
  if (taken.length && !replace) throw Error(taken.map(l => `a ${l.faces}-face ${l.route} level is already registered: ${l.sha256}`).join('; '));
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
    unwrapMesh: createWasmXatlasUnwrapper(), WorkerClass: NodeTrellisUVWorker, measure: {closestSource, closestFor, reference: {kind: 'raw-decode', input: meta.source ?? input, digests: inputDigests, faces: triangles.length / 3}}, provenance: {input: meta.source ?? input, route: meta.route}});
  report.tierSeconds = (performance.now() - started) / 1000;
  // Error against the hero, in the world frame both are drawn in. A frame mismatch is refused
  // before anything is stored.
  report.phase = 'frame-check'; save();
  const hero = readGLBWorldMesh(heroGLB);
  const bounds = V => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < V.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], V[i+a]); hi[a] = Math.max(hi[a], V[i+a]); } return {lo, hi}; };
  const hb = bounds(hero.vertices), heroDiagonal = Math.hypot(...hb.hi.map((h, a) => h - hb.lo[a])), heroClosest = closestFor(hero.vertices, hero.faces);
  for (const tier of tiers) {
    const world = readGLBWorldMesh(tier.glb), tb = bounds(world.vertices);
    const drift = Math.max(...[0, 1, 2].flatMap(a => [Math.abs(tb.lo[a] - hb.lo[a]), Math.abs(tb.hi[a] - hb.hi[a])])) / heroDiagonal;
    tier.frameDrift = drift;
    // A wrong frame (rotation, swapped axes) drifts by tens of percent; a closed remesh legitimately
    // grows thin parts by up to one grid cell, a few percent. Smaller misalignment shows in the error.
    if (!(drift <= 0.1)) throw Error(`level ${tier.target} bounds differ from the hero by ${(drift * 100).toFixed(1)}% of its diagonal; frames disagree`);
    tier.errorAgainstRawDecode = tier.error;
    tier.error = measureGeometricError({source: hero, level: world, closestSource: heroClosest, closestLevel: closestFor(world.vertices, world.faces),
      reference: {kind: 'hero', sha256: source, faces: hero.faces.length / 3}});
    const slot = slotTaken(tier.faces);
    if (slot && !replace && !targets.includes(tier.faces)) throw Error(`level ${tier.target} landed at ${tier.faces} faces, a slot already registered: ${slot.sha256}`);
  }
  report.phase = 'publish'; save();
  for (const tier of tiers) {
    const body = async response => { const text = await response.text(); try { return JSON.parse(text); } catch { return {raw: text.slice(0, 500)}; } };
    const ingest = await fetch(`${server}/api/ingest-mesh`, {method: 'POST', body: Buffer.from(tier.glb)});
    const stored = await body(ingest);
    if (!ingest.ok) { report.failedTier = tier.target; throw Error(`ingest failed for ${tier.target} (HTTP ${ingest.status}): ${JSON.stringify(stored)}`); }
    const level = {sha256: stored.sha256, faces: tier.faces, route: tier.route, textureSize: tier.textureSize,
      closed: tier.closed, boundaryEdges: tier.boundaryEdges, nonManifoldEdges: tier.nonManifoldEdges, frameDrift: tier.frameDrift,
      error: tier.error, errorAgainstRawDecode: tier.errorAgainstRawDecode};
    const register = await fetch(`${server}/api/mesh-lods`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({source, level, supersede: replace})});
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
