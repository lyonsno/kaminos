import arrival from './generation-arrival.experiment.mjs';
import casting from './stage-casting.experiment.mjs';
export default {id:'workshop-arrival',title:'Workshop · arrive, pour & fire',create:context=>arrival.create(context,casting.create)};
