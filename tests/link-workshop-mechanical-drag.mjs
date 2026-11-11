// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as T from '../lib/three.core.js';
import {createMechanismController} from '../experiments/link-workshop.experiment.mjs';
import {createSceneEdits,transformPose} from '../scene-edit-session.mjs';

const scene=new T.Group(),root=new T.Group(),entries=[{id:'mechanism',object:root}];scene.add(root);
root.userData.linkMechanism=JSON.parse(await fs.readFile(new URL('./fixtures/link-workshop-operator-kiln.json',import.meta.url)));
const edits=createSceneEdits({read(){throw Error('Unused');},write(){throw Error('Unused');}});let adapter;
const host={scene:{objects:()=>entries,async open(){return {async attach(object){scene.add(object);return {id:'mechanism',root:object};},redraw(){},readView(){return {};},onFrame(){return ()=>{};},async dispose(){}};}},controls:{document:{defaultView:{kaminosSceneEdits:edits,kaminosSelection:{set(){}}}},components:{register(id,a){adapter=a;return {changed(fn){edits.cancel();fn?.();},dispose(){}};}}}};
const runtime=await createMechanismController({host,inputs:{root}});
try{
 assert.equal(typeof runtime.operations.mechanics,'function','Native mechanisms must expose the same force-aware drag operation as the headless path');
 await runtime.operations.importBodies(runtime.operations.exportBodies());const original=runtime.read().recipe;runtime.operations.mechanics({enabled:true});assert.ok(runtime.read().recipe.mechanics.enabled);assert.equal(runtime.read().bodies.replacements,16,'Enabling response on an already elaborated assembly retains its existing shells');edits.undo();assert.deepEqual(runtime.read().recipe,original);edits.redo();
 await runtime.operations.importBodies(runtime.operations.exportBodies());runtime.operations.mode({value:'B'});runtime.operations.select({joint:3});
 const h=adapter.target(),before=h.read(),dims=runtime.read().bodies.travel.map(p=>[p.barrel,p.rod]),keys=runtime.read().bodies.bodies.map(b=>b.geometryKey);
 edits.begin(h.id);edits.preview({...before,...transformPose(before,{operation:'translate',axis:'x',amount:.4})});
 assert.deepEqual(runtime.read().recipe,before.recipe,'The pointer sets a compliant goal, not an instantaneous IK teleport');
 for(let i=0;i<90;i++)runtime.advance(1/120);runtime.tick();
 const moved=runtime.read();assert.ok(moved.mechanics.hand.residual>.001,'The mechanical hand retains an honest target gap');assert.ok(Math.abs(moved.recipe.nodes[1].angles[1]-before.recipe.nodes[1].angles[1])>1e-5,'A distal grab affects the upstream coupled hinge');
 assert.deepEqual(moved.recipe.nodes.map(n=>n.length),before.recipe.nodes.map(n=>n.length));assert.deepEqual(moved.bodies.travel.map(p=>[p.barrel,p.rod]),dims);assert.deepEqual(moved.bodies.bodies.map(b=>b.geometryKey),keys);assert.equal(moved.bodies.replacements,16);
 edits.cancel();assert.deepEqual(runtime.read().recipe,before.recipe);assert.equal(runtime.read().mechanics.hand,null);assert.equal(runtime.read().bodies.replacements,16);
 edits.begin(h.id);edits.preview({...before,...transformPose(before,{operation:'translate',axis:'x',amount:.4})});for(let i=0;i<90;i++)runtime.advance(1/120);runtime.tick();edits.commit();const after=runtime.read().recipe;assert.notDeepEqual(after,before.recipe);edits.undo();assert.deepEqual(runtime.read().recipe,before.recipe);edits.redo();assert.deepEqual(runtime.read().recipe,after);
 const snapshot=runtime.operations.snapshot();assert.deepEqual(snapshot.mechanics,after.mechanics);assert.deepEqual(snapshot.pistons.map(p=>p.mechanics),after.pistons.map(p=>p.mechanics));
 runtime.operations.selectPiston({index:0});runtime.operations.actuator({index:0,mode:'free',stiffness:200,damping:15});assert.equal(runtime.read().recipe.pistons[0].mechanics.mode,'free');edits.undo();assert.equal(runtime.read().recipe.pistons[0].mechanics.mode,'hold');
 const apiBefore=runtime.read().recipe,point=runtime.read().points[3].map((x,i)=>x+(i===0?.2:0));runtime.operations.pull({joint:3,point,mode:'B'});assert.ok(runtime.read().mechanics.active);for(let i=0;i<30;i++)runtime.operations.stepMechanical({seconds:1/120});assert.ok(runtime.read().mechanics.hand.residual>0);runtime.operations.releasePull({cancel:true});assert.deepEqual(runtime.read().recipe,apiBefore);assert.equal(runtime.read().mechanics.hand,null);assert.throws(()=>runtime.operations.stepMechanical({seconds:1/120}),/pull first/);
}finally{edits.clear();await runtime.dispose();}
console.log('Native compliant G, fixed hardware/returned meshes, cancellation, Undo/Redo and persistent actuator settings');
