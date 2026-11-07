// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as T from '../lib/three.core.js';
import {createMechanismController} from '../experiments/link-workshop.experiment.mjs';
import {createSceneEdits,transformPose} from '../scene-edit-session.mjs';

const scene=new T.Group(),entries=[];
const edits=createSceneEdits({read(){throw Error('Missing ordinary object');},write(){throw Error('Missing ordinary object');}});
let adapter;
const host={scene:{objects:()=>entries,async open(){return {async attach(root){scene.add(root);return {id:'mechanism',root};},redraw(){},readView(){return {};},onFrame(){return ()=>{};},async dispose(){}};}},controls:{document:{defaultView:{kaminosSceneEdits:edits,kaminosSelection:{set(){}}}},components:{register(id,a){adapter=a;return {changed(fn){edits.cancel();fn?.();},dispose(){}};}}}};
let root=new T.Group();root.userData.linkMechanism={schema:'kaminos.links.v1',nodes:[{parent:null,point:[0,0]},{parent:0,length:2,angles:[0,1]}],pistons:[],period:3};scene.add(root);entries.push({id:'mechanism',object:root});
let runtime=await createMechanismController({host,inputs:{root}});
const packet=runtime.operations.exportBodies();packet.bodies=packet.bodies.filter(b=>b.id==='link:1');packet.bodies[0].object.materials[0].color=0xab1234;await runtime.operations.importBodies(packet);
runtime.operations.mode({value:'B'});runtime.operations.select({joint:1});
let target=adapter.target(),base=target.read();
assert.ok(!('geometry' in base),'A hinge transform must not carry serialized mesh arrays through native edit state');
assert.equal(typeof base.geometryRef,'string','The geometry snapshot remains addressable for cancel and replay');
assert.throws(()=>edits.apply(target.id,{...base,geometryRef:'missing-snapshot'}),/snapshot is unavailable/);
assert.equal(edits.state().active,null,'An unavailable geometry reference rejects before starting a native edit');
const meshes=()=>{const out=[];root.traverse(o=>{if(o.isMesh&&o.material?.color?.getHex()===0xab1234)out.push(o);});return out;};
const body=meshes()[0];let disposed=0;body.geometry.addEventListener('dispose',()=>disposed++);
let parses=0;const parse=T.ObjectLoader.prototype.parse;T.ObjectLoader.prototype.parse=function(...args){parses++;return parse.apply(this,args);};
try{
 edits.begin(target.id);for(const amount of [.1,.2,.3])edits.preview({...base,...transformPose(base,{operation:'translate',axis:'x',amount})});
 assert.equal(parses,0,'Pose previews must retain returned geometry rather than decode it again');assert.equal(disposed,0);assert.equal(meshes()[0],body,'The actual rendered mesh survives translation previews');
 const altered=runtime.read().recipe;assert.notDeepEqual(altered.nodes[1].angles,base.recipe.nodes[1].angles);
 edits.cancel();assert.deepEqual(runtime.read().recipe,base.recipe);assert.equal(meshes()[0],body);
 edits.begin(target.id);edits.preview({...base,...transformPose(base,{operation:'translate',axis:'x',amount:.4})});edits.commit();const after=runtime.read().recipe;
 edits.undo();assert.deepEqual(runtime.read().recipe,base.recipe);edits.redo();assert.deepEqual(runtime.read().recipe,after);assert.equal(meshes()[0],body);
 assert.equal(parses,0,'Commit and pose-only undo/redo keep the retained body');
 // Undo must still resolve its geometry when the frame service has no controller.
 const savedRecipe=structuredClone(root.userData.linkMechanism),savedGeometry=structuredClone(root.userData.linkGeometry);
 entries.length=0;root.removeFromParent();await runtime.dispose();root=new T.Group();root.userData.linkMechanism=savedRecipe;root.userData.linkGeometry=savedGeometry;scene.add(root);entries.push({id:'mechanism',object:root});
 edits.undo();assert.deepEqual(root.userData.linkMechanism,base.recipe);assert.equal(root.userData.linkGeometry.bodies[0].object.materials[0].color,0xab1234);
 runtime=await createMechanismController({host,inputs:{root}});edits.redo();assert.deepEqual(runtime.read().recipe,after);assert.equal(meshes()[0].material.color.getHex(),0xab1234);
}finally{T.ObjectLoader.prototype.parse=parse;edits.clear();await runtime.dispose();}
console.log('Native joint previews retain geometry and compact history survives controller reconstruction');

// Replay the operator's saved three-panel/three-cylinder construction, rather
// than a piston-free link. Rotating must never resize its rigid panel bodies.
{
 const saved=JSON.parse(await fs.readFile(new URL('../scenes/Mechanism_2026-11-05_13-43-42_ef6123a706f440d7a5615d104a86084a.kaminos.json',import.meta.url)));
 root=new T.Group();root.userData.linkMechanism=saved.objects[0].mechanism;scene.add(root);entries.length=0;entries.push({id:'mechanism',object:root});
 runtime=await createMechanismController({host,inputs:{root}});
 const packet=runtime.operations.exportBodies();packet.bodies=packet.bodies.filter(b=>b.id.startsWith('link:'));await runtime.operations.importBodies(packet);
 const panels=new Map(packet.bodies.map(b=>[b.id,runtime.read().bodies.bodies.find(v=>v.id===b.id).geometryKey]));
 let parses=0;const parse=T.ObjectLoader.prototype.parse;T.ObjectLoader.prototype.parse=function(...args){parses++;return parse.apply(this,args);};
 try{
  for(const [joint,amount]of [[1,12],[1,8],[2,12],[3,-20]]){
   runtime.operations.select({joint});const h=adapter.target(),base=h.read(),lengths=base.recipe.nodes.map(n=>n.length);
   edits.begin(h.id);for(const fraction of [.25,.5,1])edits.preview({...base,...transformPose(base,{operation:'rotate',axis:'z',amount:amount*Math.PI/180*fraction})});edits.commit();
   assert.deepEqual(runtime.read().recipe.nodes.map(n=>n.length),lengths,'Native rotation preserves exact authored lengths');
   for(const [id,key]of panels){const actual=runtime.read().bodies.bodies.find(b=>b.id===id);assert.equal(actual.geometryKey,key);assert.equal(actual.replacement,true,'Rotation retains each returned door panel');}
  }
  assert.equal(parses,0,'Repeated rigid panel rotations do not decode returned meshes');
 }finally{T.ObjectLoader.prototype.parse=parse;edits.clear();await runtime.dispose();}
}
