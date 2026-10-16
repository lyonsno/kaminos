#!/usr/bin/env node
// Time the Edit Mode operations on a real GLB, without a browser: kernel build, Select Linked,
// Slice and Separate, so changes to the kernel can be measured against the same input.
//   node tools/poly-bench.mjs --glb in.glb [--repeat 5]
import { readFile } from 'node:fs/promises';
import { readTrianglePrimitives } from '../poly-glb-io.mjs';
import { buildPolyMesh, selectLinkedFaces } from '../poly-mesh-core.mjs';
import { separateSelection, sliceSelection } from '../poly-separate-selection.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
if (!args.has('--glb')) throw new Error('--glb is required');
const bytes = new Uint8Array(await readFile(args.get('--glb'))), repeat = Number(args.get('--repeat') ?? 5);
const [p] = readTrianglePrimitives(bytes), arrays = { positions: p.positions, normals: p.normals, uvs: p.uvs, indices: p.indices };
const faces = arrays.indices.length / 3, centroid = (f, k) => (arrays.positions[3 * arrays.indices[3 * f] + k] + arrays.positions[3 * arrays.indices[3 * f + 1] + k] + arrays.positions[3 * arrays.indices[3 * f + 2] + k]) / 3;
// The neck band the arm's cup cut uses, through the whole depth as an x-ray box would select.
const band = Uint8Array.from({ length: faces }, (_, f) => centroid(f, 1) >= 0.22 && centroid(f, 1) <= 0.28 && centroid(f, 2) >= 0.29 && centroid(f, 2) <= 0.45 ? 1 : 0);
const cup = Uint8Array.from({ length: faces }, (_, f) => centroid(f, 1) > 0.3 ? 1 : 0);
const time = (name, work) => { const ms = []; let out; for (let i = 0; i < repeat; i++) { const t = performance.now(); out = work(); ms.push(performance.now() - t); } ms.sort((a, b) => a - b); return { name, medianMs: Math.round(ms[ms.length >> 1]), minMs: Math.round(ms[0]), out }; };
const rows = [
  time('buildPolyMesh', () => buildPolyMesh(arrays)),
];
const mesh = rows[0].out;
rows.push(time('selectLinkedFaces', () => selectLinkedFaces(mesh, [0])));
rows.push(time('slice', () => sliceSelection(bytes, band, { point: [0, 0.25, 0], normal: [0, 1, 0] })));
rows.push(time('separate', () => separateSelection(bytes, cup)));
process.stdout.write(`${JSON.stringify({ faces, bandFaces: band.reduce((a, b) => a + b, 0), repeat, rows: rows.map(({ name, medianMs, minMs }) => ({ name, medianMs, minMs })) }, null, 1)}\n`);
