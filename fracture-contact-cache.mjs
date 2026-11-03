// Recompute contact reactions and pair collision gates when the attachment system changes.
export const CONTACT_TOPOLOGY_RESET = /* wgsl */`
struct Parameters { handTarget: vec4f, counts: vec4u, control: vec4f, binding: vec4u }
@group(0) @binding(0) var<storage, read> joints: array<vec4f>;
@group(0) @binding(1) var<storage, read> damage: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> changed: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> contacts: array<vec4f>;
@group(0) @binding(4) var<uniform> params: Parameters;
@group(0) @binding(5) var<storage, read> positions: array<vec4f>;
@group(0) @binding(6) var<storage, read> quaternions: array<vec4f>;
@group(0) @binding(7) var<storage, read> ignoredPairs: array<vec4f>;
@group(0) @binding(8) var<storage, read_write> pairActivity: array<atomic<u32>>;

fn rotate(q: vec4f, v: vec3f) -> vec3f {
 return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}
fn boxesSeparated(posA: vec3f, qA: vec4f, halfA: vec3f, posB: vec3f, qB: vec4f, halfB: vec3f) -> bool {
 let d=posB-posA; let qa=normalize(qA); let qb=normalize(qB);
 let u0=rotate(qa,vec3f(1.0,0.0,0.0)); let u1=rotate(qa,vec3f(0.0,1.0,0.0)); let u2=rotate(qa,vec3f(0.0,0.0,1.0));
 let v0=rotate(qb,vec3f(1.0,0.0,0.0)); let v1=rotate(qb,vec3f(0.0,1.0,0.0)); let v2=rotate(qb,vec3f(0.0,0.0,1.0));
 let r0=abs(vec3f(dot(u0,v0),dot(u0,v1),dot(u0,v2)));
 let r1=abs(vec3f(dot(u1,v0),dot(u1,v1),dot(u1,v2)));
 let r2=abs(vec3f(dot(u2,v0),dot(u2,v1),dot(u2,v2)));
 if(abs(dot(d,u0))>halfA.x+dot(r0,halfB)) { return true; }
 if(abs(dot(d,u1))>halfA.y+dot(r1,halfB)) { return true; }
 if(abs(dot(d,u2))>halfA.z+dot(r2,halfB)) { return true; }
 if(abs(dot(d,v0))>halfB.x+dot(vec3f(r0.x,r1.x,r2.x),halfA)) { return true; }
 if(abs(dot(d,v1))>halfB.y+dot(vec3f(r0.y,r1.y,r2.y),halfA)) { return true; }
 if(abs(dot(d,v2))>halfB.z+dot(vec3f(r0.z,r1.z,r2.z),halfA)) { return true; }
 return false;
}

@compute @workgroup_size(64)
fn markChanged(@builtin(global_invocation_id) id: vec3u) {
 let i=id.x;
 if(i>=params.counts.y) { return; }
 let broke=damage[i*3u].w>0.0 && u32(damage[i*3u].w)==params.counts.z-1u;
 let bound=damage[i*3u+2u].z==2.0 && u32(damage[i*3u+2u].y)==params.counts.z;
 if(!broke && !bound) { return; }
 atomicMax(&changed[params.counts.x],params.counts.z);
 let record=bitcast<vec4u>(joints[i*11u]);
 if(record.x<params.counts.x) { atomicMax(&changed[record.x],params.counts.z); }
 if(record.y<params.counts.x) { atomicMax(&changed[record.y],params.counts.z); }
}

@compute @workgroup_size(64)
fn updateIgnoredPairs(@builtin(global_invocation_id) id: vec3u) {
 let p=id.x*4u;
 if(p+3u>=arrayLength(&ignoredPairs)) { return; }
 let pairMeta=bitcast<vec4u>(ignoredPairs[p]);
 if(pairMeta.w==0u) { return; }
 let path=bitcast<vec4u>(ignoredPairs[p+1u]);
 var pathAlive=path.x!=0xffffffffu;
 for(var k=0u;k<4u;k++) {
  let b=path[k];
  if(b!=0xffffffffu && bitcast<vec4u>(joints[b*11u]).w==0u) { pathAlive=false; }
 }
 if(pathAlive) {
  atomicOr(&pairActivity[pairMeta.z],pairMeta.w);
  return;
 }
 if((atomicLoad(&pairActivity[pairMeta.z])&pairMeta.w)==0u) { return; }
 let extA=ignoredPairs[p+2u]; let extB=ignoredPairs[p+3u];
 if(extA.w==0.0 || boxesSeparated(positions[pairMeta.x].xyz,quaternions[pairMeta.x],extA.xyz,positions[pairMeta.y].xyz,quaternions[pairMeta.y],extB.xyz)) {
  atomicAnd(&pairActivity[pairMeta.z],~pairMeta.w);
 }
}

@compute @workgroup_size(64)
fn resetContacts(@builtin(global_invocation_id) id: vec3u) {
 if(atomicLoad(&changed[params.counts.x])!=params.counts.z) { return; }
 let base=id.x*9u;
 if(base+8u>=arrayLength(&contacts)) { return; }
 let record=contacts[base];
 if(record.z<=0.0) { return; }
 let a=u32(record.x); let b=u32(record.y);
 var invalid=false;
 if(a<params.counts.x) { invalid=atomicLoad(&changed[a])==params.counts.z; }
 if(b<params.counts.x) { invalid=invalid || atomicLoad(&changed[b])==params.counts.z; }
 if(!invalid) { return; }
 // Contact generation reuses shadow; the solver also reads the hot dual.
 // Geometry, friction, penalties and correspondence remain intact.
 contacts[base+5u]=vec4f(vec3f(0.0),contacts[base+5u].w);
 contacts[base+6u]=vec4f(0.0);
}
`;

