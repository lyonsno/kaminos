import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { withVisualWorkSession } from '../../visual-work-session.mjs';

// Historical Hotwet native01/native02 domain operations, with shared process lifetime.
const { values } = parseArgs({ options: Object.fromEntries(
  ['repo', 'source', 'out', 'browser', 'playwright', 'python'].map(k => [k, { type: 'string' }])) });
for (const key of ['repo', 'source', 'out', 'browser', 'playwright']) assert.ok(values[key], '--' + key + ' required');
const repo = path.resolve(values.repo), base = path.resolve(values.out);
const { chromium } = await import(pathToFileURL(path.resolve(values.playwright)));
const { visualWork } = await import(pathToFileURL(path.join(repo, 'visual-work.mjs')));
await fs.mkdir(base, { recursive: true });
for (const name of ['scenes', 'settings']) {
  await fs.cp(path.join(values.source, name), path.join(base, name), { recursive: true, errorOnExist: true, force: false });
}
const options = { repoRoot: repo, sceneStore: base + '/scenes', basinStore: base + '/settings',
  chromium, executablePath: values.browser, python: values.python,
  contextOptions: { viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 } };

{
  const out = base + '/native01', errors = [];
  let phase = 'page-setup';
  await withVisualWorkSession({ ...options, out }, async ({ page, origin, receipt }) => {
    page.setDefaultTimeout(0);
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    try {
// Compile the exact old selection and candidate against the same shader/layout.
// Swap only the refraction pipeline at submission while both simulations hold.
await page.addInitScript(()=>{
 if(typeof GPUDevice==='undefined'||typeof GPURenderPassEncoder==='undefined')return;
 window.__scatterMode='candidate';window.__scatterSwitches=0;window.__scatterShaders=[];
 const modules=new WeakMap(),oldPipelines=new WeakMap();
 const create=GPUDevice.prototype.createShaderModule;
 GPUDevice.prototype.createShaderModule=function(d){const module=create.call(this,d);modules.set(module,d);return module;};
 const pipeline=GPUDevice.prototype.createRenderPipelineAsync;
 GPUDevice.prototype.createRenderPipelineAsync=async function(d){const current=await pipeline.call(this,d);
  if(d.fragment?.entryPoint==='fs_refraction'){
   const desc=modules.get(d.fragment.module),fixed=`  // Match the shared host on main: clear/thin water must not add a fixed haze.
  var waterScatter = vec3<f32>(0.055, 0.30, 0.42) * absorptionLoss;
  if (params.hostFrameControls.x <= 0.5) {
    waterScatter = vec3<f32>(0.055, 0.30, 0.42) * (vec3<f32>(0.42) + absorptionLoss * 0.58);
  }`;
   if(!desc.code.includes(fixed))throw Error('candidate production selection missing');
   const code=desc.code.replace(fixed,'  let waterScatter = vec3<f32>(0.055, 0.30, 0.42) * (vec3<f32>(0.42) + absorptionLoss * 0.58);');const module=create.call(this,{...desc,label:'witness-exact-pre-fix-scatter',code});
   const previous=await pipeline.call(this,{...d,label:'witness-exact-pre-fix-scatter',vertex:{...d.vertex,module},fragment:{...d.fragment,module}});
   oldPipelines.set(current,previous);window.__scatterShaders.push({candidate:desc.code,before:code});
  }return current;
 };
 const set=GPURenderPassEncoder.prototype.setPipeline;
 GPURenderPassEncoder.prototype.setPipeline=function(p){if(window.__scatterMode==='before'&&oldPipelines.has(p)){window.__scatterSwitches++;return set.call(this,oldPipelines.get(p));}return set.call(this,p);};
});
phase='scene-open';await visualWork({page,origin,repoRoot:repo,sceneStore:base+'/scenes',basinStore:base+'/settings',sceneFile:'plane_2026-10-19_00-44-36_aad48567dc5844af90725cfcb1d559bd.kaminos.json',workspace:'authoring',out,exercise:async({page,retain,open})=>{
 await page.waitForFunction(()=>{const w=window.kaminosLocalLiquidState();if(w.failure)throw Error(w.failure);return w.mounted;});
 phase='contrasting-bowl';const bowl=await page.evaluate(async()=>{
  const api=window.kaminosSceneAuthoring,bowl=api.read().objects.find(o=>o.geometry?.kind==='bowl').id;
  api.setMaterial(bowl,{color:'#df380c',roughness:.65,metalness:0});
  window.kaminosSetCameraDebugPose({position:[1.8,2.8,2.2],target:[0,-.1,0]});
  await window.kaminosSetLocalLiquidPerformance({particleCount:4096,densityIterations:2,support:'scene_primitives'});window.kaminosPauseLocalLiquid(false);return bowl;
 });
 await page.waitForFunction(()=>{const w=window.kaminosLocalLiquidState();if(w.failure)throw Error(w.failure);return w.solver?.stepCount>=200;});
 if(await page.locator('#volume-viewer-play').getAttribute('data-state')==='playing')await page.locator('#volume-viewer-play').click();
 const held=await page.evaluate(()=>({water:window.kaminosLocalLiquidState(),volume:window.__kaminosVolumePrototype.debugState()}));
 assert.equal(held.water.paused,true);assert.ok(held.water.solver.supportContact.memberIds.includes(bowl));
 const views=[{position:[1.8,2.8,2.2],target:[0,-.1,0]},{position:[0,1.2,3.1],target:[0,-.3,0]}];
 const frames=[];
 for(let i=0;i<views.length;i++)for(const mode of ['before','candidate']){
  phase='capture-'+i+'-'+mode;
  await page.evaluate(({view,mode})=>{window.__scatterMode=mode;window.kaminosSetCameraDebugPose(view);window._kaminosDirty?.();},{view:views[i],mode});
  await page.evaluate(()=>new Promise(resolve=>{let n=0;const tick=()=>++n===4?resolve():requestAnimationFrame(tick);requestAnimationFrame(tick);}));
  const state=await page.evaluate(()=>({water:window.kaminosLocalLiquidState(),view:window.kaminosCameraDebugState(),mode:window.__scatterMode,swaps:window.__scatterSwitches}));
  assert.equal(state.water.solver.stepCount,held.water.solver.stepCount);assert.equal(state.water.failure,null);
  await page.screenshot({path:out+'/'+i+'-'+mode+'.png'});frames.push(state);
 }
 assert.ok(frames[0].swaps>0,'before pipeline must actually execute');
 await fs.writeFile(out+'/held-comparison.json',JSON.stringify({held,frames,views},null,2));
 await fs.writeFile(out+'/exact-shaders.json',JSON.stringify(await page.evaluate(()=>window.__scatterShaders),null,2));
 await page.evaluate(()=>{window.__scatterMode='candidate';window.kaminosSetCameraDebugPose({position:[1.8,2.8,2.2],target:[0,-.1,0]});});
 await page.locator('#volume-viewer-play').click();
 const retained=await retain({name:'bowl-clear-water'});await open(retained.filename);
 await page.waitForFunction(()=>{const w=window.kaminosLocalLiquidState();if(w.failure)throw Error(w.failure);return w.mounted&&w.solver.stepCount>=120;});
 await page.screenshot({path:out+'/fresh-reopen.png'});assert.deepEqual(errors,[]);
 await fs.writeFile(out+'/result.json',JSON.stringify({status:'passed',route:'actual native authored host',comparison:'same held fluid and camera, exact pre-fix scattering floor versus production candidate',bowl,frames:frames.length,handoff:{url:retained.url,filename:retained.filename}},null,2));return {handoff:retained};
}});

    } finally {
      receipt.observationPhase = phase;
      await fs.writeFile(out + '/console.json', JSON.stringify(errors, null, 2));
    }
  });
}

