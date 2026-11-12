// Explicit legacy numerical-experiment mount. Authored water uses MLS and
// imports no experiment solver through its ordinary production feature.
export async function createAuthoredWaterExperimentHost(options){
 const [{createFiniteFluidHost},{createFluidViewportHost},{createWebGPUFingerFluidSolver}]=await Promise.all([import('./finite-fluid-host.mjs'),import('./fluid-viewport-host.mjs'),import('./finger-fluid-webgpu-core.js')]);
 return createFiniteFluidHost({...options,createSolver:createWebGPUFingerFluidSolver,createPresentation:solver=>createFluidViewportHost({...options,solver})});
}
