import runway from './hand-jet-runway.experiment.mjs';
export default {...runway,id:'hand-goin-pile',title:'Finger Juice Goin Pile',
  create:context=>runway.create({...context,inputs:{goinPile:{count:24,mass:.25},...context.inputs}})};
