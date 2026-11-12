export function fitCheckpointSteps(fit){
 if(!Number.isSafeInteger(fit?.steps)||fit.steps<1)throw Error('Positive update count required');
 const selected=fit.checkpointSteps??[];
 if(!Array.isArray(selected)||selected.some(s=>!Number.isSafeInteger(s)||s<0||s>fit.steps)||new Set(selected).size!==selected.length)throw Error('Explicit unique checkpoint steps must lie within the run');
 return [...new Set([0,...selected,fit.steps])].sort((a,b)=>a-b);
}
export async function runFitTrajectory({fit,update,checkpoint}){
 const selected=new Set(fitCheckpointSteps(fit));await checkpoint(0);
 for(let step=1;step<=fit.steps;step++){await update(step);if(selected.has(step))await checkpoint(step);}
}
