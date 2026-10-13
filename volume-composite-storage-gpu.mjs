// GPU-only velocity exchange for the stationary composite candidate. Caller
// owns all state buffers and the ordering of gather -> project -> scatter.
// No readback, material update, inlet policy or simulation hook is implied.
// Consumer: volume-core joinedProducerState().lowerFaceTexture, introduced by
// fine-producer 2f7b38ae7. Recreate this binding after the producer rebuilds.
// Caller owns buffer/texture; encode after shared scatter and before fine use.
export function createCompositeLowerFaceGPU(device,{dims,lowerBuffer,lowerFaceTexture}){
  if(!Array.isArray(dims)||dims.length!==3||!dims.every(n=>Number.isSafeInteger(n)&&n>0))throw new Error('positive integer XYZ dimensions required');
  const width=Math.max(...dims),length=dims[1]*dims[2]+dims[2]*dims[0]+dims[0]*dims[1];
  if(!lowerBuffer||lowerBuffer.size!==length*4||!(lowerBuffer.usage&GPUBufferUsage.STORAGE))throw new Error('complete lower-face buffer required');
  const t=lowerFaceTexture,usage=GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING;
  if(!t||t.width!==width||t.height!==width||t.depthOrArrayLayers!==3||t.dimension!=='2d'||t.format!=='r32float'||t.mipLevelCount!==1||t.sampleCount!==1||(t.usage&usage)!==usage)throw new Error('lower-face texture must match producer XYZ: r32float max-dimension square, three layers, sampled/storage usage');
  if(Math.ceil(width/8)>device.limits.maxComputeWorkgroupsPerDimension||3>device.limits.maxComputeWorkgroupsPerDimension)throw new Error('lower-face texture dispatch exceeds device capacity');
  const shader=device.createShaderModule({label:'joined lower-face texture export',code:/* wgsl */`
@group(0) @binding(0) var<storage,read> lower:array<f32>;
@group(0) @binding(1) var planes:texture_storage_2d_array<r32float,write>;
@compute @workgroup_size(8,8,1) fn main(@builtin(global_invocation_id) q:vec3<u32>){
  if(q.x>=${width}u||q.y>=${width}u||q.z>=3u){return;}
  let dims=vec3<u32>(${dims.map(n=>`${n}u`).join(',')});
  let offsets=vec3<u32>(0u,${dims[1]*dims[2]}u,${dims[1]*dims[2]+dims[2]*dims[0]}u);
  let b=(q.z+1u)%3u;let d=(q.z+2u)%3u;
  var value=0.0;
  if(q.x<dims[b]&&q.y<dims[d]){value=lower[offsets[q.z]+q.x+dims[b]*q.y];}
  textureStore(planes,vec2<i32>(q.xy),i32(q.z),vec4<f32>(value,0.0,0.0,0.0));
}`});
  const pipeline=device.createComputePipeline({layout:'auto',compute:{module:shader,entryPoint:'main'}});
  const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:lowerBuffer}},
    {binding:1,resource:t.createView({dimension:'2d-array'})},
  ]});
  return {shader,encode(encoder){const pass=encoder.beginComputePass({label:'joined lower-face texture export'});pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(width/8),Math.ceil(width/8),3);pass.end();}};
}

