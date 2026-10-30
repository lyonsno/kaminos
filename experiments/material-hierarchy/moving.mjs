import {createWorldSmoke,worldSmokePlan} from '../../volume-world-smoke.mjs';
import {resolveReactantCombustionConfig} from '../../volume-reactant-combustion.mjs';

// A small native transport check. Seed a detached burning pocket and a uniform
// velocity, then let the production flow/material kernels and feedback run.
// The buffer interception only sets initial conditions; it replaces no kernel.
export async function movingPocket(device,fine,reaction){
 const flows=[];
 const observedDevice=new Proxy(device,{get(target,key){
  if(key==='createBuffer')return descriptor=>{const buffer=target.createBuffer(descriptor);if(/^world smoke flow [01]$/.test(descriptor.label))flows.push(buffer);return buffer;};
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
 const plan=worldSmokePlan({flow:8,material:16,pressure:4,extent:3,fineHeightRatio:1});
 const world=createWorldSmoke(observedDevice,plan,{translate:[0,0,0],scale:1});
 const result={plan,frames:[],initialVelocity:[plan.materialPitch/2,0,0],time:{dtScale:.125,backtraceScale:1},source:'detached initial material; Fine donor outside world',pressureIterations:0};
 try{
  if(flows.length!==2)throw Error('Native initial flow buffers were not observed');
  const velocity=new Float32Array(plan.flowCells*4);for(let i=0;i<plan.flowCells;i++)velocity[i*4]=result.initialVelocity[0];
  for(const b of flows)device.queue.writeBuffer(b,0,velocity);
  const seed=new Float32Array(plan.materialCells*8);for(let i=3;i<seed.length;i+=8)seed[i]=1;
  for(let z=6;z<8;z++)for(let y=10;y<12;y++)for(let x=2;x<4;x++){
   const i=(x+16*(y+32*z))*8;seed.set([.2,.6,.2,1,0,.2*.6,.2*.6**2,.2*.6**3],i);
  }
  for(const b of world.materialResources().buffers)device.queue.writeBuffer(b,0,seed);
  const reactant=resolveReactantCombustionConfig({reactionLaw:'reactant-v0',emitterSourceLaw:'immersed-source'},{grid:4,dt:.125});
  if(!reactant.effective.admitted)throw Error('Moving-pocket chemistry was not admitted');
  result.reactant=reactant;
  world.configureAdaptiveMaterial({budget:.5,maxDetail:1,persistence:.1,lookahead:1,weights:{reaction:1,mixing:0,thermal:0,smoke:0}});
  // Two stationary startup steps expose the source refinement before travel.
  for(let step=0;step<18;step++){
   const encoder=device.createCommandEncoder();world.encode(encoder,{fineBuffer:fine,reactionTexture:reaction,fineDims:[4,4,4],transform:{translate:[100,100,100],scale:1},time:{...result.time,backtraceScale:step<2?0:1},reactant,iterations:0,buoyancy:0});
   device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();await new Promise(r=>setTimeout(r,0));
   result.frames.push({step,state:world.adaptiveMaterialState(),snapshot:await world.adaptiveMaterialSnapshot()});
  }
  return result;
 }finally{world.destroy();}
}
