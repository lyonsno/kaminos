// Polygon edits over render arrays {positions, normals?, uvs?, indices, faceMaterial?}.
// Each edit returns new arrays; topology comes from the welded kernel, attributes
// stay per render vertex, and newly created faces say which material they use.
import {ShapeUtils,Vector2} from './lib/three.core.js';
import {buildPolyMesh,NO_EDGE} from './poly-mesh-core.mjs';

function checkedPlane({point,normal}={}){
  if(![point,normal].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite)))throw Error('Cut plane needs a finite point and normal');
  const l=Math.hypot(...normal);if(!(l>0))throw Error('Cut plane normal must not be zero');
  return {p:point,n:normal.map(x=>x/l)};
}
function checkedFaceMask(arrays,mask){
  if(!mask||mask.length!==arrays.indices.length/3)throw Error('Face selection must have one entry per face');
  return mask;
}
function defaultEpsilon(positions){
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<positions.length;i++){const k=i%3;lo[k]=Math.min(lo[k],positions[i]);hi[k]=Math.max(hi[k],positions[i]);}
  return 1e-6*Math.max(Math.hypot(hi[0]-lo[0],hi[1]-lo[1],hi[2]-lo[2]),1e-12);
}
function vertexDistances(mesh,{p,n},epsilon){
  const d=new Float64Array(mesh.vertexCount),q=mesh.vertexPositions;
  for(let v=0;v<mesh.vertexCount;v++){const x=n[0]*(q[3*v]-p[0])+n[1]*(q[3*v+1]-p[1])+n[2]*(q[3*v+2]-p[2]);d[v]=Math.abs(x)<epsilon?0:x;}
  return d;
}
// Growable output arrays that start as copies of the source render vertices.
// Values stay double precision until finish, as the cut's geometric tests expect.
function grower(source,width){
  if(!source)return null;
  const g={array:new Float64Array(Math.max(source.length*1.25|0,width*16)),length:source.length};g.array.set(source);
  g.push=values=>{if(g.length+width>g.array.length){const next=new Float64Array(g.array.length*2);next.set(g.array.subarray(0,g.length));g.array=next;}g.array.set(values,g.length);g.length+=width;};
  return g;
}
function builder(arrays){
  const P=grower(arrays.positions,3),N=grower(arrays.normals,3),U=grower(arrays.uvs,2);
  // positions is a view of the filled part; it is stale after the next add, so read it afresh.
  const out={get positions(){return P.array.subarray(0,P.length);},normals:!!N,uvs:!!U,indices:[],faceMaterial:[]};
  out.add=(position,normal,uv)=>{P.push(position);if(N)N.push(normal);if(U)U.push(uv);return P.length/3-1;};
  out.finish=()=>({positions:Float32Array.from(P.array.subarray(0,P.length)),normals:N&&Float32Array.from(N.array.subarray(0,N.length)),uvs:U&&Float32Array.from(U.array.subarray(0,U.length)),indices:Uint32Array.from(out.indices),faceMaterial:Uint8Array.from(out.faceMaterial)});
  return out;
}
const area2=(P,a,b,c)=>{
  const ux=P[3*b]-P[3*a],uy=P[3*b+1]-P[3*a+1],uz=P[3*b+2]-P[3*a+2],vx=P[3*c]-P[3*a],vy=P[3*c+1]-P[3*a+1],vz=P[3*c+2]-P[3*a+2];
  return Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx);
};
// Whether point v lies inside or on triangle (a,b,c), within the triangle's plane.
function touchesTriangle(P,v,a,b,c){
  const at=(i,k)=>P[3*i+k],e0=[0,1,2].map(k=>at(b,k)-at(a,k)),e1=[0,1,2].map(k=>at(c,k)-at(a,k)),w=[0,1,2].map(k=>at(v,k)-at(a,k));
  const d00=e0[0]*e0[0]+e0[1]*e0[1]+e0[2]*e0[2],d01=e0[0]*e1[0]+e0[1]*e1[1]+e0[2]*e1[2],d11=e1[0]*e1[0]+e1[1]*e1[1]+e1[2]*e1[2];
  const d20=w[0]*e0[0]+w[1]*e0[1]+w[2]*e0[2],d21=w[0]*e1[0]+w[1]*e1[1]+w[2]*e1[2],den=d00*d11-d01*d01;
  if(!(den>0))return false;
  const s=(d11*d20-d01*d21)/den,t=(d00*d21-d01*d20)/den,tol=1e-9;
  return s>=-tol&&t>=-tol&&s+t<=1+tol;
}
// Convex polygons with collinear points on their edges: clip the largest ear that
// is non-degenerate and has no other polygon vertex on or inside it, so a point
// inserted on an edge is never skipped by an ear's closing diagonal.
function triangulateConvex(polygon,P,emit){
  const p=[...polygon],tiny=1e-18;
  while(p.length>3){
    let best=-1,bestArea=tiny;
    for(let i=0;i<p.length;i++){
      const a=p[(i+p.length-1)%p.length],b=p[i],c=p[(i+1)%p.length],area=area2(P,a,b,c);
      if(area>bestArea&&!p.some(v=>v!==a&&v!==b&&v!==c&&touchesTriangle(P,v,a,b,c))){bestArea=area;best=i;}
    }
    if(best<0)return;
    emit(p[(best+p.length-1)%p.length],p[best],p[(best+1)%p.length]);p.splice(best,1);
  }
  if(area2(P,p[0],p[1],p[2])>tiny)emit(p[0],p[1],p[2]);
}

