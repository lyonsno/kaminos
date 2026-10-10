import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {test} from 'node:test';
import {Vector2} from '../../lib/three.webgpu.js';

async function fixture(){
  const calls={devices:[],loads:[],gates:{},disposed:[]};
  const tile=()=>({hidden:false,dataset:{}}),canvases=Object.fromEntries(['original','photo','relit','materials'].map(mode=>{
    const article=tile();return [mode,{parentElement:tile(),closest:()=>article}];
  }));
  const container={dataset:{},querySelector:s=>canvases[s.match(/=(\w+)/)[1]]};
  class Viewer{
    async init(canvas,device,{rig,interactive}){this.canvas=canvas;this.renderer={backend:{device}};this.orbit=rig.orbit;this.target=rig.target;this.current=rig.current;this.interactive=interactive;calls.devices.push(device);this.settings={gain:1};this.lighting={rotation:0,intensity:1,direct:1};}
    resize(){}
    setImage(image,depth,shared){this.surface=shared?.surface??{normal:[1]};this.mesh={geometry:shared?.geometry??{uuid:'shared'}};}
    setMaterials(out){this.maps=out;}
    clear(){this.surface=this.maps=null;}
    setEnvironment(texture){this.environmentTexture=texture;}
    getTuning(){return {...this.settings};}setTuning(value){Object.assign(this.settings,value);}
    getLighting(){return this.lighting;}setLighting(value){Object.assign(this.lighting,value);}
    getLightHandle(){return this.light??{x:.2,y:.3};}setLightHandle(x,y){this.light={x,y};}setLight(){this.light={x:0,y:0};}
    reset(){this.orbit.set(0,0);}
    validatePreset(value){if(value.settings.gain<0)throw Error('Invalid gain');}
    applyPreset(value){this.validatePreset(value);this.setTuning(value.settings);}
    exportPreset(){return {settings:this.getTuning()};}
    presentation(){return {mode:this.mode,light:this.light,orbit:this.orbit.toArray()};}
    async dispose(){}
  }
  const texture=name=>({name,dispose(){calls.disposed.push(name);}});
  const context=vm.createContext({console,Error,AggregateError,Map});
  const source=new vm.SourceTextModule(await readFile(new URL('./comparison-viewer.js',import.meta.url),'utf8'),{context});
  await source.link(async specifier=>{
    const exports=specifier==='three/webgpu'?{Vector2}:specifier==='./viewer.js'?{MaterialPhotoViewer:Viewer}:{
      ENVIRONMENTS:{studio:{},warehouse:{},sunset:{}},loadEnvironmentTexture:async name=>{calls.loads.push(name);return calls.gates[name]?await calls.gates[name]:texture(name);},
      lightFromRing:()=>({x:0,y:0}),lightOnRing:()=>({u:0,v:0}),
    };
    return new vm.SyntheticModule(Object.keys(exports),function(){for(const[key,value]of Object.entries(exports))this.setExport(key,value);},{context});
  });
  await source.evaluate();const viewer=new source.namespace.MaterialPhotoViewer(),device={};
  await viewer.init(container,device);return {viewer,calls,device,container,canvases,texture};
}
test('comparison borrows one device, shares geometry and orbit, and can focus without rerunning inference',async()=>{
  const {viewer,calls,device,canvases}=await fixture();
  assert.equal(viewer.comparison,true);assert.ok(calls.devices.every(value=>value===device));
  viewer.setImage({},{});const views=Object.values(viewer.views);
  assert.equal(viewer.primary.available,false);viewer.setMaterials({});assert.equal(viewer.primary.available,true);
  assert.ok(views.every(v=>v.mesh.geometry===viewer.primary.mesh.geometry));
  assert.ok(views.every(v=>v.orbit===viewer.orbit));assert.equal(views.filter(v=>v.interactive).length,1);
  viewer.orbit.set(.2,.1);viewer.setLightHandle(.3,.4);viewer.setTuning({gain:2});
  assert.ok(views.every(v=>v.light.x===.3&&v.settings.gain===2));
  viewer.mode='relit';assert.ok(Object.entries(canvases).every(([mode,c])=>c.closest('[data-tile]').hidden===(mode!=='relit')));
  viewer.showComparison();assert.ok(Object.values(canvases).every(c=>!c.closest('[data-tile]').hidden));assert.deepEqual(viewer.orbit.toArray(),[.2,.1]);
});
test('environment selection is latest-wins; failures preserve the effective environment and can retry',async()=>{
  const {viewer,calls,texture}=await fixture();let release;
  calls.gates.warehouse=new Promise(resolve=>{release=resolve;});
  const old=viewer.loadEnvironment('warehouse');await viewer.loadEnvironment('sunset');release(texture('warehouse'));
  assert.equal(await old,false);assert.equal(viewer.environment,'sunset');
  assert.ok(Object.values(viewer.views).every(v=>v.environmentTexture.name==='sunset'));
  calls.gates.studio=Promise.reject(Error('HDR failed'));viewer.cache.delete('studio');
  await assert.rejects(viewer.loadEnvironment('studio'),/HDR failed/);assert.equal(viewer.environment,'sunset');
  delete calls.gates.studio;await viewer.loadEnvironment('studio');assert.equal(viewer.environment,'studio');
  const before=calls.loads.length;await assert.rejects(viewer.applyPreset({settings:{gain:-1},environment:'warehouse'}),/Invalid/);
  assert.equal(calls.loads.length,before);await viewer.dispose();assert.ok(calls.disposed.includes('studio'));
});
