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
