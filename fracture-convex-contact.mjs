import {encodeCoarseExternalCompute} from './fracture-compute-batch.mjs';
import {contactShapeFeatures,boxContactShape} from './fracture-contact-shape.mjs';
import {contactTopology} from './fracture-contact-topology.mjs';

export function packContactShapes(cells,bonds){
 const topology=contactTopology(cells,bonds),records=Array.from({length:cells.length*4},()=>new Uint32Array(4));
 const u=values=>{const at=records.length;records.push(Uint32Array.from([...values,0,0,0,0].slice(0,4)));return at;};
 const f=values=>{const at=records.length;records.push(Float32Array.from([...values,0,0,0,0].slice(0,4)));return at;};
 const ids=values=>{const start=records.length;for(let i=0;i<values.length;i+=4)u(values.slice(i,i+4));return start;};
 let maxFaceVertices=0;
 cells.forEach((cell,i)=>{
  const shape=cell.collisionHull??boxContactShape(cell.halfExtents),features=contactShapeFeatures(shape);
  const vertexStart=records.length;for(let v=0;v<shape.vertices.length;v+=3)f(shape.vertices.subarray(v,v+3));
  const faceStart=records.length;for(let j=0;j<shape.faces.length;j++){u([0,shape.faces[j].length]);f(features.normals[j]);maxFaceVertices=Math.max(maxFaceVertices,shape.faces[j].length);}
  shape.faces.forEach((face,j)=>{records[faceStart+j*2][0]=ids(face);});
  const edgeStart=records.length;for(const edge of features.edges)u(edge);
  const adjStart=records.length;for(const edge of topology.adjacency[i])u(edge);
  records[i*4]=Uint32Array.from([vertexStart,shape.vertices.length/3,faceStart,shape.faces.length]);
  records[i*4+1]=Uint32Array.from([edgeStart,features.edges.length,adjStart,topology.adjacency[i].length]);
  records[i*4+2]=Float32Array.from([...cell.halfExtents,0]);
 });
 const pairStart=records.length;for(const p of topology.pairs)u([0,p.direct.length,Number(p.initialNeighbor),0]);
 for(const [i,p]of topology.pairs.entries())records[pairStart+i][0]=ids(p.direct);
 const data=new Float32Array(records.length*4),words=new Uint32Array(data.buffer);
 records.forEach((r,i)=>{if(r instanceof Uint32Array)words.set(r,i*4);else data.set(r,i*4);});
 return {data,topology,pairStart,maxFaceVertices,bodyCount:cells.length};
}