{
  const out = base + '/native02', errors = [];
  let phase = 'page-setup';
  await withVisualWorkSession({ ...options, out }, async ({ page, origin, receipt }) => {
    page.setDefaultTimeout(0);
    page.on('pageerror', e => errors.push(String(e)));
    
    try {
const before=JSON.parse(await fs.readFile(base+'/native01/result.json','utf8'));
await visualWork({page,origin,repoRoot:repo,sceneStore:base+'/scenes',basinStore:base+'/settings',sceneFile:before.handoff.filename,workspace:'authoring',out,exercise:async({page})=>{
 await page.waitForFunction(()=>{const s=window.kaminosLocalLiquidState();if(s.failure)throw Error(s.failure);return s.mounted&&s.solver.stepCount>=160;});
 const state=await page.evaluate(()=>({water:window.kaminosLocalLiquidState(),hookInstalled:typeof window.__scatterMode!=='undefined'}));assert.equal(state.hookInstalled,false);
 await page.screenshot({path:out+'/uninstrumented.png'});assert.deepEqual(errors,[]);
 await fs.writeFile(out+'/result.json',JSON.stringify({status:'passed',state,handoff:before.handoff,errors},null,2));return {handoff:before.handoff};}});

    } finally {
      receipt.observationPhase = phase;
      await fs.writeFile(out + '/console.json', JSON.stringify(errors, null, 2));
    }
  });
}
