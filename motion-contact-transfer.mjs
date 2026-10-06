// SOMA30 source contract observed in Kimodo public/fk_data.json@1de2276
// and kimodo/skeleton/definitions.py + motion_rep/feet.py@58e7818.
export const SOMA30_CONTACT_SCHEMA = Object.freeze({
  featureCount:369, start:365, order:['leftHeel','leftToe','rightHeel','rightToe'],
  mean:[.7292068129054087,.8033996942090557,.7291124812363573,.8036345263586678],
  std:[.44436948243297786,.3974275098100907,.44441812625242866,.39724812699742096],
});
const add=(a,b)=>a.map((x,i)=>x+b[i]);
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const mul=(a,k)=>a.map(x=>x*k);
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const norm=a=>Math.hypot(...a);
const unit=a=>mul(a,1/norm(a));
const finite=a=>Array.isArray(a)&&a.length===3&&a.every(Number.isFinite);

export function sourceBodyPose(joints) {
  const lateral=sub(joints[22],joints[26]);lateral[1]=0;
  if(norm(lateral)<1e-8)throw Error('Body pose needs bilateral hips');
  const x=unit(lateral),forward=[-x[2],0,x[0]],torso=sub(joints[3],joints[0]);
  return {yaw:Math.atan2(x[2],x[0]),lean:Math.atan2(dot(torso,forward),torso[1])};
}

export function solveTwoSegmentLimb(hip,goal,upper,lower,pole) {
  if(!finite(hip)||!finite(goal)||!finite(pole)||!(upper>0)||!(lower>0)||!Number.isFinite(upper+lower)) throw Error('Limb solve needs finite geometry');
  const delta=sub(goal,hip), requested=norm(delta);
  const direction=requested>1e-12?unit(delta):[0,-1,0];
  const reach=Math.max(Math.abs(upper-lower)+1e-12,Math.min(upper+lower,requested));
  let bend=sub(pole,mul(direction,dot(pole,direction)));
  if(norm(bend)<1e-10){const axis=Math.abs(direction[0])<.9?[1,0,0]:[0,0,1];bend=sub(axis,mul(direction,dot(axis,direction)));}
  bend=unit(bend);
  const along=(upper*upper-lower*lower+reach*reach)/(2*reach);
  const height=Math.sqrt(Math.max(0,upper*upper-along*along));
  return {knee:add(hip,add(mul(direction,along),mul(bend,height))),end:add(hip,mul(direction,reach)),reachError:Math.abs(requested-reach)};
}

export function projectBodyToLegReach(preferred,balls) {
  if(!finite(preferred)||!balls.length||balls.some(b=>!finite(b.center)||!(b.radius>0)||!Number.isFinite(b.radius)))throw Error('Body reach needs finite geometry');
  for(let i=0;i<balls.length;i++)for(let j=0;j<i;j++)if(norm(sub(balls[i].center,balls[j].center))>balls[i].radius+balls[j].radius)throw Error('Body/foot reach constraints are incompatible');
  let position=[...preferred],iterations=0,residual=Infinity;
  // Alternating convex projections. Bound numerical non-convergence, expose
  // residual, and fail rather than admitting a clipped foot as solved motion.
  while(residual>1e-9){
    for(const b of balls){const d=sub(position,b.center);if(norm(d)>b.radius)position=add(b.center,mul(unit(d),b.radius));}
    residual=Math.max(...balls.map(b=>Math.max(0,norm(sub(position,b.center))-b.radius)));
    if(++iterations>1024)throw Error(`Body reach projection did not converge: ${residual}`);
  }
  return {position,correction:norm(sub(position,preferred)),residual,iterations};
}