export function convexContactShader({bodyCount,pairStart,maxFaceVertices,friction}){
 // Clipping an m-gon by n half-planes yields at most m+n vertices.
 // This capacity follows the supplied geometry, never a sampled vertex budget.
 const polygonCapacity=2*maxFaceVertices;
 return /* wgsl */`
@group(0) @binding(0) var<storage,read> positions:array<vec4f>;
@group(0) @binding(1) var<storage,read> quaternions:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> contacts:array<vec4f>;
@group(0) @binding(3) var<storage,read> shape:array<vec4f>;
@group(0) @binding(4) var<storage,read> joints:array<vec4f>;
@group(0) @binding(5) var<storage,read_write> labels:array<u32>;
var<workgroup> connected:array<atomic<u32>,${bodyCount}>;
const N:u32=${bodyCount}u;
const PAIRS:u32=${bodyCount*(bodyCount-1)/2}u;
const POLYGON:u32=${polygonCapacity}u;
const SLOP:f32=0.001;
const MARGIN:f32=0.0005;
fn word(i:u32)->vec4u{return bitcast<vec4u>(shape[i]);}
fn list(start:u32,i:u32)->u32{return word(start+i/4u)[i%4u];}
fn rotate(q:vec4f,p:vec3f)->vec3f{return p+2.0*cross(q.xyz,cross(q.xyz,p)+q.w*p);}
fn inverseRotate(q:vec4f,p:vec3f)->vec3f{return rotate(vec4f(-q.xyz,q.w),p);}
fn point(body:u32,v:u32)->vec3f{return positions[body].xyz+rotate(quaternions[body],shape[word(body*4u).x+v].xyz);}
fn faceNormal(body:u32,face:u32)->vec3f{return rotate(quaternions[body],shape[word(body*4u).z+face*2u+1u].xyz);}
fn faceInfo(body:u32,face:u32)->vec4u{return word(word(body*4u).z+face*2u);}
fn edgeInfo(body:u32,edge:u32)->vec4u{return word(word(body*4u+1u).x+edge);}
fn alive(bond:u32)->bool{return bitcast<vec4u>(joints[bond*11u]).w!=0u;}
fn eligible(pair:u32,a:u32,b:u32)->bool{
 let p=word(${pairStart}u+pair);
 if(p.y>0u){for(var k=0u;k<p.y;k++){if(alive(list(p.x,k))){return false;}}return true;}
 return p.z==0u||labels[a]!=labels[b];
}
@compute @workgroup_size(64)
fn components(@builtin(local_invocation_index) lane:u32){
 for(var i=lane;i<N;i+=64u){atomicStore(&connected[i],i);}workgroupBarrier();
 // A simple path has at most N-1 edges; all rounds remain on GPU.
 for(var round=0u;round+1u<N;round++){
  for(var i=lane;i<N;i+=64u){var value=atomicLoad(&connected[i]);let adj=word(i*4u+1u);
   for(var k=0u;k<adj.w;k++){let e=word(adj.z+k);if(alive(e.y)){value=min(value,atomicLoad(&connected[e.x]));}}
   atomicMin(&connected[i],value);
  }
  workgroupBarrier();
 }
 for(var i=lane;i<N;i+=64u){labels[i]=atomicLoad(&connected[i]);}
}
struct Axis {gap:f32,normal:vec3f,kind:u32,a:u32,b:u32}
fn projection(body:u32,n:vec3f,origin:vec3f)->vec2f{
 let h=word(body*4u);var lo=1e30;var hi=-1e30;
 for(var v=0u;v<h.y;v++){let x=dot(point(body,v)-origin,n);lo=min(lo,x);hi=max(hi,x);}return vec2f(lo,hi);
}
fn evaluate(a:u32,b:u32,n:vec3f,kind:u32,fa:u32,fb:u32)->Axis{
 let origin=positions[a].xyz;let aa=projection(a,n,origin);let bb=projection(b,n,origin);
 if(kind==2u&&aa.x-bb.y>bb.x-aa.y){return Axis(aa.x-bb.y,-n,kind,fa,fb);}
 return Axis(bb.x-aa.y,n,kind,fa,fb);
}
fn clear(pair:u32,a:u32,b:u32){for(var s=0u;s<4u;s++){let base=(pair*4u+s)*9u;contacts[base]=vec4f(f32(a),f32(b),0.0,0.0);contacts[base+8u]=vec4f(0.0);}}
struct Polygon {points:array<vec3f,${polygonCapacity}>,count:u32}
fn facePolygon(body:u32,face:u32)->Polygon{
 let info=faceInfo(body,face);var p:Polygon;p.count=info.y;
 for(var k=0u;k<info.y;k++){p.points[k]=point(body,list(info.x,k));}return p;
}
fn clip(input:Polygon,origin:vec3f,outward:vec3f)->Polygon{
 var output:Polygon;if(input.count==0u){return output;}
 var a=input.points[input.count-1u];var da=dot(a-origin,outward);
 for(var k=0u;k<input.count;k++){let b=input.points[k];let db=dot(b-origin,outward);
  if((da<=0.0)!=(db<=0.0)){output.points[output.count]=mix(a,b,da/(da-db));output.count++;}
  if(db<=0.0){output.points[output.count]=b;output.count++;}a=b;da=db;
 }return output;
}
fn tangent(n:vec3f)->vec3f{
 let reference=select(vec3f(0.0,1.0,0.0),vec3f(1.0,0.0,0.0),abs(n.y)>0.999);return normalize(cross(reference,n));
}
struct Candidate {a:vec3f,b:vec3f,depth:f32}
struct Candidates {points:array<Candidate,${polygonCapacity}>,count:u32}
fn faceContacts(a:u32,b:u32,axis:Axis)->Candidates{
 let reference=select(a,b,axis.kind==1u);let incident=select(b,a,axis.kind==1u);
 let face=select(axis.a,axis.b,axis.kind==1u);let outward=select(axis.normal,-axis.normal,axis.kind==1u);
 let incidentCount=word(incident*4u).w;var inc=0u;var best=1e30;
 for(var f=0u;f<incidentCount;f++){let d=dot(faceNormal(incident,f),outward);if(d<best){best=d;inc=f;}}
 let referencePolygon=facePolygon(reference,face);var poly=facePolygon(incident,inc);
 for(var k=0u;k<referencePolygon.count;k++){let origin=referencePolygon.points[k];let edge=referencePolygon.points[(k+1u)%referencePolygon.count]-origin;poly=clip(poly,origin,normalize(cross(edge,outward)));}
 var out:Candidates;
 for(var k=0u;k<poly.count;k++){let p=poly.points[k];let depth=-dot(p-referencePolygon.points[0],outward);
  if(depth>=0.0){let projected=p+outward*depth;
   out.points[out.count]=Candidate(select(projected,p,axis.kind==1u),select(p,projected,axis.kind==1u),depth);out.count++;
  }
 }return out;
}
fn supportEdge(body:u32,direction:vec3f,normal:vec3f)->vec4u{
 let h=word(body*4u+1u);var edge=vec4u(0u);var best=-1e30;
 for(var k=0u;k<h.y;k++){let e=edgeInfo(body,k);let p=point(body,e.x);let q=point(body,e.y);let d=normalize(q-p);
  if(abs(dot(d,direction))>0.99999){let score=dot((p+q)*0.5,normal);if(score>best){best=score;edge=e;}}
 }return edge;
}
fn edgeContacts(a:u32,b:u32,axis:Axis)->Candidates{
 let ea=edgeInfo(a,axis.a);let eb=edgeInfo(b,axis.b);
 let ua=normalize(point(a,ea.y)-point(a,ea.x));let ub=normalize(point(b,eb.y)-point(b,eb.x));
 let aa=supportEdge(a,ua,axis.normal);let bb=supportEdge(b,ub,-axis.normal);
 let p=point(a,aa.x);let q=point(b,bb.x);let u=point(a,aa.y)-p;let v=point(b,bb.y)-q;let w=p-q;
 let A=dot(u,u);let B=dot(u,v);let C=dot(v,v);let D=dot(u,w);let E=dot(v,w);let denom=A*C-B*B;
 var s=0.0;if(denom>1e-20){s=clamp((B*E-C*D)/denom,0.0,1.0);}var t=clamp((B*s+E)/C,0.0,1.0);s=clamp((B*t-D)/A,0.0,1.0);t=clamp((B*s+E)/C,0.0,1.0);
 let pa=p+u*s;let pb=q+v*t;var out:Candidates;
 let depth=-dot(pb-pa,axis.normal);if(depth>=0.0){out.points[0]=Candidate(pa,pb,depth);out.count=1u;}return out;
}
@compute @workgroup_size(64)
fn generate(@builtin(global_invocation_id) id:vec3u){
 let pair=id.x;if(pair>=PAIRS){return;}
 var b=u32(floor((1.0+sqrt(1.0+8.0*f32(pair)))*0.5));if(b*(b-1u)/2u>pair){b--;}
 let a=pair-b*(b-1u)/2u;
 if(!eligible(pair,a,b)||positions[a].w+positions[b].w==0.0){clear(pair,a,b);return;}
 let ha=shape[a*4u+2u].xyz;let hb=shape[b*4u+2u].xyz;
 let qa=quaternions[a];let qb=quaternions[b];
 let boundsA=abs(rotate(qa,vec3f(ha.x,0.0,0.0)))+abs(rotate(qa,vec3f(0.0,ha.y,0.0)))+abs(rotate(qa,vec3f(0.0,0.0,ha.z)));
 let boundsB=abs(rotate(qb,vec3f(hb.x,0.0,0.0)))+abs(rotate(qb,vec3f(0.0,hb.y,0.0)))+abs(rotate(qb,vec3f(0.0,0.0,hb.z)));
 if(any(abs(positions[b].xyz-positions[a].xyz)>boundsA+boundsB+vec3f(SLOP))){clear(pair,a,b);return;}
 let A=word(a*4u);let B=word(b*4u);var axis=Axis(-1e30,vec3f(0.0,1.0,0.0),0u,0u,0u);
 for(var f=0u;f<A.w;f++){let candidate=evaluate(a,b,faceNormal(a,f),0u,f,0u);if(candidate.gap>SLOP){clear(pair,a,b);return;}if(candidate.gap>axis.gap){axis=candidate;}}
 for(var f=0u;f<B.w;f++){let candidate=evaluate(a,b,-faceNormal(b,f),1u,0u,f);if(candidate.gap>SLOP){clear(pair,a,b);return;}if(candidate.gap>axis.gap){axis=candidate;}}
 let AE=word(a*4u+1u);let BE=word(b*4u+1u);
 for(var i=0u;i<AE.y;i++){let ea=edgeInfo(a,i);let u=normalize(point(a,ea.y)-point(a,ea.x));
  for(var j=0u;j<BE.y;j++){let eb=edgeInfo(b,j);let v=normalize(point(b,eb.y)-point(b,eb.x));let n=cross(u,v);let l=dot(n,n);
   if(l>1e-12){let candidate=evaluate(a,b,n*inverseSqrt(l),2u,i,j);if(candidate.gap>SLOP){clear(pair,a,b);return;}if(candidate.gap>axis.gap+0.0001){axis=candidate;}}
  }
 }
 var candidates:Candidates;if(axis.kind==2u){candidates=edgeContacts(a,b,axis);}else{candidates=faceContacts(a,b,axis);}
 if(candidates.count==0u){clear(pair,a,b);return;}
 var selected:array<u32,4>;var count=min(candidates.count,4u);
 for(var s=0u;s<count;s++){var best=-1.0;var winner=0u;
  for(var k=0u;k<candidates.count;k++){var used=false;for(var t=0u;t<s;t++){used=used||selected[t]==k;}if(used){continue;}
   var score=candidates.points[k].depth;
   if(s>0u){score=1e30;let p=(candidates.points[k].a+candidates.points[k].b)*0.5;
    for(var t=0u;t<s;t++){let c=candidates.points[selected[t]];let d=p-(c.a+c.b)*0.5;score=min(score,dot(d,d));}
   }if(score>best){best=score;winner=k;}
  }selected[s]=winner;
 }
 var previous:array<array<vec4f,9>,4>;
 for(var s=0u;s<4u;s++){for(var k=0u;k<9u;k++){previous[s][k]=contacts[(pair*4u+s)*9u+k];}}
 var used:u32=0u;var features:u32=0u;let n=axis.normal;let t1=tangent(n);let t2=cross(n,t1);
 var matches:array<u32,4>;
 for(var s=0u;s<count;s++){
  let c=candidates.points[selected[s]];let localA=inverseRotate(qa,c.a-positions[a].xyz);let localB=inverseRotate(qb,c.b-positions[b].xyz);
  // Exact support-face identity persists while its contact points slide.
  // Like the native compact-manifold merge, choose the nearest unmatched
  // point without resetting its reaction at an arbitrary displacement limit.
  var matchedSlot=4u;var best=1e30;
  for(var old=0u;old<4u;old++){
   let cached=bitcast<vec4u>(previous[old][8]);
   if((used&(1u<<old))!=0u||previous[old][0].z<=0.0||cached.y!=axis.kind||cached.z!=axis.a||cached.w!=axis.b||dot(previous[old][1].xyz,n)<0.99){continue;}
   let dA=previous[old][2].xyz-localA;let dB=previous[old][3].xyz-localB;let d=dot(dA,dA)+dot(dB,dB);
   if(d<best){best=d;matchedSlot=old;}
  }
  matches[s]=matchedSlot;
  if(matchedSlot<4u){used|=1u<<matchedSlot;features|=1u<<(bitcast<u32>(previous[matchedSlot][0].w)&0x1ffu);}
 }
 for(var s=0u;s<count;s++){
  let c=candidates.points[selected[s]];var localA=inverseRotate(qa,c.a-positions[a].xyz);var localB=inverseRotate(qb,c.b-positions[b].xyz);let matchedSlot=matches[s];
  let base=(pair*4u+s)*9u;var feature=s;var flags=0u;
  if(matchedSlot<4u){
   let oldFlags=bitcast<u32>(previous[matchedSlot][0].w);feature=oldFlags&0x1ffu;
   flags=(oldFlags&((127u<<9u)|(1u<<17u)))|(1u<<16u)|(1u<<21u);
   if((oldFlags&(1u<<17u))!=0u){localA=previous[matchedSlot][2].xyz;localB=previous[matchedSlot][3].xyz;flags|=1u<<18u;}
  }
  // A fresh row cannot alias a feature already carried by another point.
  if(matchedSlot==4u){feature=0u;while((features&(1u<<feature))!=0u){feature++;}}
  features|=1u<<feature;
  let delta=positions[a].xyz+rotate(qa,localA)-positions[b].xyz-rotate(qb,localB);let depth=dot(delta,n);
  // Native sticking matches retain their material anchors only while those
  // anchors still touch. A separating point loses its entire correspondence.
  if(depth<0.0){contacts[base]=vec4f(f32(a),f32(b),0.0,0.0);contacts[base+8u]=vec4f(0.0);continue;}
  contacts[base]=vec4f(f32(a),f32(b),f32(pair+1u),bitcast<f32>(feature|flags));
  contacts[base+1u]=vec4f(n,depth);contacts[base+2u]=vec4f(localA,0.0);contacts[base+3u]=vec4f(localB,0.0);
  contacts[base+4u]=vec4f(-depth+MARGIN,dot(delta,t1),dot(delta,t2),0.0);
  if(matchedSlot<4u){
   let oldN=previous[matchedSlot][1].xyz;let oldT=tangent(oldN);let oldB=cross(oldN,oldT);
   let dual=previous[matchedSlot][6];let shadow=previous[matchedSlot][5];let d=oldT*dual.y+oldB*dual.z;let h=oldT*shadow.y+oldB*shadow.z;
   let oldC0=previous[matchedSlot][4];let c0T=oldT*oldC0.y+oldB*oldC0.z;
   contacts[base+4u]=vec4f(-depth+MARGIN,dot(c0T,t1),dot(c0T,t2),0.0);
   var shadowT=vec2f(dot(h,t1),dot(h,t2));let shadowN=max(shadow.x,0.0);let bound=${friction}*shadow.w*shadowN;
   if(dot(shadowT,shadowT)>bound*bound&&dot(shadowT,shadowT)>1e-12){shadowT*=bound*inverseSqrt(dot(shadowT,shadowT));}
   contacts[base+5u]=vec4f(shadowN,shadowT,shadow.w);
   contacts[base+6u]=vec4f(dual.x,dot(d,t1),dot(d,t2),0.0);contacts[base+7u]=previous[matchedSlot][7];
   contacts[base+8u]=bitcast<vec4f>(vec4u(bitcast<u32>(previous[matchedSlot][8].x),axis.kind,axis.a,axis.b));
  }else{
   contacts[base+5u]=vec4f(0.0,0.0,0.0,${friction});contacts[base+6u]=vec4f(0.0);contacts[base+7u]=vec4f(1.0,1.0,1.0,${friction});
   contacts[base+8u]=bitcast<vec4f>(vec4u(0u,axis.kind,axis.a,axis.b));
  }
 }
 for(var s=count;s<4u;s++){let base=(pair*4u+s)*9u;contacts[base]=vec4f(f32(a),f32(b),0.0,0.0);contacts[base+8u]=vec4f(0.0);}
}
`;
}

