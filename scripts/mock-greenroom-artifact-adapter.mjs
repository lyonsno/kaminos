#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  if (!key?.startsWith('--')) continue;
  args.set(key.slice(2), process.argv[++i]);
}

const input = args.get('input');
const output = args.get('output');
const report = args.get('report');

if (!input || !output || !report) {
  throw new Error('mock greenroom artifact adapter expected --input, --output, and --report');
}

mkdirSync(dirname(output), { recursive: true });
mkdirSync(dirname(report), { recursive: true });

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEElEQVR42mP8z8AARLJgYGBgAAA3AQIFhWZC9QAAAABJRU5ErkJggg==',
  'base64',
);
if (output.endsWith('.json')) {
  writeFileSync(output, JSON.stringify({
    schema: 'kaminos.pbr-material-bundle.v0',
    generatedBy: 'mock-greenroom-artifact-adapter',
    maps: {
      basecolor: null,
      normal: null,
      roughness: null,
      metalness: null,
    },
  }, null, 2));
} else {
  writeFileSync(output, tinyPng);
}

writeFileSync(report, JSON.stringify({
  schema: 'kaminos.mock-greenroom-artifact-adapter-report.v0',
  ok: true,
  phase: 'complete',
  backend: 'mock-greenroom-artifact-adapter',
  input: { path: input },
  output: { path: output },
}, null, 2));
