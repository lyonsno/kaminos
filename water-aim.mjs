import {Euler,Matrix4,Vector3} from './lib/three.core.js';

// Targets constrain the nozzle's +Z axis, not a gravity-compensated impact.
export function waterAimRotation(origin,target){
 for(const point of [origin,target])if(!Array.isArray(point)||point.length!==3||!point.every(Number.isFinite))throw Error('Water aim requires finite world positions');
 const from=new Vector3(...origin),to=new Vector3(...target);
 if(from.distanceToSquared(to)<1e-20)return null;
 const direction=to.clone().sub(from).normalize(),up=Math.abs(direction.y)>.999999?new Vector3(0,0,1):new Vector3(0,1,0);
 return new Euler().setFromRotationMatrix(new Matrix4().lookAt(to,from,up)).toArray().slice(0,3);
}
export function resolveWaterAim(record,targets){
 const id=record.localLiquidEmitter?.aimAt;
 if(!id)return {active:false,resolved:true};
 if(id===record.id)return {active:true,resolved:false,reason:'The nozzle cannot aim at itself'};
 const target=targets.find(row=>row.id===id);
 if(!target)return {active:true,resolved:false,reason:'Aim target is missing; choose another target or free rotation'};
 const rotation=waterAimRotation(record.transform.position,target.position);
 return rotation?{active:true,resolved:true,targetId:id,target:target.position,rotation}:{active:true,resolved:false,reason:'Move the target away from the nozzle origin'};
}
export function waterBallisticPreview(origin,rotation,speed,duration){
 const v=new Vector3(0,0,speed).applyEuler(new Euler(...rotation));
 return Array.from({length:33},(_,i)=>{const t=duration*i/32;return [origin[0]+v.x*t,origin[1]+v.y*t-4.905*t*t,origin[2]+v.z*t];});
}
