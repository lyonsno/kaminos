// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createMlsJuiceSolver} from '../mls-juice-solver.mjs';
import {withKaminosGpu} from '../tools/shader-herder.mjs';

const wall=(axis=0)=>({id:'wall-'+axis,type:'procedural-mesh',geometry:{kind:'box',parameters:{width:axis===0?8:40,height:40,depth:axis===2?8:40}},transform:{position:axis===0?[4,12,12]:[12,12,4],rotation:[0,0,0],scale:[1,1,1]}});
// Eight equal quadrature masses per grid cell give uniform density8. Confined
// half-spaces and their intersections have an independently known uniform fill.
// Execute the complete production solver, not a second density implementation.
async function run(device,{corner=false,rotated=false,copies=1,colliders=[wall()],fault=false,checkEdits=false}={}){
 if(rotated){const n=Math.SQRT1_2;colliders=[{...wall(),geometry:{kind:'box',parameters:{width:8,height:40,depth:80}},transform:{position:[8.05-4*n,12,8.05-4*n],rotation:[0,-Math.PI/4,0],scale:[1,1,1]}}];}
 const positions=[];
 for(let x=rotated?4:8;x<(rotated?20:18);x++)for(let y=6;y<18;y++)for(let z=rotated?4:corner?8:6;z<(rotated?20:18);z++)for(let n=0;n<copies;n++)for(let a=0;a<2;a++)for(let b=0;b<2;b++)for(let c=0;c<2;c++){const p=[x+.25+a*.5,y+.25+b*.5,z+.25+c*.5];if(!rotated||p[0]+p[2]>16.1)positions.push(p);}
 const initial=new Float32Array(positions.length*20);positions.forEach((p,i)=>{initial.set(p,i*20);initial[i*20+3]=100;});
 const setup={particleCount:positions.length,gridSize:24,cellSize:1,originWorld:[0,0,0],boundaryWalls:false,obstacle:null,trackPopulation:false,mlsMaterial:{pressureWaveSpeed:0,kinematicViscosity:0}};
 const captured=new Map();let buffers=0,pipelines=0;
 const proxy=new Proxy(device,{get(target,key){
  if(key==='createBuffer')return options=>{buffers++;const b=target.createBuffer({...options,usage:options.label==='MLS density'?options.usage|GPUBufferUsage.COPY_SRC:options.usage});captured.set(options.label,b);return b;};
  // Valid-WGSL fault control: turning off the actual correction must make the
  // numerical oracle reject the result. A compilation failure cannot pass it.
  if(key==='createShaderModule')return options=>target.createShaderModule({...options,code:fault&&options.label==='MLS p2g_2'?options.code.replace('density/=availableFluid;','density*=1.;'):options.code});
  if(key==='createComputePipelineAsync')return options=>{pipelines++;return target.createComputePipelineAsync(options);};
  const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;
 }});
 const solver=await createMlsJuiceSolver({device:proxy,setup,packet:{authority:{simulation_safe:false},emitters:[]},initialParticles:initial,sceneColliders:colliders,now:()=>0});
 const readback=device.createBuffer({size:positions.length*4,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
 async function densities(){
  const e=device.createCommandEncoder();e.copyBufferToBuffer(captured.get('MLS density'),0,readback,0,positions.length*4);device.queue.submit([e.finish()]);await readback.mapAsync(GPUMapMode.READ);
  const density=new Float32Array(readback.getMappedRange()).slice();readback.unmap();
  const at=(x,y,z)=>density[positions.findIndex(p=>p[0]===x&&p[1]===y&&p[2]===z)];
  return {bulk:at(rotated?14.25:12.25,12.25,rotated?14.25:12.25),boundary:at(8.25,12.25,corner||rotated?8.25:12.25),free:at(rotated?19.75:17.75,12.25,rotated?14.25:12.25)};
 }
 try{
  await solver.advanceTo(1);const values=await densities();console.log(JSON.stringify({corner,rotated,copies,colliders:colliders?.length??null,fault,...values}));
  if(checkEdits){
   assert.equal(solver.read().densityBoundary.generation,1);
   const allocations={buffers,pipelines};device.queue.writeBuffer(solver.particles,0,initial);await solver.advanceTo(2);
   assert.equal(solver.read().densityBoundary.generation,1,'unchanged geometry reuses its capacity grid');
   solver.setSceneColliders([{...wall(),waterCollision:false}]);
   assert.equal(solver.read().densityBoundary.pending,true);
   device.queue.writeBuffer(solver.particles,0,initial);await solver.advanceTo(3);assert.equal(solver.read().densityBoundary.generation,2);
   assert.deepEqual({buffers,pipelines},allocations,'contact edits reuse allocations and pipelines');
   const disabled=await densities();assert.ok(Math.abs(disabled.boundary-disabled.free)<1e-6&&disabled.boundary<disabled.bulk*.85,'disabled wall ceases density completion as well as contact');
  }
  return values;
 }finally{readback.destroy();solver.dispose();}
}
const uniform=(values,copies=1)=>{
 assert.ok(Math.abs(values.bulk-copies*8)<1e-4,'uniform bulk calibration');
 assert.ok(Math.abs(values.boundary-values.bulk)<1e-4,`solid wall must not appear as missing water: wall=${values.boundary}, bulk=${values.bulk}`);
 assert.ok(values.free<values.bulk*.85,'empty free surface must retain its density deficit');
};
const saved=globalThis.fetch;globalThis.fetch=async url=>({ok:true,text:()=>fs.readFile(url,'utf8')});
try{await withKaminosGpu(async({device})=>{
 uniform(await run(device,{checkEdits:true}));
 uniform(await run(device,{corner:true,colliders:[wall(),wall(2)]}));
 uniform(await run(device,{rotated:true}));
 uniform(await run(device,{copies:2}),2);
 const open=await run(device,{colliders:[]});assert.equal(open.boundary,open.free);assert.ok(open.boundary<8*.85);
 const unbounded=await run(device,{colliders:null});assert.deepEqual(unbounded,open,'no-solid and unbounded pressure estimates agree');
 const bad=await run(device,{fault:true});assert.throws(()=>uniform(bad),/solid wall must not appear/);
});}finally{globalThis.fetch=saved;}
