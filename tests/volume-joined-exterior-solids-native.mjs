// kaminos-test: manual — small native Metal consumer conformance, no timing claim
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import * as THREE from '../lib/three.core.js';
import {createJoinedExterior} from '../volume-joined-exterior.mjs';
import {createSceneSolidGeometryCache} from '../volume-scene-solid.mjs';
const [dawnPath,out]=process.argv.slice(2);assert(dawnPath&&out);mkdirSync(out,{recursive:true});
const report={status:'running',phase:'adapter',cases:[],source:{root:resolve(import.meta.dirname,'..'),revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files:{}}};
for(const f of ['volume-joined-exterior.mjs','volume-outer-smoke.mjs','scene-solid-gpu.mjs','tests/volume-joined-exterior-solids-native.mjs'])report.source.files[f]=createHash('sha256').update(readFileSync(new URL('../'+f,import.meta.url))).digest('hex');
const save=()=>writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));save();
let device,joined;const resources=[];
try{
 const {create,globals}=await import(pathToFileURL(resolve(dawnPath)));Object.assign(globalThis,globals);
 const gpu=create(['backend=metal']),adapter=await gpu.requestAdapter();assert(adapter);device=await adapter.requestDevice();
 report.route={backend:'metal',vendor:adapter.info.vendor,architecture:adapter.info.architecture,dawnPath};
 const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
 const texture=(size,format,dimension='3d')=>{const t=device.createTexture({size,format,dimension,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_DST});resources.push(t);return t;};
 const fluids=[0,1].map(()=>{const b=device.createBuffer({size:8**3*16*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});resources.push(b);return b;});
 const mesh=new THREE.Mesh(new THREE.TorusGeometry(1,.3,8,24));mesh.rotation.x=Math.PI/2;mesh.position.y=2.5;
 const objects=[{id:'annular-obstacle',object:mesh}],transform={translate:[0,0,0],scale:1};
 const p={dims:[8,8,8],pitch:.25,allocation:1,fluidBuffers:fluids,fluidBuffer:fluids[0],fluidReadIndex:0,
   lowerFaceTexture:texture([8,8,3],'r32float','2d'),burnRateTexture:texture([8,8,8],'r32float'),
   solidMask:{cells:new Uint8Array(512),revision:'empty-fine'},sceneSolids:{objects,transform,revision:'pose-0'},
   timeStep:{dtScale:1,backtraceScale:1},ghosts:{textures:{a:texture([9,17,9],'rgba32float'),b:texture([9,17,9],'rgba32float')}}};
 joined=createJoinedExterior(device,{coarseResolution:8,size:2,budget:32,residentSolids:true});
 const reference=createSceneSolidGeometryCache();let first,previous;
 for(let pose=0;pose<2;pose++){
  report.phase='pose-'+pose;save();mesh.position.x=pose*.75;p.sceneSolids.revision='pose-'+pose;
  const prepared=joined.prepare(p);assert.equal(prepared.admitted,true,prepared.reason);
  first??=joined.receipt();assert.equal(joined.receipt().generation,first.generation);assert.equal(joined.receipt().topologyGeneration,first.topologyGeneration);
  const sampled=await joined.sampleSceneSolids();assert.equal(sampled.status,'sampled');assert.equal(sampled.valid,true);
  const expected=reference.update(objects,{translate:[0,0,0],scale:2},{grid:8,gridHeight:16}).field.cells;
  assert.deepEqual(sampled.cells,expected,'current authored coarse mask must match independent CPU voxelization');
  assert.ok(sampled.cells.some(Boolean));if(previous)assert.notDeepEqual(sampled.cells,previous,'motion must change installed occupancy');previous=sampled.cells;
  writeFileSync(resolve(out,`pose-${pose}-occupancy.u8`),sampled.cells);
  const encoder=device.createCommandEncoder();assert.equal(joined.step(encoder,p).stepped,true);device.queue.submit([encoder.finish()]);
  const stats=await joined.stats();assert.ok(stats.values.every(Number.isFinite));assert.deepEqual(errors,[]);
  report.cases.push({pose,solidCells:sampled.counts[0],scene:sampled.scene,receipt:joined.receipt()});save();
 }
 report.phase='removal';p.sceneSolids={objects:[],transform,revision:'removed'};assert.equal(joined.prepare(p).admitted,true);
 assert.equal((await joined.sampleSceneSolids()).status,'not-scene-gpu');
 const encoder=device.createCommandEncoder();assert.equal(joined.step(encoder,p).stepped,true);device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();assert.deepEqual(errors,[]);
 assert.equal(joined.receipt().generation,first.generation);report.removal=joined.receipt();report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{await device?.queue.onSubmittedWorkDone().catch(()=>{});joined?.destroy();for(const r of resources)r.destroy();device?.destroy();save();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error}));}
