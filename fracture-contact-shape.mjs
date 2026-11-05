import {Vector3} from './lib/three.core.js';
import {ConvexHull} from './lib/addons/math/ConvexHull.js';

const sub=(a,b)=>a.map((x,k)=>x-b[k]);
const dot=(a,b)=>a.reduce((s,x,k)=>s+x*b[k],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>{const n=Math.hypot(...a);return n?a.map(x=>x/n):null;};

export function boxContactShape(halfExtents,reason=null){
 const vertices=Float32Array.from(Array.from({length:8},(_,i)=>halfExtents.map((h,k)=>h*((i>>k)&1?1:-1))).flat());
 return {kind:reason?'box-degenerate-source':'box',reason,vertices,faces:[[0,4,6,2],[1,3,7,5],[0,1,5,4],[2,6,7,3],[0,2,3,1],[4,5,7,6]]};
}

// One convex envelope of each already prepared material cell. Every referenced
// surface vertex participates; no sampling or vertex budget changes the shape.
// Positions are local to the existing body center, so mass/inertia and rendered
// exterior retain their established frame and identity.
export function materialContactShape(arrays,center,halfExtents){
 const points=[],seen=new Set();
 for(const id of arrays.indices){const p=Array.from(arrays.positions.subarray(id*3,id*3+3),(x,k)=>x-center[k]);
  if(!p.every(Number.isFinite))throw Error('Collision support needs finite material vertices');
  const key=p.join(',');if(!seen.has(key)){seen.add(key);points.push(new Vector3(...p));}
 }
 if(points.length<4)return boxContactShape(halfExtents,'fewer-than-four-source-vertices');
 // QuickHull requires a full-dimensional input. Test affine dimension before
 // calling it; incidental open/flat source fragments keep the prior thin box
 // explicitly, rather than disappearing or manufacturing a solid mesh.
 const a=points[0],b=points.reduce((p,q)=>a.distanceToSquared(q)>a.distanceToSquared(p)?q:p,a);
 const ab=b.clone().sub(a),c=points.reduce((p,q)=>ab.clone().cross(q.clone().sub(a)).lengthSq()>ab.clone().cross(p.clone().sub(a)).lengthSq()?q:p,a);
 const normal=ab.clone().cross(c.clone().sub(a));
 const distance=points.reduce((m,p)=>Math.max(m,Math.abs(normal.dot(p.clone().sub(a)))),0);
 const span=Math.max(...halfExtents)*2;
 if(distance<=64*Number.EPSILON*normal.length()*span)return boxContactShape(halfExtents,'affinely-flat-source');
 const hull=new ConvexHull().setFromPoints(points),vertices=[],faces=[],ids=new Map();
 for(const face of hull.faces){const indices=[];let edge=face.edge;
  do{const p=edge.head().point;if(!ids.has(p)){ids.set(p,vertices.length/3);vertices.push(p.x,p.y,p.z);}indices.push(ids.get(p));edge=edge.next;}while(edge!==face.edge);
  faces.push(indices);
 }
 if(!faces.length)throw Error('Full-dimensional material produced no collision hull');
 // Merge only numerically coplanar hull triangles. This retains complete
 // support polygons for face contact instead of choosing an arbitrary triangle.
 const scale=Math.max(...halfExtents),epsilon=128*Number.EPSILON;
 const vertex=i=>vertices.slice(i*3,i*3+3),groups=[];
 for(const face of faces){const p=face.map(vertex),n=norm(cross(sub(p[1],p[0]),sub(p[2],p[0]))),d=dot(n,p[0]);
  let g=groups.find(g=>dot(g.n,n)>=1-epsilon&&Math.abs(g.d-d)<=epsilon*scale&&p.every(v=>Math.abs(dot(g.n,v)-g.d)<=epsilon*scale));
  if(!g){g={n,d,faces:[]};groups.push(g);}g.faces.push(face);
 }
 const polygons=groups.map(g=>{
  const edges=new Map();for(const face of g.faces)for(let k=0;k<face.length;k++){const a=face[k],b=face[(k+1)%face.length],key=Math.min(a,b)+':'+Math.max(a,b);if(edges.has(key))edges.delete(key);else edges.set(key,[a,b]);}
  const next=new Map([...edges.values()]),first=next.keys().next().value,result=[];let at=first;
  do{result.push(at);at=next.get(at);if(at===undefined||result.length>next.size)throw Error('Collision hull face boundary is not a closed polygon');}while(at!==first);
  if(result.length!==next.size)throw Error('Collision hull face has disconnected boundaries');return result;
 });
 return {kind:'convex-source',reason:null,vertices:Float32Array.from(vertices),faces:polygons};
}

export function contactShapeFeatures(shape){
 const vertex=i=>Array.from(shape.vertices.subarray(i*3,i*3+3)),edges=[],normals=[],seen=new Set();
 for(const face of shape.faces){
  const n=norm(cross(sub(vertex(face[1]),vertex(face[0])),sub(vertex(face[2]),vertex(face[0]))));
  if(!n)throw Error('Degenerate collision face');normals.push(n);
  for(let k=0;k<face.length;k++){const a=face[k],b=face[(k+1)%face.length],key=Math.min(a,b)+':'+Math.max(a,b);if(!seen.has(key)){seen.add(key);edges.push([a,b]);}}
 }
 return {normals,edges};
}

// Offline geometry oracle: complete convex SAT, including edge cross axes.
// The runtime contact generator has its own GPU implementation and consumes
// current resident poses. This routine never synchronizes live body state.
export function contactShapeSeparation(a,positionA,b,positionB){
 const fa=contactShapeFeatures(a),fb=contactShapeFeatures(b),point=(s,i)=>Array.from(s.vertices.subarray(i*3,i*3+3));
 const axes=[...fa.normals,...fb.normals];
 for(const ea of fa.edges)for(const eb of fb.edges){const n=norm(cross(sub(point(a,ea[1]),point(a,ea[0])),sub(point(b,eb[1]),point(b,eb[0]))));if(n)axes.push(n);}
 const range=(s,p,n)=>{let lo=Infinity,hi=-Infinity;for(let i=0;i<s.vertices.length;i+=3){const x=dot(n,[s.vertices[i]+p[0],s.vertices[i+1]+p[1],s.vertices[i+2]+p[2]]);lo=Math.min(lo,x);hi=Math.max(hi,x);}return [lo,hi];};
 let separation=-Infinity,normal=null;
 for(const n of axes){const [amin,amax]=range(a,positionA,n),[bmin,bmax]=range(b,positionB,n);const forward=bmin-amax,reverse=amin-bmax,gap=Math.max(forward,reverse);if(gap>separation){separation=gap;normal=forward>=reverse?n:n.map(x=>-x);}}
 return {separation,normal};
}
