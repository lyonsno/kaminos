// kaminos-test: node
import assert from 'node:assert/strict';
import {makeStudyState,relaxPatch} from '../granular-overlap.mjs';
const api=await import('../granular-local.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND'&&e.url?.endsWith('/granular-local.mjs'))return {};throw e;});
assert.equal(typeof api.GrainSpatialIndex,'function','spatially local collision context is not implemented');
const {GrainSpatialIndex,relaxLocalPatch,localPackingMetrics}=api;
const {state}=makeStudyState({fineCount:12,fineSolidVolume:1e-9,coarseRadius:.001,width:.04,grids:[]});
for(let i=0;i<state.grains.length;i++){state.grains[i].position=[-.015+i*.002, .004,0];state.grains[i].velocity=[0,0,0];}
state.grains[2].position=[0,.005,0];state.grains[3].position=[.0003,.0045,0];state.lidHeight=.04;
const original=structuredClone(state),index=new GrainSpatialIndex(state,.002);
const exact=relaxPatch(state,{activeIds:[2,3],commitIds:[2],seconds:.01});
const local=relaxLocalPatch(state,index,{activeIds:[2,3],commitIds:[2],seconds:.01,padding:.0001});
assert.ok(local.bodyCount<state.grains.length,'far frozen grains must not be instantiated');
for(let k=0;k<3;k++)assert.ok(Math.abs(local.rows[0].position[k]-exact.state.grains[2].position[k])<1e-10,'local context must preserve the actual contact response');
assert.equal(local.rows.length,1);assert.equal(local.rows[0].id,2);assert.deepEqual(state,original,'a local prediction must not mutate canonical state');
index.update(2,[.018,.005,.015]);assert.ok(index.query([.017,.019,.004,.006,.014,.016]).includes(2));assert.ok(!index.query([-.001,.001,.004,.006,-.001,.001]).includes(2));
const falling=structuredClone(original);falling.grains[2].position=[0,.012,0];falling.grains[3].position=[.015,.004,0];
const retried=relaxLocalPatch(falling,new GrainSpatialIndex(falling,.002),{activeIds:[2],seconds:.02,padding:1e-6});
assert.ok(retried.attempts>1,'motion beyond the retained context must retry from the same input');
const full=relaxPatch(falling,{activeIds:[2],seconds:.02});for(let k=0;k<3;k++)assert.ok(Math.abs(retried.rows[0].position[k]-full.state.grains[2].position[k])<1e-10);
const m=localPackingMetrics(original,new GrainSpatialIndex(original,.002),[0,1]);assert.ok(Number.isFinite(m.maxPenetration));assert.equal(m.grains,original.grains.length);
assert.throws(()=>relaxLocalPatch(original,new GrainSpatialIndex(original,.002),{activeIds:[2],commitIds:[3],seconds:.01,padding:.001}),/commit/i);
console.log('local context: exact nearby collision, omitted far context, guarded retry, global identities');
