import fs from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {compositionRestoreUrl} from '../scene-authoring.mjs';
import {assertMountedScene} from '../visual-work.mjs';
import {checkJoinedOpticalGpu} from './check-joined-optical-gpu.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function replaceOnce(text,from,to){assert.equal(text.split(from).length,2,'instrumentation anchor must be unique: '+from);return text.replace(from,to);}
export function joinedComparisonPlan(){
 const arms=[];
 for(const noise of [false,true])for(const orbit of [0,.06]){
  for(const steps of [7,8,9,31,32,33])for(const marcher of ['uniform','old-adaptive','numerical'])
   arms.push({label:`${marcher}-${steps}-n${Number(noise)}-v${Number(orbit>0)}`,noise,orbit,steps,mode:marcher==='numerical'?'numerical':'current',adaptive:marcher==='uniform'?0:1});
  arms.push({label:`reference-160-n${Number(noise)}-v${Number(orbit>0)}`,noise,orbit,steps:160,mode:'current',adaptive:0});
 }
 return [...arms,{...arms[0],label:'baseline-repeat'}];
}
export function validateJoinedArm(state,arm,step){
 assert.equal(state.backend,'WebGPU:apple','native backend');assert.equal(state.simStepCount,step,'held fine field');
 assert.equal(state.worldSmoke?.effective,'one-way-world-field','joined rendering must execute');
 assert.equal(state.opticalStepping?.integrationDomain,'joined-fine-world','effective integration domain');
 assert.equal(state.opticalStepping?.effective,arm.mode,'effective marcher');
 assert.equal(state.controls.raySteps,arm.steps,'effective ray steps');
 assert.equal(state.controls.adaptiveRays,arm.adaptive,'effective old adaptive setting');
 assert.equal(state.controls.rayStartNoise,arm.noise,'effective blue noise');
 assert.equal(state.controls.rayNoiseAnimated,false);assert.equal(state.controls.quadratureJitter,false);
 assert.equal(state.error,null);
}

