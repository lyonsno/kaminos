import crust from './mineral-crust.experiment.mjs';
export default {id:'mineral-faces',title:'Crystal face wetting',create:context=>crust.create({...context,inputs:{setup:'neighbors',rate:1,view:{position:[1.1,.95,1.25],target:[0,.12,0],fov:40},...context.inputs}})};