// Extend a cut selection along the cut: a face that crosses the plane and shares a vertex with
// a face already being cut joins it, until the cut closes. A box selects faces by their centre,
// so long triangles crossing the line can fall outside it and would hold the sides together.
export function followCut(arrays,mask,plane,{epsilon}={}) {
  checkedFaceMask(arrays,mask);
  const cutPlane=checkedPlane(plane),mesh=buildPolyMesh(arrays),d=vertexDistances(mesh,cutPlane,epsilon??defaultEpsilon(arrays.positions));
  const {cornerVertex:CV,vertexFaceOffsets:VO,vertexFaces:VF}=mesh,out=Uint8Array.from(mask),stack=[];
  const crosses=f=>{let above=false,below=false;for(let c=3*f;c<3*f+3;c++){const x=d[CV[c]];above||=x>0;below||=x<0;}return above&&below;};
  for(let f=0;f<mesh.faceCount;f++)if(out[f]&&crosses(f))stack.push(f);
  let followed=0;
  while(stack.length){
    const f=stack.pop();
    for(let c=3*f;c<3*f+3;c++){const v=CV[c];for(let i=VO[v];i<VO[v+1];i++){const g=VF[i];if(!out[g]&&crosses(g)){out[g]=1;followed++;stack.push(g);}}}
  }
  return {mask:out,followed};
}

