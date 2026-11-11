// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as T from '../lib/three.core.js';
import {createMechanismController} from '../experiments/link-workshop.experiment.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
const scene=new T.Group(),root=new T.Group(),entries=[{id:'mechanism',object:root}];scene.add(root);root.userData.linkMechanism=JSON.parse(await fs.readFile(new URL('./fixtures/link-workshop-operator-kiln.json',import.meta.url)));
const edits=createSceneEdits({read(){throw Error('Unused');},write(){throw Error('Unused');}});
const host={scene:{objects:()=>entries,async open(){return {async attach(o){scene.add(o);return {id:'mechanism',root:o};},redraw(){},readView(){return {};},onFrame(){return ()=>{};},async dispose(){}};}},controls:{document:{defaultView:{kaminosSceneEdits:edits,kaminosSelection:{set(){}}}},components:{register(){return {changed(fn){edits.cancel();fn?.();},dispose(){}};}}}};
const runtime=await createMechanismController({host,inputs:{root,mode:'B'}});const advance=n=>{for(let i=0;i<n;i++){runtime.advance(1/120);runtime.tick();}};
try{
 runtime.operations.dynamics({enabled:true,hydraulicsEnabled:true,settleAfterRelease:true});await runtime.operations.importBodies(runtime.operations.exportBodies());
 const interior=runtime.read().recipe;for(const n of interior.nodes)if(n.parent!==null)n.angles[1]=n.angles[0]+.65*(n.angles[1]-n.angles[0]);runtime.operations.restore(interior);const before=runtime.read(),count=edits.state().undoCount;
 assert.equal(typeof runtime.operations.balancePose,'function','The native mechanism needs an explicit capture of its counterbalanced pose');
 runtime.operations.balancePose();const balanced=runtime.read();assert.equal(balanced.bodies.replacements,16);assert.equal(edits.state().undoCount,count+1);assert.equal(balanced.recipe.nodes[2].counterbalance.referenceAngle,before.recipe.nodes[2].angles[1]);
 edits.undo();assert.deepEqual(runtime.read().recipe,before.recipe);edits.redo();assert.deepEqual(runtime.read().recipe,balanced.recipe);
 const law=balanced.recipe.nodes[2].counterbalance;runtime.operations.counterbalance({joint:2,stiffness:law.stiffness*.7});assert.equal(runtime.read().recipe.nodes[2].counterbalance.referenceAngle,law.referenceAngle);edits.undo();
 const reference=runtime.read().recipe;const r0=runtime.read(),origin=r0.points[0],angle0=reference.nodes[1].angles[1]+1e-5,L0=reference.nodes[1].length;runtime.operations.pull({joint:1,point:[origin[0]+L0*Math.cos(angle0),origin[1]+L0*Math.sin(angle0)],mode:'B'});advance(180);assert.ok(Math.abs(runtime.read().recipe.nodes[2].angles[1]-reference.nodes[2].angles[1])<1e-3,'An ordinary long hold must not drain the calibrated door to its stroke stops');runtime.operations.releasePull();advance(180);
 const repeat=[];for(let pass=0;pass<2;pass++){const r=runtime.read(),pivot=r.points[0],point=r.points[1],theta=Math.atan2(point[1]-pivot[1],point[0]-pivot[0]),L=r.recipe.nodes[1].length;for(let i=1;i<=24;i++){const a=theta+.08*i/24;runtime.operations.pull({joint:1,mode:'B',point:[pivot[0]+L*Math.cos(a),pivot[1]+L*Math.sin(a)]});advance(1);}const released=runtime.read().recipe;runtime.operations.releasePull();advance(240);const after=runtime.read();repeat.push(Math.abs(after.recipe.nodes[2].angles[1]-released.nodes[2].angles[1]));assert.equal(after.bodies.replacements,16);assert.deepEqual(after.recipe.nodes[2].counterbalance,reference.nodes[2].counterbalance,'Achieved poses must not silently recapture the spring reference');}
 assert.ok(repeat.every(x=>x>.001),'Follow-through must recur on a second placement without restoring the initial fixture');
 runtime.operations.clearCounterbalance();assert.ok(runtime.read().recipe.nodes.every(n=>!n.counterbalance));edits.undo();assert.deepEqual(runtime.read().recipe.nodes[2].counterbalance,reference.nodes[2].counterbalance);
}finally{edits.clear();await runtime.dispose();}
console.log('Native counterbalance capture, retained references, long hold, repeated follow-through, shells and history');
