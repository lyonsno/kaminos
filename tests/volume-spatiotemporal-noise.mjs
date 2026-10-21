// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as noise from '../volume-ray-start.mjs';

assert.equal(noise.BLUE_NOISE_FRAMES,32,'temporal slices must exist, not a translated 2D tile');
assert.equal(noise.BLUE_NOISE_SIZE,128);
const png=readFileSync(noise.BLUE_NOISE_URL);
assert.equal(png.readUInt32BE(16),1024);
assert.equal(png.readUInt32BE(20),512);
const core=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
assert.match(core,/opticalStepPositionJittered\(&opticalStep,/,'camera march must jitter interior quadrature, not only entry');
assert.match(noise.RAY_START_WGSL,/rayNoiseSample/);
assert.doesNotMatch(noise.RAY_START_WGSL,/index \* 17u|0\.61803398875/,'temporal slices replace frame-shifted spatial noise');
let destroyed=0,closed=0;
globalThis.GPUTextureUsage={TEXTURE_BINDING:4,COPY_DST:2,RENDER_ATTACHMENT:16};
const device={createTexture:()=>({destroy(){destroyed++;}}),queue:{copyExternalImageToTexture(){throw Error('upload refused');}}};
await assert.rejects(noise.createRayStartTexture(device,{fetchImpl:async()=>({ok:true,blob:async()=>png}),
  decode:async()=>({width:1024,height:512,close(){closed++;}})}),/upload refused/);
assert.equal(closed,1);assert.equal(destroyed,1,'failed upload must release GPU allocation');
console.log('Temporal atlas, production interior wiring, and resource-failure contracts pass');
