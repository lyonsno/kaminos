// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

for(const file of ['scene-hybrid-radiance.mjs','scene-distributed-radiance.mjs','scene-radiance.mjs']){
 test(`${file} permits ordinary withdrawn frames with inactive gas contribution`,()=>{
  const text=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
  const start=text.indexOf('    canRender()');
  const method=text.slice(start,text.indexOf('\n    dispose()',start));
  const medium={status:'encoded',generation:3,frame:4,texture:{}};
  const sourceVisible={value:1};
  const context={prototype:{sceneVolumeSourceField:()=>medium,sceneMediumOpticalDepthField:()=>medium},
   disposed:false,valid:true,rebuilding:false,status:{},handle:{},frame:{generation:3,frame:4},lastFrame:{generation:3},
   tauExternal:{sourceTexture:medium.texture},sourceVisible,mediumVisible:sourceVisible,prepareIndependentLight(){}};
  const api=vm.runInNewContext(`({${method}})`,context);
  assert.equal(api.canRender(),true);
  Object.assign(medium,{status:'inactive',reason:'volume-withdrawn',generation:null,texture:null});
  assert.equal(api.canRender(),true,'withdrawing gas must not freeze the ordinary scene');
  assert.equal(sourceVisible.value,0,'withdrawn gas emission or independent-light gas attenuation must be off');
  Object.assign(medium,{status:'unavailable',reason:'gpu-not-initialized'});
  assert.equal(api.canRender(),false,'unavailable is not an authorized withdrawal');
  Object.assign(medium,{status:'encoded',reason:null,generation:5,texture:context.tauExternal.sourceTexture});
  assert.equal(api.canRender(),false,'re-entry still requires current retained source bindings');
  medium.generation=3;
  assert.equal(api.canRender(),true);assert.equal(sourceVisible.value,1);
  context.disposed=true;
  assert.equal(api.canRender(),false);
 });
}
