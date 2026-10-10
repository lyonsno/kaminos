import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

async function controller() {
  const behavior = { failDevice: false, failMaterials: false, deviceRequests: 0, gates: new Map() };
  const node = dataset => ({ dataset, style: {}, value: '', disabled: false, hidden: false, checked: false, textContent: '', captures:new Set(),
    classList: { toggle() {},add(){},remove(){} }, removeAttribute() {}, setAttribute() {}, addEventListener() {},
    setPointerCapture(id) {this.captures.add(id);}, releasePointerCapture(id) {this.captures.delete(id);},hasPointerCapture(id){return this.captures.has(id);}, getBoundingClientRect: () => ({ left:0,top:0,width: 400, height: 400 }) });
  const ids=['status','preview','scene','stage-label','run','file','map','light','height','exposure','gi','reset','name','resolution','progress','elapsed','timings','identity',
    'view-prev','view-next','sun','glow','advanced','tuning','preset-export','preset-import','preset-file','preset-error','material-size','compare','light-ring','environment','environment-status','environment-rotation','environment-intensity','direct-intensity',
    'gain','radius','thickness','slices','steps','denoise','aoStrength','expFactor','screenSpaceSampling','linearThickness','backfaceLighting','depthPhi','normalPhi','lumaPhi'];
  const elements = Object.fromEntries(ids.map(id => [id,node({})]));
  elements['material-size'].value='512';elements.environment.value='studio';
  elements.light.value = -35; elements.height.value = 35; elements.exposure.value = 1;
  const views = ['original','photo','relit','materials'].map(view => node({ view }));
  const samples = ['celebration','bag','orb'].map(sample => node({ sample }));
  const document = {
    getElementById: id => elements[id],
    querySelector: selector => views.find(n => selector === `[data-view=${n.dataset.view}]`),
    querySelectorAll: selector => selector === '[data-focus]'?[]:selector === '[data-sample]' ? samples : selector.includes(':not') ? views.slice(1) : views,
  };
  const device = { queue: { async onSubmittedWorkDone() {} }, lost: new Promise(() => {}), destroy() {} };
  const route = () => ({ routeId: 'test', runtime: {}, async drain() {},
    enqueue({ execute }) { return { completion: Promise.resolve().then(() => execute({})).then(output => ({ status:'succeeded',output }), failure => ({ status:'failed',failure })) }; } });
  const session = { registerRoute: async () => route(), unregisterRoute() {}, async close() {} };
  const receipt = { schema: 'kaminos.webgpu-route-receipt.v0', status: 'succeeded', effectiveRouteId: 'moge.depth-normal.webgpu-local.v0' };
  class Viewer {
    async init() { behavior.viewer = this;this.target={set(){}}; this.renderer = { backend: { device }, toneMappingExposure: 1 }; this.gi = { debugState: () => ({}) }; return this; }
    clear() { this.maps = this.surface = null; }
    reset() { this.setLight(); this.renderer.toneMappingExposure = 1; }
    setLight(a = -35, h = 35) { this.light = [a,h]; }
    setLightHandle(x,y) { this.lightHandle={x,y}; }
    setLightScreenPosition(u,v) { this.setLightHandle((u-.5)/.38,(.5-v)/.38); }
    getLightHandle() { return this.lightHandle??{x:-.47,y:.57}; }
    getLightRing(){return {u:.3,v:.2};}
    getLighting(){return {rotation:0,intensity:1,direct:1};}
    showComparison(){this.comparison=true;this.mode=this.maps?'materials':'photo';}
    setTuning(value) { this.settings={...this.settings,...value}; }
    getTuning() { return {gain:1,radius:.15,thickness:.03,slices:6,steps:16,denoise:3,aoStrength:.5,expFactor:2,screenSpaceSampling:false,linearThickness:false,backfaceLighting:0,depthPhi:.1,normalPhi:5,lumaPhi:5,...this.settings}; }
    exportPreset() { return {schema:'kaminos.material-photo-preset.v1',settings:this.getTuning(),light:this.getLightHandle(),camera:{orbit:[.1,.2]},gi:this.useGI??true,glow:this.glow??false}; }
    applyPreset(value) {
      if(value.schema!=='kaminos.material-photo-preset.v1'||!Number.isFinite(value.settings?.gain)||value.settings.gain<0)throw Error('Invalid preset gain');
      this.setTuning(value.settings);this.lightHandle=value.light;this.useGI=value.gi;this.glow=value.glow;
    }
    setImage() { this.clear(); this.reset(); this.surface = { position: new Float32Array(12), indices: new Uint32Array(6) }; }
    setMaterials() { this.maps = {}; }
    async dispose() {}
  }
  class MoGe { async init() { this.useRealWeights = true; this.weightsSource = 'local'; } async dispose() {} async run() { return { width:4,height:4,routeResult:{ receipt } }; } }
  const kit = {
    requestBrowserWebGpuDevice: async () => { behavior.deviceRequests++; if (behavior.failDevice) throw Error('Transient setup failure'); return { device, adapter:{}, backendIdentity:{ kind:'webgpu-local' } }; },
    createWebGpuInferenceSession: async () => session,
    createWebGpuInferenceControl: () => ({ async close() {} }),
  };
  const supermat = { SUPERMAT_ROUTE_ID:'supermat.image-to-pbr.webgpu-local.v0', superMatDeviceOptions:async()=>({}),
    createSuperMatAdapter: async () => ({ identity:{}, async run(input) { behavior.materialSize=input.size;if(behavior.failMaterials)throw Error('Material failure'); return { width:input.size,height:input.size,timings:{},dutyCount:1 }; } }) };
  class Canvas { constructor(width,height) { this.width=width;this.height=height; } getContext() { return { drawImage() {}, getImageData: () => ({ width:this.width,height:this.height,data:new Uint8ClampedArray(this.width*this.height*4) }) }; } }
  class BlobURL extends URL { static createObjectURL() { return 'blob:test'; } static revokeObjectURL() {} }
  const response = () => ({ ok:true, blob:async()=>({}) });
  const context = vm.createContext({ document, navigator:{gpu:{}}, location:{search:''}, window:{}, URL:BlobURL, URLSearchParams,
    OffscreenCanvas:Canvas, Uint8ClampedArray, Uint8Array, performance, crypto, Blob,
    createImageBitmap:async()=>({width:4,height:4,close(){}}),
    fetch:async url => behavior.gates.has(url) ? behavior.gates.get(url).promise : response(),
    setInterval:()=>0, clearInterval(){}, requestAnimationFrame:callback=>queueMicrotask(()=>callback(0)),
  });
  const source = new vm.SourceTextModule(await readFile(new URL('./main.js',import.meta.url),'utf8'), { context });
  await source.link(async specifier => {
    if (specifier === './photo-contracts.js') return new vm.SourceTextModule(await readFile(new URL(specifier,import.meta.url),'utf8'), { context });
    const exports = specifier.includes('/core.js') ? kit : specifier.includes('supermat-route') ? supermat : specifier.includes('moge-producer') ? { MoGeInference:MoGe } : { MaterialPhotoViewer:Viewer };
    return new vm.SyntheticModule(Object.keys(exports), function() { for(const [name,value]of Object.entries(exports))this.setExport(name,value); }, { context });
  });
  await source.evaluate();
  const defer = key => { let resolve; const promise=new Promise(r=>{resolve=r;}); behavior.gates.set(`./images/${key}`,{promise}); return () => resolve(response()); };
  return { behavior, elements, views, actions:context.window.__materialPhotoActions, state:context.window.__materialPhoto, receipt, defer };
}

