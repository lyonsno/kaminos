// Lighting-only emission preparation. The raw source and its extinction remain
// authoritative; this approximation does not modify the visible flame.
export function validateSourceSoftness(passes) {
  if (!Number.isSafeInteger(passes) || passes<0) throw new Error('source softness requires nonnegative integer passes');
  return passes;
}
export function softenEmissionReference(values, dimensions, occupied, passes) {
  validateSourceSoftness(passes);
  let result=Float32Array.from(values);
  const [nx,ny,nz]=dimensions;
  for(let pass=0;pass<passes;pass++){
    const next=result.slice();
    for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
      const i=x+nx*(y+ny*z);if(occupied[i])continue;
      // Symmetric pair weights retain energy at domain and solid boundaries.
      for(const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){
        const a=x+dx,b=y+dy,c=z+dz;
        if(a<0||a>=nx||b<0||b>=ny||c<0||c>=nz)continue;
        const j=a+nx*(b+ny*c);if(occupied[j])continue;
        for(let k=0;k<3;k++)next[i*4+k]+=(result[j*4+k]-result[i*4+k])/8;
      }
    }
    result=next;
  }
  return result;
}

export function createSourceSoftening(device,{nodes,triangles,nodeCount,dimensions}) {
  const count=dimensions.reduce((a,b)=>a*b,1),owned=[];
  if(dimensions.length!==3||dimensions.some(n=>!Number.isInteger(n)||n<1||n>device.limits.maxTextureDimension3D))throw new Error('source softening dimensions exceed capacity');
  if(count*4>device.limits.maxStorageBufferBindingSize)throw new Error('source softening mask exceeds capacity');
  const limit=device.limits.maxComputeWorkgroupsPerDimension,groups=Math.ceil(count/64);
  if(groups>limit*limit)throw new Error('source softening dispatch exceeds capacity');
  const dispatch=[Math.min(groups,limit),Math.ceil(groups/limit)];
  try {
    const masks=device.createBuffer({label:'source softening solid cells',size:count*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});owned.push(masks);
    const textures=[0,1].map(i=>{const t=device.createTexture({label:`lighting-only softened coefficients ${i}`,dimension:'3d',size:dimensions,format:'rgba32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});owned.push(t);return t;});
    const code=`const DIMS:vec3<u32>=vec3<u32>(${dimensions.map(n=>n+'u').join(',')});const COUNT:u32=${count}u;const NODE_COUNT:u32=${nodeCount}u;const WIDTH:u32=${limit*64}u;const PITCH:f32=${2/dimensions[0]};`+SOURCE_SOFTENING_WGSL;
    const module=device.createShaderModule({label:'lighting-only emission softening',code});
    const prepare=device.createComputePipeline({label:'source solid-cell preparation',layout:'auto',compute:{module,entryPoint:'prepareSourceCells'}});
    const filter=device.createComputePipeline({label:'conservative emission diffusion',layout:'auto',compute:{module,entryPoint:'softenSource'}});
    const prepGroup=device.createBindGroup({layout:prepare.getBindGroupLayout(0),entries:[nodes,triangles,masks].map((b,binding)=>({binding,resource:{buffer:b}}))});
    let source=null,bindings=null,prepared=false;
    const metadata={identity:'solid-bounded-emission-diffusion-v1',passes:0,staticPreparations:0,updates:0,dimensions:dimensions.slice(),bytes:count*36,extinction:'unchanged',boundary:'occupied-cells-isolated-no-flux-domain',rawSourceMutated:false};
    return {metadata,masks,encode(encoder,input,passes){
      validateSourceSoftness(passes);metadata.passes=passes;
      if(passes===0)return input;
      if(source!==input){
        source=input;
        const group=(src,dst)=>device.createBindGroup({layout:filter.getBindGroupLayout(0),entries:[{binding:2,resource:{buffer:masks}},{binding:3,resource:src.createView()},{binding:4,resource:dst.createView()}]});
        bindings=[group(input,textures[0]),group(textures[0],textures[1]),group(textures[1],textures[0])];
      }
      if(!prepared){const p=encoder.beginComputePass({label:'cache source solid boundaries'});p.setPipeline(prepare);p.setBindGroup(0,prepGroup);p.dispatchWorkgroups(...dispatch);p.end();prepared=true;metadata.staticPreparations++;}
      for(let i=0;i<passes;i++){const p=encoder.beginComputePass({label:'soften lighting emission'});p.setPipeline(filter);p.setBindGroup(0,bindings[i===0?0:i%2===1?1:2]);p.dispatchWorkgroups(...dispatch);p.end();}
      metadata.updates++;return textures[(passes-1)%2];
    },destroy(){for(const r of owned)r.destroy();}};
  }catch(error){for(const r of owned)r.destroy();throw error;}
}

export const SOURCE_SOFTENING_WGSL=`
struct Node {lo:vec4<f32>,hi:vec4<f32>,range:vec4<u32>}
struct Triangle {a:vec4<f32>,e1:vec4<f32>,e2:vec4<f32>}
@group(0) @binding(0) var<storage,read> nodes:array<Node>;
@group(0) @binding(1) var<storage,read> triangles:array<Triangle>;
@group(0) @binding(2) var<storage,read_write> occupied:array<u32>;
@group(0) @binding(3) var source:texture_3d<f32>;
@group(0) @binding(4) var destination:texture_storage_3d<rgba32float,write>;
fn cellOf(id:u32)->vec3<u32>{return vec3<u32>(id%DIMS.x,(id/DIMS.x)%DIMS.y,id/(DIMS.x*DIMS.y));}
fn indexOf(c:vec3<u32>)->u32{return c.x+DIMS.x*(c.y+DIMS.y*c.z);}
fn separates(axis:vec3<f32>,a:vec3<f32>,b:vec3<f32>,c:vec3<f32>,half:vec3<f32>)->bool{
  let p=vec3<f32>(dot(axis,a),dot(axis,b),dot(axis,c));let radius=dot(abs(axis),half);let tolerance=0.000002*length(axis);
  return min(p.x,min(p.y,p.z))>radius+tolerance||max(p.x,max(p.y,p.z))< -radius-tolerance;
}
fn triangleCell(t:Triangle,lo:vec3<f32>,hi:vec3<f32>)->bool{
  let center=(lo+hi)*0.5;let half=(hi-lo)*0.5;let a=t.a.xyz-center;let b=a+t.e1.xyz;let c=a+t.e2.xyz;
  if(separates(cross(t.e1.xyz,t.e2.xyz),a,b,c,half)){return false;}
  let edges=array<vec3<f32>,3>(t.e1.xyz,t.e2.xyz,t.e2.xyz-t.e1.xyz);
  let axes=array<vec3<f32>,3>(vec3<f32>(1,0,0),vec3<f32>(0,1,0),vec3<f32>(0,0,1));
  for(var i=0u;i<3u;i++){if(separates(axes[i],a,b,c,half)){return false;}for(var j=0u;j<3u;j++){if(separates(cross(edges[i],axes[j]),a,b,c,half)){return false;}}}
  return true;
}
@compute @workgroup_size(64)
fn prepareSourceCells(@builtin(global_invocation_id) gid:vec3<u32>){
  let id=gid.x+gid.y*WIDTH;if(id>=COUNT){return;}
  let lo=vec3<f32>(-1)+vec3<f32>(cellOf(id))*PITCH;let hi=lo+vec3<f32>(PITCH);var n=0u;var blocked=0u;
  loop{if(n>=NODE_COUNT){break;}let node=nodes[n];
    if(any(hi+vec3<f32>(0.000002)<node.lo.xyz)||any(lo-vec3<f32>(0.000002)>node.hi.xyz)){n=node.range.x;continue;}
    if(node.range.z==0u){n++;continue;}
    for(var i=node.range.y;i<node.range.y+node.range.z;i++){if(triangleCell(triangles[i],lo,hi)){blocked=1u;break;}}
    if(blocked!=0u){break;}n=node.range.x;
  }
  occupied[id]=blocked;
}
@compute @workgroup_size(64)
fn softenSource(@builtin(global_invocation_id) gid:vec3<u32>){
  let id=gid.x+gid.y*WIDTH;if(id>=COUNT){return;}
  let c=vec3<i32>(cellOf(id));let original=textureLoad(source,c,0);var rgb=original.rgb;
  if(occupied[id]==0u){
    let offsets=array<vec3<i32>,6>(vec3<i32>(1,0,0),vec3<i32>(-1,0,0),vec3<i32>(0,1,0),vec3<i32>(0,-1,0),vec3<i32>(0,0,1),vec3<i32>(0,0,-1));
    for(var i=0u;i<6u;i++){let q=c+offsets[i];if(any(q<vec3<i32>(0))||any(q>=vec3<i32>(DIMS))){continue;}
      if(occupied[indexOf(vec3<u32>(q))]==0u){rgb+=(textureLoad(source,q,0).rgb-original.rgb)*0.125;}
    }
  }
  textureStore(destination,c,vec4<f32>(rgb,original.a));
}
`;
