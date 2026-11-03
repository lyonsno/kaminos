// Emission-weighted, axis-aligned binary partition. Tree topology is fixed;
// split axes and cell boundaries follow the source with hysteresis on the GPU.
export function spatialRegionTree(count){
  if(!Number.isInteger(count)||count<1)throw Error('positive spatial region count required');
  const nodes=[],levels=[];let leaf=0;
  function add(budget,depth){const id=nodes.length;nodes.push(null);(levels[depth]??=[]).push(id);
    if(budget===1)nodes[id]={left:0,right:0,budget,leaf:leaf++};
    else{const left=add(Math.floor(budget/2),depth+1),right=add(Math.ceil(budget/2),depth+1);nodes[id]={left,right,budget,leaf:0};}return id;}
  add(count,0);return {nodes,levels};
}
export function reduceSpatialRegions(values,dims,count,gain=1){
  spatialRegionTree(count);
  const pitch=2/dims[0],floor=pitch*pitch/4,rows=[];
  function visit(lo,hi,budget,fraction){
    const e=[0,0,0],m=[0,0,0],m2=[0,0,0];let w=0;
    for(let z=lo[2];z<hi[2];z++)for(let y=lo[1];y<hi[1];y++)for(let x=lo[0];x<hi[0];x++){
      const at=4*(x+dims[0]*(y+dims[1]*z)),p=[x,y,z].map(c=>-1+(c+.5)*pitch);
      const rgb=[0,1,2].map(c=>Math.max(0,values[at+c])*gain*pitch**3*fraction),v=rgb.reduce((a,b)=>a+b,0);w+=v;
      for(let c=0;c<3;c++){e[c]+=rgb[c];m[c]+=p[c]*v;m2[c]+=p[c]*p[c]*v;}
    }
    const position=m.map(v=>w?v/w:0),variance=m2.map((v,c)=>Math.max(0,w?v/w-position[c]**2:0));
    if(budget===1){rows.push({position,energy:e,radiusSquared:variance.reduce((a,b)=>a+b,0)+floor});return;}
    let axis=-1;for(let a=0;a<3;a++)if(hi[a]-lo[a]>1&&(axis<0||variance[a]>variance[axis]))axis=a;
    const left=Math.floor(budget/2),right=budget-left;
    if(axis<0){visit(lo,hi,left,fraction*left/budget);visit(lo,hi,right,fraction*right/budget);return;}
    const cut=Math.max(lo[axis]+1,Math.min(hi[axis]-1,w?Math.round((position[axis]+1)/pitch):Math.floor((lo[axis]+hi[axis])/2)));
    const lhi=hi.slice(),rlo=lo.slice();lhi[axis]=cut;rlo[axis]=cut;visit(lo,lhi,left,fraction);visit(rlo,hi,right,fraction);
  }
  visit([0,0,0],dims,count,1);return rows;
}

