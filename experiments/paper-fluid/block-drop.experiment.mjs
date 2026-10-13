import {paperBoxSetup} from './contributions.mjs';
import {paperFluidExperiment} from './experiment.mjs';
export default paperFluidExperiment({id:'paper/block-drop',title:'IPBF finite block drop · water view',setup:inputs=>paperBoxSetup({...inputs,scene:'block_drop'}),
 inputs:['resolution','pressureRadius','passes','surfaceCoefficient','beta','alternativeCompliance','dt']});
