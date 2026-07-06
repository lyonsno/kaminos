import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const smokeJs = readFileSync(new URL('../smokes/sam-mask-island-parity.js', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../tools/sam-mask-island-browser-parity-smoke.mjs', import.meta.url), 'utf8');
const stackExporter = readFileSync(new URL('../tools/sam-detr-stack-mlx-packet.py', import.meta.url), 'utf8');

assert.match(packageJson.scripts.test, /sam-detector-stack-witness-contracts\.mjs/, 'default test must include canonical detector-stack witness contracts');

assert.match(stackExporter, /--detector-stack/, 'DETR stack exporter must expose a canonical detector-stack switch');
assert.match(stackExporter, /DETECTOR_STACK_SCHEMA/, 'DETR stack exporter must stamp a detector-stack schema');
assert.match(stackExporter, /mlx-detector-stack-export/, 'DETR stack exporter must stamp a canonical detector-stack mode');
assert.match(stackExporter, /upstreamBoundaries/, 'DETR stack exporter must name MLX-owned upstream boundaries');

assert.match(witness, /mlx-detector-stack-export/, 'CLI witness must allow canonical detector-stack packet mode');
assert.match(witness, /detectorStackReport/, 'CLI witness must emit a compact detectorStack report block');
assert.match(witness, /assertDetectorStackEvidence/, 'CLI witness must centralize detector-stack false-closure checks');
assert.match(witness, /selectionEmptyEvidenceRejected/, 'CLI witness must reject empty selection as canonical detector-stack evidence');

assert.match(smokeJs, /detector-stack-browser-local-composition/, 'browser smoke must expose a canonical detector-stack route kind');
assert.match(smokeJs, /detectorStackEvidence/, 'browser smoke must expose compact detector-stack evidence');
assert.match(smokeJs, /upstreamBoundaries/, 'browser smoke must surface remaining MLX upstream boundaries');

console.log('sam detector stack witness contracts passed');
