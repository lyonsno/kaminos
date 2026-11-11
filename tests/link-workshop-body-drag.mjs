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
const runtime=await createMechanismController({host,inputs:{root,mode:'B'}});
try{
 assert.equal(runtime.read().selected,1,'A posed scene must initially select a moving body, not its final fixed anchor');
 runtime.operations.select({joint:4});runtime.operations.mode({value:'B'});assert.equal(runtime.read().selected,1,'The native saved-object service enters Pose B after creating its controller');
 assert.doesNotThrow(()=>runtime.operations.dynamics({hydraulicsEnabled:true}),'Implicit enabling freezes missing hardware before mutation');assert.equal(edits.state().active,null);
 assert.equal(typeof runtime.operations.dynamics,'function','Native mechanisms need the connected-body/optional-hydraulic mode');
 await runtime.operations.importBodies(runtime.operations.exportBodies());runtime.operations.mode({value:'B'});runtime.operations.dynamics({enabled:true,hydraulicsEnabled:true,gravity:[0,-9.81]});runtime.operations.select({joint:3});
 assert.equal(runtime.read().recipe.mechanics.model,'bodies');assert.equal(runtime.read().bodies.replacements,16);
 const untouched=runtime.read().recipe,undoCount=edits.state().undoCount;runtime.operations.body({joint:1,mass:1});assert.deepEqual(runtime.read().recipe,untouched,'Focusing a default mass value cannot author a new property before typing');assert.equal(edits.state().undoCount,undoCount);runtime.operations.hydraulics({index:0,conductance:2e-7,valve:'metered'});assert.deepEqual(runtime.read().recipe,untouched,'Default valve focus preserves absence of authored overrides');assert.equal(edits.state().undoCount,undoCount);
 const h=adapter.target(),before=h.read(),point=runtime.read().points[3],dims=runtime.read().bodies.travel.map(p=>[p.barrel,p.rod]);
 const goal=evaluate(before.recipe,.97)[3];edits.begin(h.id);edits.preview({...before,position:[...goal,0]});for(let i=0;i<100;i++)runtime.advance(1/120);runtime.tick();
 const pulled=runtime.read();assert.equal(pulled.mechanics.model,'connected planar rigid-body inertia with implicit two-chamber hydraulic response');assert.ok(pulled.mechanics.hand.residual<.01,'A reachable native carry should track within a centimeter while the rest accommodates');assert.notDeepEqual(pulled.recipe,before.recipe);assert.equal(pulled.bodies.replacements,16);assert.deepEqual(pulled.bodies.travel.map(p=>[p.barrel,p.rod]),dims);
 const capture=runtime.operations.exportDynamics();assert.equal(capture.steps.length,100);assert.deepEqual(capture.steps[0].grab.target,goal);assert.equal(capture.recipe.mechanics.hydraulicsEnabled,true);
 const reversing=runtime.read(),retained=runtime.operations.exportDynamics().steps.length;edits.preview({...before,position:[...point,0]});assert.equal(runtime.read().mechanics.time,reversing.mechanics.time,'Crossing the gesture start must not reset body time or accumulated motion');assert.deepEqual(runtime.read().recipe,reversing.recipe,'Crossing the start must not snap the panels back');runtime.advance(1/120);assert.equal(runtime.operations.exportDynamics().steps.length,retained+1,'The entire outward/return gesture must remain recorded');
 edits.preview(before,{transform:'rotate'});assert.equal(runtime.read().mechanics.hand,null,'Switching G to R at zero is still an explicit operation change');assert.ok(runtime.read().recipe.nodes.every((n,i)=>n.parent===null||Math.abs(n.angles[1]-before.recipe.nodes[i].angles[1])<1e-12),'Explicit zero rotation preserves the authored angles to transform precision');
 edits.preview({...before,rotation:[before.rotation[0],before.rotation[1],before.rotation[2]+.05]});assert.equal(runtime.read().mechanics.hand,null,'Switching the native gesture to R must leave dynamic G and apply the explicit hinge pose');assert.ok(Math.abs(runtime.read().recipe.nodes[3].angles[1]-before.recipe.nodes[3].angles[1]-.05)<1e-7);
 edits.cancel();assert.deepEqual(runtime.read().recipe,before.recipe);assert.equal(runtime.read().bodies.replacements,16);
 runtime.operations.body({joint:2,mass:5});assert.equal(runtime.read().recipe.nodes[2].bodyDynamics.mass,5);assert.equal(runtime.read().bodies.replacements,16);edits.undo();assert.deepEqual(runtime.read().recipe,before.recipe);
 runtime.operations.hydraulics({index:0,valve:'closed'});assert.equal(runtime.read().recipe.pistons[0].hydraulics.valve,'closed');assert.equal(runtime.read().bodies.replacements,16);edits.undo();assert.deepEqual(runtime.read().recipe,before.recipe);
 runtime.operations.dynamics({hydraulicsEnabled:false});assert.equal(runtime.read().recipe.mechanics.hydraulicsEnabled,false);edits.undo();assert.deepEqual(runtime.read().recipe,before.recipe);
 const beforeDelete=runtime.read().recipe;runtime.operations.remove({joint:1});assert.equal(runtime.read().recipe.nodes.some(n=>n.parent!==null),false);assert.equal(runtime.read().mechanics.hand,null);assert.equal(edits.state().active,null,'Deleting the last moving branch must close its transaction');edits.undo();assert.deepEqual(runtime.read().recipe,beforeDelete);
}finally{edits.clear();await runtime.dispose();}
console.log('Native connected-body carry, optional hydraulics, raw pull retention, body controls and geometry/history');