export function createCompositeStorageGPU(device,layout,buffers){
  const lengths={fine:layout.fineLength,coarse:layout.coarseLength,lower:layout.lowerLength,flux:layout.faces.length};
  if(new Set(Object.values(buffers)).size!==4)throw new Error('distinct fine/coarse/lower/flux buffers required');
  for(const [key,n] of Object.entries(lengths))if(!buffers[key]||buffers[key].size!==n*4||!(buffers[key].usage&GPUBufferUsage.STORAGE))throw new Error(`${key} requires complete storage buffer`);
  const fineRows=layout.fineLength/16*3,coarseRows=layout.coarseLength/8*3,total=fineRows+layout.lowerLength+coarseRows;
  if(Math.max(total,...Object.values(lengths))>=2**24)throw new Error('storage indices exceed exact float32 representation');
  if(Math.ceil(Math.max(total,layout.faces.length)/64)>device.limits.maxComputeWorkgroupsPerDimension)throw new Error('storage dispatch exceeds device capacity');
  const rows=Array.from({length:total},()=>[]),mapping=new Float32Array(layout.faces.length*4),weights=new Float32Array(layout.faces.length*2);
  layout.faces.forEach((m,i)=>{
    mapping.set([m.fineOffset??-1,m.lowerOffset??-1,m.coarseOffset??-1,m.seam?1:0],i*4);
    weights.set([m.sign*m.area*layout.fineWidth,m.sign*m.area],i*2);
    if(m.fineOffset!==null)rows[Math.floor(m.fineOffset/16)*3+m.fineOffset%16].push([i,m.sign/(m.area*layout.fineWidth)]);
    if(m.lowerOffset!==null)rows[fineRows+m.lowerOffset].push([i,m.sign/(m.area*layout.fineWidth)]);
    if(m.coarseOffset!==null)rows[fineRows+layout.lowerLength+Math.floor(m.coarseOffset/8)*3+m.coarseOffset%8].push([i,m.sign/layout.coarseWidth**2]);
  });
  const rowData=new Float32Array(total*4),links=[];
  rows.forEach((r,i)=>{
    let kind=0,offset=Math.floor(i/3)*16+i%3;
    if(i>=fineRows&&i<fineRows+layout.lowerLength){kind=1;offset=i-fineRows;}
    else if(i>=fineRows+layout.lowerLength){kind=2;const j=i-fineRows-layout.lowerLength;offset=Math.floor(j/3)*8+j%3;}
    rowData.set([kind,offset,links.length/2,r.length],i*4);for(const link of r)links.push(...link);
  });
  if(links.length/2>=2**24)throw new Error('storage adjacency exceeds exact float32 representation');
  const owned=[],alloc=(label,data)=>{
    if(data.byteLength>Math.min(device.limits.maxBufferSize,device.limits.maxStorageBufferBindingSize))throw new Error(`${label} exceeds device buffer capacity`);
    const b=device.createBuffer({label,size:Math.max(4,data.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});owned.push(b);if(data.byteLength)device.queue.writeBuffer(b,0,data);return b;
  };
  try{
    const map=alloc('composite face storage addresses',mapping),weight=alloc('composite face storage units',weights),row=alloc('composite output owners',rowData),link=alloc('composite output contributions',new Float32Array(links));
    const gather=device.createShaderModule({label:'composite velocity gather',code:/* wgsl */`
@group(0) @binding(0) var<storage,read> mapping:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> weights:array<vec2<f32>>;
@group(0) @binding(2) var<storage,read> fine:array<f32>;
@group(0) @binding(3) var<storage,read> coarse:array<f32>;
@group(0) @binding(4) var<storage,read> lower:array<f32>;
@group(0) @binding(5) var<storage,read_write> flux:array<f32>;
fn gather(i:u32,useFine:bool){
  if(i>=${layout.faces.length}u){return;}let m=mapping[i];let w=weights[i];
  if((m.x>=0.0||m.y>=0.0)&&(m.w==0.0||useFine)){
    var v=0.0;if(m.x>=0.0){v=fine[u32(m.x)];}else{v=lower[u32(m.y)];}flux[i]=v*w.x;
  }else{flux[i]=coarse[u32(m.z)]*w.y;}
}
@compute @workgroup_size(64) fn gatherFine(@builtin(global_invocation_id) id:vec3<u32>){gather(id.x,true);}
@compute @workgroup_size(64) fn gatherCoarse(@builtin(global_invocation_id) id:vec3<u32>){gather(id.x,false);}
`});
    const scatter=device.createShaderModule({label:'composite velocity scatter',code:/* wgsl */`
@group(0) @binding(0) var<storage,read> rows:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> links:array<vec2<f32>>;
@group(0) @binding(2) var<storage,read> flux:array<f32>;
@group(0) @binding(3) var<storage,read_write> fine:array<f32>;
@group(0) @binding(4) var<storage,read_write> lower:array<f32>;
@group(0) @binding(5) var<storage,read_write> coarse:array<f32>;
@compute @workgroup_size(64) fn scatter(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;if(i>=${total}u){return;}let row=rows[i];var v=0.0;
  for(var j=0u;j<u32(row.w);j++){let link=links[u32(row.z)+j];v+=flux[u32(link.x)]*link.y;}
  // Exactly one invocation owns each destination, including omitted wall faces.
  if(row.x==0.0){fine[u32(row.y)]=v;}else if(row.x==1.0){lower[u32(row.y)]=v;}else{coarse[u32(row.y)]=v;}
}
`});
    const make=(module,entryPoint,resources)=>{
      const pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint}});
      return {pipeline,group:device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:resources.map((buffer,binding)=>({binding,resource:{buffer}}))})};
    };
    const sources=[map,weight,buffers.fine,buffers.coarse,buffers.lower,buffers.flux];
    const pipelines={fine:make(gather,'gatherFine',sources),coarse:make(gather,'gatherCoarse',sources),scatter:make(scatter,'scatter',[row,link,buffers.flux,buffers.fine,buffers.lower,buffers.coarse])};
    let destroyed=false;
    const encode=(encoder,p,count)=>{if(destroyed)throw new Error('composite storage bridge destroyed');const pass=encoder.beginComputePass({label:'composite velocity exchange'});pass.setPipeline(p.pipeline);pass.setBindGroup(0,p.group);pass.dispatchWorkgroups(Math.ceil(count/64));pass.end();};
    return {shaders:[gather,scatter],
      encodeGather(encoder,{interfaceSource}={}){if(!['fine','coarse'].includes(interfaceSource))throw new Error('explicit interface source required');encode(encoder,pipelines[interfaceSource],layout.faces.length);},
      encodeScatter(encoder){encode(encoder,pipelines.scatter,total);},
      destroy(){if(!destroyed){for(const b of owned)b.destroy();destroyed=true;}},
    };
  }catch(e){for(const b of owned)b.destroy();throw e;}
}
