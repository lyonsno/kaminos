import liveLog from './live-log-heat.experiment.mjs';

export default {...liveLog,id:'moving-log',title:'Moving burning log',
  create:context=>liveLog.create({...context,inputs:{position:[0,0,0],...context.inputs,followObject:true}})};
