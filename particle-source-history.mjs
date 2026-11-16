import {resolveDirectionalProfile} from './particle-light-slice.mjs';

const sameFrame=(a,b)=>!!a&&!!b&&a.epoch===b.epoch&&a.step===b.step&&a.materialStamp===b.materialStamp;
const distance=(a,b)=>Math.hypot(...a.map((x,i)=>x-b[i]));
const sourceAt=(ray,z)=>ray.slice(z*4,z*4+3).reduce((n,v)=>n+Math.max(v,0),0);

// Compare two adjacent columns of one projected footprint. One illuminated
// interval on both paths nominates a shared source, but does not establish
// that each path observed exactly the same contributors.
export function sourceHistoryTarget(snapshot){
 if(snapshot?.source!=='flame'||snapshot.route!=='native-particle-bundle-ordered-deposition'||snapshot.width<3||snapshot.width%2!==1)return null;
 const {width,sections,moments,emitter,receiver,halfWidth}=snapshot,mid=Math.floor(width/2),donor=mid*(width+1);
 const neighbors=[donor+1,donor-1,donor+width,donor-width];
 let best=null;
 for(const ray of neighbors){
  let ta=1,tb=1;
  for(let section=sections-1;section>=0;section--){
   const a=moments[donor],b=moments[ray],opticalPower=(row,t)=>{
    const tau=row[section*4+3];
    return sourceAt(row,section)*t*(tau===0?1:-Math.expm1(-tau)/tau);
   };
   const signal=Math.min(opticalPower(a,ta),opticalPower(b,tb));
   if(signal>0&&signal>(best?.signal??0))best={section,receiver:ray,signal};
   ta*=Math.exp(-a[section*4+3]);tb*=Math.exp(-b[section*4+3]);
  }
 }
 if(!best)return null;
 const length=distance(emitter,receiver),fraction=(best.section+.5)/sections;
 return {...best,donor,point:emitter.map((x,i)=>x+(receiver[i]-x)*fraction),
  axis:emitter.map((x,i)=>(receiver[i]-x)/length),sectionWidth:length/sections,
  radius:Math.min(halfWidth,length/(2*sections))};
}

export function seedSourceHistory(snapshot,hit,target=sourceHistoryTarget(snapshot)){
 if(!target||!sameFrame(snapshot.identity,hit?.identity)||!(hit.sourcePower>0)||!(hit.birth>0)||
    distance(target.point,hit.point)>target.radius||
    ![target.donor,target.receiver].every(i=>sourceAt(snapshot.moments[i],target.section)>0))return null;
 return {snapshot,target,hit};
}

function depositSource(ray,originalSection,depth,scale){
 const values=Array.from(ray),source=values.slice(4*originalSection,4*originalSection+3);
 const lo=Math.floor(depth),hi=Math.ceil(depth),share=depth-lo;
 for(let c=0;c<3;c++){
  values[4*originalSection+c]-=source[c];
  values[4*lo+c]+=source[c]*scale*(1-share);
  values[4*hi+c]+=source[c]*scale*share;
 }
 return resolveDirectionalProfile(values);
}
function predictionFor(history,depth,scale){
 const {moments}=history.snapshot,{section,donor,receiver}=history.target;
 return moments.map((ray,i)=>i===donor||i===receiver?depositSource(ray,section,depth,scale):resolveDirectionalProfile(ray));
}

export function predictSourceHistory(history,hit){
 const invalid=(reason)=>({available:false,reason});
 if(!hit?.identity||hit.identity.epoch!==history.hit.identity.epoch||hit.birth!==history.hit.birth||hit.slot!==history.hit.slot)return invalid('Tracked source carrier ended');
 if(hit.identity.step<history.hit.identity.step)return invalid('Source observation predates the held paths');
 const {axis,section,sectionWidth,radius}=history.target,
       movement=hit.point.map((p,i)=>p-history.hit.point[i]),
       axial=movement.reduce((v,x,i)=>v+x*axis[i],0),
       transverse=Math.hypot(...movement.map((v,i)=>v-axial*axis[i]));
 const z=section+axial/sectionWidth,max=history.snapshot.sections-1;
 if(transverse>radius||z<-.5||z>max+.5)return invalid('Source moved outside the held crossing; sample again');
 const depth=Math.min(max,Math.max(0,z)),scale=hit.sourcePower/history.hit.sourcePower;
 if(!Number.isFinite(scale)||scale<0)return invalid('Invalid current source strength');
 return {available:true,identity:hit.identity,point:hit.point,scale,depth,profiles:predictionFor(history,depth,scale)};
}

export function scoreSourceHistory(history,prediction,reference){
 if(!prediction.available||!sameFrame(prediction.identity,reference.identity)||reference.key!==history.snapshot.key)return null;
 const {donor,receiver,section}=history.target;
 // A still has to observe the same source section before its aggregate
 // measurement can calibrate B. B's fresh light remains reference-only.
 const canCompareDonor=Math.round(prediction.depth)===section;
 const donorScale=canCompareDonor?sourceAt(reference.moments[donor],section)/sourceAt(history.snapshot.moments[donor],section):null;
 return {identity:reference.identity,held:resolveDirectionalProfile(history.snapshot.moments[receiver]).at(-1),
  predicted:prediction.profiles[receiver].at(-1),donorCorrected:donorScale===null?null:depositSource(history.snapshot.moments[receiver],section,prediction.depth,donorScale).at(-1),
  fresh:resolveDirectionalProfile(reference.moments[receiver]).at(-1)};
}
