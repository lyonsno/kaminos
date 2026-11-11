// kaminos-test: node
import assert from 'node:assert/strict';import * as T from '../lib/three.core.js';
import {createMechanismController} from '../experiments/link-workshop.experiment.mjs';import {createSceneEdits} from '../scene-edit-session.mjs';
import {elaborationGeometry} from '../experiments/link-workshop/elaboration-geometry.mjs';
import {elaborationFixture,scanInteractions,proposeElaboration,adoptElaboration} from '../experiments/link-workshop/elaboration.mjs';
const scene=new T.Group(),root=new T.Group(),entries=[{id:'mechanism',object:root}];scene.add(root);root.userData.linkMechanism=elaborationFixture();
const edits=createSceneEdits({read(){throw Error('Unused');},write(){throw Error('Unused');}}),host={scene:{objects:()=>entries,async open(){return {async attach(){return {id:'mechanism',root};},redraw(){},readView(){return {};},onFrame(){return ()=>{};},async dispose(){}};}},controls:{document:{defaultView:{kaminosSceneEdits:edits,kaminosSelection:{set(){}}}},components:{register(){return {changed(fn){edits.cancel();fn?.();},dispose(){}};}}}};
const runtime=await createMechanismController({host,inputs:{root,mode:'B'}});
try{assert.equal(typeof runtime.operations.adoptConstruction,'function','Construction refinement needs one atomic native recipe/geometry transaction');
 const before=runtime.read(),geometry=runtime.operations.exportBodies(),proposal=proposeElaboration(before.recipe,scanInteractions(before.recipe).encounters[0],{kind:'outboard'}),recipe=adoptElaboration(before.recipe,proposal),count=edits.state().undoCount;
 const replacement=elaborationGeometry(recipe,geometry);runtime.operations.adoptConstruction({recipe,geometry:replacement});assert.equal(edits.state().undoCount,count+1);assert.equal(runtime.read().recipe.elaboration.steps.length,1);assert.equal(runtime.read().bodies.replacements,replacement.bodies.length);edits.undo();assert.deepEqual(runtime.read().recipe,before.recipe);edits.redo();assert.deepEqual(runtime.read().recipe,recipe);
 const stable=runtime.read();assert.throws(()=>runtime.operations.adoptConstruction({recipe,geometry:{...geometry,bodies:[{...geometry.bodies[0],id:'missing'}]}}));assert.deepEqual(runtime.read(),stable,'Invalid geometry cannot partially replace construction');
}finally{edits.clear();await runtime.dispose();}
console.log('Atomic construction adoption, whole-step Undo/Redo and failure retention');
