export const LOG_RESIDUE=.15;
export const LOG_DISINTEGRATION_RATE=.18;
export function consumeLogReserve(fuel,reactivity,dt,{rate=LOG_DISINTEGRATION_RATE,residue=LOG_RESIDUE}={}){
 if(![fuel,reactivity,dt,rate,residue].every(Number.isFinite)||fuel<0||fuel>1||reactivity<0||reactivity>1||dt<=0||rate<=0||residue<0||residue>=1)throw Error('Invalid finite material consumption');
 if(fuel<=residue+1e-6)return {fuel,gas:0,detached:0,present:false};
 const next=Math.max(residue,fuel-fuel*(1-Math.exp(-rate*dt))*reactivity);
 const remaining=next<=residue+1e-6?residue:next;
 return {fuel:remaining,gas:fuel-remaining,detached:remaining===residue?residue:0,present:remaining>residue};
}
export const LOG_CONSUMPTION_WGSL=`
const residue:f32=${LOG_RESIDUE};
const materialRate:f32=${LOG_DISINTEGRATION_RATE};
fn materialPresent(fuel:f32)->bool{return fuel>residue+0.000001;}
fn finiteConsumption(old:LogCell,raw:LogCell)->LogCell{
 var next=raw;
 let remaining=max(residue,raw.burn.y);
 next.burn.y=select(remaining,residue,remaining<=residue+0.000001);
 next.burn.z=max(0.0,old.burn.y-next.burn.y);
 if(!materialPresent(old.burn.y)){next.burn=vec4<f32>(old.burn.x,old.burn.y,0,0);next.material.z=0.0;}
 next.material.y=max(next.material.y,1.0-next.burn.y);
 return next;
}`;
