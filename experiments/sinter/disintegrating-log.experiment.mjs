import movingLog from './moving-log.experiment.mjs';
export default {...movingLog,id:'disintegrating-log',title:'Burning wood and char debris',
 create:context=>movingLog.create({...context,inputs:{...context.inputs,disintegrate:true}})};
