import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { balancedWgslBlock } from './helpers/wgsl-guard-ownership.mjs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const producer = balancedWgslBlock(core, 'fn cache_render_flow(');
assert.match(producer, /gid\.x >= GRID \|\| gid\.y >= GRID_Y \|\| gid\.z >= GRID/);
assert.match(producer, /length\(curlAtCell\(c\)\), abs\(divergenceAtCell\(c\)\)/,
  'cache derives the same full precision nearest-cell scalars, not a new optical approximation');
assert.match(core, /format: 'rg32float'/, 'no half precision loss in the derived cache');
assert.match(core, /if \(CACHED_RENDER_FLOW\)[\s\S]*textureLoad\(renderFlowCache, c, 0\)\.xy/);
const draw = balancedWgslBlock(core.replace('targetPipeline = pipeline, options = {}', 'targetPipeline = pipeline, options'), 'function encodeDraw(');
assert.match(draw, /encodeRenderFlowCache\(encoder, options\.renderFlowTimestampWrites\)/);
assert.ok(draw.indexOf('encodeRenderFlowCache(') < draw.indexOf('const pass = encoder.beginRenderPass('),
  'refresh must precede the consumer, including held redraws');
const refresh = balancedWgslBlock(core, 'function encodeRenderFlowCache(');
assert.match(refresh, /fluidFrontReadBindGroups\[currentFluid\]/, 'current ping-pong state is the producer source');
assert.doesNotMatch(refresh, /return;|simStepCount\s*===/, 'no step-only invalidation that misses imports or paused edits');
assert.match(core, /renderFlowCacheTexture\?\.destroy\(\)/, 'grid rebuild/disposal releases the cache');
assert.match(core, /renderFlowCache: \{[\s\S]*state\.renderFlowCache/);
const witness = readFileSync(new URL('../scripts/compare-emissive-raymarch.mjs', import.meta.url), 'utf8');
assert.match(witness, /setDebugRenderFlowCache\(cache\)/, 'witness compares actual cache arms, not two identical shaders');
assert.match(witness, /profile\.renderFlowCache\.effective/, 'timing binds effective cache identity');
assert.match(witness, /includeRenderFlow: flowExperiment/, 'net timing includes the new producer');
assert.match(witness, /advanced.*simStepCount/s, 'parity also exercises changed fluid state');
console.log('render-flow cache lifecycle and scalar contracts passed');
