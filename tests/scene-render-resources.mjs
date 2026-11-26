// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Three from '../lib/three.webgpu.js';
import {createSceneRenderResources} from '../scene-render-resources.mjs';
const context={assertCurrent(){}};

function fixture(){
 const events=[],devices=[{queue:{}},{queue:{}},{queue:{}}],scene=new Three.Scene(),camera=new Three.PerspectiveCamera(),canvas={};
 let sharedGpu={device:devices[0],queue:devices[0].queue},failInit=false,failAO=false,failDispose=false,exposure=1;
 class Renderer{
  constructor(options){this.options=options;this.backend={device:options.device};this.domElement=options.canvas;this.shadowMap={};events.push(['renderer',this]);}
  setSize(x,y,style){this.size={x,y};events.push(['size',style]);}
  setPixelRatio(value){this.ratio=value;}
  getPixelRatio(){return this.ratio;}
  getSize(value){return value.set(this.size.x,this.size.y);}
  getDrawingBufferSize(value){return value.set(this.size.x*this.ratio,this.size.y*this.ratio);}
  async init(){if(failInit)throw Error('renderer init denied');}
  dispose(){events.push(['renderer-dispose',this]);if(failDispose)throw Error('renderer cleanup denied');}
 }
 class PMREM{constructor(renderer){this.renderer=renderer;}dispose(){events.push(['pmrem-dispose',this]);}}
 const THREE={...Three,WebGPURenderer:Renderer,PMREMGenerator:PMREM};
 const ao=()=>({radius:{},scale:{},thickness:{},distanceFallOff:{},getTextureNode:()=>Three.TSL.texture(new Three.Texture()),dispose(){events.push(['ao-dispose']);}});
 const gi={reflections:{settings:{enabled:false},setRenderer(value){gi.renderer=value;},lightingContext:null},dispose(){events.push(['gi-dispose']);}};
 const shell=createSceneRenderResources({THREE,scene,camera,canvas,readViewport:()=>({width:80,height:40,pixelRatio:1}),
  readSharedGpu:()=>sharedGpu,readRendererOptions:()=>({exposure}),
  readLightingOptions:()=>({aoSettings:{radius:3,scale:1,thickness:.2,falloff:1},aoIntensityValue:1,
   aoCompute:()=>{if(failAO)throw Error('AO allocation denied');return ao();},
   denoise:()=>Three.TSL.texture(new Three.Texture()),configureMaterialSideAODepth(){},createSceneGI:()=>gi}),
 });
 return {shell,scene,camera,canvas,devices,events,gi,setDevice(index){sharedGpu={device:devices[index],queue:devices[index].queue};},
  failInit(value){failInit=value;},failAO(value){failAO=value;},failDispose(value){failDispose=value;},setExposure(value){exposure=value;}};
}
test('initial renderer and actual Three lighting graph share one retained owner without DOM',async()=>{
 const f=fixture();assert.equal(typeof window,'undefined');assert.equal(f.shell.renderer,null);
 f.setExposure(1.8);const built=await f.shell.initialize(context);
 assert.equal(built.renderer.backend.device,f.devices[0]);assert.equal(built.renderer.domElement,f.canvas);
 assert.equal(built.renderer.toneMappingExposure,1.8);assert.equal(built.lighting.sceneGI,f.gi);
 assert.equal(built.lighting.renderPipeline.renderer,built.renderer);assert.equal(built.scene,f.scene);assert.equal(built.camera,f.camera);
 assert.equal(f.events.find(e=>e[0]==='size')[1],false);
 await f.shell.retire();assert.equal(f.shell.renderer,null);assert.equal(f.shell.lighting,null);
 assert.equal(f.events.filter(e=>e[0]==='renderer-dispose').length,1);
 await f.shell.retire();assert.equal(f.events.filter(e=>e[0]==='renderer-dispose').length,1);
});
test('replacement preserves authored graph identity and renderer settings while rebinding depth sizing',async()=>{
 const f=fixture();await f.shell.initialize(context);const first=f.shell.renderer,lighting=f.shell.lighting;
 first.toneMapping=77;first.toneMappingExposure=2.4;first.shadowMap.enabled=false;first.shadowMap.type=88;first.outputColorSpace='authored-output';
 f.setDevice(1);const built=await f.shell.replaceRenderer({device:f.devices[1],queue:f.devices[1].queue},context);
 assert.notEqual(built.renderer,first);assert.equal(built.lighting,lighting);assert.equal(built.scene,f.scene);
 assert.equal(built.renderer.backend.device,f.devices[1]);assert.equal(built.renderer.toneMapping,77);assert.equal(built.renderer.toneMappingExposure,2.4);
 assert.equal(built.renderer.shadowMap.enabled,false);assert.equal(built.renderer.shadowMap.type,88);assert.equal(built.renderer.outputColorSpace,'authored-output');
 assert.equal(lighting.renderPipeline.renderer,built.renderer);assert.equal(f.gi.renderer,built.renderer);
 built.renderer.setSize(160,100,false);lighting.resizeDepth();assert.deepEqual([lighting.depthRT.width,lighting.depthRT.height],[80,50]);
 await f.shell.retire();assert.equal(f.events.filter(e=>e[0]==='renderer-dispose').length,2);
});
test('partial initialization retains cleanup handles and retries retirement without destroying borrowed devices',async()=>{
 const f=fixture();f.failAO(true);await assert.rejects(f.shell.initialize(context),/AO allocation denied/);
 assert(f.shell.renderer);assert.equal(f.shell.lighting,null);
 f.failDispose(true);await assert.rejects(f.shell.retire(),/renderer cleanup denied/);assert(f.shell.renderer);
 assert.equal(f.events.filter(e=>e[0]==='pmrem-dispose').length,1);
 f.failDispose(false);await f.shell.retire();assert.equal(f.shell.renderer,null);
 assert.equal(f.events.filter(e=>e[0]==='pmrem-dispose').length,1,'successfully released PMREM cannot be released again');
});
test('failed replacement can be retired/retried under a new supplied device and current context',async()=>{
 const f=fixture();await f.shell.initialize(context);const lighting=f.shell.lighting;
 f.failInit(true);await assert.rejects(f.shell.replaceRenderer({device:f.devices[1]},context),/renderer init denied/);
 assert.equal(f.shell.renderer,null);assert.equal(f.shell.lighting,lighting);
 f.failInit(false);const next=await f.shell.replaceRenderer({device:f.devices[2]},context);
 assert.equal(next.renderer.backend.device,f.devices[2]);assert.equal(next.lighting,lighting);await f.shell.retire();
});
test('staleness after construction retains actual allocated resources for owner retirement',async()=>{
 const f=fixture();let checks=0;
 await assert.rejects(f.shell.initializeRenderer({assertCurrent(){if(++checks===3)throw Error('device epoch changed');}}),/device epoch changed/);
 assert(f.shell.renderer);assert(f.shell.pmremGenerator);await f.shell.retire();assert.equal(f.shell.renderer,null);
});

