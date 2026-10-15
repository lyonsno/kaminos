#!/usr/bin/env node
// Separate one part of a generated GLB with a local plane cut, from a terminal.
// Faces whose centroids lie in --region are cut by the plane; Select Linked from
// the face nearest --seed, stopped at the cut, is the part; both openings get a
// section cap. Writes part.glb, rest.glb and receipt.json; the source is untouched.
//   node tools/poly-separate.mjs --glb in.glb --out-dir dir --plane-point x,y,z --plane-normal x,y,z
//     --region-min x,y,z --region-max x,y,z --seed x,y,z [--fill outline|winding] [--name Cup]
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readTrianglePrimitives, writeDerivedGlb } from '../poly-glb-io.mjs';
import { buildPolyMesh, polyMeshCensus, selectLinkedFaces } from '../poly-mesh-core.mjs';
import { bisectFaces, cutBarrier, extractFaces, sectionCap } from '../poly-mesh-edit.mjs';

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`invalid argument sequence near ${key ?? '<end>'}`);
    args.set(key, value);
  }
  for (const required of ['--glb', '--out-dir', '--plane-point', '--plane-normal', '--region-min', '--region-max', '--seed']) if (!args.has(required)) throw new Error(`${required} is required`);
  return args;
}
const vector = (args, key) => { const v = args.get(key).split(',').map(Number); if (v.length !== 3 || !v.every(Number.isFinite)) throw new Error(`${key} must be x,y,z`); return v; };

const args = parseArgs(process.argv.slice(2));
const source = resolve(args.get('--glb')), outDir = resolve(args.get('--out-dir')), fill = args.get('--fill') ?? 'outline', name = args.get('--name') ?? 'Part';
const plane = { point: vector(args, '--plane-point'), normal: vector(args, '--plane-normal') };
const region = { min: vector(args, '--region-min'), max: vector(args, '--region-max') }, seedPoint = vector(args, '--seed');
const bytes = await readFile(source), started = performance.now();
const primitives = readTrianglePrimitives(bytes);
if (primitives.length !== 1) throw new Error(`expected one triangle primitive, found ${primitives.length}`);
const [primitive] = primitives, arrays = { positions: primitive.positions, normals: primitive.normals, uvs: primitive.uvs, indices: primitive.indices };
const centroid = (a, f) => [0, 1, 2].map(k => (a.positions[3 * a.indices[3 * f] + k] + a.positions[3 * a.indices[3 * f + 1] + k] + a.positions[3 * a.indices[3 * f + 2] + k]) / 3);
const faceCount = arrays.indices.length / 3, band = new Uint8Array(faceCount);
for (let f = 0; f < faceCount; f++) { const c = centroid(arrays, f); band[f] = c.every((x, k) => x >= region.min[k] && x <= region.max[k]) ? 1 : 0; }
const cut = bisectFaces(arrays, band, plane), mesh = buildPolyMesh(cut.arrays), barrier = cutBarrier(mesh, cut.side);
let seed = -1, best = Infinity;
for (let f = 0; f < mesh.faceCount; f++) { const c = centroid(cut.arrays, f), d = (c[0] - seedPoint[0]) ** 2 + (c[1] - seedPoint[1]) ** 2 + (c[2] - seedPoint[2]) ** 2; if (d < best) { best = d; seed = f; } }
const partMask = selectLinkedFaces(mesh, [seed], { barrier });
const seedSide = Math.sign((seedPoint[0] - plane.point[0]) * plane.normal[0] + (seedPoint[1] - plane.point[1]) * plane.normal[1] + (seedPoint[2] - plane.point[2]) * plane.normal[2]);
if (!seedSide) throw new Error('--seed must lie off the cut plane, on the side of the part');
const { part, rest } = extractFaces(cut.arrays, partMask);
const sha256 = createHash('sha256').update(bytes).digest('hex');
await mkdir(outDir, { recursive: true });
const report = { schema: 'kaminos.poly-separate.v0', source: { path: source, sha256 }, plane, region, seed: { point: seedPoint, face: seed, side: seedSide }, fill,
  cut: { bandFaces: band.reduce((a, b) => a + b, 0), cutVertices: cut.cutVertices, barrierEdges: barrier.reduce((a, b) => a + b, 0) }, outputs: {} };
for (const [key, piece, side] of [['part', part, seedSide], ['rest', rest, -seedSide]]) {
  const cap = sectionCap(piece, arrays, band, plane, { side, fill });
  const census = polyMeshCensus(buildPolyMesh(cap.arrays));
  const receipt = { schema: 'kaminos.poly-derivation.v0', source: { sha256, url: source }, operations: [
    { op: 'bisect', plane, region: { kind: 'face-centroid-box', ...region } },
    { op: 'select-linked', seed: seedPoint, barrier: 'cut' },
    { op: 'separate', keep: key },
    { op: 'section-cap', fill, side, capFaces: cap.capFaces, regions: cap.regions, openChains: cap.openChains } ] };
  const glb = writeDerivedGlb(bytes, cap.arrays, { name: key === 'part' ? name : `${name} remainder`, receipt });
  const path = join(outDir, `${key}.glb`); await writeFile(path, glb);
  report.outputs[key] = { path, sha256: createHash('sha256').update(glb).digest('hex'), bytes: glb.length, faces: cap.arrays.indices.length / 3, capFaces: cap.capFaces,
    capRegions: cap.regions, openChains: cap.openChains, boundaryEdges: census.boundaryEdges, nonManifoldEdges: census.nonManifoldEdges };
}
report.elapsedMs = Math.round(performance.now() - started);
await writeFile(join(outDir, 'receipt.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
