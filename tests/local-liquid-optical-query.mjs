import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('host optical query carries the effective camera depth interval rather than assuming the private toy far plane',async()=>{
 const m=await import('../local-liquid-optical-query.mjs').catch(()=>({}));
 assert.equal(typeof m.localLiquidOpticalQueryControls,'function','host ray queries require an explicit camera depth contract');
 assert.deepEqual(m.localLiquidOpticalQueryControls({near:.1,far:100},true),[1,100,.1,0]);
 assert.deepEqual(m.localLiquidOpticalQueryControls(null,false),[0,0,0,0]);
 assert.throws(()=>m.localLiquidOpticalQueryControls({near:.1,far:.01},true),/depth/);
 assert.throws(()=>m.localLiquidOpticalQueryControls({near:.1,far:NaN},true),/depth/);
});
test('host rays cannot be unconditionally discarded and reflection footprint samples must reach the host query',()=>{
 const s=readFileSync(new URL('../finger-fluid-webgpu-core.js',import.meta.url),'utf8');
 const trace=s.slice(s.indexOf('fn traceDeferredScene('),s.indexOf('fn intersectTriangle('));
 assert.doesNotMatch(trace,/if \(params\.hostFrameControls\.x > 0\.5\)\s*\{\s*return hit;/,'host rays currently always miss scene geometry');
 const sample=s.slice(s.indexOf('fn sampleWorldReflection('),s.indexOf('fn integrateWorldReflectionQuadrature('));
 assert.match(sample,/sampleHybridOpticalQuery/,'surrounding reflection samples must query visible scene geometry too');
});
test('host optical inputs identify real bound depth/radiance and never claim private normal/material attachments',async()=>{
 const m=await import('../local-liquid-optical-query.mjs');
 assert.equal(typeof m.localLiquidHostOpticalInputs,'function','effective host inputs must identify the executed attachments');
 const frame={sceneDepthAttachmentId:'actual-depth',sceneColorAttachmentId:'actual-color'};
 const inputs=m.localLiquidHostOpticalInputs(frame,'640x480');
 assert.equal(inputs.linearDepthObject.attachmentId,'actual-depth');assert.equal(inputs.linearDepthObject.format,'r32float');assert.equal(inputs.linearDepthObject.encoding,'linear_view_depth_meters');
 assert.equal(inputs.sceneRadiance.attachmentId,'actual-color');assert.equal(inputs.worldNormalRoughness,null);assert.equal(inputs.albedoMetallic,null);assert.equal(inputs.objectIdentity,null);
 assert.equal(m.localLiquidHostOpticalInputs(null,'640x480'),null);
});
