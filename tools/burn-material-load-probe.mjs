import * as THREE from '../lib/three.webgpu.js';
import {createBurnFractureGpu} from '../burn-fracture-gpu.mjs';

// A clamped two-region cantilever isolates the production load extraction and
// failure decision. The imported-object replay separately exercises contact.
export async function probeBurnMaterialLoad(){
 const renderer=new THREE.WebGPURenderer();let dynamics;
 const rows=[],owned=[];
 try{
  await renderer.init();const device=renderer.backend.device,adapter=device.adapterInfo;
  if(!renderer.backend.isWebGPUBackend||adapter?.vendor!=='apple')throw Error('Native Apple production mechanics probe required');
  const prepared={
   cells:[-.25,.25].map((x,index)=>({index,position:[x,0,0],halfExtents:[.25,.05,.05],volume:.005})),
   bonds:[{id:'cantilever',a:0,b:1,anchorA:[.25,0,0],anchorB:[-.25,0,0],normal:[1,0,0],area:.01,linearStiffness:1e6,rotationalStiffness:1e4}],
   config:{timeStep:1/60,substeps:2,solverIterations:20,strength:1e5},
  };
  const buffer=(label,values)=>{const b=device.createBuffer({label,size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});owned.push(b);device.queue.writeBuffer(b,0,Float32Array.from(values));return b;};
  const sections={device,count:1,mapping:{connections:prepared.bonds},buffer:buffer('Surviving test section',[1,.01,.01,1]),damageBuffer:buffer('Controlled test char',[0,0,0,0])};
  const material={tension:1e5,compression:4e5,shear:8e4,charStrength:.1,density:500};
  for(const [name,char,gravity]of [['intact',0,[0,-9.81,0]],['charred',1,[0,-9.81,0]],['unloaded',1,[0,0,0]]]){
   device.queue.writeBuffer(sections.damageBuffer,0,Float32Array.of(char,0,0,0));
   dynamics=await createBurnFractureGpu({renderer,prepared,sections,supports:[0],material,gravity});
   const row={name,char,prepared,material,before:await dynamics.snapshot()};rows.push(row);
   dynamics.advance(.25);row.after=await dynamics.snapshot();dynamics.dispose();dynamics=null;
  }
  return {adapter:{vendor:adapter.vendor,description:adapter.description},route:'createBurnFractureGpu/ArchGpuEngine/burnFailure',rows};
 }catch(error){error.probeEvidence=rows;throw error;}
 finally{dynamics?.dispose();for(const b of owned)b.destroy();renderer.dispose();}
}
