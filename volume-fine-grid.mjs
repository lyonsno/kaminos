import {latticeDimensions,transferWork,TRANSFER_GEOMETRY_WGSL} from './volume-grid-transfer.mjs';
export function fineGridPlan({materialDims,velocity=0,pressure=0}) {
 if(!Array.isArray(materialDims)||materialDims.length!==3||materialDims.some(n=>!Number.isSafeInteger(n)||n<2))throw Error('Invalid fine material dimensions');
 velocity=Number(velocity);pressure=Number(pressure);
 if(velocity===0)velocity=materialDims[0];if(pressure===0)pressure=velocity;
 const velocityDims=latticeDimensions(materialDims,velocity,'Fine velocity');
 const pressureDims=latticeDimensions(materialDims,pressure,'Fine pressure');
 return {materialDims:[...materialDims],velocityDims,pressureDims,materialPerVelocity:materialDims[0]/velocity,velocityPerPressure:velocity/pressure,
  materialTransfer:transferWork(materialDims,velocityDims),pressureTransfer:transferWork(velocityDims,pressureDims)};
}

// The velocity lattice owns its history. Scalar restriction never replaces
// that history with a filtered copy of its material-grid interpolation.
export const FINE_GRID_TRANSFER_WGSL=/* wgsl */`
struct Shape { material:vec4<u32>, velocity:vec4<u32>, ratio:vec4<f32> };
override GENERAL_TRANSFER:bool=false;
${TRANSFER_GEOMETRY_WGSL}
@group(0) @binding(0) var<uniform> s:Shape;
@group(0) @binding(1) var<storage,read_write> fine:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read_write> coarse:array<vec4<f32>>;
@group(0) @binding(3) var<storage,read> coarseAfter:array<vec4<f32>>;
@group(0) @binding(4) var<storage,read> fineFront:array<f32>;
@group(0) @binding(5) var<storage,read_write> coarseFront:array<f32>;
@group(0) @binding(6) var<storage,read> fineQuench:array<u32>;
@group(0) @binding(7) var<storage,read_write> coarseQuench:array<u32>;
@group(0) @binding(8) var fineSolid:texture_3d<u32>;
@group(0) @binding(9) var coarseSolid:texture_storage_3d<r32uint,write>;
@group(0) @binding(10) var fineReactant:texture_3d<f32>;
@group(0) @binding(11) var coarseReactant:texture_storage_3d<rg32float,write>;
@group(0) @binding(12) var fineBurn:texture_storage_3d<r32float,read_write>;
@group(0) @binding(13) var coarseBurn:texture_storage_3d<r32float,read_write>;
@group(0) @binding(14) var fineLower:texture_storage_2d_array<r32float,write>;
@group(0) @binding(15) var coarseLower:texture_2d_array<f32>;
@group(0) @binding(16) var<storage,read> finePrior:array<vec4<f32>>;
@group(0) @binding(17) var fineLowerRead:texture_2d_array<f32>;
fn idx(p:vec3<u32>,d:vec3<u32>)->u32{return p.x+d.x*(p.y+d.y*p.z);}
fn solid(p:vec3<i32>)->bool{return textureDimensions(fineSolid).x==s.material.x&&all(p>=vec3<i32>(0))&&all(p<vec3<i32>(s.material.xyz))&&textureLoad(fineSolid,p,0).x!=0u;}
fn sourceFace(c:vec3<i32>,a:u32,prior:bool)->f32{
 var p=clamp(c,vec3<i32>(0),vec3<i32>(s.material.xyz)-1);
 if(solid(p)){return 0.0;}
 if(c[a]<0){return textureLoad(fineLowerRead,vec2<i32>(p[(a+1u)%3u],p[(a+2u)%3u]),i32(a),0).x;}
 var next=p;next[a]++;if(solid(next)){return 0.0;}
 let i=idx(vec3<u32>(p),s.material.xyz)*4u;
 if(prior){return finePrior[i][a];}return fine[i][a];
}
// Area average on a destination face. Along its normal, reconstruct the
// source's MAC component; tangentially integrate intersecting cell faces.
fn transferFace(c:vec3<u32>,a:u32,prior:bool)->f32{
 let r=s.ratio.x;let lo=transferLo(c,s.material.xyz,s.velocity.xyz);let hi=transferHi(c,s.material.xyz,s.velocity.xyz);
 var begin=transferBegin(c,s.material.xyz,s.velocity.xyz);var end=transferEnd(c,s.material.xyz,s.velocity.xyz);
 let normal=hi[a]-1.0;let base=i32(floor(normal));let f=fract(normal);
 begin[a]=base;end[a]=base+1;var v=0.0;var area=0.0;
 for(var z=begin.z;z<end.z;z++){for(var y=begin.y;y<end.y;y++){for(var x=begin.x;x<end.x;x++){
  let p=vec3<i32>(x,y,z);let overlap=transferOverlap(p,lo,hi);var q=p;q[a]++;
  let weight=overlap[(a+1u)%3u]*overlap[(a+2u)%3u];area+=weight;
  v+=mix(sourceFace(p,a,prior),sourceFace(q,a,prior),f)*weight;
 }}}
 return v/(area*r);
}
fn restrictGeneral(c:vec3<u32>){
 let ci=idx(c,s.velocity.xyz);let r=s.ratio.x;let lo=transferLo(c,s.material.xyz,s.velocity.xyz);let hi=transferHi(c,s.material.xyz,s.velocity.xyz);
 let begin=transferBegin(c,s.material.xyz,s.velocity.xyz);let end=transferEnd(c,s.material.xyz,s.velocity.xyz);var a=vec4<f32>(0);var b=a;var d=a;var react=a;var front=0.0;var wet=0.0;var mask=0u;var weightSum=0.0;
 for(var z=begin.z;z<end.z;z++){for(var y=begin.y;y<end.y;y++){for(var x=begin.x;x<end.x;x++){
  let p=vec3<i32>(x,y,z);let o=transferOverlap(p,lo,hi);let w=o.x*o.y*o.z;if(w<=0.0){continue;}weightSum+=w;
  let fi=idx(vec3<u32>(p),s.material.xyz);a+=fine[fi*4u+1u]*w;b+=fine[fi*4u+2u]*w;d+=fine[fi*4u+3u]*w;
  front+=fineFront[fi]*w;wet+=f32(fineQuench[fi])*w;mask=max(mask,select(0u,1u,solid(p)));
  if(textureDimensions(fineReactant).x==s.material.x){react+=textureLoad(fineReactant,p,0)*w;}
 }}}
 if(s.velocity.w==1u){var v=vec3<f32>(0);for(var axis=0u;axis<3u;axis++){v[axis]=transferFace(c,axis,false);}coarse[ci*4u]=vec4<f32>(v,0);}
 coarse[ci*4u+1u]=a/weightSum;coarse[ci*4u+2u]=b/weightSum;coarse[ci*4u+3u]=d/weightSum;coarseFront[ci]=front/weightSum;coarseQuench[ci]=u32(wet/weightSum+0.5);
 if(ci==0u){let nf=s.material.x*s.material.y*s.material.z;let nc=s.velocity.x*s.velocity.y*s.velocity.z;for(var k=0u;k<5u;k++){coarseQuench[nc+k]=fineQuench[nf+k];}}
 textureStore(coarseSolid,vec3<i32>(c),vec4<u32>(mask));textureStore(coarseReactant,vec3<i32>(c),react/weightSum);
}
@compute @workgroup_size(4,4,4)
fn restrictScalars(@builtin(global_invocation_id) c:vec3<u32>){
 if(any(c>=s.velocity.xyz)){return;}
 if(GENERAL_TRANSFER){restrictGeneral(c);return;}
 let ci=idx(c,s.velocity.xyz);let r=s.material.w;let weight=1.0/f32(r*r*r);
 var a=vec4<f32>(0.0);var b=a;var d=a;var react=a;var front=0.0;var wet=0.0;var mask=0u;var vel=vec3<f32>(0.0);
 for(var z=0u;z<r;z++){for(var y=0u;y<r;y++){for(var x=0u;x<r;x++){
  let o=vec3<u32>(x,y,z);let p=c*r+o;let fi=idx(p,s.material.xyz);let blocked=solid(vec3<i32>(p));
  a+=fine[fi*4u+1u]*weight;b+=fine[fi*4u+2u]*weight;d+=fine[fi*4u+3u]*weight;
  front+=fineFront[fi]*weight;wet+=f32(fineQuench[fi])*weight;mask=max(mask,select(0u,1u,blocked));
  if(textureDimensions(fineReactant).x==s.material.x){react+=textureLoad(fineReactant,vec3<i32>(p),0)*weight;}
  if(s.velocity.w==1u){for(var axis=0u;axis<3u;axis++){var next=vec3<i32>(p);next[axis]++;if(o[axis]==r-1u&&!blocked&&!solid(next)){vel[axis]+=fine[fi*4u][axis]*weight;}}}
 }}}
 if(s.velocity.w==1u){coarse[ci*4u]=vec4<f32>(vel,0.0);}
 coarse[ci*4u+1u]=a;coarse[ci*4u+2u]=b;coarse[ci*4u+3u]=d;
 coarseFront[ci]=front;coarseQuench[ci]=u32(wet+0.5);
 if(ci==0u){let nf=s.material.x*s.material.y*s.material.z;let nc=s.velocity.x*s.velocity.y*s.velocity.z;for(var k=0u;k<5u;k++){coarseQuench[nc+k]=fineQuench[nf+k];}}
 textureStore(coarseSolid,vec3<i32>(c),vec4<u32>(mask));textureStore(coarseReactant,vec3<i32>(c),react);
}
// Analytic emitters act on the material lattice. Transfer only their velocity
// increment, preserving the independently evolved coarse velocity history.
@compute @workgroup_size(4,4,4)
fn injectMomentum(@builtin(global_invocation_id) c:vec3<u32>){
 if(any(c>=s.velocity.xyz)){return;}
 if(GENERAL_TRANSFER){var delta=vec3<f32>(0);for(var a=0u;a<3u;a++){delta[a]=transferFace(c,a,false)-transferFace(c,a,true);}let ci=idx(c,s.velocity.xyz)*4u;coarse[ci]=vec4<f32>(coarse[ci].xyz+delta,coarse[ci].w);return;}
 let r=s.material.w;var v=vec3<f32>(0.0);
 for(var z=0u;z<r;z++){for(var y=0u;y<r;y++){for(var x=0u;x<r;x++){
  let o=vec3<u32>(x,y,z);let p=c*r+o;let fi=idx(p,s.material.xyz)*4u;
  for(var a=0u;a<3u;a++){var next=vec3<i32>(p);next[a]++;
   if(o[a]==r-1u&&!solid(vec3<i32>(p))&&!solid(next)){v[a]+=(fine[fi][a]-finePrior[fi][a])/f32(r*r*r);}}
 }}}
 let ci=idx(c,s.velocity.xyz)*4u;coarse[ci]=vec4<f32>(coarse[ci].xyz+v,coarse[ci].w);
}
@compute @workgroup_size(4,4,4)
fn restrictBurn(@builtin(global_invocation_id) c:vec3<u32>){
 if(any(c>=s.velocity.xyz)){return;}
 if(GENERAL_TRANSFER){let r=s.ratio.x;let lo=transferLo(c,s.material.xyz,s.velocity.xyz);let hi=transferHi(c,s.material.xyz,s.velocity.xyz);let begin=transferBegin(c,s.material.xyz,s.velocity.xyz);let end=transferEnd(c,s.material.xyz,s.velocity.xyz);var value=0.0;var weightSum=0.0;
 for(var z=begin.z;z<end.z;z++){for(var y=begin.y;y<end.y;y++){for(var x=begin.x;x<end.x;x++){let p=vec3<i32>(x,y,z);let o=transferOverlap(p,lo,hi);let w=o.x*o.y*o.z;weightSum+=w;value+=textureLoad(fineBurn,p).x*w;}}}
 textureStore(coarseBurn,vec3<i32>(c),vec4<f32>(value/weightSum,0,0,0));return;}
 let r=s.material.w;var v=0.0;
 for(var z=0u;z<r;z++){for(var y=0u;y<r;y++){for(var x=0u;x<r;x++){v+=textureLoad(fineBurn,vec3<i32>(c*r+vec3<u32>(x,y,z))).x;}}}
 textureStore(coarseBurn,vec3<i32>(c),vec4<f32>(v/f32(r*r*r),0.0,0.0,0.0));
}
fn face(c:vec3<i32>,axis:u32)->f32{
 let p=clamp(c,vec3<i32>(0),vec3<i32>(s.velocity.xyz)-1);
 if(c[axis]<0){return textureLoad(coarseLower,vec2<i32>(p[(axis+1u)%3u],p[(axis+2u)%3u]),i32(axis),0).x;}
 return coarseAfter[idx(vec3<u32>(p),s.velocity.xyz)*4u][axis];
}
fn sampleFace(p:vec3<f32>,axis:u32)->f32{
 let lo=vec3<i32>(floor(p));let t=fract(p);var v=0.0;
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){let o=vec3<i32>(x,y,z);let w=select(vec3<f32>(1.0)-t,t,o==vec3<i32>(1));v+=face(lo+o,axis)*w.x*w.y*w.z;}}}return v;
}
@compute @workgroup_size(4,4,4)
fn prolongVelocity(@builtin(global_invocation_id) c:vec3<u32>){
 if(any(c>=s.material.xyz)){return;}let fi=idx(c,s.material.xyz)*4u;let r=s.ratio.x;var v=vec3<f32>(0.0);
 for(var axis=0u;axis<3u;axis++){
  var offset=vec3<f32>(0.5);offset[axis]=1.0;var p=(vec3<f32>(c)+offset)/r-offset;
  v[axis]=sampleFace(p,axis)*r;var next=vec3<i32>(c);next[axis]++;
  if(solid(vec3<i32>(c))||solid(next)){v[axis]=0.0;}
  if(c[axis]==0u){p[axis]=-1.0;textureStore(fineLower,vec2<i32>(i32(c[(axis+1u)%3u]),i32(c[(axis+2u)%3u])),i32(axis),vec4<f32>(select(sampleFace(p,axis)*r,0.0,solid(vec3<i32>(c)))));}
 }
 fine[fi]=vec4<f32>(v,fine[fi].w);
}
`;

