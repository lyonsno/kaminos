import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

async function controller() {
  const behavior = { failDevice: false, failMaterials: false, deviceRequests: 0, gates: new Map() };
  const node = dataset => ({ dataset, style: {}, value: '', disabled: false, hidden: false,
    classList: { toggle() {} }, removeAttribute() {}, getBoundingClientRect: () => ({ width: 4, height: 4 }) });
  const elements = Object.fromEntries(['status','preview','scene','stage-label','run','file','map','light','height','exposure','gi','reset','name','resolution','progress','elapsed','timings','identity'].map(id => [id,node({})]));
  elements.light.value = -35; elements.height.value = 35; elements.exposure.value = 1;
  const views = ['original','photo','materials'].map(view => node({ view }));
  const samples = ['celebration','bag','orb'].map(sample => node({ sample }));
  const document = {
    getElementById: id => elements[id],
    querySelector: selector => views.find(n => selector === `[data-view=${n.dataset.view}]`),
    querySelectorAll: selector => selector === '[data-sample]' ? samples : selector.includes(':not') ? views.slice(1) : views,
  };
  const device = { queue: { async onSubmittedWorkDone() {} }, lost: new Promise(() => {}), destroy() {} };
  const route = () => ({ routeId: 'test', runtime: {}, async drain() {},
    enqueue({ execute }) { return { completion: Promise.resolve().then(() => execute({})).then(output => ({ status:'succeeded',output }), failure => ({ status:'failed',failure })) }; } });
  const session = { registerRoute: async () => route(), unregisterRoute() {}, async close() {} };
  const receipt = { schema: 'kaminos.webgpu-route-receipt.v0', status: 'succeeded', effectiveRouteId: 'moge.depth-normal.webgpu-local.v0' };
  class Viewer {
    async init() { behavior.viewer = this; this.renderer = { backend: { device }, toneMappingExposure: 1 }; this.gi = { debugState: () => ({}) }; return this; }
    clear() { this.maps = null; }
    reset() { this.setLight(); this.renderer.toneMappingExposure = 1; }
    setLight(a = -35, h = 35) { this.light = [a,h]; }
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
    createSuperMatAdapter: async () => ({ identity:{}, async run() { if(behavior.failMaterials)throw Error('Material failure'); return { width:4,height:4,timings:{},dutyCount:1 }; } }) };
  class Canvas { constructor(width,height) { this.width=width;this.height=height; } getContext() { return { drawImage() {}, getImageData: () => ({ width:this.width,height:this.height,data:new Uint8ClampedArray(this.width*this.height*4) }) }; } }
  class BlobURL extends URL { static createObjectURL() { return 'blob:test'; } static revokeObjectURL() {} }
  const response = () => ({ ok:true, blob:async()=>({}) });
  const context = vm.createContext({ document, navigator:{gpu:{}}, location:{search:''}, window:{}, URL:BlobURL, URLSearchParams,
    OffscreenCanvas:Canvas, Uint8ClampedArray, Uint8Array, performance, crypto,
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
test('transient device setup failure can be retried', async () => {
  const c=await controller(); c.behavior.failDevice=true; await c.actions.infer();
  assert.equal(c.state.status,'error'); c.behavior.failDevice=false; await c.actions.infer();
  assert.equal(c.behavior.deviceRequests,2); assert.equal(c.state.status,'done');
});
test('new surface synchronizes the lighting controls', async () => {
  const c=await controller(); await c.actions.infer();
  c.elements.light.value=80; c.elements.light.oninput(); c.elements.exposure.value=2; c.elements.exposure.oninput();
  await c.actions.sample('bag'); await c.actions.infer();
  assert.equal(Number(c.elements.light.value), c.behavior.viewer.light[0]);
  assert.equal(Number(c.elements.exposure.value), c.behavior.viewer.renderer.toneMappingExposure);
});
test('failed material rerun cannot advertise old material maps', async () => {
  const c=await controller(); await c.actions.infer(); c.behavior.failMaterials=true; await c.actions.infer();
  assert.equal(c.state.status,'error'); assert.equal(c.views[2].disabled,true);
  assert.equal(c.elements.map.disabled,true); assert.equal(c.elements.light.disabled,true);
});
test('observed MoGe routeResult receipt survives consumer reporting', async () => {
  const c=await controller(); await c.actions.infer();
  assert.deepEqual(c.state.runs.at(-1).moge.route,c.receipt);
});
