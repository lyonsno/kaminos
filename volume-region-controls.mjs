import { worldSmokePlan } from './volume-world-smoke.mjs';
export const REGION_CONTROL_FIELDS = [
 ['fineVelocity','volume-fine-velocity',0,'Fine velocity width (0 = material)',0],
 ['finePressure','volume-fine-pressure',0,'Fine pressure width (0 = velocity / legacy choice)',0],
 ['worldSmokePressure','volume-world-smoke-pressure',0,'Pressure width (0 = flow)',0],
 ['worldSmokeIterations','volume-world-smoke-iterations',16,'Pressure iterations',0],
].map(([key,id,value,label,min])=>({key,id,value,label,min,param:id.replaceAll('-','_')}));
function iterations(value) {
 if(!Number.isInteger(value)||value<0)throw Error('Pressure iterations must be a nonnegative integer');
 return value;
}
export function resolveWorldRegions(c, fineDims) {
 const flow=Number(c.worldSmokeFlow??16),fineHeightRatio=fineDims[1]/fineDims[0];
 const pressure=Number(c.worldSmokePressure??0);
 const world=worldSmokePlan({flow,pressure:pressure===0?flow:pressure,material:Number(c.worldSmokeMaterial??32),extent:Number(c.worldSmokeExtent??3),fineHeightRatio});
 // Archived Middle settings are ignored. They must not reactivate a retired
 // third region when an older scene or basin is opened.
 return {world,worldIterations:iterations(Number(c.worldSmokeIterations??16))};
}
