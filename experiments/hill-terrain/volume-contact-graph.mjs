// Each unordered, touching source-convex pair owns one patch. Capacity comes
// from the finite number of possible pairs and the effective storage binding
// limit; it never limits a body's neighbor count. Larger-than-arena workloads
// fail visibly at the batch boundary, rather than dropping physical contacts.
export const CONTACT_BYTES=352;
export function contactGraphConfig(model,packed,limits){
 const n=model.bodies.length,offset=Math.ceil((32+8*n)/16)*16;
 const nativeBytes=Math.min(limits.maxBufferSize,limits.maxStorageBufferBindingSize);
 const possible=n*(n-1)/2,capacity=Math.min(possible,Math.floor((nativeBytes-offset)/CONTACT_BYTES));
 if(capacity<Math.min(possible,1))throw Error('Device storage cannot represent a rock contact');
 const faces=[],directory=new Float32Array(packed.planes.length);let plane=0,maxFace=0,maxPlanes=0;
 for(const body of model.bodies){
  maxPlanes=Math.max(maxPlanes,body.solid.planes.length);
  for(const p of body.solid.planes){
   const face=body.solid.faces.find(f=>f.vertices.every(v=>Math.abs(v[0]*p[0]+v[1]*p[1]+v[2]*p[2]-p[3])<1e-6));
   if(!face){plane++;continue;}
   directory[plane*4]=directory.length/4+faces.length/4;directory[plane*4+1]=face.vertices.length;
   for(const v of face.vertices)faces.push(...v,0);maxFace=Math.max(maxFace,face.vertices.length);plane++;
  }
 }
 const data=new Float32Array(directory.length+faces.length);data.set(directory);data.set(faces,directory.length);
 return{capacity,possible,offset,bytes:Math.max(offset+capacity*CONTACT_BYTES,offset+CONTACT_BYTES),faces:data,polygonCapacity:maxFace+maxPlanes,needsCapacityReadback:capacity<possible};
}

