// kaminos-test: node
import assert from 'node:assert/strict';
import * as contract from '../structural-material-component-transport.mjs';

assert.equal(typeof contract.buildDetachedTranslationBody,'function','A detached-body adapter must aggregate acquired material rather than move a render prop');
const positions=[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],velocities=positions.map(()=>[2,3,4]),masses=[1,2,3,4],components=[1,1,1,1],pinned=[false,false,false,false];
const body=contract.buildDetachedTranslationBody({positions,velocities,masses,components,pinned,component:1,gripComponent:null});
assert.deepEqual(body.center,[.2,.3,.4]);assert.deepEqual(body.velocity,[2,3,4]);assert.equal(body.mass,10);
assert.deepEqual(body.offsets,positions.map(p=>p.map((v,k)=>v-body.center[k])));
assert.equal(body.motion,'translation-only');
assert.equal(contract.buildDetachedTranslationBody({positions,velocities,masses,components,pinned:[true,false,false,false],component:1,gripComponent:null}),null);
assert.equal(contract.buildDetachedTranslationBody({positions,velocities,masses,components,pinned,component:1,gripComponent:1}),null);
assert.throws(()=>contract.buildDetachedTranslationBody({positions,velocities:[],masses,components,pinned,component:1,gripComponent:null}),/complete/);
assert.throws(()=>contract.buildDetachedTranslationBody({positions,velocities,masses:[1,0,3,4],components,pinned,component:1,gripComponent:null}),/positive/);
const moved=body.offsets.map(p=>p.map((v,k)=>v+body.center[k]+[5,-2,1][k]));
for(let a=0;a<4;a++)for(let b=0;b<4;b++)assert(Math.abs(Math.hypot(...moved[a].map((v,k)=>v-moved[b][k]))-Math.hypot(...positions[a].map((v,k)=>v-positions[b][k])))<1e-12);
console.log('Detached translation retains acquired shape, mass and linear momentum; pins/grips refuse, angular motion remains separate');
