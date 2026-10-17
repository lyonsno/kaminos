import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {visualWork} from '../visual-work.mjs';
import {validateCaptureProfile} from './beaming-capture-profiler.mjs';
const [out,store,origin,sceneFile,assay]=process.argv.slice(2);
if(!out||!store||!origin||!sceneFile)throw Error('explicit output, store, origin and scene required');
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'identity',repoRoot:process.cwd(),origin,store,sceneFile,errors:[],rows:[],claim:'held-source capture and remaining-render attribution; instrumented GPU pass time is not uninstrumented FPS'};
const write=()=>fs.writeFile(out+'/capture-cost.json',JSON.stringify(report,null,2));
await write();let context,page;
try{
 report.source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();report.modules={};
 for(const name of ['scene-hybrid-radiance.mjs','fire-light-field-shadow.mjs','scratch/beaming-capture-profiler.mjs']){
  const local=await fs.readFile(name),served=Buffer.from(await(await fetch(origin+'/'+name)).arrayBuffer());
  assert.deepEqual(served,local);report.modules[name]=createHash('sha256').update(local).digest('hex');await fs.writeFile(out+'/'+name.replaceAll('/','_'),local);
 }
 report.scene=JSON.parse(await fs.readFile(store+'/scenes/'+sceneFile));await fs.writeFile(out+'/scene.json',JSON.stringify(report.scene));
 const {chromium}=await import(process.env.KAMINOS_PLAYWRIGHT_MODULE);
 report.executable='/Users/noahlyons/.local/state/kaminos/browsers/chrome-for-testing-154.0.8037.92/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
 context=await chromium.launchPersistentContext(out+'/browser-profile',{executablePath:report.executable,headless:true,viewport:{width:1500,height:1100},deviceScaleFactor:1,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 page=context.pages()[0];page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('Failed to load resource:'))report.errors.push(m.text());});
 const hdr=await fs.readFile('/Users/noahlyons/.local/state/kaminos/modal-scene-solids-1013/evidence/studio_small_09_1k.hdr');
 await page.route('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr',r=>r.fulfill({status:200,contentType:'application/octet-stream',body:hdr,headers:{'Access-Control-Allow-Origin':'*'}}));
 // Only this isolated document imports instrumentation. Served production stays unchanged.
 const rewrite=async(name,change)=>page.route(origin+'/'+name,async route=>{
  const source=await fs.readFile(name,'utf8'),body=change(source);assert.notEqual(body,source,'instrumentation anchor absent');
  await fs.writeFile(out+'/instrumented-'+name,body);await route.fulfill({status:200,contentType:'text/javascript',body});
 });
 await rewrite('scene-hybrid-radiance.mjs',s=>"import {installCaptureProfiler} from './scratch/beaming-capture-profiler.mjs';\n"+s.replace('  validateShadowQuality(', '  installCaptureProfiler(device);\n  validateShadowQuality(').replace('    // Source coefficients',"    const originalRender=shadow.render.bind(shadow);shadow.render=(...args)=>globalThis.__captureProfile.measure('shadow',()=>originalRender(...args));\n    // Source coefficients"));
 await rewrite('fire-light-field-shadow.mjs',s=>s.replace('cubeCamera.update(renderer,scene);',"const savedAuto=scene.matrixWorldAutoUpdate;try{if(globalThis.__captureProfile.matrixReuse)scene.matrixWorldAutoUpdate=false;globalThis.__captureProfile.measure(globalThis.__captureProfile.scope==='shadow'?'cube':'other-cube',()=>cubeCamera.update(renderer,scene));}finally{scene.matrixWorldAutoUpdate=savedAuto;}"));
 const owner={id:'fire-shadow-sampling',inputsText:JSON.stringify({sampling:'complementary',points:4,pointSampling:'paired',shadowQuality:{resolution:36,blockerSamples:4,filterSamples:2}})};
 report.phase='load';
 report.visual=await visualWork({page,origin,repoRoot:process.cwd(),sceneStore:store+'/scenes',basinStore:store+'/basins',sceneFile,workspace:'workbench',owner,out,exercise:async()=>{
  await page.waitForFunction(()=>window.__kaminosSceneRadiance?.canRender()&&window.__kaminosVolumePrototype.debugState().simStepCount>=200);
  await page.evaluate(()=>window.__kaminosVolumePrototype.setSimulationPaused(true));
  const before=await page.evaluate(()=>window.__kaminosVolumePrototype.sampleSceneVolumeSource());
  await fs.writeFile(out+'/held-source.f32',Buffer.from(new Float32Array(before.values).buffer));
  const modes=assay==='matrix-reuse'?[[4,'paired',false],[4,'paired',true],[4,'paired',false],[4,'paired',true]]:[[1,'all'],[2,'all'],[4,'paired'],[4,'all'],[1,'all']];
  for(const [points,pointSampling,matrixReuse=false] of modes){
   report.phase=`measure-${points}-${pointSampling}`;await write();
   await page.evaluate(args=>window.kaminosWorkbenchExperiments.invoke('setQuadrature',args),{points,pointSampling});
   await page.evaluate(value=>globalThis.__captureProfile.matrixReuse=value,matrixReuse);
   await page.waitForFunction(({points,pointSampling})=>{const s=window.__kaminosSceneRadiance.debugState();return window.__kaminosSceneRadiance.canRender()&&s.pointCount===points&&s.pointSampling===pointSampling&&s.shadows.every(x=>x.effective&&x.resolution===36&&x.blockerSamples===4&&x.filterSamples===2);},{points,pointSampling});
   const row=await page.evaluate(async({points,pointSampling})=>{
    const p=window.__captureProfile,wait=()=>new Promise(requestAnimationFrame);
    // Compile/settle separately; raw timing population is preserved, not filtered.
    for(let i=0;i<20;i++)await wait();
    const frames=[];
    for(const timestamps of [false,true])for(let i=0;i<(timestamps?12:60);i++){
     await wait();const frame={timestamps,cpu:[],gpu:[],errors:[],submits:0};p.active=frame;
     const start=performance.now();await wait();p.active=null;frame.elapsedMs=performance.now()-start;
     await Promise.all(p.pending.splice(0));
     const s=window.__kaminosSceneRadiance.debugState();Object.assign(frame,{points:s.pointCount,quality:{resolution:s.shadowResolution,blockerSamples:s.blockerSamples,filterSamples:s.filterSamples},current:window.__kaminosSceneRadiance.canRender()});frames.push(frame);
    }
    return {points,pointSampling,requestedFrames:72,frames,errors:frames.flatMap(f=>f.errors),backend:window.__kaminosVolumePrototype.debugState().backend,lighting:window.__kaminosSceneRadiance.debugState(),volume:window.__kaminosVolumePrototype.debugState()};
   },{points,pointSampling});
   row.matrixReuse=matrixReuse;report.rows.push(row);await write();validateCaptureProfile(row);
   await page.screenshot({path:out+`/mode-${report.rows.length}-${points}-${pointSampling}.png`});assert.deepEqual(report.errors,[]);
  }
  const after=await page.evaluate(()=>window.__kaminosVolumePrototype.sampleSceneVolumeSource());assert.deepEqual(after.values,before.values);report.sourceUnchanged=true;return {url:page.url()};
 }});
 report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.failure={phase:report.phase,message:error.message,stack:error.stack};process.exitCode=1;if(page)await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}
finally{await context?.close();await write();console.log(JSON.stringify({status:report.status,phase:report.phase,failure:report.failure?.message}));}