export function createSpatialReducer(device,count,texture){
  const tree=spatialRegionTree(count),shards=16,owned=[];
  const buffer=(label,size,usage=GPUBufferUsage.STORAGE)=>{const b=device.createBuffer({label,size,usage:usage|GPUBufferUsage.COPY_DST});owned.push(b);return b;};
  // lo.xyz / fractional energy, hi.xyz / previous axis, child indices / leaf
  // budget / output index, then previous split coordinate and initialized bit.
  const state=buffer('spatial emission partition tree',tree.nodes.length*64);
  const data=new Float32Array(tree.nodes.length*16),words=new Uint32Array(data.buffer);
  tree.nodes.forEach((n,i)=>{words.set([n.left,n.right,n.budget,n.leaf],i*16+8);});
  const partials=buffer('parallel spatial emission moments',tree.nodes.length*shards*48);
  const params=tree.levels.map((ids,i)=>{const b=buffer('spatial emission level '+i,32,GPUBufferUsage.UNIFORM);return b;});
  const ids=buffer('spatial emission level node indices',tree.nodes.length*4);
  device.queue.writeBuffer(ids,0,new Uint32Array(tree.levels.flat()));
  const module=device.createShaderModule({label:'three-axis emission partition',code:`const SHARDS:u32=${shards}u;\n`+SPATIAL_REGIONS_WGSL});
  const scan=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'scan'}});
  const finish=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'finish'}});
  let source=null,dimensions='',groups=[];
  return {encode(field){
    const key=field.dimensions.join(',');
    if(dimensions!==key){device.queue.writeBuffer(state,0,data);dimensions=key;}
    if(source!==field.texture){source=field.texture;groups=params.map(p=>{
      const resources=[{binding:0,resource:source.createView()},{binding:1,resource:{buffer:state}},{binding:2,resource:{buffer:partials}},{binding:3,resource:{buffer:p}},{binding:4,resource:{buffer:ids}},{binding:5,resource:texture.createView()}];
      return [scan,finish].map((pipeline,i)=>device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:resources.filter(e=>i===0?e.binding!==5:e.binding!==0)}));
    });}
    let offset=0;
    const encoder=device.createCommandEncoder({label:'spatial emission reduction'});
    tree.levels.forEach((level,i)=>{
      const p=new ArrayBuffer(32),f=new Float32Array(p),u=new Uint32Array(p);f[0]=field.gain;u[1]=offset;f[2]=2/field.dimensions[0];u[3]=i;u.set(field.dimensions,4);device.queue.writeBuffer(params[i],0,p);offset+=level.length;
      const a=encoder.beginComputePass();a.setPipeline(scan);a.setBindGroup(0,groups[i][0]);a.dispatchWorkgroups(shards,level.length);a.end();
      const b=encoder.beginComputePass();b.setPipeline(finish);b.setBindGroup(0,groups[i][1]);b.dispatchWorkgroups(level.length);b.end();
    });device.queue.submit([encoder.finish()]);
  },destroy(){for(const b of owned)b.destroy();}};
}
export const SPATIAL_REGIONS_WGSL=/* wgsl */`
struct Region {lo:vec4<f32>,hi:vec4<f32>,tree:vec4<u32>,history:vec4<f32>}
struct Moments {energy:vec4<f32>,first:vec4<f32>,second:vec4<f32>}
struct Params {gain:f32,offset:u32,pitch:f32,level:u32,dims:vec4<u32>}
@group(0) @binding(0) var source:texture_3d<f32>;
@group(0) @binding(1) var<storage,read_write> regions:array<Region>;
@group(0) @binding(2) var<storage,read_write> partials:array<Moments>;
@group(0) @binding(3) var<uniform> params:Params;
@group(0) @binding(4) var<storage,read> indices:array<u32>;
@group(0) @binding(5) var output:texture_storage_2d<rgba32float,write>;
var<workgroup> sums:array<Moments,64>;
@compute @workgroup_size(64)
fn scan(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3<u32>){
 let id=indices[params.offset+group.y];let dims=textureDimensions(source);
 var r=regions[id];
 if(params.level==0u){r.lo=vec4<f32>(0,0,0,1);r.hi=vec4<f32>(vec3<f32>(dims),r.hi.w);}
 let lo=vec3<u32>(r.lo.xyz);let size=vec3<u32>(r.hi.xyz)-lo;
 var m:Moments;let pitch=params.pitch;
 for(var i=group.x*64u+lane;i<size.x*size.y*size.z;i+=SHARDS*64u){
  let c=lo+vec3<u32>(i%size.x,(i/size.x)%size.y,i/(size.x*size.y));
  let rgb=max(textureLoad(source,vec3<i32>(c),0).rgb,vec3<f32>(0))*params.gain*pitch*pitch*pitch*r.lo.w;
  let w=rgb.x+rgb.y+rgb.z;let p=-vec3<f32>(1)+(vec3<f32>(c)+vec3<f32>(.5))*pitch;
  m.energy+=vec4<f32>(rgb,w);m.first+=vec4<f32>(p*w,0);m.second+=vec4<f32>(p*p*w,0);
 }
 sums[lane]=m;workgroupBarrier();
 for(var stride=32u;stride>0u;stride/=2u){if(lane<stride){sums[lane].energy+=sums[lane+stride].energy;sums[lane].first+=sums[lane+stride].first;sums[lane].second+=sums[lane+stride].second;}workgroupBarrier();}
 if(lane==0u){partials[id*SHARDS+group.x]=sums[0];}
}
@compute @workgroup_size(1)
fn finish(@builtin(workgroup_id) group:vec3<u32>){
 let id=indices[params.offset+group.x];var r=regions[id];var m:Moments;
 if(params.level==0u){r.lo=vec4<f32>(0,0,0,1);r.hi=vec4<f32>(vec3<f32>(params.dims.xyz),r.hi.w);}
 for(var i=0u;i<SHARDS;i++){let p=partials[id*SHARDS+i];m.energy+=p.energy;m.first+=p.first;m.second+=p.second;}
 let w=m.energy.w;let position=m.first.xyz/max(w,1e-30);let variance=max(vec3<f32>(0),m.second.xyz/max(w,1e-30)-position*position);
 if(r.tree.z==1u){
  textureStore(output,vec2<i32>(i32(r.tree.w),0),vec4<f32>(position,variance.x+variance.y+variance.z+params.pitch*params.pitch*.25));
  textureStore(output,vec2<i32>(i32(r.tree.w),1),m.energy);return;
 }
 var axis=3u;
 for(var a=0u;a<3u;a++){if(r.hi[a]-r.lo[a]>1.0){if(axis==3u){axis=a;}else if(variance[a]>variance[axis]){axis=a;}}}
 var left=regions[r.tree.x];var right=regions[r.tree.y];left.lo=r.lo;right.lo=r.lo;left.hi=vec4<f32>(r.hi.xyz,left.hi.w);right.hi=vec4<f32>(r.hi.xyz,right.hi.w);
 if(axis==3u){left.lo.w*=f32(left.tree.z)/f32(r.tree.z);right.lo.w*=f32(right.tree.z)/f32(r.tree.z);}
 else{
  let oldAxis=u32(r.hi.w);
  if(r.history.y>0.0&&r.hi[oldAxis]-r.lo[oldAxis]>1.0&&variance[oldAxis]*1.15>=variance[axis]){axis=oldAxis;}
  var center=(r.lo[axis]+r.hi[axis])*.5;if(w>0.0){center=(position[axis]+1.0)/params.pitch;}
  var cut=clamp(floor(center+.5),r.lo[axis]+1.0,r.hi[axis]-1.0);
  if(r.history.y>0.0&&axis==oldAxis&&abs(center-r.history.x)<=.75){cut=clamp(r.history.x,r.lo[axis]+1.0,r.hi[axis]-1.0);}
  left.hi[axis]=cut;right.lo[axis]=cut;r.hi.w=f32(axis);r.history=vec4<f32>(cut,1,0,0);regions[id]=r;
 }
 regions[r.tree.x]=left;regions[r.tree.y]=right;
}
`;
