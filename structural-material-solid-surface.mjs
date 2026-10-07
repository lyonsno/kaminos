import { Matrix3,Vector3,Box3,Triangle } from 'three';

const faces=[[0,2,1],[0,1,3],[0,3,2],[1,2,3]];
function validPoints(points){return Array.isArray(points)&&points.length&&points.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite));}
function edgeMatrix(points){const [a,b,c,d]=points,v=[b.clone().sub(a),c.clone().sub(a),d.clone().sub(a)];return new Matrix3().set(v[0].x,v[1].x,v[2].x,v[0].y,v[1].y,v[2].y,v[0].z,v[1].z,v[2].z);}
function componentsValid(components,n){return Array.isArray(components)&&components.length===n&&components.every(c=>Number.isInteger(c)&&c>=0);}

export function bindSolidSurface({positions,tetrahedra},vertices,{envelope,components,component}={}){
 if(!validPoints(positions)||!validPoints(vertices)||!Array.isArray(tetrahedra)||!tetrahedra.length||!tetrahedra.every(ids=>Array.isArray(ids)&&ids.length===4&&new Set(ids).size===4&&ids.every(i=>Number.isInteger(i)&&i>=0&&i<positions.length)))throw new Error('Complete material and surface geometry required');
 if(!(Number.isFinite(envelope)&&envelope>=0))throw new Error('Explicit physical surface-binding envelope required');
 if(component!==undefined&&(!Number.isInteger(component)||component<0||!componentsValid(components,positions.length)))throw new Error('Explicit component membership required for fragment binding');
 const candidates=tetrahedra.flatMap((ids,index)=>{
  if(component!==undefined&&ids.some(i=>components[i]!==component))return[];
  const points=ids.map(i=>new Vector3(...positions[i])),matrix=edgeMatrix(points),magnitude=Math.max(...matrix.elements.map(Math.abs));
  if(!(magnitude>0)||Math.abs(matrix.determinant())/magnitude**3<1e-12)throw new Error('Degenerate material element cannot bind a surface');
  return[{index,ids,points,inverse:matrix.invert(),bounds:new Box3().setFromPoints(points)}];
 });
 if(!candidates.length)throw new Error('No connected material element can bind this fragment surface');
 const entries=vertices.map((vertex,index)=>{
  const point=new Vector3(...vertex);let best=null;
  for(const tet of candidates){
   if(best&&tet.bounds.distanceToPoint(point)>best.distance)continue;
   const coordinate=point.clone().sub(tet.points[0]).applyMatrix3(tet.inverse),weights=[1-coordinate.x-coordinate.y-coordinate.z,coordinate.x,coordinate.y,coordinate.z];let projected;
   if(weights.every(w=>w>=0)){projected=point.clone();}
   else{let distance=Infinity;for(const ids of faces){const p=new Triangle(...ids.map(i=>tet.points[i])).closestPointToPoint(point,new Vector3()),d=p.distanceTo(point);if(d<distance){distance=d;projected=p;}}}
   const distance=point.distanceTo(projected);if(best&&distance>=best.distance)continue;
   const q=projected.clone().sub(tet.points[0]).applyMatrix3(tet.inverse);
   best={index,tetrahedron:tet.index,ids:[...tet.ids],weights:[1-q.x-q.y-q.z,q.x,q.y,q.z],inverseRest:tet.inverse.toArray(),restOffset:point.clone().sub(projected).toArray(),distance};
   if(distance===0)break;
  }
  if(!best||best.distance>envelope)throw new Error(`Surface vertex ${index} is outside the admitted material envelope: ${best?.distance}`);
  return best;
 });
 return{route:'kaminos.deformable-surface.tetrahedral-displacement.v0',points:positions.length,entries,envelope,component,maxDistance:Math.max(...entries.map(e=>e.distance)),claim:'Visual displacement consumer with explicit exterior offset; not collision or fracture authority'};
}

export function applySolidSurfaceBinding(binding,positions,{components}={}){
 if(binding?.route!=='kaminos.deformable-surface.tetrahedral-displacement.v0'||!validPoints(positions)||positions.length!==binding.points)throw new Error('Matching current material points required');
 if(!componentsValid(components,positions.length))throw new Error('Current material component membership required');
 const transforms=new Map();
 return binding.entries.map(entry=>{
  if(new Set(entry.ids.map(i=>components[i])).size!==1)throw new Error('Surface binding crosses released connectivity; regenerate the fracture surface and bindings');
  if(binding.component!==undefined&&components[entry.ids[0]]!==binding.component)throw new Error('Surface fragment component changed; rebind before rendering');
  let transform=transforms.get(entry.tetrahedron);if(!transform){transform=edgeMatrix(entry.ids.map(i=>new Vector3(...positions[i]))).multiply(new Matrix3().fromArray(entry.inverseRest));transforms.set(entry.tetrahedron,transform);}
  const point=new Vector3(...entry.restOffset).applyMatrix3(transform);
  entry.ids.forEach((node,i)=>point.addScaledVector(new Vector3(...positions[node]),entry.weights[i]));
  return point.toArray();
 });
}

export function materialComponents(pointCount,bonds){
 if(!Number.isInteger(pointCount)||pointCount<=0||!Array.isArray(bonds)||bonds.length%4)throw new Error('Complete current material bond state required');
 const parents=Array.from({length:pointCount},(_,i)=>i),root=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
 for(let i=0;i<bonds.length;i+=4){const [a,b,alive]=bonds.slice(i,i+3);if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0||a>=pointCount||b>=pointCount||![0,1].includes(alive))throw new Error('Valid current material bond identity and liveness required');if(alive){const x=root(a),y=root(b);parents[Math.max(x,y)]=Math.min(x,y);}}
 return parents.map((_,i)=>root(i));
}
