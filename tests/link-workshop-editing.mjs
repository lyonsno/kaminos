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
 return {runtime,op,edits,target:()=>adapter.target(),adapter:()=>adapter};
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
{
 const {runtime,op}=await setup();
 assert.equal(typeof op.attach,'function','Mechanism exposes ordinary scene-object attachment');
 assert.equal(typeof op.seek,'function','Transport can hold an intermediate cycle position');
 op.seek({cycle:.25});assert.ok(Math.abs(runtime.read().fraction-.5)<1e-9);
 op.play();op.pause();assert.ok(Math.abs(runtime.read().fraction-.5)<1e-9,'Pause holds the displayed position');
 await runtime.dispose();
}

{
 const {runtime,op,edits,adapter}=await setup();
 op.append({parent:1,point:[3,1]});op.piston({a:0,b:2});
 op.mount({joint:2});const tip=runtime.read().selectedMount;op.mount({joint:0});const base=runtime.read().selectedMount;
 op.mountPiston({source:base,target:tip});
 const before=op.snapshot();op.select({joint:1});adapter().remove();
 assert.equal(op.snapshot().nodes.length,1);assert.equal(op.snapshot().pistons.length,0);assert.equal(op.snapshot().mountPistons.length,0);
 edits.undo();assert.deepEqual(op.snapshot(),before);edits.redo();assert.equal(op.snapshot().nodes.length,1);edits.undo();
 op.selectMount({id:tip});adapter().remove();assert.equal(op.snapshot().mounts.length,1);assert.equal(op.snapshot().mountPistons.length,0);
 edits.undo();assert.deepEqual(op.snapshot(),before);
 for(const kind of ['pistons','mountPistons']){
  op.selectPiston({kind,index:0});adapter().remove();assert.equal(op.snapshot()[kind].length,0);assert.equal(op.snapshot().nodes.length,3);
  edits.undo();assert.deepEqual(op.snapshot(),before);edits.redo();assert.equal(op.snapshot()[kind].length,0);edits.undo();
 }
 op.select({joint:0});adapter().remove();assert.equal(op.snapshot().nodes.length,0);
 edits.undo();assert.deepEqual(op.snapshot(),before);edits.redo();assert.equal(op.snapshot().nodes.length,0);
 assert.doesNotThrow(()=>adapter().remove(),'Delete on an empty construction is harmless');
 await runtime.dispose();
}
