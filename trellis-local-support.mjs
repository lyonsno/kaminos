// Local support proposals preserve the original triangle address and barycentrics.
// This first constructor admits a single-valued surface over a square chart.
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>{const l=Math.hypot(...a);if(!(l>0))throw Error('zero chart direction');return a.map(x=>x/l);};
export function supportFrame({origin=[0,0,0],normal=[0,1,0],tangent=[1,0,0],radius=.04,depth=.06}={}) {
  if(![...origin,...normal,...tangent,radius,depth].every(Number.isFinite)||origin.length!==3||normal.length!==3||tangent.length!==3||radius<=0||depth<=0)throw Error('finite chart vectors and positive radius/depth required');
  const n=norm(normal),u=norm(sub(tangent,n.map(x=>x*dot(tangent,n)))),v=cross(n,u);
  return {origin:[...origin],u,v,n,radius,depth};
}
export const chartPoint=(p,f)=>{const d=sub(p,f.origin);return [dot(d,f.u)/f.radius,dot(d,f.v)/f.radius,dot(d,f.n)/f.radius];};
export const worldPoint=(p,f)=>f.origin.map((x,k)=>x+f.radius*(f.u[k]*p[0]+f.v[k]*p[1]+f.n[k]*p[2]));
export function supportSourceFromMesh(mesh){
  const g=mesh.geometry;
  if(Array.isArray(mesh.material)||!g?.index)throw Error('First support constructor requires an indexed mesh with one material');
  if(mesh.isSkinnedMesh||mesh.isInstancedMesh||Object.values(g.morphAttributes??{}).some(a=>a.length))throw Error('First support constructor requires static geometry without deformation or instances');
  const unsupported=Object.keys(g.attributes??{}).filter(k=>!['position','normal','uv'].includes(k));
  if(unsupported.length)throw Error(`Unsupported source attributes: ${unsupported.join(', ')}; partition would drop their data`);
  if(!g.attributes?.position)throw Error('Source position attribute required');
  for(const[name,width]of [['position',3],['normal',3],['uv',2]]){const a=g.attributes[name];if(a&&(a.itemSize!==width||a.normalized||!(a.array instanceof Float32Array)))throw Error(`Source ${name} requires packed unnormalized float32 attributes`);}
  if(g.attributes.position.isInterleavedBufferAttribute||g.attributes.normal?.isInterleavedBufferAttribute||g.attributes.uv?.isInterleavedBufferAttribute)throw Error('First support constructor requires packed vertex attributes');
  return {positions:Float32Array.from(g.attributes.position.array),indices:Uint32Array.from(g.index.array),normals:g.attributes.normal?Float32Array.from(g.attributes.normal.array):null,uvs:g.attributes.uv?Float32Array.from(g.attributes.uv.array):null};
}
export function sampleSourceAddress(source,triangle,bary){
  const I=source.indices??Uint32Array.from({length:source.positions.length/3},(_,i)=>i);
  if(!Number.isInteger(triangle)||triangle<0||triangle>=I.length/3||bary?.length!==3||!bary.every(Number.isFinite)||Math.abs(bary.reduce((s,x)=>s+x,0)-1)>2e-5)throw Error('valid original triangle and barycentric address required');
  const sample=(data,width)=>data?Array.from({length:width},(_,k)=>bary.reduce((sum,w,j)=>sum+w*data[I[triangle*3+j]*width+k],0)):null;
  const normal=sample(source.normals,3),length=normal?Math.hypot(...normal):0;
  return {sourceTriangle:triangle,sourceBary:[...bary],sourcePosition:sample(source.positions,3),sourceUV:sample(source.uvs,2),vertexNormal:length?normal.map(x=>x/length):null};
}
const mix=(a,b,t)=>({p:a.p.map((x,i)=>x+t*(b.p[i]-x)),b:a.b.map((x,i)=>x+t*(b.b[i]-x))});
function half(poly,axis,sign,inside=true,limit=1) {
  const out=[]; if(!poly.length)return out;
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],da=limit-sign*a.p[axis],db=limit-sign*b.p[axis],ka=inside?da>=0:da<=0,kb=inside?db>=0:db<=0;
    if(ka)out.push(a);if((da>0&&db<0)||(da<0&&db>0))out.push(mix(a,b,da/(da-db)));
  }
  return out;
}

