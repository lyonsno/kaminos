import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from '/Users/noahlyons/.local/state/kaminos/beaming-browser-deps-1007/node_modules/playwright/index.mjs';
import {visualWork,assertMountedScene} from '../visual-work.mjs';
import {compositionRestoreUrl} from '../scene-authoring.mjs';
const out=process.argv[2],origin=process.argv[3]||'http://127.0.0.1:18586';
if(!out)throw Error('explicit output directory required');
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'start',repoRoot:process.cwd(),origin,errors:[],claim:'prototype conformance and visual exercise, not performance benchmark'};
const write=()=>fs.writeFile(out+'/hybrid.json',JSON.stringify(report,null,2));await write();let browser;
try {
 const executablePath='/Users/noahlyons/.local/state/kaminos/browsers/chrome-for-testing-154.0.8037.92/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';report.browser=executablePath;
 browser=await chromium.launch({executablePath,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal']});
 const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});page.setDefaultTimeout(0);page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(origin+'/tests/');
 report.phase='native-gpu-conformance';await write();
 report.gpu=await page.evaluate(async()=>{
  const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('native WebGPU adapter unavailable');
  const device=await adapter.requestDevice();device.pushErrorScope('validation');
  const {createPointRegions,reducePointRegionsReference}=await import('/scene-point-regions.mjs');
  const dims=[2,4,2],values=new Float32Array(64);values.set([2,1,0,100],0);values.set([0,0,3,0],4*(1+2*(3+4)));
  const texture=device.createTexture({size:dims,dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  device.queue.writeTexture({texture},values,{bytesPerRow:32,rowsPerImage:4},dims);
  const lights=createPointRegions(device,{count:2});lights.encode({status:'encoded',texture,dimensions:dims,gain:2,generation:1,frame:1});
  const read=device.createBuffer({size:512,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=device.createCommandEncoder();
  encoder.copyTextureToBuffer({texture:lights.texture},{buffer:read,bytesPerRow:256},[2,2,1]);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
  const data=new Float32Array(read.getMappedRange()),actual=[0,1].map(i=>({position:Array.from(data.slice(i*4,i*4+3)),radiusSquared:data[i*4+3],energy:Array.from(data.slice(64+i*4,67+i*4))}));
  const expected=reducePointRegionsReference(values,dims,2,2);
  for(let i=0;i<2;i++)for(const key of ['position','energy','radiusSquared']){
    const a=[actual[i][key]].flat(),b=[expected[i][key]].flat();
    if(a.some((v,j)=>!Number.isFinite(v)||Math.abs(v-b[j])>1e-6*Math.max(1,Math.abs(b[j]))))throw Error('GPU source reduction differs: '+JSON.stringify({actual,expected}));
  }
  read.destroy();lights.destroy();texture.destroy();
  const {buildTriangleVisibility}=await import('/scene-light-visibility.mjs'),{createBvhReproject}=await import('/scene-bvh-reproject.mjs');
  const geometry=buildTriangleVisibility([{a:[0,0,0],b:[2,0,0],c:[0,2,0]}]).packGpu();
  const make=data=>device.createBuffer({size:data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
  const nodes=make(geometry.nodes),triangles=make(geometry.triangles),project=createBvhReproject(device,{geometry,nodes,triangles});
  const command=device.createCommandEncoder();project.encode(command,{translate:[2,-2,4],scale:2});
  const copied=device.createBuffer({size:geometry.nodes.byteLength+geometry.triangles.byteLength,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  command.copyBufferToBuffer(nodes,0,copied,0,geometry.nodes.byteLength);command.copyBufferToBuffer(triangles,0,copied,geometry.nodes.byteLength,geometry.triangles.byteLength);
  device.queue.submit([command.finish()]);await copied.mapAsync(GPUMapMode.READ);
  const mapped=copied.getMappedRange(),packed=new Float32Array(mapped),triangle=Array.from(packed.slice(geometry.nodes.length));
  if(JSON.stringify(triangle.slice(0,3))!==JSON.stringify([-1,1,-2])||triangle[4]!==1||triangle[9]!==1)throw Error('GPU BVH reprojection failed: '+JSON.stringify(triangle));
  const words=new Uint32Array(mapped),originalWords=new Uint32Array(geometry.nodes.buffer);
  for(let i=8;i<12;i++)if(words[i]!==originalWords[i])throw Error('GPU BVH topology changed');
  const error=await device.popErrorScope();if(error)throw Error(error.message);
  copied.destroy();nodes.destroy();triangles.destroy();project.destroy();device.destroy();
  return {adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description},actual,expected,triangle,validationErrors:0};
 });await write();
 const route=url=>{const u=new URL(url),h=new URLSearchParams(u.hash.slice(1));for(const[k,v]of Object.entries({volume_light_field_hybrid:'1',rendering_angular_pattern:'guided',rendering_directions:'8',rendering_match_camera:'1'}))h.set(k,v);u.hash=h.toString();return u.href;};
 report.phase='scene-consumer';await write();
 const result=await visualWork({page,origin,repoRoot:process.cwd(),sceneFile:'input.kaminos.json',out,exercise:async({document,retain})=>{
  const url=route(compositionRestoreUrl(document.composition,'input.kaminos.json',origin));await page.goto('about:blank');await page.goto(url);
  const settle=()=>page.waitForFunction(()=>{
    const setup=window.__kaminosSceneRadianceSetup,v=window.__kaminosVolumePrototype?.debugState(),l=window.__kaminosSceneRadiance?.debugState();
    if(setup?.error||v?.error||l?.error)throw Error(setup?.error||v?.error||l?.error);
    return l?.identity==='hybrid-distributed-smoke-point-surfaces-v0'&&l.frame?.directions===8&&l.frame?.angularPattern==='guided'&&l.frame?.pointRegions?.generation===l.frame?.generation&&v?.frameCount>90&&window.__kaminosSceneRadiance.canRender();
  },null,{timeout:0});
  await settle();assertMountedScene(document,await page.evaluate(()=>window.kaminosSceneObjectDebugState()));
  await page.evaluate(()=>window.setGizmoMode(null));
  const observe=()=>page.evaluate(()=>({url:location.href,lighting:window.__kaminosSceneRadiance.debugState(),volume:window.__kaminosVolumePrototype.debugState(),objects:window.kaminosSceneObjectDebugState()}));
  const before=await observe();assert.equal(before.lighting.surfaceReceivers,0);assert.equal(before.lighting.pointCount,4);
  const shot=await retain({name:'hybrid',observe});report.phase='source-movement';await write();
  const flame=document.objects.find(o=>o.id==='flame-emitter'),position=[...flame.transform.position];position[0]+=.04;
  await page.evaluate(({id,position})=>window.kaminosSetSceneObjectTransform(id,{position}),{id:flame.id,position});
  await page.waitForFunction(generation=>window.__kaminosSceneRadiance?.debugState().frame?.generation>generation+5,before.lighting.frame.generation,{timeout:0});await settle();
  const moved=await observe();assert.equal(moved.lighting.geometryBuilds,before.lighting.geometryBuilds,'moving flame must not rebuild CPU BVH');assert.notDeepEqual(moved.lighting.sourceTransform,before.lighting.sourceTransform);
  await retain({name:'hybrid-moved',observe});
  await page.evaluate(({id,position})=>window.kaminosSetSceneObjectTransform(id,{position}),{id:flame.id,position:flame.transform.position});await settle();
  const handoff=route(shot.url);await page.goto('about:blank');await page.goto(handoff);await settle();
  assertMountedScene(shot.document,await page.evaluate(()=>window.kaminosSceneObjectDebugState()));
  const reopened=await observe();assert.equal(reopened.lighting.surfaceReceivers,0);
  return {url:handoff,filename:shot.filename,before,moved,reopened};
 }});
 assert.deepEqual(report.errors,[]);report.result=result.result;report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
finally{await browser?.close();report.finishedAt=new Date().toISOString();await write();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,url:report.result?.url}));}
