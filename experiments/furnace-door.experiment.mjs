import workshop from './link-workshop.experiment.mjs';
import {furnaceAssembly} from './link-workshop/furnace.mjs';

export default {id:'furnace-door',title:'Furnace door assembly',async create(context){
 const source=furnaceAssembly();
 return workshop.create({...context,inputs:{recipe:source.recipe,bodies:source.geometry,mode:'B',view:{position:[8,5.3,7],target:[-.5,1.9,-1.2]}}});
}};
