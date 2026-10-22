// Prepare low LOD tiers for one TRELLIS generation and publish them to a Kaminos server.
//
//   node tools/prepare-lod-tiers.mjs --input <dir> --source <sha256> --server http://127.0.0.1:8484 \
//     [--targets 5000,1000,500] [--replace true] [--normal-maps false] [--reference raw-decode] --report <path>
//
// <dir> holds the generation's raw mesh and material field: vertices.f32, triangles.u32,
// material.features.f32, material.coordinates.i32 and meta.json {materialResolution}.
// <sha256> is the stored mesh the levels belong to (normally the generation's hero GLB). With
// --reference raw-decode it can be any stored asset of the run (a surfels-only run's surfel GLB);
// the levels are then measured against, and their normal maps baked from, the raw decode.
// Each tier gets a tangent-space normal map baked from the hero's shading normals (unless
// --normal-maps false), then is ingested through /api/ingest-mesh and registered through /api/mesh-lods.
// The report is written at every phase, including on failure.
import fs from 'node:fs';
import path from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const input = args.get('--input'), source = args.get('--source'), server = args.get('--server'), reportPath = args.get('--report');
const targets = (args.get('--targets') || '5000,1000,500').split(',').map(Number), replace = args.get('--replace') === 'true', normalMaps = args.get('--normal-maps') !== 'false', reference = args.get('--reference') || 'hero';
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
  const {prepareGenerationLevels} = await import('../lod-generation-levels.mjs');
  const {finishTrellisMesh} = await import('../models/trellis2/trellis-material.js');
  const {createWasmXatlasUnwrapper} = await import('../models/trellis2/wasm-xatlas.js');
  const {NodeTrellisUVWorker} = await import('../models/trellis2/node-uv-worker.mjs');
  report.phase = 'read-input'; save();
  const read = (n, T) => { const b = fs.readFileSync(path.join(input, n)); return new T(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
  const meta = JSON.parse(fs.readFileSync(path.join(input, 'meta.json'), 'utf8'));
  report.inputMeta = meta;
  const vertices = read('vertices.f32', Float32Array), triangles = read('triangles.u32', Uint32Array);
  const materialFields = {features: read('material.features.f32', Float32Array), coordinates: read('material.coordinates.i32', Int32Array), resolution: meta.materialResolution};
  // The same steps the page runs at Generate (lod-generation-levels.mjs), with Node's worker and fetch.
  await prepareGenerationLevels({decode: {vertices, triangles}, materialFields, source, server, THREE, MeshBVH, finish: finishTrellisMesh,
    unwrapMesh: createWasmXatlasUnwrapper(), WorkerClass: NodeTrellisUVWorker, targets, replace, normalMaps, input: meta.source ?? input, route: meta.route,
    reference, report, onPhase: save});
  if (report.error) throw Object.assign(Error(report.error.message), {stack: report.error.stack});
} catch (error) {
  report.error = {message: error.message, stack: error.stack}; process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({phase: report.phase, error: report.error?.message, tiers: report.tiers.map(t => [t.target, t.faces, t.sha256.slice(0, 8)])}));
}
