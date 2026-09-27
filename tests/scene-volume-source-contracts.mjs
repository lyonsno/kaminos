import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
assert.match(core, /sceneVolumeSourceField/, 'volume runtime must expose raw same-state source coefficients');
const {createSceneVolumeSource, SCENE_VOLUME_SOURCE_WGSL, integrateSceneMediumSegment} = await import('../scene-volume-source.mjs');
assert.equal(typeof integrateSceneMediumSegment, 'function', 'medium path needs an independently exercised segment reference');
const constant = {dimensions: [4,8,4], values: Array(4*8*4*4).fill(2)};
assert.equal(integrateSceneMediumSegment(constant, [0,-2,0], [0,4,0], .25), 8, 'clip both ends to tall volume');
assert.equal(integrateSceneMediumSegment(constant, [2,-2,0], [2,4,0], .25), 0, 'parallel segment misses');
assert.equal(integrateSceneMediumSegment(constant, [0,0,0], [0,0,0], .25), 0, 'zero length');
assert.equal(integrateSceneMediumSegment(constant, [0,0,0], [0,2,0], .25), 4, 'upper half participates');
const textures = [], dispatches = [];
globalThis.GPUTextureUsage = {STORAGE_BINDING: 1, TEXTURE_BINDING: 2, COPY_SRC: 4};
globalThis.GPUBufferUsage = {UNIFORM: 1, COPY_DST: 2};
const device = {
  queue: {writeBuffer() {}},
  createShaderModule(spec) {return spec;},
  createBuffer(spec) {return {spec, destroy() {}};},
  createTexture(spec) { const t = {spec, destroyed: false, createView: () => ({}), destroy() {this.destroyed = true;}}; textures.push(t); return t; },
  createComputePipeline(spec) {return {spec, getBindGroupLayout: i => i};},
  createBindGroup(spec) {return spec;},
};
const encoder = {beginComputePass() {return {setPipeline() {}, setBindGroup() {}, dispatchWorkgroups(...n) {dispatches.push(n);}, end() {}};}};
const field = createSceneVolumeSource({device, module: {}, uniformBuffer: {}, fluidBuffers: [{}, {}], frontBuffers: [{}, {}], grid: 32, gridY: 64});
assert.equal(typeof field.encodeOpticalDepth, 'function', 'live source must support per-source medium integration');
assert.equal(field.describe().status, 'unbuilt');
assert.equal(field.describe().texture, null, 'allocated does not imply current evidence');
field.encode(encoder, 1, 17);
const live = field.describe();
assert.deepEqual(live.dimensions, [32,64,32]);
assert.deepEqual(live.localMin, [-1,-1,-1]);
assert.deepEqual(live.localMax, [1,3,1]);
assert.equal(live.frame, 17);
assert.equal(live.sourceIndex, 1);
assert.equal(live.status, 'encoded');
assert.equal(live.completionAuthority, false, 'encoding is not GPU completion');
assert.equal(live.texture, textures[0]);
assert.deepEqual(dispatches, [[8,16,8]]);
assert.equal(textures[0].spec.dimension, '3d');
assert.equal(textures[0].spec.format, 'rgba32float', 'raw coefficients do not silently saturate to half range');
assert.equal(field.opticalDepthField().texture, null);
field.encodeOpticalDepth(encoder, [0,-.5,0]);
assert.equal(field.opticalDepthField().generation, live.generation);
assert.equal(field.opticalDepthField().solidVisibilityIncluded, false);
assert.deepEqual(field.opticalDepthField().sourcePosition, [0,-.5,0]);
assert.equal(field.opticalDepthField().stepLength, 1/16);
assert.throws(()=>field.encodeOpticalDepth(encoder, [0,0,0], 0), /integration step/);
assert.throws(()=>field.encodeOpticalDepth(encoder, [NaN,0,0]), /source position/);
assert.throws(() => field.encode(encoder, 2, 18), /source index/);
field.invalidate('inactive-material');
assert.equal(field.describe().texture, null, 'inactive material must not expose stale coefficients');
assert.equal(field.opticalDepthField().texture, null, 'inactive source must not expose stale optical depth');
field.encode(encoder, 0, 19);
assert.equal(field.opticalDepthField().texture, null, 'new raw generation invalidates old medium path');
field.destroy();
assert.equal(field.describe().status, 'destroyed');
assert.equal(field.describe().texture, null);
assert.equal(textures[0].destroyed, true);
assert.throws(() => field.encode(encoder, 0, 20), /destroyed/);
assert.match(SCENE_VOLUME_SOURCE_WGSL, /medium\.emission, medium\.absorption \+ medium\.scattering/);
assert.doesNotMatch(SCENE_VOLUME_SOURCE_WGSL, /emissiveCamera|white_[rgb]|physical_display|irradianceSrc/);
console.log('raw scene volume source lifecycle and sampling contracts pass (mock dispatch, not native GPU evidence)');
