// Static geometry owns stencils and conservative boundary masks. Live source
// values own the prepared incident texture. The camera receives neither BVH
// nor triangles. Resources are scoped to the enclosing geometry gather handle.
export function preparedSmokePlan(coarseDimensions, factor, limits) {
  if (!Array.isArray(coarseDimensions) || coarseDimensions.length!==3 ||
      !coarseDimensions.every(n=>Number.isInteger(n)&&n>0) || !Number.isInteger(factor)||factor<1)
    throw new Error('prepared smoke dimensions and refinement require positive integers');
  const dimensions=coarseDimensions.map(n=>n*factor), bins=dimensions.map(n=>n+1);
  if(dimensions.some(n=>n>limits.maxTextureDimension3D)) throw new Error('prepared smoke exceeds 3D texture capacity');
  const sampleCount=dimensions.reduce((a,b)=>a*b,1),binCount=bins.reduce((a,b)=>a*b,1);
  const weightBytes=sampleCount*32,maskBytes=(sampleCount+binCount)*4;
  for(const [name,size] of [['weights',weightBytes],['masks',maskBytes]])
    if(!Number.isSafeInteger(size)||size>limits.maxStorageBufferBindingSize) throw new Error(`prepared smoke ${name} needs ${size} bytes; device supports ${limits.maxStorageBufferBindingSize}`);
  return {dimensions,bins,sampleCount,binCount,weightBytes,maskBytes,factor,cameraTriangleTests:0};
}