// Cut the selected faces with a plane. Faces sharing a cut edge with the selection
// absorb its cut point without being split, so no T-junction opens a crack.
export function bisectFaces(arrays,mask,plane,{epsilon}={}) {
  checkedFaceMask(arrays,mask);
  const cutPlane=checkedPlane(plane),mesh=buildPolyMesh(arrays),eps=epsilon??defaultEpsilon(arrays.positions);
  const d=vertexDistances(mesh,cutPlane,eps),edgeT=new Float64Array(mesh.edgeCount).fill(NaN);
  const {cornerEdge,cornerVertex,edgeVertices,vertexPositions:Q}=mesh,I=arrays.indices,N=arrays.normals,U=arrays.uvs;
  for(let f=0;f<mesh.faceCount;f++)if(mask[f])for(let c=3*f;c<3*f+3;c++){
    const e=cornerEdge[c];if(e===NO_EDGE)continue;
    const a=edgeVertices[2*e],b=edgeVertices[2*e+1];if(d[a]*d[b]<0)edgeT[e]=d[a]/(d[a]-d[b]);
  }
  const out=builder(arrays),cuts=new Map(),side=[],sourceFace=[],material=arrays.faceMaterial;
  const lerp=(values,width,r,s,t)=>Array.from({length:width},(_,k)=>values[width*r+k]+t*(values[width*s+k]-values[width*r+k]));
  const cutPoint=(f,i)=>{
    const c=3*f+i,e=cornerEdge[c];if(e===NO_EDGE||Number.isNaN(edgeT[e]))return -1;
    const next=3*f+(i+1)%3,lowFirst=cornerVertex[c]===edgeVertices[2*e],rLow=lowFirst?I[c]:I[next],rHigh=lowFirst?I[next]:I[c],key=`${e}:${rLow}:${rHigh}`;
    if(cuts.has(key))return cuts.get(key);
    const t=edgeT[e],a=edgeVertices[2*e],b=edgeVertices[2*e+1];
    const position=[0,1,2].map(k=>Q[3*a+k]+t*(Q[3*b+k]-Q[3*a+k]));
    let normal=N?lerp(N,3,rLow,rHigh,t):null;if(normal){const l=Math.hypot(...normal)||1;normal=normal.map(x=>x/l);}
    const r=out.add(position,normal,U?lerp(U,2,rLow,rHigh,t):null);cuts.set(key,r);return r;
  };
  const emitFace=(f,s)=>(a,b,c)=>{out.indices.push(a,b,c);out.faceMaterial.push(material?.[f]??0);side.push(s);sourceFace.push(f);};
  for(let f=0;f<mesh.faceCount;f++){
    const polygon=[];
    for(let i=0;i<3;i++){polygon.push({r:I[3*f+i],d:d[cornerVertex[3*f+i]]});const x=cutPoint(f,i);if(x>=0)polygon.push({r:x,d:0});}
    const above=polygon.some(v=>v.d>0),below=polygon.some(v=>v.d<0);
    if(!mask[f]){
      if(polygon.length===3)emitFace(f,0)(I[3*f],I[3*f+1],I[3*f+2]);
      else triangulateConvex(polygon.map(v=>v.r),out.positions,emitFace(f,0));
    }else if(!(above&&below)){
      emitFace(f,above?1:below?-1:0)(I[3*f],I[3*f+1],I[3*f+2]);
    }else{
      triangulateConvex(polygon.filter(v=>v.d>=0).map(v=>v.r),out.positions,emitFace(f,1));
      triangulateConvex(polygon.filter(v=>v.d<=0).map(v=>v.r),out.positions,emitFace(f,-1));
    }
  }
  return {arrays:out.finish(),side:Int8Array.from(side),sourceFace:Uint32Array.from(sourceFace),cutVertices:cuts.size};
}

// Split faces into the selected part and the rest, each with only the render
// vertices it uses and every attribute unchanged.
export function extractFaces(arrays,mask) {
  checkedFaceMask(arrays,mask);
  let selected=0;for(let f=0;f<mask.length;f++)if(mask[f])selected++;
  const faces=[new Uint32Array(selected),new Uint32Array(mask.length-selected)];
  for(let f=0,a=0,b=0;f<mask.length;f++)if(mask[f])faces[0][a++]=f;else faces[1][b++]=f;
  const I=arrays.indices,renderCount=arrays.positions.length/3,remap=new Int32Array(renderCount);
  // Render vertices in order of first use, so the output is the same whatever the storage.
  const take=list=>{
    remap.fill(-1);const indices=new Uint32Array(list.length*3),order=new Uint32Array(renderCount);let used=0;
    for(let j=0;j<list.length;j++)for(let i=0;i<3;i++){const r=I[3*list[j]+i];if(remap[r]<0){remap[r]=used;order[used++]=r;}indices[3*j+i]=remap[r];}
    const gather=(values,width)=>{if(!values)return null;const g=new Float32Array(used*width);for(let v=0;v<used;v++)for(let k=0;k<width;k++)g[v*width+k]=values[width*order[v]+k];return g;};
    const faceMaterial=new Uint8Array(list.length);if(arrays.faceMaterial)for(let j=0;j<list.length;j++)faceMaterial[j]=arrays.faceMaterial[list[j]];
    return {positions:gather(arrays.positions,3),normals:gather(arrays.normals,3),uvs:gather(arrays.uvs,2),indices,faceMaterial};
  };
  return {part:take(faces[0]),rest:take(faces[1]),partFaces:faces[0],restFaces:faces[1]};
}

