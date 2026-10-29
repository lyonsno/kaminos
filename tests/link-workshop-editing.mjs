// kaminos-test: node
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import workshop from '../experiments/link-workshop.experiment.mjs';
import {createSceneEdits,transformPose} from '../scene-edit-session.mjs';
async function setup(){
 const scene=new T.Group(),edits=createSceneEdits({read(){throw Error('Missing target');},write(){throw Error('Missing target');}});let adapter;
 const session={async attach(root){scene.add(root);return {id:'workshop',root};},redraw(){},readView(){return {};},setView(){},onFrame(){return ()=>{};},async dispose(){scene.clear();}};
 const win={kaminosSceneEdits:edits,kaminosSelection:{set(){}}},host={scene:{async open(){return session;}},controls:{document:{defaultView:win},components:{register(id,a){adapter=a;return {changed(fn){edits.cancel();fn?.();},dispose(){}};}}}};
 const runtime=await workshop.create({host});const op=runtime.operations;op.append({parent:null,point:[0,0]});op.append({parent:0,point:[2,0]});
 return {runtime,op,edits,target:()=>adapter.target()};
}
{
 const {runtime,op,edits,target}=await setup(),h=target(),base=h.read();
 edits.apply(h.id,transformPose(base,{operation:'translate',axis:'y',amount:1}));const moved=runtime.read().recipe;
 edits.undo();edits.undo();edits.undo();assert.equal(runtime.read().recipe.nodes.length,0);
 edits.redo();edits.redo();assert.doesNotThrow(()=>edits.redo(),'Native history replays after empty construction');assert.deepEqual(runtime.read().recipe,moved);
 op.restore({schema:'kaminos.links.v1',nodes:[],pistons:[],period:3});edits.undo();assert.doesNotThrow(()=>edits.undo());assert.equal(runtime.read().recipe.nodes[1].length,2);
 await runtime.dispose();
}
{
 const {runtime,edits,target}=await setup(),h=target(),initial=h.read(),factor=initial.scale[0];
 const preview=value=>{const current=h.read();current.scale[0]=factor*value;edits.preview(current);};
 edits.begin(h.id);preview(2);preview(2.5);assert.equal(runtime.read().recipe.nodes[1].length,5,'Repeated numeric previews express final scale, not accumulated multipliers');edits.cancel();assert.equal(runtime.read().recipe.nodes[1].length,2);
 edits.begin(h.id);preview(2);preview(2.5);edits.commit();assert.equal(runtime.read().recipe.nodes[1].length,5);edits.undo();assert.equal(runtime.read().recipe.nodes[1].length,2);edits.redo();assert.equal(runtime.read().recipe.nodes[1].length,5);
 await runtime.dispose();
}
console.log('Native workshop history through empty state and numeric preview/commit/cancel/replay passed');
