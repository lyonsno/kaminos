// First separation checkpoint: material/forces/transport keep their grid;
// only pressure is restricted. This is not a coarse dynamics implementation.
export function pressureResolutionPlan({ dims, mode = 'off', solver = 'converged', inflow = false, joined = false } = {}) {
  if (!Array.isArray(dims) || dims.length !== 3 || !dims.every(n => Number.isInteger(n) && n > 0)) throw Error('Invalid material dimensions');
  const divisor = mode === 'half' ? 2 : 1;
  const reason = !['off', 'equal', 'half'].includes(mode) ? 'unknown-mode'
    : mode === 'off' ? null
    : solver !== 'converged' ? 'requires-converged-pressure'
    : inflow ? 'floor-inflow-not-yet-restricted'
    : joined ? 'joined-boundary-not-supported'
    : dims.some(n => n % divisor) ? 'nonintegral-pressure-dimensions' : null;
  const effective = reason ? 'off' : mode;
  return { requested: mode, effective, materialDims: [...dims], pressureDims: dims.map(n => n / (effective === 'off' ? 1 : divisor)), divisor: effective === 'off' ? 1 : divisor, reason };
}

// Cell-average scalars and upper-face velocities have different restriction
// stencils. Velocity is stored in cell-displacement units, not world units.
// Dividing the face mean by r makes coarse divergence equal the volume mean
// of fine divergence; therefore the expansion target needs NO extra r factor.
export function restrictPressureReference({ dims, divisor, fluid, expansion, solids }) {
  const coarse = dims.map(n => n / divisor);
  if (coarse.some(n => !Number.isInteger(n) || n < 1)) throw Error('Nonintegral restriction');
  const count = coarse.reduce((a,b) => a*b,1), data = new Float32Array(count * 16), burn = new Float32Array(count), mask = new Uint32Array(count);
  const index = ([x,y,z], d) => x + d[0] * (y + d[1] * z);
  for (let z=0; z<coarse[2]; z++) for(let y=0;y<coarse[1];y++) for(let x=0;x<coarse[0];x++) {
    const c=[x,y,z], ci=index(c,coarse), origin=c.map(v=>v*divisor);
    for(let k=0;k<divisor;k++) for(let j=0;j<divisor;j++) for(let i=0;i<divisor;i++) {
      const p=[origin[0]+i,origin[1]+j,origin[2]+k], fi=index(p,dims);
      mask[ci] |= solids?.[fi] ? 1 : 0;
      if (!solids?.[fi]) burn[ci] += (expansion?.[fi] ?? 0) / divisor**3;
      for(let s=4;s<16;s++) data[ci*16+s] += fluid[fi*16+s] / divisor**3;
      for(let axis=0;axis<3;axis++) if ([i,j,k][axis] === divisor-1) {
        const next=[...p]; next[axis]++;
        const blocked = solids?.[fi] || (next[axis]<dims[axis] && solids?.[index(next,dims)]);
        if (!blocked) data[ci*16+axis] += fluid[fi*16+axis] / divisor**3;
      }
    }
  }
  return { dims:coarse, fluid:data, expansion:burn, solids:mask };
}

export const PRESSURE_TRANSFER_WGSL = /* wgsl */`
struct Shape { fine: vec4<u32>, coarse: vec4<u32>, bounds: vec4<f32> };
@group(0) @binding(0) var<uniform> shape: Shape;
@group(0) @binding(1) var<storage, read_write> fine: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> before: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> after: array<vec4<f32>>;
@group(0) @binding(4) var fineSolid: texture_3d<u32>;
@group(0) @binding(5) var coarseSolid: texture_storage_3d<r32uint, write>;
@group(0) @binding(6) var fineBurn: texture_storage_3d<r32float, read_write>;
@group(0) @binding(7) var coarseBurn: texture_storage_3d<r32float, read_write>;
fn idx(p: vec3<u32>, d: vec3<u32>) -> u32 { return p.x + d.x * (p.y + d.y*p.z); }
fn solid(p: vec3<i32>) -> bool {
  return textureDimensions(fineSolid).x == shape.fine.x && all(p >= vec3<i32>(0)) && all(p < vec3<i32>(shape.fine.xyz)) && textureLoad(fineSolid,p,0).x != 0u;
}
@compute @workgroup_size(4,4,4)
fn restrict(@builtin(global_invocation_id) c: vec3<u32>) {
  if(any(c >= shape.coarse.xyz)) { return; }
  let r=shape.fine.w; let weight=1.0/f32(r*r*r); let ci=idx(c,shape.coarse.xyz)*4u;
  var velocity=vec3<f32>(0.0); var a=vec4<f32>(0.0); var b=a; var d=a; var burn=0.0; var mask=0u;
  for(var z=0u;z<r;z++) { for(var y=0u;y<r;y++) { for(var x=0u;x<r;x++) {
    let offset=vec3<u32>(x,y,z); let p=c*r+offset; let f=idx(p,shape.fine.xyz)*4u;
    let blocked=solid(vec3<i32>(p)); mask=max(mask,select(0u,1u,blocked));
    if(!blocked) { burn += textureLoad(fineBurn,vec3<i32>(p)).x*weight; }
    a+=fine[f+1u]*weight; b+=fine[f+2u]*weight; d+=fine[f+3u]*weight;
    for(var axis=0u;axis<3u;axis++) {
      var next=vec3<i32>(p); next[axis]++;
      if(offset[axis]==r-1u && !blocked && !solid(next)) { velocity[axis]+=fine[f][axis]*weight; }
    }
  } } }
  before[ci]=vec4<f32>(velocity,0.0); before[ci+1u]=a; before[ci+2u]=b; before[ci+3u]=d;
  textureStore(coarseSolid,vec3<i32>(c),vec4<u32>(mask));
  textureStore(coarseBurn,vec3<i32>(c),vec4<f32>(burn,0.0,0.0,0.0));
}
fn delta(c: vec3<i32>, axis:u32) -> f32 {
  // The lower domain face is fixed, not the first stored upper face.
  if(c[axis]<0) { return 0.0; }
  let p=vec3<u32>(clamp(c,vec3<i32>(0),vec3<i32>(shape.coarse.xyz)-1));
  let i=idx(p,shape.coarse.xyz)*4u;
  return after[i][axis]-before[i][axis];
}
fn interpolateDelta(p:vec3<f32>,axis:u32)->f32 {
  let lo=vec3<i32>(floor(p)); let t=fract(p); var value=0.0;
  for(var z=0;z<2;z++) { for(var y=0;y<2;y++) { for(var x=0;x<2;x++) {
    let o=vec3<i32>(x,y,z); let w=select(vec3<f32>(1.0)-t,t,o==vec3<i32>(1));
    value+=delta(lo+o,axis)*w.x*w.y*w.z;
  } } }
  return value;
}
@compute @workgroup_size(4,4,4)
fn prolong(@builtin(global_invocation_id) c:vec3<u32>) {
  if(any(c>=shape.fine.xyz)) { return; }
  let f=idx(c,shape.fine.xyz)*4u; var velocity=fine[f].xyz; let r=f32(shape.fine.w);
  for(var axis=0u;axis<3u;axis++) {
    var offset=vec3<f32>(0.5); offset[axis]=1.0;
    let p=(vec3<f32>(c)+offset)/r-offset;
    velocity[axis]+=interpolateDelta(p,axis)*r;
    var next=vec3<i32>(c); next[axis]++;
    let wall=c[axis]+1u==shape.fine[axis] && !(axis==1u && shape.coarse.w==1u);
    if(solid(vec3<i32>(c)) || solid(next) || wall) { velocity[axis]=0.0; }
  }
  // Only velocity changes: fine reaction, render carriers and all sidecars
  // retain their freshly computed values and buffer identity.
  if(shape.bounds.x<0.5) { velocity=clamp(velocity,vec3<f32>(-0.34),vec3<f32>(0.52)); }
  else {
    velocity=clamp(velocity,vec3<f32>(-64.0),vec3<f32>(64.0));
    let magnitude=length(velocity);
    if(magnitude>shape.bounds.y) { velocity*=shape.bounds.y/magnitude; }
  }
  fine[f]=vec4<f32>(velocity,fine[f].w);
}
`;

