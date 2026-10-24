import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {test} from 'node:test';
import {Vector2} from '../../lib/three.webgpu.js';
import {createWebGpuForegroundService} from '../../webgpu-inference-kit/src/foreground-opportunity.js';

async function fixture({managed=false,service=null}={}){
  const calls={devices:[],loads:[],gates:{},disposed:[],frames:[],requests:[],renders:[],options:[],errors:[]};
  let initializing=true;
  const foreground={request(request){let resolve;const completion=new Promise(r=>{resolve=r;});const pending={request,resolve,completion,cancel(){resolve({status:'canceled-before-service'});}};calls.requests.push(pending);if(initializing)Promise.resolve().then(()=>request.run({})).then(result=>resolve({status:'completed',result}));return pending;}};
  const tile=()=>({hidden:false,dataset:{}}),canvases=Object.fromEntries(['original','photo','relit','materials'].map(mode=>{
    const article=tile();return [mode,{parentElement:tile(),closest:()=>article}];
  }));
  const container={dataset:{},getBoundingClientRect:()=>({width:1400,height:900}),querySelector:s=>canvases[s.match(/=(\w+)/)[1]]};
  class Viewer{
    async init(canvas,device,options){const{rig,interactive}=options;calls.options.push(options);this.canvas=canvas;this.renderer={backend:{device}};this.orbit=rig.orbit;this.target=rig.target;this.current=rig.current;this.interactive=interactive;calls.devices.push(device);this.settings={gain:1};this.lighting={rotation:0,intensity:1,direct:1};}
    render(time){calls.renders.push({mode:this.mode,time});return true;}
    resize(){}
    setImage(image,depth,shared,cutout){this.cutout=cutout;this.surface=shared?.surface??{normal:[1]};this.mesh={geometry:shared?.geometry??{uuid:'shared'}};}
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
  const context=vm.createContext({console,Error,AggregateError,Map,requestAnimationFrame:fn=>calls.frames.push(fn),cancelAnimationFrame:id=>{calls.frames[id-1]=null;},ResizeObserver:class{observe(){}disconnect(){}}});
  const source=new vm.SourceTextModule(await readFile(new URL('./comparison-viewer.js',import.meta.url),'utf8'),{context});
  await source.link(async specifier=>{
    if(specifier==='./layout.js')return new vm.SourceTextModule(await readFile(new URL(specifier,import.meta.url),'utf8'),{context});
    const exports=specifier==='three/webgpu'?{Vector2}:specifier==='./viewer.js'?{MaterialPhotoViewer:Viewer}:{
      ENVIRONMENTS:{studio:{},warehouse:{},sunset:{}},loadEnvironmentTexture:async name=>{calls.loads.push(name);return calls.gates[name]?await calls.gates[name]:texture(name);},
      lightFromRing:()=>({x:0,y:0}),lightOnRing:()=>({u:0,v:0}),
    };
    return new vm.SyntheticModule(Object.keys(exports),function(){for(const[key,value]of Object.entries(exports))this.setExport(key,value);},{context});
  });
  await source.evaluate();const viewer=new source.namespace.MaterialPhotoViewer(),device={};
  await viewer.init(container,device,managed?{foreground:service??foreground,onError:error=>calls.errors.push(error)}:{});initializing=false;calls.requests.length=0;return {viewer,calls,device,container,canvases,texture};
}
test('environment application follows the actual Kit foreground service receipt and run boundary',async()=>{
  const service=createWebGpuForegroundService({device:{queue:{submit(){}}},routeId:'photo-test'});
  const {viewer}=await fixture({managed:true,service});
  const run=await service.beginRun('material-test');
  const changed=viewer.loadEnvironment('warehouse');await new Promise(setImmediate);
  assert.equal(viewer.environment,'studio');
  await run.withForeground('weight-loading',async()=>{});
  assert.equal(await changed,true);
  assert.equal(viewer.environment,'warehouse');
  await run.finish();await viewer.dispose();await service.dispose();
});
test('managed environment GPU preparation waits for admission and ignores superseded requests',async()=>{
  const {viewer,calls}=await fixture({managed:true});
  const old=viewer.loadEnvironment('warehouse');await new Promise(setImmediate);
  assert.ok(Object.values(viewer.views).every(view=>view.environmentTexture.name==='studio'),'GPU preparation must wait');
  assert.equal(calls.requests.length,1);
  const latest=viewer.loadEnvironment('sunset');await new Promise(setImmediate);
  assert.equal(calls.requests.length,2);
  for(const request of calls.requests){const result=await request.request.run({runId:'held-model-run'});request.resolve({status:'completed',result});}
  assert.equal(await old,false);assert.equal(await latest,true);
  assert.ok(Object.values(viewer.views).every(view=>view.environmentTexture.name==='sunset'));
  const pending=viewer.loadEnvironment('studio');await new Promise(setImmediate);
  const rejected=assert.rejects(pending,/disposed|canceled/i);await viewer.dispose();await rejected;
});
test('four managed views render together only inside an admitted foreground callback',async()=>{
  const {viewer,calls}=await fixture({managed:true});
  assert.ok(calls.options.every(options=>options.autoRender===false));
  assert.equal(calls.frames.length,1);calls.frames[0](123);
  assert.equal(calls.renders.length,0);assert.equal(calls.requests.length,1);
  await calls.requests[0].request.run({runId:'model-run'});
  assert.equal(calls.renders.length,4);assert.ok(calls.renders.every(row=>row.time===123));
  assert.equal(viewer.frameStats.duringModel,1);
  assert.equal(calls.frames.length,1,'no second request while the first is pending');
  calls.requests[0].resolve({status:'completed'});await calls.requests[0].completion;await Promise.resolve();
  assert.equal(calls.frames.length,2);
  await viewer.dispose();assert.equal(calls.frames[1],null);
});
test('disposal cancels a queued frame and a failed frame is visible without restarting its loop',async()=>{
  const a=await fixture({managed:true});assert.equal(a.calls.frames.length,1);a.calls.frames[0](1);await a.viewer.dispose();
  assert.equal(a.calls.renders.length,0);assert.equal(a.calls.frames.length,1);
  const b=await fixture({managed:true});b.calls.frames[0](2);
  b.calls.requests[0].resolve({status:'failed-before-submission',failure:{error:{message:'Draw failed'}}});
  await b.calls.requests[0].completion;await Promise.resolve();
  assert.match(b.calls.errors[0]?.message??'',/Draw failed/);assert.equal(b.calls.frames.length,1);
  await b.viewer.dispose();
});
test('comparison borrows one device, shares geometry and orbit, and can focus without rerunning inference',async()=>{
  const {viewer,calls,device,canvases}=await fixture();
  assert.equal(viewer.comparison,true);assert.ok(calls.devices.every(value=>value===device));
  viewer.setImage({},{});const views=Object.values(viewer.views);
  assert.equal(viewer.primary.available,true);viewer.setMaterials({});assert.equal(viewer.primary.available,true);
  assert.ok(views.every(v=>v.mesh.geometry===viewer.primary.mesh.geometry));
  assert.ok(views.every(v=>v.orbit===viewer.orbit));assert.equal(views.filter(v=>v.interactive).length,1);
  viewer.orbit.set(.2,.1);viewer.setLightHandle(.3,.4);viewer.setTuning({gain:2});
  assert.ok(views.every(v=>v.light.x===.3&&v.settings.gain===2));
  viewer.mode='relit';assert.ok(Object.entries(canvases).every(([mode,c])=>c.closest('[data-tile]').hidden===(mode!=='relit')));
  viewer.showComparison();assert.ok(Object.values(canvases).every(c=>!c.closest('[data-tile]').hidden));assert.deepEqual(viewer.orbit.toArray(),[.2,.1]);
});
test('a depth-only material pane keeps its photograph visible without claiming inference is running',async()=>{
  const {viewer}=await fixture();viewer.setImage({},{});
  const surface=viewer.primary.canvas.parentElement;
  assert.equal(viewer.primary.available,true);
  assert.equal(surface.dataset.pending,'Materials not generated');
  viewer.setMaterialStatus('Inferring materials');
  assert.equal(surface.dataset.pending,'Inferring materials');
  viewer.setMaterials({});assert.equal(surface.dataset.pending,undefined);
  viewer.setImage({},{});assert.equal(surface.dataset.pending,'Materials not generated');
});
test('only the two lit views are cut out; photograph and depth retain the complete background',async()=>{
  const {viewer}=await fixture(),cutout={sample:'bag'};
  viewer.setImage({}, {}, cutout);
  assert.equal(viewer.views.original.cutout,null);assert.equal(viewer.views.photo.cutout,null);
  assert.equal(viewer.views.relit.cutout,cutout);assert.equal(viewer.views.materials.cutout,cutout);
  assert.equal(viewer.views.relit.mesh.geometry,viewer.views.materials.mesh.geometry);
  assert.equal(viewer.views.relit.surface,viewer.views.materials.surface);
  assert.notEqual(viewer.views.photo.mesh.geometry,viewer.views.materials.mesh.geometry);
  assert.notEqual(viewer.views.photo.surface,viewer.views.materials.surface);
  assert.equal(viewer.views.original.mesh.geometry,viewer.views.photo.mesh.geometry);
  assert.ok(Object.values(viewer.views).every(view=>view.orbit===viewer.orbit));
  viewer.setImage({}, {});
  assert.ok(Object.values(viewer.views).every(view=>view.cutout===null));
  assert.ok(Object.values(viewer.views).every(view=>view.mesh.geometry===viewer.primary.mesh.geometry));
});
test('comparison chooses pane arrangement from available width and height',async()=>{
  const {viewer,container}=await fixture();
  assert.equal(container.dataset.layout,'grid');
  container.getBoundingClientRect=()=>({width:1800,height:600});viewer.layout();
  assert.equal(container.dataset.layout,'strip');
  viewer.mode='original';assert.equal(container.dataset.focus,'original');
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
