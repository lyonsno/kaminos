import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const witness = await readFile(new URL('../volume-boundary-splat-scale-witness.mjs', import.meta.url), 'utf8').catch(() => '');
const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../index.html', import.meta.url), 'utf8');

assert.match(witness, /kaminos\.volume\.boundary-splat-scale-witness\.v0/, 'scale witness must publish a stable report schema');
assert.match(witness, /\[1, 4, 16, 25, 64, 100\]/, 'scale witness must run the steward-specified count ladder in order');
assert.match(witness, /sampleBoundarySplatInstanceCostLadder/, 'scale witness must use the runtime GPU ladder rather than infer cost from draw counts');
assert.match(witness, /connected-existing/, 'scale witness must record reuse of the persistent browser');
assert.match(witness, /preserved-open/, 'scale witness must leave the existing browser session open');
assert.match(witness, /failed-before-primary-output/, 'scale witness must write a durable failure report before primary output exists');
assert.match(witness, /stale-or-default-config/, 'scale witness must fail loud when requested composition or instance controls do not become effective');
assert.match(witness, /blank-or-partial-native-capture/, 'scale witness must reject missing or blank visual output');

assert.match(core, /advanceSimulation:\s*false/, 'GPU ladder must label frozen-simulator timing authority explicitly');
assert.match(core, /simStepCountBefore/, 'GPU ladder must record simulator state before serial measurements');
assert.match(core, /simStepCountAfter/, 'GPU ladder must record simulator state after serial measurements');
assert.match(core, /timestampStatus:\s*'available'/, 'GPU ladder must require timestamp-backed stage evidence');
assert.match(page, /boundarySplatCompositionCameraPose/, 'page must own a deterministic camera pose for composed-field routes');
assert.match(page, /boundary-splat-composed-field-camera-v0/, 'camera telemetry must publish the effective composed-field camera identity');

console.log('boundary splat scale witness contracts passed');
