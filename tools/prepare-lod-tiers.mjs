// Prepare low LOD tiers for one TRELLIS generation and publish them to a Kaminos server.
//
//   node tools/prepare-lod-tiers.mjs --input <dir> --source <sha256> --server http://127.0.0.1:8484 \
//     [--targets 25000,10000,5000,1000,500] [--replace true] [--normal-maps false] [--reference raw-decode] --report <path>
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
const rawTargets = args.get('--targets'), targets = rawTargets === 'none' ? [] : (rawTargets || '25000,10000,5000,1000,500').split(',').filter(Boolean).map(Number);
const surfelFactors = (args.get('--surfel-factors') || '').split(',').filter(Boolean).map(Number);
const replace = args.get('--replace') === 'true', normalMaps = args.get('--normal-maps') !== 'false', reference = args.get('--reference') || 'hero';
const report = {schema: 'kaminos.lod-tiers-report.v0', phase: 'admission', input, source, server, targets, ...(surfelFactors.length ? {surfelFactors} : {}), startedAt: new Date().toISOString(), tiers: []};
const save = () => reportPath && fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
try {
  if (!server || !reportPath || !/^[a-f0-9]{64}$/.test(source || '') || (surfelFactors.length && !input))
    throw Error('--source <sha256>, --server and --report are required (--input <dir> required for --surfel-factors)');
  if ((!targets.length && !surfelFactors.length) || !targets.every(t => Number.isSafeInteger(t) && t > 0) || !surfelFactors.every(k => Number.isSafeInteger(k) && k > 0))
    throw Error('--targets / --surfel-factors must be positive integers');
  save();
  // Loaded here so a missing dependency still ends in a written failure report.
  report.phase = 'load-modules'; save();
  const THREE = await import(process.env.KAMINOS_LOD_THREE_MODULE || 'three');
  const {MeshBVH} = await import('three-mesh-bvh');
  const {prepareGenerationLevels} = await import('../lod-generation-levels.mjs');
  const {finishTrellisMesh} = await import('../models/trellis2/trellis-material.js');
  const {createWasmXatlasUnwrapper} = await import('../models/trellis2/wasm-xatlas.js');
  const {NodeTrellisUVWorker} = await import('../models/trellis2/node-uv-worker.mjs');
  let decode = null, materialFields = null, heroGLB = null, inputName = input, routeName = null;
  if (input) {
    report.phase = 'read-input'; save();
    if (fs.existsSync(input) && fs.statSync(input).isFile()) {
      const b = fs.readFileSync(input);
      heroGLB = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    } else {
      const read = (n, T) => { const b = fs.readFileSync(path.join(input, n)); return new T(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
      const meta = JSON.parse(fs.readFileSync(path.join(input, 'meta.json'), 'utf8'));
      report.inputMeta = meta;
      const vertices = read('vertices.f32', Float32Array), triangles = read('triangles.u32', Uint32Array);
      const geomCoordFile = ['geometry.coordinates.i32', 'coordinates.i32'].find(n => fs.existsSync(path.join(input, n)));
      const coordinates = geomCoordFile ? read(geomCoordFile, Int32Array) : undefined;
      decode = {vertices, triangles, ...(coordinates ? {coordinates} : {})};
      materialFields = {features: read('material.features.f32', Float32Array), coordinates: read('material.coordinates.i32', Int32Array), resolution: meta.materialResolution};
      inputName = meta.source ?? input;
      routeName = meta.route;
    }
  }
  // The same steps the page runs at Generate (lod-generation-levels.mjs), with Node's worker and fetch.
  await prepareGenerationLevels({decode, materialFields, heroGLB, source, server, THREE, MeshBVH, finish: finishTrellisMesh,
    unwrapMesh: createWasmXatlasUnwrapper(), WorkerClass: NodeTrellisUVWorker, targets, surfelFactors, replace, normalMaps, input: inputName, route: routeName,
    reference, report, onPhase: save});
  if (report.error) throw Object.assign(Error(report.error.message), {stack: report.error.stack});
} catch (error) {
  report.error = {message: error.message, stack: error.stack}; process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({phase: report.phase, error: report.error?.message, tiers: report.tiers.map(t => [t.target, t.faces, t.sha256.slice(0, 8)])}));
}
