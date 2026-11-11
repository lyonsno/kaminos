export const SUPPORT_FIT_WGSL=/* wgsl */`
@group(0) @binding(0) var<storage,read> triangles:array<vec4f>;
@group(0) @binding(1) var<storage,read> rim:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> results:array<vec4f>;
fn cross2(a:vec2f,b:vec2f)->f32{return a.x*b.y-a.y*b.x;}
@compute @workgroup_size(64) fn fit(@builtin(global_invocation_id) gid:vec3u){
  let t=gid.x;if(t>=arrayLength(&results)){return;}
  let source=array<vec3f,3>(triangles[t*3u].xyz,triangles[t*3u+1u].xyz,triangles[t*3u+2u].xyz);
  var required=-1e20;var boundaryError=0.;var corners=0.;
  for(var r=0u;r<arrayLength(&rim);r++){
    let a=rim[r].xyz;let b=rim[(r+1u)%arrayLength(&rim)].xyz;let det=cross2(a.xy,b.xy);
    if(det<=1e-10){continue;}
    var poly:array<vec3f,8>;poly[0]=source[0];poly[1]=source[1];poly[2]=source[2];var count=3u;
    let cp=array<vec2f,3>(vec2f(0),a.xy,b.xy);
    for(var edge=0u;edge<3u;edge++){
      var clipped:array<vec3f,8>;var n=0u;let c=cp[edge];let d=cp[(edge+1u)%3u];
      for(var j=0u;j<count;j++){
        let p=poly[j];let q=poly[(j+1u)%count];let dp=cross2(d-c,p.xy-c);let dq=cross2(d-c,q.xy-c);
        if(dp>=0.){clipped[n]=p;n++;}
        if((dp>0.&&dq<0.)||(dp<0.&&dq>0.)){clipped[n]=mix(p,q,dp/(dp-dq));n++;}
      }
      poly=clipped;count=n;
    }
    for(var j=0u;j<count;j++){
      let p=poly[j];let wa=cross2(p.xy,b.xy)/det;let wb=cross2(a.xy,p.xy)/det;let wc=1.-wa-wb;let z=p.z-wa*a.z-wb*b.z;
      if(wc>1e-5){required=max(required,z/wc);}else{boundaryError=max(boundaryError,z);}
      corners+=1.;
    }
  }
  results[t]=vec4f(required,boundaryError,corners,0);
}
`;

// Uses the caller's existing WebGPU device. No private adapter or rendering loop.
export async function fitLocalSupport(device,candidate,{clearance=.00001}={}){
  if(!device||!Number.isFinite(clearance)||clearance<0)throw Error('WebGPU device and finite nonnegative clearance required');
  const tris=Float32Array.from(candidate.patch.flatMap(t=>t.vertices.flatMap(v=>[...v.p,0]))),rim=Float32Array.from(candidate.rim.flatMap(p=>[...p,0]));
  const count=candidate.patch.length;if(!count||rim.length<12)throw Error('nonempty local patch and rim required');
  const buffers=[];const buffer=(data,usage)=>{const b=device.createBuffer({size:data.byteLength,usage,mappedAtCreation:true});new Uint8Array(b.getMappedRange()).set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength));b.unmap();buffers.push(b);return b;};
  device.pushErrorScope('validation');let scopeOpen=true;
  try{
    const a=buffer(tris,GPUBufferUsage.STORAGE),b=buffer(rim,GPUBufferUsage.STORAGE),out=device.createBuffer({size:count*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),read=device.createBuffer({size:count*16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});buffers.push(out,read);
    const module=device.createShaderModule({label:'TRELLIS local support fit',code:SUPPORT_FIT_WGSL});
    const compilation=await module.getCompilationInfo();const errors=compilation.messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>`${m.lineNum}:${m.linePos} ${m.message}`).join('\n'));
    const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'fit'}});
    const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[a,b,out].map((buffer,binding)=>({binding,resource:{buffer}}))});
    const e=device.createCommandEncoder(),pass=e.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(count/64));pass.end();e.copyBufferToBuffer(out,0,read,0,count*16);device.queue.submit([e.finish()]);
    await read.mapAsync(GPUMapMode.READ);const values=new Float32Array(read.getMappedRange()).slice();read.unmap();
    const error=await device.popErrorScope();scopeOpen=false;if(error)throw Error(error.message);
    let centerHeight=-Infinity,boundaryError=0,intersectionCorners=0;
    for(let i=0;i<count;i++){centerHeight=Math.max(centerHeight,values[i*4]);boundaryError=Math.max(boundaryError,values[i*4+1]);intersectionCorners+=values[i*4+2];}
    if(!Number.isFinite(centerHeight)||centerHeight< -1e19||boundaryError>2e-5)throw Error(`local support fit failed: boundary error ${boundaryError}`);
    return {backend:'WebGPU',centerHeight:centerHeight+clearance/candidate.frame.radius,boundaryError,intersectionCorners,sourceTriangles:count,rimVertices:candidate.rim.length,clearance,rows:values};
  }finally{if(scopeOpen)await device.popErrorScope();for(const b of buffers)b.destroy();}
}

