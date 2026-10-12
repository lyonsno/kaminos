import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
let api={};try{api=await import('../finger-fluid-velocity-composition.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const source=readFileSync(new URL('../finger-fluid-webgpu-core.js',import.meta.url),'utf8');
function stage(method){assert.equal(typeof api.composeFingerFluidVelocityReads,'function','Missing method-aware velocity composition');return api.composeFingerFluidVelocityReads(source.split('fn compute_velocity_viscosity(')[1].split('@compute')[0],method);}
function read(expression){const scalar=expression.replaceAll('.xyz','[axis]').replaceAll('max(','Math.max(');const run=new Function('particles','particle','position','neighborIndex','params','axis',`return ${scalar};`);const particles=[{position:[0,0,0],predicted:[.03,0,0],velocity:[Math.sqrt(5),0,0],delta:[Math.sqrt(5),0,0]}];return run(particles,particles[0],.03,0,{dt:.01},0);}
test('PBF and IPBF smooth their own immutable corrected field',()=>{
 for(const [method,expected] of [['pbf',3],['ipbf',Math.sqrt(5)]]){
  const s=stage(method),self=s.match(/var velocity = (.*);/)[1],neighbor=s.match(/neighborVelocity = neighborVelocity \+ (.*) \* weight;/)[1];
  assert.ok(Math.abs(read(self)-expected)<1e-12);assert.ok(Math.abs(read(neighbor)-expected)<1e-12);
 }
});
test('unknown method and missing production read anchors fail loud',()=>{stage('pbf');assert.throws(()=>api.composeFingerFluidVelocityReads('missing','ipbf'),/anchor/i);assert.throws(()=>stage('unknown'),/pressure/i);});
