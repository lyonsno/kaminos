// Direct distributed emission. Surface irradiance and isotropic smoke mean
// use the same rays; only their angular weighting differs.
import {buildSmokeReconstructionCells} from './scene-smoke-reconstruction.mjs';
export {DISTRIBUTED_SMOKE_WGSL} from './scene-smoke-reconstruction.mjs';
export function lightingDirections(count=24) {
  if(!Number.isInteger(count)||count<2||count%2) throw new Error('even angular sample count required');
  const result=[];
  for(let i=0;i<count/2;i++) {
    const y=(i+.5)/(count/2), r=Math.sqrt(1-y*y), phi=i*Math.PI*(3-Math.sqrt(5));
    const d=[Math.cos(phi)*r,y,Math.sin(phi)*r];result.push(d,d.map(v=>-v));
  }
  return result;
}
export function integrateVolumeRay(sample,length,step) {
  const result=[0,0,0];let transmission=1;
  const count=Math.ceil(length/step), ds=count ? length/count : 0;
  for(let i=0;i<count;i++) {
    const m=sample((i+.5)*ds), sigma=Math.max(0,m[3]);
    const weight=sigma ? -Math.expm1(-sigma*ds)/sigma : ds;
    for(let c=0;c<3;c++) result[c]+=transmission*m[c]*weight;
    transmission*=Math.exp(-sigma*ds);
  }
  return result;
}
export function receiverDispatch(count,limit) {
  const groups=Math.ceil(count/64);
  if(groups>limit*limit)throw new Error('receiver dispatch exceeds two-dimensional device capacity');
  return [Math.min(groups,limit),Math.ceil(groups/limit)];
}