test('latest requested photograph wins even when fetches complete out of order', async () => {
  const c = await controller(), releaseBag=c.defer('bag.webp'), releaseOrb=c.defer('evil-orb.png');
  const bag=c.actions.sample('bag'), orb=c.actions.sample('orb');
  releaseOrb(); await orb; releaseBag(); await bag;
  assert.equal(c.state.source, 'Metal & glow');
});
test('selected material resolution reaches the producer and survives the run record',async()=>{
  const c=await controller();c.elements['material-size'].value='768';await c.actions.infer();
  assert.equal(c.behavior.materialSize,768);
  assert.equal(c.state.runs.at(-1).supermat.size,768);
  assert.deepEqual(Array.from(c.state.result.materialSize),[768,768]);
});
test('comparison restores surface perspectives after inspecting a map',async()=>{
  const c=await controller();await c.actions.infer();
  c.elements.map.value='normals';c.elements.map.onchange();
  assert.equal(c.behavior.viewer.map,'normals');c.actions.compare();
  assert.equal(c.behavior.viewer.map,'surface');assert.equal(c.elements.map.value,'surface');
});
test('transient device setup failure can be retried', async () => {
  const c=await controller(); c.behavior.failDevice=true; await c.actions.infer();
  assert.equal(c.state.status,'error'); c.behavior.failDevice=false; await c.actions.infer();
  assert.equal(c.behavior.deviceRequests,2); assert.equal(c.state.status,'done');
});
test('reset synchronizes the sun handle and fixes exposure at one', async () => {
  const c=await controller(); await c.actions.infer();
  c.behavior.viewer.renderer.toneMappingExposure=2;c.elements.reset.onclick();
  assert.equal(c.behavior.viewer.renderer.toneMappingExposure,1);
  assert.equal(c.elements.sun.hidden,false);
});
test('failed material rerun cannot advertise old material maps', async () => {
  const c=await controller(); await c.actions.infer(); c.behavior.failMaterials=true; await c.actions.infer();
  assert.equal(c.state.status,'error'); assert.equal(c.views[3].disabled,true);
  assert.equal(c.views[2].disabled,false);c.actions.view('relit');
  assert.equal(c.behavior.viewer.mode,'relit');assert.equal(c.elements.sun.hidden,false);
});
test('observed MoGe routeResult receipt survives consumer reporting', async () => {
  const c=await controller(); await c.actions.infer();
  assert.deepEqual(c.state.runs.at(-1).moge.route,c.receipt);
});
test('carousel traverses all four views without resetting light or orbit',async()=>{
  const c=await controller();await c.actions.infer();
  c.behavior.viewer.setLightHandle(.3,.4);c.behavior.viewer.orbit=[.2,.1];
  c.actions.view('original');
  for(const mode of ['photo','relit','materials','original']){
    assert.equal(typeof c.elements['view-next'].onclick,'function');c.elements['view-next'].onclick();
    assert.equal(c.behavior.viewer.mode,mode);
  }
  c.elements['view-prev'].onclick();assert.equal(c.behavior.viewer.mode,'materials');
  assert.deepEqual(c.behavior.viewer.lightHandle,{x:.3,y:.4});assert.deepEqual(c.behavior.viewer.orbit,[.2,.1]);
});
test('advanced numerical tuning forwards uncapped integral work and estimator fields',async()=>{
  const c=await controller();await c.actions.infer();
  c.elements.steps.value=128;
  assert.equal(typeof c.elements.steps.onchange,'function');c.elements.steps.onchange();
  c.elements.expFactor.value=4;c.elements.expFactor.onchange();
  c.elements.screenSpaceSampling.checked=true;c.elements.screenSpaceSampling.onchange();
  assert.equal(c.behavior.viewer.settings.steps,128);assert.equal(c.behavior.viewer.settings.expFactor,4);
  assert.equal(c.behavior.viewer.settings.screenSpaceSampling,true);
});
test('preset roundtrip restores light and settings and rejects invalid input before mutation',async()=>{
  const c=await controller();await c.actions.infer();
  assert.equal(typeof c.actions.exportPreset,'function');assert.equal(typeof c.actions.importPreset,'function');
  c.behavior.viewer.setTuning({gain:3,steps:96});c.behavior.viewer.setLightHandle(.2,-.3);
  const preset=c.actions.exportPreset();c.behavior.viewer.setTuning({gain:1});await c.actions.importPreset(JSON.stringify(preset));
  assert.equal(c.behavior.viewer.settings.gain,3);assert.deepEqual(JSON.parse(JSON.stringify(c.behavior.viewer.lightHandle)),{x:.2,y:-.3});
  assert.equal(Number(c.elements.steps.value),96);
  const before=JSON.stringify(c.behavior.viewer.exportPreset());
  await c.actions.importPreset(JSON.stringify({...preset,settings:{...preset.settings,gain:-1}}));
  assert.equal(JSON.stringify(c.behavior.viewer.exportPreset()),before);assert.match(c.elements['preset-error'].textContent,/Invalid/);
  await c.actions.importPreset('{');assert.ok(c.elements['preset-error'].textContent);
});
test('sun owns its pointer capture, ignores unrelated pointers and supports keyboard positioning',async()=>{
  const c=await controller();await c.actions.infer();const sun=c.elements.sun;
  let prevented=0,stopped=0;
  const event=(pointerId,x=200,y=200)=>({pointerId,button:0,clientX:x,clientY:y,preventDefault(){prevented++;},stopPropagation(){stopped++;}});
  c.behavior.viewer.orbit=[.1,.2];sun.onpointerdown(event(1));assert.ok(sun.hasPointerCapture(1));
  sun.onpointermove(event(2,250,250));assert.deepEqual(c.behavior.viewer.lightHandle,{x:0,y:0});
  sun.onpointermove(event(1,230,200));assert.ok(c.behavior.viewer.lightHandle.x>0);
  sun.onpointerup(event(1));assert.equal(sun.hasPointerCapture(1),false);
  const before=c.behavior.viewer.lightHandle.x;sun.onkeydown({...event(1),key:'ArrowRight'});
  assert.ok(c.behavior.viewer.lightHandle.x>before);assert.deepEqual(c.behavior.viewer.orbit,[.1,.2]);
  assert.equal(prevented,3);assert.equal(stopped,3);
});
