import assert from 'node:assert/strict';
import * as api from '../structural-material-component-transport.mjs';
assert.equal(typeof api.createComponentSupportIndex,'function','Surface binding needs exact indexed support rather than all-point sorting');
let seed=19231;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
const rest=Array.from({length:200},()=>[rand()*3,rand()*2,rand()]);rest.push([0,0,0],[0,0,0],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0]);
const ids=rest.map((_,i)=>i).filter(i=>i%3!==1),index=api.createComponentSupportIndex(rest,ids);
for(const p of [[0,0,0],[10,20,30],...Array.from({length:100},()=>[rand()*4-1,rand()*3-1,rand()*2-1])]){
 const distances=ids.map(id=>({id,distance:Math.hypot(...rest[id].map((x,k)=>x-p[k]))})).sort((a,b)=>a.distance-b.distance||a.id-b.id);
 assert.deepEqual(index.nearest(p,4),distances.slice(0,4));
 for(const radius of [.1,.45,1,20,distances[3].distance])assert.deepEqual(index.within(p,radius),distances.filter(s=>s.distance<radius));
}
console.log('Indexed component support preserves exact nearest, uncapped radius membership and stable ties');
