// Read-only scene census + existing timing hooks. Never saves or changes a scene/preset.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chromium} from '/Users/noahlyons/.npm/_npx/420ff84f11983ee5/node_modules/playwright/index.mjs';
import {verifyAuthoringServer} from '../../scene-authoring-witness-identity.mjs';
import {compositionRestoreUrl} from '../../scene-authoring.mjs';
import {geometryBudget} from './geometry.mjs';
const [output,origin,sceneName,frameArg='240',pitchArg='0.1,0.2,0.4']=process.argv.slice(2);
assert.ok(output&&origin&&sceneName,'usage: measure.mjs OUTPUT ORIGIN SCENE [FRAMES] [PITCHES]');
const frames=Number(frameArg),pitches=pitchArg.split(',').map(Number);
assert.ok(Number.isInteger(frames)&&frames>0);
const out=path.resolve(output),sha=b=>createHash('sha256').update(b).digest('hex');
const report={status:'running',phase:'identity',origin,sceneName,frames,pitches,errors:[],limitations:[
 'Timing is short-run foreground live-fluid observation, not sustained or exclusive-GPU performance.',
 'Existing profile covers Three render work and a separate irradiance compute replay, not the full live-fluid GPU frame. No total spare GPU milliseconds claim.',
 'Geometry counts are planning estimates, not constructed transport, placement quality, or bounce pixels.'
]};
await fs.mkdir(out,{recursive:true});
const write=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await write();
let browser,lease;
const gr='/private/tmp/gpu-greenroom-beaming-shadow-compose-policy-0917/.venv/bin/gpu-greenroom';
try{
 report.serving=await verifyAuthoringServer({origin,repoRoot:process.cwd()});
 report.driverSha256=sha(await fs.readFile(new URL(import.meta.url)));
 const source=await (await fetch(origin+'/index.html')).text();
 assert.equal(sha(source),sha(await fs.readFile('index.html')));
 const anchor='  window.kaminosFireLightFieldGpuProfile = async () => {';
 assert.equal(source.split(anchor).length,2,'instrumentation anchor must be unique');
 const instrumented=source.replace(anchor,'  window.__bounceCensus = {scene,renderer,THREE};\n'+anchor);
 report.instrumentation={kind:'browser response injection exposes existing scene handles only',originalSha256:sha(source),effectiveSha256:sha(instrumented)};
 await fs.writeFile(path.join(out,'effective-index.html'),instrumented);
 const response=await fetch(`${origin}/api/read?root=scenes&path=${encodeURIComponent(sceneName)}`);assert.ok(response.ok);
 const bytes=Buffer.from(await response.arrayBuffer()),scene=JSON.parse(bytes);
 report.sceneSha256=sha(bytes);await fs.writeFile(path.join(out,'scene.kaminos.json'),bytes);
 report.assets=[];
 for(const object of scene.objects){const r=await fetch(new URL(object.source,origin));assert.ok(r.ok);report.assets.push({source:object.source,sha256:sha(Buffer.from(await r.arrayBuffer())),transform:object.transform});}
 const url=compositionRestoreUrl(scene.composition,sceneName,origin)+'&volume_light_field_shadows=1&volume_light_field_timing=1';report.requested=url;
 report.phase='lease';await write();
 const claim=JSON.parse(execFileSync(gr,['lease','claim','--owner','beaming-frustum-fluffer','--agent-id','kiln-bounce-decision-census','--repo-root',process.cwd(),'--pid',String(process.pid),'--effective-route',url,'--backend','webgpu','--device','apple-gpu','--profile','browser-smoke','--supports-checkpoints','--ttl-seconds','3600'],{encoding:'utf8'}));
 assert.ok(claim.lease_id);lease=claim.lease_id;report.lease=claim;
 browser=await chromium.launch({channel:'chrome',headless:false,args:['--enable-unsafe-webgpu','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 const page=await browser.newPage({viewport:{width:1600,height:1150},deviceScaleFactor:1});
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.origin===origin&&(u.pathname==='/'||u.pathname==='/index.html'))return route.fulfill({status:200,contentType:'text/html',body:instrumented});
   return route.continue();
 });
 report.phase='load';await write();await page.goto(url);
 await page.waitForFunction(()=>window.__bounceCensus&&window.kaminosSceneObjectDebugState?.().length===1&&window.__kaminosVolumePrototype?.debugState().active&&window.kaminosBurnerState?.().effective);
 const state=()=>page.evaluate(()=>({href:location.href,objects:window.kaminosSceneObjectDebugState(),burner:window.kaminosBurnerState(),fire:window.__kaminosVolumePrototype.debugState(),receiver:window.kaminosFireLightFieldDebugState(),camera:window.kaminosCameraDebugState(),ao:window.kaminosAODebugState()}));
 report.loaded=await state();
 assert.equal(report.loaded.objects[0].source,scene.objects[0].source);assert.deepEqual(report.loaded.objects[0].transform,scene.objects[0].transform);
 assert.deepEqual(report.loaded.burner.recipe,scene.composition.burner);
 await page.waitForFunction(n=>window.__kaminosVolumePrototype.debugState().frameCount>n+150,report.loaded.fire.frameCount);
 await page.evaluate(()=>window.setGizmoMode(null));
 report.phase='timing';report.beforeTiming=await state();await write();
 report.frameIntervalsMs=await page.evaluate(count=>new Promise(resolve=>{
  const samples=[];let previous;function tick(t){if(previous!==undefined)samples.push(t-previous);previous=t;if(samples.length===count)resolve(samples);else requestAnimationFrame(tick);}requestAnimationFrame(tick);
 }),frames);
 report.afterTiming=await state();
 assert.ok(report.afterTiming.fire.frameCount>report.beforeTiming.fire.frameCount,'live frame count did not advance');
 assert.equal(report.afterTiming.receiver.shadow.effective,true);assert.equal(report.afterTiming.fire.ordinarySceneDepth.effective,true);
 report.gpuProfiles=[];
 // Five explicit exploratory repeats retain all returned stages; not a confidence bound.
 for(let i=0;i<5;i++)report.gpuProfiles.push(await page.evaluate(()=>window.kaminosFireLightFieldGpuProfile()));
 report.phase='geometry';await write();
 const geometry=await page.evaluate(()=>{
  const {scene,THREE}=window.__bounceCensus;scene.updateMatrixWorld(true);
  const values=[],meshes=[];const v=new THREE.Vector3();
  scene.traverseVisible(o=>{
   if(!o.isMesh||!o.castShadow)return;
   if(o.isInstancedMesh||o.isSkinnedMesh)throw Error('census requires ordinary static meshes');
   const g=o.geometry,p=g.attributes.position,index=g.index;
   const start=g.drawRange.start,end=Math.min(index?.count??p.count,start+g.drawRange.count),offset=values.length;
   if(start%3||(end-start)%3)throw Error('non-triangle draw range');
   for(let i=start;i<end;i++){v.fromBufferAttribute(p,index?index.getX(i):i).applyMatrix4(o.matrixWorld);values.push(v.x,v.y,v.z);}
   meshes.push({name:o.name,uuid:o.uuid,floatOffset:offset,floatCount:values.length-offset,matrixWorld:o.matrixWorld.toArray(),groups:g.groups,
    materials:(Array.isArray(o.material)?o.material:[o.material]).map(m=>({type:m.type,side:m.side,opacity:m.opacity,metalness:m.metalness,roughness:m.roughness,color:m.color?.toArray(),map:!!m.map,mapColorSpace:m.map?.colorSpace,mapSize:m.map?.image?{width:m.map.image.width,height:m.map.image.height}:null}))});
  });
  const floats=new Float32Array(values),bytes=new Uint8Array(floats.buffer);let s='';
  for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return {meshes,positionsBase64:btoa(s)};
 });
 const positions=Buffer.from(geometry.positionsBase64,'base64');delete geometry.positionsBase64;
 await fs.writeFile(path.join(out,'world-triangles.f32'),positions);
 report.geometry={...geometry,positionsSha256:sha(positions),format:'float32 little-endian xyz per triangle, world-space, every declared visible static caster'};
 report.geometryBudget=geometryBudget(new Float32Array(positions.buffer,positions.byteOffset,positions.byteLength/4),pitches);
 report.phase='capture';await write();
 const capture=await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>{
  const mesh=document.getElementById('kaminos-host-renderer-canvas'),vol=document.getElementById('kaminos-volume-canvas');
  const c=document.createElement('canvas');c.width=mesh.width;c.height=mesh.height;const ctx=c.getContext('2d');ctx.drawImage(mesh,0,0);ctx.drawImage(vol,0,0,c.width,c.height);resolve(c.toDataURL());
 })));
 await fs.writeFile(path.join(out,'baseline.png'),Buffer.from(capture.split(',')[1],'base64'));
 report.final=await state();assert.deepEqual(report.final.objects,report.loaded.objects);assert.deepEqual(report.final.burner.recipe,report.loaded.burner.recipe);
 assert.deepEqual(report.errors,[]);report.phase='complete';report.status='complete';
}catch(e){report.status='failed';report.error=e.stack;process.exitCode=1;}
finally{await browser?.close();if(lease)report.release=JSON.parse(execFileSync(gr,['lease','release',lease,'--released-by','beaming-frustum-fluffer','--reason','decision census complete; own Chrome closed'],{encoding:'utf8'}));await write();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,report:path.join(out,'report.json')}));}
