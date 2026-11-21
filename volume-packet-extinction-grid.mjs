// One stationary cell owns each live center's reference-area optical volume.
// Coordinates and path lengths are in the same Fine-domain units as the bundle.
export function createFixedExtinctionGrid(device, declarations) {
 const module=device.createShaderModule({label:'particle-derived fixed extinction',code:declarations+`
struct Grid {origin:vec4<f32>,dims:vec4<u32>,cell:vec4<f32>}
@group(0) @binding(13) var<uniform> grid:Grid;
@group(0) @binding(14) var<storage,read_write> densityBits:array<atomic<u32>>;
@group(0) @binding(15) var<storage,read> density:array<f32>;
fn cellId(c:vec3<i32>)->u32{return u32(c.x)+grid.dims.x*(u32(c.y)+grid.dims.y*u32(c.z));}
@compute @workgroup_size(64) fn depositCenters(@builtin(global_invocation_id) id:vec3<u32>){
 if(id.x>=plan.count.x){return;}let p=medium[id.x];
 if(p.anchor.w<=0||p.shape.w<=0){return;}
 let sigma=particleLightExtinction(p,material);if(sigma<=0){return;}
 let xyz=(p.anchor.xyz-grid.origin.xyz)/grid.cell.xyz;
 if(any(xyz<vec3<f32>(0))||any(xyz>=vec3<f32>(grid.dims.xyz))){return;}
 let cell=cellId(vec3<i32>(xyz));let radius=particleLightBaseRadius(p,material);
 let fade=select(1.0,particleLifeFade(p.motion.w,material.lifeControl.y),material.lifeControl.x>0);
 let amount=sigma*fade*p.shape.w*radius.x*radius.y*grid.cell.w;
 var old=atomicLoad(&densityBits[cell]);loop{
  let result=atomicCompareExchangeWeak(&densityBits[cell],old,bitcast<u32>(bitcast<f32>(old)+amount));
  if(result.exchanged){break;}old=result.old_value;
 }
}
@vertex fn cover(@builtin(vertex_index) v:u32)->@builtin(position) vec4<f32>{
 let xy=array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3));
 return vec4<f32>(xy[v],0,1);
}
@fragment fn intervalTau(@builtin(position) pixel:vec4<f32>)->@location(0) vec4<f32>{
 let at=vec2<u32>(pixel.xy);let tile=at/plan.image.xy;let k=tile.x+tile.y*plan.image.z;
 let bi=k/plan.image.w;if(bi>=plan.count.y){return vec4<f32>(0);}
 let b=bundles[bi];if(b.weight.x<=0){return vec4<f32>(0);}
 let xy=at%plan.image.xy;let uv=(vec2<f32>(xy)+.5)/vec2<f32>(plan.image.xy)*2.0-1.0;
 let o=(b.origin.xyz+b.right.xyz*(uv.x*b.right.w)-b.up.xyz*(uv.y*b.up.w)-grid.origin.xyz)/grid.cell.xyz;
 let v=b.forward.xyz/grid.cell.xyz;let dims=vec3<i32>(grid.dims.xyz);
 let section=k%plan.image.w;let ds=(b.forward.w-b.origin.w)/f32(plan.image.w);
 var t=b.origin.w+f32(section)*ds;var end=b.origin.w+f32(section+1u)*ds;
 let solidTile=vec2<u32>(bi%plan.solid.x,bi/plan.solid.x);
 end=min(end,mix(b.origin.w,b.forward.w,textureLoad(solids,vec2<i32>(xy+solidTile*plan.image.xy),0)));
 // Clip the finite segment first; parallel face rays use half-open cell ownership.
 for(var a=0u;a<3u;a++){if(v[a]==0){if(o[a]<0||o[a]>=f32(dims[a])){return vec4<f32>(0);}}
  else{let l=-o[a]/v[a];let h=(f32(dims[a])-o[a])/v[a];t=max(t,min(l,h));end=min(end,max(l,h));}}
 if(t>=end){return vec4<f32>(0);}
 let pos=o+t*v;let step=vec3<i32>(sign(v));var c=clamp(vec3<i32>(select(floor(pos),ceil(pos)-1.0,v<vec3<f32>(0))),vec3<i32>(0),dims-1);
 var tau=0.0;
 loop{
  var next=vec3<f32>(3.402823e38);
  for(var a=0u;a<3u;a++){if(step[a]!=0){next[a]=(f32(c[a]+select(0,1,step[a]>0))-o[a])/v[a];}}
  let edge=min(min(next.x,next.y),next.z);
  tau+=density[cellId(c)]*max(0.0,min(edge,end)-t);
  if(edge>=end){break;}c+=select(vec3<i32>(0),step,next<=vec3<f32>(edge));t=max(t,edge);
  if(any(c<vec3<i32>(0))||any(c>=dims)){break;}
 }
 return vec4<f32>(0,0,0,tau);
}`});
 const deposit=device.createComputePipeline({label:'fixed extinction deposit',layout:'auto',compute:{module,entryPoint:'depositCenters'}});
 const march=device.createRenderPipeline({label:'fixed extinction interval march',layout:'auto',vertex:{module,entryPoint:'cover'},fragment:{module,entryPoint:'intervalTau',targets:[{format:'rgba16float',writeMask:GPUColorWrite.ALPHA}]}});
 const params=device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 let cells=null;
 const bind=(pipeline,entries)=>device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:entries.map(([binding,b])=>({binding,resource:b.createView?b.createView():{buffer:b}}))});
 return {
  encode(encoder,{material,width,plan,resources:r,bundleBuffer,profileWrites,retire,gridOnly}){
   const {dims,pitch,origin}=material.domain;
   if(!Number.isSafeInteger(width)||width<1||dims.length!==3||!dims.every(n=>Number.isSafeInteger(n)&&n>0)||origin.length!==3||!origin.every(Number.isFinite)||!(pitch>0&&Number.isFinite(pitch)))throw Error('Invalid fixed extinction domain');
   const shape=dims.map(n=>Math.ceil(n*width/dims[0])),cell=dims.map((n,i)=>n*pitch/shape[i]),bytes=4*shape.reduce((a,b)=>a*b,1);
   if(!Number.isSafeInteger(bytes)||bytes>Math.min(device.limits.maxBufferSize,device.limits.maxStorageBufferBindingSize))throw Error('Fixed extinction grid exceeds storage capacity');
   if(cells?.size!==bytes){if(cells)retire([cells]);cells=device.createBuffer({label:'fixed extinction density',size:bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});}
   const data=new ArrayBuffer(48),f=new Float32Array(data);f.set(origin);new Uint32Array(data).set(shape,4);
   // Reference finite Gaussian profile area, as in the material packet builder.
   f.set([...cell,6.1281/(cell[0]*cell[1]*cell[2])],8);device.queue.writeBuffer(params,0,data);
   encoder.clearBuffer(cells);
   const p=encoder.beginComputePass({label:'particle extinction to fixed cells',...profileWrites('grid-deposit')});
   p.setPipeline(deposit);p.setBindGroup(0,bind(deposit,[[0,material.particles],[1,material.options],[4,r.plan],[13,params],[14,cells]]));
   p.dispatchWorkgroups(Math.ceil(plan.slots/64));p.end();
   const pass=encoder.beginRenderPass({label:'fixed cells to ordered extinction',...profileWrites('grid-march'),colorAttachments:[{view:r.atlas.createView(),loadOp:gridOnly?'clear':'load',clearValue:{r:0,g:0,b:0,a:0},storeOp:'store'}]});
   pass.setPipeline(march);pass.setBindGroup(0,bind(march,[[2,bundleBuffer],[4,r.plan],[5,r.solids],[13,params],[15,cells]]));pass.draw(3);pass.end();
   return {shape,bytes:bytes+48,slots:plan.slots,measure:'center-owned reference XY area times acquired interval; Fine-domain centers only'};
  },
  dispose(retire){retire([params,cells]);cells=null;}
 };
}