export async function createConvexBodyContacts(device,{cells,bonds,positions,quaternions,contacts,joints,friction}){
 const packed=packContactShapes(cells,bonds),bodyCount=cells.length;
 if(bodyCount*4>device.limits.maxComputeWorkgroupStorageSize)throw Error('Contact topology exceeds native workgroup storage capacity');
 const data=device.createBuffer({label:'Complete material collision shapes and topology',size:Math.max(16,packed.data.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
 const labels=device.createBuffer({label:'Resident material contact components',size:Math.max(4,bodyCount*4),usage:GPUBufferUsage.STORAGE});
 try{
  device.queue.writeBuffer(data,0,packed.data);
  const code=convexContactShader({...packed,friction}),module=device.createShaderModule({label:'Convex material contacts',code}),info=await module.getCompilationInfo();
  if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.map(m=>m.message).join('\n'));
  const layout=device.createBindGroupLayout({entries:Array.from({length:6},(_,binding)=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:[2,5].includes(binding)?'storage':'read-only-storage'}}))});
  const group=device.createBindGroup({layout,entries:[positions,quaternions,contacts,data,joints,labels].map((buffer,binding)=>({binding,resource:{buffer}}))});
  const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]}),pipelines={};
  for(const entryPoint of ['components','generate'])pipelines[entryPoint]=await device.createComputePipelineAsync({label:'Material contact '+entryPoint,layout:pipelineLayout,compute:{module,entryPoint}});
  return {bodyCount,packedBytes:packed.data.byteLength,code,encode(renderer){encodeCoarseExternalCompute(renderer,encoder=>{const pass=encoder.beginComputePass({label:'Resident convex material contact generation'});pass.setBindGroup(0,group);pass.setPipeline(pipelines.components);pass.dispatchWorkgroups(1);if(bodyCount>1){pass.setPipeline(pipelines.generate);pass.dispatchWorkgroups(Math.ceil(bodyCount*(bodyCount-1)/2/64));}pass.end();});},dispose(){data.destroy();labels.destroy();}};
 }catch(error){data.destroy();labels.destroy();throw error;}
}
