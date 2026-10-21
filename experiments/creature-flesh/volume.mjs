import {tetrahedron,sub,dot,inverse,apply} from './elastic.mjs';

// CPU reference for a small volume. Pose-conditioned elastic metric; the rig
// supplies the reference, not forces that this solver may feed back into bones.
export function createFleshVolume({positions,tetrahedra,pinned},{young=30,poisson=.35,bulk=100,density=1,contact=500,damping=.92,iterations=12,lineSearchTrials=8}={}){
 if(!Array.isArray(positions)||!positions.length||!positions.every(p=>p?.length===3&&p.every(Number.isFinite))||!Array.isArray(tetrahedra)||!tetrahedra.length||!tetrahedra.every(t=>t?.length===4&&new Set(t).size===4&&t.every(i=>Number.isInteger(i)&&i>=0&&i<positions.length)))throw Error('Complete finite volume required');
 if(!Array.isArray(pinned)||pinned.length!==positions.length||!pinned.every(v=>typeof v==='boolean'))throw Error('Explicit volume pins required');
 if(![density,contact].every(v=>Number.isFinite(v)&&v>0)||!Number.isFinite(damping)||damping<0||damping>1||![iterations,lineSearchTrials].every(v=>Number.isSafeInteger(v)&&v>0))throw Error('Invalid volume settings');
 const n=positions.length,incident=positions.map(()=>[]),mass=positions.map(()=>0);
 let target=structuredClone(positions),offset=positions.map(()=>[0,0,0]),velocity=positions.map(()=>[0,0,0]),references,steps=0,epoch=0,enabled=true,sphere=null;
 const refs=points=>tetrahedra.map(t=>tetrahedron(t.map(i=>points[i]),{young,poisson,bulk}));references=refs(target);
 tetrahedra.forEach((t,e)=>t.forEach((i,local)=>{incident[i].push([e,local]);mass[i]+=references[e].volume*density/4;}));
 if(mass.some(m=>!(m>0)))throw Error('Unreferenced volume point');
 function localValue(i,trial,predicted,dt,hessian){
  const m=mass[i]/(dt*dt),d=sub(trial,predicted),gradient=d.map(v=>v*m),H=[m,0,0,0,m,0,0,0,m];let energy=m*dot(d,d)/2;
  for(const [e,local] of incident[i]){
   const points=tetrahedra[e].map(j=>target[j].map((v,a)=>v+(j===i?trial[a]:offset[j][a]))),r=references[e].evaluate(points,{local,hessian});
   energy+=r.energy;if(hessian){for(let a=0;a<3;a++)gradient[a]+=r.gradients[0][a];for(let a=0;a<9;a++)H[a]+=r.hessian[a];}
  }
  if(sphere){
   const q=target[i].map((v,a)=>v+trial[a]-sphere.center[a]),r=Math.hypot(...q),depth=r-sphere.radius;
   if(depth<0){const normal=r>1e-12?q.map(v=>v/r):[1,0,0];energy+=contact*depth*depth/2;if(hessian){for(let a=0;a<3;a++)gradient[a]+=contact*depth*normal[a];for(let a=0;a<3;a++)for(let b=0;b<3;b++)H[a*3+b]+=contact*normal[a]*normal[b];}}
  }
  return{energy,gradient,H};
 }
 function step(dt){
  if(!(Number.isFinite(dt)&&dt>0))throw Error('Positive finite physical timestep required');
  if(!enabled)return read();
  const before=structuredClone(offset),oldVelocity=structuredClone(velocity),predicted=offset.map((p,i)=>p.map((v,a)=>v+dt*velocity[i][a]*damping));
  try{
   // Begin from accepted state, not the unchecked inertial predictor. Each
   // local line search tests all incident element volumes before accepting.
   for(let iteration=0;iteration<iterations;iteration++)for(let i=0;i<n;i++){
    if(pinned[i])continue;
    const value=localValue(i,offset[i],predicted[i],dt,true),delta=apply(inverse(value.H),value.gradient).map(v=>-v);
    for(let attempt=0,alpha=1;attempt<lineSearchTrials;attempt++,alpha*=.5){
     const candidate=offset[i].map((v,a)=>v+alpha*delta[a]);let after;
     try{after=localValue(i,candidate,predicted[i],dt,false).energy;}catch(error){if(!/Inverted/.test(error.message))throw error;continue;}
     if(after<=value.energy+1e-14){offset[i]=candidate;break;}
    }
   }
   velocity=offset.map((p,i)=>p.map((v,a)=>(v-before[i][a])/dt));steps++;epoch++;
   return read();
  }catch(error){offset=before;velocity=oldVelocity;throw error;}
 }
 function read(){
  let total=0,reference=0,minJ=Infinity,maxJ=-Infinity;
  references.forEach((tet,e)=>{const r=tet.evaluate(tetrahedra[e].map(i=>target[i].map((v,a)=>v+offset[i][a])));total+=tet.volume*r.J;reference+=tet.volume;minJ=Math.min(minJ,r.J);maxJ=Math.max(maxJ,r.J);});
  return{route:'cpu-pose-conditioned-tetrahedral-local-energy-v0',enabled,steps,epoch,nodes:n,elements:tetrahedra.length,settings:{young,poisson,bulk,density,contact,damping,iterations,lineSearchTrials},minJ,maxJ,volumeRatio:total/reference,maxDisplacement:Math.max(...offset.map(p=>Math.hypot(...p))),sphere:sphere&&structuredClone(sphere)};
 }
 return{step,read,
  setSphere(value){if(value!==null&&(!Array.isArray(value?.center)||value.center.length!==3||!value.center.every(Number.isFinite)||!(Number.isFinite(value.radius)&&value.radius>0)))throw Error('Finite sphere center and positive radius required');sphere=value&&structuredClone(value);},
  setTargets(next){if(next?.length!==n||!next.every(p=>p?.length===3&&p.every(Number.isFinite)))throw Error('Matching finite pose targets required');const prepared=refs(next);prepared.forEach((tet,e)=>tet.evaluate(tetrahedra[e].map(i=>next[i].map((v,a)=>v+offset[i][a]))));target=structuredClone(next);references=prepared;epoch++;},
  setEnabled(value){if(typeof value!=='boolean')throw Error('Boolean physical response required');enabled=value;if(!value){offset=positions.map(()=>[0,0,0]);velocity=positions.map(()=>[0,0,0]);epoch++;}},
  offsets:()=>offset.map(p=>[...p]),points:()=>target.map((p,i)=>p.map((v,a)=>v+offset[i][a])),
 };
}
