import {chromium} from '/Users/noahlyons/.local/state/kaminos/beaming-browser-deps-1007/node_modules/playwright/index.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const [origin,out]=process.argv.slice(2);
const executablePath='/Users/noahlyons/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const params=new URLSearchParams({kaminos_volume_smoke:'1',workspace:'authoring',authoring:'1',volume_resolution:'32',volume_steps:'8',volume_render_scale:'.5',volume_world_smoke:'on',volume_world_smoke_flow:'8',volume_world_smoke_material:'16',volume_world_smoke_extent:'2',volume_wavelet_turbulence:'.2',volume_wavelet_strength:'8',volume_wavelet_octaves:'2',volume_wavelet_octave1_weight:'.25',volume_wavelet_octave2_weight:'1',volume_reaction_law:'reactant-v0',volume_emitter_source_law:'immersed-source',volume_physical_mode:'2',volume_physical_material_law:'2',volume_light_field:'1',volume_light_field_scene_depth:'1',volume_light_field_test_scene:'0',volume_light_field_shadows:'1',volume_collision:'off'});
params.set('volume_pressure_solver','converged-open-top');
params.set('volume_pressure_solver_iterations','24');
params.set('volume_reaction_live_view','boundary_fire');
params.set('scene','scene_2026-10-17_14-36-46_a960e120a7954752892513416031435e_62581239d5af42b496f9ba5666a43984.kaminos.json');
const scene=params.get('scene');params.delete('scene');
const report={status:'failed',phase:'source',url:origin+'/?'+params+'#scene='+scene,executablePath,errors:[],states:[]};let browser,page;
await mkdir(out,{recursive:true});
try{
 report.source=await(await fetch(origin+'/api/runtime-config')).json();assert.equal(report.source.source.repoRoot,process.cwd());
 browser=await chromium.launch({executablePath,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 page=await browser.newPage({viewport:{width:1100,height:800}});page.setDefaultTimeout(90000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 report.phase='load';await page.goto(report.url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>{const s=window.__kaminosVolumePrototype?.debugState?.();if(s?.error)throw Error(s.error);return s?.simStepCount>8;});
 await page.waitForFunction(()=>document.getElementById('info-bar')?.textContent?.startsWith('Scene loaded:'));
 const read=()=>page.evaluate(()=>window.__kaminosVolumePrototype.debugState());
 await page.evaluate(()=>{for(const [id,value] of [['volume-steps',8],['volume-world-smoke','on'],['volume-world-smoke-flow',8],['volume-world-smoke-material',16],['volume-world-smoke-extent',2],['volume-wavelet-turbulence',.2],['volume-wavelet-strength',8],['volume-wavelet-octaves',2],['volume-wavelet-octave1-weight',.25],['volume-wavelet-octave2-weight',1],['volume-physical-material-law',2]]){const el=document.getElementById(id);el.value=String(value);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));}});
 await page.waitForFunction(()=>window.__kaminosVolumePrototype.debugState().worldSmoke?.effective==='one-way-world-field');
 report.states.push(await read());
 assert.equal(report.states[0].worldSmoke.effective,'one-way-world-field');
 await page.evaluate(()=>window.selectSceneField('flame-field'));await page.keyboard.press('f');
 await page.locator('#flame-view-quality').click();
 report.phase='controls';
 for(const [id,value] of [['volume-wavelet-strength',12],['volume-wavelet-octave1-weight',0],['volume-wavelet-octave2-weight',.5],['volume-world-smoke-transition',2]]){
   await page.evaluate(({id,value})=>{const el=document.getElementById(id);if(!el)throw Error('Missing '+id);el.value=value;el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));},{id,value});
 }
 const before=(await read()).simStepCount;
 await page.waitForFunction(n=>{const s=window.__kaminosVolumePrototype.debugState();if(s.error)throw Error(s.error);return s.simStepCount>n+4;},before);
 report.states.push(await read());
 report.controls=await page.evaluate(()=>Object.fromEntries(['volume-wavelet-strength','volume-wavelet-octave1-weight','volume-wavelet-octave2-weight','volume-world-smoke-transition'].map(id=>[id,document.getElementById(id).value])));
 assert.equal(report.controls['volume-wavelet-strength'],'12');assert.equal(report.controls['volume-wavelet-octave1-weight'],'0');
 assert.equal(report.states.at(-1).worldSmoke.transitionCells,2);
 assert.equal(report.states.at(-1).waveletTurbulence.strength,12);assert.deepEqual(report.states.at(-1).waveletTurbulence.octaveWeights,[0,.5]);
 await page.screenshot({path:out+'/scene.png'});assert.deepEqual(report.errors,[]);
 report.phase='save-reopen';
 await page.evaluate(()=>{for(const [id,value] of [['volume-wavelet-strength',4],['volume-wavelet-octave1-weight',1],['volume-wavelet-octave2-weight',1],['volume-world-smoke-transition',0]]){const el=document.getElementById(id);el.value=String(value);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));}});
 report.saved=await page.evaluate(()=>window.saveSceneAs({result:true}));assert.equal(report.saved.ok,true);
 await page.goto(report.saved.url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.getElementById('info-bar')?.textContent?.startsWith('Scene loaded:')&&window.__kaminosVolumePrototype?.debugState?.().simStepCount>8);
 report.reopened=await read();assert.equal(report.reopened.worldSmoke.effective,'one-way-world-field');assert.equal(report.reopened.worldSmoke.transitionCells,0);assert.deepEqual(report.reopened.waveletTurbulence.octaveWeights,[1,1]);assert.equal(report.reopened.waveletTurbulence.strength,4);
 report.offeredUrl=report.saved.url;
 await page.evaluate(()=>window.selectSceneField('flame-field'));await page.keyboard.press('f');await page.locator('#flame-view-quality').click();
 await page.screenshot({path:out+'/reopened.png'});assert.deepEqual(report.errors,[]);
 report.status='passed';report.phase='complete';
}catch(e){report.error=e.stack;process.exitCode=1;if(page){report.final=await page.evaluate(()=>({state:window.__kaminosVolumePrototype?.debugState?.(),body:document.body.innerText})).catch(()=>null);await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}}
finally{await browser?.close();await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));}
