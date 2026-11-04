// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {requestFormation} from '../experiments/hill-terrain/formation-cache.mjs';
import {formTerrain,encodeFormation,formationKey} from '../experiments/hill-terrain/formation.mjs';
import {createTerrainGPU} from '../experiments/hill-terrain/gpu.mjs';
import {BufferGeometry} from '../lib/three.core.js';
test('generated cache is reused; cancellation stops exactly the pending worker',async()=>{
 const defaultRecipe=JSON.parse(await fs.readFile(new URL('../experiments/hill-terrain/cache/default.recipe.json',import.meta.url),'utf8'));
 assert.equal(formationKey(defaultRecipe),formationKey({}),'default.recipe.json must match formationConfig({})');
 let launched=0,stopped=0,receivedInitial=null;const previous=globalThis.Worker,partials=[];
 globalThis.Worker=class{constructor(){launched++;}postMessage(msg){const c=msg?.config??msg;receivedInitial=msg?.initial??null;this.timer=setTimeout(()=>{const f=formTerrain(c);this.onmessage({data:{step:1,total:c.iterations,state:Float32Array.from(f.state)}});this.onmessage({data:{buffer:encodeFormation(f)}});},1);}terminate(){stopped++;clearTimeout(this.timer);}};
 try{const c={seed:721,resolution:9,iterations:2},seedRun=formTerrain({...c,iterations:1}),a=await requestFormation(c,{initial:seedRun,onProgress:p=>partials.push(p)}).promise,b=await requestFormation(c).promise;assert.equal(a.cache,'generated');assert.equal(b.cache,'memory');assert.equal(launched,1);assert.equal(stopped,1);assert.deepEqual(a.state,b.state);
  assert.equal(receivedInitial?.steps,1,'compatible initial formation state must be forwarded for incremental stepping');
  assert.equal(partials.length,1);assert.ok(partials[0].state instanceof Float32Array,'worker progress must carry partial terrain state');
  const cancelled=requestFormation({...c,seed:722});await new Promise(r=>setTimeout(r,0));cancelled.cancel();await assert.rejects(cancelled.promise,/cancelled/);assert.equal(stopped,2);
 }finally{globalThis.Worker=previous;}
});
test('GPU consumer refuses mismatched grids and reports the actual formed source',()=>{
 const geometry=new BufferGeometry(),gpu=createTerrainGPU(geometry,{resolution:9,uplift:0}),f=formTerrain({resolution:9,iterations:2,seed:73});
 assert.throws(()=>gpu.loadFormation({...f,config:{...f.config,resolution:17}}),/grid/);assert.throws(()=>gpu.loadFormation({...f,state:f.state.slice(4)}),/state/);
 gpu.loadFormation(f);assert.equal(gpu.read().provenance.kind,'formed-landscape');assert.equal(gpu.read().provenance.recipe.seed,73);assert.equal(gpu.read().steps,0);assert.equal(gpu.read().readbackInRuntime,false);assert.equal(gpu.read().initialized,false);
 assert.ok(gpu.zoomGeometry instanceof BufferGeometry,'GPU terrain must expose a camera-centered arbitrary-zoom 3D detail geometry');
 assert.equal(typeof gpu.setCameraFocus,'function','GPU terrain must expose camera focus tracking for arbitrary zoom');
 assert.equal(typeof gpu.stepGeology,'function','GPU terrain must expose all-GPU geological stepping');
 const zFar=gpu.setCameraFocus({target:[0,1.2,0],distance:14}).zoomDetail;
 const zNear=gpu.setCameraFocus({target:[.8,1.5,-.6],distance:.5}).zoomDetail;
 assert.ok(zFar.enabled&&zFar.triangles>=30000,'zoom detail patch must provide dense camera-centered triangles');
 assert.ok(zNear.focusRadius<zFar.focusRadius*.2&&zNear.vertexSpacing<.006,`zoom detail spacing must scale down continuously to millimeter scale on close-up zoom (far=${zFar.vertexSpacing}, near=${zNear.vertexSpacing})`);
 gpu.dispose();geometry.dispose();
});
