// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestFormation} from '../experiments/hill-terrain/formation-cache.mjs';
import {formTerrain,encodeFormation} from '../experiments/hill-terrain/formation.mjs';
import {createTerrainGPU} from '../experiments/hill-terrain/gpu.mjs';
import {BufferGeometry} from '../lib/three.core.js';
test('generated cache is reused; cancellation stops exactly the pending worker',async()=>{
 let launched=0,stopped=0;const previous=globalThis.Worker;
 globalThis.Worker=class{constructor(){launched++;}postMessage(c){this.timer=setTimeout(()=>this.onmessage({data:{buffer:encodeFormation(formTerrain(c))}}),1);}terminate(){stopped++;clearTimeout(this.timer);}};
 try{const c={seed:721,resolution:9,iterations:2},a=await requestFormation(c).promise,b=await requestFormation(c).promise;assert.equal(a.cache,'generated');assert.equal(b.cache,'memory');assert.equal(launched,1);assert.equal(stopped,1);assert.deepEqual(a.state,b.state);
  const cancelled=requestFormation({...c,seed:722});await new Promise(r=>setTimeout(r,0));cancelled.cancel();await assert.rejects(cancelled.promise,/cancelled/);assert.equal(stopped,2);
 }finally{globalThis.Worker=previous;}
});
test('GPU consumer refuses mismatched grids and reports the actual formed source',()=>{
 const geometry=new BufferGeometry(),gpu=createTerrainGPU(geometry,{resolution:9,uplift:0}),f=formTerrain({resolution:9,iterations:2,seed:73});
 assert.throws(()=>gpu.loadFormation({...f,config:{...f.config,resolution:17}}),/grid/);assert.throws(()=>gpu.loadFormation({...f,state:f.state.slice(4)}),/state/);
 gpu.loadFormation(f);assert.equal(gpu.read().provenance.kind,'formed-landscape');assert.equal(gpu.read().provenance.recipe.seed,73);assert.equal(gpu.read().steps,0);assert.equal(gpu.read().readbackInRuntime,false);assert.equal(gpu.read().initialized,false);gpu.dispose();geometry.dispose();
});
