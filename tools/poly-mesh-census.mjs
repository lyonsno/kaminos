#!/usr/bin/env node
// What the polygon kernel sees in a GLB: render vertices against welded topology,
// open and non-manifold edges, creases and seams. Read-only.
//   node tools/poly-mesh-census.mjs --glb mesh.glb [--sharp-angle 30] [--out census.json]
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readTrianglePrimitives } from '../poly-glb-io.mjs';
import { buildPolyMesh, polyMeshCensus } from '../poly-mesh-core.mjs';

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`invalid argument sequence near ${key ?? '<end>'}`);
    args.set(key, value);
  }
  if (!args.has('--glb')) throw new Error('--glb is required');
  return args;
}

const args = parseArgs(process.argv.slice(2));
const source = resolve(args.get('--glb')), sharpAngle = Number(args.get('--sharp-angle') ?? 30);
const bytes = await readFile(source), started = performance.now();
const primitives = readTrianglePrimitives(bytes).map(primitive => {
  const mesh = buildPolyMesh(primitive);
  return { mesh: primitive.mesh, primitive: primitive.primitive, material: primitive.material, nodes: primitive.nodes,
    attributes: { normals: !!primitive.normals, uvs: !!primitive.uvs }, census: polyMeshCensus(mesh, { sharpAngle }) };
});
const report = { schema: 'kaminos.poly-mesh-census.v0', source, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
  kernel: 'poly-mesh-core.mjs', weld: 'exact-float32-position', elapsedMs: Math.round(performance.now() - started), primitives };
const text = `${JSON.stringify(report, null, 2)}\n`;
if (args.has('--out')) { const out = resolve(args.get('--out')); await mkdir(dirname(out), { recursive: true }); await writeFile(out, text); }
process.stdout.write(text);
