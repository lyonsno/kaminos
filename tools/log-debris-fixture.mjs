import * as THREE from '../lib/three.webgpu.js';
import {createLogDebrisGpu} from '../log-debris-gpu.mjs';
export async function runLogDebrisFixture(){
 const adapter=await navigator.gpu.requestAdapter();if(!adapter||adapter.isFallbackAdapter)throw Error('Native adapter required');
 const device=await adapter.requestDevice(),n=4,count=n**3,buffers=[];let debris;
 try{
  const make=()=>{const b=device.createBuffer({size:count*32,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});buffers.push(b);return b;};
  const before=make(),after=make(),initial=new Uint32Array(count),surface=new Uint32Array(count);initial[0]=surface[0]=1;
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());mesh.geometry.computeBoundingBox();
  const field={device,disintegrate:true,residentState:()=>({before,after,dimensions:[n,n,n],initial,surface,bounds:mesh.geometry.boundingBox,mesh}),sampleState:()=>THREE.TSL.vec4(0,0,0,1)};
  debris=await createLogDebrisGpu({renderer:{backend:{device,get:()=>({})}},field,ground:{center:[0,-1,0],height:-1,radius:5}});
  const values=new Float32Array(count*8);values[5]=1;device.queue.writeBuffer(before,0,values);device.queue.writeBuffer(after,0,values);
  const encode=()=>{const e=device.createCommandEncoder();debris.encode(e,{dt:.02});device.queue.submit([e.finish()]);};
  const records=[];encode();records.push(await debris.snapshot());if(records[0].particles.some(v=>v!==0))throw Error('Cold material produced residue');
  values[0]=.8;values[5]=.15;device.queue.writeBuffer(after,0,values);encode();records.push(await debris.snapshot());
  const first=records[1].particles;if(first[11]!==1||Math.abs(first[13]-.15)>1e-6||first[12]!==0)throw Error('Consumed material did not create its finite residue');
  encode();records.push(await debris.snapshot());if(!(records[2].particles[7]>first[7]))throw Error('Duplicate transition reset the existing particle');
  for(let i=1;i<count;i++)if(records[2].particles[i*16+11]!==0)throw Error('Empty material emitted residue');
  for(let i=0;i<100;i++)encode();records.push(await debris.snapshot());if(records[3].particles[14]!==1||records[3].particles[1]<-1)throw Error('Finite ground contact missing');
  debris.reset();values[0]=0;values[5]=1;device.queue.writeBuffer(after,0,values);encode();records.push(await debris.snapshot());if(records[4].particles.some(v=>v!==0))throw Error('Reset retained debris');
  mesh.geometry.dispose();mesh.material.dispose();return {status:'passed',adapter:adapter.info,records};
 }finally{debris?.dispose();for(const b of buffers)b.destroy();device.destroy();}
}
