// U2Net (rembg 2.0.76 `u2net`) on WebGPU from the package written by
// export-u2net-package.py: a flat op list with static shapes at 1x3x320x320.
// F32 throughout. Accumulation order differs from onnxruntime's CPU kernels,
// so parity is measured with tolerances, not bytes.
const U=globalThis.GPUBufferUsage??{STORAGE:0x80,COPY_SRC:0x4,COPY_DST:0x8,UNIFORM:0x40,MAP_READ:0x1};

const CONV=`struct P{cin:u32,h:u32,w:u32,cout:u32,oh:u32,ow:u32,k:u32,dil:u32,pad:u32,relu:u32,_a:u32,_b:u32};
@group(0)@binding(0)var<uniform>p:P;
@group(0)@binding(1)var<storage,read>src:array<f32>;
@group(0)@binding(2)var<storage,read>wt:array<f32>;
@group(0)@binding(3)var<storage,read>bias:array<f32>;
@group(0)@binding(4)var<storage,read_write>dst:array<f32>;
@compute @workgroup_size(8,8,4)
fn main(@builtin(global_invocation_id)g:vec3u){
  let x=g.x;let y=g.y;let co=g.z;
  if(x>=p.ow||y>=p.oh||co>=p.cout){return;}
  var acc=bias[co];
  let kk=p.k*p.k;
  for(var ci=0u;ci<p.cin;ci++){
    let sb=ci*p.h*p.w;let wb=(co*p.cin+ci)*kk;
    for(var ky=0u;ky<p.k;ky++){
      let iy=i32(y)+i32(ky*p.dil)-i32(p.pad);
      if(iy<0||iy>=i32(p.h)){continue;}
      for(var kx=0u;kx<p.k;kx++){
        let ix=i32(x)+i32(kx*p.dil)-i32(p.pad);
        if(ix<0||ix>=i32(p.w)){continue;}
        acc=acc+src[sb+u32(iy)*p.w+u32(ix)]*wt[wb+ky*p.k+kx];
      }
    }
  }
  if(p.relu==1u){acc=max(acc,0.0);}
  dst[(co*p.oh+y)*p.ow+x]=acc;
}`;
const POOL=`struct P{c:u32,h:u32,w:u32,oh:u32,ow:u32,_a:u32,_b:u32,_c:u32};
@group(0)@binding(0)var<uniform>p:P;
@group(0)@binding(1)var<storage,read>src:array<f32>;
@group(0)@binding(2)var<storage,read_write>dst:array<f32>;
@compute @workgroup_size(8,8,4)
fn main(@builtin(global_invocation_id)g:vec3u){
  let x=g.x;let y=g.y;let c=g.z;
  if(x>=p.ow||y>=p.oh||c>=p.c){return;}
  var m=-3.402823e38;
  for(var ky=0u;ky<2u;ky++){let iy=y*2u+ky;if(iy>=p.h){continue;}
    for(var kx=0u;kx<2u;kx++){let ix=x*2u+kx;if(ix>=p.w){continue;}m=max(m,src[(c*p.h+iy)*p.w+ix]);}}
  dst[(c*p.oh+y)*p.ow+x]=m;
}`;
// ONNX Resize linear, pytorch_half_pixel, on the two spatial axes.
const RESIZE=`struct P{c:u32,h:u32,w:u32,oh:u32,ow:u32,_a:u32,_b:u32,_c:u32};
@group(0)@binding(0)var<uniform>p:P;
@group(0)@binding(1)var<storage,read>src:array<f32>;
@group(0)@binding(2)var<storage,read_write>dst:array<f32>;
fn coord(o:u32,inSize:u32,outSize:u32)->f32{
  if(outSize<=1u){return 0.0;}
  let s=f32(inSize)/f32(outSize);
  return max((f32(o)+0.5)*s-0.5,0.0);
}
@compute @workgroup_size(8,8,4)
fn main(@builtin(global_invocation_id)g:vec3u){
  let x=g.x;let y=g.y;let c=g.z;
  if(x>=p.ow||y>=p.oh||c>=p.c){return;}
  let fy=coord(y,p.h,p.oh);let fx=coord(x,p.w,p.ow);
  let y0=min(u32(floor(fy)),p.h-1u);let x0=min(u32(floor(fx)),p.w-1u);
  let y1=min(y0+1u,p.h-1u);let x1=min(x0+1u,p.w-1u);
  let ly=fy-f32(y0);let lx=fx-f32(x0);
  let b=c*p.h*p.w;
  let v00=src[b+y0*p.w+x0];let v01=src[b+y0*p.w+x1];let v10=src[b+y1*p.w+x0];let v11=src[b+y1*p.w+x1];
  dst[(c*p.oh+y)*p.ow+x]=(v00*(1.0-lx)+v01*lx)*(1.0-ly)+(v10*(1.0-lx)+v11*lx)*ly;
}`;
const COPY=`struct P{count:u32,offset:u32,_a:u32,_b:u32};
@group(0)@binding(0)var<uniform>p:P;
@group(0)@binding(1)var<storage,read>src:array<f32>;
@group(0)@binding(2)var<storage,read_write>dst:array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id)g:vec3u){let i=g.x+g.y*65535u*256u;if(i>=p.count){return;}dst[p.offset+i]=src[i];}`;
const ADD=`struct P{count:u32,_a:u32,_b:u32,_c:u32};
@group(0)@binding(0)var<uniform>p:P;
@group(0)@binding(1)var<storage,read>a:array<f32>;
@group(0)@binding(2)var<storage,read>b:array<f32>;
@group(0)@binding(3)var<storage,read_write>dst:array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id)g:vec3u){let i=g.x+g.y*65535u*256u;if(i>=p.count){return;}dst[i]=a[i]+b[i];}`;
const SIGMOID=`struct P{count:u32,_a:u32,_b:u32,_c:u32};
@group(0)@binding(0)var<uniform>p:P;
@group(0)@binding(1)var<storage,read>src:array<f32>;
@group(0)@binding(2)var<storage,read_write>dst:array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id)g:vec3u){let i=g.x+g.y*65535u*256u;if(i>=p.count){return;}dst[i]=1.0/(1.0+exp(-src[i]));}`;

