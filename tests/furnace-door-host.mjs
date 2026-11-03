// kaminos-test: node
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import furnace from '../experiments/furnace-door.experiment.mjs';
import {createWorkbenchSceneHost} from '../workbench-scene-host.mjs';
import {openExperiment} from '../workbench-experiments.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
const scene=new T.Scene(),rows=new Map(),edits=createSceneEdits({read(){throw Error('Missing');},write(){throw Error('Missing');}});
let serial=0,other=0;edits.register('@other',{read:()=>other,check:v=>v,write:v=>{other=v;}});edits.apply('@other',1,'Other edit');edits.undo();
const before=edits.state(),camera=new T.PerspectiveCamera(),controls={target:new T.Vector3(),enableDamping:true,update(){}};
const sceneHost=createWorkbenchSceneHost({scene,camera,controls,loadAsset(){},registerObject(root,meta){const r={id:'obj'+(++serial),root,...meta};rows.set(r.id,r);return r;},findObject:root=>[...rows.values()].find(r=>r.root===root),removeObject:h=>{h.root.removeFromParent();rows.delete(h.id);},redraw(){},onFrame(){return ()=>{};}});
const host={scene:{...sceneHost,refreshPresentation(){}},controls:{document:{defaultView:{kaminosSceneEdits:edits,kaminosSelection:{set(){}}}},components:{register(){return {changed(fn){fn?.();},dispose(){}};}}}};
const records=[],rt=await openExperiment(furnace,{host,record:r=>records.push(r)});
assert.equal(edits.state().undoCount,before.undoCount);assert.equal(edits.state().redoCount,before.redoCount);assert.deepEqual(records,[]);
assert.equal((await rt.read()).bodies.replacements,8);assert.equal((await rt.read()).fraction,1);
await rt.invoke('frame');assert.deepEqual(camera.position.toArray(),[8,5.3,7]);assert.equal(controls.enableDamping,true);
await rt.invoke('period',{seconds:6});edits.undo();assert.equal((await rt.read()).bodies.replacements,8);assert.equal((await rt.read()).recipe.period,5);
await rt.dispose();assert.equal(rows.size,0);assert.equal(scene.children.length,0);
console.log('furnace initialization preserves history and uses scene-host framing');
