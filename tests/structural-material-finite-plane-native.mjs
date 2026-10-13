import {buildFixedCellShell,applyFixedCellShell} from '../structural-material-bounded-fragments.mjs';
import {projectFinitePlane} from '../structural-material-finite-plane.mjs';
import {createFinitePlaneContact} from '../structural-material-finite-plane-gpu.js';
export async function finitePlaneNativeConformance(){
 const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter||adapter.info.isFallbackAdapter)throw Error('Native WebGPU required');const device=await adapter.requestDevice(),owned=[];
 try{
  const positions=[[0,1,0],[1,1,0],[0,2,0],[0,1,1]],edges=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]],bonds=mask=>edges.flatMap(([a,b],i)=>[a,b,Number(!(mask&(1<<i))),0]),shell=buildFixedCellShell({positions,tetrahedra:[[0,1,2,3]],bonds:bonds(0)}),stateBuffer=device.createBuffer({size:256,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC}),bondBuffer=device.createBuffer({size:96,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),read=device.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});owned.push(stateBuffer,bondBuffer,read);
  const contact=await createFinitePlaneContact({device,stateBuffer:()=>stateBuffer,bondBuffer:()=>bondBuffer},shell.binding);owned.push({destroy:()=>contact.dispose()});let maxError=0,minGap=Infinity,cases=0;
  for(const normal of [[0,1,0],[0,Math.SQRT1_2,Math.SQRT1_2]])for(let mask=0;mask<64;mask++){
   const state={positions:positions.map((p,i)=>p.map((v,k)=>Math.fround(v-normal[k]*(2+i/10)))),velocities:positions.map(()=>normal.map(v=>Math.fround(-v*2))),pinned:positions.map(()=>false)},plane={normal,offset:.2,friction:.65,restitution:.08},packed=new Float32Array(64);
   positions.forEach((rest,i)=>{packed.set([...rest,1,...state.positions[i],0,...state.velocities[i],0,...state.positions[i],0],i*16);});device.queue.writeBuffer(stateBuffer,0,packed);device.queue.writeBuffer(bondBuffer,0,Uint32Array.from(bonds(mask)));contact.apply(plane);
   const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(stateBuffer,0,read,0,256);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const values=new Float32Array(read.getMappedRange()).slice();read.unmap();const result=positions.map((_,i)=>Array.from(values.slice(i*16+4,i*16+7))),velocity=positions.map((_,i)=>Array.from(values.slice(i*16+8,i*16+11))),reference=projectFinitePlane(shell.binding,bonds(mask),state,plane);
   for(let i=0;i<4;i++)for(let k=0;k<3;k++)maxError=Math.max(maxError,Math.abs(result[i][k]-reference.positions[i][k]),Math.abs(velocity[i][k]-reference.velocities[i][k]));
   for(const point of applyFixedCellShell(shell.binding,result,bonds(mask)))minGap=Math.min(minGap,point.reduce((sum,v,k)=>sum+v*normal[k],0)-plane.offset);cases++;
  }
  if(maxError>2e-6||minGap< -2e-6)throw Error(`Native contact mismatch: ${maxError}, gap ${minGap}`);
  return{status:'passed',cases,maxError,minGap,backend:'webgpu',fallback:false,adapter:Object.fromEntries(['vendor','architecture','device','description'].map(key=>[key,adapter.info[key]])),claim:'tiny deterministic contact conformance, not frame performance'};
 }finally{for(const resource of owned.reverse())resource.destroy();device.destroy();}
}