const elements=shape=>shape.reduce((a,b)=>a*b,1);
// Dispatches per foreground segment: the 314-dispatch network yields about ten times.
const SEGMENT=32;

export async function loadU2NetPackage(baseUrl,{fetchImpl=globalThis.fetch,signal}={}){
  const base=new URL(baseUrl.endsWith('/')?baseUrl:baseUrl+'/',globalThis.location?.href);
  const graph=await (await fetchImpl(new URL('graph.json',base),{signal})).json();
  if(graph.schema!=='kaminos.u2net-package.v0')throw Error('kaminos.u2net-package.v0 graph required');
  const bytes=await (await fetchImpl(new URL(graph.weights.file,base),{signal})).arrayBuffer();
  if(bytes.byteLength!==graph.weights.floats*4)throw Error('complete U2Net weights required');
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  const hex=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  if(hex!==graph.weights.sha256)throw Error('U2Net weights do not match the package');
  return {graph,weights:new Float32Array(bytes)};
}

export function createU2NetRunner({device,graph,weights}){
  if(!device?.createBuffer)throw TypeError('GPUDevice required');
  const ops=graph.ops,inputName=graph.input.name,outputName=graph.output;
  const shapes=new Map([[inputName,graph.input.shape]]);for(const op of ops)shapes.set(op.output,op.outShape);
  const readsOf=op=>op.inputs??[op.input];
  // Static memory plan: each tensor's buffer returns to the pool after its last reader.
  const lastUse=new Map();ops.forEach((op,i)=>readsOf(op).forEach(n=>lastUse.set(n,i)));
  lastUse.set(outputName,Infinity);
  const pool=new Map(),buffers=new Map(),owned=[];
  const take=bytes=>{const free=pool.get(bytes);if(free?.length)return free.pop();
    const b=device.createBuffer({size:bytes,usage:U.STORAGE|U.COPY_SRC|U.COPY_DST});owned.push(b);return b;};
  buffers.set(inputName,take(elements(graph.input.shape)*4));
  const pipelines={},pipeline=(name,code)=>pipelines[name]??=device.createComputePipeline({layout:'auto',compute:{module:device.createShaderModule({code}),entryPoint:'main'}});
  const uniform=values=>{const b=device.createBuffer({size:Math.max(16,values.length*4),usage:U.UNIFORM|U.COPY_DST});owned.push(b);
    device.queue.writeBuffer(b,0,new Uint32Array(values));return b;};
  const storage=data=>{const b=device.createBuffer({size:data.byteLength,usage:U.STORAGE|U.COPY_DST});owned.push(b);device.queue.writeBuffer(b,0,data);return b;};
  const steps=[];
  const grid3=(x,y,z,wg=[8,8,4])=>[Math.ceil(x/wg[0]),Math.ceil(y/wg[1]),Math.ceil(z/wg[2])];
  const grid1=n=>{const groups=Math.ceil(n/256);return [Math.min(groups,65535),Math.ceil(groups/65535),1];};
  ops.forEach((op,i)=>{
    const out=take(elements(op.outShape)*4);buffers.set(op.output,out);
    const bind=(p,entries)=>device.createBindGroup({layout:p.getBindGroupLayout(0),entries:entries.map((buffer,binding)=>({binding,resource:{buffer}}))});
    const [,c,oh,ow]=op.outShape;
    if(op.op==='conv'){
      const [,cin,h,w]=op.inShape,k=op.kernel,wn=c*cin*k*k,p=pipeline('conv',CONV);
      steps.push([p,bind(p,[uniform([cin,h,w,c,oh,ow,k,op.dilation,op.pad,op.relu?1:0,0,0]),buffers.get(op.input),
        storage(weights.subarray(op.weight,op.weight+wn)),storage(weights.subarray(op.bias,op.bias+c)),out]),grid3(ow,oh,c)]);
    }else if(op.op==='maxpool'||op.op==='resize'){
      const [,,h,w]=op.inShape,p=pipeline(op.op,op.op==='maxpool'?POOL:RESIZE);
      steps.push([p,bind(p,[uniform([c,h,w,oh,ow,0,0,0]),buffers.get(op.input),out]),grid3(ow,oh,c)]);
    }else if(op.op==='concat'){
      let offset=0;const p=pipeline('copy',COPY);
      for(const name of op.inputs){const n=elements(shapes.get(name));
        steps.push([p,bind(p,[uniform([n,offset,0,0]),buffers.get(name),out]),grid1(n)]);offset+=n;}
    }else if(op.op==='add'){
      const n=elements(op.outShape),p=pipeline('add',ADD);
      steps.push([p,bind(p,[uniform([n,0,0,0]),buffers.get(op.inputs[0]),buffers.get(op.inputs[1]),out]),grid1(n)]);
    }else if(op.op==='sigmoid'){
      const n=elements(op.outShape),p=pipeline('sigmoid',SIGMOID);
      steps.push([p,bind(p,[uniform([n,0,0,0]),buffers.get(op.inputs[0]),out]),grid1(n)]);
    }else throw Error('unsupported U2Net op '+op.op);
    for(const name of readsOf(op))if(lastUse.get(name)===i){const b=buffers.get(name),bytes=elements(shapes.get(name))*4;
      if(!pool.has(bytes))pool.set(bytes,[]);pool.get(bytes).push(b);}
  });
  let disposed=false;
  return Object.freeze({
    planned:{buffers:owned.length,steps:steps.length},
    // input: Float32Array of 1x3x320x320 normalized pixels. Returns the first
    // output (sigmoid d0), 320x320. `capture` names tensors to read back too
    // (only valid for tensors not reused before the end of the run).
    // With `foreground` (a kit foreground run: {foregroundOpportunities}) the
    // dispatches are submitted in segments and the page gets a before-encode
    // boundary ahead of each one; Stop (`signal`) is honoured between segments.
    // Without it, one submission. Same dispatches and order either way.
    async run(input,{capture=[],foreground,signal,invocationId='u2net',segmentSize=SEGMENT}={}){
      if(disposed)throw Error('U2Net runner disposed');
      if(!(input instanceof Float32Array)||input.length!==elements(graph.input.shape))throw TypeError('1x3x320x320 F32 input required');
      const serviceAtBoundary=foreground?.foregroundOpportunities?.serviceAtBoundary;
      if(foreground!==undefined&&typeof serviceAtBoundary!=='function')throw TypeError('foreground run with foregroundOpportunities.serviceAtBoundary required');
      const stop=()=>{if(signal?.aborted)throw signal.reason?.name==='AbortError'?signal.reason:new DOMException('U2Net stopped','AbortError');};
      stop();
      device.queue.writeBuffer(buffers.get(inputName),0,input);
      const encode=(enc,list)=>{for(const [p,b,[x,y,z]] of list){const pass=enc.beginComputePass();pass.setPipeline(p);pass.setBindGroup(0,b);pass.dispatchWorkgroups(x,y,z);pass.end();}};
      const segments=serviceAtBoundary?[]:[steps];
      if(serviceAtBoundary)for(let i=0;i<steps.length;i+=segmentSize)segments.push(steps.slice(i,i+segmentSize));
      let enc;
      for(let i=0;i<segments.length;i++){
        if(serviceAtBoundary){
          await serviceAtBoundary.call(foreground.foregroundOpportunities,{invocationId,boundaryId:`${invocationId}:u2net:${i}`,
            dutyId:`${invocationId}:u2net-segment:${i}`,phase:'u2net-inference',position:'before-encode'});
          stop();
        }
        enc=device.createCommandEncoder();encode(enc,segments[i]);
        if(i<segments.length-1)device.queue.submit([enc.finish()]);
      }
      const reads=[outputName,...capture].map(name=>{const bytes=elements(shapes.get(name))*4;
        const staging=device.createBuffer({size:bytes,usage:U.MAP_READ|U.COPY_DST});enc.copyBufferToBuffer(buffers.get(name),0,staging,0,bytes);return [name,staging];});
      device.queue.submit([enc.finish()]);
      const out={};
      for(const [name,staging] of reads){await staging.mapAsync(1);out[name]=new Float32Array(staging.getMappedRange().slice(0));staging.unmap();staging.destroy();}
      return {mask:out[outputName],tensors:out};
    },
    dispose(){if(disposed)return;disposed=true;for(const b of owned)b.destroy();}
  });
}
