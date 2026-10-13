import {paperBoxSetup} from './contributions.mjs';
import {paperFluidExperiment} from './experiment.mjs';
const setup=inputs=>{
 const water=paperBoxSetup({...inputs,scene:'dam_break'});
 return {...water,guide:{...water.guide,
  question:'How does this finite column of IPBF water spread after release?',
  tryThis:'Reset water, then resume the finite column in its invisible box. Watch the advancing front and its impact on the far wall. Keep sampling and timestep fixed while exploring world pressure radius; capture the motion or settled state you want to discuss.',
 }};
};
export default paperFluidExperiment({id:'paper/dam-break',title:'IPBF finite dam break · water view',setup,
 inputs:['resolution','pressureRadius','passes','surfaceCoefficient','beta','alternativeCompliance','dt']});
