// kaminos-test: node
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import {createSceneEdits,transformPose} from '../scene-edit-session.mjs';
import {createSceneComponentEdit} from '../scene-component-edit.mjs';
import {createMechanismController} from '../experiments/link-workshop.experiment.mjs';
const scene=new T.Scene(),root=new T.Group(),payload=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial());scene.add(root,payload);
root.userData.linkMechanism={schema:'kaminos.links.v1',period:3,nodes:[{parent:null,point:[0,0]},{parent:0,length:2,angles:[0,.2]}],pistons:[]};
const entries=[{id:'root',object:root,type:'pbr'},{id:'payload',object:payload,type:'procedural-mesh'}];let selected='root';
const edits=createSceneEdits({read(){throw Error('ordinary edit');},write(){}}),components=createSceneComponentEdit({selected:()=>selected,cancel:()=>edits.cancel(),refresh(){}});
const host={scene:{objects:()=>entries,select:id=>selected=id,open:async()=>({attach:async()=>({id:'root',root}),redraw(){},readView(){return {};},dispose:async()=>{}})},controls:{components,document:{defaultView:{kaminosSceneEdits:edits}}}};
const c=await createMechanismController({host,inputs:{root}});
try{
 c.operations.tool({value:'connect'});c.operations.connectEnd({objectId:'payload'});c.operations.connectEnd({joint:1});c.operations.previewConnection({kind:'hinge'});c.operations.commitConnection();c.operations.importHinge({packet:c.operations.exportHinge()});
 const parts=structuredClone(c.read().recipe.attachments[0].hardware.parts),sameParts=()=>assert.deepEqual(c.read().recipe.attachments[0].hardware.parts,parts,'Native transforms retain the complete authored part geometry');
 const observed=c.read();observed.recipe.attachments[0].hardware.parts.fixed.object.name='external mutation';assert.notEqual(c.read().recipe.attachments[0].hardware.parts.fixed.object.name,'external mutation','Public reads remain detached');
 c.operations.editAxle();const first=components.target().read();assert.equal(first.recipe.attachments[0].hardware.parts,undefined,'Native snapshots contain no serialized part arrays');assert.equal(typeof first.hingePartsRefs[0].ref,'string');
 assert.throws(()=>edits.apply(components.target().id,{...first,hingePartsRefs:[{objectId:'payload',ref:'missing'}]}),/snapshot is unavailable/);assert.equal(edits.state().active,null);
 let parses=0;const parse=T.ObjectLoader.prototype.parse;T.ObjectLoader.prototype.parse=function(...args){parses++;return parse.apply(this,args);};
 try{
  for(const context of ['axle','seating','joint']){
   if(context==='seating'){c.operations.editSeat();c.operations.mode({value:'B'});}else if(context==='joint'){c.operations.leaveConnection();c.operations.mode({value:'B'});c.operations.select({joint:1});}
   const target=components.target(),base=target.read(),before=c.read().recipe;
   assert.equal(base.recipe.attachments[0].hardware.parts,undefined,context+' snapshot stays compact');
   edits.begin(target.id);for(const amount of [.1,.2,.3]){edits.preview({...base,...transformPose(base,{operation:'rotate',axis:'z',amount})});sameParts();}
   edits.cancel();assert.deepEqual(c.read().recipe,before,context+' cancel restores exact authored state');
   edits.begin(target.id);edits.preview({...base,...transformPose(base,{operation:'rotate',axis:'z',amount:.2})});edits.commit();const after=c.read().recipe;assert.notDeepEqual(after,before);sameParts();edits.undo();assert.deepEqual(c.read().recipe,before);edits.redo();assert.deepEqual(c.read().recipe,after);sameParts();
  }
  assert.equal(parses,0,'Unchanged hinge parts never decode during native drag, commit, cancel or history replay');
 }finally{T.ObjectLoader.prototype.parse=parse;}
 const saved=structuredClone(root.userData.linkMechanism);await c.dispose();edits.undo();sameParts();assert.ok(root.userData.linkMechanism.attachments[0].hardware.parts,'Controller-free replay restores the hinge appearance');
 assert.notDeepEqual(root.userData.linkMechanism,saved);
}finally{edits.clear();await c.dispose();payload.geometry.dispose();payload.material.dispose();}
console.log('Returned hinge geometry stays outside native snapshots and survives axle, seating, joint and controller-free history');
