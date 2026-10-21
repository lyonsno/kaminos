import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {chromium} from '/Users/noahlyons/.local/state/kaminos/minion-visual-handoff-1004/browser-deps/node_modules/playwright-core/index.mjs';

const root=process.argv[2], out=process.argv[3];
const sha=b=>createHash('sha256').update(b).digest('hex');
function replaceOne(source,old,value){assert.equal(source.split(old).length,2,`unique instrumentation anchor: ${old}`);return source.replace(old,value);}
function validateArm(s,priority,jitter,step){
 assert.equal(s.backend,'WebGPU:apple');assert.equal(s.simStepCount,step);
 assert.equal(s.opticalStepping.effective,'numerical');assert.equal(s.opticalStepping.tolerance,.01);
 assert.equal(s.controls.flamePriority,priority);assert.equal(s.controls.raySteps,1);
 assert.equal(s.controls.quadratureJitter,jitter);
}
if(root==='--self-test'){
 const good={backend:'WebGPU:apple',simStepCount:96,opticalStepping:{effective:'numerical',tolerance:.01},controls:{flamePriority:.001333,raySteps:1,quadratureJitter:true}};
 validateArm(good,.001333,true,96);
 for(const bad of [{...good,backend:'fallback'},{...good,simStepCount:97},{...good,controls:{...good.controls,flamePriority:0}},{...good,opticalStepping:{effective:'fixed',tolerance:.01}}])assert.throws(()=>validateArm(bad,.001333,true,96));
 assert.throws(()=>replaceOne('x x','x','y'));assert.throws(()=>replaceOne('z','x','y'));
 console.log('diagnostic admission negative controls passed');process.exit(0);
}
assert.ok(path.isAbsolute(root)&&path.isAbsolute(out));
await fs.mkdir(out,{recursive:true});
const origin='http://127.0.0.1:18724';
const executable='/Users/noahlyons/.local/state/kaminos/browsers/chrome-for-testing-154.0.8037.92/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const home=path.dirname(out),peer='/Users/noahlyons/.local/state/kaminos/handy-continuous-detail-1018';
const report={ok:false,phase:'prepare',root,origin,executable,arms:[],errors:[],source:{},claim:'diagnostic image/count comparison; no timing claim'};
const save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));
let server,context,page;
process.on('SIGTERM',async()=>{report.error='terminated';await save();await context?.close();server?.kill();process.exit(1);});
try{
 await save();await fs.copyFile(new URL(import.meta.url),out+'/witness.mjs');
 report.revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 report.worktreeDiff=execFileSync('git',['diff'],{cwd:root,encoding:'utf8'}); // retained, not served for the three files below
 for(const dir of ['basins','layouts','scenes'])await fs.cp(peer+'/'+dir,home+'/'+dir,{recursive:true,force:false,errorOnExist:false});
 const bodies={};
 for(const name of ['volume-core.js','volume-optical-native.mjs','volume-raymarch-sampling.mjs']){
  const text=execFileSync('git',['show',`HEAD:${name}`],{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024});
  bodies[name]=text;report.source[name]={originalSha256:sha(text)};
  await fs.writeFile(out+'/original-'+name,text);
 }
 bodies['volume-optical-native.mjs']=replaceOne(bodies['volume-optical-native.mjs'],'override OPTICAL_STEP_MODE: u32 = 0u;',`override OPTICAL_STEP_MODE: u32 = 0u;
override DIAG_COUNTS: bool = false;
override DIAG_GUIDE: u32 = 0u;`);
 let core=bodies['volume-core.js'];
 core=replaceOne(core,'let guide = flameGuideSegmentPadded(', 'var guide = flameGuideSegmentPadded(');
 core=replaceOne(core,'let cellWidth = 2.0 / f32(GRID);\n        let nearby', 'if (DIAG_GUIDE == 1u) { guide = vec2<f32>(0.0, 1.0); }\n        let cellWidth = 2.0 / f32(GRID);\n        let nearby');
 core=replaceOne(core,'const opticalConstants = {OPTICAL_STEP_MODE:optical.value,RAY_STEP_STATS:rayStepTelemetry.active};',
  'const opticalConstants = {OPTICAL_STEP_MODE:optical.value,RAY_STEP_STATS:rayStepTelemetry.active, DIAG_COUNTS:!!globalThis.__priorityDiagnostic?.counts, DIAG_GUIDE:globalThis.__priorityDiagnostic?.guide||0};');
 core=replaceOne(core,'const opticalKey = `:${optical.mode}:stats=${rayStepTelemetry.active}`;',
  'const opticalKey = `:${optical.mode}:stats=${rayStepTelemetry.active}:diagnostic=${JSON.stringify(globalThis.__priorityDiagnostic||{})}`;');
 core=replaceOne(core,'if (RAY_STEP_STATS) { rayStepCounters[traceRay] = rayMaterialSamples; }',`if (RAY_STEP_STATS) { rayStepCounters[traceRay] = rayMaterialSamples; }
  if (DIAG_COUNTS) {
    return makeRaymarchResult(vec4<f32>(vec3<f32>(f32(rayMaterialSamples & 255u), f32((rayMaterialSamples >> 8u) & 255u), f32((rayMaterialSamples >> 16u) & 255u)) / 255.0, 1.0), trans, residualFeature, vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0));
  }`);
 bodies['volume-core.js']=core;
 for(const [name,body] of Object.entries(bodies)){report.source[name].effectiveSha256=sha(body);await fs.writeFile(out+'/effective-'+name,body);}
 if(process.argv[4]==='--prepare-only'){report.ok=true;report.phase='prepared';await save();process.exit(0);}
 const log=await fs.open(out+'/server.log','a');
 server=spawn('python3',['serve.py','18724'],{cwd:root,env:{...process.env,KAMINOS_SHARED_BASIN_STORE:home+'/basins',KAMINOS_VOLUME_SETTINGS_STORE:home+'/presets',KAMINOS_VOLUME_COCKPIT_LAYOUT_STORE:home+'/layouts',KAMINOS_SCENES_DIR:home+'/scenes'},stdio:['ignore',log.fd,log.fd]});
 await new Promise((resolve,reject)=>{server.once('error',reject);const check=async()=>{if(server.exitCode!==null)return reject(Error('server exited'));try{await fetch(origin+'/api/roots');resolve();}catch{setTimeout(check,100);}};check();});
 const {verifyAuthoringServer}=await import(root+'/scene-authoring-witness-identity.mjs');
 report.serving=await verifyAuthoringServer({origin,repoRoot:root});
 context=await chromium.launchPersistentContext(out+'/profile',{executablePath:executable,headless:true,args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu'],viewport:{width:1100,height:950}});
 report.intercepted=[];
 await context.route(url=>Object.hasOwn(bodies,url.pathname.split('/').pop()),async route=>{const name=new URL(route.request().url()).pathname.split('/').pop();report.intercepted.push({url:route.request().url(),sha256:sha(bodies[name])});await route.fulfill({contentType:'application/javascript',body:bodies[name]});});
 page=context.pages()[0];page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);
 let rejectFatal;const fatal=new Promise((_,reject)=>{rejectFatal=reject;});fatal.catch(()=>{});
 const step=p=>Promise.race([p,fatal]);
 page.on('pageerror',e=>{report.errors.push(e.message);void save();rejectFatal(e);});
 page.on('console',m=>{if(m.type()==='error'){report.errors.push(m.text());void save();if(/invalid shader|validation|device lost|PRESET LOAD FAILED/i.test(m.text()))rejectFatal(Error(m.text()));}});
 const scene=JSON.parse(await fs.readFile(home+'/scenes/flame-sampling-bench.kaminos.json'));
 const {compositionRestoreUrl}=await import(root+'/scene-authoring.mjs');
 report.url=compositionRestoreUrl(scene.composition,'flame-sampling-bench.kaminos.json',origin,'workbench',{id:'flame',inputsText:'{}'});
 report.phase='load';await save();await step(page.goto(report.url));
 await step(page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='flame'&&window.__kaminosVolumePrototype?.debugState().simStepCount>=2));
 await step(page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('setPaused',true)));
 const sourceId='vsp-915e0dc1b3707a43b5061218e7eb9e46f7ad0aadcf343a0e9c6db84c3aee4a75';
 const source=await(await fetch(origin+'/api/volume-settings-preset?id='+sourceId)).json();
 await fs.writeFile(out+'/source-preset.json',JSON.stringify(source,null,2));
 const preset=structuredClone(source.preset),url=new URL(preset.route);
 report.overrides={'volume-resolution':64,'volume-immersed-radius':.5,'volume-steps':1};
 for(const [id,v] of Object.entries(report.overrides)){const c=preset.domControls[id];assert.ok(c,id);c.value=c.tagName==='SELECT'?String(v):v;delete c.rawValue;url.searchParams.set(c.param,typeof v==='boolean'?(v?'1':'0'):String(v));}
 preset.route=url.href;
 const response=await fetch(origin+'/api/volume-settings-presets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label:'Priority squares diagnostic',preset,publishAlias:false})});
 report.presetReceipt=await response.json();assert.ok(response.ok,JSON.stringify(report.presetReceipt));
 report.phase='develop-field';await save();
 await step(page.evaluate(async id=>{const w=window.kaminosWorkbenchExperiments;await w.invoke('applyBasin',id);await w.invoke('setControls',{'volume-render-detail':0,'volume-ray-noise-animated':false,'volume-optical-tolerance':.01,'volume-flame-priority':0,'volume-ray-step-telemetry':false,'volume-raymarch-mode':'numerical'});await w.invoke('select','domain');await w.invoke('frame');await w.invoke('setPaused',false);},report.presetReceipt.effective.presetId));
 await step(page.waitForFunction(()=>window.__kaminosVolumePrototype.debugState().simStepCount>=96));
 await step(page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('setPaused',true)));
 report.held=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState());report.phase='capture';await save();
 async function arm(label,priority,jitter,guide=0){
  const row={label,priority,jitter,guide};
  await step(page.evaluate(async({priority,jitter})=>{await window.kaminosWorkbenchExperiments.invoke('setControls',{'volume-flame-priority':priority,'volume-quadrature-jitter':jitter,'volume-ray-noise-animated':false});window.__kaminosVolumePrototype.setControls({rayNoiseFrame:0});},{priority,jitter}));
  for(const counts of [false,true]){
   const data=await step(page.evaluate(async({counts,guide})=>{
    window.__priorityDiagnostic={counts,guide};const r=window.__kaminosVolumePrototype;
    const s=await r.sampleFrame({advanceSim:false,includeRgba:true,now:12000});if(!s.ok||s.image?.rgba?.length!==s.image.width*s.image.height*4)throw Error('missing/partial frame');
    const c=document.createElement('canvas');c.width=s.image.width;c.height=s.image.height;const ctx=c.getContext('2d');ctx.putImageData(new ImageData(new Uint8ClampedArray(s.image.rgba),c.width,c.height),0,0);
    return{png:c.toDataURL().split(',')[1],state:r.debugState(),width:c.width,height:c.height};
   },{counts,guide}));
   validateArm(data.state,priority,jitter,report.held.simStepCount);
   const name=label+(counts?'-counts':'');const bytes=Buffer.from(data.png,'base64');await fs.writeFile(out+'/'+name+'.png',bytes);
   row[counts?'counts':'image']={sha256:sha(bytes),width:data.width,height:data.height};row.state=data.state;
   if(!counts)await page.screenshot({path:out+'/'+label+'-scene.png'});
  }
  report.arms.push(row);await save();
 }
 for(const jitter of [true,false])for(const [name,p] of [['zero',0],['below',.00133],['above',.001333],['high',.75]])await arm(`${name}-j${Number(jitter)}`,p,jitter);
 await arm('uniform-guide',.75,false,1);
 await arm('zero-repeat',0,true);
 assert.equal(report.arms[0].image.sha256,report.arms.at(-1).image.sha256,'frozen/noise return mismatch');
 report.phase='field-retention';await save();
 report.fieldExport=await step(page.evaluate(()=>window.__kaminosVolumePrototype.beginDebugFullFieldExport({})));
 if(report.fieldExport.ok){
  for(const kind of ['fluid','front','boundary','boundarySplat']){
   const file=await fs.open(out+'/'+kind+'.f32','w');let startFloat=0;
   try{for(;;){const chunk=await page.evaluate(({kind,startFloat})=>window.__kaminosVolumePrototype.readDebugFullFieldExportChunk({kind,startFloat}),{kind,startFloat});assert.ok(chunk.ok);await file.write(Buffer.from(chunk.base64,'base64'));startFloat+=chunk.floatCount;if(chunk.isFinal)break;assert.ok(chunk.floatCount>0);}}finally{await file.close();}
  }
 }
 report.ok=true;report.phase='complete';
}catch(error){report.error=String(error.stack);process.exitCode=1;await page?.screenshot({path:out+'/failed.png'}).catch(()=>{});}
finally{await context?.close();if(server&&server.exitCode===null){const stopped=once(server,'exit');server.kill();await stopped;}await save();console.log(JSON.stringify({ok:report.ok,phase:report.phase,error:report.error?.split('\n')[0],out}));}
