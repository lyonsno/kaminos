import fs from 'node:fs/promises';
import path from 'node:path';
import {createWriteStream} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {compositionRestoreUrl} from '../scene-authoring.mjs';
import {getSceneObjectRecords} from '../scene-persistence-core.js';
import {regionalQueryPlan,regionalDataset,regionalSceneLoaded,regionalSceneRestored,regionalCaptureScene} from '../volume-regional-state.mjs';
import {validateTraceRows,REGIONAL_CAPTURE_IDENTITY} from '../volume-optical-trace.mjs';

const rawInvocation=process.argv.slice(2);
let outputDestination;
for(let i=0;i<rawInvocation.length&&rawInvocation[i]!=='--';i++){
  if(rawInvocation[i].startsWith('--out='))outputDestination=rawInvocation[i].slice(6);
  else if(rawInvocation[i]==='--out'&&rawInvocation[i+1]&&!rawInvocation[i+1].startsWith('--'))outputDestination=rawInvocation[++i];
}
if(!outputDestination)throw Error('--out is required to retain a report');
let root;
const out=path.resolve(outputDestination);
await fs.mkdir(out,{recursive:true});
const report={identity:'native-regional-optical-capture-run-v0',status:'running',phase:'arguments',root,out,
  rawInvocation,requested:null,scope:'held-Fine-domain-native-material-diagnostic',chunks:[],errors:[],artifacts:{},
  claim:'native material samples and finite segment-reference dataset; no learned quality or runtime saving established'};
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
const hash=b=>createHash('sha256').update(b).digest('hex');
const artifact=async(name,bytes)=>{await fs.writeFile(path.join(out,name),bytes);report.artifacts[name]={bytes:bytes.length,sha256:hash(bytes)};await save();};
let server,context,page;
await save();
try {
const {values:args}=parseArgs({args:rawInvocation,options:{
  root:{type:'string'},scene:{type:'string'},settings:{type:'string'},out:{type:'string'},
  port:{type:'string',default:'57130'},step:{type:'string',default:'151'},
  tiles:{type:'string',default:'2,3,2'},'context-side':{type:'string',default:'6'},
  queries:{type:'string',default:'32'},subdivisions:{type:'string',default:'64'},seed:{type:'string',default:'1108'},
  chromium:{type:'string'},playwright:{type:'string'},'expected-source':{type:'string'},
  environment:{type:'string',default:'scene'},
}});
  report.requested=args;report.phase='inputs';await save();
  for(const key of ['root','scene','settings','chromium','playwright'])if(!args[key])throw Error(`--${key} is required`);
  assert.ok(['scene','none'].includes(args.environment),'--environment must be scene or none');
  report.lighting={requested:args.environment,hdrRequests:[],effective:null};
  root=await fs.realpath(args.root);report.root=root;
  const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();
  report.source={root,commit:git('rev-parse','HEAD'),branch:git('branch','--show-current'),dirty:!!git('status','--porcelain')};
  assert.equal(report.source.dirty,false,'capture requires a committed source tree');
  if(args['expected-source'])assert.equal(report.source.commit,args['expected-source'],'capture source changed before execution');
  report.phase='native-shader-conformance';await save();
  await import('../tests/volume-regional-capture-native.mjs');
  report.nativeShaderConformance={scope:'production-capture-predicate',route:'shader-herder-required-Apple-hardware',passed:true};
  const executable=await fs.realpath(args.chromium);
  assert.ok(!executable.includes('/Google Chrome.app/')&&
    /Google Chrome for Testing|headless_shell|chrome-headless-shell/.test(executable),'independent test browser required');
  report.executable=executable;
  const sceneBytes=await fs.readFile(args.scene),scene=JSON.parse(sceneBytes);
  const expectedObjects=getSceneObjectRecords(scene);
  assert.ok(expectedObjects.length,'saved scene has no declared objects');
  report.expectedObjectIds=expectedObjects.map(object=>object.id);
  await artifact('source-scene.kaminos.json',sceneBytes);
  const schema=JSON.parse(await fs.readFile(path.join(root,'volume-settings-preset-schema-v2.json'),'utf8'));
  const projection=regionalCaptureScene(scene,schema);
  report.sceneProjection={omittedRendererControls:projection.omittedRendererControls,
    reason:'branch-only camera/history controls are inactive in this current-main native-material diagnostic; source/material/pose data unchanged'};
  const captureSceneBytes=Buffer.from(JSON.stringify(projection.scene));
  await artifact('capture-scene.kaminos.json',captureSceneBytes);
  assert.ok(scene.composition?.flame?.presetId,'saved native flame composition required');
  const stores=Object.fromEntries(['scenes','settings','sessions','layouts','browser-profile'].map(k=>[k,path.join(out,k)]));
  for(const dir of Object.values(stores))await fs.mkdir(dir,{recursive:true});
  await fs.cp(args.settings,stores.settings,{recursive:true});
  await fs.writeFile(path.join(stores.scenes,'regional-source.kaminos.json'),captureSceneBytes);
  report.stores=stores;
  const env={...process.env,KAMINOS_BIND_HOST:'127.0.0.1',KAMINOS_SCENES_DIR:stores.scenes};
  server=spawn('python3',['-u','serve.py',args.port,'--no-shared-basin-store','--volume-settings-store',stores.settings,
    '--volume-basin-session-store',stores.sessions,'--volume-cockpit-layout-store',stores.layouts],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  server.stdout.pipe(createWriteStream(path.join(out,'server.stdout.log')));
  server.stderr.pipe(createWriteStream(path.join(out,'server.stderr.log')));
  let spawnFailure;server.on('error',e=>{spawnFailure=e;});
  const base=`http://127.0.0.1:${args.port}`;
  report.phase='server';await save();
  for(;;) {
    if(spawnFailure)throw spawnFailure;
    if(server.exitCode!==null)throw Error(`server exited ${server.exitCode}`);
    try{report.runtime=await(await fetch(base+'/api/runtime-config')).json();break;}
    catch{await new Promise(r=>setTimeout(r,100));}
  }
  assert.equal(await fs.realpath(report.runtime.source.repoRoot),root,'wrong served checkout');
  const {chromium}=await import(pathToFileURL(args.playwright));
  context=await chromium.launchPersistentContext(stores['browser-profile'],{headless:true,executablePath:executable,
    viewport:{width:1120,height:840},args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain',
      '--password-store=basic','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  page=await context.newPage();page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);
  page.on('request',request=>{if(/\.hdr(?:[?#]|$)/i.test(request.url()))report.lighting.hdrRequests.push(request.url());});
  page.on('pageerror',e=>report.errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  const captureUrl=new URL(compositionRestoreUrl(scene.composition,'regional-source.kaminos.json',base));
  captureUrl.searchParams.set('environment_resources',args.environment==='none'?'off':'on');
  report.url=captureUrl.href;
  report.phase='navigation';await save();await page.goto(report.url);
  report.phase='scene-restore';await save();
  await page.waitForFunction(()=>typeof window.kaminosSceneLoadReady==='function');
  report.sceneRestore=await page.evaluate(regionalSceneRestored,'regional-source.kaminos.json');
  report.phase='volume-start';await save();
  await page.waitForFunction(()=>window.__kaminosVolumePrototype?.debugState().active||window.__kaminosVolumePrototype?.debugState().error);
  report.boot=await page.evaluate(()=>{const s=window.__kaminosVolumePrototype.debugState();return {active:s.active,error:s.error};});
  assert.ok(report.boot.active&&!report.boot.error,`native volume startup failed: ${report.boot.error}`);
  if(args.environment==='none')await page.evaluate(()=>window.__kaminosVolumePrototype.setControls({physicalAmbient:0}));
  const targetStep=Number(args.step);
  await page.evaluate(step=>{window.regionalHold=window.__kaminosVolumePrototype.pauseSelectiveHeadLiveAtSimStep(step);},targetStep);
  report.phase='scene-objects';await save();
  await page.waitForFunction(regionalSceneLoaded,report.expectedObjectIds);
  report.loadedObjects=await page.evaluate(()=>window.kaminosSceneAuthoring.read().objects.map(({id,type,source,transform})=>({id,type,source,transform})));
  for(const expected of expectedObjects) {
    const observed=report.loadedObjects.find(o=>o.id===expected.id);
    assert.ok(observed,`saved scene object missing: ${expected.id}`);
    for(const key of ['id','type','source'])assert.equal(observed[key],expected[key],`wrong saved object ${expected.id}:${key}`);
    if(expected.transform)assert.deepEqual(observed.transform,expected.transform,`saved object transform changed: ${expected.id}`);
  }
  report.phase='source-hold';await save();
  report.hold=await page.evaluate(()=>window.regionalHold);
  assert.ok(report.hold.ok&&report.hold.gpuComplete&&report.hold.paused,'source hold failed');
  assert.equal(report.hold.effectiveSimStepCount,targetStep);
  report.phase='environment-settlement';await save();
  report.lighting.effective=await page.evaluate(()=>window.kaminosEnvironmentLoading.whenSettled());
  if(args.environment==='none'){
    assert.equal(report.lighting.effective.resourceMode,'none');
    assert.equal(report.lighting.effective.quality,'off');
    assert.equal(report.lighting.effective.hasEnvironmentMap,false);
    assert.equal(report.lighting.effective.effectiveIntensity,0);
    assert.deepEqual(report.lighting.hdrRequests,[],'disabled environment still requested HDR resources');
  } else assert.equal(report.lighting.effective.quality,'full','authored environment did not reach full lighting');
  const now=4000;
  report.phase='native-baseline';await save();
  report.baseline=await page.evaluate(async now=>{
    const r=window.__kaminosVolumePrototype;
    r.setSplitIntegral?.({mode:'off'});
    r.setControls({rayStartNoise:false,rayNoiseFrame:0,rayStepTelemetry:false});
    const sample=await r.sampleFrame({advanceSim:false,includeRgba:true,now});
    if(!sample.ok||!sample.image)throw Error('native baseline image missing');
    const bytes=new Uint8Array(sample.image.rgba),parts=[];
    for(let i=0;i<bytes.length;i+=0x8000)parts.push(String.fromCharCode(...bytes.subarray(i,i+0x8000)));
    return {state:r.debugState(),width:sample.image.width,height:sample.image.height,rgbaBase64:btoa(parts.join(''))};
  },now);
  const pixels=Buffer.from(report.baseline.rgbaBase64,'base64');delete report.baseline.rgbaBase64;
  assert.equal(report.baseline.state.effectiveRoute,'native-3d-compute-fluid-raymarch-v0');
  assert.equal(report.baseline.state.backend,'WebGPU:apple');
  assert.equal(report.baseline.state.simStepCount,targetStep,'held source was reset while configuring capture');
  if(args.environment==='none')assert.equal(report.baseline.state.controls.physicalAmbient,0,'flame-only capture retained ambient smoke light');
  assert.ok(pixels.some((v,i)=>i%4!==3&&v>0),'blank native source frame');
  await artifact('native-baseline.rgba',pixels);await page.screenshot({path:path.join(out,'native-baseline.png')});
  const capture=async(points,label)=>{
    const chunks=[];
    const capacity=report.baseline.width*report.baseline.height;
    // Each requested point gets one native invocation. Chunk only at the
    // actual camera raster/device-storage capacity, retaining every point.
    const deviceCapacity=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState().maxStorageBufferBindingSize??null);
    const chunkSize=Math.min(capacity,deviceCapacity?Math.floor(deviceCapacity/128):capacity);
    assert.ok(chunkSize>0,'native query raster is empty');
    for(let offset=0;offset<points.length;offset+=chunkSize) {
      const requestedPoints=points.slice(offset,offset+chunkSize);
      const result=await page.evaluate(async options=>{
        const c=await window.__kaminosVolumePrototype.sampleRegionalOpticalChunk(options);
        let base64=null;
        if(c.values){const b=new Uint8Array(c.values.buffer,c.values.byteOffset,c.values.byteLength),parts=[];
          for(let i=0;i<b.length;i+=0x8000)parts.push(String.fromCharCode(...b.subarray(i,i+0x8000)));base64=btoa(parts.join(''));}
        return {...c,values:undefined,base64};
      },{scope:'fine-domain',kind:'points',points:requestedPoints,now,specialization:'auto'});
      const bytes=result.base64===null?null:Buffer.from(result.base64,'base64');delete result.base64;
      const name=`${label}-${offset}.f32`;
      if(bytes)await artifact(name,bytes);
      report.chunks.push({label,offset,count:requestedPoints.length,...result,path:bytes?name:null});await save();
      assert.equal(result.ok,true,JSON.stringify({phase:result.phase,reason:result.reason}));
      assert.equal(result.identity,REGIONAL_CAPTURE_IDENTITY);
      assert.ok(bytes,'missing raw regional readback');
      const values=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);
      validateTraceRows(values,result.plan,{requireRegional:true,effective:result.effective,expectedStep:targetStep,expectedKind:'points'});
      assert.equal(result.plan.rowCount,requestedPoints.length,'native point population was changed');
      chunks.push(new Float32Array(values));
    }
    const combined=new Float32Array(points.length*32);let at=0;
    for(const chunk of chunks){combined.set(chunk,at);at+=chunk.length;}
    return combined;
  };
  report.phase='native-point-conformance';await save();
  const conformance=await capture([{position:[0,0,0],direction:[0,0,1]},{position:[0,0,0],direction:[1,0,0]}],'direction-conformance');
  for(let k=16;k<23;k++)assert.equal(conformance[k],conformance[32+k],'native coefficient depends on query direction; context design must account for it');
  const bounds=report.chunks.at(-1).effective.regionalCapture.bounds;
  const plan=regionalQueryPlan({bounds,tiles:args.tiles.split(',').map(Number),contextSide:Number(args['context-side']),
    queriesPerRegion:Number(args.queries),subdivisions:Number(args.subdivisions),seed:Number(args.seed)});
  await artifact('plan.json',Buffer.from(JSON.stringify(plan)));
  report.phase='native-regional-samples';await save();
  const rows=await capture(plan.points,'native-points');
  const dataset=regionalDataset(plan,rows);
  assert.ok(dataset.target.some((v,i)=>i%7<6&&Math.abs(v)>1e-6),'all regional emission/scattering targets are empty');
  assert.ok(dataset.target.some((v,i)=>i%7===6&&v<.999999),'all regional extinction targets are empty');
  for(const name of ['context','query','target','coarse','onePoint','sparse','opticalDepth','regionIndex'])
    await artifact(`${name}.bin`,Buffer.from(dataset[name].buffer));
  report.dataset={...dataset,context:undefined,query:undefined,target:undefined,coarse:undefined,onePoint:undefined,sparse:undefined,opticalDepth:undefined,regionIndex:undefined};
  report.phase='source-retention';await save();
  const exported=await page.evaluate(()=>window.__kaminosVolumePrototype.beginDebugFullFieldExport());
  report.fullField=exported;await save();
  assert.equal(exported.ok,true,'retaining the native source state failed');
  for(const kind of ['fluid','front','boundary','boundarySplat']) {
    const chunk=await page.evaluate(({sessionId,kind})=>window.__kaminosVolumePrototype.readDebugFullFieldExportChunk({sessionId,kind,startFloat:0,floatCount:Number.MAX_SAFE_INTEGER}),{sessionId:exported.sessionId,kind});
    assert.ok(chunk.ok&&chunk.isFinal,`partial native ${kind} snapshot`);
    const bytes=Buffer.from(chunk.base64,'base64');
    assert.equal(bytes.length,chunk.byteLength);
    await artifact(`native-${kind}.f32`,bytes);
  }
  await page.evaluate(()=>window.__kaminosVolumePrototype.releaseDebugFullFieldExport());
  assert.equal(report.errors.length,0,report.errors.join('\n'));
  if(args.environment==='none')assert.deepEqual(report.lighting.hdrRequests,[],'late HDR request escaped the environment opt-out');
  assert.equal(git('rev-parse','HEAD'),report.source.commit,'source changed during capture');
  assert.equal(git('status','--porcelain'),'','source became dirty during capture');
  report.status='observed';report.phase='complete';
} catch(error) {
  report.status='failed';report.failurePhase=report.phase;report.error=String(error.stack??error);process.exitCode=1;
  await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});
} finally {
  await save();await context?.close().catch(()=>{});
  if(server?.pid&&server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}
}
