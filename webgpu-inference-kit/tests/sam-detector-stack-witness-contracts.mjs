import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const smokeJs = readFileSync(new URL('../smokes/sam-mask-island-parity.js', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../tools/sam-mask-island-browser-parity-smoke.mjs', import.meta.url), 'utf8');
const stackExporter = readFileSync(new URL('../tools/sam-detr-stack-mlx-packet.py', import.meta.url), 'utf8');

assert.match(packageJson.scripts.test, /sam-detector-stack-witness-contracts\.mjs/, 'default test must include canonical detector-stack witness contracts');
assert.match(packageJson.scripts['test:live:sam-detector-stack'] || '', /sam-mask-island-browser-parity-smoke\.mjs/, 'package must expose a canonical live detector-stack browser witness script');
assert.match(packageJson.scripts['test:live:sam-detector-stack'] || '', /--packet-mode mlx-detector-stack-export/, 'canonical live detector-stack script must use detector-stack packet mode, not an older selection export');
assert.match(packageJson.scripts['test:live:sam-detector-stack'] || '', /sam-detector-stack/, 'canonical live detector-stack script must write detector-stack-named evidence artifacts');
assert.match(packageJson.scripts['test:live:sam-detector-stack'] || '', /--score-threshold/, 'canonical live detector-stack script must make the score threshold explicit');

assert.match(stackExporter, /--detector-stack/, 'DETR stack exporter must expose a canonical detector-stack switch');
assert.match(stackExporter, /DETECTOR_STACK_SCHEMA/, 'DETR stack exporter must stamp a detector-stack schema');
assert.match(stackExporter, /mlx-detector-stack-export/, 'DETR stack exporter must stamp a canonical detector-stack mode');
assert.match(stackExporter, /upstreamBoundaries/, 'DETR stack exporter must name MLX-owned upstream boundaries');

assert.match(witness, /mlx-detector-stack-export/, 'CLI witness must allow canonical detector-stack packet mode');
assert.match(witness, /detectorStackReport/, 'CLI witness must emit a compact detectorStack report block');
assert.match(witness, /assertDetectorStackEvidence/, 'CLI witness must centralize detector-stack false-closure checks');
assert.match(witness, /selectionEmptyEvidenceRejected/, 'CLI witness must reject empty selection as canonical detector-stack evidence');
assert.match(witness, /visualSelectedMaskIndex/, 'CLI witness must report the mask index shown in the visual artifact');
assert.match(witness, /canonical detectorStack visual selected mask drift/, 'CLI witness must reject detector-stack visual output that renders a different mask than the selected object');

assert.match(smokeJs, /detector-stack-browser-local-composition/, 'browser smoke must expose a canonical detector-stack route kind');
assert.match(smokeJs, /detectorStackEvidence/, 'browser smoke must expose compact detector-stack evidence');
assert.match(smokeJs, /upstreamBoundaries/, 'browser smoke must surface remaining MLX upstream boundaries');
assert.match(smokeJs, /detectorSelectedMaskIndex/, 'browser smoke must derive canonical detector-stack visual mask selection from the detector output');
assert.match(smokeJs, /selectedMaskIndexSource/, 'browser smoke state must preserve whether visual selection came from detector output or legacy visualization metadata');

console.log('sam detector stack witness contracts passed');
