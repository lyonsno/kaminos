import hand from './hand-jet-runway.experiment.mjs';

export default {...hand,id:'hand-hill-juice',title:'Finger Juice on the Hill',
  async create(context){
    const response=await fetch(new URL('../assets/hill-of-hills/frozen-initial-414.json',import.meta.url));
    if(!response.ok)throw Error('Hill source export unavailable');
    const terrain=await response.json();
    return hand.create({...context,inputs:{...context.inputs,terrain}});
  }};