export const SUPPORT_CLIP_WGSL=/* wgsl */`
@group(0) @binding(0) var<storage,read> source:array<vec4f>;
@group(0) @binding(1) var<storage,read> bounds:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> points:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> bary:array<vec4f>;
@group(0) @binding(4) var<storage,read_write> exterior:array<vec4f>;
@group(0) @binding(5) var<storage,read_write> exteriorBary:array<vec4f>;
@compute @workgroup_size(64) fn clip(@builtin(global_invocation_id) gid:vec3u){
  let t=gid.x;if(t*3u>=arrayLength(&source)){return;}
  // A convex triangle gains at most one vertex per clipping plane: 3+6=9.
  var p:array<vec3f,9>;var b:array<vec3f,9>;var masks:array<u32,9>;var count=3u;
  for(var j=0u;j<3u;j++){
    p[j]=source[t*3u+j].xyz;b[j]=vec3f(0);b[j][j]=1.;masks[j]=0u;
    for(var plane=0u;plane<6u;plane++){let axis=plane/2u;let positive=plane%2u==0u;let limit=select(bounds[0][axis],bounds[1][axis],positive);if(p[j][axis]==limit){masks[j]|=1u<<plane;}}
  }
  for(var plane=0u;plane<6u;plane++){
    let axis=plane/2u;let positive=plane%2u==0u;let s=select(-1.,1.,positive);let limit=select(-bounds[0][axis],bounds[1][axis],positive);
    var cp:array<vec3f,9>;var cb:array<vec3f,9>;var cm:array<u32,9>;var n=0u;
    var op:array<vec3f,9>;var ob:array<vec3f,9>;var om:array<u32,9>;var on=0u;var hasOutside=false;
    for(var j=0u;j<count;j++){
      let k=(j+1u)%count;let dp=limit-s*p[j][axis];let dq=limit-s*p[k][axis];
      if(dp<0.){hasOutside=true;}
      if(dp>=0.){cp[n]=p[j];cb[n]=b[j];cm[n]=masks[j];n++;}
      if(dp<=0.){op[on]=p[j];ob[on]=b[j];om[on]=masks[j];on++;}
      if((dp>0.&&dq<0.)||(dp<0.&&dq>0.)){
        let w=dp/(dp-dq);let hit=mix(p[j],p[k],w);let weights=mix(b[j],b[k],w);let mask=(masks[j]&masks[k])|(1u<<plane);
        cp[n]=hit;cb[n]=weights;cm[n]=mask;n++;op[on]=hit;ob[on]=weights;om[on]=mask;on++;
      }
    }
    if(!hasOutside){on=0u;}
    let slot=(t*6u+plane)*10u;exterior[slot]=vec4f(f32(on),0,0,0);exteriorBary[slot]=vec4f(0);
    for(var j=0u;j<on;j++){exterior[slot+j+1u]=vec4f(op[j],f32(om[j]));exteriorBary[slot+j+1u]=vec4f(ob[j],0);}
    p=cp;b=cb;masks=cm;count=n;
  }
  points[t*10u]=vec4f(f32(count),0,0,0);bary[t*10u]=vec4f(0);
  for(var j=0u;j<count;j++){points[t*10u+j+1u]=vec4f(p[j],f32(masks[j]));bary[t*10u+j+1u]=vec4f(b[j],0);}
}
`;

