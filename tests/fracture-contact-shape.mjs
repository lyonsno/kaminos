// kaminos-test: node
import assert from 'node:assert/strict';
import {prepareWholeFracture} from '../fracture-whole-prepare.mjs';

// Two solid tetrahedra share an oblique face x+y=0. Their AABBs overlap,
// but their material interiors do not. Exercise the actual geometry producer.
const face=[[-1,1,-1],[1,-1,-1],[0,0,1]],points=[...face,[-2,-2,0],...face,[2,2,0]],indices=[];
for(let body=0;body<2;body++){
 const start=body*4,center=[0,1,2].map(k=>points.slice(start,start+4).reduce((s,p)=>s+p[k],0)/4);
 for(const ids of [[0,1,2],[0,3,1],[1,3,2],[2,3,0]]){
  const p=ids.map(i=>points[start+i]),u=p[1].map((x,k)=>x-p[0][k]),v=p[2].map((x,k)=>x-p[0][k]);
  const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  const outward=normal.reduce((s,x,k)=>s+x*(p[0][k]-center[k]),0)>0;
  indices.push(...(outward?ids:[ids[0],ids[2],ids[1]]).map(i=>start+i));
 }
}
const source={positions:Float32Array.from(points.flat()),indices:Uint32Array.from(indices)},labels=Int32Array.from([0,0,0,0,1,1,1,1]);
const prepared=prepareWholeFracture(source,{labels,boundaries:[]},{cellExtent:10});
assert.equal(prepared.cells.length,2);
const normal=[Math.SQRT1_2,Math.SQRT1_2,0],projection=(cell,n)=>{
 const vertices=cell.collisionHull?.vertices??Array.from({length:8},(_,i)=>cell.halfExtents.map((h,k)=>h*((i>>k)&1?1:-1))).flat();
 let lo=Infinity,hi=-Infinity;
 for(let i=0;i<vertices.length;i+=3){const d=n.reduce((s,x,k)=>s+x*(cell.position[k]+vertices[i+k]),0);lo=Math.min(lo,d);hi=Math.max(hi,d);}
 return [lo,hi];
};
const a=projection(prepared.cells[0],normal),b=projection(prepared.cells[1],normal);
assert.ok(b[0]-a[1]>=-1e-6,`Actual cut surfaces must meet without collision-proxy overlap; signed gap=${b[0]-a[1]}`);
for(const cell of prepared.cells){
 assert.ok(cell.collisionHull.vertices.length>=12,'A solid collision hull retains its material support vertices');
 assert.ok(cell.collisionHull.faces.length>=4,'A solid collision hull retains its closed faces');
 for(const x of cell.collisionHull.vertices)assert.ok(Number.isFinite(x));
}
console.log('Oblique material cuts meet without overlapping collision shapes');
const {contactShapeSeparation,boxContactShape}=await import('../fracture-contact-shape.mjs');
const h=prepared.cells.map(c=>c.collisionHull);
assert.ok(Math.abs(contactShapeSeparation(h[0],prepared.cells[0].position,h[1],prepared.cells[1].position).separation)<1e-6);
const shifted=prepared.cells[1].position.map((x,k)=>x-normal[k]*.01);
assert.ok(contactShapeSeparation(h[0],prepared.cells[0].position,h[1],shifted).separation<-.009,'A real inward movement becomes penetration immediately');
const box=boxContactShape([1,1,1]);
assert.equal(contactShapeSeparation(box,[0,0,0],box,[3,0,0]).separation,1);
assert.equal(contactShapeSeparation(box,[0,0,0],box,[1,0,0]).separation,-1);