export function createVolumeGather(device,{geometry,receivers,volumeGrid=16,directions=24}) {
  const dirs=lightingDirections(directions);
  const volumeDimensions=[volumeGrid,volumeGrid*2,volumeGrid];
  const volumeCount=volumeDimensions.reduce((a,b)=>a*b,1);
  const total=receivers.length+volumeCount;
  const reconstructionCells=buildSmokeReconstructionCells(geometry,volumeDimensions);
  const receiverValues=new Float32Array(total*8);
  receivers.forEach((r,i)=>receiverValues.set([...r.position,r.twoSided?2:1,...r.normal,0],i*8));
  for(let z=0;z<volumeGrid;z++) for(let y=0;y<volumeGrid*2;y++) for(let x=0;x<volumeGrid;x++) {
    const id=receivers.length+x+volumeGrid*(y+volumeGrid*2*z);
    receiverValues.set([-1+(x+.5)*2/volumeGrid,-1+(y+.5)*2/volumeGrid,-1+(z+.5)*2/volumeGrid,0,0,0,0,0],id*8);
  }
  const resources=[];
  function buffer(label,data,usage=GPUBufferUsage.STORAGE) {
    const size=Math.max(16,data.byteLength);
    if(size>device.limits.maxStorageBufferBindingSize) throw new Error(`${label} needs ${size} bytes; device supports ${device.limits.maxStorageBufferBindingSize}`);
    const b=device.createBuffer({label,size,usage:usage|GPUBufferUsage.COPY_DST});
    device.queue.writeBuffer(b,0,data);resources.push(b);return b;
  }
  const nodes=buffer('static kiln BVH nodes',geometry.nodes);
  const triangles=buffer('static kiln BVH triangles',geometry.triangles);
  const smokeReconstruction={identity:'geometry-visible-trilinear-v1',
    cellIndices:buffer('smoke reconstruction cell triangle candidates',reconstructionCells.words),triangles,
    dimensions:reconstructionCells.dimensions,triangleReferences:reconstructionCells.triangleReferences,
    maxCandidates:reconstructionCells.maxCandidates,emptyCells:reconstructionCells.emptyCells};
  const receiverBuffer=buffer('surface and smoke receivers',receiverValues);
  const directionBuffer=buffer('distributed incident directions',new Float32Array(dirs.flatMap(d=>[...d,0])));
  const distances=buffer('cached first solid distance per receiver ray',new Float32Array(total*directions));
  const params=buffer('distributed transport parameters',new Float32Array(4),GPUBufferUsage.UNIFORM);
  const surfaceWidth=Math.min(1024,device.limits.maxTextureDimension2D);
  const surfaceHeight=Math.max(1,Math.ceil(receivers.length/surfaceWidth));
  if(surfaceHeight>device.limits.maxTextureDimension2D) throw new Error('surface receiver texture exceeds device capacity');
  const surface=device.createTexture({label:'direct flame surface irradiance',size:[surfaceWidth,surfaceHeight],format:'rgba32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});
  const surfaceBack=device.createTexture({label:'direct flame back surface irradiance',size:[surfaceWidth,surfaceHeight],format:'rgba32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});
  const smoke=device.createTexture({label:'direct flame mean incident radiance',dimension:'3d',size:volumeDimensions,format:'rgba32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});
  const dispatchLimit=device.limits.maxComputeWorkgroupsPerDimension;
  const constants=`const DISPATCH_WIDTH:u32=${dispatchLimit*64}u;const DIRECTION_COUNT:u32=${directions}u;const SURFACE_COUNT:u32=${receivers.length}u;const RECEIVER_COUNT:u32=${total}u;const NODE_COUNT:u32=${geometry.nodeCount}u;const VOLUME_GRID:u32=${volumeGrid}u;const SURFACE_WIDTH:u32=${surfaceWidth}u;`;
  const module=device.createShaderModule({label:'distributed volume ray gather',code:constants+GATHER_WGSL});
  const cache=device.createComputePipeline({label:'cache static solid ray intersections',layout:'auto',compute:{module,entryPoint:'cacheGeometry'}});
  const cacheGroup=device.createBindGroup({layout:cache.getBindGroupLayout(0),entries:[nodes,triangles,receiverBuffer,directionBuffer,distances].map((b,binding)=>({binding,resource:{buffer:b}}))});
  const gather=device.createComputePipeline({label:'integrate actual flame emission to receivers',layout:'auto',compute:{module,entryPoint:'gatherLight'}});
  let sourceTexture=null,gatherGroup=null,cacheBuilt=false;
  return {surface,surfaceBack,smoke,surfaceDimensions:[surfaceWidth,surfaceHeight],volumeDimensions,
    encode(field,{gain=1,stepLength=2/field.dimensions[0],smokeEnabled=true}={}) {
      if(field.status!=='encoded'||!field.texture) throw new Error('distributed gather needs current raw emission/extinction');
      if(field.localMax[1]!==3) throw new Error('first distributed gather requires tall identity volume');
      device.queue.writeBuffer(params,0,new Float32Array([gain,stepLength,smokeEnabled?total:receivers.length,0]));
      if(sourceTexture!==field.texture) {
        sourceTexture=field.texture;
        gatherGroup=device.createBindGroup({layout:gather.getBindGroupLayout(0),entries:[
          {binding:2,resource:{buffer:receiverBuffer}},{binding:3,resource:{buffer:directionBuffer}},
          {binding:4,resource:{buffer:distances}},{binding:5,resource:sourceTexture.createView()},
          {binding:6,resource:surface.createView()},{binding:7,resource:smoke.createView()},
          {binding:8,resource:{buffer:params}},{binding:9,resource:surfaceBack.createView()}]});
      }
      const encoder=device.createCommandEncoder({label:'same-state distributed flame lighting'});
      if(!cacheBuilt) {
        const pass=encoder.beginComputePass({label:'static kiln visibility preparation'});
        pass.setPipeline(cache);pass.setBindGroup(0,cacheGroup);pass.dispatchWorkgroups(...receiverDispatch(total*directions,dispatchLimit));pass.end();cacheBuilt=true;
      }
      const pass=encoder.beginComputePass({label:'live distributed flame transport'});
      pass.setPipeline(gather);pass.setBindGroup(0,gatherGroup);pass.dispatchWorkgroups(...receiverDispatch(smokeEnabled?total:receivers.length,dispatchLimit));pass.end();
      device.queue.submit([encoder.finish()]);
      return {generation:field.generation,frame:field.frame,surfaceReceivers:receivers.length,volumeReceivers:smokeEnabled?volumeCount:0,allocatedVolumeReceivers:volumeCount,directions,stepLength,gain,geometryTriangles:geometry.triangleCount,smokeReconstruction};
    },
    destroy(){for(const b of resources)b.destroy();surface.destroy();surfaceBack.destroy();smoke.destroy();},
    async readback() {
      const staging=[];
      const encoder=device.createCommandEncoder({label:'distributed receiver evidence'});
      for(const [name,texture,size] of [['surface',surface,[surfaceWidth,surfaceHeight,1]],['surfaceBack',surfaceBack,[surfaceWidth,surfaceHeight,1]],['smoke',smoke,volumeDimensions]]) {
        const rowBytes=Math.ceil(size[0]*16/256)*256;
        const b=device.createBuffer({size:rowBytes*size[1]*size[2],usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
        encoder.copyTextureToBuffer({texture},{buffer:b,bytesPerRow:rowBytes,rowsPerImage:size[1]},size);
        staging.push({name,b,size,rowBytes});
      }
      device.queue.submit([encoder.finish()]);
      const result={};
      try {
        for(const {name,b,size,rowBytes} of staging){await b.mapAsync(GPUMapMode.READ);const raw=new Float32Array(b.getMappedRange());const data=new Float32Array(size[0]*size[1]*size[2]*4);
          for(let row=0;row<size[1]*size[2];row++)data.set(raw.subarray(row*rowBytes/4,row*rowBytes/4+size[0]*4),row*size[0]*4);
          result[name]={dimensions:size,data};b.unmap();}
        return result;
      }finally{for(const {b} of staging)b.destroy();}
    },
  };
}

export const GATHER_WGSL=`
struct Node {lo:vec4<f32>,hi:vec4<f32>,range:vec4<u32>}
struct Triangle {a:vec4<f32>,e1:vec4<f32>,e2:vec4<f32>}
struct Receiver {position:vec4<f32>,normal:vec4<f32>}
@group(0) @binding(0) var<storage,read> nodes:array<Node>;
@group(0) @binding(1) var<storage,read> triangles:array<Triangle>;
@group(0) @binding(2) var<storage,read> receivers:array<Receiver>;
@group(0) @binding(3) var<storage,read> directions:array<vec4<f32>>;
@group(0) @binding(4) var<storage,read_write> firstHits:array<f32>;
@group(0) @binding(5) var coefficients:texture_3d<f32>;
@group(0) @binding(6) var surfaceOut:texture_storage_2d<rgba32float,write>;
@group(0) @binding(7) var smokeOut:texture_storage_3d<rgba32float,write>;
@group(0) @binding(8) var<uniform> settings:vec4<f32>;
@group(0) @binding(9) var surfaceBackOut:texture_storage_2d<rgba32float,write>;
fn receiverOrigin(r:Receiver,d:vec3<f32>)->vec3<f32> {
  // Opaque sides have different ray origins. Cache and live integration must
  // use the same one, including when a source normal is inverted.
  var side=1.0;
  if(r.position.w>1.5&&dot(r.normal.xyz,d)<0.0){side=-1.0;}
  return r.position.xyz+r.normal.xyz*(side*0.0001);
}
fn interval(p:vec3<f32>,d:vec3<f32>,lo:vec3<f32>,hi:vec3<f32>,limit:f32)->vec2<f32> {
  var near=0.0;var far=limit;
  for(var a=0u;a<3u;a++) {
    if(abs(d[a])<1e-20) {if(p[a]<lo[a]||p[a]>hi[a]) {return vec2<f32>(1.0,-1.0);}}
    else {let t0=(lo[a]-p[a])/d[a];let t1=(hi[a]-p[a])/d[a];near=max(near,min(t0,t1));far=min(far,max(t0,t1));}
  }
  return vec2<f32>(near,far);
}
@compute @workgroup_size(64)
fn cacheGeometry(@builtin(global_invocation_id) global:vec3<u32>) {
  let id=vec3<u32>(global.x+global.y*DISPATCH_WIDTH,0u,0u);
  if(id.x>=RECEIVER_COUNT*DIRECTION_COUNT){return;}
  let r=receivers[id.x/DIRECTION_COUNT];let d=directions[id.x%DIRECTION_COUNT].xyz;
  let p=receiverOrigin(r,d);
  var closest=1e20;var n=0u;
  loop {
    if(n>=NODE_COUNT){break;}
    let node=nodes[n];let span=interval(p,d,node.lo.xyz,node.hi.xyz,closest);
    if(span.y<span.x){n=node.range.x;continue;}
    if(node.range.z==0u){n++;continue;}
    for(var t=node.range.y;t<node.range.y+node.range.z;t++) {
      let tri=triangles[t];let h=cross(d,tri.e2.xyz);let det=dot(tri.e1.xyz,h);
      if(abs(det)<1e-12*length(tri.e1.xyz)*length(tri.e2.xyz)){continue;}
      let s=p-tri.a.xyz;let u=dot(s,h)/det;let q=cross(s,tri.e1.xyz);let v=dot(d,q)/det;
      let distance=dot(tri.e2.xyz,q)/det;
      if(u>=0.0&&v>=0.0&&u+v<=1.0&&distance>0.00001&&distance<closest){closest=distance;}
    }
    n=node.range.x;
  }
  firstHits[id.x]=closest;
}
fn integrateRay(p:vec3<f32>,d:vec3<f32>,limit:f32)->vec3<f32> {
  let span=interval(p,d,vec3<f32>(-1.0),vec3<f32>(1.0,3.0,1.0),limit);
  if(span.y<=span.x){return vec3<f32>(0.0);}
  let count=u32(ceil((span.y-span.x)/settings.y));let ds=(span.y-span.x)/f32(count);
  let dims=textureDimensions(coefficients);let pitch=2.0/f32(dims.x);
  var radiance=vec3<f32>(0.0);var transmission=1.0;
  for(var i=0u;i<count;i++) {
    let samplePosition=p+d*(span.x+(f32(i)+0.5)*ds);
    let c=clamp(vec3<i32>(floor((samplePosition+vec3<f32>(1.0))/pitch)),vec3<i32>(0),vec3<i32>(dims)-1);
    let m=textureLoad(coefficients,c,0);let sigma=max(0.0,m.a);let tau=sigma*ds;
    var weight=ds*(1.0-tau*0.5+tau*tau/6.0);
    if(tau>=0.001){weight=(1.0-exp(-tau))/sigma;}
    radiance+=transmission*m.rgb*weight;transmission*=exp(-tau);
  }
  return radiance;
}
@compute @workgroup_size(64)
fn gatherLight(@builtin(global_invocation_id) global:vec3<u32>) {
  let id=vec3<u32>(global.x+global.y*DISPATCH_WIDTH,0u,0u);
  if(id.x>=u32(settings.z)){return;}
  let r=receivers[id.x];
  var sum=vec3<f32>(0.0);var backSum=vec3<f32>(0.0);
  for(var a=0u;a<DIRECTION_COUNT;a++) {
    let d=directions[a].xyz;
    var weight=1.0/f32(DIRECTION_COUNT);
    let cosine=dot(r.normal.xyz,d);
    if(r.position.w>0.5){weight*=12.566370614359172*select(max(0.0,cosine),abs(cosine),r.position.w>1.5);}
    if(weight>0.0){
      let contribution=integrateRay(receiverOrigin(r,d),d,firstHits[id.x*DIRECTION_COUNT+a])*weight;
      if(r.position.w>1.5&&cosine<0.0){backSum+=contribution;}else{sum+=contribution;}
    }
  }
  let output=vec4<f32>(sum*settings.x,1.0);
  if(id.x<SURFACE_COUNT){
    let pixel=vec2<i32>(i32(id.x%SURFACE_WIDTH),i32(id.x/SURFACE_WIDTH));
    textureStore(surfaceOut,pixel,output);textureStore(surfaceBackOut,pixel,vec4<f32>(backSum*settings.x,1.0));
  }
  else {let index=id.x-SURFACE_COUNT;textureStore(smokeOut,vec3<i32>(i32(index%VOLUME_GRID),i32((index/VOLUME_GRID)%(2u*VOLUME_GRID)),i32(index/(2u*VOLUME_GRID*VOLUME_GRID))),output);}
}
`;
