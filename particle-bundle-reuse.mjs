import {resolveDirectionalProfile} from './particle-light-slice.mjs';
import {finitePacketBundle} from './volume-packet-bundle.mjs';

function beam(snapshot){
 const {emitter,receiver,halfWidth,width,sections}=snapshot,length=Math.hypot(...receiver.map((x,i)=>x-emitter[i]));
 const {forward,right,up}=finitePacketBundle({origin:emitter,target:receiver,halfSize:[halfWidth,halfWidth],far:length,weight:1});
 return {emitter,receiver,halfWidth,width,sections,length,right,up,forward};
}
const geometry=({emitter,receiver,halfWidth,width,sections})=>JSON.stringify([emitter,receiver,halfWidth,width,sections]);
const dot=(a,b)=>a.reduce((sum,v,c)=>sum+v*b[c],0);
export function seedBundleReuse(snapshot,stride){
 const basis=beam(snapshot),{width,sections,halfWidth,length,emitter,forward,right,up}=basis;
 if(!Number.isSafeInteger(stride)||stride<1||!(stride%2)||width%stride)throw Error('Reference width must be divisible by an odd ray stride');
 const samples=[];
 for(let y=(stride-1)/2;y<width;y+=stride)for(let x=(stride-1)/2;x<width;x+=stride)for(let z=0;z<sections;z++){
  const i=x+y*width;
  const xyz=emitter.map((v,k)=>v+right[k]*halfWidth*(2*(x+.5)/width-1)-up[k]*halfWidth*(2*(y+.5)/width-1)+forward[k]*length*(z+.5)/sections);
  samples.push({xyz,rgb:snapshot.moments[i].slice(4*z,4*z+3)});
 }
 return {basis,stride,samples,identity:{...snapshot.identity},tau:snapshot.moments.map(ray=>ray.filter((_,i)=>i%4===3))};
}
function reconstruct(history,positions){
 const {samples,stride,basis:{width,sections,halfWidth,length,emitter,forward,right,up}}=history;
 if(positions.length!==samples.length)throw Error('Incomplete advected bundle');
 const sums=new Float64Array(width*width*sections*4);
 for(let i=0;i<samples.length;i++){
  const xyz=positions[i];
  if(!xyz)continue;
  if(xyz.length!==3||!xyz.every(Number.isFinite))throw Error('Invalid advected sample position');
  const q=xyz.map((v,c)=>v-emitter[c]),cx=(1+dot(q,right)/halfWidth)*width/2-.5,cy=(1-dot(q,up)/halfWidth)*width/2-.5,cz=dot(q,forward)*sections/length-.5;
  for(let y=Math.max(0,Math.ceil(cy-stride));y<=Math.min(width-1,Math.floor(cy+stride));y++)for(let x=Math.max(0,Math.ceil(cx-stride));x<=Math.min(width-1,Math.floor(cx+stride));x++)for(let z=Math.max(0,Math.ceil(cz-1));z<=Math.min(sections-1,Math.floor(cz+1));z++){
   const w=(1-Math.abs(x-cx)/stride)*(1-Math.abs(y-cy)/stride)*(1-Math.abs(z-cz));
   if(w<=1e-8)continue;
   const at=(x+y*width)*sections*4+z*4,rgb=samples[i].rgb;
   for(let c=0;c<3;c++)sums[at+c]+=w*rgb[c];
   sums[at+3]+=w;
  }
 }
 const support=[],profiles=history.tau.map((tau,i)=>{
  const values=[],weights=[];
  let complete=true;
  const visible=[];
  for(let z=0;z<sections;z++){
   const at=4*(i*sections+z),weight=sums[at+3];
   complete&&=weight>0;
   visible.push(complete);
   weights.push(weight);
   values.push(...[0,1,2].map(c=>weight?sums[at+c]/weight:0),tau[z]);
  }
  support.push(weights);
  // No zero-filled prefix is exposed as a prediction after a hole.
  return resolveDirectionalProfile(values).map((p,z)=>visible[z]?p:null);
 });
 return {profiles,support};
}
export function reprojectBundleReuse(history,positions,reference){
 const {epoch,step,materialStamp}=reference.identity;
 if(epoch!==history.identity.epoch||materialStamp!==history.identity.materialStamp||geometry(reference)!==geometry(history.basis))throw Error('Reference uses different material or beam');
 if(step<=history.identity.step)throw Error('Reference must be a later material step');
 const heldState=reconstruct(history,history.samples.map(s=>s.xyz)),advectedState=reconstruct(history,positions);
 const held=heldState.profiles,advected=advectedState.profiles;
 const fresh=reference.moments.map((ray,i)=>resolveDirectionalProfile(ray.map((v,c)=>c%4===3?history.tau[i][Math.floor(c/4)]:v)));
 const mae=(a,b)=>a.light.reduce((n,v,c)=>n+Math.abs(v-b.light[c]),0)/3;
 let coveredPoints=0,compared=0,holdError=0,warpError=0,missingEnergy=0,energy=0;
 for(let i=0;i<held.length;i++)for(let z=0;z<history.basis.sections;z++){
  const v=fresh[i][z],weight=v.light.reduce((s,x)=>s+Math.max(0,x),0);energy+=weight;
  if(!advected[i][z])missingEnergy+=weight;
  else{coveredPoints++;if(held[i][z]){compared++;holdError+=mae(held[i][z],v);warpError+=mae(advected[i][z],v);}}
 }
 return {identity:{...reference.identity},heldIdentity:history.identity,held,advected,fresh,support:advectedState.support,coveredPoints,
  totalPoints:held.length*history.basis.sections,compared,missingEnergyFraction:energy?missingEnergy/energy:null,error:compared?{held:holdError/compared,advected:warpError/compared}:null};
}

