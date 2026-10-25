// kaminos-test: node
import assert from 'node:assert/strict';
import {createGpuFleshVolume} from '../experiments/creature-flesh/gpu-volume.mjs';
const source={positions:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],tetrahedra:[[0,1,2,3]],pinned:[true,false,true,true]},v=createGpuFleshVolume(source);
assert.equal(typeof v.setCapsules,'function','ordinary flesh must receive all neighbouring body contacts');
const contacts=Array.from({length:25},(_,i)=>({a:[i,0,0],b:[i,1,0],radius:.3}));v.setCapsules(contacts);assert.equal(v.read().capsules.length,25);contacts[0].a[0]=999;assert.equal(v.read().capsules[0].a[0],0);
assert.throws(()=>v.setCapsules([{a:[0,0,0],b:[0,1,NaN],radius:.3}]),/capsule/);assert.equal(v.read().capsules.length,25,'bad contacts preserve the prior complete set');v.setCapsules([]);assert.deepEqual(v.read().capsules,[]);v.dispose();
