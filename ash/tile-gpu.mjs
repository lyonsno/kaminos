import * as THREE from '../lib/three.webgpu.js';
import {patchLayout,seedPatch} from './gpu-plan.mjs';
import {seededTiles,cellCoord,tileIndex} from './tile-plan.mjs';
import {createGpuAshFall} from './fall-gpu.mjs';
import {retainedVolume} from './fall-plan.mjs';
// Header words: pending wake, current awake, dirty surface, cached faces,
// physical update count, surface revision, reserved, reserved.
export function tileShader(p){const t=p.tiles;return `
const B:u32=${t.width}u;const V:u32=${t.cellsPerTile}u;const G:u32=${t.groupsPerTile}u;
const TD=vec3<u32>(${t.dims.map(v=>v+'u').join(',')});const NT:u32=${t.count}u;const HALO:i32=${t.phaseHalo};
struct Params {dims:vec4<u32>,origin:vec4<f32>,contact:vec4<f32>,previous:vec4<f32>,mode:vec4<u32>}
@group(0) @binding(0) var<storage,read_write> density:array<f32>;
@group(0) @binding(1) var<storage,read> solid:array<u32>;
@group(0) @binding(2) var<storage,read_write> headers:array<atomic<u32>>;
@group(0) @binding(3) var<storage,read_write> jobs:array<atomic<u32>>;
@group(0) @binding(4) var<storage,read_write> faces:array<u32>;
@group(0) @binding(5) var<storage,read_write> prefix:array<u32>;
@group(0) @binding(6) var<storage,read_write> draw:array<atomic<u32>>;
@group(0) @binding(7) var<uniform> p:Params;
fn tc(i:u32)->vec3<u32>{return vec3<u32>(i%TD.x,(i/TD.x)%TD.y,i/(TD.x*TD.y));}
fn ti(c:vec3<u32>)->u32{return c.x+TD.x*(c.y+TD.y*c.z);}
fn coord(i:u32)->vec3<u32>{return vec3<u32>(i%p.dims.x,(i/p.dims.x)%p.dims.y,i/(p.dims.x*p.dims.y));}
fn index(c:vec3<u32>)->u32{return c.x+p.dims.x*(c.y+p.dims.y*c.z);}
fn local_coord(i:u32)->vec3<u32>{return vec3<u32>(i%B,(i/B)%B,i/(B*B));}
fn filled(c:vec3<i32>)->f32{if(any(c<vec3<i32>(0))||any(c>=vec3<i32>(p.dims.xyz))){return 0.0;}let i=index(vec3<u32>(c));return select(density[i],1.0,solid[i]!=0u);}
fn mark(c:vec3<u32>){
 let tile=ti(c/B);atomicStore(&headers[tile*8u],1u);atomicStore(&headers[tile*8u+2u],1u);
 // Adjacent surface ownership can change even if the neighbour did not move.
 for(var axis=0u;axis<3u;axis++){for(var side=0u;side<2u;side++){
  var q=vec3<i32>(c);q[axis]+=select(-1,1,side==1u);
  if(all(q>=vec3<i32>(0))&&all(q<vec3<i32>(p.dims.xyz))){atomicStore(&headers[ti(vec3<u32>(q)/B)*8u+2u],1u);}
 }}
}
fn penetration(c:vec3<u32>)->f32{
 if(p.contact.w<=0.0){return 0.0;}let w=p.origin.xyz+(vec3<f32>(c)+vec3<f32>(.5))*p.origin.w;
 let d=p.contact.xyz-p.previous.xyz;let s=clamp(dot(w-p.previous.xyz,d)/max(dot(d,d),1e-12),0.0,1.0);
 return max(0.0,p.contact.w-length(w-(p.previous.xyz+s*d)))/p.origin.w;
}
@compute @workgroup_size(1) fn reset(){
 for(var i=0u;i<5u;i++){atomicStore(&jobs[${t.count*2+8}u+i],0u);}atomicAdd(&jobs[${t.count*2+8}u+5],1u);
 atomicStore(&jobs[${t.count*2}u+0],0u);atomicStore(&jobs[${t.count*2}u+1],1u);atomicStore(&jobs[${t.count*2}u+2],1u);
 atomicStore(&jobs[${t.count*2+4}u+0],0u);atomicStore(&jobs[${t.count*2+4}u+1],1u);atomicStore(&jobs[${t.count*2+4}u+2],1u);
}
@compute @workgroup_size(64) fn admit(@builtin(global_invocation_id) gid:vec3<u32>){
 let tile=gid.x;if(tile>=NT){return;}let c=tc(tile);var awake=false;
 for(var z=max(0,i32(c.z)-HALO);z<=min(i32(TD.z)-1,i32(c.z)+HALO);z++){
 for(var y=max(0,i32(c.y)-HALO);y<=min(i32(TD.y)-1,i32(c.y)+HALO);y++){
 for(var x=max(0,i32(c.x)-HALO);x<=min(i32(TD.x)-1,i32(c.x)+HALO);x++){
  if(atomicLoad(&headers[ti(vec3<u32>(u32(x),u32(y),u32(z)))*8u])!=0u){awake=true;}
 }}}
 if(p.mode.z!=0u&&(p.contact.w>0.0||p.previous.w>0.0)){
  let current=select(p.contact,p.previous,p.contact.w<=0.0);let previous=select(p.previous,current,p.previous.w<=0.0);
  let r=max(current.w,previous.w)+6.0*p.origin.w;
  let low=p.origin.xyz+vec3<f32>(c*B)*p.origin.w;
  let high=p.origin.xyz+vec3<f32>(min((c+vec3<u32>(1))*B,p.dims.xyz))*p.origin.w;
  if(all(low<=max(current.xyz,previous.xyz)+vec3<f32>(r))&&all(high>=min(current.xyz,previous.xyz)-vec3<f32>(r))){awake=true;}
 }
 atomicStore(&headers[tile*8u+1u],select(0u,1u,awake));
 if(awake){let valid=min(vec3<u32>(B),p.dims.xyz-c*B);atomicAdd(&jobs[${t.count*2+8}u+3],valid.x*valid.y*valid.z*6u);let slot=atomicAdd(&jobs[${t.count*2+8}u+0],1u);atomicStore(&jobs[slot],tile);atomicAdd(&jobs[${t.count*2}u+0],G);atomicAdd(&headers[tile*8u+4u],1u);}
}
@compute @workgroup_size(64) fn clear_wake(@builtin(global_invocation_id) gid:vec3<u32>){if(gid.x<NT){atomicStore(&headers[gid.x*8u],0u);}}
@compute @workgroup_size(64) fn exchange(@builtin(workgroup_id) wg:vec3<u32>,@builtin(local_invocation_id) lid:vec3<u32>){
 let local=(wg.x%G)*64u+lid.x;if(local>=V){return;}let tile=atomicLoad(&jobs[wg.x/G]);let c=tc(tile)*B+local_coord(local);
 if(any(c>=p.dims.xyz)){return;}let i=index(c);let axis=p.mode.x;
 if(c[axis]%2u!=p.mode.y||c[axis]+1u>=p.dims[axis]){return;}
 var q=c;q[axis]+=1u;let j=index(q);if(solid[i]!=0u||solid[j]!=0u){return;}
 let a=density[i];let b=density[j];if(a==0.0&&b==0.0){return;}let pa=penetration(c);let pb=penetration(q);var transfer=0.0;
 if(pa>pb+1e-5){transfer=min(a,1.0-b);}else if(pb>pa+1e-5){transfer=-min(b,1.0-a);}
 else if(pa==0.0&&pb==0.0){if(axis==1u){transfer=-min(b,1.0-a);}else{let diff=a-b;if(abs(diff)>.5){transfer=sign(diff)*(abs(diff)-.5)*.5;}}}
 let na=a-transfer;let nb=b+transfer;if(na!=a&&nb!=b){density[i]=na;density[j]=nb;mark(c);mark(q);atomicAdd(&jobs[${t.count*2+8}u+2],1u);}
}
@compute @workgroup_size(64) fn admit_surface(@builtin(global_invocation_id) gid:vec3<u32>){
 let tile=gid.x;if(tile>=NT||atomicLoad(&headers[tile*8u+2u])==0u){return;}
 atomicStore(&headers[tile*8u+2u],0u);atomicStore(&headers[tile*8u+3u],0u);atomicAdd(&headers[tile*8u+5u],1u);
 let slot=atomicAdd(&jobs[${t.count*2+8}u+1],1u);atomicStore(&jobs[${t.count}u+slot],tile);atomicAdd(&jobs[${t.count*2+4}u+0],G);
}
@compute @workgroup_size(64) fn build_surface(@builtin(workgroup_id) wg:vec3<u32>,@builtin(local_invocation_id) lid:vec3<u32>){
 let local=(wg.x%G)*64u+lid.x;if(local>=V){return;}let tile=atomicLoad(&jobs[${t.count}u+wg.x/G]);let c=tc(tile)*B+local_coord(local);
 if(any(c>=p.dims.xyz)){return;}let a=density[index(c)];if(a<=0.0){return;}
 for(var face=0u;face<6u;face++){
  let axis=face/2u;var q=vec3<i32>(c);q[axis]+=select(-1,1,face%2u==1u);let b=filled(q);
  let exposed=select(a>b,select(a<1.0||b<=0.0,b<1.0,face==2u),axis==1u);
  if(exposed){let slot=atomicAdd(&headers[tile*8u+3u],1u);faces[tile*V*6u+slot]=local*6u+face;}
 }
}
@compute @workgroup_size(1) fn draw_prefix(){
 var total=0u;for(var tile=0u;tile<NT;tile++){prefix[tile]=total;total+=atomicLoad(&headers[tile*8u+3u]);}prefix[NT]=total;
 atomicStore(&draw[1],total);atomicStore(&jobs[${t.count*2+8}u+4],total);
}
`;}
const address=THREE.TSL.wgslFn(`fn ash_face_address(rank:u32,nt:u32,v:u32,faces:ptr<storage,array<u32>,read>,prefix:ptr<storage,array<u32>,read>)->vec2<u32>{
 var lo=0u;var hi=nt;loop{if(lo>=hi){break;}let mid=(lo+hi)/2u;if((*prefix)[mid+1u]<=rank){lo=mid+1u;}else{hi=mid;}}
 return vec2<u32>(lo,(*faces)[lo*v*6u+rank-(*prefix)[lo]]);
}`);
const vertex=THREE.TSL.wgslFn(`fn ash_face_vertex(a:vec2<u32>,uv:vec2<f32>,b:u32,td:vec3<u32>,dims:vec3<u32>,origin:vec3<f32>,size:f32,density:ptr<storage,array<f32>,read>,solid:ptr<storage,array<u32>,read>)->vec3<f32>{
 let local=a.y/6u;let face=a.y%6u;let tile=vec3<u32>(a.x%td.x,(a.x/td.x)%td.y,a.x/(td.x*td.y));
 let c=tile*b+vec3<u32>(local%b,(local/b)%b,local/(b*b));let i=c.x+dims.x*(c.y+dims.y*c.z);let amount=(*density)[i];
 var q=vec3<i32>(c);q[face/2u]+=select(-1,1,face%2u==1u);var low=0.0;
 if(all(q>=vec3<i32>(0))&&all(q<vec3<i32>(dims))){let j=u32(q.x)+dims.x*(u32(q.y)+dims.y*u32(q.z));low=select((*density)[j],1.0,(*solid)[j]!=0u);}
 let y=mix(low,amount,uv.y);var p=vec3<f32>(0.0);
 switch face{case 0u:{p=vec3<f32>(0,y,uv.x);}case 1u:{p=vec3<f32>(1,y,1.0-uv.x);}case 2u:{p=vec3<f32>(uv.x,0,uv.y);}case 3u:{p=vec3<f32>(uv.x,amount,1.0-uv.y);}case 4u:{p=vec3<f32>(1.0-uv.x,y,0);}default:{p=vec3<f32>(uv.x,y,1);}}
 return origin+(vec3<f32>(c)+p)*size;
}`);
const faceNormal=THREE.TSL.wgslFn(`fn ash_face_normal(f:u32)->vec3<f32>{var n=vec3<f32>(0);n[f/2u]=select(-1.0,1.0,f%2u==1u);return n;}`);
export async function createGpuTiledAsh({renderer,cellSize,bounds,solid,tileSize=16}){
 if(!renderer?.backend?.isWebGPUBackend)throw Error('Tiled ash requires shared WebGPU renderer');
 const device=renderer.backend.device,p=patchLayout({cellSize,bounds,tileSize}),t=p.tiles;
 if(solid.length!==p.count)throw Error('Collision mask shape differs from tiled ash');
 const faceWords=t.count*t.cellsPerTile*6;
 for(const bytes of [p.count*4,t.count*32,faceWords*4])if(bytes>device.limits.maxStorageBufferBindingSize||bytes>device.limits.maxBufferSize)throw Error('Tiled ash exceeds effective GPU buffer capacity');
 if(t.count*t.groupsPerTile>device.limits.maxComputeWorkgroupsPerDimension)throw Error('Tiled ash exceeds effective indirect dispatch dimension');
 const owned=[],attrs=[];let mesh,fall,disposed=false,steps=0,snapshots=0,lastContact=null,seededVolume=0;
 const buffer=(label,size,extra=0)=>{const b=device.createBuffer({label,size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST|extra});owned.push(b);return b;};
 const attribute=(array,indirect=false)=>{const a=indirect?new THREE.IndirectStorageBufferAttribute(array,1):new THREE.StorageBufferAttribute(array,1);attrs.push(a);if(indirect)renderer.backend.createIndirectStorageAttribute(a);else renderer.backend.createStorageAttribute(a);return {attribute:a,buffer:renderer.backend.get(a).buffer};};
 try{
 const density=attribute(new Float32Array(p.count)),collision=attribute(Uint32Array.from(solid)),faces=attribute(new Uint32Array(faceWords)),prefix=attribute(new Uint32Array(t.count+1)),draw=attribute(new Uint32Array([6,0,0,0,0]),true);
 const headers=buffer('ash tile headers',t.count*32),jobs=buffer('ash tile jobs and counters',(t.count*2+16)*4);
 const indirect=label=>{const b=device.createBuffer({label,size:16,usage:GPUBufferUsage.INDIRECT|GPUBufferUsage.COPY_DST});owned.push(b);return {buffer:b,offset:0};};const work=indirect('ash active dispatch'),surfaceWork=indirect('ash dirty dispatch');
 // Existing transport consumes the same global density and marks tile arrivals.
 const oldWake=buffer('ash transport compatibility wake',16);
 fall=await createGpuAshFall({renderer,layout:p,density:density.buffer,collision:collision.buffer,wake:oldWake,tileHeaders:headers});
 const module=device.createShaderModule({label:'connected ash tiles',code:tileShader(p)}),errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>m.message).join('; '));
 const bindLayout=device.createBindGroupLayout({entries:Array.from({length:8},(_,binding)=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===7?'uniform':binding===1?'read-only-storage':'storage'}}))}),pl=device.createPipelineLayout({bindGroupLayouts:[bindLayout]});
 const entries=['reset','admit','clear_wake','exchange','admit_surface','build_surface','draw_prefix'];
 const pipes=Object.fromEntries(await Promise.all(entries.map(async entryPoint=>[entryPoint,await device.createComputePipelineAsync({layout:pl,compute:{module,entryPoint}})])));
 const uniforms=[],groups=[];
 for(let phase=0;phase<6;phase++){const u=device.createBuffer({label:'ash tile phase',size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});owned.push(u);uniforms.push(u);groups.push(device.createBindGroup({layout:bindLayout,entries:[density.buffer,collision.buffer,headers,jobs,faces.buffer,prefix.buffer,draw.buffer,u].map((buffer,binding)=>({binding,resource:{buffer}}))}));}
 const {storage,uint,uvec3,vec3,positionGeometry,instanceIndex,transformNormalToView}=THREE.TSL;
 const d=storage(density.attribute,'float',p.count).toReadOnly(),s=storage(collision.attribute,'uint',p.count).toReadOnly();
 const addr=address({rank:instanceIndex,nt:uint(t.count),v:uint(t.cellsPerTile),faces:storage(faces.attribute,'uint',faceWords).toReadOnly(),prefix:storage(prefix.attribute,'uint',t.count+1).toReadOnly()});
 const geometry=new THREE.PlaneGeometry(1,1);geometry.setIndirect(draw.attribute);
 const material=new THREE.MeshStandardNodeMaterial({color:0xb9b3a8,roughness:1});
 material.positionNode=vertex({a:addr,uv:positionGeometry.xy.add(.5),b:uint(t.width),td:uvec3(...t.dims),dims:uvec3(...p.dims),origin:vec3(...p.origin),size:THREE.TSL.float(cellSize),density:d,solid:s});
 material.normalNode=transformNormalToView(faceNormal({f:addr.y.mod(uint(6))}));
 mesh=new THREE.Mesh(geometry,material);mesh.name='Tiled retained ash';mesh.frustumCulled=false;mesh.castShadow=true;mesh.receiveShadow=true;mesh.add(fall.root);
 const params=(contact,previous,moved)=>{for(let phase=0;phase<6;phase++){const bytes=new ArrayBuffer(80),u=new Uint32Array(bytes),f=new Float32Array(bytes);u.set([...p.dims,p.count]);f.set([...p.origin,cellSize],4);f.set(contact??[0,0,0,0],8);f.set(previous??contact??[0,0,0,0],12);u.set([[1,0,2][Math.floor(phase/2)],phase%2,moved?1:0,0],16);device.queue.writeBuffer(uniforms[phase],0,bytes);}};
 const dispatch=(e,name,n,{phase=0,indirect=null}={})=>{const pass=e.beginComputePass({label:'ash '+name});pass.setPipeline(pipes[name]);pass.setBindGroup(0,groups[phase]);if(indirect)pass.dispatchWorkgroupsIndirect(indirect.buffer,indirect.offset);else pass.dispatchWorkgroups(n);pass.end();};
 const rebuild=()=>{params(null,null,false);const e=device.createCommandEncoder();dispatch(e,'reset',1);dispatch(e,'admit_surface',Math.ceil(t.count/64));e.copyBufferToBuffer(jobs,t.count*8+16,surfaceWork.buffer,0,12);dispatch(e,'build_surface',0,{indirect:surfaceWork});dispatch(e,'draw_prefix',1);device.queue.submit([e.finish()]);};
 const check=()=>{if(disposed)throw Error('Tiled ash disposed');};
 const upload=(values,pending=null)=>{device.queue.writeBuffer(density.buffer,0,values);const h=new Uint32Array(t.count*8);for(let tile=0;tile<t.count;tile++){h[tile*8]=pending?pending.has(tile)?1:0:1;h[tile*8+2]=1;}device.queue.writeBuffer(headers,0,h);rebuild();};
 async function capture(){check();snapshots++;const size=p.count*4+t.count*32+32,b=device.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=device.createCommandEncoder();e.copyBufferToBuffer(density.buffer,0,b,0,p.count*4);e.copyBufferToBuffer(headers,0,b,p.count*4,t.count*32);e.copyBufferToBuffer(jobs,t.count*8+32,b,p.count*4+t.count*32,32);device.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const data=b.getMappedRange();return {values:new Float32Array(data.slice(0,p.count*4)),headers:new Uint32Array(data.slice(p.count*4,p.count*4+t.count*32)),stats:Array.from(new Uint32Array(data.slice(p.count*4+t.count*32)))};}finally{b.unmap();b.destroy();}}
 return {root:mesh,layout:p,
  step(contact=null,source=null){check();if(contact&&(!Array.isArray(contact)||contact.length!==4||!contact.every(Number.isFinite)||contact[3]<=0))throw Error('Invalid contact');const moved=JSON.stringify(contact)!==JSON.stringify(lastContact);params(contact,lastContact,moved);lastContact=contact?.slice()??null;const e=device.createCommandEncoder();if(source)fall.encode(e,{...source,contact});dispatch(e,'reset',1);dispatch(e,'admit',Math.ceil(t.count/64));dispatch(e,'clear_wake',Math.ceil(t.count/64));e.copyBufferToBuffer(jobs,t.count*8,work.buffer,0,12);for(let phase=0;phase<6;phase++)dispatch(e,'exchange',0,{phase,indirect:work});dispatch(e,'admit_surface',Math.ceil(t.count/64));e.copyBufferToBuffer(jobs,t.count*8+16,surfaceWork.buffer,0,12);dispatch(e,'build_surface',0,{indirect:surfaceWork});dispatch(e,'draw_prefix',1);device.queue.submit([e.finish()]);steps++;},
  async deposit(input){const old=await capture(),values=seedPatch(p,solid,input,old.values),h=old.headers.slice();
   for(const tile of seededTiles(p,values,old.values)){h[tile*8]=1;h[tile*8+2]=1;}
   for(let i=0;i<p.count;i++)if(values[i]!==old.values[i]){const c=cellCoord(p,i);for(let axis=0;axis<3;axis++)for(const side of [-1,1]){const q=[...c];q[axis]+=side;if(q.every((v,k)=>v>=0&&v<p.dims[k]))h[tileIndex(p,q)*8+2]=1;}}
   device.queue.writeBuffer(density.buffer,0,values);device.queue.writeBuffer(headers,0,h);rebuild();seededVolume+=input.blanketDepth===undefined?input.volume:values.reduce((sum,v,i)=>sum+v-old.values[i],0)*cellSize**3;},
  burst(volume){check();fall.request(volume);},
  async diagnostics({fields=false}={}){const c=await capture();return {...(fields?{values:Array.from(c.values),solid:Array.from(solid)}:{}),stats:{activeTiles:c.stats[0],rebuiltTiles:c.stats[1],changedPairs:c.stats[2],exchangeCellVisits:c.stats[3],visibleFaces:c.stats[4]},tiles:Array.from({length:t.count},(_,i)=>({id:i,pending:c.headers[i*8],awake:c.headers[i*8+1],dirty:c.headers[i*8+2],faces:c.headers[i*8+3],updates:c.headers[i*8+4],surfaceRevision:c.headers[i*8+5]})),transport:await fall.schedulingSnapshot?.()};},
  async snapshot(){const c=await capture(),air=await fall.snapshot(),pending=new Float32Array(new Uint32Array(air.state).buffer)[0];return {schema:'kaminos.tiled-ash.v1',layout:p,values:Array.from(c.values),pendingTiles:Array.from({length:t.count},(_,i)=>i).filter(i=>c.headers[i*8]!==0),steps,seededVolume,volume:seededVolume+fall.read().requestedVolume,retainedVolume:retainedVolume({density:c.values,parcels:air.particles,pendingUnits:pending,cellSize})+air.queuedVolume,falling:air,lastContact,visibleFaces:c.stats[4]};},
  restore(state){check();if(state?.schema!=='kaminos.tiled-ash.v1'||JSON.stringify(state.layout)!==JSON.stringify(p)||!Array.isArray(state.values)||state.values.length!==p.count||state.values.some((v,i)=>!Number.isFinite(v)||v<0||v>1||(solid[i]&&v!==0))||!Array.isArray(state.pendingTiles)||state.pendingTiles.some(i=>!Number.isSafeInteger(i)||i<0||i>=t.count)||!Number.isSafeInteger(state.steps)||state.steps<0||!Number.isFinite(state.seededVolume)||state.seededVolume<0||!(state.lastContact===null||Array.isArray(state.lastContact)&&state.lastContact.length===4&&state.lastContact.every(Number.isFinite)&&state.lastContact[3]>0))throw Error('Invalid tiled ash checkpoint');fall.validate(state.falling);const values=Float32Array.from(state.values),introduced=state.seededVolume+state.falling.requestedVolume,pending=new Float32Array(new Uint32Array(state.falling.state).buffer)[0],actual=retainedVolume({density:values,parcels:state.falling.particles,pendingUnits:pending,cellSize})+state.falling.queuedVolume;if(!Number.isFinite(state.volume)||state.volume<0||!Number.isFinite(introduced)||Math.abs(introduced-state.volume)>1e-8)throw Error('Checkpoint source ledger differs');if(Math.abs(actual-introduced)>Math.max(1e-9,introduced*1e-4))throw Error('Checkpoint volume differs from retained material');upload(values,new Set(state.pendingTiles));fall.restore(state.falling);steps=state.steps;seededVolume=state.seededVolume;lastContact=state.lastContact?.slice()??null;},
  read:()=>({backend:'webgpu-connected-ash-tiles',surface:'gpu-cached-exposed-faces',layout:p,steps,volume:seededVolume+fall.read().requestedVolume,falling:fall.read(),runtimeReadbacks:0,explicitReadbacks:snapshots,allocatedBytes:owned.reduce((n,b)=>n+b.size,0)+attrs.reduce((n,a)=>n+a.array.byteLength,0)+fall.read().allocatedBytes,allocationMeaning:'explicit buffers; excludes renderer geometry/material/pipeline allocations',lastContact,boundary:'connected internal tiles; closed outer bounds; no discard',surfaceCache:'resident per tile; dirty rebuilds; one prefix-indexed indirect face draw'}),
  dispose(){if(disposed)return;disposed=true;fall?.dispose();mesh?.removeFromParent();mesh?.geometry.dispose();mesh?.material.dispose();for(const a of attrs)renderer.backend.destroyAttribute(a);for(const b of owned)b.destroy();}
 };
 }catch(error){fall?.dispose();mesh?.geometry.dispose();mesh?.material.dispose();for(const a of attrs)renderer.backend.destroyAttribute(a);for(const b of owned)b.destroy();throw error;}
}
