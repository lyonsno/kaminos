import hand from './hand-live.experiment.mjs';
export default {...hand,id:'hand-browser-juice',title:'Browser MobRecon Finger Juice',
  create:context=>hand.create({...context,inputs:{acquisitionMode:'detector',...context.inputs,backend:'webgpu',fingerJuice:true}})};
