// Persistent mineral state. Units are normalized study units, not calibrated geology.
export const VERSION = 1;
export function createWorld({kind='flowstone',size=48,depth=6,seed=17}={}) {
  if(!['flowstone','salt'].includes(kind)) throw Error('Unknown mineral kind');
  if(!Number.isInteger(size)||size<4||!Number.isInteger(depth)||depth<2) throw Error('Invalid grid');
  if(!Number.isSafeInteger(seed))throw Error('Invalid seed');
  const count=size*size;
  const state={version:VERSION,kind,size,depth,seed,tick:0,settings:{supply:1,evaporation:1,mineral:1},
    bed:new Float64Array(count),solid:new Float64Array(count),water:new Float64Array(count),solute:new Float64Array(count),
    brine:new Float64Array(count*depth),pressure:new Float64Array(count*depth),
    ledger:{initial:0,incoming:0,outgoing:0},pressureResidual:0};
  for(let z=0;z<size;z++) for(let x=0;x<size;x++) {
    const i=z*size+x,u=x/(size-1),v=z/(size-1);
    state.bed[i]=kind==='flowstone' ? .7*(1-v)+.025*Math.sin(u*19+v*5)+.012*Math.sin(v*46+2*Math.sin(u*8)) : .008*Math.sin(u*13+v*8)+.006*Math.sin(u*29-v*21);
    state.water[i]=kind==='flowstone'?.015:0;
    state.solute[i]=state.water[i]*1.2;
    for(let y=0;y<depth;y++) state.brine[y*count+i]=.8+.05*Math.sin(x*1.71+z*2.31+seed)*(1-y/(depth-1));
  }
  state.ledger.initial=mineralMass(state);return state;
}
export function mineralMass(s){return s.solid.reduce((a,b)=>a+b,0)+(s.kind==='flowstone'?s.solute:s.brine).reduce((a,b)=>a+b,0);}
const scratch = new WeakMap();
function buffers(s) {
  let b=scratch.get(s);if(b)return b;
  const n=s.size,N=n*n,M=N*s.depth,edges=[];
  for(let y=0;y<s.depth;y++)for(let z=0;z<n;z++)for(let x=0;x<n;x++){
    const a=y*N+z*n+x;
    if(x+1<n)edges.push([a,a+1,0]);if(z+1<n)edges.push([a,a+n,0]);if(y+1<s.depth)edges.push([a,a+N,1]);
  }
  b={dw:new Float64Array(N),ds:new Float64Array(N),dc:new Float64Array(M),next:new Float64Array(M),rhs:new Float64Array(M),degree:new Float64Array(M),edges};
  scratch.set(s,b);return b;
}
export function setConditions(s,patch){
  const next={...s.settings};for(const [k,v] of Object.entries(patch)){
    if(!Object.hasOwn(next,k)||!Number.isFinite(v)||v<0)throw Error(`Invalid condition ${k}`);next[k]=v;
  }s.settings=next;return s.settings;
}
export function advance(s,steps=1){
  if(!Number.isSafeInteger(steps)||steps<0)throw Error('steps must be a nonnegative integer');
  for(let k=0;k<steps;k++){if(s.kind==='flowstone')flowStep(s);else saltStep(s);s.tick++;}return s;
}
function flowStep(s){
  const n=s.size,N=n*n,{dw,ds}=buffers(s);dw.fill(0);ds.fill(0);
  // Explicit upstream supply, varying gently across the source edge.
  for(let x=0;x<n;x++){
    const amount=.002*s.settings.supply*(.75+.25*Math.cos(x/n*7+s.seed));
    s.water[x]+=amount;const m=amount*(1.5*s.settings.mineral);s.solute[x]+=m;s.ledger.incoming+=m;
  }
  const h=i=>s.bed[i]+s.solid[i]+s.water[i];
  const exchange=(a,b)=>{
    if(h(a)<h(b))[a,b]=[b,a];
    const w=Math.min(s.water[a]*.22,Math.max(0,h(a)-h(b))*.22);
    const m=s.water[a]>0?w*s.solute[a]/s.water[a]:0;
    dw[a]-=w;dw[b]+=w;ds[a]-=m;ds[b]+=m;
  };
  for(let z=0;z<n;z++)for(let x=0;x<n;x++){const i=z*n+x;if(x+1<n)exchange(i,i+1);if(z+1<n)exchange(i,i+n);}
  for(let i=0;i<N;i++){
    s.water[i]=Math.max(0,s.water[i]+dw[i]);s.solute[i]=Math.max(0,s.solute[i]+ds[i]);
    if(i>=N-n){const fraction=.12;const m=s.solute[i]*fraction;s.water[i]*=1-fraction;s.solute[i]-=m;s.ledger.outgoing+=m;}
    // Reduced precipitation model: concentration threshold plus flow exposure.
    // Not a carbonate speciation / CO2 solver or a calibrated geological clock.
    s.water[i]=Math.max(0,s.water[i]-.00015*s.settings.evaporation);
    const excess=s.solute[i]-s.water[i];
    if(excess>0){const deposit=excess*(.045+.12*Math.min(1,Math.abs(dw[i])*120));s.solute[i]-=deposit;s.solid[i]+=deposit;}
    else if(s.water[i]>0){const dissolved=Math.min(s.solid[i],-excess*.005);s.solid[i]-=dissolved;s.solute[i]+=dissolved;}
  }
}
function saltStep(s){
  const n=s.size,N=n*n,M=N*s.depth,{dc,next,rhs,degree,edges}=buffers(s);
  dc.fill(0);rhs.fill(0);degree.fill(0);
  // Darcy-like buoyancy transport in a shallow porous volume. Project the
  // buoyancy flux onto a closed-domain pressure field with twelve relaxation
  // sweeps per tick, retaining pressure between ticks. Residual stays visible.
  const force=(a,b,vertical)=>vertical*1.2*((s.brine[a]+s.brine[b])*.5-.8);
  const permeability=(a,b)=>1/(1+2*(s.solid[a%N]+s.solid[b%N]));
  for(const [a,b,v] of edges){const k=permeability(a,b),f=k*force(a,b,v);rhs[a]-=f;rhs[b]+=f;degree[a]+=k;degree[b]+=k;}
  for(let iteration=0;iteration<12;iteration++){
    next.set(rhs);for(const [a,b] of edges){const k=permeability(a,b);next[a]+=k*s.pressure[b];next[b]+=k*s.pressure[a];}
    for(let i=0;i<M;i++)next[i]=.7*next[i]/degree[i]+.3*s.pressure[i];
    s.pressure.set(next);
  }
  next.fill(0);
  for(const [a,b,v] of edges){
    const q=permeability(a,b)*(s.pressure[a]-s.pressure[b]+force(a,b,v));next[a]+=q;next[b]-=q;
    const donor=q>=0?a:b,receiver=q>=0?b:a;
    const advected=Math.min(.08,Math.abs(q)*.1)*s.brine[donor];dc[donor]-=advected;dc[receiver]+=advected;
    const diffusion=.006*(s.brine[a]-s.brine[b]);dc[a]-=diffusion;dc[b]+=diffusion;
  }
  s.pressureResidual=next.reduce((m,v)=>Math.max(m,Math.abs(v)),0);
  // Prescribed upward replenishment replaces evaporated water. Salt remains at
  // the surface. Each column's supply is reduced by its evolving crust.
  for(let i=0;i<N;i++){
    const flux=Math.min(.08,.015*s.settings.supply*s.settings.evaporation/(1+4*s.solid[i]));
    for(let y=1;y<s.depth;y++){const a=y*N+i,m=flux*s.brine[a];dc[a]-=m;dc[a-N]+=m;}
    const supplied=flux*.8*s.settings.mineral;dc[(s.depth-1)*N+i]+=supplied;s.ledger.incoming+=supplied;
  }
  for(let i=0;i<M;i++)s.brine[i]=Math.max(0,s.brine[i]+dc[i]);
  for(let i=0;i<N;i++){
    const excess=s.brine[i]-1.05;
    if(excess>0){const amount=excess*.08;s.brine[i]-=amount;s.solid[i]+=amount;}
    else {const amount=Math.min(s.solid[i],-excess*.002);s.solid[i]-=amount;s.brine[i]+=amount;}
    s.water[i]=s.brine[i]/(1+8*s.solid[i]);
  }
}
const fields=['bed','solid','water','solute','brine','pressure'];
export function checkpoint(s){return JSON.parse(JSON.stringify(s,(_,v)=>ArrayBuffer.isView(v)?Array.from(v):v));}
export function restore(c){
  if(!c||c.version!==VERSION)throw Error('Unsupported mineral checkpoint version');
  if(!Number.isSafeInteger(c.tick)||c.tick<0||!Number.isSafeInteger(c.seed))throw Error('Invalid clock or seed');
  if(!['flowstone','salt'].includes(c.kind)||!Number.isInteger(c.size)||c.size<4||!Number.isInteger(c.depth)||c.depth<2)throw Error('Invalid checkpoint process/grid identity');
  const s=createWorld(c),N=s.size*s.size;
  for(const key of fields){const expected=['brine','pressure'].includes(key)?N*s.depth:N;
    if(!Array.isArray(c[key])||c[key].length!==expected||!c[key].every(v=>Number.isFinite(v)&&(['bed','pressure'].includes(key)||v>=0)))throw Error(`Invalid checkpoint ${key}`);
    s[key]=Float64Array.from(c[key]);
  }
  if(!c.settings||!['supply','evaporation','mineral'].every(k=>Object.hasOwn(c.settings,k)))throw Error('Missing conditions');
  setConditions(s,c.settings);
  if(!c.ledger||!['initial','incoming','outgoing'].every(k=>Number.isFinite(c.ledger[k])&&c.ledger[k]>=0))throw Error('Invalid mineral ledger');
  if(!Number.isFinite(c.pressureResidual)||c.pressureResidual<0)throw Error('Invalid pressure residual');
  s.tick=c.tick;s.ledger={...c.ledger};s.pressureResidual=c.pressureResidual;return s;
}
export function summary(s){return {kind:s.kind,tick:s.tick,size:s.size,depth:s.depth,settings:{...s.settings},
  deposited:s.solid.reduce((a,b)=>a+b,0),mineralError:mineralMass(s)-(s.ledger.initial+s.ledger.incoming-s.ledger.outgoing),
  pressureResidual:s.pressureResidual,model:s.kind==='salt'?'reduced porous brine / retained crust':'reduced shallow flow / retained precipitate'};}
