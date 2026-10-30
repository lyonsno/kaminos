import { worldSmokePlan, intermediateFlowPlan, intermediateSmokePlan } from './volume-world-smoke.mjs';
export const REGION_CONTROL_FIELDS = [
 ['fineVelocity','volume-fine-velocity',0,'Fine velocity width (0 = material)',0],
 ['finePressure','volume-fine-pressure',0,'Fine pressure width (0 = velocity / legacy choice)',0],
 ['worldSmokePressure','volume-world-smoke-pressure',0,'Pressure width (0 = flow)',0],
 ['worldSmokeIterations','volume-world-smoke-iterations',16,'Pressure iterations',0],
 ['intermediateFlow','volume-intermediate-flow',24,'Velocity width',2],
 ['intermediateMaterial','volume-intermediate-material',48,'Material width',2],
 ['intermediatePressure','volume-intermediate-pressure',12,'Pressure width',2],
 ['intermediateIterations','volume-intermediate-iterations',12,'Pressure iterations',0],
 ['intermediateExtent','volume-intermediate-extent',1.5,'Extent / fine width',1],
].map(([key,id,value,label,min])=>({key,id,value,label,min,param:id.replaceAll('-','_')}));
function iterations(value) {
 if(!Number.isInteger(value)||value<0)throw Error('Pressure iterations must be a nonnegative integer');
 return value;
}
export function resolveWorldRegions(c, fineDims) {
 const flow=Number(c.worldSmokeFlow??16),fineHeightRatio=fineDims[1]/fineDims[0];
 const pressure=Number(c.worldSmokePressure??0);
 const world=worldSmokePlan({flow,pressure:pressure===0?flow:pressure,material:Number(c.worldSmokeMaterial??32),extent:Number(c.worldSmokeExtent??3),fineHeightRatio});
 const middleMode=c.worldSmokeIntermediate??'off';
 if(!['off','on','fields'].includes(middleMode))throw Error('Unknown intermediate field mode');
 const middle=middleMode==='fields'?intermediateSmokePlan(world,{flow:Number(c.intermediateFlow??24),material:Number(c.intermediateMaterial??48),pressure:Number(c.intermediatePressure??12),extent:Number(c.intermediateExtent??1.5),fineHeightRatio}):middleMode==='on'?intermediateFlowPlan(world,fineDims):null;
 return {world,worldIterations:iterations(Number(c.worldSmokeIterations??16)),middle,middleIterations:middleMode==='on'?16:iterations(Number(c.intermediateIterations??12)),middleMode};
}