export async function clipSupportVolume(device,candidate){
  if(!device||!candidate.candidates?.length)throw Error('WebGPU device and nonempty candidate triangles required');
  const data=Float32Array.from(candidate.candidates.flatMap(t=>t.vertices.flatMap(v=>[...v.p,0]))),bounds=Float32Array.from([...candidate.lo,0,...candidate.hi,0]);
  const size=candidate.candidates.length*10*16,owned=[];
  const allocate=(size,usage)=>{const b=device.createBuffer({size,usage});owned.push(b);return b;};
  device.pushErrorScope('validation');let open=true;
  try{
    const a=allocate(data.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),bb=allocate(bounds.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(a,0,data);device.queue.writeBuffer(bb,0,bounds);
    const sizes=[size,size,size*6,size*6],out=sizes.map(n=>allocate(n,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC)),read=sizes.map(n=>allocate(n,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST));
    const module=device.createShaderModule({label:'TRELLIS bounded triangle clipping',code:SUPPORT_CLIP_WGSL});
    const info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.map(m=>m.message).join('\n'));
    const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'clip'}}),bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[a,bb,...out].map((buffer,binding)=>({binding,resource:{buffer}}))});
    const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(candidate.candidates.length/64));pass.end();out.forEach((b,i)=>encoder.copyBufferToBuffer(b,0,read[i],0,sizes[i]));device.queue.submit([encoder.finish()]);
    const values=await Promise.all(read.map(async b=>{await b.mapAsync(GPUMapMode.READ);const v=new Float32Array(b.getMappedRange()).slice();b.unmap();return v;}));
    const error=await device.popErrorScope();open=false;if(error)throw Error(error.message);
    const patch=[],retained=[],boundarySegments=[];
    const polygon=(positions,weights,slot)=>{
      const count=positions[slot*40];if(!Number.isInteger(count)||count<0||count>9)throw Error('invalid GPU clipping vertex count');
      const vertices=[];for(let j=0;j<count;j++){const o=slot*40+(j+1)*4;vertices.push({p:Array.from(positions.subarray(o,o+3)),b:Array.from(weights.subarray(o,o+3)),supportPlanes:positions[o+3]});}return vertices;
    };
    const emit=(vertices,sourceTriangle,target)=>{
      const count=vertices.length;
      for(let j=1;j+1<count;j++){
        const vs=[vertices[0],vertices[j],vertices[j+1]],a=vs[0].p,b=vs[1].p,c=vs[2].p;
        const area=Math.hypot((b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]),(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]),(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]));
        if(area>1e-12)target.push({sourceTriangle,vertices:vs});
      }
    };
    // Indexed by clipping plane; each pair matches supportVolumeMesh's chart.
    const faceForPlane=[5,4,3,2,1,0],uvAxes=[[1,2],[2,1],[2,0],[0,2],[0,1],[1,0]];
    for(let i=0;i<candidate.candidates.length;i++){
      const vertices=polygon(values[0],values[1],i),sourceTriangle=candidate.candidates[i].sourceTriangle;emit(vertices,sourceTriangle,patch);
      for(let plane=0;plane<6;plane++)emit(polygon(values[2],values[3],i*6+plane),sourceTriangle,retained);
      for(let j=0;j<vertices.length;j++){
        const a=vertices[j],b=vertices[(j+1)%vertices.length];if(Math.hypot(...a.p.map((x,k)=>x-b.p[k]))<=1e-10)continue;
        const common=a.supportPlanes&b.supportPlanes;
        for(let plane=0;plane<6;plane++)if(common&(1<<plane)){
          const supportFace=faceForPlane[plane],axes=uvAxes[plane];boundarySegments.push({sourceTriangle,supportFace,supportPlane:plane,vertices:[a,b].map(v=>({...v,supportUV:axes.map(k=>(v.p[k]-candidate.lo[k])/(candidate.hi[k]-candidate.lo[k]))}))});
        }
      }
    }
    if(!patch.length)throw Error('support volume contains no source surface after clipping');
    return {backend:'WebGPU',patch,retained,boundarySegments,raw:values,sourceTriangleIds:Uint32Array.from(new Set(patch.map(t=>t.sourceTriangle))),diagnostics:{enclosure:'source and exterior partitioned together against six support planes in WebGPU',boundary:'source intersection segments mapped to support faces and UVs; not necessarily one manifold rim',globalTopologyRequired:false}};
  }finally{if(open)await device.popErrorScope();for(const b of owned)b.destroy();}
}