// Close the openings that lie in a plane. Loops come from the open boundary as
// its faces traverse it, reversed, so caps face out of the part whatever its
// winding; nested loops become holes, so a cut tube gets an annulus.
export function capPlanarOpenings(arrays,plane,{side=null,epsilon,material=1}={}) {
  const capPlane=checkedPlane(plane),mesh=buildPolyMesh(arrays),eps=epsilon??defaultEpsilon(arrays.positions),d=vertexDistances(mesh,capPlane,eps);
  const {edgeFaceOffsets:offsets,edgeCorners,cornerVertex,vertexPositions:Q}=mesh,outgoing=new Map();
  for(let e=0;e<mesh.edgeCount;e++){
    if(offsets[e+1]-offsets[e]!==1)continue;
    const c=edgeCorners[offsets[e]],from=cornerVertex[c],to=cornerVertex[c-c%3+(c%3+1)%3];
    if(d[from]!==0||d[to]!==0)continue;
    if(!outgoing.has(to))outgoing.set(to,[]);outgoing.get(to).push(from);
  }
  const loops=[];let anomalies=0;
  for(const start of outgoing.keys())while(outgoing.get(start).length){
    const loop=[start];let v=outgoing.get(start).pop();
    while(v!==start){loop.push(v);const nexts=outgoing.get(v);if(!nexts?.length){anomalies++;break;}if(nexts.length>1)anomalies++;v=nexts.pop();}
    if(v===start&&loop.length>=3)loops.push(loop);
  }
  const {n,p}=capPlane,u=Math.abs(n[0])<.9?[0,-n[2],n[1]]:[n[2],0,-n[0]],ul=Math.hypot(...u),ux=u.map(x=>x/ul),vx=[n[1]*ux[2]-n[2]*ux[1],n[2]*ux[0]-n[0]*ux[2],n[0]*ux[1]-n[1]*ux[0]];
  const flat=v=>{const x=Q[3*v]-p[0],y=Q[3*v+1]-p[1],z=Q[3*v+2]-p[2];return new Vector2(x*ux[0]+y*ux[1]+z*ux[2],x*vx[0]+y*vx[1]+z*vx[2]);};
  const rings=loops.map(loop=>({loop,points:loop.map(flat)}));
  const contains=(ring,point)=>{let inside=false;const q=ring.points;for(let i=0,j=q.length-1;i<q.length;j=i++)if((q[i].y>point.y)!==(q[j].y>point.y)&&point.x<(q[j].x-q[i].x)*(point.y-q[i].y)/(q[j].y-q[i].y)+q[i].x)inside=!inside;return inside;};
  const depth=rings.map(ring=>rings.filter(other=>other!==ring&&contains(other,ring.points[0])).length);
  const out=builder(arrays),capNormal=[0,0,0];let capFaces=0;
  rings.forEach((outer,i)=>{
    if(depth[i]%2)return;
    const holes=rings.filter((ring,j)=>depth[j]===depth[i]+1&&contains(outer,ring.points[0]));
    const all=[outer,...holes],signedArea=ShapeUtils.area(outer.points),lo=new Vector2(Infinity,Infinity),hi=new Vector2(-Infinity,-Infinity);
    for(const ring of all)for(const q of ring.points){lo.min(q);hi.max(q);}
    const size=hi.clone().sub(lo),span=Math.max(size.x,size.y)||1,base=out.positions.length/3,vertices=all.flatMap(ring=>ring.loop.map((v,k)=>({v,q:ring.points[k]})));
    const facing=signedArea>0?1:-1,normal=n.map(x=>x*facing);
    for(const {v,q} of vertices)out.add([Q[3*v],Q[3*v+1],Q[3*v+2]],normal,[(q.x-lo.x)/span,(q.y-lo.y)/span]);
    for(const [a,b,c] of ShapeUtils.triangulateShape(outer.points.map(q=>q.clone()),holes.map(h=>h.points.map(q=>q.clone())))){
      const turn=(vertices[b].q.x-vertices[a].q.x)*(vertices[c].q.y-vertices[a].q.y)-(vertices[b].q.y-vertices[a].q.y)*(vertices[c].q.x-vertices[a].q.x);
      if(turn*facing>=0)out.indices.push(base+a,base+b,base+c);else out.indices.push(base+a,base+c,base+b);
      out.faceMaterial.push(material);capFaces++;
    }
    for(let k=0;k<3;k++)capNormal[k]+=normal[k];
  });
  if(side!==null&&capFaces&&Math.sign(capNormal[0]*n[0]+capNormal[1]*n[1]+capNormal[2]*n[2])!==-Math.sign(side))
    throw Error('Cap would face into the part on the requested side; the part\'s faces may be inverted');
  const result=out.finish(),existing=arrays.indices.length;
  const indices=new Uint32Array(existing+result.indices.length);indices.set(arrays.indices);indices.set(result.indices,existing);
  const faceMaterial=new Uint8Array(indices.length/3);faceMaterial.set(arrays.faceMaterial??new Uint8Array(existing/3));faceMaterial.set(result.faceMaterial,existing/3);
  return {arrays:{...result,indices,faceMaterial},loops:loops.length,capFaces,anomalies};
}

