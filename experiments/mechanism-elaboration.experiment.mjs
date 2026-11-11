import workshop from './link-workshop.experiment.mjs';
import {elaborationFixture} from './link-workshop/elaboration.mjs';
import {elaborationGeometry} from './link-workshop/elaboration-geometry.mjs';
import {createElaborationTool} from './link-workshop/elaboration-tool.mjs';
export default {id:'mechanism-elaboration',title:'Interference into construction',async create(context){
 const recipe=context.inputs?.objectId?null:elaborationFixture();
 const runtime=await workshop.create(recipe?{...context,inputs:{recipe,bodies:elaborationGeometry(recipe,null,{fixture:true}),mode:'B',view:{position:[3.7,2.7,5.7],target:[-.3,1.4,.2]}}}:context);
 const tool=await createElaborationTool({...context,runtime});
 return {read:tool.read,operations:{...runtime.operations,...tool.operations},mount({root}){root.textContent='Inspect an encounter, choose a construction continuation, then move its ordinary scene guides with G. The opening panel retains its authored motion. Construction choices and guide objects save with the scene.';},dispose:tool.dispose};
}};