export async function main(root,out,sourceOrigin,sceneFile){
 await fs.mkdir(path.dirname(out),{recursive:true});await fs.mkdir(out);
 const report={status:'running',phase:'source',root,out,sourceOrigin,sceneFile,arms:[],errors:[],plan:joinedComparisonPlan(),claim:'frozen joined scene and short camera displacement; material counts are not GPU timing'};
 const save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await save();
 let context,server,serverError,page;
 try{
  assert.equal(await fs.realpath(root),await fs.realpath(path.resolve(import.meta.dirname,'..')),'script and source checkout differ');
  report.revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  report.diff=execFileSync('git',['diff','HEAD'],{cwd:root,encoding:'utf8'});
  report.sourceRuntime=await(await fetch(sourceOrigin+'/api/runtime-config')).json();
  const sceneResponse=await fetch(sourceOrigin+'/api/read?root=scenes&path='+encodeURIComponent(sceneFile));
  assert.equal(sceneResponse.status,200,'named scene unavailable');
  const scene=await sceneResponse.json();await fs.writeFile(out+'/source-scene.json',JSON.stringify(scene,null,2));
  const home=out+'/stores';await fs.mkdir(home);
  for(const [name,key] of [['basins','sharedBasinStore'],['presets','volumeSettingsStore']]){
   assert.ok(report.sourceRuntime[key],'source store missing');await fs.cp(report.sourceRuntime[key],home+'/'+name,{recursive:true});
  }
  for(const name of ['layouts','scenes'])await fs.mkdir(home+'/'+name);
  await fs.writeFile(home+'/scenes/'+sceneFile,JSON.stringify(scene));
  const bodies={};report.sources={};
  for(const name of ['volume-core.js','volume-optical-native.mjs','volume-world-smoke-optics.mjs']){
   bodies[name]=await fs.readFile(root+'/'+name,'utf8');await fs.writeFile(out+'/original-'+name,bodies[name]);report.sources[name]={original:sha(bodies[name])};
  }
  bodies['volume-optical-native.mjs']=replaceOnce(bodies['volume-optical-native.mjs'],'override OPTICAL_STEP_MODE: u32 = 0u;','override OPTICAL_STEP_MODE: u32 = 0u;\noverride JOINED_DIAG_COUNTS: bool = false;');
  let core=bodies['volume-core.js'];
  core=replaceOnce(core,'let missAlpha = mix(1.0, 0.0, TRANSPARENT_CANVAS);','if(JOINED_DIAG_COUNTS){return makeRaymarchResult(vec4<f32>(0,0,0,1),1.0,vec4<f32>(0),vec4<f32>(0),vec4<f32>(0),vec4<f32>(0));}\n    let missAlpha = mix(1.0, 0.0, TRANSPARENT_CANVAS);');
  core=replaceOnce(core,'const opticalConstants = {OPTICAL_STEP_MODE:optical.value,RAY_STEP_STATS:rayStepTelemetry.active};','const opticalConstants = {OPTICAL_STEP_MODE:optical.value,RAY_STEP_STATS:rayStepTelemetry.active,JOINED_DIAG_COUNTS:!!globalThis.__joinedCounts};');
  core=replaceOnce(core,'const opticalKey = `:${optical.mode}:stats=${rayStepTelemetry.active}`;','const opticalKey = `:${optical.mode}:stats=${rayStepTelemetry.active}:counts=${!!globalThis.__joinedCounts}`;');
  core=replaceOnce(core,"if ((optical.mode !== 'current'||rayStepTelemetry.active)","if ((optical.mode !== 'current'||rayStepTelemetry.active||globalThis.__joinedCounts)");
  core=replaceOnce(core,'state.opticalStepping = { ...optical, effective: optical.mode,','state.opticalStepping = { ...optical, effective: optical.mode, diagnosticCounts:!!globalThis.__joinedCounts,');
  core=replaceOnce(core,'if (RAY_STEP_STATS) { rayStepCounters[traceRay] = rayMaterialSamples; }',`if (RAY_STEP_STATS) { rayStepCounters[traceRay] = rayMaterialSamples; }
  if(JOINED_DIAG_COUNTS){return makeRaymarchResult(vec4<f32>(vec3<f32>(f32(rayMaterialSamples&255u),f32((rayMaterialSamples>>8u)&255u),f32((rayMaterialSamples>>16u)&255u))/255.0,1.0),trans,residualFeature,vec4<f32>(0),vec4<f32>(0),vec4<f32>(0));}`);
  core=replaceOnce(core,'    setWorldSmokeOverlay(mode) {',`    async diagnosticWorldOptical(){
      if(!worldSmoke)throw Error('world field unavailable');
      const dims=worldSmoke.plan.materialDims,row=Math.ceil(dims[0]*16/256)*256,size=row*dims[1]*dims[2];
      const buffer=device.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      try{const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture:worldSmoke.optical},{buffer,bytesPerRow:row,rowsPerImage:dims[1]},dims);device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);const bytes=new Uint8Array(buffer.getMappedRange());let text='';for(const v of bytes)text+=String.fromCharCode(v);
        return{dims,row,base64:btoa(text)};
      }finally{buffer.unmap();buffer.destroy();}
    },
    setWorldSmokeOverlay(mode) {`);
  bodies['volume-core.js']=core;
  for(const [name,body] of Object.entries(bodies)){await fs.writeFile(out+'/effective-'+name,body);report.sources[name].effective=sha(body);}
  report.phase='server';await save();
  const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const origin=`http://127.0.0.1:${port}`,log=openSync(out+'/server.log','a');
  try{server=spawn('python3',['serve.py',String(port)],{cwd:root,env:{...process.env,KAMINOS_SHARED_BASIN_STORE:home+'/basins',KAMINOS_VOLUME_SETTINGS_STORE:home+'/presets',KAMINOS_VOLUME_COCKPIT_LAYOUT_STORE:home+'/layouts',KAMINOS_SCENES_DIR:home+'/scenes'},stdio:['ignore',log,log]});server.once('error',error=>{serverError=error;});}finally{closeSync(log);}
  for(;;){if(serverError)throw serverError;if(server.exitCode!==null)throw Error('server exited');try{const r=await fetch(origin+'/api/runtime-config');if(r.ok){report.runtime=await r.json();break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  assert.equal(report.runtime.source.repoRoot,root,'wrong served root');
  report.executable=process.env.CHROMIUM_EXECUTABLE;report.playwright=process.env.PLAYWRIGHT_MODULE;
  assert.match(report.executable||'',/Google Chrome for Testing|chrome-headless-shell|chromium/,'independent browser required');
  const {chromium}=await import(pathToFileURL(report.playwright));
  context=await chromium.launchPersistentContext(out+'/profile',{executablePath:report.executable,headless:true,viewport:{width:1200,height:900},args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
  await context.route(/\/(volume-core\.js|volume-optical-native\.mjs|volume-world-smoke-optics\.mjs)(\?.*)?$/,route=>route.fulfill({contentType:'text/javascript',body:bodies[new URL(route.request().url()).pathname.slice(1)]}));
  page=await context.newPage();page.setDefaultTimeout(0);page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  report.phase='load';report.url=compositionRestoreUrl(scene.composition,sceneFile,origin,'authoring');await save();await page.goto(report.url);
  await page.waitForFunction(()=>{const s=window.__kaminosVolumePrototype?.debugState();if(s?.error)throw Error(s.error);return s?.active&&window.kaminosSceneAuthoring?.read().objects.length>0;});
  await page.waitForFunction(()=>/^(Scene loaded|Volume scene loaded)/.test(document.getElementById('info-bar')?.textContent||''));
  const mount=await page.evaluate(()=>({objects:window.kaminosSceneObjectDebugState(),authoredObjects:window.kaminosSceneAuthoring.read().objects,volume:window.__kaminosVolumePrototype.debugState()}));assertMountedScene(scene,mount.objects,mount);
  await page.evaluate(()=>{window.selectSceneField('flame-field');window.kaminosSetCameraDebugPose({position:[9,5,12],target:[0,2,0]});const r=window.__kaminosVolumePrototype;r.setControls({lookFreeze:0,raySteps:8,renderScale:.5,raymarchMode:'current'});r.setSimulationPaused(false);});
  report.phase='settle';await save();await page.waitForFunction(()=>window.__kaminosVolumePrototype.debugState().simStepCount>=192);
  report.held=await page.evaluate(()=>{const r=window.__kaminosVolumePrototype;r.setSimulationPaused(true);r.setControls({lookFreeze:1,quadratureJitter:false,rayNoiseAnimated:false});return r.debugState();});
  assert.equal(report.held.worldSmoke?.effective,'one-way-world-field');assert.equal(report.held.backend,'WebGPU:apple');
  report.camera=await page.evaluate(()=>window.kaminosCameraDebugState());
  report.phase='gpu-arithmetic';await save();report.arithmetic=await checkJoinedOpticalGpu(page,async rows=>{report.arithmetic=rows;await save();});
  for(const arm of report.plan){
   report.phase=arm.label;await save();
   const row={...arm};
   for(const counts of [false,true]){
    const capture=await page.evaluate(async({arm,counts,camera})=>{
     const r=window.__kaminosVolumePrototype,d=camera.position.map((v,i)=>v-camera.target[i]),angle=arm.orbit;
     window.kaminosSetCameraDebugPose({position:[camera.target[0]+d[0]*Math.cos(angle)+d[2]*Math.sin(angle),camera.position[1],camera.target[2]+d[2]*Math.cos(angle)-d[0]*Math.sin(angle)],target:camera.target});
     r.setControls({raySteps:arm.steps,adaptiveRays:arm.adaptive,rayStartNoise:arm.noise,rayNoiseAnimated:false,rayNoiseFrame:0,quadratureJitter:false});r.setDebugOpticalStepping({mode:arm.mode,tolerance:.001});window.__joinedCounts=counts;
     const sample=await r.sampleFrame({advanceSim:false,includeRgba:true,now:12000});
     if(!sample.ok||sample.image?.rgba?.length!==sample.image.width*sample.image.height*4)throw Error('missing or partial frame');
     const {width,height,rgba}=sample.image,c=document.createElement('canvas');c.width=width;c.height=height;c.getContext('2d').putImageData(new ImageData(Uint8ClampedArray.from(rgba),width,height),0,0);
     return{state:r.debugState(),png:c.toDataURL().split(',')[1],width,height};
    },{arm,counts,camera:report.camera});
    const name=arm.label+(counts?'-counts':'');const bytes=Buffer.from(capture.png,'base64');await fs.writeFile(out+'/'+name+'.png',bytes);
    validateJoinedArm(capture.state,arm,report.held.simStepCount);assert.equal(capture.state.opticalStepping.diagnosticCounts,counts);
    row[counts?'counts':'image']={sha256:sha(bytes),width:capture.width,height:capture.height};row.state=capture.state;
    if(!counts)await page.screenshot({path:out+'/'+arm.label+'-scene.png'});
   }
   report.arms.push(row);await save();
  }
  assert.equal(report.arms[0].image.sha256,report.arms.at(-1).image.sha256,'baseline return pixels changed');
  assert.equal(report.arms[0].counts.sha256,report.arms.at(-1).counts.sha256,'baseline return count changed');
  report.phase='retain-fields';await save();
  report.fields=await page.evaluate(()=>window.__kaminosVolumePrototype.beginDebugFullFieldExport({}));assert.ok(report.fields.ok);
  for(const kind of ['fluid','front','boundary','boundarySplat']){
   const file=await fs.open(out+'/'+kind+'.f32','w');let startFloat=0;
   try{for(;;){const chunk=await page.evaluate(({kind,startFloat})=>window.__kaminosVolumePrototype.readDebugFullFieldExportChunk({kind,startFloat}),{kind,startFloat});assert.ok(chunk.ok);await file.write(Buffer.from(chunk.base64,'base64'));startFloat+=chunk.floatCount;if(chunk.isFinal)break;assert.ok(chunk.floatCount>0);}}finally{await file.close();}
  }
  const world=await page.evaluate(()=>window.__kaminosVolumePrototype.diagnosticWorldOptical());await fs.writeFile(out+'/world-optical.f32-padded',Buffer.from(world.base64,'base64'));report.world={dims:world.dims,row:world.row};
  const reactant=await page.evaluate(()=>window.__kaminosVolumePrototype.sampleReactantFields());assert.ok(reactant.ok&&reactant.reactantBase64);await fs.writeFile(out+'/reactant.f32',Buffer.from(reactant.reactantBase64,'base64'));
  assert.deepEqual(report.errors,[],'browser errors');report.status='observed';report.phase='complete';
 }catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;await page?.screenshot({path:out+'/failed.png'}).catch(()=>{});}
 finally{await context?.close();if(server&&server.exitCode===null&&!serverError){const stopped=once(server,'exit');server.kill();await stopped;}await save();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error?.split('\n')[0],out}));}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)await main(...process.argv.slice(2));