export function signedVolume({positions:P,indices:I}) {
  let v=0;
  for(let f=0;f<I.length;f+=3){
    const a=3*I[f],b=3*I[f+1],c=3*I[f+2];
    v+=P[a]*(P[b+1]*P[c+2]-P[b+2]*P[c+1])-P[a+1]*(P[b]*P[c+2]-P[b+2]*P[c])+P[a+2]*(P[b]*P[c+1]-P[b+1]*P[c]);
  }
  return v/6;
}

// Edges along a cut: they carry faces from both sides. Select Linked stops at them,
// as Blender's does at a seam marked along a bisect.
export function cutBarrier(mesh,side) {
  if(!side||side.length!==mesh.faceCount)throw Error('Cut sides must have one entry per face');
  const barrier=new Uint8Array(mesh.edgeCount);
  for(let e=0;e<mesh.edgeCount;e++){
    let above=false,below=false;
    for(let i=mesh.edgeFaceOffsets[e];i<mesh.edgeFaceOffsets[e+1];i++){const s=side[mesh.edgeCorners[i]/3|0];above||=s>0;below||=s<0;}
    barrier[e]=above&&below?1:0;
  }
  return barrier;
}

// Close a cut through generated geometry, whose opening is debris rather than loops.
// The cap is the solid's own cross-section: where the plane crosses the source
// faces it leaves segments oriented by those faces; the region of generalized
// winding number at least one half is inside. An open interior sheet adds at most
// about a half, so it cannot punch the cap; a real hole, like a tube's bore, winds
// to zero and stays open. The outline is traced on a grid, snapped back onto the
// segments, and triangulated with its holes.
export function sectionSegments(sourceArrays,mask,plane) {
  checkedFaceMask(sourceArrays,mask);
  const {p,n}=checkedPlane(plane),P=sourceArrays.positions,I=sourceArrays.indices;
  const ua=Math.abs(n[0])<.9?[0,-n[2],n[1]]:[n[2],0,-n[0]],ul=Math.hypot(...ua),U=ua.map(x=>x/ul),V=[n[1]*U[2]-n[2]*U[1],n[2]*U[0]-n[0]*U[2],n[0]*U[1]-n[1]*U[0]];
  const segments=[],dist=r=>n[0]*(P[3*r]-p[0])+n[1]*(P[3*r+1]-p[1])+n[2]*(P[3*r+2]-p[2]);
  const flat=xyz=>[(xyz[0]-p[0])*U[0]+(xyz[1]-p[1])*U[1]+(xyz[2]-p[2])*U[2],(xyz[0]-p[0])*V[0]+(xyz[1]-p[1])*V[1]+(xyz[2]-p[2])*V[2]];
  for(let f=0;f<I.length/3;f++){
    if(!mask[f])continue;
    const r=[I[3*f],I[3*f+1],I[3*f+2]],d=r.map(dist);
    if(!(d.some(x=>x>0)&&d.some(x=>x<0)))continue;
    const points=[];
    for(let i=0;i<3;i++){const j=(i+1)%3;if(d[i]===0)points.push(r[i]);if(d[i]*d[j]<0){const t=d[i]/(d[i]-d[j]);points.push([0,1,2].map(k=>P[3*r[i]+k]+t*(P[3*r[j]+k]-P[3*r[i]+k])));}}
    const q=points.map(x=>typeof x==='number'?flat([P[3*x],P[3*x+1],P[3*x+2]]):flat(x));
    if(q.length!==2)continue;
    const e0=[P[3*r[1]]-P[3*r[0]],P[3*r[1]+1]-P[3*r[0]+1],P[3*r[1]+2]-P[3*r[0]+2]],e1=[P[3*r[2]]-P[3*r[0]],P[3*r[2]+1]-P[3*r[0]+1],P[3*r[2]+2]-P[3*r[0]+2]];
    const m=[e0[1]*e1[2]-e0[2]*e1[1],e0[2]*e1[0]-e0[0]*e1[2],e0[0]*e1[1]-e0[1]*e1[0]],m2=[m[0]*U[0]+m[1]*U[1]+m[2]*U[2],m[0]*V[0]+m[1]*V[1]+m[2]*V[2]];
    let [a,b]=q;const s=[b[0]-a[0],b[1]-a[1]];
    if(s[1]*m2[0]-s[0]*m2[1]<0)[a,b]=[b,a];
    segments.push([a,b]);
  }
  return {segments,point:p,normal:n,U,V};
}

