// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {webcrypto}from 'node:crypto';
test('the actual page caller forwards scheduling and selected atlas size',async()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),a=html.indexOf('  const trellisPageRunInner=async('),b=html.indexOf('  // Page TRELLIS is reserved',a);
 assert.ok(a>0&&b>a);let received;
 const context={crypto:webcrypto,Uint8Array,Float32Array,ArrayBuffer,Error,Worker:class{},fetch:async()=>({ok:true,json:async()=>({trellisPage:{mounted:true}})}),appGpuHost:async()=>({}),
  loadModule:async path=>path.includes('authoring-trellis-page')?{
   createTrellisPageCheckpoints:async()=>({manifest:{pipelineType:'512',image:{}},manifestSha256:'observed-manifest',fetchTensor:async()=>{throw Error('no package pixels');}}),
   runTrellisInPage:async options=>{received=options;return {glb:new ArrayBuffer(12),route:'trellis2.image-generation.webgpu.v0',timing:{scheduling:{kind:'per-duty-fence-task',gpuDrains:95}}};}
  }:path.includes('mesh-cleanup')?{createBrowserMeshPostprocess:()=>async m=>m}:{createWasmXatlasUnwrapper:()=>async m=>m}};
 vm.runInNewContext(html.slice(a,b).replaceAll('import(','loadModule(')+'\nthis.run=trellisPageRunInner;',context);
 const result=await context.run({pixels:new Float32Array(512*512*3),scheduling:'per-duty-fence-task',textureSize:4096});
 assert.equal(received.scheduling,'per-duty-fence-task');assert.equal(received.textureSize,4096);assert.equal(result.generation.scheduling.kind,'per-duty-fence-task');assert.equal(result.generation.scheduling.gpuDrains,95);
});
