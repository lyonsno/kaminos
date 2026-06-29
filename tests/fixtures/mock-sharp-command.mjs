#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);

const input = args.get('--input');
const output = args.get('--output');
const report = args.get('--report');
if (!input || !output || !report) {
  throw new Error('mock SHARP expected --input, --output, and --report');
}
const artifactPaths = JSON.parse(process.env.KAMINOS_PIPELINE_ARTIFACT_PATHS || '{}');
const depthPath = artifactPaths.depthMap;
const metadataPath = artifactPaths.metadata;
const autoCropEvidencePath = artifactPaths.autoCropEvidence;
if (!depthPath || !metadataPath || !autoCropEvidencePath) {
  throw new Error('mock SHARP expected depthMap, metadata, and autoCropEvidence artifact paths');
}

const delayMs = Number(process.env.KAMINOS_MOCK_SHARP_DELAY_MS || 0);
if (Number.isFinite(delayMs) && delayMs > 0) {
  await new Promise(resolve => setTimeout(resolve, delayMs));
}

const inputBytes = readFileSync(input);
const inputSha256 = createHash('sha256').update(inputBytes).digest('hex');
const points = [];
for (let y = 0; y < 27; y += 1) {
  for (let x = 0; x < 27; x += 1) {
    const nx = (x - 13) / 13;
    const ny = (y - 13) / 13;
    const radius = Math.hypot(nx, ny);
    const z = Math.cos(radius * Math.PI) * 0.18;
    const red = Math.round(80 + 175 * Math.max(0, 1 - radius * 0.55));
    const green = Math.round(80 + 140 * Math.max(0, 1 - Math.abs(nx)));
    const blue = Math.round(120 + 100 * Math.max(0, 1 - Math.abs(ny)));
    points.push(`${nx.toFixed(4)} ${ny.toFixed(4)} ${z.toFixed(4)} ${red} ${green} ${blue}`);
  }
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, [
  'ply',
  'format ascii 1.0',
  'comment mock live SHARP output',
  `comment source_sha256 ${inputSha256}`,
  `element vertex ${points.length}`,
  'property float x',
  'property float y',
  'property float z',
  'property uchar red',
  'property uchar green',
  'property uchar blue',
  'end_header',
  ...points,
  '',
].join('\n'));

const outputStat = statSync(output);
mkdirSync(dirname(depthPath), { recursive: true });
writeFileSync(depthPath, 'mock sharp depth png bytes\n');
mkdirSync(dirname(metadataPath), { recursive: true });
writeFileSync(metadataPath, `${JSON.stringify({
  schema: 'kaminos.sharp-webgpu-metadata.v0',
  input: { path: input, sha256: inputSha256 },
  output: { path: output, bytes: outputStat.size },
  depthMap: { path: depthPath },
}, null, 2)}\n`);
mkdirSync(dirname(autoCropEvidencePath), { recursive: true });
writeFileSync(autoCropEvidencePath, `${JSON.stringify({
  schema: 'kaminos.splat-autocrop-evidence.v0',
  status: 'complete',
  authority: {
    freshness: 'fresh',
    evidenceMode: 'fixture-derived-from-generated-ply-and-depth',
    downgrades: ['mock-adapter-fixture-not-real-sharp-inference'],
  },
  sourceImage: { path: input, sha256: inputSha256 },
  generated: {
    ply: { path: output, bytes: outputStat.size },
    sidecar: { path: artifactPaths.sidecar || null, routeIdentity: 'sharp-image-to-splat-live-v0' },
  },
  sharp: {
    depthMap: { path: depthPath },
    metadata: { path: metadataPath },
  },
  cropSignal: {
    provenance: 'mock adapter generated point bounds',
    bounds: {
      min: { x: -1, y: -1, z: -0.18 },
      max: { x: 1, y: 1, z: 0.18 },
    },
    suggestedPivot: { x: 0, y: 0, z: 0 },
    candidateCrop: { min: { x: -1, y: -1 }, max: { x: 1, y: 1 }, units: 'normalized-image' },
  },
  rejectedDebugSurfaces: [],
}, null, 2)}\n`);
mkdirSync(dirname(report), { recursive: true });
writeFileSync(report, `${JSON.stringify({
  schema: 'kaminos.mock-sharp-adapter-report.v0',
  ok: true,
  input,
  output,
  inputSha256,
  outputBytes: outputStat.size,
  sideArtifacts: [
    { id: 'depthMap', role: 'depth-map', path: depthPath },
    { id: 'metadata', role: 'sharp-webgpu-metadata', path: metadataPath },
    { id: 'autoCropEvidence', role: 'splat-autocrop-evidence', path: autoCropEvidencePath, schema: 'kaminos.splat-autocrop-evidence.v0' },
  ],
  outputs: {
    splat: { id: 'splat', role: 'splat-candidate', path: output },
    depthMap: { id: 'depthMap', role: 'depth-map', path: depthPath },
    metadata: { id: 'metadata', role: 'sharp-webgpu-metadata', path: metadataPath },
    autoCropEvidence: { id: 'autoCropEvidence', role: 'splat-autocrop-evidence', path: autoCropEvidencePath, schema: 'kaminos.splat-autocrop-evidence.v0' },
  },
}, null, 2)}\n`);