export function buildContactMotion(result, {quadruped=false}={}) {
  const joints=result?.joints,features=result?.motion;
  if(result?.numJoints!==30||!Array.isArray(joints)||joints.length<2||joints.some(f=>f.length!==30||f.some(p=>!finite(p)))) throw Error('Contact transfer requires complete SOMA30 joints');
  const parents=[-1,0,1,2,3,4,5,6,6,6,3,10,11,12,13,13,3,16,17,18,19,19,0,22,23,24,0,26,27,28];
  if(result.parents?.length!==30||parents.some((p,i)=>result.parents[i]!==p))throw Error('Contact transfer requires the SOMA30 hierarchy');
  if(!Array.isArray(features)||features.length!==joints.length||features.some(f=>f.length!==369||f.some(x=>!Number.isFinite(x)))) throw Error('Contact transfer requires complete normalized feature frames');
  if(!(result.fps>0)||!Number.isFinite(result.fps)) throw Error('Contact transfer requires positive FPS');
  const first=joints[0],origin=first[0];
  const toeDirection=quadruped?sub(first[3],first[0]):add(sub(first[25],first[24]),sub(first[29],first[28]));toeDirection[1]=0;
  if(norm(toeDirection)<1e-8) throw Error('Cannot establish donor foot facing');
  const forward=unit(toeDirection),lateral=[forward[2],0,-forward[0]];
  const local=p=>{const d=sub(p,origin);return [dot(d,lateral),p[1],dot(d,forward)];};
  const contacts=features.map(f=>SOMA30_CONTACT_SCHEMA.mean.map((m,i)=>f[365+i]*SOMA30_CONTACT_SCHEMA.std[i]+m>.5));
  const floorSamples=[];
  joints.forEach((f,i)=>{for(const [j,c] of [[25,1],[29,3]])if(contacts[i][c])floorSamples.push(f[j][1]);});
  if(!floorSamples.length) throw Error('Donor has no predicted toe support intervals');
  floorSamples.sort((a,b)=>a-b);
  const floor=floorSamples[Math.floor(floorSamples.length/2)];
  const frames=joints.map((f,i)=>({root:local(f[0]),joints:f.map(local),
    left:{contact:contacts[i][1],foot:local(f[25]),rawFoot:local(f[25]),ankle:local(f[24])},
    right:{contact:contacts[i][3],foot:local(f[29]),rawFoot:local(f[29]),ankle:local(f[28])}}));
  if(quadruped)for(const [side,joint] of [['frontLeft',13],['frontRight',19]])frames.forEach((f,i)=>{
    const next=Math.min(i+1,joints.length-1),previous=i===next?Math.max(0,i-1):i;
    const speed=norm(sub(joints[next][joint],joints[previous][joint]))*result.fps;
    f[side]={contact:joints[i][joint][1]<.10&&speed<.15,foot:local(joints[i][joint]),rawFoot:local(joints[i][joint])};
  });
  if(quadruped&&['frontLeft','frontRight'].some(side=>!frames.some(f=>f[side].contact)))throw Error('Quadruped donor needs both inferred wrist support intervals');
  const supportHeights={left:floor,right:floor};
  if(quadruped)for(const side of ['frontLeft','frontRight']){
    const heights=frames.filter(f=>f[side].contact).map(f=>f[side].rawFoot[1]).sort((a,b)=>a-b);
    supportHeights[side]=heights[Math.floor(heights.length/2)];
  }
  const intervals=[];
  for(const side of quadruped?['left','right','frontLeft','frontRight']:['left','right']){
    let anchor=null,start=-1;
    for(let i=0;i<frames.length;i++){
      const paw=frames[i][side];
      if(paw.contact){
        if(!anchor){anchor=[paw.foot[0],0,paw.foot[2]];start=i;}
        paw.foot=[...anchor];
      }else{
        if(anchor){intervals.push({side,start,end:i-1,anchor:[...anchor]});anchor=null;}
        paw.foot[1]=Math.max(0,paw.foot[1]-supportHeights[side]);
      }
    }
    if(anchor)intervals.push({side,start,end:frames.length-1,anchor:[...anchor]});
  }
  const legLength=[22,26].map(h=>norm(sub(first[h+1],first[h]))+norm(sub(first[h+2],first[h+1]))+norm(sub(first[h+3],first[h+2]))).reduce((a,b)=>a+b)/2;
  return {schema:'kaminos.soma30-contact-motion.v0',fps:result.fps,parents,frames,intervals,legLength,floor,supportHeights,forward,lateral,quadruped,orientationAuthority:quadruped?'pelvis-to-chest horizontal body facing':'average ankle-to-toe horizontal facing',frontHeightAuthority:quadruped?'each wrist median raw height across its inferred support samples; swing lift relative to that height, clamped only below support plane':null,frontContactAuthority:quadruped?'inferred wrist height <0.10m and speed <0.15m/s; proxy, not model labels':null,contactAuthority:'model-predicted-toe-contact; decoded schema; fixed interval anchors'};
}

export function sampleContactMotion(track,frame) {
  const f=Math.max(0,Math.min(track.frames.length-1,frame)),i=Math.floor(f),j=Math.min(i+1,track.frames.length-1),mix=f-i;
  const lerp=(a,b)=>a.map((v,k)=>v+(b[k]-v)*mix);
  const a=track.frames[i],b=track.frames[j];
  // Exact samples preserve model flags. Fractional contact/swing boundaries
  // are transition, rather than claiming a planted foot while interpolating.
  const paw=side=>({contact:mix===0?a[side].contact:a[side].contact&&b[side].contact,foot:lerp(a[side].foot,b[side].foot),rawFoot:lerp(a[side].rawFoot,b[side].rawFoot),...(a[side].ankle?{ankle:lerp(a[side].ankle,b[side].ankle)}:{})});
  return {frame:f,root:lerp(a.root,b.root),joints:a.joints.map((p,k)=>lerp(p,b.joints[k])),left:paw('left'),right:paw('right'),...(track.quadruped?{frontLeft:paw('frontLeft'),frontRight:paw('frontRight')}:{})};
}
