import {Vector3,Matrix4} from './lib/three.core.js';
import {checkedStageMold} from './stage-mold.mjs';
import {stageLetterCastings} from './casting-transfer.mjs';

// The same raster and world transform that construct the mold delimit its
// letter cavities. The runner, walls, and overflow are deliberately outside.
export function stageFillQuery(root){
 const p=checkedStageMold(root.userData.kaminosStageMold),parts=stageLetterCastings(p),width=p.rows[0].length,height=p.rows.length;
 root.updateWorldMatrix(true,false);
 const scaleVolume=Math.abs(root.matrixWorld.determinant());
 if(!(scaleVolume>0))throw Error('Mold has a singular transform');
 const labels=new Uint32Array(width*height),regions=parts.map((part,index)=>{
  let cells=0;for(let z=0;z<64;z++)for(let x=part.columns[0];x<part.columns[1];x++)if(p.rows[z][x]==='.'){labels[z*width+x]=index+1;cells++;}
  return {index,label:part.recipe.label,capacityVolume:cells*p.pitch*p.pitch*p.wallHeight*scaleVolume};
 });
 return {width,height,labels:Array.from(labels),pitch:p.pitch,minY:0,maxY:p.wallHeight,worldToLocal:root.matrixWorld.clone().invert().toArray(),regions};
}
export function regionAt(q,world){
 const p=new Vector3(...world).applyMatrix4(new Matrix4().fromArray(q.worldToLocal));
 if(p.y<q.minY||p.y>=q.maxY)return 0;
 const x=Math.floor(p.x/q.pitch+q.width/2),z=Math.floor(p.z/q.pitch+q.height/2);
 return x>=0&&z>=0&&x<q.width&&z<q.height?q.labels[z*q.width+x]:0;
}
export function stageFillReading(q,sample){
 if(sample.counts?.length!==q.regions.length||sample.counts.some(n=>!Number.isSafeInteger(n)||n<0))throw Error('Invalid letter particle counts');
 if(!(sample.particleVolume>0)||!Number.isFinite(sample.particleVolume)||!Number.isSafeInteger(sample.step)||sample.step<0)throw Error('Invalid letter volume sample');
 return {step:sample.step,authority:'gpu_particle_count_times_rest_volume',regions:q.regions.map((r,i)=>({...r,particles:sample.counts[i],volume:sample.counts[i]*sample.particleVolume,fraction:sample.counts[i]*sample.particleVolume/r.capacityVolume}))};
}
