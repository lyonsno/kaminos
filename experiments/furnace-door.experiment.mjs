import workshop from './link-workshop.experiment.mjs';
import {furnaceAssembly} from './link-workshop/furnace.mjs';

export default {id:'furnace-door',title:'Furnace door assembly',async create(context){
 const source=furnaceAssembly();
 const bench=await workshop.create({...context,inputs:{recipe:source.recipe}});
 try{
  await bench.operations.importBodies(source.geometry);
  await bench.operations.mode({value:'B'});
  const frame=()=>{context.host.controls.document.defaultView.kaminosSetCameraDebugPose({position:[8,5.3,7],target:[-.5,1.9,-1.2]});return bench.read();};
  frame();
  return {...bench,operations:{...bench.operations,frame}};
 }catch(error){await bench.dispose();throw error;}
}};