export function createFineVelocityGrid(device,plan,uniformBytes) {
 const owned=[],d=plan.velocityDims,n=d.reduce((a,b)=>a*b,1);
 const buffer=(label,size,usage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC)=>{const b=device.createBuffer({label:'fine velocity '+label,size,usage});owned.push(b);return b;};
 const texture=(label,format,size=d,dimension='3d')=>{const t=device.createTexture({label:'fine velocity '+label,format,size,dimension,usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST});owned.push(t);return t;};
 const fluid=[0,1].map(i=>buffer('history '+i,n*64)),front=[0,1].map(i=>buffer('front '+i,n*4)),quench=[0,1].map(i=>buffer('quench '+i,(n+5)*4));
 const reactant=[0,1].map(i=>texture('reactant '+i,'rg32float')),wavelet=[0,1].map(i=>texture('wavelet '+i,'rgba32float',[d[0],d[1],d[2]*2]));
 const lattice=new Float32Array(n*8);let at=0;
 for(let set=0;set<2;set++)for(let z=0;z<d[2];z++)for(let y=0;y<d[1];y++)for(let x=0;x<d[0];x++){lattice[at]=x+.5;lattice[at+1]=y+.5;lattice[at+2]=z+.5;at+=4;}
 const resetWavelet=()=>{for(const t of wavelet)device.queue.writeTexture({texture:t},lattice,{bytesPerRow:d[0]*16,rowsPerImage:d[1]},[d[0],d[1],d[2]*2]);};
 resetWavelet();
 const solid=texture('obstacles','r32uint'),burn=texture('expansion','r32float'),force=texture('force and low-pass','r32float',[d[0],d[1],d[2]*9]);
 const side=Math.max(...d),lower=texture('lower faces','r32float',[side,side,3],'2d');
 const uniform=buffer('uniforms',uniformBytes,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),shape=buffer('transfer shape',48,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),seedShape=buffer('seed shape',48,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),predictor=buffer('predictor',n*64);
 for(const [buffer,seed] of [[shape,0],[seedShape,1]]){const data=new ArrayBuffer(48);new Uint32Array(data).set([...plan.materialDims,Math.floor(plan.materialPerVelocity),...d,seed]);new Float32Array(data)[8]=plan.materialPerVelocity;device.queue.writeBuffer(buffer,0,data);}
 const module=device.createShaderModule({label:'fine material-velocity transfer',code:FINE_GRID_TRANSFER_WGSL});
 const pipelines=Object.fromEntries(['restrictScalars','restrictBurn','injectMomentum','prolongVelocity'].map(entryPoint=>[entryPoint,device.createComputePipeline({label:'fine '+entryPoint,layout:'auto',compute:{module,entryPoint,constants:{GENERAL_TRANSFER:!Number.isInteger(plan.materialPerVelocity)}}})]));
 let current=0,seed=true,bindings,prior=[];
 function prepare(f) {
  const resources=[f.fluid,f.front,f.quench,f.solid,f.reactant,f.burn,f.lower,f.prior,current];
  if(bindings&&resources.every((v,i)=>v===prior[i]))return;
  prior=resources;
  const bs=[shape,f.fluid,fluid[current],fluid[current],f.front,front[0],f.quench,quench[0]];
  const entries=bs.map((b,binding)=>({binding,resource:{buffer:b}}));
  [f.solid,solid,f.reactant,reactant[0],f.burn,burn].forEach((t,i)=>entries.push({binding:8+i,resource:t.createView()}));
  entries.push({binding:14,resource:f.lower.createView({dimension:'2d-array'})},{binding:15,resource:lower.createView({dimension:'2d-array'})});
  entries.push({binding:16,resource:{buffer:f.prior??f.fluid}});entries.push({binding:17,resource:f.lower.createView({dimension:'2d-array'})});
  const used={injectMomentum:[0,1,2,8,16,17],restrictScalars:[0,1,2,4,5,6,7,8,9,10,11,16,17],restrictBurn:[0,12,13],prolongVelocity:[0,1,3,8,14,15]};
  bindings=Object.fromEntries(Object.entries(used).map(([k,ids])=>[k,device.createBindGroup({layout:pipelines[k].getBindGroupLayout(0),entries:entries.filter(e=>ids.includes(e.binding))})]));
  bindings.seed=device.createBindGroup({layout:pipelines.restrictScalars.getBindGroupLayout(0),entries:entries.filter(e=>used.restrictScalars.includes(e.binding)).map(e=>e.binding===0?{binding:0,resource:{buffer:seedShape}}:e)});
 }
 function encode(encoder,kind,timestampWrites){if(!bindings)throw Error('Fine velocity transfer not prepared');const p=encoder.beginComputePass({label:'fine '+kind,...(timestampWrites?{timestampWrites}:{})});p.setPipeline(pipelines[kind]);p.setBindGroup(0,kind==='restrictScalars'&&seed?bindings.seed:bindings[kind]);p.dispatchWorkgroups(...(kind==='prolongVelocity'?plan.materialDims:d).map(n=>Math.ceil(n/4)));p.end();if(kind==='restrictScalars')seed=false;}
 return {plan,fluid,front,quench,reactant,wavelet,solid,burn,force,lower,uniform,predictor,prepare,encode,resetWavelet,
  get current(){return current;},flip(){current=1-current;bindings=null;},destroy(){owned.forEach(r=>r.destroy());},
  residentBytes:n*(128+8+8+16+64+4+4+36+64)+40+side*side*12+uniformBytes+64};
}