// Resources persist across frames and control changes. Neither transfer reads
// back to the CPU. The caller supplies the existing pressure solver pipelines.
export function createPressureTransfer(device, plan) {
  const owned=[];
  const buffer=(label,size,usage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC)=>{
    const value=device.createBuffer({label,size,usage}); owned.push(value); return value;
  };
  const texture=(label,format)=>{
    const value=device.createTexture({label,size:plan.pressureDims,dimension:'3d',format,usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC}); owned.push(value); return value;
  };
  const count=plan.pressureDims.reduce((a,b)=>a*b,1);
  const before=buffer('pressure restriction velocity',count*64), after=buffer('pressure projected velocity',count*64);
  const pressure=buffer('separated warm pressure',count*16);
  const solid=texture('restricted pressure obstacles','r32uint'), burn=texture('restricted expansion','r32float');
  const params=buffer('pressure transfer geometry',48,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const module=device.createShaderModule({label:'material-pressure transfer',code:PRESSURE_TRANSFER_WGSL});
  const pipelines=Object.fromEntries(['restrict','prolong'].map(entryPoint=>[entryPoint,device.createComputePipeline({label:`pressure ${entryPoint}`,layout:'auto',compute:{module,entryPoint}})]));
  let bindings=null, prior=[];
  function prepare({fluid,solidTexture,burnTexture,openTop,nonLegacy,maxSpeed}) {
    const values=new ArrayBuffer(48);new Uint32Array(values).set([...plan.materialDims,plan.divisor,...plan.pressureDims,openTop?1:0]);
    new Float32Array(values).set([nonLegacy?1:0,maxSpeed,0,0],8);device.queue.writeBuffer(params,0,values);
    const current=[fluid,solidTexture,burnTexture];
    if(current.every((v,i)=>v===prior[i]) && bindings) return;
    prior=current;
    const entries=[{binding:0,resource:{buffer:params}},{binding:1,resource:{buffer:fluid}},{binding:2,resource:{buffer:before}},{binding:3,resource:{buffer:after}},
      {binding:4,resource:solidTexture.createView()}, {binding:5,resource:solid.createView()}, {binding:6,resource:burnTexture.createView()}, {binding:7,resource:burn.createView()}];
    bindings={restrict:device.createBindGroup({layout:pipelines.restrict.getBindGroupLayout(0),entries:entries.filter(e=>e.binding!==3)}),
      prolong:device.createBindGroup({layout:pipelines.prolong.getBindGroupLayout(0),entries:entries.filter(e=>e.binding<=4)})};
  }
  function encode(encoder,kind,timestampWrites) {
    if(!bindings) throw Error('Pressure transfer not prepared');
    const pass=encoder.beginComputePass({label:`separated pressure ${kind}`,...(timestampWrites?{timestampWrites}:{})});
    pass.setPipeline(pipelines[kind]);pass.setBindGroup(0,bindings[kind]);
    pass.dispatchWorkgroups(...(kind==='restrict'?plan.pressureDims:plan.materialDims).map(n=>Math.ceil(n/4)));pass.end();
  }
  return {plan,before,after,pressure,solid,burn,prepare,encode,destroy(){owned.forEach(v=>v.destroy());},residentBytes:count*(64*2+16+4+4)+48};
}
