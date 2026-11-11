import kiln from './hinge-installation.experiment.mjs';
export default {id:'construction-hinges',title:'Anchor and free a folding kiln door',create:context=>kiln.create({...context,inputs:{...context.inputs,panels:context.inputs?.panels??5,construction:true}})};
