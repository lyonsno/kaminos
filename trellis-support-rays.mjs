import {chartPoint,worldPoint} from './trellis-local-support.mjs';

export const SUPPORT_TRACE_WGSL=/* wgsl */`
struct Hit { distances:vec4f, sourceBary:vec4f, address:vec4u }
@group(0) @binding(0) var<storage,read> positions:array<vec4f>;
@group(0) @binding(1) var<storage,read> sourceBary:array<vec4f>;
@group(0) @binding(2) var<storage,read> sourceIds:array<u32>;
@group(0) @binding(3) var<storage,read> rays:array<vec4f>;
@group(0) @binding(4) var<storage,read> bounds:array<vec4f>;
@group(0) @binding(5) var<storage,read_write> hits:array<Hit>;
@compute @workgroup_size(64) fn trace(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;if(i>=arrayLength(&hits)){return;}let o=rays[i*2u].xyz;let d=rays[i*2u+1u].xyz;
  var entry=0.;var exit=1e30;var intersects=true;
  for(var k=0u;k<3u;k++){
    if(d[k]==0.){if(o[k]<bounds[0][k]||o[k]>bounds[1][k]){intersects=false;}}
    else{let a=(bounds[0][k]-o[k])/d[k];let b=(bounds[1][k]-o[k])/d[k];entry=max(entry,min(a,b));exit=min(exit,max(a,b));}
  }
  if(!intersects||exit<entry){hits[i]=Hit(vec4f(-1,-1,-1,0),vec4f(0),vec4u(0xffffffffu,0xffffffffu,0,0));return;}
  var nearest=exit+1e-5;var triangle=0xffffffffu;var clipped=0xffffffffu;var bary=vec3f(0);var found=0u;var front=0u;
  for(var t=0u;t<arrayLength(&sourceIds);t++){
    let a=positions[t*3u].xyz;let e1=positions[t*3u+1u].xyz-a;let e2=positions[t*3u+2u].xyz-a;let p=cross(d,e2);let det=dot(e1,p);
    if(abs(det)<=1e-10||(bounds[2].x==0.&&det<=1e-10)){continue;}
    let offset=o-a;let u=dot(offset,p)/det;let q=cross(offset,e1);let v=dot(d,q)/det;let distance=dot(e2,q)/det;
    if(u< -1e-6||v< -1e-6||u+v>1.+1e-6||distance<entry-1e-6||distance>exit+1e-6){continue;}
    if(distance<nearest||(distance==nearest&&sourceIds[t]<triangle)){
      nearest=max(0.,distance);triangle=sourceIds[t];clipped=t;found=1u;front=select(0u,1u,det>0.);
      bary=sourceBary[t*3u].xyz*(1.-u-v)+sourceBary[t*3u+1u].xyz*u+sourceBary[t*3u+2u].xyz*v;
    }
  }
  hits[i]=Hit(vec4f(select(-1.,nearest,found==1u),entry,exit,0),vec4f(bary,0),vec4u(triangle,clipped,found,front));
}
`;

// Ray origins/directions use the source mesh's local physical coordinates.
// A miss reports the support exit, so external retained geometry can continue.
export async function traceSupportRays(device,candidate,queries,{twoSided=true}={}){
  if(!device||!candidate.patch?.length||!Array.isArray(queries))throw Error('WebGPU device, clipped teacher and ray array required');
  if(!queries.length)return {backend:'WebGPU',samples:[]};
  const {frame}=candidate,packed=[],directions=[];
  for(const q of queries){
    if(q.origin?.length!==3||q.direction?.length!==3||![...q.origin,...q.direction].every(Number.isFinite)||Math.hypot(...q.direction)===0)throw Error('finite ray origin and nonzero direction required');
    const l=Math.hypot(...q.direction),d=q.direction.map(x=>x/l),project=a=>a.reduce((s,x,k)=>s+x*d[k],0),local=[project(frame.u),project(frame.v),project(frame.n)];
    packed.push(...chartPoint(q.origin,frame),0,...local,0);directions.push(d);
  }
  if(typeof twoSided!=='boolean')throw Error('twoSided must declare the teacher material side policy');
  const p=Float32Array.from(candidate.patch.flatMap(t=>t.vertices.flatMap(v=>[...v.p,0]))),b=Float32Array.from(candidate.patch.flatMap(t=>t.vertices.flatMap(v=>[...v.b,0]))),ids=Uint32Array.from(candidate.patch.map(t=>t.sourceTriangle)),rays=Float32Array.from(packed),bounds=Float32Array.from([...candidate.lo,0,...candidate.hi,0,+twoSided,0,0,0]);
  if([p,b,rays,bounds].some(data=>!data.every(Number.isFinite)))throw Error('Ray teacher inputs must be representable as finite float32');
  const owned=[],allocate=(size,usage)=>{const b=device.createBuffer({size,usage});owned.push(b);return b;};device.pushErrorScope('validation');let open=true;
  try{
    const input=[p,b,ids,rays,bounds].map(data=>{const buf=allocate(data.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);device.queue.writeBuffer(buf,0,data);return buf;});
    const size=queries.length*48,out=allocate(size,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),read=allocate(size,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST),module=device.createShaderModule({label:'Bounded TRELLIS ray teacher',code:SUPPORT_TRACE_WGSL});
    const info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.map(m=>m.message).join('\n'));
    const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'trace'}}),bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[...input,out].map((buffer,binding)=>({binding,resource:{buffer}}))});
    const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(queries.length/64));pass.end();encoder.copyBufferToBuffer(out,0,read,0,size);device.queue.submit([encoder.finish()]);
    await read.mapAsync(GPUMapMode.READ);const raw=read.getMappedRange().slice(0);read.unmap();const error=await device.popErrorScope();open=false;if(error)throw Error(error.message);
    const floats=new Float32Array(raw),ints=new Uint32Array(raw),samples=[];
    for(let i=0;i<queries.length;i++){
      const o=i*12,hit=ints[o+10]===1,entry=floats[o+1],exit=floats[o+2],distance=floats[o];
      samples.push({origin:[...queries[i].origin],direction:directions[i],intersectsSupport:entry>=0,entry:entry>=0?entry*frame.radius:null,exit:exit>=0?exit*frame.radius:null,hit,
        distance:hit?distance*frame.radius:null,sourceTriangle:hit?ints[o+8]:null,clippedTriangle:hit?ints[o+9]:null,sourceBary:hit?Array.from(floats.subarray(o+4,o+7)):null,frontFacing:hit?ints[o+11]===1:null,
        position:hit?worldPoint(packed.slice(i*8,i*8+3).map((x,k)=>x+packed[i*8+4+k]*distance),frame):null});
    }
    return {backend:'WebGPU',samples,rayCount:queries.length,teacherTriangles:candidate.patch.length,twoSided,authority:'geometric intersections and source addresses; material opacity/normal maps and radiance not evaluated'};
  }finally{if(open)await device.popErrorScope();for(const b of owned)b.destroy();}
}
