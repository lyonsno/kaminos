import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

async function controller({examples=false,exampleFailure=false,generationAvailable=true,search='?sample=celebration'}={}) {
  const behavior = { failDevice: false, failMaterials: false, deviceRequests: 0, geometryRuns:0, materialRuns:0, cache:new Map(), gates: new Map() };
  const node = dataset => ({ dataset, style: {}, value: '', disabled: false, hidden: false, checked: false, textContent: '', captures:new Set(),
    classList: { toggle() {},add(){},remove(){} }, removeAttribute() {}, setAttribute() {}, addEventListener() {},
    setPointerCapture(id) {this.captures.add(id);}, releasePointerCapture(id) {this.captures.delete(id);},hasPointerCapture(id){return this.captures.has(id);}, getBoundingClientRect: () => ({ left:0,top:0,width: 400, height: 400 }) });
  const ids=['execution-kind','generation-controls','local-generation','provenance','job-status','view-result','workspace','controls','tuning-toggle','status','preview','scene','stage-label','run','file','map','light','height','exposure','gi','reset','name','resolution','progress','elapsed','timings','identity',
    'view-prev','view-next','sun','glow','advanced','tuning','preset-export','preset-import','preset-file','preset-error','material-size','compare','light-ring','environment','environment-status','environment-rotation','environment-intensity','direct-intensity',
    'gi-view','contrast-mode','roughness-strength','metallic-strength','roughness-strength-value','metallic-strength-value','contrast-readout','bloom',
    ...['glowIntensity','glowThreshold','emissionReflection','bloomIntensity','bloomRadius','bloomThreshold','exposure'].flatMap(key=>[key,`${key}-value`]),
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
  const device = { features:new Set(['shader-f16']),addEventListener(){},queue: { async onSubmittedWorkDone() {} }, lost: new Promise(() => {}), destroy() {} };
  const route = () => ({ routeId: 'test', runtime: {}, async drain() {},
    enqueue({ execute }) { return { completion: Promise.resolve().then(() => execute({})).then(output => ({ status:'succeeded',output }), failure => ({ status:'failed',failure })) }; } });
  const session = { registerRoute: async () => route(), unregisterRoute() {}, async close() {} };
  const receipt = { schema: 'kaminos.webgpu-route-receipt.v0', status: 'succeeded', effectiveRouteId: 'moge.depth-normal.webgpu-local.v0' };
  class Viewer {
    get primary(){return this;}
    get mode(){return this.focus??(this.maps?'materials':this.surface?'photo':'original');}
    set mode(value){this.focus=value;this.comparison=false;}
    getDiagnostic(){return this.diagnostic??'scene';}
    setDiagnostic(value){this.diagnostic=value;}
    getMaterialContrast(){return {mode:'original',roughness:.5,metallic:.5,...this.contrast};}
    setMaterialContrast(value){this.contrast={...this.getMaterialContrast(),...value};}
    presentation(){return {contrast:{settings:this.getMaterialContrast(),analysis:null,gains:null}};}
    async init() { behavior.viewer = this;this.target={set(){}}; this.renderer = { backend: { device }, toneMappingExposure: 1 }; this.gi = { debugState: () => ({}) }; return this; }
    clear() { this.maps = this.surface = null; }
    reset() { this.setLight(); this.renderer.toneMappingExposure = 1; }
    setLight(a = -35, h = 35) { this.light = [a,h]; }
    setLightHandle(x,y) { this.lightHandle={x,y}; }
    setLightScreenPosition(u,v) { this.setLightHandle((u-.5)/.38,(.5-v)/.38); }
    getLightHandle() { return this.lightHandle??{x:-.47,y:.57}; }
    getLightRing(){return {u:.3,v:.2};}
    getLighting(){return {rotation:0,intensity:1,direct:1};}
    getEffects(){return {glowIntensity:1,glowThreshold:.05,emissionReflection:0,bloom:true,bloomIntensity:.5,bloomRadius:.4,bloomThreshold:.2,exposure:1,...this.effects};}
    setEffects(value){this.effects={...this.getEffects(),...value};}
    showComparison(){this.comparison=true;this.focus=null;}
    setTuning(value) { this.settings={...this.settings,...value}; }
    getTuning() { return {gain:1,radius:.15,thickness:.03,slices:6,steps:16,denoise:3,aoStrength:.5,expFactor:2,screenSpaceSampling:false,linearThickness:false,backfaceLighting:0,depthPhi:.1,normalPhi:5,lumaPhi:5,...this.settings}; }
    exportPreset() { return {schema:'kaminos.material-photo-preset.v1',settings:this.getTuning(),light:this.getLightHandle(),camera:{orbit:[.1,.2]},gi:this.useGI??true,glow:this.glow??false}; }
    applyPreset(value) {
      if(value.schema!=='kaminos.material-photo-preset.v1'||!Number.isFinite(value.settings?.gain)||value.settings.gain<0)throw Error('Invalid preset gain');
      this.setTuning(value.settings);this.lightHandle=value.light;this.useGI=value.gi;this.glow=value.glow;
    }
    setImage(input,depth,cutout) { this.clear(); this.reset();this.cutout=cutout; this.surface = { position: new Float32Array(12), indices: new Uint32Array(6) }; }
    setMaterials() { this.maps = {}; }
    setMaterialStatus(value) { this.materialStatus=value; }
    async dispose() {}
  }
  class MoGe { async init() { this.useRealWeights = true; this.weightsSource = 'local'; } async dispose() {} async run() { behavior.geometryRuns++;return { width:4,height:4,depth:new Float32Array(16).fill(1),normals:new Float32Array(48).fill(1),routeResult:{ receipt } }; } }
  const kit = {
    requestBrowserWebGpuDevice: async () => { behavior.deviceRequests++; if (behavior.failDevice) throw Error('Transient setup failure'); return { device, adapter:{}, backendIdentity:{ kind:'webgpu-local' } }; },
    createWebGpuInferenceSession: async () => session,
    createWebGpuInferenceControl: () => ({ async close() {} }),
  };
  const supermat = { SUPERMAT_ROUTE_ID:'supermat.image-to-pbr.webgpu-local.v0', superMatDeviceOptions:async()=>({}),
    createSuperMatAdapter: async options => {behavior.profile=options;behavior.onLoad?.();if(behavior.loadGate)await behavior.loadGate;return { identity:{}, async run(input) { behavior.materialRuns++;behavior.materialSize=input.size;behavior.inputPixel=input.image.data[0];behavior.onRun?.();if(behavior.runGate)await behavior.runGate;if(behavior.failMaterials)throw Error('Material failure'); return { width:input.size,height:input.size,timings:{},dutyCount:1 }; } };} };
  class Canvas { constructor(width,height) { this.width=width;this.height=height; } getContext() { return { drawImage:bitmap=>{this.pixel=bitmap.pixel;}, getImageData: () => ({ width:this.width,height:this.height,data:new Uint8ClampedArray(this.width*this.height*4).fill(this.pixel) }) }; } }
  class BlobURL extends URL { static createObjectURL() { return 'blob:test'; } static revokeObjectURL() {} }
  const response = (url='') => ({ ok:true, blob:async()=>({pixel:url.includes('bag')?2:url.includes('evil-orb')?3:1}) });
  const context = vm.createContext({ document, navigator:{gpu:{}}, location:{search}, window:{}, URL:BlobURL, URLSearchParams,
    OffscreenCanvas:Canvas, Uint8ClampedArray, Uint8Array, performance, crypto, Blob,
    createImageBitmap:async blob=>{if(behavior.bitmapGate)await behavior.bitmapGate;return {width:4,height:4,pixel:blob.pixel,close(){}};},
    fetch:async url => behavior.failImage?{ok:false,status:404}:behavior.gates.has(url) ? behavior.gates.get(url).promise : response(url),
    setInterval:()=>0, clearInterval(){}, requestAnimationFrame:callback=>queueMicrotask(()=>callback(0)),
  });
  const source = new vm.SourceTextModule(await readFile(new URL('./main.js',import.meta.url),'utf8'), { context });
  await source.link(async specifier => {
    if(specifier==='./sample-cutouts.js')return new vm.SyntheticModule(['createSampleCutout'],function(){this.setExport('createSampleCutout',(sample,width,height)=>['orb','bag'].includes(sample)?{sample,width,height,source:'hand-authored-example-cutout'}:null);},{context});
    if(specifier==='./deployment.js')return new vm.SyntheticModule(['GENERATION_AVAILABLE'],function(){this.setExport('GENERATION_AVAILABLE',generationAvailable);},{context});
    if(specifier==='./included-examples.js')return new vm.SyntheticModule(['loadIncludedExample'],function(){
      this.setExport('loadIncludedExample',async(key,inputKey,size)=>{
        if(!examples)return null;
        if(exampleFailure)throw Error('Included example HTTP 404');
        behavior.onExample?.();if(behavior.exampleGate)await behavior.exampleGate;
        return {depth:{width:4,height:4},output:{width:512,height:512},provenance:{source:'included-example',inputKey,size:512,modelRevision:'test'}};
      });
    },{context});
    if(specifier==='./inference-cache.js')return new vm.SyntheticModule(['createInferenceCache','photoCacheKey','retainedGeometry'],function(){
      this.setExport('retainedGeometry',value=>value);
      this.setExport('photoCacheKey',async image=>`pixels:${image.data[0]}`);
      this.setExport('createInferenceCache',()=>({async get(key){return structuredClone(behavior.cache.get(key)??null);},async put(key,value){behavior.cache.set(key,structuredClone(value));return true;}}));
    },{context});
    if (['./photo-contracts.js','./photo-surface.js','./demo-defaults.js'].includes(specifier)) return new vm.SourceTextModule(await readFile(new URL(specifier,import.meta.url),'utf8'), { context });
    const exports = specifier.includes('/core.js') ? kit : specifier.includes('supermat-route') ? supermat : specifier.includes('moge-producer') ? { MoGeInference:MoGe } : { MaterialPhotoViewer:Viewer };
    return new vm.SyntheticModule(Object.keys(exports), function() { for(const [name,value]of Object.entries(exports))this.setExport(name,value); }, { context });
  });
  await source.evaluate();
  const defer = key => { let resolve; const promise=new Promise(r=>{resolve=r;}); behavior.gates.set(`./images/${key}`,{promise}); return () => resolve(response()); };
  return { behavior, elements, views, samples, actions:context.window.__materialPhotoActions, state:context.window.__materialPhoto, receipt, defer };
}

test('latest requested photograph wins even when fetches complete out of order', async () => {
  const c = await controller(), releaseBag=c.defer('bag.webp'), releaseOrb=c.defer('evil-orb.png');
  const bag=c.actions.sample('bag'), orb=c.actions.sample('orb');
  releaseOrb(); await orb; releaseBag(); await bag;
  assert.equal(c.state.source, 'Metal & glow');
});

test('arrival opens an included orb with no model loading or inference',async()=>{
  const c=await controller({examples:true,search:''});
  assert.equal(c.state.source,'Metal & glow');
  assert.equal(c.state.status,'included');
  assert.equal(c.behavior.geometryRuns,0);assert.equal(c.behavior.materialRuns,0);
  assert.equal(c.behavior.profile,undefined);assert.ok(c.behavior.viewer.maps);
  assert.match(c.elements.provenance.textContent,/Included example/);
});
test('example cutouts follow image selection without entering model input or leaking to another sample',async()=>{
  const c=await controller({examples:true,search:''});
  assert.equal(c.behavior.viewer.cutout.sample,'orb');
  await c.actions.sample('bag');assert.equal(c.behavior.viewer.cutout.sample,'bag');
  await c.actions.infer();assert.equal(c.behavior.inputPixel,2);assert.equal(c.behavior.viewer.cutout.sample,'bag');
  await c.actions.sample('celebration');assert.equal(c.behavior.viewer.cutout,null);
});

test('public explorer keeps saved results playable without offering unavailable inference',async()=>{
  const c=await controller({examples:true,generationAvailable:false});
  await c.actions.infer();
  assert.equal(c.state.runs.length,0);
  assert.equal(c.state.status,'included');assert.ok(c.behavior.viewer.maps);
  assert.equal(c.elements['generation-controls'].hidden,true);
  assert.equal(c.elements['local-generation'].hidden,false);
  assert.equal(c.elements.run.disabled,true);assert.equal(c.elements.file.disabled,true);
  await c.actions.sample('orb');assert.equal(c.state.status,'included');
});

test('late included restoration cannot admit generation when a different job completes',async()=>{
  const c=await controller({examples:true});let releaseRun,releaseExample,enteredRun,enteredExample;
  c.behavior.runGate=new Promise(r=>{releaseRun=r;});const running=new Promise(r=>{enteredRun=r;});c.behavior.onRun=enteredRun;
  const job=c.actions.infer();await running;
  c.behavior.exampleGate=new Promise(r=>{releaseExample=r;});const loading=new Promise(r=>{enteredExample=r;});c.behavior.onExample=enteredExample;
  const browse=c.actions.sample('orb');await loading;releaseRun();await job;
  assert.equal(c.elements.run.disabled,true);assert.equal(c.state.status,'restoring');
  await c.actions.infer();assert.equal(c.behavior.materialRuns,1);
  releaseExample();await browse;assert.equal(c.elements.run.disabled,false);assert.equal(c.state.status,'included');
});
test('failed sample fetch allows retry on the retained photograph',async()=>{
  const c=await controller();c.behavior.failImage=true;
  await c.samples[1].onclick();
  assert.equal(c.state.status,'error');assert.equal(c.state.source,'Celebration');assert.equal(c.elements.run.disabled,false);
});
test('a displayed included material stays playable during its regeneration',async()=>{
  const c=await controller({examples:true});let release,entered;
  c.behavior.loadGate=new Promise(r=>{release=r;});const loading=new Promise(r=>{entered=r;});c.behavior.onLoad=entered;
  const before=c.behavior.viewer.maps,job=c.actions.infer();await loading;
  assert.equal(c.behavior.viewer.maps,before);assert.match(c.elements.provenance.textContent,/Included/);
  release();await job;assert.equal(c.state.status,'done');assert.match(c.elements.provenance.textContent,/Newly/);
});

for(const revisit of [false,true])test(`missing example preserves cached depth after ${revisit?'revisiting':'changing resolution'}`,async()=>{
  const c=await controller({examples:true,exampleFailure:true});await c.actions.infer();
  assert.equal(c.state.status,'done');assert.ok(c.behavior.viewer.maps);
  c.elements['material-size'].value='1024';
  if(revisit){await c.actions.sample('orb');await c.actions.sample('celebration');}
  else await c.elements['material-size'].onchange();
  assert.equal(c.state.cache?.geometry,true);assert.equal(c.state.cache?.materials,false);
  assert.equal(c.behavior.viewer.maps,null);assert.ok(c.behavior.viewer.surface);
  assert.equal(c.views.find(v=>v.dataset.view==='materials').disabled,true);
  assert.match(c.elements.provenance.textContent,/cached depth/);
  assert.match(c.elements.status.textContent,/Example unavailable.*depth restored/);
  assert.equal(c.behavior.materialRuns,1);assert.equal(c.elements.run.disabled,false);
});

for(const phase of ['load','run'])test(`browsing during material ${phase} preserves the captured request and offers its result`,async()=>{
  const c=await controller();let release,started;
  c.behavior[`${phase}Gate`]=new Promise(resolve=>{release=resolve;});
  const entered=new Promise(resolve=>{started=resolve;});c.behavior[phase==='load'?'onLoad':'onRun']=started;
  const run=c.actions.infer();await entered;
  assert.equal(c.elements.file.disabled,false);
  await c.actions.sample('orb');
  assert.equal(c.state.source,'Metal & glow');
  c.elements['material-size'].value='1024';await c.elements['material-size'].onchange();
  release();await run;
  assert.equal(c.state.source,'Metal & glow');assert.equal(c.state.status,'loaded');
  assert.equal(c.behavior.inputPixel,1);assert.equal(c.behavior.materialSize,512);
  assert.equal(c.state.runs.at(-1).status,'done');assert.equal(c.elements['view-result'].hidden,false);
  await c.elements['view-result'].onclick();
  assert.equal(c.state.source,'Celebration');assert.equal(c.elements['material-size'].value,'512');
  assert.ok(c.behavior.viewer.maps);assert.match(c.elements.provenance.textContent,/Newly generated/);
});
test('selected material resolution reaches the producer and survives the run record',async()=>{
  const c=await controller();c.elements['material-size'].value='768';await c.actions.infer();
  assert.equal(c.behavior.materialSize,768);
  assert.equal(c.state.runs.at(-1).supermat.size,768);
  assert.deepEqual(Array.from(c.state.result.materialSize),[768,768]);
});
test('consumer selects the product profile and forwards glow and bloom controls without inference',async()=>{
  const c=await controller();await c.actions.infer();
  assert.equal(c.behavior.profile.activations,'f16');assert.equal(c.behavior.profile.fuseNorm,true);
  assert.equal(c.behavior.profile.gemmPrecision,'f16-tiles');
  const count=c.state.runs.length;
  for(const [key,value]of Object.entries({glowIntensity:4,glowThreshold:.2,bloomIntensity:2,bloomRadius:.8,bloomThreshold:1,exposure:1.5})){
    c.elements[key].value=value;c.elements[key].oninput();assert.equal(c.behavior.viewer.getEffects()[key],value);
  }
  assert.equal(c.state.runs.length,count);c.elements.bloom.checked=false;c.elements.bloom.onchange();
  assert.equal(c.behavior.viewer.getEffects().bloom,false);
});
test('comparison restores surface perspectives after inspecting a map',async()=>{
  const c=await controller();await c.actions.infer();
  c.elements.map.value='normals';c.elements.map.onchange();
  assert.equal(c.behavior.viewer.map,'normals');c.actions.compare();
  assert.equal(c.behavior.viewer.map,'surface');assert.equal(c.elements.map.value,'surface');
});
test('tuning dock opens and closes without changing inference or material settings',async()=>{
  const c=await controller();await c.actions.infer();const count=c.state.runs.length;
  assert.equal(c.elements.controls.hidden,true);
  assert.equal(typeof c.elements['tuning-toggle'].onclick,'function');
  c.elements['tuning-toggle'].onclick();assert.equal(c.elements.controls.hidden,false);
  assert.equal(c.elements.workspace.dataset.controls,'open');
  c.elements['tuning-toggle'].onclick();assert.equal(c.elements.controls.hidden,true);
  assert.equal(c.state.runs.length,count);
});
test('diagnostic selection from either unlit focus preserves its effective label',async()=>{
  for(const mode of ['original','photo']){
    const c=await controller();await c.actions.infer();c.actions.view(mode);
    c.elements['gi-view'].value='incoming';c.elements['gi-view'].onchange();
    assert.equal(c.behavior.viewer.mode,'materials');
    assert.equal(c.behavior.viewer.getDiagnostic(),'incoming');
    assert.equal(c.elements['gi-view'].value,'incoming');
    assert.equal(c.elements.map.value,'surface');assert.equal(c.behavior.viewer.map,'surface');
    assert.equal(c.behavior.viewer.useGI,true);assert.equal(c.elements.gi.checked,true);
  }
});
test('depth-only diagnostic uses the available lit receiver after material failure',async()=>{
  for(const mode of ['original','photo']){
    const c=await controller();c.behavior.failMaterials=true;await c.actions.infer();c.actions.view(mode);
    assert.equal(c.elements['gi-view'].disabled,false);
    c.elements['gi-view'].value='ao';c.elements['gi-view'].onchange();
    assert.equal(c.behavior.viewer.mode,'relit');
    assert.equal(c.behavior.viewer.getDiagnostic(),'ao');assert.equal(c.elements['gi-view'].value,'ao');
    assert.equal(c.behavior.viewer.useGI,true);assert.equal(c.elements.gi.checked,true);
  }
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
test('failed material rerun preserves playable previous output with an explicit label', async () => {
  const c=await controller(); await c.actions.infer(); c.behavior.failMaterials=true; await c.actions.infer();
  assert.equal(c.state.status,'error'); assert.equal(c.views[3].disabled,false);
  assert.match(c.elements.provenance.textContent,/Previous result/);assert.ok(c.behavior.viewer.maps);
  assert.equal(c.views[2].disabled,false);c.actions.view('relit');
  assert.equal(c.behavior.viewer.mode,'relit');assert.equal(c.elements.sun.hidden,false);
});
test('observed MoGe routeResult receipt survives consumer reporting', async () => {
  const c=await controller(); await c.actions.infer();
  assert.deepEqual(c.state.runs.at(-1).moge.route,c.receipt);
});
test('switching back restores completed results and resolution changes reuse geometry',async()=>{
  const c=await controller();await c.actions.infer();
  assert.equal(c.behavior.geometryRuns,1);assert.equal(c.behavior.materialRuns,1);
  c.elements['material-size'].value='1024';await c.elements['material-size'].onchange();
  assert.equal(c.views[3].disabled,true);assert.equal(c.views[2].disabled,false);
  await c.actions.infer();assert.equal(c.behavior.geometryRuns,1);assert.equal(c.behavior.materialRuns,2);
  c.elements['material-size'].value='512';await c.elements['material-size'].onchange();
  assert.equal(c.state.status,'cached');assert.deepEqual(Array.from(c.state.result.materialSize),[512,512]);
  assert.equal(c.behavior.materialRuns,2);
  await c.actions.sample('orb');assert.equal(c.state.status,'loaded');assert.equal(c.views[3].disabled,true);
  await c.actions.sample('celebration');assert.equal(c.state.status,'cached');assert.equal(c.behavior.geometryRuns,1);
  assert.equal(c.behavior.materialRuns,2);assert.equal(c.views[3].disabled,false);
});
test('resolution events during upload decoding preserve the newly selected photograph',async()=>{
  const c=await controller();let release;
  c.behavior.bitmapGate=new Promise(resolve=>{release=resolve;});
  c.elements.file.files=[{name:'selected-photo.png',pixel:8}];c.elements.file.onchange();
  c.elements['material-size'].value='1024';await c.elements['material-size'].onchange();
  release();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(c.state.source,'selected-photo.png');assert.equal(c.elements['material-size'].value,'1024');
  assert.equal(c.state.status,'loaded');assert.equal(c.elements.run.disabled,false);
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
