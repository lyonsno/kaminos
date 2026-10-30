import {MLS_ROUTE} from './mls-juice-contract.mjs';
// Validate the compact counter against the actual particle body at a paused step.
export function assertAuthoredWaterPopulation(state, particles) {
 if(state.failure||state.solver?.failure)throw Error('Water failure prevents population evidence');
 if(state.requestedRoute!==MLS_ROUTE||state.effectiveRoute!==MLS_ROUTE||state.fallbackRoute!==null||particles.route!==MLS_ROUTE)throw Error('Wrong effective water route');
 const {capacity,population,clock}=state.solver;
 if(!Number.isSafeInteger(capacity)||capacity<1||particles.recordFloats!==20||particles.particleCount!==capacity||particles.words.length!==capacity*20||!particles.words.every(Number.isFinite))throw Error('Incomplete native particle body');
 if(!population||population.authority!=='completed_gpu_occupancy'||population.step!==particles.stepCount||population.step!==clock.completedStep||population.step!==clock.step)throw Error('Population step is missing or stale');
 let active=0;for(let i=3;i<particles.words.length;i+=20)if(particles.words[i]>0)active++;
 if(active!==population.active||population.capacity!==capacity)throw Error('Reported population differs from native body');
 return active;
}
