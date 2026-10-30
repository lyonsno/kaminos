import crust from './mineral-crust.experiment.mjs';
export default {id:'mineral-faces',title:'Crystal face wetting',create:context=>crust.create({...context,inputs:{setup:'neighbors',arrangement:'arcs',tilt:.24,rate:1,view:{position:[2.6,2.5,3.1],target:[0,.12,0],fov:40},...context.inputs}})};
