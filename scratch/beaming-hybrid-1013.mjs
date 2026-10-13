import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from '/Users/noahlyons/.local/state/kaminos/beaming-browser-deps-1007/node_modules/playwright/index.mjs';
import {visualWork,assertMountedScene} from '../visual-work.mjs';
import {compositionRestoreUrl} from '../scene-authoring.mjs';
const out=process.argv[2],origin=process.argv[3]||'http://127.0.0.1:18586';
const smokeRefinement=Number(process.argv[4]??4);
if(!out)throw Error('explicit output directory required');
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'start',repoRoot:process.cwd(),origin,errors:[],claim:'prototype conformance and visual exercise, not performance benchmark'};
const write=()=>fs.writeFile(out+'/hybrid.json',JSON.stringify(report,null,2));await write();let browser;
try {
 const executablePath='/Users/noahlyons/.local/state/kaminos/browsers/chrome-for-testing-154.0.8037.92/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';report.browser=executablePath;
 browser=await chromium.launch({executablePath,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal']});
 const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});page.setDefaultTimeout(0);page.on('pageerror',e=>report.errors.push(e.message));
 report.consoleErrors=[];report.ancillaryErrors=[];page.on('console',message=>{if(message.type()==='error'){
   const row={text:message.text(),location:message.location()};report.consoleErrors.push(row);
   // Observed non-rendering failures: absent favicon and an existing retired
   // cockpit-layout control in the shared store. Preserve, don't call them GPU failures.
   const path=row.location.url?new URL(row.location.url).pathname:'';
   if(row.text.startsWith('Failed to load resource:')&&['/favicon.ico','/api/volume-cockpit-layouts'].includes(path))report.ancillaryErrors.push(row);
   else report.errors.push(row.text);
 }});
 // Exercise Three's handled-error channel: shader validation can log without
 // throwing a pageerror. Such a draw failure must make the witness fail.
 await page.evaluate(()=>console.error('hybrid witness deliberate renderer-error channel probe'));
 await page.waitForFunction(()=>true);
 assert.deepEqual(report.errors,['hybrid witness deliberate renderer-error channel probe']);
 report.rendererErrorProbe={caught:report.errors.splice(0),claim:'console error channel injection, not a deliberately broken GPU pipeline'};
 await page.goto(origin+'/tests/');
 report.phase='native-gpu-conformance';await write();
 report.gpu=await page.evaluate(async()=>{
  const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('native WebGPU adapter unavailable');
  if(adapter.info.isFallbackAdapter||/swiftshader|software/i.test(adapter.info.description))throw Error('software fallback is not native GPU evidence');
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
  copied.destroy();nodes.destroy();triangles.destroy();project.destroy();
  const THREE=await import('/lib/three.webgpu.js'),{createLocalSceneVisibility}=await import('/scene-local-visibility.mjs');
  const scene=new THREE.Scene(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());mesh.castShadow=true;scene.add(mesh);
  const second=mesh.clone();scene.add(second);second.position.set(-2,1,3);
  const local=createLocalSceneVisibility(),initial=local.snapshot(scene),forest=initial.geometry;
  const fn=make(forest.nodes),ft=make(forest.triangles),fp=createBvhReproject(device,{geometry:forest,nodes:fn,triangles:ft});
  const checkPose=async()=>{
    const snapshot=local.snapshot(scene);if(snapshot.geometry!==forest||snapshot.localBuilds!==1)throw Error('transform rebuilt local geometry');
    const enc=device.createCommandEncoder();fp.encode(enc,{translate:[2,-2,4],scale:2},snapshot.geometry.matrices);
    const rb=device.createBuffer({size:forest.nodes.byteLength+forest.triangles.byteLength,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    enc.copyBufferToBuffer(fn,0,rb,0,forest.nodes.byteLength);enc.copyBufferToBuffer(ft,0,rb,forest.nodes.byteLength,forest.triangles.byteLength);device.queue.submit([enc.finish()]);fp.commit();await rb.mapAsync(GPUMapMode.READ);
    const raw=rb.getMappedRange(),floats=new Float32Array(raw),uints=new Uint32Array(raw),localWords=new Uint32Array(forest.nodes.buffer),meshes=[mesh,second];
    const near=(a,b)=>{if(!Number.isFinite(a)||Math.abs(a-b)>2e-5*Math.max(1,Math.abs(b)))throw Error('transformed forest value mismatch '+JSON.stringify({a,b}));};
    for(let n=0;n<forest.nodeCount;n++){
      for(let j=8;j<12;j++)if(uints[n*12+j]!==localWords[n*12+j])throw Error('forest topology corrupted');
      const box=new THREE.Box3(new THREE.Vector3(...forest.nodes.slice(n*12,n*12+3)),new THREE.Vector3(...forest.nodes.slice(n*12+4,n*12+7))).applyMatrix4(meshes[forest.owners[n]].matrixWorld);
      [box.min,box.max].forEach((p,k)=>p.sub(new THREE.Vector3(2,-2,4)).divideScalar(2).toArray().forEach((v,j)=>near(floats[n*12+k*4+j],v)));
    }
    for(let t=0;t<forest.triangleCount;t++)for(let v=0;v<3;v++){
      const xyz=new THREE.Vector4(...forest.triangles.slice(t*12+v*4,t*12+v*4+3),v===0?1:0).applyMatrix4(meshes[forest.owners[forest.nodeCount+t]].matrixWorld);
      [xyz.x,xyz.y,xyz.z].map((x,j)=>(x-(v===0?[2,-2,4][j]:0))/2).forEach((x,j)=>near(floats[forest.nodes.length+t*12+v*4+j],x));
    }
    rb.destroy();return {nodes:forest.nodeCount,triangles:forest.triangleCount,localBuilds:snapshot.localBuilds};
  };
  await checkPose();mesh.position.set(1,2,-1);mesh.rotation.set(.4,.6,-.2);mesh.scale.set(-2,.5,1.5);second.rotation.set(.3,0,.8);second.scale.set(1,2,.75);
  const transformedForest=await checkPose();fn.destroy();ft.destroy();fp.destroy();
  const error=await device.popErrorScope();if(error)throw Error(error.message);device.destroy();
  return {adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description},actual,expected,triangle,transformedForest,validationErrors:0};
 });await write();
 const route=url=>{const u=new URL(url),h=new URLSearchParams(u.hash.slice(1));for(const[k,v]of Object.entries({volume_light_field_hybrid:'1',hybrid_smoke_refinement:String(smokeRefinement),rendering_angular_pattern:'guided',rendering_directions:'8',rendering_match_camera:'1'}))h.set(k,v);u.hash=h.toString();return u.href;};
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
  assert.equal(before.lighting.frame.smokeReconstruction.refinement,smokeRefinement,'requested smoke refinement must actually apply');
  const shot=await retain({name:'hybrid',observe});report.phase='source-movement';await write();
  const flame=document.objects.find(o=>o.id==='flame-emitter'),position=[...flame.transform.position];position[0]+=.04;
  await page.evaluate(({id,position})=>window.kaminosSetSceneObjectTransform(id,{position}),{id:flame.id,position});
  await page.waitForFunction(generation=>window.__kaminosSceneRadiance?.debugState().frame?.generation>generation+5,before.lighting.frame.generation,{timeout:0});await settle();
  const moved=await observe();assert.equal(moved.lighting.geometryBuilds,before.lighting.geometryBuilds,'moving emitter must not rebuild CPU BVH');
  assert.deepEqual(moved.objects.find(o=>o.id===flame.id).transform.position,position,'actual authored emitter must move');
  assert.equal(moved.lighting.frame.pointRegions.generation,moved.lighting.frame.generation,'surface source must remain current after movement');
  await retain({name:'hybrid-moved',observe});
  report.phase='solid-movement';await write();
  const solid=document.objects.find(o=>o.id.startsWith('glb-'));assert.ok(solid,'registered mesh required');
  const solidMoves=[];
  await page.evaluate(()=>window.__kaminosSceneRadiance.setEditing('gizmo',true));
  for(let i=1;i<=3;i++){
    const transform={position:solid.transform.position.map((v,j)=>v+(j===0?i*.08:0)),rotation:solid.transform.rotation.map((v,j)=>v+(j===1?i*.12:0)),scale:solid.transform.scale.map((v,j)=>v*(j===0?1+i*.04:1))};
    const begin=performance.now();const update=await page.evaluate(({id,transform})=>{const t=performance.now();window.kaminosSetSceneObjectTransform(id,transform);return {setterMs:performance.now()-t,generation:window.__kaminosSceneRadiance.debugState().frame.generation};},{id:solid.id,transform});
    await page.waitForFunction(g=>window.__kaminosSceneRadiance?.debugState().frame?.generation>g,update.generation,{timeout:0});await settle();
    const observed=await observe();assert.equal(observed.lighting.geometryBuilds,before.lighting.geometryBuilds,'solid movement rebuilt CPU visibility');
    assert.deepEqual(observed.objects.find(o=>o.id===solid.id).transform.position,transform.position);
    assert.ok(observed.lighting.frame.angularCache.visibilityPreparations>before.lighting.frame.angularCache.visibilityPreparations,'solid movement left visibility stale');
    solidMoves.push({transform,update,elapsedMs:performance.now()-begin,lighting:observed.lighting});
  }
  await page.evaluate(()=>window.__kaminosSceneRadiance.setEditing('gizmo',false));
  await retain({name:'hybrid-solid-moved',observe});
  await page.evaluate(({id,transform})=>window.kaminosSetSceneObjectTransform(id,transform),{id:solid.id,transform:solid.transform});await settle();
  await page.evaluate(({id,position})=>window.kaminosSetSceneObjectTransform(id,{position}),{id:flame.id,position:flame.transform.position});await settle();
  const handoff=route(shot.url);await page.goto('about:blank');await page.goto(handoff);await settle();
  assertMountedScene(shot.document,await page.evaluate(()=>window.kaminosSceneObjectDebugState()));
  const reopened=await observe();assert.equal(reopened.lighting.surfaceReceivers,0);
  return {url:handoff,filename:shot.filename,before,moved,solidMoves,reopened};
 }});
 report.result=result.result;assert.deepEqual(report.errors,[]);report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
finally{await browser?.close();report.finishedAt=new Date().toISOString();await write();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,url:report.result?.url}));}
