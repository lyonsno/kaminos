// Placement policy only: physical box size and simulation calibration stay fixed.
export const FINE_COVERAGE_DEFAULTS = Object.freeze({mode:'off',margin:.15,headroom:.75,lookahead:.3,interval:.25,activityWeight:1,hysteresis:.05});
export function checkedFineCoverageOptions(input={}) {
 const o={...FINE_COVERAGE_DEFAULTS,...input};
 if(!['off','sources','fire'].includes(o.mode))throw new Error('Unknown Fine coverage mode');
 for(const key of ['margin','headroom','lookahead','interval','activityWeight','hysteresis'])if(!Number.isFinite(o[key])||o[key]<0)throw new Error(`Fine coverage ${key} must be finite and nonnegative`);
 if(o.margin>=.5||o.headroom>1||o.hysteresis>1)throw new Error('Fine coverage margin must be below 0.5; headroom and hysteresis at most 1');
 return o;
}
const vector=(v,name)=>{if(!Array.isArray(v)||v.length!==3||v.some(x=>!Number.isFinite(x)))throw new Error(`${name} must be a finite 3-vector`);return v;};
const center=b=>b.lo.map((x,a)=>(x+b.hi[a])/2);
const sameFrame=(a,b)=>a&&b&&Math.abs(a.scale-b.scale)<1e-8&&a.translate.every((x,i)=>Math.abs(x-b.translate[i])<1e-8);
function checkedBox(b) {
 vector(b.lo,'coverage lo');vector(b.hi,'coverage hi');
 if(b.lo.some((x,a)=>x>b.hi[a])||!Number.isFinite(b.weight??1)||(b.weight??1)<0)throw new Error('Coverage bounds and weights must be finite and ordered');
 for(const key of ['motionMin','motionMax'])if(b[key])vector(b[key],key);
 return b;
}
function normalized(boxes,weight,lookahead) {
 const total=boxes.reduce((s,b)=>s+(b.weight??1),0);
 return boxes.filter(b=>(b.weight??1)>0).map(b=>({...b,weight:total?(b.weight??1)/total*weight:0,
  lo:b.lo.map((x,a)=>x+Math.min(0,(b.motionMin?.[a]??0)*lookahead)),
  hi:b.hi.map((x,a)=>x+Math.max(0,(b.motionMax?.[a]??0)*lookahead))}));
}
function fraction(b,lo,hi) {
 let f=1;
 for(let a=0;a<3;a++){const width=b.hi[a]-b.lo[a];f*=width>1e-12?Math.max(0,Math.min(b.hi[a],hi[a])-Math.max(b.lo[a],lo[a]))/width:(b.lo[a]>=lo[a]&&b.lo[a]<=hi[a]?1:0);}
 return f;
}
export function chooseFineCoverage(input,options={}) {
 const o=checkedFineCoverageOptions(options),{frame,dims,world}=input;
 vector(frame.translate,'Fine translation');vector(dims,'Fine dimensions');
 if(!(frame.scale>0)||!Number.isFinite(frame.scale)||dims.some(x=>x<=0))throw new Error('Fine scale and dimensions must be finite and positive');
 checkedBox({...world,weight:1});
 const sources=(input.sources??[]).map(checkedBox),demand=(input.demand??[]).map(checkedBox);
 const extent=dims.map(n=>2*frame.scale*n/dims[0]),offset=extent.map(n=>n/2-frame.scale),pitch=2*frame.scale/dims[0];
 const lower=world.lo.map(x=>x+frame.scale),upper=world.hi.map((x,a)=>x+frame.scale-extent[a]);
 const result={target:null,status:'holding',sourceCoverage:0,activityCoverage:0,gain:0,worldLimited:false};
 if(o.mode==='off')return {...result,status:'off'};
 if(lower.some((x,a)=>x>upper[a]))return {...result,status:'box-exceeds-world',worldLimited:true};
 const sb=normalized(sources,1,o.lookahead),db=normalized(demand,o.mode==='fire'?(sources.length?o.activityWeight:1):0,o.lookahead),all=[...sb,...db].filter(b=>b.weight>0);
 if(!all.length)return {...result,status:'no-demand'};
 const score=t=>{const lo=t.map((x,a)=>x-frame.scale+extent[a]*o.margin),hi=lo.map((x,a)=>x+extent[a]*(1-2*o.margin));return all.reduce((sum,b)=>sum+b.weight*fraction(b,lo,hi),0);};
 const current=score(frame.translate),candidates=[frame.translate];
 const add=(c,headroom=false)=>{let t=c.map((x,a)=>x-offset[a]+(a===1&&headroom?(o.headroom-.5)*extent[a]:0));
  // Quantize within the World, never round a clamped placement back outside it.
  t=t.map((x,a)=>{const origin=frame.translate[a],min=Math.ceil((lower[a]-origin)/pitch-1e-8),max=Math.floor((upper[a]-origin)/pitch+1e-8);return min<=max?origin+Math.max(min,Math.min(max,Math.round((x-origin)/pitch)))*pitch:Math.max(lower[a],Math.min(upper[a],x));});candidates.push(t);};
 const centroid=bs=>{const total=bs.reduce((s,b)=>s+b.weight,0);return total?Array.from({length:3},(_,a)=>bs.reduce((s,b)=>s+center(b)[a]*b.weight,0)/total):null;};
 for(const b of sb)add(center(b),true);
 for(const [bs,headroom] of [[sb,true],[db,false],[all,false]]){const c=centroid(bs);if(c)add(c,headroom);}
 const strongest=db.reduce((best,b)=>b.weight>(best?.weight??0)?b:best,null);if(strongest)add(center(strongest));
 let best=frame.translate,bestScore=current,bestDistance=0;
 for(const t of candidates){const s=score(t),distance=t.reduce((sum,x,a)=>sum+(x-frame.translate[a])**2,0);if(s>bestScore+1e-9||(Math.abs(s-bestScore)<1e-9&&distance<bestDistance)){best=t;bestScore=s;bestDistance=distance;}}
 const total=all.reduce((s,b)=>s+b.weight,0),gain=bestScore-current;
 if(gain>o.hysteresis*total+1e-9)result.target={translate:best,scale:frame.scale};else best=frame.translate;
 const lo=best.map((x,a)=>x-frame.scale+extent[a]*o.margin),hi=lo.map((x,a)=>x+extent[a]*(1-2*o.margin));
 const coverage=bs=>{const w=bs.reduce((s,b)=>s+b.weight,0);return w?Math.min(1,bs.reduce((s,b)=>s+b.weight*fraction(b,lo,hi),0)/w):0;};
 result.sourceCoverage=coverage(sb);result.activityCoverage=coverage(db);result.gain=result.target?gain:0;
 result.worldLimited=all.some(b=>b.lo.some((x,a)=>x<world.lo[a]||b.hi[a]>world.hi[a]));
 result.status=result.target?'move':result.worldLimited?'world-limited':'holding';
 return result;
}
export function sourceCoverageBounds(packed,{dims,frame}) {
 const pitch=2*frame.scale/dims[0],out=[];
 for(const source of packed?.sources??[]){const e=source.config?.effective;if(!e||e.admitted===false)continue;
  const weight=Math.max(0,source.worldSource?(e.fullFlux??e.fluxRequested??0):(e.fluxRequested??0));if(!weight)continue;
  const normal=e.direction??[0,1,0],len=Math.hypot(...normal)||1,c=e.centreCells.map((x,a)=>(2*x/dims[0]-1)*frame.scale+frame.translate[a]);
  const radius=Math.max(0,e.radiusCells??0),half=Math.max(0,e.thickness??1)/2;
  const reach=normal.map(x=>{const n=x/len;return (radius*Math.sqrt(Math.max(0,1-n*n))+half*Math.abs(n)+1.5)*pitch;});
  out.push({id:source.id,lo:c.map((x,a)=>x-reach[a]),hi:c.map((x,a)=>x+reach[a]),weight});
 }
 return out;
}
export class FineCoverageController {
 constructor(){this.lastCheck=-Infinity;this.lastFrame=null;this.policy=null;this.sources=null;this.history=new Map();this.manualHold=false;this.checks=0;this.moves=0;this.lastResult={status:'off',target:null};}
 release(){this.lastFrame=null;this.policy=null;this.sources=null;this.manualHold=false;this.history.clear();}
 due(options,now){const o=checkedFineCoverageOptions(options);return JSON.stringify(o)!==this.policy||now-this.lastCheck>=o.interval;}
 update(input,options,now){
  if(!Number.isFinite(now))throw new Error('Coverage clock must be finite');
  const o=checkedFineCoverageOptions(options),policy=JSON.stringify(o),signature=JSON.stringify((input.sources??[]).map(b=>[b.id,...b.lo,...b.hi].map(x=>typeof x==='number'?Math.round(x*1e7)/1e7:x)));
  const changed=policy!==this.policy||signature!==this.sources;
  const external=this.lastFrame&&!sameFrame(input.frame,this.lastFrame);
  if(external&&policy===this.policy)this.manualHold=true;else if(changed)this.manualHold=false;
  const sources=(input.sources??[]).map(b=>{const c=center(b),old=this.history.get(b.id);this.history.set(b.id,{c,time:now});
   const velocity=old&&now>old.time?c.map((x,a)=>(x-old.c[a])/(now-old.time)):[0,0,0];
   return {...b,motionMin:b.motionMin??velocity,motionMax:b.motionMax??velocity};});
  for(const id of this.history.keys())if(!sources.some(b=>b.id===id))this.history.delete(id);
  this.lastCheck=now;this.lastFrame={translate:[...input.frame.translate],scale:input.frame.scale};this.policy=policy;this.sources=signature;this.checks++;
  this.lastResult=this.manualHold&&o.mode!=='off'?{target:null,status:'manual-hold'}:chooseFineCoverage({...input,sources},o);
  return this.lastResult;
 }
 accept(frame,now){this.lastFrame={translate:[...frame.translate],scale:frame.scale};this.moves++;this.lastApplied=now;}
 read(){return {...this.lastResult,checks:this.checks,moves:this.moves,lastApplied:this.lastApplied??null};}
}
