// A clip-derived transport estimate, not a foot-contact/terrain solver. Low,
// backward-moving toes supply stance-speed samples; the median rejects swing
// and isolated noisy samples without clipping the source or changing its pose.
const median=values=>{const sorted=[...values].sort((a,b)=>a-b),i=Math.floor(sorted.length/2);return sorted.length%2?sorted[i]:(sorted[i-1]+sorted[i])/2;};
export function deriveStanceTravel({poses,fps}){
 const names=poses[0].bones.map(b=>b.name),root=poses[0].bones.findIndex(b=>b.parent===null),head=names.indexOf('head');
 const feet=['hindlimb-left-toe','hindlimb-right-toe','forelimb-left-toe','forelimb-right-toe'];
 if(root<0||head<0||feet.some(name=>!names.includes(name)))throw Error('Stance travel requires head and all four named toe supports');
 const point=(i,j)=>poses[i].bones[j].worldMatrix.slice(12,15);
 const heading=poses.reduce((v,_,i)=>{const r=point(i,root),h=point(i,head);v[0]+=h[0]-r[0];v[1]+=h[2]-r[2];return v;},[0,0]);
 const length=Math.hypot(...heading);if(!(length>0))throw Error('Stance travel has no horizontal body heading');
 const forward=heading.map(v=>v/length),samples=[],supports=[];
 for(const name of feet){
  const j=names.indexOf(name),height=poses.map((_,i)=>point(i,j)[1]),low=median(height),speeds=[];
  for(let i=1;i<poses.length;i++){
   const a=point(i-1,j),b=point(i,j),ra=point(i-1,root),rb=point(i,root);
   const speed=-((b[0]-rb[0]-a[0]+ra[0])*forward[0]+(b[2]-rb[2]-a[2]+ra[2])*forward[1])*fps;
   if((a[1]+b[1])/2<=low&&speed>0)speeds.push(speed);
  }
  if(!speeds.length)throw Error(`Stance travel has no low backward samples for ${name}`);
  samples.push(...speeds);supports.push({name,samples:speeds.length,medianSpeed:median(speeds)});
 }
 const unitsPerSecond=median(samples);if(!Number.isFinite(unitsPerSecond)||unitsPerSecond<=0)throw Error('Stance travel has no finite positive speed');
 return Object.freeze({kind:'derived-low-foot-backward-speed',unitsPerSecond,forward,samples:samples.length,supports,contactSolver:false});
}