test('stale renderer stays retained for cleanup without becoming usable or replacing accepted settings',async()=>{
 const f=fixture();await f.shell.initialize(context);f.shell.renderer.toneMapping=77;
 let checks=0;
 await assert.rejects(f.shell.replaceRenderer({device:f.devices[1]}, {assertCurrent(){if(++checks===4)throw Error('replacement epoch changed');}}),/replacement epoch changed/);
 assert(f.shell.renderer);assert(f.shell.pmremGenerator);
 assert.throws(()=>f.shell.resize(),/not initialized/);
 f.shell.renderer.toneMapping=999;
 const next=await f.shell.replaceRenderer({device:f.devices[2]},context);
 assert.equal(next.renderer.toneMapping,77,'a rejected renderer cannot overwrite the accepted pre-loss settings');
 await f.shell.retire();
});
test('failed renderer retirement revokes use immediately and retains accepted replacement settings',async()=>{
 const f=fixture();await f.shell.initialize(context);f.shell.renderer.toneMapping=77;
 f.failDispose(true);await assert.rejects(f.shell.replaceRenderer({device:f.devices[1]},context),/renderer cleanup denied/);
 assert.throws(()=>f.shell.resize(),/not initialized/);
 f.shell.renderer.toneMapping=999;f.failDispose(false);
 const next=await f.shell.replaceRenderer({device:f.devices[2]},context);
 assert.equal(next.renderer.toneMapping,77,'half-retired renderer settings cannot replace the retained accepted snapshot');
 await f.shell.retire();
});


test('lighting-only release is retryable and leaves renderer and shared device alive',async()=>{
 const f=fixture();await f.shell.initialize(context);const renderer=f.shell.renderer,pmrem=f.shell.pmremGenerator;
 assert.equal(typeof f.shell.retireLighting,'function');
 let denied=true;const dispose=f.gi.dispose;f.gi.dispose=()=>{if(denied)throw Error('GI cleanup denied');dispose();};
 await assert.rejects(f.shell.retireLighting(context),/GI cleanup denied/);assert(f.shell.lighting);
 assert.throws(()=>f.shell.initializeLighting(context),/already retained/);
 denied=false;await f.shell.retireLighting(context);assert.equal(f.shell.lighting,null);
 assert.equal(f.shell.renderer,renderer);assert.equal(f.shell.pmremGenerator,pmrem);
 assert.equal(f.events.filter(e=>e[0]==='renderer-dispose').length,0);
 f.shell.initializeLighting(context);assert.equal(f.shell.lighting.renderPipeline.renderer,renderer);
 await f.shell.retire();
});