export function buildIgnoredPairTable(cells,bonds,pairIgnoredBitsOffset=0) {
 const adj=cells.map(()=>[]),direct=new Map();
 bonds.forEach((b,idx)=>{
  adj[b.a].push({to:b.b,bond:idx});adj[b.b].push({to:b.a,bond:idx});
  const key=Math.min(b.a,b.b)+':'+Math.max(b.a,b.b);
  if(!direct.has(key))direct.set(key,[]);direct.get(key).push(idx);
 });
 const shortestPath=(src,dst)=>{
  const prev=new Int32Array(cells.length).fill(-1),prevBond=new Int32Array(cells.length).fill(-1),q=[src];prev[src]=src;
  for(let h=0;h<q.length;h++){
   const u=q[h];if(u===dst)break;
   for(const {to,bond} of adj[u])if(prev[to]<0){prev[to]=u;prevBond[to]=bond;q.push(to);}
  }
  if(prev[dst]<0)return [];
  const path=[];for(let cur=dst;cur!==src;cur=prev[cur])path.push(prevBond[cur]);
  path.reverse();return path;
 };
 const pairs=[];
 for(let i=0;i<cells.length;i++)for(let j=i+1;j<cells.length;j++){
  const a=cells[i],b=cells[j],key=i+':'+j,db=direct.get(key);
  const minOverlap=Math.min(...[0,1,2].map(k=>(a.halfExtents[k]+b.halfExtents[k])-Math.abs(a.position[k]-b.position[k])));
  if(!db&&minOverlap<=-2e-3)continue;
  const rawPath=db??shortestPath(i,j);
  const sampled=rawPath.length<=4?rawPath:[rawPath[0],rawPath[Math.floor(rawPath.length/3)],rawPath[Math.floor(2*rawPath.length/3)],rawPath[rawPath.length-1]];
  const padded=[sampled[0]??0xffffffff,sampled[1]??0xffffffff,sampled[2]??0xffffffff,sampled[3]??0xffffffff];
  const pairIndex=(j*(j-1))/2+i,wordOffset=pairIgnoredBitsOffset+(pairIndex>>>5),bitMask=(1<<(pairIndex&31))>>>0;
  pairs.push({i,j,pairIndex,wordOffset,bitMask,bonds:padded,requireSeparation:minOverlap>1e-4,minOverlap});
 }
 const buffer=new ArrayBuffer(Math.max(1,pairs.length)*64),u32=new Uint32Array(buffer),f32=new Float32Array(buffer);
 pairs.forEach((p,idx)=>{
  const base=idx*16,a=cells[p.i].halfExtents,b=cells[p.j].halfExtents,slop=1.5e-3;
  u32.set([p.i,p.j,p.wordOffset,p.bitMask],base);
  u32.set(p.bonds,base+4);
  f32.set([a[0]+slop,a[1]+slop,a[2]+slop,p.requireSeparation?1:0],base+8);
  f32.set([b[0]+slop,b[1]+slop,b[2]+slop,0],base+12);
 });
 return {pairs,data:new Float32Array(buffer)};
}

export async function createContactTopologyReset(device,{joints,damage,contacts,parameters,positions,quaternions,pairActivity,ignoredPairs,bodies,bonds,contactCount}) {
 const module=device.createShaderModule({label:'Fracture contact reaction invalidation',code:CONTACT_TOPOLOGY_RESET});
 const info=await module.getCompilationInfo();
 if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.map(m=>m.message).join('\n'));
 const layout=device.createBindGroupLayout({entries:Array.from({length:9},(_,binding)=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===4?'uniform':[0,1,5,6,7].includes(binding)?'read-only-storage':'storage'}}))});
 const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
 const pipelines=[];
 for(const entryPoint of ['markChanged','updateIgnoredPairs','resetContacts'])pipelines.push(await device.createComputePipelineAsync({label:`Fracture ${entryPoint}`,layout:pipelineLayout,compute:{module,entryPoint}}));
 const changed=device.createBuffer({label:'Fracture attachment-change epochs',size:Math.max(4,(bodies+1)*4),usage:GPUBufferUsage.STORAGE});
 const pairData=ignoredPairs?.data??new Float32Array(16),pairCount=ignoredPairs?.pairs?.length??0;
 const pairBuffer=device.createBuffer({label:'Fracture ignored pair table',size:Math.max(64,pairData.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
 device.queue.writeBuffer(pairBuffer,0,pairData);
 try {
  const resources=[joints,damage,changed,contacts,parameters,positions,quaternions,pairBuffer,pairActivity];
  const group=device.createBindGroup({layout,entries:resources.map((buffer,binding)=>({binding,resource:{buffer}}))});
  return {encode(encoder){
   if(!bonds&&!pairCount)return;
   const pass=encoder.beginComputePass({label:'Fracture contact reaction reset'});
   pass.setBindGroup(0,group);
   if(bonds){pass.setPipeline(pipelines[0]);pass.dispatchWorkgroups(Math.ceil(bonds/64));}
   if(pairCount){pass.setPipeline(pipelines[1]);pass.dispatchWorkgroups(Math.ceil(pairCount/64));}
   if(bonds){pass.setPipeline(pipelines[2]);pass.dispatchWorkgroups(Math.ceil(contactCount/64));}
   pass.end();
  },dispose(){changed.destroy();pairBuffer.destroy();}};
 }catch(error){changed.destroy();pairBuffer.destroy();throw error;}
}
