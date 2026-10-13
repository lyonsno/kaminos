import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compositionRestoreUrl} from '../scene-authoring.mjs';
import {validateTraceSpecialization,compareOpticalTraces} from '../volume-optical-trace.mjs';
import {VOLUME_UNIFORM_FLOATS} from '../volume-core.js';
import {Vector3} from 'three';
import {SMOKEY_SCANLINES,validateSmokeyControls,observeHttpFailures} from '../volume-smokey-heldout.mjs';

const [root,input,out,portText,subdivisionText,stepText='151',yawText='0']=process.argv.slice(2);
await fs.mkdir(out,{recursive:true});
const report={identity:'ordered-optical-capture-conformance-v0',status:'running',phase:'inputs',root,input,
  claim:'nine native scanlines; held-out optical comparison, not learned image quality',errors:[],chunks:[],comparisons:[]};
const save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));
await save();
let server,browser,page;
let abort;
const failure=new Promise((_,reject)=>{abort=reject;});
failure.catch(()=>{});
const guard=promise=>Promise.race([promise,failure]);
try {
  const port=Number(portText),subdivisions=Number(subdivisionText);
  const heldStep=Number(stepText),yaw=Number(yawText);
  assert.ok(Number.isSafeInteger(heldStep)&&heldStep>0,'invalid held step');
  assert.ok(Number.isFinite(yaw),'invalid camera yaw');
  report.requested={heldStep,yaw,subdivisions};
  assert.ok(Number.isInteger(port)&&port>0&&Number.isInteger(subdivisions)&&subdivisions>0);
  report.source=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  report.diff=execFileSync('git',['diff','HEAD'],{cwd:root,encoding:'utf8'});
  await fs.access(root+'/node_modules/three-mesh-bvh/build/index.module.js');
  const basin=JSON.parse(await fs.readFile(input+'/basin.json','utf8'));
  const scene=JSON.parse(await fs.readFile(input+'/scene.kaminos.json','utf8'));
  report.sourceCamera=structuredClone(scene.camera);
  const axis=new Vector3(0,1,0),target=new Vector3().fromArray(scene.camera.target);
  scene.camera.position=new Vector3().fromArray(scene.camera.position).sub(target)
    .applyAxisAngle(axis,yaw*Math.PI/180).add(target).toArray();
  scene.camera.up=new Vector3().fromArray(scene.camera.up??[0,1,0])
    .applyAxisAngle(axis,yaw*Math.PI/180).toArray();
  scene.viewport={...scene.viewport,mode:'user',userView:structuredClone(scene.camera)};
  report.requestedCamera=structuredClone(scene.camera);
  await fs.mkdir(out+'/settings/presets',{recursive:true});
  await fs.mkdir(out+'/scenes',{recursive:true});
  await fs.copyFile(input+'/basin.json',out+`/settings/presets/${basin.presetId}.json`);
  await fs.writeFile(out+'/scenes/optical-trace.kaminos.json',JSON.stringify(scene));
  await fs.copyFile(input+'/basin.json',out+'/source-basin.json');
  await fs.copyFile(input+'/scene.kaminos.json',out+'/source-scene.json');
  report.executable=process.env.CHROMIUM_EXECUTABLE;
  report.playwright=process.env.PLAYWRIGHT_MODULE;
  assert.ok(report.executable?.includes('Google Chrome for Testing')||report.executable?.includes('headless_shell'),'independent test browser required');
  const {chromium}=await import(pathToFileURL(report.playwright));
  report.phase='server';await save();
  server=spawn('python3',['-u','serve.py',String(port),'--no-shared-basin-store','--volume-settings-store',out+'/settings'],
    {cwd:root,env:{...process.env,KAMINOS_SCENES_DIR:out+'/scenes'}});
  server.on('error',abort);
  server.stdout.pipe(createWriteStream(out+'/server.stdout.log'));
  server.stderr.pipe(createWriteStream(out+'/server.stderr.log'));
  const base=`http://127.0.0.1:${port}`;
  for(;;){
    if(server.exitCode!==null)throw new Error(`server exited ${server.exitCode}`);
    try{report.runtime=await (await fetch(base+'/api/runtime-config')).json();break;}catch{await guard(new Promise(r=>setTimeout(r,100)));}
  }
  assert.equal(report.runtime.source.repoRoot,root,'wrong served checkout');
  browser=await chromium.launch({headless:true,executablePath:report.executable,args:['--enable-unsafe-webgpu','--use-angle=metal','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  page=await browser.newPage({viewport:{width:1300,height:950}});page.setDefaultTimeout(0);
  observeHttpFailures(page,report);
  const recordError=e=>{report.errors.push(String(e));abort(new Error(String(e)));};
  page.on('pageerror',recordError);
  page.on('console',m=>{if(m.type()==='error')recordError(`${m.text()} ${JSON.stringify(m.location())}`);});
  report.url=compositionRestoreUrl(scene.composition,'optical-trace.kaminos.json',base);
  report.phase='load';await save();await guard(page.goto(report.url));
  await guard(page.waitForFunction(()=>window.__kaminosVolumePrototype?.debugState().active||window.__kaminosVolumePrototype?.debugState().error));
  assert.equal(await page.evaluate(()=>window.__kaminosVolumePrototype.debugState().error),null);
  // Arm the internal exact-step hold before asynchronous scene settling can pass it.
  await page.evaluate(step=>{window.opticalTraceHold=window.__kaminosVolumePrototype.pauseSelectiveHeadLiveAtSimStep(step);},heldStep);
  await guard(page.waitForFunction(()=>window.kaminosSceneAuthoring?.read().objects.length>=3||/load failed/i.test(document.getElementById('info-bar')?.textContent||'')));
  assert.equal(await page.evaluate(()=>window.kaminosSceneAuthoring.read().objects.length),scene.objects.length);
  report.hold=await guard(page.evaluate(()=>window.opticalTraceHold));assert.equal(report.hold.ok,true,JSON.stringify(report.hold));
  assert.equal(report.hold.paused,true);assert.equal(report.hold.gpuComplete,true);
  assert.equal(report.hold.effectiveSimStepCount,heldStep);
  await guard(page.waitForFunction(()=>/scene loaded:|load failed/i.test(document.getElementById('info-bar')?.textContent||'')));
  report.effectiveCamera=await page.evaluate(()=>window.kaminosNavigationState());
  assert.ok(Number.isFinite(report.requestedCamera.fov)&&Number.isFinite(report.effectiveCamera.fov)
    &&Math.abs(report.requestedCamera.fov-report.effectiveCamera.fov)<1e-5,'camera fov differs from request');
  for(const key of ['position','target','up']) {
    assert.ok(report.requestedCamera[key].every((v,i)=>Math.abs(v-report.effectiveCamera[key][i])<1e-5),`camera ${key} differs from request`);
  }
  report.phase='baseline';await save();
  const baseline=await page.evaluate(async()=>{
    const r=window.__kaminosVolumePrototype;
    const sample=await r.sampleFrame({advanceSim:false,includeRgba:true,now:4000});
    if(!sample.ok||!sample.image)throw new Error('missing baseline');
    return {state:r.debugState(),image:sample.image};
  });
  report.state=baseline.state;
  assert.equal(report.state.effectiveRoute,'native-3d-compute-fluid-raymarch-v0');
  assert.equal(report.state.backend,'WebGPU:apple');
  assert.equal(report.state.simStepCount,heldStep);
  assert.equal(report.state.physicalColor.effective,'emissive-transport-v2');
  report.effectiveDom=await page.evaluate(keys=>Object.fromEntries(keys.map(id=>{
    const el=document.getElementById(id);
    return [id,el?.type==='checkbox'?el.checked:el?.value];
  })),Object.keys(basin.preset.domControls));
  validateSmokeyControls(basin.preset.domControls,report.effectiveDom);
  const source=report.state.immersedSource;
  assert.equal(source?.effective.admitted,true,'immersed source not admitted');
  const emitter=scene.objects.find(o=>o.type==='flame-emitter');
  const radius=basin.preset.domControls['volume-immersed-radius'].value*emitter.transform.scale[0]/scene.flameDomainScale;
  assert.ok(Math.abs(source.requested.radius-radius)<1e-9,'effective mapped radius differs');
  for(const [key,id] of [['fuel','fuel'],['temperature','temperature'],['speed','speed']]) {
    assert.ok(Math.abs(source.requested[key]-basin.preset.domControls[`volume-immersed-${id}`].value)<1e-9,`effective immersed ${key} differs`);
  }
  assert.deepEqual(report.state.ordinaryDomainTranslation,scene.flameDomainTranslation);
  assert.equal(report.state.ordinaryDomainScale,scene.flameDomainScale);
  const {width,height,rgba}=baseline.image;
  assert.equal(width,report.state.width,'baseline viewport width differs');
  assert.equal(height,report.state.height,'baseline viewport height differs');
  await fs.writeFile(out+'/baseline.rgba',Buffer.from(rgba));
  await page.screenshot({path:out+'/baseline-scene.png'});
  assert.ok(rgba.some((v,i)=>i%4!==3&&v>0),'blank baseline');
  for(const fraction of SMOKEY_SCANLINES) {
    let reference;
    for(const specialization of ['force-full']) {
      report.phase=`trace-${fraction}-${specialization}`;await save();
      const chunk=await page.evaluate(async options=>{
        const result=await window.__kaminosVolumePrototype.sampleOpticalTraceChunk(options);
        const values=result.values;
        let readbackBase64=null;
        if(values) {
          const bytes=new Uint8Array(values.buffer,values.byteOffset,values.byteLength);
          let binary='';
          // Match the renderer's binary exports without per-byte protocol objects.
          for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
          readbackBase64=btoa(binary);
        }
        return {...result,values:undefined,readbackBase64};
      },{firstRay:Math.floor(height*fraction)*width,rayCount:width,sampleOffset:0,sampleCount:subdivisions+1,subdivisions,now:4000,specialization});
      const bytes=chunk.readbackBase64!==null ? Buffer.from(chunk.readbackBase64,'base64') : null;
      const path=`trace-${fraction}-${specialization}.f32`;
      if(bytes)await fs.writeFile(out+'/'+path,bytes);
      const sha256=bytes ? createHash('sha256').update(bytes).digest('hex') : null;
      report.chunks.push({...chunk,readbackBase64:undefined,path:bytes ? path : null,sha256});await save();
      assert.equal(chunk.ok,true,`optical capture failed at ${chunk.phase}: ${chunk.reason}`);
      assert.ok(bytes,'missing optical readback');
      for(const [key,value] of Object.entries({width,height,firstRay:Math.floor(height*fraction)*width,
        rayCount:width,sampleOffset:0,sampleCount:subdivisions+1,subdivisions,
        rowCount:width*(subdivisions+1),byteLength:width*(subdivisions+1)*32*4})) {
        assert.equal(chunk.plan[key],value,`scanline ${key} differs from baseline geometry`);
      }
      assert.equal(bytes.length,chunk.plan.byteLength,'scanline byte length differs');
      validateTraceSpecialization(specialization,chunk.effective.specialization);
      // Pair equality alone admits two equally wrong captures. Bind each one
      // to the held native baseline before comparing its optical values.
      const effective=chunk.effective;
      for(const [key,expected] of Object.entries({route:report.state.effectiveRoute,
        backend:report.state.backend,simStepCount:report.state.simStepCount})) {
        assert.equal(effective[key],expected,`capture ${key} differs from baseline`);
      }
      assert.ok(Array.isArray(effective.uniforms)&&effective.uniforms.length===VOLUME_UNIFORM_FLOATS
        &&Array.from(effective.uniforms).every(Number.isFinite),'invalid capture uniforms');
      for(const [index,value] of [[368,2],[310,0],[305,0],[307,0]]) {
        assert.equal(effective.uniforms[index],value,`capture uniform ${index} violates optical material admission`);
      }
      assert.ok(effective.controls&&typeof effective.controls==='object'&&!Array.isArray(effective.controls),'missing capture controls');
      for(const [key,value] of Object.entries(report.state.controls)) {
        assert.ok(Object.hasOwn(effective.controls,key),`missing capture control ${key}`);
        assert.deepEqual(effective.controls[key],value,`capture control ${key} differs from baseline`);
      }
      const incident=effective.incidentLight;
      assert.ok(incident&&typeof incident==='object','missing capture incident lighting');
      if(report.state.physicalColor.incidentLight.model==='six-direction-single-scattering-v1') {
        assert.deepEqual(incident,report.state.physicalColor.incidentLight,'capture native incident lighting differs from baseline');
        assert.equal(incident.legacyDispatched,true);
        assert.ok(Number.isSafeInteger(incident.grid)&&incident.grid>0,'invalid native incident grid');
      } else {
        for(const [key,value] of Object.entries({model:'distributed-volume-direct-radiance-v0',
        source:'same-generation-raw-emission-extinction',support:'full-height-geometry-visible-receivers',
        frame:report.state.simStepCount,receivers:report.state.physicalColor.incidentLight.receivers,
        directions:report.state.physicalColor.incidentLight.directions,legacyDispatched:false})) {
        assert.equal(incident[key],value,`capture incident ${key} differs from native baseline`);
      }
      for(const key of ['receivers','directions','generation']) {
        assert.ok(Number.isSafeInteger(incident[key])&&incident[key]>0,`invalid incident ${key}`);
      }
      }
      if(reference) {
        assert.deepEqual(chunk.plan,reference.chunk.plan,'trace plan changed');
        for(const key of ['route','backend','simStepCount','uniforms','controls']) {
          assert.deepEqual(chunk.effective[key],reference.chunk.effective[key],`trace ${key} changed`);
        }
        for(const key of ['model','source','support','frame','receivers','directions','legacyDispatched']) {
          assert.deepEqual(chunk.effective.incidentLight[key],reference.chunk.effective.incidentLight[key],`incident ${key} changed`);
        }
        const decode=b=>new Float32Array(b.buffer,b.byteOffset,b.byteLength/4);
        const agreement=compareOpticalTraces(decode(reference.bytes),decode(bytes),chunk.plan);
        report.comparisons.push({fraction,...agreement});await save();
        assert.ok(agreement.ok,'full and lean traces exceed numerical agreement criteria');
      } else reference={bytes,chunk};
    }
  }
  const after=await page.evaluate(async()=>{
    const r=window.__kaminosVolumePrototype;
    const sample=await r.sampleFrame({advanceSim:false,includeRgba:true,now:4000});
    if(!sample.ok)throw new Error(JSON.stringify(sample));
    return sample.image;
  });
  assert.ok(Buffer.from(after.rgba).equals(Buffer.from(rgba)),'capture changed ordinary held pixels');
  assert.equal(report.errors.length,0,report.errors.join('\n'));
  assert.ok(report.chunks.some(c=>c.counts.validRows>0),'all captured rays missed');
  report.emitting=report.chunks.some(c=>c.counts.emittingRows>0);
  report.status='observed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;await page?.screenshot({path:out+'/failure.png'}).catch(()=>{});}
finally{
  await save();await browser?.close();
  if(server?.pid&&server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}
}
