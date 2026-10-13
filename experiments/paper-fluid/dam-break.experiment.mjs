import {paperBoxSetup} from './contributions.mjs';
import {paperFluidExperiment} from './experiment.mjs';
export default paperFluidExperiment({id:'paper/dam-break',title:'IPBF finite dam break · water view',setup:inputs=>paperBoxSetup({...inputs,scene:'dam_break'}),
 inputs:['resolution','pressureRadius','passes','surfaceCoefficient','beta','alternativeCompliance','dt']});
