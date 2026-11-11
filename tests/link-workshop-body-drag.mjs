// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as T from '../lib/three.core.js';
import {evaluate} from '../experiments/link-workshop/model.mjs';
import {createMechanismController} from '../experiments/link-workshop.experiment.mjs';
import {createSceneEdits,transformPose} from '../scene-edit-session.mjs';
const scene=new T.Group(),root=new T.Group(),entries=[{id:'mechanism',object:root}];scene.add(root);
root.userData.linkMechanism=JSON.parse(await fs.readFile(new URL('./fixtures/link-workshop-operator-kiln.json',import.meta.url)));
const edits=createSceneEdits({read(){throw Error('Unused');},write(){throw Error('Unused');}});let adapter;
const host={scene:{objects:()=>entries,async open(){return {async attach(object){scene.add(object);return {id:'mechanism',root:object};},redraw(){},readView(){return {};},onFrame(){return ()=>{};},async dispose(){}};}},controls:{document:{defaultView:{kaminosSceneEdits:edits,kaminosSelection:{set(){}}}},components:{register(id,a){adapter=a;return {changed(fn){edits.cancel();fn?.();},dispose(){}};}}}};
const runtime=await createMechanismController({host,inputs:{root}});
try{
 assert.equal(typeof runtime.operations.dynamics,'function','Native mechanisms need the connected-body/optional-hydraulic mode');
 await runtime.operations.importBodies(runtime.operations.exportBodies());runtime.operations.mode({value:'B'});runtime.operations.dynamics({enabled:true,hydraulicsEnabled:true,gravity:[0,-9.81]});runtime.operations.select({joint:3});
 assert.equal(runtime.read().recipe.mechanics.model,'bodies');assert.equal(runtime.read().bodies.replacements,16);
 const untouched=runtime.read().recipe,undoCount=edits.state().undoCount;runtime.operations.body({joint:1,mass:1});assert.deepEqual(runtime.read().recipe,untouched,'Focusing a default mass value cannot author a new property before typing');assert.equal(edits.state().undoCount,undoCount);runtime.operations.hydraulics({index:0,conductance:2e-7,valve:'metered'});assert.deepEqual(runtime.read().recipe,untouched,'Default valve focus preserves absence of authored overrides');assert.equal(edits.state().undoCount,undoCount);
 const h=adapter.target(),before=h.read(),point=runtime.read().points[3],dims=runtime.read().bodies.travel.map(p=>[p.barrel,p.rod]);
 const goal=evaluate(before.recipe,.97)[3];edits.begin(h.id);edits.preview({...before,position:[...goal,0]});for(let i=0;i<100;i++)runtime.advance(1/120);runtime.tick();
 const pulled=runtime.read();assert.equal(pulled.mechanics.model,'connected planar rigid-body inertia with implicit two-chamber hydraulic response');assert.ok(pulled.mechanics.hand.residual<.01,'A reachable native carry should track within a centimeter while the rest accommodates');assert.notDeepEqual(pulled.recipe,before.recipe);assert.equal(pulled.bodies.replacements,16);assert.deepEqual(pulled.bodies.travel.map(p=>[p.barrel,p.rod]),dims);
 const capture=runtime.operations.exportDynamics();assert.equal(capture.steps.length,100);assert.deepEqual(capture.steps[0].grab.target,goal);assert.equal(capture.recipe.mechanics.hydraulicsEnabled,true);
 edits.cancel();assert.deepEqual(runtime.read().recipe,before.recipe);assert.equal(runtime.read().bodies.replacements,16);
 runtime.operations.body({joint:2,mass:5});assert.equal(runtime.read().recipe.nodes[2].bodyDynamics.mass,5);assert.equal(runtime.read().bodies.replacements,16);edits.undo();assert.deepEqual(runtime.read().recipe,before.recipe);
 runtime.operations.hydraulics({index:0,valve:'closed'});assert.equal(runtime.read().recipe.pistons[0].hydraulics.valve,'closed');assert.equal(runtime.read().bodies.replacements,16);edits.undo();assert.deepEqual(runtime.read().recipe,before.recipe);
 runtime.operations.dynamics({hydraulicsEnabled:false});assert.equal(runtime.read().recipe.mechanics.hydraulicsEnabled,false);edits.undo();assert.deepEqual(runtime.read().recipe,before.recipe);
}finally{edits.clear();await runtime.dispose();}
console.log('Native connected-body carry, optional hydraulics, raw pull retention, body controls and geometry/history');
