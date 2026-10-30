// kaminos-test: node
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import {constructBodies} from '../experiments/link-workshop/bodies.mjs';
import {frames} from '../experiments/link-workshop/model.mjs';
const {motionSpace}=await import('../experiments/link-workshop/envelope.mjs').catch(()=>({}));
assert.equal(typeof motionSpace,'function','Assembly needs a reusable continuous motion-space guide');
const recipe={schema:'kaminos.links.v1',period:3,nodes:[{parent:null,point:[0,0]},{parent:0,length:1,angles:[0,Math.PI]},{parent:1,length:.7,angles:[.2,-.7]},{parent:null,point:[-1,-1]}],pistons:[{a:3,b:1}]};
const e=motionSpace(recipe,{cellSize:.16,tolerance:.06});
assert.equal(e.schema,'kaminos.motion-space.v1');
assert.equal(e.method,'continuous outer-box enclosure');
assert.deepEqual(e.recipe,recipe);assert.ok(e.cells.length);assert.ok(e.bodies.length);
const occupied=new Set(e.cells.map(c=>c.join(',')));
const construction=constructBodies(recipe);
// Off-grid phases and actual primitive vertices: a union of endpoint boxes alone fails.
for(const t of [0,.031,.173,.419,.527,.813,1]){
 const f=frames(recipe,t);
 for(const d of construction.defs){const p=d.pose(f);d.object.position.set(...p.position);d.object.rotation.z=p.angle;d.object.updateMatrixWorld(true);
 d.object.traverse(o=>{if(!o.isMesh)return;const a=o.geometry.attributes.position;for(let i=0;i<a.count;i++){const v=new T.Vector3().fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld);assert.ok(occupied.has(v.toArray().map(x=>Math.floor(x/e.cellSize)).join(',')),`${d.id} at ${t}: ${v.toArray()}`);}});}
}
assert.ok(e.cells.some(([x,y])=>y*.16>.9),'Intermediate arc must be enclosed');
assert.throws(()=>motionSpace(recipe,{cellSize:0}),/positive/);
assert.throws(()=>motionSpace(recipe,{tolerance:NaN}),/positive/);
const singular={...recipe,pistons:[{a:0,b:2}],nodes:[{parent:null,point:[0,0]},{parent:0,length:1,angles:[0,0]},{parent:1,length:1,angles:[Math.PI,Math.PI]}]};
assert.throws(()=>motionSpace(singular),/coincident|separation/);
console.log('Continuous motion-space vertex containment and invalid inputs pass');
