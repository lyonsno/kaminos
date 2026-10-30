import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {visualWork} from '../visual-work.mjs';
const [out,origin,sceneFile,mode='baseline']=process.argv.slice(2);assert(out&&origin&&sceneFile);
await fs.mkdir(out,{recursive:true});
const report={receiver:'beaming-frustum-fluffer',status:'running',phase:'launch',origin,sceneFile,mode,repo:process.cwd(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--short'],{encoding:'utf8'}),executable:process.env.KAMINOS_TEST_BROWSER,errors:[],arms:[]};
const write=()=>fs.writeFile(out+'/launch.json',JSON.stringify(report,null,2));await write();let context,page;
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
async function fields(name,source){
 const raw=await page.evaluate(async source=>Object.fromEntries(Object.entries(await window.__kaminosSceneRadiance.readback({includeSource:source})).map(([k,v])=>[k,{dimensions:v.dimensions,data:Array.from(v.data)}])),source);
 const result={};for(const [key,value]of Object.entries(raw)){
  assert.equal(value.data.length,value.dimensions.reduce((a,b)=>a*b,1)*4);assert(value.data.every(Number.isFinite));
  const bytes=Buffer.from(new Float32Array(value.data).buffer);await fs.writeFile(`${out}/${name}-${key}.f32`,bytes);result[key]={dimensions:value.dimensions,sha256:digest(bytes),bytes:bytes.length};
 }return result;
}
try{
 const {chromium}=await import(process.env.KAMINOS_TEST_PLAYWRIGHT);
 context=await chromium.launchPersistentContext(out+'/profile',{executablePath:report.executable,headless:true,viewport:{width:1600,height:1000},args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});page=context.pages()[0];page.setDefaultTimeout(0);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.exposeFunction('__gpuError',m=>report.errors.push(m));await page.addInitScript(()=>{if(!globalThis.GPUAdapter)return;const old=GPUAdapter.prototype.requestDevice;GPUAdapter.prototype.requestDevice=async function(...a){const d=await old.apply(this,a);d.addEventListener('uncapturederror',e=>{(window.__samplingGpuErrors??=[]).push(e.error.message);window.__gpuError(e.error.message);});return d;};});
 report.result=await visualWork({page,origin,repoRoot:process.cwd(),sceneFile,workspace:'workbench',out,exercise:async({retain,open})=>{
  await page.waitForFunction(()=>window.__kaminosVolumePrototype?.debugState()?.simStepCount>=120&&window.__kaminosSceneRadiance?.canRender());
  await page.evaluate(()=>{window.__kaminosVolumePrototype.setSimulationPaused(true);window.__kaminosSceneRadiance.setRetainComparisons(true);});
  const held=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState().simStepCount);report.before=await fields('before',true);
  const choices=mode==='baseline'?[['fixed',48],['spatial',48],['guided',48],['fixed',96]]:[['fixed',48],['spatial',48],['regions',48],['regions',24],['regions',96]];
  for(const [pattern,count]of choices){
   report.phase=`${pattern}-${count}`;await write();
   await page.locator('#rendering-angular-pattern').evaluate((el,v)=>{el.value=v;el.dispatchEvent(new Event('change',{bubbles:true}));},pattern);
   await page.locator('#rendering-angular-samples').evaluate((el,v)=>{el.value=String(v);el.dispatchEvent(new Event('change',{bubbles:true}));},count);
   await page.waitForFunction(({pattern,count})=>{if(window.__samplingGpuErrors?.length)throw Error(window.__samplingGpuErrors[0]);const r=window.__kaminosSceneRadiance,s=r.debugState();if(s.error)throw Error(s.error);return r.canRender()&&s.frame.angularPattern===pattern&&s.frame.directions===count;},{pattern,count});
   const state=await page.evaluate(()=>({lighting:window.__kaminosSceneRadiance.debugState(),volume:window.__kaminosVolumePrototype.debugState()}));assert.equal(state.volume.simStepCount,held);assert.equal(state.volume.controls.raySteps,8);assert.equal(state.lighting.volumeGrid,16);assert.equal(state.lighting.sourceSoftness,0);
   const name=pattern+'-'+count;const captured=await fields(name,false);report.arms.push({pattern,count,state,fields:captured});await page.screenshot({path:out+'/'+name+'.png'});await write();
  }
  report.after=await fields('after',true);assert.equal(report.before.primarySource.sha256,report.after.primarySource.sha256,'sampling comparison changed primary material coefficients');
  assert.deepEqual(report.errors,[]);
  if(mode!=='baseline'){
   const saved=await retain({name:'multi-emitter-sampling',capture:false});report.saved=saved;await open(saved.filename);await page.waitForFunction(()=>window.__kaminosSceneRadiance?.canRender()&&window.__kaminosVolumePrototype.debugState().simStepCount>=120);
   report.reopened=await page.evaluate(()=>window.__kaminosSceneRadiance.debugState());assert.equal(report.reopened.frame.angularPattern,'regions');assert.equal(report.reopened.frame.directions,96);assert.equal(report.reopened.frame.sourceGuide.regions.length,2);await page.screenshot({path:out+'/reopened.png'});
  }
  return {claim:'held primary coefficients and ordinary angular controls; raw light fields and rendered frames, no performance claim',url:report.saved?.url};
 }});report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.failure=String(e.stack||e);process.exitCode=1;await page?.screenshot({path:out+'/failure.png'}).catch(()=>{});}
finally{await context?.close();await write();console.log(JSON.stringify({status:report.status,phase:report.phase,failure:report.failure?.split('\n')[0],errorCount:report.errors.length}));}
