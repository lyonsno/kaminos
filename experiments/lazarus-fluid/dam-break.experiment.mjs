import finite from './finite-pbf.experiment.mjs';
// Owner follow-up: another discoverable setup, with the same host and operations.
export default {...finite,id:'lazarus/dam-break',title:'PBF · dam break',
 create:context=>finite.create({...context,inputs:{scene:'dam_break',...context.inputs}})};
