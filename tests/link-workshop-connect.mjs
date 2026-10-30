// kaminos-test: node
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {createMechanismController} from '../experiments/link-workshop.experiment.mjs';
import {createSceneComponentEdit} from '../scene-component-edit.mjs';
const scene=new T.Scene(),root=new T.Group(),cube=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial());scene.add(root,cube);cube.position.set(5,3,0);
root.userData.linkMechanism={schema:'kaminos.links.v1',period:3,nodes:[{parent:null,point:[0,0]},{parent:0,length:2,angles:[0,1]}],pistons:[]};
const entries=[{id:'mechanism',object:root,type:'pbr',label:'Mechanism'},{id:'cube',object:cube,type:'procedural-mesh',label:'Cube'}];let selected='mechanism',adapter;
const edits=createSceneEdits({read(){throw Error('unexpected ordinary edit');},write(){}}),components=createSceneComponentEdit({selected:()=>selected,cancel(){},refresh(){}});
const host={scene:{objects:()=>entries,select(id){selected=id;},async open(){return {async attach(){return {id:'mechanism',root};},redraw(){},readView(){return {};},async dispose(){}};}},controls:{components:{register:(id,value)=>{adapter=value;return components.register(id,value);}},document:{defaultView:{kaminosSceneEdits:edits}}}};
const c=await createMechanismController({host,inputs:{root}}),original=JSON.stringify(c.read().recipe),position=cube.position.toArray();
try {
 c.operations.tool({value:'connect'});assert.equal(components.active(),true,'Connect must enter native component editing');
 c.operations.connectEnd({objectId:'cube',position:[-.5,0,0],rotation:[0,Math.PI/2,0]});
 c.operations.connectEnd({joint:1,position:[0,0,0],rotation:[0,Math.PI/2,0]});
 assert.equal(c.read().connectionDraft.ends.length,2);assert.equal(JSON.stringify(c.read().recipe),original,'picks must not create saved mounting points');
 c.operations.previewConnection({kind:'fasten'});assert.deepEqual(cube.position.toArray(),position,'preview does not move live object');
 c.operations.previewConnection({kind:'piston'});assert.deepEqual(cube.position.toArray(),position);assert.equal(c.read().connectionDraft.kind,'piston');
 c.operations.cancelConnection();assert.equal(JSON.stringify(c.read().recipe),original,'cancel leaves no orphan mounts');
 c.operations.tool({value:'connect'});c.operations.connectEnd({objectId:'cube',position:[-.5,0,0]});c.operations.connectEnd({joint:1});c.operations.previewConnection({kind:'fasten'});c.operations.commitConnection();
 assert.equal(c.read().recipe.attachments.length,1);assert.equal(c.read().recipe.mounts.length,2);edits.undo();assert.deepEqual(cube.position.toArray(),position);assert.equal(JSON.stringify(c.read().recipe),original,'one undo removes connection and new mounting points');edits.redo();assert.equal(c.read().recipe.attachments.length,1);edits.undo();
 c.operations.tool({value:'connect'});c.operations.connectEnd({joint:0});c.operations.connectEnd({joint:1});assert.throws(()=>c.operations.previewConnection({kind:'fasten'}),/object|link/i);c.operations.previewConnection({kind:'piston'});c.operations.commitConnection();assert.equal(c.read().recipe.mountPistons.length,1);edits.undo();assert.equal(JSON.stringify(c.read().recipe),original);
 c.operations.tool({value:'connect'});c.operations.connectEnd({objectId:'cube'});c.operations.connectEnd({joint:1});c.operations.previewConnection({kind:'fasten'});cube.position.x+=1;assert.throws(()=>c.operations.commitConnection(),/changed|preview/i);assert.equal(JSON.stringify(c.read().recipe),original);
 // A physical joint behind an opaque object must not steal the visible surface pick.
 c.operations.tool({value:'connect'});cube.position.set(2,0,2);scene.updateMatrixWorld(true);
 const camera=new T.OrthographicCamera(-5,5,5,-5,.1,100);camera.position.set(0,0,10);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
 const canvas={getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})};
 adapter.pick({clientX:70,clientY:50},{camera,canvas});
 assert.equal(c.read().connectionDraft.ends[0].owner.objectId,'cube','visible cube must win over the occluded joint');
 assert.ok(Math.abs(c.read().connectionDraft.ends[0].position[2]-.5)<1e-6,'pick lies on the visible front surface');
 c.operations.tool({value:'connect'});cube.position.x=3;scene.updateMatrixWorld(true);
 adapter.pick({clientX:70,clientY:50},{camera,canvas});
 assert.equal(c.read().connectionDraft.ends[0].owner.joint,1,'unobstructed joint remains directly pickable');
 // Undo follows the unfinished connection, never an earlier completed scene edit.
 c.operations.cancelConnection();c.operations.period({seconds:4});
 const accepted=JSON.stringify(c.read().recipe);
 c.operations.tool({value:'connect'});c.operations.connectEnd({objectId:'cube'});c.operations.connectEnd({joint:1});c.operations.previewConnection({kind:'piston'});
 edits.undo();assert.equal(c.read().connectionDraft?.ends.length,1,'Undo removes the latest connection pick');assert.equal(c.read().connectionDraft.kind,null);assert.equal(JSON.stringify(c.read().recipe),accepted);
 edits.undo();assert.equal(c.read().connectionDraft.ends.length,0);assert.equal(edits.undo(),false,'empty Connect does not undo an unrelated scene edit');assert.equal(JSON.stringify(c.read().recipe),accepted);
 edits.redo();assert.equal(c.read().connectionDraft.ends.length,1);edits.redo();assert.equal(c.read().connectionDraft.ends.length,2);
 c.operations.connectEnd({joint:0});edits.undo();assert.equal(c.read().connectionDraft.ends.length,2,'undo a replacement first pick restores the prior pair');
 c.operations.restartConnection();assert.equal(c.read().connectionDraft.ends.length,0);edits.undo();assert.equal(c.read().connectionDraft.ends.length,2);
 edits.undo();c.operations.connectEnd({joint:0});assert.equal(edits.redo(),false,'a new pick clears draft redo');
 c.operations.previewConnection({kind:'piston'});c.operations.commitConnection();edits.undo();assert.equal(JSON.stringify(c.read().recipe),accepted,'completed connection remains one scene operation');
 edits.undo();assert.equal(c.read().recipe.period,3,'scene history resumes outside the draft');
 console.log('Connect enters native editing; endpoints, alternatives, cancellation, atomic history and stale preview rejection passed');
}finally{edits.clear();await c.dispose();cube.geometry.dispose();cube.material.dispose();}
