// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const path=new URL('../experiments/hill-terrain/model.mjs',import.meta.url);
assert.ok(existsSync(path),'Hill needs its owned initial-state and transport model');
const {terrainConfig,makeRidges,initialState,transportStep}=await import(path);
test('seeded connected ridges regenerate and materially vary across seeds',()=>{
 const c=terrainConfig({resolution:33}),a=makeRidges(c);assert.deepEqual(a,makeRidges(c));assert.notDeepEqual(a,makeRidges({...c,seed:c.seed+1}));
 assert.ok(a.length>=5);for(let i=1;i<a.length;i++)assert.ok(a.slice(0,i).some(e=>[e.a,e.b].some(p=>p[0]===a[i].a[0]&&p[1]===a[i].a[1])),'every ridge branches from the connected structure');
 const state=initialState(c,a);assert.equal(state.length,c.resolution**2*4);assert.ok(state.every(Number.isFinite));
 let low=Infinity,high=-Infinity;for(let i=0;i<state.length;i+=4){assert.ok(state[i+1]>=0);assert.equal(state[i+3],0);const h=state[i]+state[i+1];low=Math.min(low,h);high=Math.max(high,h);}assert.ok(high-low>.8);
});
test('loose material transport conserves mass, stays nonnegative and responds to slope',()=>{
 const c=terrainConfig({resolution:9,width:8,length:8,repose:25,transport:2,uplift:0}),s=new Float32Array(9*9*4);s[(4*9+4)*4+1]=2;
 const out=transportStep(s,c,.05);let mass=0;for(let i=0;i<out.length;i+=4){mass+=out[i+1];assert.ok(out[i+1]>=0);assert.equal(out[i],0);assert.equal(out[i+3],0);}assert.ok(Math.abs(mass-2)<1e-6);assert.ok(out[(4*9+4)*4+1]<2);assert.ok(out[(4*9+3)*4+1]>0);
 const stable=new Float32Array(9*9*4);for(let i=1;i<stable.length;i+=4)stable[i]=.2;assert.deepEqual(transportStep(stable,c,.05),stable);
});
test('uplift is persistent substrate change while player memory stays empty',()=>{
 const c=terrainConfig({resolution:17,uplift:.08}),s=initialState(c),out=transportStep(s,c,.05);assert.ok(out.some((v,i)=>i%4===0&&v>s[i]));
 for(let i=3;i<out.length;i+=4)assert.equal(out[i],0);
});
test('reject invalid physical inputs rather than silently changing them',()=>{
 for(const p of [{resolution:0},{resolution:3.5},{seed:NaN},{width:-1},{repose:90},{transport:-1},{uplift:Infinity}])assert.throws(()=>terrainConfig(p));
 const c=terrainConfig();assert.throws(()=>transportStep(new Float32Array(4),c,.05));assert.throws(()=>transportStep(initialState(c),c,0));
});