export function createPreparedSmoke(device,{nodes,triangles,nodeCount,source,coarseDimensions,factor=4}) {
  const plan=preparedSmokePlan(coarseDimensions,factor,device.limits), owned=[];
  try {
    const storage=(label,size)=>{const b=device.createBuffer({label,size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});owned.push(b);return b;};
    const weights=storage('prepared smoke static receiver weights',plan.weightBytes);
    const masks=storage('prepared smoke solid cells and interpolation boundaries',plan.maskBytes);
    const texture=device.createTexture({label:'prepared geometry-aware smoke incident radiance',dimension:'3d',size:plan.dimensions,format:'rgba32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});owned.push(texture);
    const grid=plan.dimensions[0],coarse=coarseDimensions[0],width=device.limits.maxComputeWorkgroupsPerDimension*64;
    const constants=`const FINE:vec3<u32>=vec3<u32>(${plan.dimensions.map(n=>n+'u').join(',')});
      const COARSE:vec3<u32>=vec3<u32>(${coarseDimensions.map(n=>n+'u').join(',')});
      const FINE_COUNT:u32=${plan.sampleCount}u; const BIN_COUNT:u32=${plan.binCount}u;
      const NODE_COUNT:u32=${nodeCount}u; const DISPATCH_WIDTH:u32=${width}u;
      const FINE_PITCH:f32=${2/grid}; const COARSE_PITCH:f32=${2/coarse};`;
    const module=device.createShaderModule({label:'prepare and update smoke lighting',code:constants+PREPARED_SMOKE_WGSL});
    const prepare=device.createComputePipeline({label:'static smoke stencil and boundary preparation',layout:'auto',compute:{module,entryPoint:'prepareSmoke'}});
    const update=device.createComputePipeline({label:'update prepared smoke lighting from live receivers',layout:'auto',compute:{module,entryPoint:'updateSmoke'}});
    const prepareGroup=device.createBindGroup({layout:prepare.getBindGroupLayout(0),entries:[nodes,triangles,weights,masks].map((b,binding)=>({binding,resource:{buffer:b}}))});
    const updateGroup=device.createBindGroup({layout:update.getBindGroupLayout(0),entries:[{binding:2,resource:{buffer:weights}},{binding:4,resource:source.createView()},{binding:5,resource:texture.createView()}]});
    const dispatch=count=>{const groups=Math.ceil(count/64),limit=device.limits.maxComputeWorkgroupsPerDimension;
      if(groups>limit*limit)throw new Error('prepared smoke dispatch exceeds device capacity');
      return [Math.min(groups,limit),Math.ceil(groups/limit)];};
    let prepared=false,updates=0;
    const metadata={identity:'prepared-geometry-visible-v1',texture,masks,dimensions:plan.dimensions,
      coarseDimensions:coarseDimensions.slice(),refinement:factor,weightBytes:plan.weightBytes,maskBytes:plan.maskBytes,
      cameraTriangleTests:0,boundaryPolicy:'zero-solid-cell-nearest-clear-cell-trilinear-clear-stencil',
      staticPreparations:0,updates:0};
    return {texture,metadata,encode(encoder){
      if(!prepared){const pass=encoder.beginComputePass({label:'prepare static smoke interpolation'});pass.setPipeline(prepare);pass.setBindGroup(0,prepareGroup);pass.dispatchWorkgroups(...dispatch(Math.max(plan.sampleCount,plan.binCount)));pass.end();prepared=true;metadata.staticPreparations++;}
      const pass=encoder.beginComputePass({label:'reconstruct live smoke illumination once per volume'});pass.setPipeline(update);pass.setBindGroup(0,updateGroup);pass.dispatchWorkgroups(...dispatch(plan.sampleCount));pass.end();metadata.updates=++updates;
    },destroy(){for(const r of owned)r.destroy();}};
  } catch(error){for(const r of owned)r.destroy();throw error;}
}

export const PREPARED_SMOKE_WGSL=`
struct SmokeNode {lo:vec4<f32>,hi:vec4<f32>,range:vec4<u32>}
struct SmokeTriangle {a:vec4<f32>,e1:vec4<f32>,e2:vec4<f32>}
struct SmokeWeights {values:array<f32,8>}
@group(0) @binding(0) var<storage,read> nodes:array<SmokeNode>;
@group(0) @binding(1) var<storage,read> triangles:array<SmokeTriangle>;
@group(0) @binding(2) var<storage,read_write> weights:array<SmokeWeights>;
@group(0) @binding(3) var<storage,read_write> masks:array<u32>;
@group(0) @binding(4) var incident:texture_3d<f32>;
@group(0) @binding(5) var preparedIncident:texture_storage_3d<rgba32float,write>;
fn smokeCell(id:u32,dims:vec3<u32>)->vec3<u32>{return vec3<u32>(id%dims.x,(id/dims.x)%dims.y,id/(dims.x*dims.y));}
fn boxesOverlap(lo:vec3<f32>,hi:vec3<f32>,a:vec3<f32>,b:vec3<f32>)->bool{return all(hi>=a)&&all(lo<=b);}
fn axisSeparates(axis:vec3<f32>,a:vec3<f32>,b:vec3<f32>,c:vec3<f32>,half:vec3<f32>)->bool {
  let p=vec3<f32>(dot(axis,a),dot(axis,b),dot(axis,c));let radius=dot(abs(axis),half);
  // Tolerance expands occupied space; it never opens cracks in boundaries.
  let tolerance=0.000002*length(axis);
  return min(p.x,min(p.y,p.z))>radius+tolerance||max(p.x,max(p.y,p.z))< -radius-tolerance;
}
fn triangleBox(t:SmokeTriangle,lo:vec3<f32>,hi:vec3<f32>)->bool {
  let center=(lo+hi)*0.5;let half=(hi-lo)*0.5;
  let a=t.a.xyz-center;let b=a+t.e1.xyz;let c=a+t.e2.xyz;
  if(axisSeparates(cross(t.e1.xyz,t.e2.xyz),a,b,c,half)){return false;}
  let edges=array<vec3<f32>,3>(t.e1.xyz,t.e2.xyz,t.e2.xyz-t.e1.xyz);
  let axes=array<vec3<f32>,3>(vec3<f32>(1,0,0),vec3<f32>(0,1,0),vec3<f32>(0,0,1));
  for(var i=0u;i<3u;i++){
    if(axisSeparates(axes[i],a,b,c,half)){return false;}
    for(var j=0u;j<3u;j++){if(axisSeparates(cross(edges[i],axes[j]),a,b,c,half)){return false;}}
  }
  return true;
}
fn occupiedBox(lo:vec3<f32>,hi:vec3<f32>)->bool {
  var n=0u;
  loop {if(n>=NODE_COUNT){break;}let node=nodes[n];
    if(!boxesOverlap(lo-vec3<f32>(0.000002),hi+vec3<f32>(0.000002),node.lo.xyz,node.hi.xyz)){n=node.range.x;continue;}
    if(node.range.z==0u){n++;continue;}
    for(var t=node.range.y;t<node.range.y+node.range.z;t++){if(triangleBox(triangles[t],lo,hi)){return true;}}
    n=node.range.x;
  }
  return false;
}
fn segmentBox(p:vec3<f32>,d:vec3<f32>,lo:vec3<f32>,hi:vec3<f32>)->bool {
  var near=0.0;var far=1.0;
  for(var a=0u;a<3u;a++){
    if(abs(d[a])<1e-20){if(p[a]<lo[a]||p[a]>hi[a]){return false;}}
    else{let t0=(lo[a]-p[a])/d[a];let t1=(hi[a]-p[a])/d[a];near=max(near,min(t0,t1));far=min(far,max(t0,t1));}
  }
  return far>=near;
}
fn visibleReceiver(p:vec3<f32>,receiver:vec3<f32>)->bool {
  let d=receiver-p;if(dot(d,d)==0.0){return true;}var n=0u;
  loop {if(n>=NODE_COUNT){break;}let node=nodes[n];
    if(!segmentBox(p,d,node.lo.xyz-vec3<f32>(0.000002),node.hi.xyz+vec3<f32>(0.000002))){n=node.range.x;continue;}
    if(node.range.z==0u){n++;continue;}
    for(var i=node.range.y;i<node.range.y+node.range.z;i++){
      let tri=triangles[i];let h=cross(d,tri.e2.xyz);let det=dot(tri.e1.xyz,h);
      if(abs(det)<=1e-12*length(tri.e1.xyz)*length(tri.e2.xyz)*length(d)){continue;}
      let s=p-tri.a.xyz;let u=dot(s,h)/det;let q=cross(s,tri.e1.xyz);let v=dot(d,q)/det;let t=dot(tri.e2.xyz,q)/det;
      if(u>=-0.000002&&v>=-0.000002&&u+v<=1.000002&&t>=0.0&&t<=1.0){return false;}
    }
    n=node.range.x;
  }
  return true;
}
@compute @workgroup_size(64)
fn prepareSmoke(@builtin(global_invocation_id) gid:vec3<u32>){
  let id=gid.x+gid.y*DISPATCH_WIDTH;
  if(id<BIN_COUNT){
    let b=vec3<f32>(smokeCell(id,FINE+vec3<u32>(1)));
    let lo=max(vec3<f32>(-1),vec3<f32>(-1)+(b-vec3<f32>(0.5))*FINE_PITCH);
    let hi=min(vec3<f32>(-1)+vec3<f32>(FINE)*FINE_PITCH,vec3<f32>(-1)+(b+vec3<f32>(0.5))*FINE_PITCH);
    masks[FINE_COUNT+id]=select(0u,1u,occupiedBox(lo,hi));
  }
  if(id>=FINE_COUNT){return;}
  let cell=smokeCell(id,FINE);let lo=vec3<f32>(-1)+vec3<f32>(cell)*FINE_PITCH;
  let blocked=occupiedBox(lo,lo+vec3<f32>(FINE_PITCH));masks[id]=select(0u,1u,blocked);
  let p=lo+vec3<f32>(FINE_PITCH*0.5);let q=(p+vec3<f32>(1))/COARSE_PITCH-vec3<f32>(0.5);
  let base=vec3<i32>(floor(q));let w=fract(q);var total=0.0;
  for(var i=0u;i<8u;i++){
    let offset=vec3<u32>(i&1u,(i>>1u)&1u,(i>>2u)&1u);
    let c=clamp(base+vec3<i32>(offset),vec3<i32>(0),vec3<i32>(COARSE)-vec3<i32>(1));
    let receiver=vec3<f32>(-1)+(vec3<f32>(c)+vec3<f32>(0.5))*COARSE_PITCH;
    var weight=0.0;
    if(!blocked&&visibleReceiver(p,receiver)){let v=select(vec3<f32>(1)-w,w,offset==vec3<u32>(1));weight=v.x*v.y*v.z;}
    weights[id].values[i]=weight;total+=weight;
  }
  if(total>0.0){for(var i=0u;i<8u;i++){weights[id].values[i]/=total;}}
}
@compute @workgroup_size(64)
fn updateSmoke(@builtin(global_invocation_id) gid:vec3<u32>){
  let id=gid.x+gid.y*DISPATCH_WIDTH;if(id>=FINE_COUNT){return;}
  let cell=smokeCell(id,FINE);let p=vec3<f32>(-1)+(vec3<f32>(cell)+vec3<f32>(0.5))*FINE_PITCH;
  let base=vec3<i32>(floor((p+vec3<f32>(1))/COARSE_PITCH-vec3<f32>(0.5)));var sum=vec3<f32>(0);
  for(var i=0u;i<8u;i++){
    let weight=weights[id].values[i];if(weight==0.0){continue;}
    let offset=vec3<i32>(i32(i&1u),i32((i>>1u)&1u),i32((i>>2u)&1u));
    let c=clamp(base+offset,vec3<i32>(0),vec3<i32>(COARSE)-vec3<i32>(1));sum+=textureLoad(incident,c,0).rgb*weight;
  }
  textureStore(preparedIncident,vec3<i32>(cell),vec4<f32>(sum,1));
}
`;
