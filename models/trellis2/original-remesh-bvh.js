import {BufferGeometry,BufferAttribute} from '../../lib/three.core.js';
import {MeshBVH} from '../../lib/three-mesh-bvh.module.js';

export function validateRemeshSurface(vertices,triangles){
  if(!(vertices instanceof Float32Array)||!vertices.length||vertices.length%3||!vertices.every(Number.isFinite)||
    !(triangles instanceof Uint32Array)||!triangles.length||triangles.length%3||!triangles.every(v=>v<vertices.length/3))
    throw TypeError('complete finite F32 vertices and U32 triangles required for original remesh');
}

// The existing bundled BVH supplies CPU construction only. Original triangle
// identity is retained with indirect:true; closest-point queries execute WGSL.
export function buildRemeshBVH(vertices,triangles){
  validateRemeshSurface(vertices,triangles);
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new BufferAttribute(vertices,3));geometry.setIndex(new BufferAttribute(triangles,1));
  const bvh=new MeshBVH(geometry,{indirect:true,maxLeafTris:8}),rows=[],open=[];
  bvh.traverse((depth,leaf,bounds,offset,count)=>{
    const index=rows.length;
    while(open.length&&rows[open.at(-1)].depth>=depth)rows[open.pop()].escape=index;
    rows.push({depth,leaf,bounds:Array.from(bounds),offset,count,escape:0});open.push(index);
  });
  while(open.length)rows[open.pop()].escape=rows.length;
  const packed=new ArrayBuffer(rows.length*48),floats=new Float32Array(packed),ints=new Uint32Array(packed);
  rows.forEach((row,i)=>{
    floats.set(row.bounds.slice(0,3),i*12);floats.set(row.bounds.slice(3,6),i*12+4);
    ints.set([row.escape,row.leaf?row.offset:0,row.leaf?row.count:0,0],i*12+8);
  });
  const serialized=MeshBVH.serialize(bvh),order=Uint32Array.from(serialized.indirectBuffer);
  geometry.dispose();return {nodes:packed,order,vertices,triangles};
}
