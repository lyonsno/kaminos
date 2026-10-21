import {chromium} from '/Users/noahlyons/.local/state/kaminos/beaming-browser-deps-1007/node_modules/playwright/index.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const [origin,out]=process.argv.slice(2);
const executablePath='/Users/noahlyons/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const params=new URLSearchParams({kaminos_volume_smoke:'1',workspace:'authoring',authoring:'1',volume_resolution:'32',volume_steps:'8',volume_render_scale:'.5',volume_world_smoke:'on',volume_world_smoke_flow:'8',volume_world_smoke_material:'16',volume_world_smoke_extent:'2',volume_world_smoke_transition:'2',volume_wavelet_turbulence:'.2',volume_wavelet_strength:'6',volume_wavelet_octaves:'2',volume_wavelet_octave1_weight:'.1',volume_wavelet_octave2_weight:'1',volume_reaction_law:'reactant-v0',volume_emitter_source_law:'immersed-source',volume_physical_mode:'2',volume_physical_material_law:'2',volume_light_field:'1',volume_light_field_test_scene:'0',volume_collision:'off',volume_pressure_solver:'converged-open-top',volume_pressure_solver_iterations:'24',volume_reaction_live_view:'boundary_fire'});
const report={status:'failed',phase:'source',url:origin+'/?'+params+'#scene=scene_2026-10-17_14-36-46_a960e120a7954752892513416031435e_62581239d5af42b496f9ba5666a43984.kaminos.json',executablePath,errors:[],states:[]};let browser,page;
await mkdir(out,{recursive:true});
try{
 report.source=await(await fetch(origin+'/api/runtime-config')).json();assert.equal(report.source.source.repoRoot,process.cwd());
 browser=await chromium.launch({executablePath,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 page=await browser.newPage({viewport:{width:1100,height:800}});page.setDefaultTimeout(90000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 report.phase='load';await page.goto(report.url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>{const s=window.__kaminosVolumePrototype?.debugState?.();if(s?.error)throw Error(s.error);return s?.simStepCount>5;});
 await page.waitForFunction(()=>document.getElementById('info-bar')?.textContent?.startsWith('Scene loaded:'));
 const read=()=>page.evaluate(()=>window.__kaminosVolumePrototype.debugState());
 const set=async(id,value)=>page.evaluate(({id,value})=>{const el=document.getElementById(id);if(!el)throw Error('Missing '+id);el.value=String(value);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));},{id,value});
 const advance=async()=>{const n=(await read()).simStepCount;await page.waitForFunction(n=>{const s=window.__kaminosVolumePrototype.debugState();if(s.error)throw Error(s.error);return s.simStepCount>n+3;},n);};
 for(const [id,value] of [['volume-steps',8],['volume-world-smoke','on'],['volume-world-smoke-flow',8],['volume-world-smoke-material',16],['volume-world-smoke-extent',2],['volume-physical-material-law',2],['volume-physical-kelvin-per-heat',3200]])await set(id,value);
 await advance();
 report.states.push(await read());assert.equal(report.states.at(-1).openWorldBoundary.effective,'ambient-pressure-open-faces');
 await page.evaluate(()=>window.selectSceneField('flame-field'));await page.keyboard.press('f');
 report.phase='half-pressure';await set('volume-pressure-resolution','half');await advance();
 report.states.push(await read());assert.equal(report.states.at(-1).pressureResolution.effective,'half');
 report.phase='quality';await set('volume-steps',32);await set('volume-adaptive-rays',0);await advance();
 report.states.push(await read());
 assert.equal(report.states.at(-1).worldSmoke.raymarch.steps,32);
 assert.equal(report.states.at(-1).worldSmoke.raymarch.adaptive,0);
 await page.screenshot({path:out+'/half-open.png'});
 report.phase='resize';await set('volume-world-smoke-material',32);await advance();report.states.push(await read());
 report.phase='world-off';await set('volume-world-smoke','off');await advance();report.states.push(await read());
 assert.equal(report.states.at(-1).openWorldBoundary.effective,'legacy-boundaries');
 report.phase='world-on';await set('volume-world-smoke','on');await advance();report.states.push(await read());
 assert.equal(report.states.at(-1).openWorldBoundary.effective,'ambient-pressure-open-faces');
 report.phase='settled-scene';await page.waitForFunction(()=>window.__kaminosVolumePrototype.debugState().simStepCount>=100);
 report.states.push(await read());await page.screenshot({path:out+'/settled.png'});
 report.phase='native-lower-face-fixture';
 report.lowerFaces=await page.evaluate(async()=>{
   const {createOpenBoundary}=await import('./volume-open-boundary.mjs');
   const device=await(await navigator.gpu.requestAdapter()).requestDevice();
   device.pushErrorScope('validation');
   const dims=[4,4,4],n=64,owned=[];
   const buffer=(data)=>{const b=device.createBuffer({size:data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(b,0,data);owned.push(b);return b;};
   const a=new Float32Array(n*16),p=new Float32Array(n*4);
   for(let i=0;i<n;i++){a.set([.1,.2,.3,0],i*16);p[i*4+1]=.125;}
   const fluid=buffer(a),pressure=buffer(p);
   const solid=device.createTexture({size:dims,dimension:'3d',format:'r32uint',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});owned.push(solid);
   const lower=device.createTexture({size:[4,4,3],format:'r32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});owned.push(lower);
   const owner=createOpenBoundary(device,dims,lower);owner.prepare({fluid,pressure,solid,gain:1});
   const read=async(project)=>{const b=device.createBuffer({size:256*4*3,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
     const e=device.createCommandEncoder();owner.encode(e,project);e.copyTextureToBuffer({texture:lower},{buffer:b,bytesPerRow:256,rowsPerImage:4},[4,4,3]);device.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const v=Array.from(new Float32Array(b.getMappedRange().slice(0)));b.unmap();b.destroy();return [v[0],v[256],v[512]];};
   const predicted=await read(false),projected=await read(true);
   device.queue.writeTexture({texture:solid},new Uint32Array([1]),{bytesPerRow:4},[1,1,1]);
   const blocked=await read(true),error=await device.popErrorScope();owner.destroy();owned.forEach(v=>v.destroy());device.destroy();
   return {dims,predicted,projected,blocked,error:error?.message??null};
 });
 assert.equal(report.lowerFaces.error,null);
 for(let a=0;a<3;a++){assert.ok(Math.abs(report.lowerFaces.predicted[a]-(a+1)*.1)<1e-6);assert.ok(Math.abs(report.lowerFaces.projected[a]-((a+1)*.1-.125))<1e-6);assert.equal(report.lowerFaces.blocked[a],0);}
 assert.deepEqual(report.errors,[]);report.phase='complete';report.status='passed';
 await page.screenshot({path:out+'/reopened.png'});
}catch(e){report.error=e.stack;process.exitCode=1;if(page){report.final=await page.evaluate(()=>({state:window.__kaminosVolumePrototype?.debugState?.(),body:document.body.innerText})).catch(()=>null);await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}}
finally{await browser?.close();await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));}
