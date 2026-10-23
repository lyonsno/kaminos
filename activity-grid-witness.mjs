// Exercises the production WGSL cue sampler against an asymmetric material field.
export async function probeActivityGrid(){
 const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('WebGPU unavailable');
 const device=await adapter.requestDevice(),owned=[],errors=[];
 device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
 try {
  const source=await(await fetch('/volume-core.js')).text();
  const sampler=source.match(/fn rawTruthOracleActivityCueAtCell\(c: vec3<i32>\) -> f32 \{[^]*?\n\}/)?.[0];
  if(!sampler)throw Error('Production cue sampler missing');
  const md=[64,128,64],n=md.reduce((a,b)=>a*b),data=Float32Array.from({length:n},(_,i)=>((i*13+Math.floor(i/64)*7)%997)/997);
  const buf=(size,usage)=>{const b=device.createBuffer({size,usage});owned.push(b);return b;};
  const cue=buf(data.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);device.queue.writeBuffer(cue,0,data);
  const cases=[];
  for(const ratio of [1,2,4]){
   const d=md.map(n=>n/ratio),points=[[0,0,0],d.map(n=>n/2),d.map(n=>n-1),[-1,d[1],d[2]]];
   const pointsBuffer=buf(64,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);device.queue.writeBuffer(pointsBuffer,0,new Int32Array(points.flatMap(p=>[...p,0])));
   const output=buf(16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),read=buf(16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
   const code=`const GRID:u32=${d[0]}u;const GRID_Y:u32=${d[1]}u;const VELOCITY_UNIT_SCALE:f32=${1/ratio};
    struct Uniforms {oracle_activity_controls2:vec4<f32>};const u=Uniforms(vec4<f32>(0,1,0,0));
    @group(0) @binding(0) var<storage,read> oracleActivityCue:array<f32>;
    @group(0) @binding(1) var<storage,read> points:array<vec4<i32>>;
    @group(0) @binding(2) var<storage,read_write> result:array<f32>;
    fn proceduralReceiverActivityCue(c:vec3<i32>)->f32{return 0.0;}
    ${sampler}
    @compute @workgroup_size(4) fn main(@builtin(global_invocation_id) id:vec3<u32>){result[id.x]=rawTruthOracleActivityCueAtCell(points[id.x].xyz);}`;
   const pipeline=device.createComputePipeline({layout:'auto',compute:{module:device.createShaderModule({code}),entryPoint:'main'}});
   const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[cue,pointsBuffer,output].map((buffer,binding)=>({binding,resource:{buffer}}))});
   const e=device.createCommandEncoder(),pass=e.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);pass.end();e.copyBufferToBuffer(output,0,read,0,16);device.queue.submit([e.finish()]);
   await read.mapAsync(GPUMapMode.READ);const actual=Array.from(new Float32Array(read.getMappedRange()));read.unmap();
   const expected=points.map(p=>{const c=p.map((v,a)=>Math.max(0,Math.min(d[a]-1,v)));let sum=0;for(let z=0;z<ratio;z++)for(let y=0;y<ratio;y++)for(let x=0;x<ratio;x++)sum+=data[c[0]*ratio+x+md[0]*(c[1]*ratio+y+md[1]*(c[2]*ratio+z))];return sum/ratio**3;});
   cases.push({ratio,dimensions:d,points,actual,expected});
  }
  return {adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture},materialDims:md,sampler,cases,errors};
 }finally{owned.forEach(b=>b.destroy());device.destroy();}
}
