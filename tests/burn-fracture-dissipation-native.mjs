// kaminos-test: node
import assert from 'node:assert/strict';
import {createBurnFractureDissipationGpu,BURN_DISSIPATION_WGSL} from '../burn-fracture-dissipation-gpu.mjs';
import {withKaminosGpu,withGpuErrorScopes} from '../tools/shader-herder.mjs';

const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const rotate=(q,v)=>{const c=cross(q,v),d=cross(q,c.map((x,k)=>x+q[3]*v[k]));return v.map((x,k)=>x+2*d[k]);};
const near=(a,b,why)=>a.forEach((x,k)=>assert.ok(Math.abs(x-b[k])<2e-5*Math.max(1,Math.abs(x),Math.abs(b[k])),`${why}: ${a} != ${b}`));
await withKaminosGpu(async ({device})=>withGpuErrorScopes(device,'burn-joint-dissipation',async()=>{
 const owned=[];
 const buffer=data=>{const b=device.createBuffer({size:Math.max(16,data.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});owned.push(b);device.queue.writeBuffer(b,0,data);return b;};
 const read=async buffers=>{
  const bytes=buffers.reduce((s,b)=>s+b.size,0),b=device.createBuffer({size:bytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{const e=device.createCommandEncoder();let offset=0;for(const src of buffers){e.copyBufferToBuffer(src,0,b,offset,src.size);offset+=src.size;}device.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const data=new Float32Array(b.getMappedRange().slice(0));return buffers.map((src,i)=>data.slice(buffers.slice(0,i).reduce((s,b)=>s+b.size/4,0),buffers.slice(0,i+1).reduce((s,b)=>s+b.size/4,0)));}
  finally{b.unmap();b.destroy();}
 };
 async function exercise({points,masses,linear,angular,edges,quats,dt=1/60,ratio=.7}){
  const n=points.length,ps=new Float32Array(n*4),qs=new Float32Array(n*4),ii=new Float32Array(n*4),vs=new Float32Array(n*4),ws=new Float32Array(n*4),js=new Float32Array(edges.length*44),words=new Uint32Array(js.buffer);
  points.forEach((p,i)=>{ps.set([...p,masses[i]>0?1/masses[i]:0],i*4);qs.set(quats?.[i]??[0,0,0,1],i*4);ii.set(masses[i]>0?[1/masses[i],2/masses[i],3/masses[i],0]:[0,0,0,0],i*4);vs.set([...linear[i],0],i*4);ws.set([...angular[i],0],i*4);});
  edges.forEach(([a,b,active=1],i)=>{words.set([a,b,1,active],i*44);js.set([...points[b].map((x,k)=>(x-points[a][k])/2),1],i*44+4);js.set([...points[a].map((x,k)=>(x-points[b][k])/2),0],i*44+8);js.set([1e4,1e4,0,0],i*44+16);});
  const positions=buffer(ps),rotations=buffer(qs),inertia=buffer(ii),velocities=buffer(vs),angularVelocities=buffer(ws),joints=buffer(js);
  const stage=await createBurnFractureDissipationGpu({device,positions,rotations,inertia,velocities,angularVelocities,joints,initialJoints:js,bodies:n,bonds:edges.length,timeStep:dt,ratio});
  try{const e=device.createCommandEncoder();stage.encode(e);device.queue.submit([e.finish()]);const [v,w]=await read([velocities,angularVelocities]);return {v,w,initialV:vs,initialW:ws,ps,qs,ii};}
  finally{stage.dispose();stage.dispose();assert.throws(()=>stage.encode(device.createCommandEncoder()),/disposed/);}
 }
 const energy=(f,masses,points)=>{
  let e=0;const p=[0,0,0],l=[0,0,0];masses.forEach((m,i)=>{if(!m)return;const v=Array.from(f.v.slice(i*4,i*4+3)),w=Array.from(f.w.slice(i*4,i*4+3)),q=Array.from(f.qs.slice(i*4,i*4+4));
   const local=rotate([-q[0],-q[1],-q[2],q[3]],w),spin=rotate(q,local.map((x,k)=>x/f.ii[i*4+k])),mv=v.map(x=>x*m),orbital=cross(points[i],mv);
   e+=m*v.reduce((s,x)=>s+x*x,0)/2+local.reduce((s,x,k)=>s+x*x/f.ii[i*4+k],0)/2;for(let k=0;k<3;k++){p[k]+=mv[k];l[k]+=spin[k]+orbital[k];}
  });return {e,p,l};
 };
 try{
  const points=[[-.5,0,0],[.5,0,0]],masses=[1,1],edges=[[0,1]],angular=[[0,0,0],[0,0,0]];
  const stretch=await exercise({points,masses,edges,linear:[[1,0,0],[-1,0,0]],angular});
  assert.ok(Math.abs(stretch.v[0]-stretch.v[4])<1,'Active material must dissipate opposing strain velocity, not retain the undamped value 2');
  near([stretch.v[0]-stretch.v[4]],[2*Math.exp(-2*.7*Math.sqrt(2e4)/60)],'A single axial pair follows the timestep-scaled exponential damping law');
  const halfStep=await exercise({points,masses,edges,linear:[[1,0,0],[-1,0,0]],angular,dt:1/120});
  near([(halfStep.v[0]-halfStep.v[4])**2/2],[stretch.v[0]-stretch.v[4]],'Two half damping intervals equal one full interval for an isolated axial mode');
  const translation=await exercise({points,masses,edges,linear:[[1,-3,2],[1,-3,2]],angular});near(Array.from(translation.v),Array.from(translation.initialV),'Uniform freefall/translation must be unaffected');
  const rigid=await exercise({points,masses,edges,linear:[[1,-1,2],[1,1,2]],angular:[[0,0,2],[0,0,2]]});near(Array.from(rigid.v),Array.from(rigid.initialV),'Rigid-body rotation must not be damped');near(Array.from(rigid.w),Array.from(rigid.initialW),'Rigid angular motion must not be damped');
  for(const options of [{edges:[[0,1,0]]},{ratio:0},{dt:0}]){
   const f=await exercise({points,masses,edges,linear:[[1,2,3],[-3,-2,-1]],angular:[[2,1,0],[-1,0,1]],...options});near(Array.from(f.v),Array.from(f.initialV),'Disabled dissipation must not alter translation');near(Array.from(f.w),Array.from(f.initialW),'Disabled dissipation must not alter rotation');
  }
  const starPoints=[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],starMasses=[1,2,3,4];
  const star=await exercise({points:starPoints,masses:starMasses,edges:[[0,1],[0,2],[0,3]],quats:[[0,0,0,1],[Math.SQRT1_2,0,0,Math.SQRT1_2],[0,Math.SQRT1_2,0,Math.SQRT1_2],[0,0,Math.SQRT1_2,Math.SQRT1_2]],linear:[[3,2,1],[-1,2,3],[1,-2,-3],[2,1,-3]],angular:[[1,2,3],[2,-1,3],[-2,3,-1],[3,1,-2]]});
  const before=energy({...star,v:star.initialV,w:star.initialW},starMasses,starPoints),after=energy(star,starMasses,starPoints);
  assert.ok(after.e<before.e,'Concurrent adjacent bonds must remove, never add, kinetic energy');near(after.p,before.p,'Internal dissipation conserves linear momentum');near(after.l,before.l,'Internal dissipation conserves total angular momentum');
  const anchor=await exercise({points,masses:[0,1],edges,linear:[[0,0,0],[1,2,3]],angular:[[0,0,0],[1,2,3]]});near(Array.from(anchor.v.slice(0,4)),[0,0,0,0],'Static support must not move');assert.ok(Math.hypot(...anchor.v.slice(4,7))<Math.sqrt(14));
 }finally{owned.forEach(b=>b.destroy());}
}),{wgslSources:['pairs','gather'].map(entryPoint=>({label:'burn-joint-dissipation-'+entryPoint,code:BURN_DISSIPATION_WGSL,entryPoint}))});
