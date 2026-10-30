import hand from './hand-live.experiment.mjs';
export default {...hand,id:'hand-juice',title:'MobRecon Finger Juice',
  create:context=>hand.create({...context,inputs:{endpoint:'http://127.0.0.1:8792',acquisitionMode:'detector',...context.inputs,fingerJuice:true}})};
