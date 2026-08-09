#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGlbNodeGeometries } from '../bone-containment-probe-core.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRelative = 'artifacts/cast-correspondence-v0/frozen/skeleton-authored.glb';
const outputRelative = 'artifacts/cast-correspondence-v0/frozen/m31-authored-supports.probe.json';
const outputIndex = process.argv.indexOf('--output');
const outputPath = resolve(repoRoot, outputIndex >= 0 ? process.argv[outputIndex + 1] : outputRelative);
const bytes = await readFile(resolve(repoRoot, sourceRelative));
const geometries = new Map(parseGlbNodeGeometries(bytes).map(entry => [entry.name, entry.geometry]));

const supports = ['Cube.002', 'Cube.003'].map(name => {
  const geometry = geometries.get(name);
  if (!geometry) throw new Error(`Authored skeleton support ${name} is missing`);
  const unique = new Map();
  for (let index = 0; index < geometry.positions.length; index += 3) {
    const point = Array.from(geometry.positions.slice(index, index + 3));
    const key = point.map(value => value.toFixed(9)).join(',');
    if (!unique.has(key)) unique.set(key, point);
  }
  return { name, positionsWorld: [...unique.values()].flat(), vertexCount: unique.size };
});
const output = {
  schema: 'kaminos.m31-authored-support-probe.v0',
  source: sourceRelative,
  sourceSha256: createHash('sha256').update(bytes).digest('hex'),
  supports,
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output)}\n`);
process.stdout.write(`${JSON.stringify({
  status: 'written',
  outputPath,
  sourceSha256: output.sourceSha256,
  supports: supports.map(({ name, vertexCount }) => ({ name, vertexCount })),
})}\n`);
