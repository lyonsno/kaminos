// Edge classes drawn over a polygon mesh, as line-segment endpoints in the
// mesh's own space. Rendering is the caller's; this only selects geometry.
import {EDGE_NONMANIFOLD,EDGE_BOUNDARY,EDGE_SHARP,EDGE_FLIPPED,EDGE_UV_SEAM} from './poly-mesh-core.mjs';

export const EDGE_CLASSES=Object.freeze([
  {name:'nonManifold',label:'Non-manifold',flag:EDGE_NONMANIFOLD,color:0xff2bd6},
  {name:'boundary',label:'Open',flag:EDGE_BOUNDARY,color:0xff3b30},
  {name:'sharp',label:'Crease',flag:EDGE_SHARP,color:0xffd60a},
  {name:'flipped',label:'Flipped winding',flag:EDGE_FLIPPED,color:0xff9500},
  {name:'uvSeam',label:'UV seam',flag:EDGE_UV_SEAM,color:0x32d2ff},
].map(Object.freeze));

export function edgeClassSegments(mesh,flags) {
  if(!flags||flags.length!==mesh.edgeCount)throw Error('Edge overlay needs flags classified for this mesh');
  const counts=EDGE_CLASSES.map(()=>0);
  for(let e=0;e<mesh.edgeCount;e++)EDGE_CLASSES.forEach((c,i)=>{if(flags[e]&c.flag)counts[i]++;});
  const out=Object.fromEntries(EDGE_CLASSES.map((c,i)=>[c.name,new Float32Array(counts[i]*6)])),fill=EDGE_CLASSES.map(()=>0),q=mesh.vertexPositions;
  for(let e=0;e<mesh.edgeCount;e++)EDGE_CLASSES.forEach((c,i)=>{
    if(!(flags[e]&c.flag))return;
    const target=out[c.name],a=3*mesh.edgeVertices[2*e],b=3*mesh.edgeVertices[2*e+1];
    target.set(q.subarray(a,a+3),fill[i]);target.set(q.subarray(b,b+3),fill[i]+3);fill[i]+=6;
  });
  return out;
}
