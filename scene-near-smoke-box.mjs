import {volumeGatherPlan} from './scene-volume-gather.mjs';
export function normalizeNearSmokeBox(value={}){
 const box={enabled:true,grid:8,directions:24,extent:[1.5,1.5,1.5],...value};
 if(typeof box.enabled!=='boolean')throw Error('near light box enabled must be boolean');
 if(!Number.isSafeInteger(box.grid)||box.grid<1)throw Error('near light grid must be a positive integer');
 if(!Number.isSafeInteger(box.directions)||box.directions<2||box.directions%2)throw Error('near light directions must be a positive even count');
 if(!Array.isArray(box.extent)||box.extent.length!==3||!box.extent.every(n=>Number.isFinite(n)&&n>=1))throw Error('near light extents must be three finite multipliers at least one');
 return {enabled:box.enabled,grid:box.grid,directions:box.directions,extent:[...box.extent]};
}
// One axis-aligned near region for each Fine domain. Extra Y reach goes above
// the outlet; X/Z reach is symmetric. The scene's physical media remain owned
// by the simulation, including any independent material Middle grid.
export function nearSmokeBoxCoverage(value,domain){
 const box=normalizeNearSmokeBox(value);if(!box.enabled)return null;
 const span=domain.hi.map((v,a)=>v-domain.lo[a]);
 const lo=domain.lo.map((v,a)=>v-(a===1?0:.5*span[a]*(box.extent[a]-1)));
 const hi=domain.hi.map((v,a)=>v+span[a]*(box.extent[a]-1)*(a===1?1:.5));
 const pitch=span[0]/box.grid;
 const snapped=hi.map((v,a)=>lo[a]+Math.ceil((v-lo[a])/pitch)*pitch);
 return {lo,hi:snapped,pitch,directions:box.directions};
}

export function admitNearSmokeBox(value,domain,limits,refinement=4){
 const box=normalizeNearSmokeBox(value),coverage=nearSmokeBoxCoverage(box,domain);
 if(coverage)volumeGatherPlan({volumeGrid:Math.round((coverage.hi[0]-coverage.lo[0])/coverage.pitch),sourceDimensions:domain.dimensions,receiverBounds:coverage,directions:box.directions,smokeRefinement:refinement},limits);
 return box;
}
