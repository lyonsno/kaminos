// Authored creature-wide multipliers; source measurements remain unchanged.
export const behaviorControls=Object.freeze([
 {key:'startleResponse',label:'Startle response',description:'Body recoil strength after a sensed disturbance. 1 is normal; 0 removes recoil.'},
 {key:'curiosity',label:'Curiosity',description:'Drive to approach and investigate observed interests. 1 is normal.'},
 {key:'aversion',label:'Aversion',description:'Drive to keep distance from a disturbance. 1 is normal.'},
 {key:'recoveryTime',label:'Recovery time',description:'Time to settle after a disturbance. 2 takes twice as long; 0.5 settles twice as fast.'}
]);
export function behaviorSettings(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Creature behavior must be an object');
 const result={};
 for(const {key,label} of behaviorControls){const v=value[key]===undefined?1:value[key];
  if(!Number.isFinite(v)||v<0||key==='recoveryTime'&&v===0)throw Error(label+' must be finite and '+(key==='recoveryTime'?'positive':'nonnegative'));
  result[key]=v;
 }
 return result;
}
