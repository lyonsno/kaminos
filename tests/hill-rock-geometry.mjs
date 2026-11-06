// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
const rock=await import('../experiments/hill-terrain/rock-geometry.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e;});
test('explicit rock construction is available',()=>assert.equal(typeof rock.buildConvexRock,'function','Missing plane-defined rock geometry construction'));
if(rock.buildConvexRock){
 const box=(x0,x1,y0,y1,z0,z1)=>[[1,0,0,x1],[-1,0,0,-x0],[0,1,0,y1],[0,-1,0,-y0],[0,0,1,z1],[0,0,-1,-z0]];
 test('plane intersections produce a closed outward-facing solid with exact bounds',()=>{
  const s=rock.buildConvexRock(box(-1,1,0,2,-.5,.5));
  assert.equal(s.faces.length,6);assert.equal(s.positions.length/9,12);
  const edges=new Map();let volume=0;
  const v=i=>s.positions.slice(i,i+3),sub=(a,b)=>a.map((x,i)=>x-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a.reduce((t,x,i)=>t+x*b[i],0);
  for(let i=0;i<s.positions.length;i+=9){
   const a=v(i),b=v(i+3),c=v(i+6),n=s.normals.slice(i,i+3);
   assert.ok(dot(cross(sub(b,a),sub(c,a)),n)>0,'Face winding must agree with outward normal');volume+=dot(a,cross(b,c))/6;
   for(const [p,q]of [[a,b],[b,c],[c,a]]){const key=[p.join(','),q.join(',')].sort().join('|');edges.set(key,(edges.get(key)||0)+1);}
   for(const p of [a,b,c])for(const [x,y,z,d]of s.planes)assert.ok(x*p[0]+y*p[1]+z*p[2]<=d+1e-7);
  }
  assert.ok(Math.abs(volume-4)<1e-7);assert.ok([...edges.values()].every(n=>n===2),'Every mesh edge must have two incident triangles');
 });
 test('ray queries distinguish underside, front face and upper surface of an overhang',()=>{
  const solids=[rock.buildConvexRock(box(-.4,.4,0,.6,-.3,.3)),rock.buildConvexRock(box(-.7,.7,.6,.9,-.3,.6))];
  const up=rock.raycastRock(solids,[0,.3,.5],[0,1,0]);assert.ok(Math.abs(up.distance-.3)<1e-7);assert.deepEqual(up.normal,[0,-1,0]);
  const down=rock.raycastRock(solids,[0,1.2,.5],[0,-1,0]);assert.ok(Math.abs(down.distance-.3)<1e-7);assert.deepEqual(down.normal,[0,1,0]);
  assert.equal(rock.raycastRock(solids,[2,1,.5],[0,-1,0]),null);
  const front=rock.raycastRock(solids,[0,.75,1],[0,0,-1]);assert.ok(Math.abs(front.distance-.4)<1e-7);assert.deepEqual(front.normal,[0,0,1]);
 });
 test('bounded world geometry and packed query source are deterministic and retain each solid',()=>{
  const a=rock.createRockOutcrop({origin:[.4,.5,1.7]}),b=rock.createRockOutcrop({origin:[.4,.5,1.7]});
  assert.deepEqual(a,b);assert.equal(a.solids.length,9);
  const packed=rock.packRockPlanes(a.solids);assert.equal(packed.blocks.length,a.solids.length*4);
  assert.equal(packed.planes.length,a.solids.reduce((n,s)=>n+s.planes.length*4,0));
  for(let k=0;k<a.solids.length;k++)assert.equal(packed.blocks[k*4+1],a.solids[k].planes.length);
  assert.ok(a.solids.some(s=>s.faces.some(f=>Math.abs(f.normal[1])<.12)),'Near-vertical faces must be real mesh faces');
 });
 test('rays starting inside joined rock exit the union, not an internal block face',()=>{
  const solids=[rock.buildConvexRock(box(-1,1,0,1,-1,1)),rock.buildConvexRock(box(-1,1,.8,2,-1,1))];
  const hit=rock.raycastRock(solids,[0,.5,0],[0,1,0]);assert.ok(Math.abs(hit.distance-1.5)<1e-7,'Internal overlap must not be reported as the rock surface');
 });
 test('invalid and empty solids fail visibly',()=>{
  assert.throws(()=>rock.buildConvexRock([[0,0,0,1]]),/plane/i);
  assert.throws(()=>rock.buildConvexRock(box(1,-1,0,1,0,1)),/bounded|empty/i);
  assert.throws(()=>rock.buildConvexRock([[1,0,0,NaN]]),/plane/i);
  assert.throws(()=>rock.createRockOutcrop({origin:[0,NaN,0]}),/origin/i);
 });
}
