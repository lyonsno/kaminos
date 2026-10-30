import {MaterialHierarchy} from '../../volume-material-hierarchy.mjs';
import {hierarchyWGSL} from '../../volume-material-hierarchy-gpu.mjs';
import {WORLD_SMOKE_WGSL} from '../../volume-world-smoke.mjs';
import {samplingReference} from './sampling-reference.mjs';

const cases=[{name:'mixed-levels',dims:[8,8,4],pitch:1,min:[0,0,0]},
 {name:'partial-fractional',dims:[7,5,3],pitch:.3,min:[-.7,.13,-1.17]},
 {name:'translated-small-cells',dims:[7,5,3],pitch:.003,min:[1000,-1000,1000]}];

export function validateSamplingEvidence(result){
 if(result.error)throw Error(result.error);
 if(result.cases?.length!==cases.length)throw Error('Missing sampler cases');
 let maximum=0;
 for(let i=0;i<cases.length;i++){
  const c=result.cases[i];if(c.name!==cases[i].name||!Array.isArray(c.points)||!c.points.length)throw Error('Wrong or empty sampler case');
  if(c.values?.length!==c.points.length*16||c.values.some(x=>!Number.isFinite(x)))throw Error('Incomplete or invalid sampler readback');
  let varied=false;
  for(let p=0;p<c.points.length;p++)for(let ch=0;ch<8;ch++){
   const actual=c.values[p*16+ch],expected=c.values[p*16+8+ch];
   maximum=Math.max(maximum,Math.abs(actual-expected));if(ch===0&&expected>0)varied=true;
  }
  if(!varied)throw Error('Sampler returned blank material');
 }
 if(maximum>1e-6)throw Error(`Same-brick sampler differs from pinned reference: ${maximum}`);
 return {cases:result.cases.length,samples:result.cases.reduce((n,c)=>n+c.points.length,0),maximumError:maximum};
}

// Compare the production sampler against its pre-optimization source on the
// same GPU, topology, eight-channel pool and points. No raymarcher involved.
export async function samplingParity(device){
 const result={reference:'8a2c8e180ac2303be053a461a0e8c0b8e3a016a4',cases:[]},owned=[];
 try{
  const code=hierarchyWGSL(WORLD_SMOKE_WGSL)+samplingReference+`
@group(2) @binding(0) var<storage,read> samplePoints:array<vec4<f32>>;
@group(2) @binding(1) var<storage,read_write> sampleValues:array<Gas>;
@compute @workgroup_size(64) fn compareSamples(@builtin(global_invocation_id) gid:vec3<u32>){
 if(gid.x>=arrayLength(&samplePoints)){return;}
 sampleValues[gid.x*2u]=hierarchyGas(samplePoints[gid.x].xyz);
 sampleValues[gid.x*2u+1u]=referenceHierarchyGas(samplePoints[gid.x].xyz);
}`;
  const module=device.createShaderModule({code}),pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'compareSamples'}});
  const buffer=(data,usage)=>{const b=device.createBuffer({size:typeof data==='number'?data:data.byteLength,usage});owned.push(b);if(typeof data!=='number')device.queue.writeBuffer(b,0,data);return b;};
  const S=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,U=GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST;
  for(const spec of cases){
   const topology=new MaterialHierarchy({dims:spec.dims,options:{budget:8,maxDetail:2}}).allocate(new Map([['0:0:0:0',{reaction:10}],['0:1:0:0',{reaction:1}]]));
   const meta=new ArrayBuffer(topology.capacity*64),mf=new Float32Array(meta),mi=new Uint32Array(meta),pool=Float32Array.from({length:topology.capacity*64*8},(_,i)=>((i*37)%101)/31);
   const points=[];
   for(const n of topology.nodes){
    const pitch=spec.pitch/2**n.level,lo=n.c.map((v,a)=>spec.min[a]+v*4*pitch);
    mf.set([...lo,pitch],n.slot*16);mi.set(n.childSlots??Array(8).fill(0xffffffff),n.slot*16+4);
    // Straddle faces, centers and interpolation corners at each level.
    for(let a=0;a<3;a++)for(const t of [-.01,0,.5,1.2,2.5,3.5,3.99,4.01])points.push(lo.map((v,j)=>v+(j===a?t:1.5)*pitch));
   }
   for(let a=0;a<3;a++)for(const t of [-.01,0,.5,spec.dims[a]-.5,spec.dims[a],spec.dims[a]+.01])points.push(spec.min.map((v,j)=>v+(j===a?t:spec.dims[j]/2)*spec.pitch));
   const params=new Float32Array(80);params.set([...spec.dims,spec.pitch],4);params.set([...spec.min,0],44);params[34]=1;
   const h=new Float32Array([...spec.dims.map(n=>Math.ceil(n/4)),spec.pitch,...spec.min,0,0,0,0,0]);
   const inputs=[buffer(params,U),buffer(meta,S),buffer(pool,S),buffer(h,U),buffer(new Float32Array(points.flatMap(p=>[...p,0])),S)],bytes=points.length*64;
   const output=buffer(bytes,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),readback=buffer(bytes,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);
   const bindings=[[[0,inputs[0]]],[[0,inputs[1]],[1,inputs[2]],[6,inputs[3]]],[[0,inputs[4]],[1,output]]];
   const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);
   bindings.forEach((entries,i)=>pass.setBindGroup(i,device.createBindGroup({layout:pipeline.getBindGroupLayout(i),entries:entries.map(([binding,buffer])=>({binding,resource:{buffer}}))})));
   pass.dispatchWorkgroups(Math.ceil(points.length/64));pass.end();encoder.copyBufferToBuffer(output,0,readback,0,bytes);device.queue.submit([encoder.finish()]);
   await readback.mapAsync(GPUMapMode.READ);result.cases.push({...spec,nodes:topology.nodes,points,values:Array.from(new Float32Array(readback.getMappedRange()))});readback.unmap();
  }
 }catch(e){result.error=e.stack;}finally{for(const b of owned)b.destroy();}
 return result;
}
