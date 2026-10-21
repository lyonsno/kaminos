// An exposure distribution, not a prediction of the next transition. Numeric
// signals use overlapping octave cells; named states use their own cells.
// Every elapsed interval belongs to the state observed before that interval.
export function createSignalFamiliarity({decaySeconds=180,exposureSeconds=3}={}) {
 if(!Number.isFinite(decaySeconds)||decaySeconds<=0||!Number.isFinite(exposureSeconds)||exposureSeconds<=0)throw Error('Familiarity times must be finite and positive');
 const weights=new Map();let lastTime=null,previous=null;
 function cells(value){
  if(typeof value==='string')return [[`state:${value}`,1]];
  if(!Number.isFinite(value)||value<0)throw Error('Signal value must be a named state or finite nonnegative number');
  if(value===0)return [['zero',1]];
  const level=Math.log2(value),lo=Math.floor(level),fraction=level-lo;
  return [[lo,1-fraction],[lo+1,fraction]];
 }
 function observe({time,value}){
  const next=cells(value);
  if(!Number.isFinite(time))throw Error('Signal time must be finite');
  if(lastTime!==null&&time<lastTime)throw Error('Signal time must not move backward');
  const dt=lastTime===null?0:time-lastTime,fade=Math.exp(-dt/decaySeconds);
  for(const [key,weight] of weights)weights.set(key,weight*fade);
  if(previous)for(const [key,share] of previous)weights.set(key,(weights.get(key)??0)+(1-fade)*share);
  const total=[...weights.values()].reduce((a,b)=>a+b,0);
  const support=total>0?next.reduce((sum,[key,share])=>sum+Math.min(share,(weights.get(key)??0)/total),0):0;
  const exposure=total*decaySeconds,familiarity=support*(1-Math.exp(-exposure/exposureSeconds));
  previous=next;lastTime=time;
  return {familiarity,exposureSeconds:exposure};
 }
 function gap(){previous=null;}
 return Object.freeze({observe,gap});
}
