import {Box3,Vector3} from '../lib/three.core.js';
import {createBurnRegionBodiesGpu} from '../burn-region-bodies-gpu.mjs';
import {remainingBurnBody} from '../burn-fracture-core.mjs';

export async function probeLiveBodies(){
 const adapter=await navigator.gpu.requestAdapter();
 if(!adapter||adapter.isFallbackAdapter||adapter.info.vendor!=='apple')throw Error('Native Apple material-body probe required');
 const device=await adapter.requestDevice(),owned=[],errors=[];let reducer;
 device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
 const buffer=(values,usage=GPUBufferUsage.STORAGE)=>{const b=device.createBuffer({size:Math.max(16,values.byteLength),usage:usage|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});owned.push(b);device.queue.writeBuffer(b,0,values);return b;};
 const floats=(n)=>new Float32Array(n),near=(a,b)=>{if(a.length!==b.length||a.some((v,k)=>!Number.isFinite(v)||Math.abs(v-b[k])>1e-5))throw Error(JSON.stringify({actual:a,expected:b}));};
 try{
  // Two vertical regions, with a rotated first body. Recorded engine ABI is
  // pinned by lib/fracture/rigid-engine.js; this tests the material producer.
  const material=floats(32);for(let i=0;i<4;i++)material[i*8+5]=1;
  const state=buffer(material),positions=buffer(Float32Array.of(3,4,5,.25,1,0,0,.25)),rotations=buffer(Float32Array.of(0,0,Math.SQRT1_2,Math.SQRT1_2,0,0,0,1));
  const rest=buffer(Float32Array.of(.5,1,.5,4,1.5,1,.5,4)),boxesRaw=Float32Array.of(0,.5,1,.5,0,.5,1,.5);
  new Uint32Array(boxesRaw.buffer)[0]=new Uint32Array(boxesRaw.buffer)[4]=0x02010000;
  const boxes=buffer(boxesRaw),inertia=buffer(Float32Array.of(.6,1.5,.6,.25,.6,1.5,.6,.25)),velocities=buffer(floats(8)),angular=buffer(Float32Array.of(0,0,2,0,0,0,0,0));
  const jointData=floats(44);new Uint32Array(jointData.buffer).set([0,1,0,1]);jointData.set([.5,0,0,1],4);jointData.set([-.5,0,0,1],8);const joints=buffer(jointData);
  const contactData=floats(36);contactData.set([0,1,1,0]);contactData.set([3,4,5,6],20);contactData.set([7,8,9,10],24);const contacts=buffer(contactData);
  const field={residentState:()=>({after:state,bounds:new Box3(new Vector3(0,0,0),new Vector3(2,2,1)),dimensions:[2,2,1]})};
  reducer=await createBurnRegionBodiesGpu({device,field,mapping:{counts:Uint32Array.of(2,2),spans:Uint32Array.of(0,2,2,2),cells:Uint32Array.of(0,2,1,3)},rest,positions,rotations,boxes,inertia,velocities,angular,joints,contacts});
  const arrays=[positions,rest,boxes,inertia,velocities,joints,contacts,reducer.shape];
  async function step(){const bytes=arrays.reduce((s,b)=>s+b.size,0),staging=device.createBuffer({size:bytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const encoder=device.createCommandEncoder();reducer.encode(encoder);let offset=0;for(const b of arrays){encoder.copyBufferToBuffer(b,0,staging,offset,b.size);offset+=b.size;}device.queue.submit([encoder.finish()]);await staging.mapAsync(GPUMapMode.READ);const raw=new Uint8Array(staging.getMappedRange()),out=[];offset=0;for(const b of arrays){out.push(Array.from(new Float32Array(raw.slice(offset,offset+b.size).buffer)));offset+=b.size;}return out;}finally{staging.destroy();}}
  const cold=await step();near(cold[0],[3,4,5,.25,1,0,0,.25]);
  material[5]=0;device.queue.writeBuffer(state,0,material);const consumed=await step();
  const expected=remainingBurnBody({points:[[.5,.5,.5],[.5,1.5,.5]],fuel:[0,1],pitch:[1,1,1],mass:4});
  near(consumed[0].slice(0,4),[2.5,4,5,1/expected.mass]);near(consumed[1].slice(0,3),expected.center);near(consumed[2].slice(1,4),expected.halfExtents);near(consumed[3].slice(0,3),expected.inverseInertia);
  near(consumed[4].slice(0,3),[0,-1,0]);near(consumed[5].slice(4,7),[.5,-.5,0]);near(consumed[6].slice(20,24),[0,0,0,6]);near(consumed[6].slice(24,28),[0,0,0,0]);
  const stable=await step();near(stable[0],consumed[0]);near(stable[5],consumed[5]);
  material[2*8+5]=0;device.queue.writeBuffer(state,0,material);const exhausted=await step();
  near(exhausted[0].slice(0,4),[2.5,4,5,0]);near(exhausted[3].slice(0,4),[0,0,0,0]);
  const masks=new Uint32Array(Float32Array.from(exhausted[2]).buffer);if(masks[0]>>>24!==0)throw Error('Exhausted material retained contact');
  if(new Uint32Array(Float32Array.from(exhausted[5]).buffer)[3]!==0)throw Error('Exhausted material retained connection');
  await device.queue.onSubmittedWorkDone();if(errors.length)throw Error(errors.join('\n'));
  return {adapter:{vendor:adapter.info.vendor,description:adapter.info.description},fallback:adapter.isFallbackAdapter,scope:'remaining-material mass/contact/inertia producer; not a live interaction claim',cold,consumed,stable,exhausted,expected};
 }finally{reducer?.dispose();owned.forEach(b=>b.destroy());device.destroy();}
}