// Link oriented section segments end to start into closed loops. Neighboring faces
// compute a shared crossing in opposite edge order, so endpoints match by tolerance.
export function sectionLoops(segments) {
  const lo=[Infinity,Infinity],hi=[-Infinity,-Infinity];
  for(const s of segments)for(const q of s)for(let k=0;k<2;k++){lo[k]=Math.min(lo[k],q[k]);hi[k]=Math.max(hi[k],q[k]);}
  const tol=1e-6*Math.max(hi[0]-lo[0],hi[1]-lo[1],1e-12),key=q=>`${Math.round(q[0]/tol)},${Math.round(q[1]/tol)}`;
  const starting=new Map();segments.forEach((s,i)=>{const k=key(s[0]);if(!starting.has(k))starting.set(k,[]);starting.get(k).push(i);});
  const used=new Uint8Array(segments.length),loops=[];let openChains=0;
  for(let i=0;i<segments.length;i++){
    if(used[i])continue;
    const loop=[],first=key(segments[i][0]);let j=i,closed=false;
    while(j!==undefined&&!used[j]){
      used[j]=1;loop.push(segments[j][0]);const end=key(segments[j][1]);
      if(end===first){closed=true;break;}
      j=starting.get(end)?.find(k=>!used[k]);
    }
    if(closed&&loop.length>=3)loops.push(loop);else openChains++;
  }
  return {loops,openChains};
}

