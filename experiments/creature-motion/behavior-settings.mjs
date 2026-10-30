// Authored creature-wide multipliers; source measurements remain unchanged.
export const behaviorControls=Object.freeze([
 {key:'startleResponse',label:'Startle response',description:'Body recoil strength after a sensed disturbance. 1 is normal; 0 removes recoil.'},
 {key:'curiosity',label:'Curiosity',description:'Drive to approach and investigate observed interests. 1 is normal.'},
 {key:'aversion',label:'Aversion',description:'Drive to keep distance from a disturbance. 1 is normal.'},
 {key:'habituation',label:'Habituation speed',description:'How quickly familiar, uneventful experience satisfies interest. 2 learns and settles interest twice as fast.'},
 {key:'recoveryTime',label:'Recovery time',description:'Time to settle after a disturbance. 2 takes twice as long; 0.5 settles twice as fast.'}
]);
export function behaviorSettings(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Creature behavior must be an object');
 const result={};
 for(const {key,label} of behaviorControls){const v=value[key]===undefined?1:value[key];
  if(!Number.isFinite(v)||v<0||['recoveryTime','habituation'].includes(key)&&v===0)throw Error(label+' must be finite and '+(['recoveryTime','habituation'].includes(key)?'positive':'nonnegative'));
  result[key]=v;
 }
 return result;
}
