// kaminos-test: node
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {createSceneComponentEdit} from '../scene-component-edit.mjs';
import {createMechanismController} from '../experiments/link-workshop.experiment.mjs';
const scene=new T.Scene(),root=new T.Group(),payload=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial());scene.add(root,payload);root.userData.linkMechanism={schema:'kaminos.links.v1',period:3,nodes:[{parent:null,point:[0,0]}],pistons:[]};const entries=[{id:'root',object:root,type:'pbr'},{id:'payload',object:payload,type:'procedural-mesh'}];let selected='root';const edits=createSceneEdits({read(){throw Error('ordinary edit');},write(){}}),components=createSceneComponentEdit({selected:()=>selected,cancel:()=>edits.cancel(),refresh(){}});
const host={scene:{objects:()=>entries,select:id=>selected=id,open:async()=>({attach:async()=>({id:'root',root}),redraw(){},readView(){return {};},dispose:async()=>{}})},controls:{components,document:{defaultView:{kaminosSceneEdits:edits}}}};
const c=await createMechanismController({host,inputs:{root}});
try{
 c.operations.tool({value:'connect'});c.operations.connectEnd({objectId:'payload'});c.operations.connectEnd({joint:0});c.operations.previewConnection({kind:'hinge'});c.operations.commitConnection();
 for(const family of ['clevis','knuckle','flange']){c.operations.hingeHardware({family});assert.equal(c.read().recipe.attachments[0].hardware.family,family);}
 c.operations.editAxle();assert.equal(components.target().type,'hinge-axle');const target=components.target(),before=structuredClone(c.read().recipe),pose=target.read();edits.begin(target.id);edits.preview({position:[.5,0,0],rotation:[Math.PI/2,0,0],scale:[2,1,1]});edits.commit();const after=structuredClone(c.read().recipe);assert.equal(after.attachments[0].hardware.size,2);assert.ok(Math.abs(after.attachments[0].axle.rotation[0]-Math.PI/2)<1e-8);edits.undo();assert.deepEqual(c.read().recipe,before);edits.redo();assert.deepEqual(c.read().recipe,after);
 const base=target.read();edits.begin(target.id);edits.preview({position:[10,20,30]});edits.cancel();assert.deepEqual(c.read().recipe,after,'cancel restores exact axle recipe');
 c.operations.editSeat();c.operations.mode({value:'B'});const seat=components.target(),p=seat.read();edits.begin(seat.id);edits.preview({rotation:[p.rotation[0],p.rotation[1]-.3,p.rotation[2]]});edits.commit();assert.ok(Math.abs(c.read().recipe.attachments[0].hinge[1]-.3)<1e-6);const packet=c.operations.exportHinge();c.operations.importHinge({packet});assert.ok(c.read().recipe.attachments[0].hardware.parts);edits.undo();assert.equal(c.read().recipe.attachments[0].hardware.parts,undefined);
}finally{edits.clear();await c.dispose();payload.geometry.dispose();payload.material.dispose();}
console.log('Hinge family selection, native axle transform, scale, cancel, history, posing and appearance-return history pass');