export function sectionCap(arrays,sourceArrays,mask,plane,{side,material=1,budget=4e7,fill='winding'}={}) {
  if(side!==1&&side!==-1)throw Error('Section cap needs the side the part lies on, 1 or -1');
  if(fill!=='winding'&&fill!=='outline')throw Error("Section cap fill is 'winding' or 'outline'");
  const {segments,point:p,normal:n,U,V}=sectionSegments(sourceArrays,mask,plane);
  const start=arrays.indices.length/3;
  if(!segments.length)return {arrays,capFaces:0,firstFace:start,segments:0,regions:0,openChains:0};
  if(fill==='outline'){
    const {loops,openChains}=sectionLoops(segments),rings=loops.map(loop=>loop.map(([x,y])=>new Vector2(x,y)));
    const inside=(ring,q)=>{let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++)if((ring[i].y>q.y)!==(ring[j].y>q.y)&&q.x<(ring[j].x-ring[i].x)*(q.y-ring[i].y)/(ring[j].y-ring[i].y)+ring[i].x)c=!c;return c;};
    const outermost=rings.filter((ring,i)=>!rings.some((other,j)=>j!==i&&Math.abs(ShapeUtils.area(other))>Math.abs(ShapeUtils.area(ring))&&inside(other,ring[0])));
    const capped=emitSectionCap(arrays,outermost.map(outer=>({outer,holes:[]})),{p,n,U,V,side,material,tiny:0});
    return {...capped,firstFace:start,segments:segments.length,regions:outermost.length,openChains,loops:loops.length};
  }
  const lo=[Infinity,Infinity],hi=[-Infinity,-Infinity];
  for(const s of segments)for(const q of s)for(let k=0;k<2;k++){lo[k]=Math.min(lo[k],q[k]);hi[k]=Math.max(hi[k],q[k]);}
  const span=Math.max(hi[0]-lo[0],hi[1]-lo[1])||1,cells=Math.max(48,Math.min(1024,Math.floor(Math.sqrt(budget/segments.length)))),h=span/cells;
  const nx=Math.ceil((hi[0]-lo[0])/h)+4,ny=Math.ceil((hi[1]-lo[1])/h)+4,ox=lo[0]-2*h,oy=lo[1]-2*h;
  const w=new Float32Array((nx+1)*(ny+1));
  for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){
    const x=ox+i*h,y=oy+j*h;let sum=0;
    for(const [a,b] of segments){const ax=a[0]-x,ay=a[1]-y,bx=b[0]-x,by=b[1]-y;sum+=Math.atan2(ax*by-ay*bx,ax*bx+ay*by);}
    w[j*(nx+1)+i]=sum/(2*Math.PI);
  }
  // Marching squares at w = 1/2 over grid nodes, linking edge crossings into closed outlines.
  const at=(i,j)=>w[j*(nx+1)+i],iso=.5,cross=new Map(),links=new Map();
  const point=(i0,j0,i1,j1)=>{const key=i0<i1||j0<j1?`${i0},${j0},${i1},${j1}`:`${i1},${j1},${i0},${j0}`;if(!cross.has(key)){const a=at(i0,j0),b=at(i1,j1),t=(iso-a)/(b-a);cross.set(key,[ox+(i0+t*(i1-i0))*h,oy+(j0+t*(j1-j0))*h]);}return key;};
  // The cases below are written with inside on the right; storing each piece reversed
  // makes outlines run counterclockwise around inside, holes clockwise.
  const link=(a,b)=>{links.set(b,a);};
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    const c=[at(i,j)>=iso,at(i+1,j)>=iso,at(i+1,j+1)>=iso,at(i,j+1)>=iso],code=c[0]|c[1]<<1|c[2]<<2|c[3]<<3;
    if(code===0||code===15)continue;
    const bottom=()=>point(i,j,i+1,j),right=()=>point(i+1,j,i+1,j+1),top=()=>point(i,j+1,i+1,j+1),left=()=>point(i,j,i,j+1);
    const centre=(at(i,j)+at(i+1,j)+at(i+1,j+1)+at(i,j+1))/4>=iso;
    switch(code){
      case 1:link(left(),bottom());break; case 2:link(bottom(),right());break; case 3:link(left(),right());break;
      case 4:link(right(),top());break; case 6:link(bottom(),top());break; case 7:link(left(),top());break;
      case 8:link(top(),left());break; case 9:link(top(),bottom());break; case 11:link(top(),right());break;
      case 12:link(right(),left());break; case 13:link(right(),bottom());break; case 14:link(bottom(),left());break;
      case 5:if(centre){link(left(),top());link(right(),bottom());}else{link(left(),bottom());link(right(),top());}break;
      case 10:if(centre){link(bottom(),left());link(top(),right());}else{link(bottom(),right());link(top(),left());}break;
    }
  }
  // Snap outline points onto the section segments they approximate.
  const snap=([x,y])=>{let best=null,bd=(1.5*h)**2;for(const [a,b] of segments){const sx=b[0]-a[0],sy=b[1]-a[1],l=sx*sx+sy*sy,t=l?Math.max(0,Math.min(1,((x-a[0])*sx+(y-a[1])*sy)/l)):0,px=a[0]+t*sx,py=a[1]+t*sy,dd=(px-x)**2+(py-y)**2;if(dd<bd){bd=dd;best=[px,py];}}return best??[x,y];};
  const outlines=[];const seen=new Set();
  for(const startKey of links.keys()){
    if(seen.has(startKey))continue;
    const loop=[];let key=startKey;
    while(key!==undefined&&!seen.has(key)){seen.add(key);loop.push(snap(cross.get(key)));key=links.get(key);}
    if(key===startKey&&loop.length>=3)outlines.push(loop.map(([x,y])=>new Vector2(x,y)));
  }
  const area=ShapeUtils.area,outers=outlines.filter(o=>area(o)>0),holes=outlines.filter(o=>area(o)<0);
  const inside=(ring,q)=>{let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++)if((ring[i].y>q.y)!==(ring[j].y>q.y)&&q.x<(ring[j].x-ring[i].x)*(q.y-ring[i].y)/(ring[j].y-ring[i].y)+ring[i].x)c=!c;return c;};
  const shapes=outers.map(outer=>({outer,holes:holes.filter(hole=>inside(outer,hole[0])&&!outers.some(o=>o!==outer&&area(o)<area(outer)&&inside(o,hole[0])&&inside(outer,o[0])))}));
  const capped=emitSectionCap(arrays,shapes,{p,n,U,V,side,material,tiny:1e-12*h*h});
  return {...capped,firstFace:start,segments:segments.length,regions:outers.length,openChains:0,grid:[nx,ny],cell:h};
}

