import {paperRiverSetup} from './contributions.mjs';
import {paperFluidExperiment} from './experiment.mjs';
export default paperFluidExperiment({id:'paper/river-softness',title:'IPBF river · alternate compliance',setup:paperRiverSetup,
 inputs:['particleCount','referenceParticleCount','pressureRadius','passes','surfaceCoefficient','beta','alternativeCompliance']});
