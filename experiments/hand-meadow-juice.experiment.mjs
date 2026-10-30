import hand from './hand-jet-runway.experiment.mjs';
export default {...hand,id:'hand-meadow-juice',title:'Meadow · Hand & Juice',
  async create(context){
    const response=await fetch(new URL('../assets/hill-of-hills/meadow.json',import.meta.url));
    if(!response.ok)throw Error('Meadow terrain unavailable');
    const terrain=await response.json();
    return hand.create({...context,inputs:{...context.inputs,terrain,terrainView:{position:[7.8,8.6,11.8],target:[0,.2,0],fov:45}}});
  }};
