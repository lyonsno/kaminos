import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { reconcileVolumeCockpitLayoutDocument, VOLUME_COCKPIT_LAYOUT_IDENTITY } from '../volume-cockpit-layout.mjs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const statusStatement = html.match(/document\.getElementById\('volume-ray-start-noise-val'\)\.textContent[^;]*;/)?.[0];
assert.ok(statusStatement, 'ray-start status must be synchronized from the live controls');
for (const rayStartNoise of [true, false, false, true]) {
  const label = {textContent:'on'};
  runInNewContext(statusStatement, {c:{rayStartNoise},document:{getElementById:()=>label}});
  assert.equal(label.textContent, rayStartNoise ? 'on' : 'off');
}
assert.match(core, /let jitter = dtBase \* rayStartPhase\(in\.pos\.xy, u\.reserved_render_controls\.w, fullGridCapture\)/,
  'the actual camera marcher must offset starts by per-pixel noise while preserving full-grid capture');
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url)));
assert.deepEqual(schema.rendererControls.find(c => c.key === 'volume-ray-start-noise'),
  {key:'volume-ray-start-noise',param:'volume_ray_start_noise',tagName:'INPUT',type:'checkbox',additiveDefault:true});
const layout = {identity:VOLUME_COCKPIT_LAYOUT_IDENTITY,layoutId:'ray',label:'Ray',groups:[
  {id:'budget',label:'Raymarch budget',surface:'primary',collapsed:false,controlIds:['volume-steps']},
]};
assert.deepEqual(reconcileVolumeCockpitLayoutDocument({document:layout,
  authorableControlIds:['volume-steps','volume-ray-start-noise']}).document.groups[0].controlIds,
  ['volume-steps','volume-ray-start-noise']);
const { RAY_START_WGSL, createRayStartTexture } = await import('../volume-ray-start.mjs');
assert.match(RAY_START_WGSL, /if \(enabled < 0\.5 \|\| fullGridCapture\) \{ return 0\.5; \}/);
assert.match(RAY_START_WGSL, /textureLoad/);
assert.doesNotMatch(RAY_START_WGSL, /time|frameCount|sin\(/);
const image = readFileSync(new URL('../assets/blue-noise/64-LDR-L0.png', import.meta.url));
assert.equal(image.readUInt32BE(16),64);assert.equal(image.readUInt32BE(20),64);
let gpuCalls=0,closed=0;
const device={createTexture(){gpuCalls++;return {createView(){},destroy(){}}},queue:{copyExternalImageToTexture(){gpuCalls++;}}};
globalThis.GPUTextureUsage={TEXTURE_BINDING:4,COPY_DST:2,RENDER_ATTACHMENT:16};
await assert.rejects(createRayStartTexture(device,{fetchImpl:async()=>({ok:false,status:404})}),/blue-noise.*404/);
assert.equal(gpuCalls,0,'missing texture cannot silently substitute noise or allocate a fake success');
await assert.rejects(createRayStartTexture(device,{fetchImpl:async()=>({ok:true,blob:async()=>image}),
  decode:async()=>({width:32,height:64,close(){closed++;}})}),/blue-noise.*dimensions/);
assert.equal(gpuCalls,0);assert.equal(closed,1);
await createRayStartTexture(device,{fetchImpl:async()=>({ok:true,blob:async()=>image}),
  decode:async(_blob,options)=>{assert.equal(options.colorSpaceConversion,'none');return {width:64,height:64,close(){closed++;}};}});
assert.equal(gpuCalls,2);assert.equal(closed,2);
console.log('Production ray-start wiring, persistence, placement, asset and failure behavior pass');
