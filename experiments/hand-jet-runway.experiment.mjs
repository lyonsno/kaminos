import hand from './hand-browser-juice.experiment.mjs';

export const RUNWAY_INPUTS={fluidBackend:'mls-mpm',fluidGridSize:[192,80,256],sceneLayout:'runway',
  particleCount:12000,sourceFlux:1800,jetSpeed:4.5,particleLifetimeSeconds:6,fluidViscosity:.1};

export default {...hand,id:'hand-jet-runway',title:'Finger Juice Runway',
  create:context=>hand.create({...context,inputs:{...RUNWAY_INPUTS,...context.inputs}})};
