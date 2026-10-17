// Normal-scene native composition witness, not a performance verdict.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const [origin,out,basin,executable,playwright]=process.argv.slice(2);
assert.ok(origin&&out&&basin&&executable&&playwright);
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'launch',origin,basin,executable,source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),errors:[],arms:[]};
const save=()=>fs.writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await save();let browser,page;
try{
 assert.ok(!executable.includes('/Google Chrome.app/'));
 const {chromium}=await import(playwright);
 browser=await chromium.launch({executablePath:executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 page=await browser.newPage({viewport:{width:1100,height:800}});
 page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 report.runtime=await (await page.request.get(`${origin}/api/runtime-config`)).json();
 assert.equal(report.runtime.source.repoRoot,process.cwd());assert.equal(report.runtime.source.commit,report.source);
 report.phase='scene-load';await save();
 await page.goto(`${origin}/index.html?workspace=authoring`);
 await page.waitForFunction(()=>window.kaminosSceneAuthoring?.addFlameEmitter);
 report.add=await page.evaluate(id=>window.kaminosSceneAuthoring.addFlameEmitter(id),basin);
 const control=async(id,value)=>page.evaluate(({id,value})=>{const c=document.getElementById(id);if(!c)throw Error(`Missing ${id}`);c.value=value;c.dispatchEvent(new Event('input',{bubbles:true}));c.dispatchEvent(new Event('change',{bubbles:true}));if(c.value!==value)throw Error(`Rejected ${id}=${value}`);},{id,value:String(value)});
 await control('volume-render-scale',.5);await control('volume-steps',64);await control('volume-look-freeze',0);
 await control('volume-pressure-resolution','off');await control('volume-wavelet-turbulence',1);
 await page.evaluate(()=>{window.selectSceneField('flame-field');window.kaminosFrameSelected();});
 for(const mode of ['off','on']){
  report.phase=`world-${mode}`;await save();await control('volume-world-smoke',mode);
  const step=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState().simStepCount);
  await page.waitForFunction(({step,mode})=>{const s=window.__kaminosVolumePrototype.debugState();if(s.error)throw Error(s.error);return s.simStepCount>=step+60&&(mode==='off'||s.worldSmoke?.effective==='one-way-world-field');},{step,mode});
  const state=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState());report.arms.push({mode,state});await save();
  assert.ok(/^webgpu:/i.test(state.backend)&&!/swiftshader|software/i.test(state.backend));
  assert.equal(state.controls.reactionLaw,'reactant-v0');assert.equal(state.pressureResolution.effective,'off');
  if(mode==='on'){assert.deepEqual(state.worldSmoke.flowDims,[16,32,16]);assert.deepEqual(state.worldSmoke.materialDims,[32,64,32]);assert.equal(state.worldSmoke.materialLaw,'reactant-v0');}
  await page.screenshot({path:`${out}/${mode}.png`});
 }
 assert.deepEqual(report.errors,[]);report.phase='save-scene';await save();
 report.saved=await page.evaluate(()=>window.saveScene({result:true}));assert.equal(report.saved.ok,true);
 report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.error=String(e.stack||e);process.exitCode=1;if(page)try{report.failureState=await page.evaluate(()=>window.__kaminosVolumePrototype?.debugState?.());await page.screenshot({path:`${out}/failure.png`});}catch(capture){report.captureError=String(capture);}}
finally{await save();await browser?.close();}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));
