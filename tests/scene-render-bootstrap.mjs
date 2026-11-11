// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Core from '../lib/three.core.js';
import {createSceneRenderObjects,createSceneRenderer} from '../scene-render-bootstrap.mjs';

function fixture({fail=false,mismatch=false}={}){
  const calls=[],device={queue:{},destroy(){throw Error('borrowed device must not be destroyed');}},canvas={};
  class Renderer{
    constructor(options){this.options=options;this.shadowMap={};this.backend={device:mismatch?{}:options.device};calls.push(['construct',options]);}
    setSize(...args){calls.push(['size',...args]);}
    setPixelRatio(value){calls.push(['ratio',value]);}
    async init(){calls.push(['init']);if(fail)throw Error('renderer init failed');}
    dispose(){calls.push(['dispose']);}
  }
  class PMREM{constructor(renderer){calls.push(['pmrem',renderer]);}}
  const THREE={...Core,WebGPURenderer:Renderer,PMREMGenerator:PMREM};
  return {THREE,calls,device,canvas,sharedGpu:{device,queue:device.queue},viewport:{width:320,height:200,pixelRatio:1.5}};
}
test('ordinary scene camera keeps its projection and starting pose without DOM access',()=>{
  const f=fixture(),{scene,camera}=createSceneRenderObjects(f);
  assert.equal(scene.isScene,true);assert.equal(camera.fov,40);assert.equal(camera.aspect,1.6);
  assert.equal(camera.near,.01);assert.equal(camera.far,100);assert.deepEqual(camera.position.toArray(),[0,.6,3]);
});
test('offscreen construction retains the exact borrowed device/canvas and suppresses CSS size writes',async()=>{
  const f=fixture();let mounted;
  const result=await createSceneRenderer({...f,exposure:1.7,onConstructed:renderer=>mounted=renderer});
  assert.equal(result.renderer,mounted);assert.equal(result.renderer.options.device,f.device);assert.equal(result.renderer.options.canvas,f.canvas);
  assert.deepEqual(f.calls.slice(1,4),[['size',320,200,false],['ratio',1.5],['init']]);
  assert.equal(result.renderer.toneMapping,f.THREE.AgXToneMapping);assert.equal(result.renderer.toneMappingExposure,1.7);
  assert.equal(result.renderer.shadowMap.enabled,true);assert.equal(result.renderer.shadowMap.type,f.THREE.PCFSoftShadowMap);
  assert.equal(result.renderer.outputColorSpace,f.THREE.SRGBColorSpace);
  result.resize({width:640,height:400,pixelRatio:2});assert.deepEqual(f.calls.at(-1),['size',640,400,false]);
});
test('page mounting and CSS updates are explicit while initialization remains the same',async()=>{
  const f=fixture();await createSceneRenderer({...f,updateStyle:true,onConstructed:()=>f.calls.push(['mounted'])});
  assert.deepEqual(f.calls.slice(1,5),[['size',320,200,true],['ratio',1.5],['mounted'],['init']]);
});
test('missing/mismatched shared device and invalid viewport cannot silently select another worker GPU',async()=>{
  const f=fixture();await assert.rejects(createSceneRenderer({...f,sharedGpu:null}),/shared GPU device/);
  await assert.rejects(createSceneRenderer({...f,sharedGpu:{device:f.device,queue:{}}}),/queue mismatch/);
  await assert.rejects(createSceneRenderer({...f,viewport:{...f.viewport,width:0}}),/positive finite/);
  assert.deepEqual(f.calls,[]);
  const other=fixture({mismatch:true});await assert.rejects(createSceneRenderer(other),/retain the shared GPU/);
  assert.deepEqual(other.calls.at(-1),['dispose']);
});
test('failed renderer initialization releases constructed renderer resources and does not return a runtime',async()=>{
  const f=fixture({fail:true});await assert.rejects(createSceneRenderer(f),/init failed/);
  assert.deepEqual(f.calls.at(-1),['dispose']);assert.equal(f.calls.some(call=>call[0]==='pmrem'),false);
});