// A closed support does not require a watertight teacher. All source triangles
// crossing the volume participate, including backwards faces and disconnected
// sheets. This is only a broad phase: both complementary clips run on the GPU.
export function prepareSupportVolume(source,recipe={}){
  const frame=supportFrame(recipe),top=recipe.top??.01;
  if(!Number.isFinite(top)||top<=-frame.depth)throw Error('top must be above the bottom of the support');
  const lo=[-1,-1,-frame.depth/frame.radius],hi=[1,1,top/frame.radius],I=source.indices??Uint32Array.from({length:source.positions.length/3},(_,i)=>i),P=source.positions;
  if(P.length%3||I.length%3||!Array.from(P).every(Number.isFinite)||Array.from(I).some(x=>!Number.isInteger(x)||x<0||x>=P.length/3))throw Error('finite indexed triangle source required');
  const candidates=[],untouched=[];
  for(let t=0;t<I.length/3;t++){
    const vertices=[0,1,2].map(k=>({p:chartPoint(Array.from(P.subarray(3*I[3*t+k],3*I[3*t+k]+3)),frame),b:[0,1,2].map(j=>+(j===k))}));
    if([0,1,2].some(k=>Math.min(...vertices.map(v=>v.p[k]))>hi[k]||Math.max(...vertices.map(v=>v.p[k]))<lo[k])){untouched.push(t);continue;}
    candidates.push({sourceTriangle:t,vertices});
  }
  if(!candidates.length)throw Error('support volume does not intersect the source bounding triangles');
  return {schema:'kaminos.local-support-volume.v1',frame,lo,hi,candidates,untouched:Uint32Array.from(untouched),sourceTriangleCount:I.length/3,
    diagnostics:{enclosure:'awaiting-webgpu-clip',neighborhoodIsolation:'all triangles of the selected primitive are partitioned; other scene objects remain external'}};
}
export function supportVolumeMesh(c){
  const positions=[],uvs=[],faces=[];const corners=[];
  for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++)corners.push([x?c.hi[0]:c.lo[0],y?c.hi[1]:c.lo[1],z?c.hi[2]:c.lo[2]]);
  const quads=[[0,2,3,1],[4,5,7,6],[0,1,5,4],[2,6,7,3],[0,4,6,2],[1,3,7,5]];
  quads.forEach((q,face)=>{for(const j of [0,1,2,0,2,3]){positions.push(...worldPoint(corners[q[j]],c.frame));uvs.push(...[[0,0],[1,0],[1,1],[0,1]][j]);faces.push(face);}});
  return {positions:Float32Array.from(positions),uvs:Float32Array.from(uvs),supportFace:Uint32Array.from(faces)};
}
const projectedArea=(a,b,c)=>((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
const triangleArea=(a,b,c)=>Math.hypot(...cross(sub(b,a),sub(c,a)))/2;
function emit(poly,id,target){for(let i=1;i+1<poly.length;i++){const vs=[poly[0],poly[i],poly[i+1]];if(triangleArea(...vs.map(v=>v.p))>1e-14)target.push({sourceTriangle:id,vertices:vs});}}
const key=p=>p.map(x=>Math.round(x*1e7)).join(',');

export function extractLocalSupport(source,recipe={}) {
  const f=supportFrame(recipe),P=source.positions,I=source.indices??Uint32Array.from({length:P.length/3},(_,i)=>i);
  if(P.length%3||I.length%3||!Array.from(P).every(Number.isFinite)||Array.from(I).some(x=>!Number.isInteger(x)||x<0||x>=P.length/3))throw Error('finite indexed triangle source required');
  const patch=[],retained=[],untouched=[],nearbyRejected=[];
  for(let t=0;t<I.length/3;t++){
    const points=[0,1,2].map(k=>chartPoint(Array.from(P.subarray(I[3*t+k]*3,I[3*t+k]*3+3)),f));
    if([0,1].some(k=>Math.min(...points.map(p=>p[k]))>1||Math.max(...points.map(p=>p[k]))< -1)||Math.max(...points.map(p=>p[2]))< -f.depth/f.radius){untouched.push(t);continue;}
    const a=projectedArea(...points);
    if(a<=1e-12||Math.min(...points.map(p=>p[2]))< -f.depth/f.radius){untouched.push(t);nearbyRejected.push(t);continue;}
    let poly=points.map((p,k)=>({p,b:[0,1,2].map(i=>+(i===k))}));
    const fragments=[];
    for(const [axis,sign] of [[0,1],[0,-1],[1,1],[1,-1]]){emit(half(poly,axis,sign,false),t,fragments);poly=half(poly,axis,sign);}
    if(poly.length<3){untouched.push(t);continue;}
    const before=patch.length;emit(poly,t,patch);
    if(patch.length===before){untouched.push(t);continue;}
    retained.push(...fragments);
  }
  if(!patch.length)throw Error('chart contains no front-facing source surface');
  const edges=new Map();
  for(const tri of patch)for(let k=0;k<3;k++){
    const a=tri.vertices[k].p,b=tri.vertices[(k+1)%3].p,ka=key(a),kb=key(b);if(ka===kb)continue;
    const e=ka<kb?`${ka}|${kb}`:`${kb}|${ka}`;const list=edges.get(e)??[];list.push([a,b]);edges.set(e,list);
  }
  if([...edges.values()].some(e=>e.length>2))throw Error(`nonmanifold local source: ${[...edges.values()].filter(e=>e.length>2).length} edges`);
  const boundary=[...edges.values()].filter(e=>e.length===1).map(e=>e[0]),next=new Map();
  for(const [a,b]of boundary){if(next.has(key(a)))throw Error('multiple boundary branches');next.set(key(a),b);}
  if(!boundary.length)throw Error('local source has no rim');
  const rim=[],start=boundary[0][0];let p=start;
  do{rim.push(p);p=next.get(key(p));if(!p||rim.length>boundary.length)throw Error('local source rim is open');}while(key(p)!==key(start));
  if(rim.length!==boundary.length)throw Error('local source has holes or disconnected sheets');
  if(rim.some(p=>Math.abs(Math.max(Math.abs(p[0]),Math.abs(p[1]))-1)>2e-6))throw Error('source does not cover the square chart');
  const area=patch.reduce((s,t)=>s+projectedArea(...t.vertices.map(v=>v.p)),0);
  if(Math.abs(area-4)>2e-5)throw Error('source chart has missing or overlapping coverage');
  // A degree-one square boundary plus consistently positive projected triangles
  // establishes the admitted graph chart. Original UV seams remain teacher-only.
  for(let i=0;i<rim.length;i++)if(projectedArea([0,0,0],rim[i],rim[(i+1)%rim.length])< -1e-10)throw Error('source rim projection reverses');
  return {schema:'kaminos.local-support.v1',frame:f,patch,retained,untouched:Uint32Array.from(untouched),rim,
    sourceTriangleCount:I.length/3,sourceTriangleIds:Uint32Array.from(new Set(patch.map(t=>t.sourceTriangle))),
    diagnostics:{projectedArea:area*f.radius*f.radius,nearbyRejected:nearbyRejected.length,neighborhoodIsolation:'unverified',enclosure:'awaiting-webgpu-fit'}};
}

export function materializeFragments(source,fragments,frame){
  const positions=[],normals=[],uvs=[],sourceTriangle=[],barycentrics=[],I=source.indices??Uint32Array.from({length:source.positions.length/3},(_,i)=>i);
  for(const t of fragments)for(const v of t.vertices){
    positions.push(...worldPoint(v.p,frame));barycentrics.push(...v.b);sourceTriangle.push(t.sourceTriangle);
    for(const [src,width,out]of [[source.normals,3,normals],[source.uvs,2,uvs]])if(src)for(let k=0;k<width;k++)out.push(v.b.reduce((s,w,j)=>s+w*src[I[t.sourceTriangle*3+j]*width+k],0));
  }
  return {positions:Float32Array.from(positions),normals:source.normals?Float32Array.from(normals):null,uvs:source.uvs?Float32Array.from(uvs):null,
    sourceTriangle:Uint32Array.from(sourceTriangle),barycentrics:Float32Array.from(barycentrics)};
}
export function supportMesh(candidate,height){
  if(!Number.isFinite(height))throw Error('finite fitted center height required');
  const positions=[],uvs=[];
  for(let i=0;i<candidate.rim.length;i++)for(const p of [[0,0,height],candidate.rim[i],candidate.rim[(i+1)%candidate.rim.length]]){
    if(projectedArea([0,0,0],candidate.rim[i],candidate.rim[(i+1)%candidate.rim.length])<=1e-12)continue;
    positions.push(...worldPoint(p,candidate.frame));uvs.push((p[0]+1)/2,(p[1]+1)/2);
  }
  return {positions:Float32Array.from(positions),uvs:Float32Array.from(uvs)};
}
