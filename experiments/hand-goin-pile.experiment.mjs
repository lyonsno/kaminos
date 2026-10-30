import runway from './hand-jet-runway.experiment.mjs';
export const GOIN_INPUTS={goinPile:{count:24,mass:.25,couplingSteps:8,collisionSides:12}};
export default {...runway,id:'hand-goin-pile',title:'Finger Juice Goin Pile',
  create:context=>runway.create({...context,inputs:{...GOIN_INPUTS,...context.inputs}})};