export function contactGraphKernels({bodyCount,polygonCapacity,spherePairs=false}){return `
const SPHERE_CONTACT:bool=${spherePairs};
const CONTACT_BODY_COUNT:u32=${bodyCount}u;
const PATCH_POLYGON_SIZE:u32=${polygonCapacity}u;
struct Contact {
 ids:vec4u, normal:vec4f,
 localA:array<vec4f,4>, localB:array<vec4f,4>,
 impulse:array<vec4f,4>, delta:array<vec4f,4>, position:array<vec4f,4>
}
struct Graph {
 header:array<atomic<u32>,8>, heads:array<atomic<u32>,CONTACT_BODY_COUNT>,
 degrees:array<atomic<u32>,CONTACT_BODY_COUNT>, contacts:array<Contact>
}
@group(2) @binding(0) var<storage,read_write> graph:Graph;
@group(2) @binding(1) var<storage,read> contactFaces:array<vec4f>;
@group(2) @binding(2) var<storage,read_write> contactDispatch:array<u32>;
struct Polygon { points:array<vec3f,PATCH_POLYGON_SIZE>, count:u32 }
fn source_patch(a:Body,b:Body,n:vec3f)->Polygon{
 var best=-1e30;var face=0u;
 for(var j=0u;j<a.shape.y;j++){let d=dot(rot(a.q,planes[a.shape.x+j].xyz),-n);if(contactFaces[a.shape.x+j].y>0.&&d>best){best=d;face=a.shape.x+j;}}
 let desc=contactFaces[face];var poly:Polygon;poly.count=u32(desc.y);
 for(var k=0u;k<poly.count;k++){poly.points[k]=a.p.xyz+rot(a.q,contactFaces[u32(desc.x)+k].xyz);}
 for(var j=0u;j<b.shape.y;j++){
  if(poly.count==0u){break;}var next:Polygon;let pl=planes[b.shape.x+j];
  for(var k=0u;k<poly.count;k++){
   let p=poly.points[k];let q=poly.points[(k+1u)%poly.count];
   let dp=dot(pl.xyz,invrot(b.q,p-b.p.xyz))-pl.w;let dq=dot(pl.xyz,invrot(b.q,q-b.p.xyz))-pl.w;
   if(dp<=0.){next.points[next.count]=p;next.count++;}
   if((dp<=0.)!=(dq<=0.)){next.points[next.count]=mix(p,q,dp/(dp-dq));next.count++;}
  }poly=next;
 }return poly;
}
fn make_contact(ai:u32,bi:u32,a:Body,b:Body,frame:vec4f)->Contact{
 var c:Contact;c.ids=vec4u(ai,bi,0u,0u);c.normal=vec4f(frame.xyz,0.);
 let poly=source_patch(a,b,frame.xyz);var selected:array<vec3f,4>;var count=0u;
 if(poly.count>0u){
  let helper=select(vec3f(0,1,0),vec3f(1,0,0),abs(frame.y)>.8);let t=normalize(cross(frame.xyz,helper));let u=cross(frame.xyz,t);
  let directions=array<vec3f,4>(t+u,t-u,-t-u,-t+u);
  for(var j=0u;j<4u;j++){var score=-1e30;var p=poly.points[0];for(var k=0u;k<poly.count;k++){let d=dot(poly.points[k],directions[j]);if(d>score){score=d;p=poly.points[k];}}
   var duplicate=false;for(var k=0u;k<count;k++){if(distance(p,selected[k])<1e-6){duplicate=true;}}if(!duplicate){selected[count]=p;count++;}
  }
  for(var k=0u;k<count;k++){
   let p=selected[k];let local=invrot(b.q,p-b.p.xyz);let direction=invrot(b.q,frame.xyz);var distance=1e30;
   for(var j=0u;j<b.shape.y;j++){let pl=planes[b.shape.x+j];let den=dot(pl.xyz,direction);if(den>1e-7){distance=min(distance,max(0.,(pl.w-dot(pl.xyz,local))/den));}}
   c.localA[k]=vec4f(invrot(a.q,p-a.p.xyz),0.);c.localB[k]=vec4f(invrot(b.q,p+frame.xyz*distance-b.p.xyz),0.);
  }
 }else{
  // Edge contact has no clipped face patch. SAT supplies its normal/depth;
  // the existing exact source-support construction supplies its location.
  count=1u;let p=(support_center(a,frame.xyz)+support_center(b,-frame.xyz))*.5;
  c.localA[0]=vec4f(invrot(a.q,p-frame.xyz*frame.w*.5-a.p.xyz),0.);
  c.localB[0]=vec4f(invrot(b.q,p+frame.xyz*frame.w*.5-b.p.xyz),0.);
 }
 c.normal.w=f32(count);return c;
}
@compute @workgroup_size(64) fn generate_contacts(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_index) lane:u32){
 let i=group.x+groups.x*(group.y+groups.y*group.z);if(i>=arrayLength(&bodies)){return;}
 if(lane==0u){satBody=bodies[i];}let a=workgroupUniformLoad(&satBody);
 let extent=a.size.x+spatial.origin.w*.5;let lo=bucket(a.p.xyz-vec3f(extent));let hi=bucket(a.p.xyz+vec3f(extent));
 for(var x=lo.x;x<=hi.x;x++){for(var y=lo.y;y<=hi.y;y++){for(var z=lo.z;z<=hi.z;z++){
  if(lane==0u){satHead=atomicLoad(&bodyHeads[bucket_index(vec3i(x,y,z))]);}var link=workgroupUniformLoad(&satHead);
  while(link>0u){let j=link-1u;if(lane==0u){satNeighbor=SatNeighbor(bodies[j],bodyLinks[j]);}let neighbor=workgroupUniformLoad(&satNeighbor);link=neighbor.next;let b=neighbor.body;
   if(j<=i||(a.p.w==0.&&b.p.w==0.)||distance(a.p.xyz,b.p.xyz)>a.size.x+b.size.x){continue;}
   let f=parallel_convex_contact(a,b,lane);if(f.w<=0.||f.w>=1e29){continue;}
   if(lane==0u){
    let index=atomicAdd(&graph.header[0],1u);
    if(index>=arrayLength(&graph.contacts)){atomicStore(&graph.header[1],1u);}else{
     var c=make_contact(i,j,a,b,f);let count=u32(c.normal.w);
     c.ids.z=atomicExchange(&graph.heads[i],index+1u);c.ids.w=atomicExchange(&graph.heads[j],index+1u);
     atomicAdd(&graph.degrees[i],1u);atomicAdd(&graph.degrees[j],1u);graph.contacts[index]=c;
    }
   }
  }
 }}}
}
${spherePairs?`
fn sphere_patch(i:u32,j:u32,a:Body,b:Body)->Contact{
 var c:Contact;c.ids=vec4u(i,j,0u,0u);
 var deepest=0.;var buriedNormal=vec3f(0.);var buriedA=vec3f(0.);var buriedB=vec3f(0.);
 for(var k=0u;k<2u;k++){for(var l=0u;l<2u;l++){
  let x=world_lobe(i,k,a);let y=world_lobe(j,l,b);
  let d=x.xyz-y.xyz;let len=length(d);let depth=x.w+y.w-len;if(depth<=0.){continue;}
  let n=select(vec3f(0.,1.,0.),d/max(len,1e-12),len>1e-12);
  let pa=x.xyz-x.w*n;let pb=y.xyz+y.w*n;
  let otherA=world_lobe(i,1u-k,a);let otherB=world_lobe(j,1u-l,b);
  if(distance(pa,otherA.xyz)<otherA.w-1e-6||distance(pb,otherB.xyz)<otherB.w-1e-6){
   if(depth>deepest){deepest=depth;buriedNormal=n;buriedA=pa;buriedB=pb;}continue;
  }
  let at=u32(c.normal.w);
  c.localA[at]=vec4f(invrot(a.q,pa-a.p.xyz),0.);
  c.localB[at]=vec4f(invrot(b.q,pb-b.p.xyz),0.);
  c.position[at]=vec4f(0.,n);c.normal.w+=1.;
 }}
 if(c.normal.w==0.&&deepest>0.){
  c.localA[0]=vec4f(invrot(a.q,buriedA-a.p.xyz),0.);
  c.localB[0]=vec4f(invrot(b.q,buriedB-b.p.xyz),0.);
  c.position[0]=vec4f(0.,buriedNormal);c.normal.w=1.;
 }
 return c;
}
@compute @workgroup_size(64) fn generate_sphere_contacts(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=arrayLength(&bodies)){return;}let a=bodies[i];
 let extent=a.size.x+spatial.origin.w*.5;let lo=bucket(a.p.xyz-vec3f(extent));let hi=bucket(a.p.xyz+vec3f(extent));
 for(var x=lo.x;x<=hi.x;x++){for(var y=lo.y;y<=hi.y;y++){for(var z=lo.z;z<=hi.z;z++){
  var link=atomicLoad(&bodyHeads[bucket_index(vec3i(x,y,z))]);
  while(link>0u){let j=link-1u;link=bodyLinks[j];let b=bodies[j];
   if(j<=i||(a.p.w==0.&&b.p.w==0.)||distance(a.p.xyz,b.p.xyz)>a.size.x+b.size.x){continue;}
   var c=sphere_patch(i,j,a,b);if(c.normal.w==0.){continue;}
   let index=atomicAdd(&graph.header[0],1u);
   if(index>=arrayLength(&graph.contacts)){atomicStore(&graph.header[1],1u);continue;}
   c.ids.z=atomicExchange(&graph.heads[i],index+1u);c.ids.w=atomicExchange(&graph.heads[j],index+1u);
   atomicAdd(&graph.degrees[i],1u);atomicAdd(&graph.degrees[j],1u);graph.contacts[index]=c;
  }
 }}}
}
`:''}
@compute @workgroup_size(1) fn prepare_contacts(){
 let count=min(atomicLoad(&graph.header[0]),arrayLength(&graph.contacts));
 contactDispatch[0]=(count+63u)/64u;contactDispatch[1]=1u;contactDispatch[2]=1u;
}
@compute @workgroup_size(64) fn solve_contacts(@builtin(global_invocation_id) id:vec3u){
 if(atomicLoad(&graph.header[1])>0u||id.x>=atomicLoad(&graph.header[0])){return;}
 var c=graph.contacts[id.x];var a=bodies[c.ids.x];var b=bodies[c.ids.y];
 let degree=max(select(0u,atomicLoad(&graph.degrees[c.ids.x]),a.p.w>0.),select(0u,atomicLoad(&graph.degrees[c.ids.y]),b.p.w>0.));let relax=1./f32(max(1u,degree));
 var before:array<vec4f,4>;var beforeP:array<f32,4>;
 for(var k=0u;k<u32(c.normal.w);k++){before[k]=c.impulse[k];beforeP[k]=c.position[k].x;}
 // A patch is a small block: its points share local body responses. Global
 // Jacobi iterations couple these blocks through the per-body gather.
 for(var sweep=0u;sweep<4u;sweep++){for(var k=0u;k<u32(c.normal.w);k++){
  let n=select(c.normal.xyz,c.position[k].yzw,SPHERE_CONTACT);
  let ra=rot(a.q,c.localA[k].xyz);let rb=rot(b.q,c.localB[k].xyz);let rel=a.v.xyz+cross(a.w.xyz,ra)-b.v.xyz-cross(b.w.xyz,rb);
  let kn=max(pair_effective(a,b,ra,rb,n),1e-12);let old=c.impulse[k];let normal=max(0.,old.w-dot(rel,n)/kn);let dn=normal-old.w;
  let normalImpulse=n*dn;let after=rel+normalImpulse*(a.p.w+b.p.w)+cross(responsive_inertia(a,cross(ra,normalImpulse)),ra)+cross(responsive_inertia(b,cross(rb,normalImpulse)),rb);
  let tang=after-n*dot(after,n);let speed=length(tang);var friction=old.xyz;
  if(speed>1e-8){let t=tang/speed;friction-=t*speed/max(pair_effective(a,b,ra,rb,t),1e-12);}
  let limit=cfg.forces.z*normal;let magnitude=length(friction);if(magnitude>limit&&magnitude>0.){friction*=limit/magnitude;}
  let J=normalImpulse+friction-old.xyz;c.impulse[k]=vec4f(friction,normal);
  a.v=vec4f(a.v.xyz+J*a.p.w,0.);a.w=vec4f(a.w.xyz+responsive_inertia(a,cross(ra,J)),0.);b.v=vec4f(b.v.xyz-J*b.p.w,0.);b.w=vec4f(b.w.xyz-responsive_inertia(b,cross(rb,J)),0.);
  let separation=dot(a.p.xyz+ra-b.p.xyz-rb,n);let oldPosition=c.position[k].x;let position=max(0.,oldPosition-separation/kn);let P=n*(position-oldPosition);c.position[k].x=position;
  a.p=vec4f(a.p.xyz+P*a.p.w,a.p.w);b.p=vec4f(b.p.xyz-P*b.p.w,b.p.w);
  var angle=responsive_inertia(a,cross(ra,P));var q=a.q;a.q=normalize(q+vec4f(cross(angle,q.xyz)+q.w*angle,-dot(angle,q.xyz))*.5);
  angle=-responsive_inertia(b,cross(rb,P));q=b.q;b.q=normalize(q+vec4f(cross(angle,q.xyz)+q.w*angle,-dot(angle,q.xyz))*.5);
 }}
 for(var k=0u;k<u32(c.normal.w);k++){
  let next=before[k]+(c.impulse[k]-before[k])*relax;
  let n=select(c.normal.xyz,c.position[k].yzw,SPHERE_CONTACT);
  let position=beforeP[k]+(c.position[k].x-beforeP[k])*relax;c.position[k].x=position;
  c.delta[k]=vec4f(n*(next.w-before[k].w)+next.xyz-before[k].xyz,position-beforeP[k]);c.impulse[k]=next;
 }graph.contacts[id.x]=c;
}

var<workgroup> graphLinks:array<u32,64>;
var<workgroup> graphContinuation:u32;
var<workgroup> graphBroken:u32;
var<workgroup> graphSumV:array<vec4f,64>;
var<workgroup> graphSumW:array<vec4f,64>;
var<workgroup> graphSumP:array<vec4f,64>;
var<workgroup> graphSumQ:array<vec4f,64>;
@compute @workgroup_size(64) fn gather_contacts(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_index) lane:u32){
 let i=group.x+groups.x*(group.y+groups.y*group.z);if(i>=arrayLength(&bodies)){return;}
 if(lane==0u){satBody=bodies[i];satHead=atomicLoad(&graph.heads[i]);graphBroken=atomicLoad(&graph.header[1]);}let original=workgroupUniformLoad(&satBody);var link=workgroupUniformLoad(&satHead);
 let broken=workgroupUniformLoad(&graphBroken);if(original.p.w==0.||broken>0u){if(lane==0u){nextBodies[i]=original;}return;}
 var dv=vec3f(0.);var dw=vec3f(0.);var dp=vec3f(0.);var dq=vec3f(0.);
 while(link>0u){
  if(lane==0u){var current=link;for(var k=0u;k<64u;k++){graphLinks[k]=current;if(current>0u){let ids=graph.contacts[current-1u].ids;current=select(ids.w,ids.z,ids.x==i);}}graphContinuation=current;}
  workgroupBarrier();let entry=graphLinks[lane];
  if(entry>0u){let c=graph.contacts[entry-1u];let first=c.ids.x==i;let sign=select(-1.,1.,first);
   for(var k=0u;k<u32(c.normal.w);k++){var local=c.localB[k].xyz;if(first){local=c.localA[k].xyz;}let r=rot(original.q,local);let J=c.delta[k].xyz*sign;let P=select(c.normal.xyz,c.position[k].yzw,SPHERE_CONTACT)*c.delta[k].w*sign;
    dv+=J*original.p.w;dw+=inverse_inertia(original,cross(r,J));dp+=P*original.p.w;dq+=inverse_inertia(original,cross(r,P));
   }
  }link=workgroupUniformLoad(&graphContinuation);
 }
 graphSumV[lane]=vec4f(dv,0.);graphSumW[lane]=vec4f(dw,0.);graphSumP[lane]=vec4f(dp,0.);graphSumQ[lane]=vec4f(dq,0.);workgroupBarrier();
 for(var stride=32u;stride>0u;stride/=2u){if(lane<stride){graphSumV[lane]+=graphSumV[lane+stride];graphSumW[lane]+=graphSumW[lane+stride];graphSumP[lane]+=graphSumP[lane+stride];graphSumQ[lane]+=graphSumQ[lane+stride];}workgroupBarrier();}
 if(lane==0u){var b=original;b.v=vec4f(b.v.xyz+graphSumV[0].xyz,0.);b.w=vec4f(b.w.xyz+graphSumW[0].xyz,0.);b.p=vec4f(b.p.xyz+graphSumP[0].xyz,b.p.w);let angle=graphSumQ[0].xyz;let q=b.q;b.q=normalize(q+vec4f(cross(angle,q.xyz)+q.w*angle,-dot(angle,q.xyz))*.5);
  
  // worldFeatures describe the integrated pose, so floor position is corrected
  // from local source vertices instead of reading stale transformed supports.
  var lowest=vec3f(0.,1e30,0.);
  ${spherePairs?`for(var k=0u;k<2u;k++){let l=world_lobe(i,k,b);let p=l.xyz-vec3f(0.,l.w,0.);if(p.y<lowest.y){lowest=p;}}`:`for(var k=0u;k<u32(b.i1.w);k++){let p=b.p.xyz+rot(b.q,convexData[u32(b.i0.w)+k].xyz);if(p.y<lowest.y){lowest=p;}}`}
  let influence=exp(-dot(lowest.xz,lowest.xz)/.75);let floor=cfg.drive.x*influence;
  if(lowest.y<floor){b=contact_body(b,vec3f(0,1,0),floor-lowest.y,lowest,vec3f(0.,cfg.drive.y*influence,0.));}nextBodies[i]=b;
 }
}
`;} 
