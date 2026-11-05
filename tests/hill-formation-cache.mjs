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
 assert.ok(zFar.enabled&&zFar.triangles>=70000,'zoom detail patch must provide >=70k camera-centered triangles');
 assert.ok(zNear.focusRadius<zFar.focusRadius*.2&&zNear.vertexSpacing<.006,`zoom detail spacing must scale down continuously to millimeter scale on close-up zoom (far=${zFar.vertexSpacing}, near=${zNear.vertexSpacing})`);
 const zMidA=gpu.setCameraFocus({target:[0,1.2,0],position:[0,1.6,1.5]}).zoomDetail;
 const zMidB=gpu.setCameraFocus({target:[0,1.2,0],position:[0,1.6,1.54]}).zoomDetail;
 assert.ok(Math.abs(zMidB.focusRadius-zMidA.focusRadius)>1e-4&&Math.abs(zMidB.focusRadius-zMidA.focusRadius)<.06,'focusRadius must vary smoothly with camera motion without 2^(1/4) step quantization pops');
 assert.equal(typeof gpu.setMesoAuthoring,'function','GPU terrain must expose live meso/micro authoring controls');
 assert.equal(typeof gpu.setViewMode,'function','GPU terrain must expose surface provenance view modes');
 const afterMeso=gpu.setMesoAuthoring({meso:.92,ledge:1.35,crag:1.2,cobble:.65,rill:1.4});
 assert.equal(afterMeso.mesoAuthoring.meso,.92);
 assert.equal(afterMeso.mesoAuthoring.ledge,1.35);
 assert.equal(afterMeso.mesoAuthoring.crag,1.2);
 assert.equal(afterMeso.mesoAuthoring.cobble,.65);
 assert.equal(afterMeso.mesoAuthoring.rill,1.4);
 for(const mode of ['simulated','structural','provenance','authored']){
  assert.equal(gpu.setViewMode(mode).viewMode,mode);
 }
 assert.throws(()=>gpu.setViewMode('invalid-mode'),/view mode/i);
 assert.throws(()=>gpu.setMesoAuthoring({ledge:-1}),/meso/i);
 gpu.dispose();geometry.dispose();
});
test('canyon tilt-up camera view keeps zoom patch anchored on foreground terrain and exposes live meso/provenance operations',async()=>{
 const {default:definition}=await import('../experiments/hill-geology.experiment.mjs');
 const {MESO_AUTHORING_FIELDS,VIEW_MODES}=await import('../experiments/hill-terrain/formation.mjs');
 assert.ok(Array.isArray(MESO_AUTHORING_FIELDS)&&MESO_AUTHORING_FIELDS.length>=5,'formation must export live GPU meso/micro authoring metadata');
 assert.ok(Array.isArray(VIEW_MODES)&&VIEW_MODES.length===4,'formation must export 4 provenance view modes');
 const previousWorker=globalThis.Worker;
 globalThis.Worker=class{postMessage(msg){const c=msg?.config??msg;const f=formTerrain(c);setTimeout(()=>this.onmessage({data:{buffer:encodeFormation(f)}}),0);}terminate(){}};
 let view={position:[10.2,8.2,12.8],target:[0,1.15,0],fov:42};
 const session={attach:async root=>({id:root.uuid,root}),setView:v=>(view=v),readView:()=>view,redraw(){},onFrame:()=>()=>{},dispose:async()=>{}};
 const instance=await definition.create({host:{scene:{open:async()=>session}},inputs:{resolution:25,tilesX:4,tilesZ:4,iterations:8},record(){}});
 try{
  const down=instance.operations.setView({position:[0,1.45,1.65],target:[0,1.10,.35],fov:42}).gpu.zoomDetail;
  const tiltUp=instance.operations.setView({position:[0,1.45,1.65],target:[0,2.45,-1.6],fov:42}).gpu.zoomDetail;
  assert.ok(down.focusRadius<1.85&&tiltUp.focusRadius<1.85,`tilting camera up inside canyon must keep foreground detail patch anchored in high LOD (downR=${down.focusRadius}, tiltUpR=${tiltUp.focusRadius})`);
  assert.ok(Math.hypot(tiltUp.focusX-down.focusX,tiltUp.focusZ-down.focusZ)<.95,'tilting camera up must not fly focus point meters away up the back headwall');
  const mState=instance.operations.setMesoAuthoring({ledge:1.4,cobble:.5});
  assert.equal(mState.gpu.mesoAuthoring.ledge,1.4);
  assert.equal(mState.gpu.mesoAuthoring.cobble,.5);
  const vState=instance.operations.setViewMode('provenance');
  assert.equal(vState.gpu.viewMode,'provenance');
 }finally{
  await instance.dispose();
  globalThis.Worker=previousWorker;
 }
});
