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
 assert.equal(c.read().tool,'select','editing starts with selection, not accidental construction');
 c.operations.tool({value:'draw'});components.exit();components.toggle('mechanism');assert.equal(c.read().tool,'select','Tab re-entry returns to selection');
 c.operations.tool({value:'connect'});assert.equal(components.active(),true,'Connect must enter native component editing');
 c.operations.connectEnd({objectId:'cube',position:[-.5,0,0],rotation:[0,Math.PI/2,0]});
 c.operations.connectEnd({joint:1,position:[0,0,0],rotation:[0,Math.PI/2,0]});
 assert.equal(c.read().connectionDraft.ends.length,2);assert.equal(JSON.stringify(c.read().recipe),original,'picks must not create saved mounting points');
 c.operations.previewConnection({kind:'fasten'});assert.deepEqual(cube.position.toArray(),position,'preview does not move live object');
 c.operations.previewConnection({kind:'piston'});assert.deepEqual(cube.position.toArray(),position);assert.equal(c.read().connectionDraft.kind,'piston');
 c.operations.cancelConnection();assert.equal(JSON.stringify(c.read().recipe),original,'cancel leaves no orphan mounts');
 c.operations.tool({value:'connect'});c.operations.connectEnd({objectId:'cube',position:[-.5,0,0]});c.operations.connectEnd({joint:1});c.operations.previewConnection({kind:'fasten'});c.operations.commitConnection();
 assert.equal(c.read().recipe.attachments.length,1);assert.equal(c.read().recipe.mounts.length,2);
 c.operations.selectConnection({objectId:'cube'});components.toggle('mechanism');
 assert.equal(c.read().editingConnection,'cube','Tab on a selected fastening enters seating editing');
 const seating=components.target();assert.equal(seating.type,'connection-seating');
 const seated=structuredClone(c.read().recipe),beforeSeat=seating.read(),count=edits.state().undoCount;
 edits.begin(seating.id,'Adjust seating');edits.preview({position:[beforeSeat.position[0]+.4,beforeSeat.position[1]+.2,beforeSeat.position[2]+8],rotation:[0,0,.35]});edits.commit();
 const adjusted=seating.read();assert.ok(Math.abs(adjusted.position[2]-beforeSeat.position[2])<1e-7,'normal displacement must not unseat the contact');
 assert.ok(Math.abs(adjusted.position[0]-beforeSeat.position[0]-.4)<1e-7);assert.equal(edits.state().undoCount,count+1);
 const edited=structuredClone(c.read().recipe);edits.undo();assert.deepEqual(c.read().recipe,seated);edits.redo();assert.deepEqual(c.read().recipe,edited);
 const beforeCancel=seating.read();edits.begin(seating.id);edits.preview({position:[100,20,30]});edits.cancel();assert.deepEqual(seating.read(),beforeCancel,'Escape restores the previous seating');
 components.toggle('mechanism');assert.equal(c.read().editingConnection,null);assert.equal(c.read().selectedConnection,'cube');assert.equal(components.active(),true,'leaving seating returns to the same selected connection');
 edits.undo();edits.undo();assert.deepEqual(cube.position.toArray(),position);assert.equal(JSON.stringify(c.read().recipe),original,'one undo removes connection and new mounting points');edits.redo();assert.equal(c.read().recipe.attachments.length,1);edits.undo();
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
 let notified;const stopHistory=edits.subscribe(state=>{notified=state;});
 c.operations.tool({value:'connect'});assert.deepEqual(notified,edits.state(),'entering empty Connect publishes effective history counts');stopHistory();
 c.operations.tool({value:'connect'});c.operations.connectEnd({objectId:'cube'});c.operations.connectEnd({joint:1});c.operations.previewConnection({kind:'piston'});
 edits.undo();assert.equal(c.read().connectionDraft?.ends.length,1,'Undo removes the latest connection pick');assert.equal(c.read().connectionDraft.kind,null);assert.equal(JSON.stringify(c.read().recipe),accepted);
 edits.undo();assert.equal(c.read().connectionDraft.ends.length,0);assert.equal(edits.undo(),false,'empty Connect does not undo an unrelated scene edit');assert.equal(JSON.stringify(c.read().recipe),accepted);
 edits.redo();assert.equal(c.read().connectionDraft.ends.length,1);edits.redo();assert.equal(c.read().connectionDraft.ends.length,2);
 c.operations.connectEnd({joint:0});edits.undo();assert.equal(c.read().connectionDraft.ends.length,2,'undo a replacement first pick restores the prior pair');
 c.operations.restartConnection();assert.equal(c.read().connectionDraft.ends.length,0);edits.undo();assert.equal(c.read().connectionDraft.ends.length,2);
 edits.undo();c.operations.connectEnd({joint:0});assert.equal(edits.redo(),false,'a new pick clears draft redo');
 c.operations.previewConnection({kind:'piston'});c.operations.commitConnection();edits.undo();assert.equal(JSON.stringify(c.read().recipe),accepted,'completed connection remains one scene operation');
 edits.undo();assert.equal(c.read().recipe.period,3,'scene history resumes outside the draft');
 c.operations.tool({value:'connect'});
 c.operations.connectEnd({objectId:'cube',position:[-.5,0,0],rotation:[0,Math.PI/2,0]});
 let planes=[];root.traverse(o=>{if(o.userData?.connectPlane!==undefined&&o.visible)planes.push(o);});
 assert.equal(planes.length,1,'first Connect pick displays its oriented contact-plane guide immediately');
 c.operations.connectEnd({joint:1,position:[0,0,0],rotation:[0,Math.PI/2,0]});
 planes=[];root.traverse(o=>{if(o.userData?.connectPlane!==undefined&&o.visible)planes.push(o);});
 assert.equal(planes.length,2,'second Connect pick displays the receiving contact-plane guide immediately');
 c.operations.cancelConnection();
 // HUD hides link pose modes and playback transport when no moving links exist.
 {
  class El{constructor(tag){this.tagName=tag;this.style={};this.children=[];this.hidden=false;this.attributes={};}setAttribute(k,v){this.attributes[k]=v;}append(...items){for(const x of items)if(typeof x==='object')this.children.push(x);}replaceChildren(...items){this.children=items.filter(x=>typeof x==='object');}}
  globalThis.Option??=class extends El{constructor(text,value){super('option');this.textContent=text;this.value=value;}};
  let mounted;const doc={activeElement:null,getElementById(){return null;},addEventListener(){},removeEventListener(){},createElement:tag=>new El(tag)};
  host.controls.installNumberDrag=()=>({dispose(){}});host.controls.mountObject=m=>{mounted=m;return {dispose(){}};};
  c.mount({root:new El('div'),document:doc,invoke:(op,args)=>Promise.resolve(c.operations[op](args))});
  const [top,transport]=mounted.playback.children;
  assert.equal(transport.hidden,false,'transport is visible when moving links exist');
  c.operations.restore({schema:'kaminos.links.v1',period:3,nodes:[],pistons:[]});
  assert.equal(transport.hidden,true,'playback transport hides when mechanism has no moving links');
  assert.equal(top.children[0].hidden,true,'Build / Pose A / Pose B modes hide when mechanism has no moving links');
  // Hinge together enables Pose A / Pose B and Play even when nodes is empty, and swings around the contact normal.
  const baseBlock=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial());scene.add(baseBlock);entries.push({id:'base',object:baseBlock,type:'procedural-mesh',label:'Base'});
  c.operations.tool({value:'connect'});
  c.operations.connectEnd({objectId:'cube',position:[-.5,0,0],rotation:[0,0,0]});
  c.operations.connectEnd({objectId:'base',position:[.5,0,0],rotation:[0,0,0]});
  c.operations.previewConnection({kind:'hinge'});assert.equal(c.read().connectionDraft.kind,'hinge');
  c.operations.commitConnection();
  assert.deepEqual(c.read().recipe.attachments[0].hinge,[0,0],'Hinge together creates a hinged attachment');
  assert.equal(transport.hidden,false,'Hinged attachment enables playback transport without planar links');
  assert.equal(top.children[0].hidden,false,'Hinged attachment enables Build / Pose A / Pose B without planar links');
  c.operations.mode({value:'B'});
  c.operations.selectConnection({objectId:'cube'});components.toggle('mechanism');
  assert.equal(c.read().editingConnection,'cube');
  const hSeat=components.target(),hBase=hSeat.read();
  edits.begin(hSeat.id,'Hinge Pose B');edits.preview({position:hBase.position,rotation:[0,0,Math.PI/2]});edits.commit();
  assert.ok(Math.abs(c.read().recipe.attachments[0].hinge[1]-Math.PI/2)<1e-6,'Pose B seating rotation records the hinge swing');
  c.operations.seek({cycle:.25});assert.ok(Math.abs(cube.rotation.z-Math.PI/4)<1e-6,'Mid-cycle seek interpolates the hinged mesh rotation');
  // Clicking another connection anchor while already inside Tab seating switches directly to that connection.
  const capBlock=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial());capBlock.position.set(0,3,0);scene.add(capBlock);entries.push({id:'cap',object:capBlock,type:'procedural-mesh',label:'Cap'});
  c.operations.tool({value:'connect'});c.operations.connectEnd({objectId:'cap',position:[0,-.5,0],rotation:[0,0,0]});c.operations.connectEnd({objectId:'base',position:[0,3,0],rotation:[0,0,0]});c.operations.previewConnection({kind:'fasten'});c.operations.commitConnection();
  c.operations.selectConnection({objectId:'cube'});components.toggle('mechanism');assert.equal(c.read().editingConnection,'cube');
  scene.updateMatrixWorld(true);
  components.pick({clientX:50,clientY:20},{camera,canvas});
  assert.equal(c.read().editingConnection,'cap','Picking another connection anchor inside Seating edit switches directly to it');
  capBlock.geometry.dispose();capBlock.material.dispose();
  baseBlock.geometry.dispose();baseBlock.material.dispose();
 }
 console.log('Connect enters native editing; endpoints, alternatives, hinged connections, cancellation, atomic history and stale preview rejection passed');
}finally{edits.clear();await c.dispose();cube.geometry.dispose();cube.material.dispose();}
