// Which passes a local liquid host frame runs. Full is the retained refraction
// composite; Proxy keeps the step and one ordinary scene render (where a proxy
// layer draws) and drops the second depth render and the liquid composite.
export const LOCAL_LIQUID_PRESENTATIONS=Object.freeze(['full','proxy']);
export function localLiquidPresentationPlan(mode) {
 if(!LOCAL_LIQUID_PRESENTATIONS.includes(mode))throw Error(`Unknown local liquid presentation: ${mode}`);
 const full=mode==='full';
 return {step:true,sceneColor:true,sceneDepth:full,environment:full,liquidComposite:full};
}