const sameObservation=(a,b)=>!!a&&!!b&&a.epoch===b.epoch&&a.step===b.step&&a.materialStamp===b.materialStamp&&a.frame===b.frame;
const fixedValues=(a,n)=>Array.isArray(a)&&a.length===n;
export function validateBundleReplay(tape){
 const {geometry:g,seed,stride,samples,frames}=tape??{};
 const w=g?.width,z=g?.sections,n=w*w;
 if(tape?.source!=='native-particle-bundle / same-material Fine velocity'||![w,z,stride].every(v=>Number.isSafeInteger(v)&&v>0)||
    stride%2!==1||w%stride||samples!==(w/stride)**2*z||!frames?.length||!seed?.identity||
    !Number.isSafeInteger(seed.identity.epoch)||!Number.isSafeInteger(seed.identity.step)||!Number.isSafeInteger(seed.identity.frame)||
    typeof seed.identity.materialStamp!=='string')throw Error('Incomplete or wrong-route native replay');
 const check=(r,id)=>{
  if(!sameObservation(r?.identity,id)||!sameObservation(r.heldIdentity,seed.identity)||r.totalPoints!==n*z)throw Error('Replay arm observation mismatch');
  for(const arm of ['held','advected','fresh']){
   if(!fixedValues(r[arm],n)||r[arm].some(ray=>!fixedValues(ray,z)||ray.some(point=>
      !(arm==='advected'&&point===null)&&(!fixedValues(point?.light,3)||!point.light.every(Number.isFinite)))))
    throw Error('Incomplete '+arm+' replay profile');
  }
  if(r.advected.flat().filter(Boolean).length!==r.coveredPoints)throw Error('Replay support count disagrees with its pixels');
 };
 let previous=seed.identity;
 const hasDense=frames.some(f=>f.dense!=null),hasSmoke=frames.some(f=>f.smoke!=null);
 for(const {reference,result,dense,smoke} of frames){
  const id=reference?.identity;
  if(!id||id.epoch!==seed.identity.epoch||id.materialStamp!==seed.identity.materialStamp||id.step!==previous.step+1||
     !sameObservation(reference.previous,previous)||geometry(reference)!==geometry(g)||
     !fixedValues(reference.positions,samples+(hasDense?n*z:0))||reference.positions.some(p=>p!==null&&(!fixedValues(p,3)||!p.every(Number.isFinite))))
   throw Error('Replay skipped or changed native material');
  check(result,id);if(hasDense)check(dense,id);
  if(hasSmoke)for(const arm of ['held','advected','fresh']){
   const entry=smoke?.[arm];
   if(!sameObservation(entry?.identity,id)||entry.mode!==arm||entry.observedStep!==id.step||entry.route!=='selected-beam-scattering-only')
    throw Error('Smoke capture does not match its observation and arm');
   if(!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(entry.src))throw Error('Incomplete smoke rendering');
  }
  previous=id;
 }
 return {hasDense,hasSmoke};
}
