import {checkedPose} from './scene-edit-session.mjs';
import {normalizeAuthoredWaterSampling} from './authored-water-drop.mjs';

// A unit-box proxy: position is the world centre, scale is each world extent.
// The MLS grid stays axis aligned; changing its box does not move its sources.
export function waterDomainPose(sampling){
 const s=normalizeAuthoredWaterSampling(sampling),b=s.container??s.worldBounds;
 return {position:b.min.map((v,i)=>v+(b.max[i]-v)/2),rotation:[0,0,0],scale:b.max.map((v,i)=>v-b.min[i])};
}
export function checkedWaterDomainPose(value,cellSize){
 const pose=checkedPose(value);
 if(!Number.isFinite(cellSize)||cellSize<=0)throw Error('Water grid cell size must be positive');
 if(pose.rotation.some(v=>v!==0))throw Error('Water simulation stays aligned with world axes; use Move or Scale');
 // The producer requires eight grid cells, including five boundary cells.
 // Dragging through zero stops at that physical minimum instead of wrapping.
 pose.scale=pose.scale.map(v=>Math.max(3*cellSize,v));
 return pose;
}
export function waterDomainSampling(sampling,value,cellSize){
 const s=normalizeAuthoredWaterSampling(sampling),p=checkedWaterDomainPose(value,cellSize);
 const bounds={min:p.position.map((v,i)=>v-p.scale[i]/2),max:p.position.map((v,i)=>v+p.scale[i]/2)};
 return normalizeAuthoredWaterSampling({...s,...(s.container===null?{worldBounds:bounds}:{container:bounds})});
}
