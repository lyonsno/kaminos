// Fixed geometric pressure addresses, resident occupancy. No voxelization,
// readback, graph construction or shader specialization during obstacle motion.
// Stationary-wall flux only; moving-wall velocity is a separate boundary law.
export function createCompositeSolidsGPU(device,grid,{nodes,links,faces,flux,cells}){
  const n=grid.cells.length,m=grid.faces.length,owned=[];
  const buffer=(label,data)=>{const b=device.createBuffer({label,size:data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});owned.push(b);device.queue.writeBuffer(b,0,data);return b;};
  const coordinates=new Uint32Array(n*4),g=grid.geometry,h=g.cellWidth/g.fine.ratio;
  const fineShape=g.fine.max.map((v,a)=>Math.round((v-g.fine.min[a])/h));
  grid.cells.forEach((c,i)=>coordinates.set([...c.center.map((v,a)=>Math.round((v-(c.level?g.fine.min:g.min)[a])/c.width-.5)),c.level],4*i));
  const coords=buffer('resident pressure coordinates',coordinates);
  const active=buffer('resident pressure active cells',new Uint32Array(n));
  const shaders=[];
  const pipeline=(label,code,entryPoint)=>{const module=device.createShaderModule({label,code});shaders.push(module);return device.createComputePipeline({layout:'auto',compute:{module,entryPoint}});};
  const classify=pipeline('resident pressure classify',/* wgsl */`
@group(0) @binding(0) var<storage,read> coords:array<vec4<u32>>;
@group(0) @binding(1) var fine:texture_3d<u32>;
@group(0) @binding(2) var coarse:texture_3d<u32>;
@group(0) @binding(3) var<storage,read_write> active:array<u32>;
@group(0) @binding(4) var<storage,read_write> cells:array<f32>;
@compute @workgroup_size(64) fn classify(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;if(i>=arrayLength(&coords)){return;}let q=coords[i];var solid=0u;
  if(q.w==1u){solid=textureLoad(fine,vec3<i32>(q.xyz),0).x;}else{solid=textureLoad(coarse,vec3<i32>(q.xyz),0).x;}
  let next=select(1u,0u,solid!=0u);
  if(next==0u||active[i]!=next){cells[i*8u]=0.0;}
  active[i]=next;
}`, 'classify');
  const mask=pipeline('resident pressure face coefficients',/* wgsl */`
@group(0) @binding(0) var<storage,read> active:array<u32>;
@group(0) @binding(1) var<storage,read_write> faces:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read_write> flux:array<f32>;
@compute @workgroup_size(64) fn mask(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;if(i>=arrayLength(&faces)){return;}let f=faces[i];var open=active[u32(f.x)]!=0u;
  if(f.y>=0.0){open=open&&active[u32(f.y)]!=0u;}
  faces[i].z=select(0.0,f.w,open);if(!open){flux[i]=0.0;}
}`, 'mask');
  const diagonal=pipeline('resident pressure diagonal',/* wgsl */`
@group(0) @binding(0) var<storage,read_write> nodes:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> links:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> faces:array<vec4<f32>>;
@compute @workgroup_size(64) fn diagonal(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;if(i>=arrayLength(&nodes)){return;}let row=nodes[i];var sum=0.0;
  for(var j=0u;j<u32(row.y);j++){sum+=faces[u32(links[u32(row.x)+j].z)].z;}
  nodes[i].w=sum;
}`, 'diagonal');
  const group=(p,resources)=>device.createBindGroup({layout:p.getBindGroupLayout(0),entries:resources.map((resource,binding)=>({binding,resource:resource.createView?resource.createView():{buffer:resource}}))});
  const maskGroup=group(mask,[active,faces,flux]),diagonalGroup=group(diagonal,[nodes,links,faces]);
  let bound=null,destroyed=false;
  function validate(texture,shape,label){
    if(!texture||texture.dimension!=='3d'||texture.format!=='r32uint'||!(texture.usage&GPUTextureUsage.TEXTURE_BINDING)||texture.width!==shape[0]||texture.height!==shape[1]||texture.depthOrArrayLayers!==shape[2]||texture.mipLevelCount!==1||texture.sampleCount!==1)
      throw Error(`${label} requires complete single-mip r32uint sampled solid texture of shape ${shape}`);
  }
  return {active,shaders,
    bind({fine,coarse}){
      if(destroyed)throw Error('resident pressure solids destroyed');
      validate(fine,fineShape,'fine');validate(coarse,g.shape,'coarse');
      if(bound?.fine!==fine||bound?.coarse!==coarse)bound={fine,coarse,group:group(classify,[coords,fine,coarse,active,cells])};
    },
    encode(encoder){
      if(destroyed||!bound)throw Error('resident pressure solids must be bound before encoding');
      const pass=encoder.beginComputePass({label:'resident pressure occupancy coefficients'});
      for(const [p,b,count] of [[classify,bound.group,n],[mask,maskGroup,m],[diagonal,diagonalGroup,n]]){pass.setPipeline(p);pass.setBindGroup(0,b);pass.dispatchWorkgroups(Math.ceil(count/64));}pass.end();
    },
    destroy(){if(!destroyed){destroyed=true;owned.forEach(b=>b.destroy());}}
  };
}