// Triangulate plane-space shapes into cap faces facing out of the part on the given side.
function emitSectionCap(arrays,shapes,{p,n,U,V,side,material,tiny}){
  const out=builder(arrays),normal=n.map(x=>-side*x);let capFaces=0;
  for(const {outer,holes} of shapes){
    const ring=[outer,...holes].flat(),base=out.positions.length/3;
    const bx=[Infinity,-Infinity],by=[Infinity,-Infinity];for(const q of ring){bx[0]=Math.min(bx[0],q.x);bx[1]=Math.max(bx[1],q.x);by[0]=Math.min(by[0],q.y);by[1]=Math.max(by[1],q.y);}
    const extent=Math.max(bx[1]-bx[0],by[1]-by[0])||1;
    for(const q of ring)out.add([0,1,2].map(k=>p[k]+q.x*U[k]+q.y*V[k]),normal,[(q.x-bx[0])/extent,(q.y-by[0])/extent]);
    for(const [a,b,c] of ShapeUtils.triangulateShape(outer.map(q=>q.clone()),holes.map(hole=>hole.map(q=>q.clone())))){
      const turn=(ring[b].x-ring[a].x)*(ring[c].y-ring[a].y)-(ring[b].y-ring[a].y)*(ring[c].x-ring[a].x);
      if(Math.abs(turn)<=tiny)continue;
      if(turn*side<0)out.indices.push(base+a,base+b,base+c);else out.indices.push(base+a,base+c,base+b);
      out.faceMaterial.push(material);capFaces++;
    }
  }
  const result=out.finish(),existing=arrays.indices.length;
  const indices=new Uint32Array(existing+result.indices.length);indices.set(arrays.indices);indices.set(result.indices,existing);
  const faceMaterial=new Uint8Array(indices.length/3);faceMaterial.set(arrays.faceMaterial??new Uint8Array(existing/3));faceMaterial.set(result.faceMaterial,existing/3);
  return {arrays:{...result,indices,faceMaterial},capFaces};
}
