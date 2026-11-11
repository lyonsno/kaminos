import workshop from './link-workshop.experiment.mjs';
import {transformerKiln} from './link-workshop/transformer.mjs';
export default {id:'transformer-kiln',title:'Transforming kiln sketch',async create(context){
 if(context.inputs?.objectId)return workshop.create(context);
 const source=transformerKiln();
 return workshop.create({...context,inputs:{recipe:source.recipe,bodies:source.geometry,mode:'B',view:{position:[9,6.2,8],target:[-1,2,-1.3]}}});
}};
