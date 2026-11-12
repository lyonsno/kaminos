// No renderer, GPU device or inference scheduler is owned by this module.
const vector=(value,name)=>{if(!Array.isArray(value)||value.length!==3||!value.every(Number.isFinite))throw Error(`${name} requires three finite numbers`);return [...value];};
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const unit=(v,name)=>{const length=Math.hypot(...v);if(length<1e-12)throw Error(`${name} must have nonzero length`);return v.map(x=>x/length);};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function createParallaxPoses({center,normal,tangent,distance,distances=[distance],elevations,azimuths}){
 center=vector(center,'center');normal=unit(vector(normal,'normal'),'normal');tangent=vector(tangent,'tangent');tangent=unit(tangent.map((x,i)=>x-dot(tangent,normal)*normal[i]),'tangent');
 if(!Array.isArray(distances)||!distances.length||distances.some(x=>!Number.isFinite(x)||x<=0))throw Error('distances must be positive');
 if(!Array.isArray(elevations)||!elevations.length||elevations.some(x=>!Number.isFinite(x)||x<=0||x>90))throw Error('elevations must lie above the tangent plane through 90 degrees');
 if(!Array.isArray(azimuths)||!azimuths.length||azimuths.some(x=>!Number.isFinite(x)))throw Error('azimuths must be a nonempty finite list');
 const bitangent=cross(normal,tangent),poses=[];
 for(const distance of distances)for(const elevation of elevations)for(const azimuth of azimuths){
  const a=azimuth*Math.PI/180,e=elevation*Math.PI/180;
  const direction=normal.map((n,i)=>n*Math.sin(e)+(tangent[i]*Math.cos(a)+bitangent[i]*Math.sin(a))*Math.cos(e));
  // A fixed chart-up reference avoids arbitrary roll or a singular pole view.
  let up=bitangent.map((x,i)=>x-dot(bitangent,direction)*direction[i]);
  if(Math.hypot(...up)<1e-8)up=tangent.map((x,i)=>x-dot(tangent,direction)*direction[i]);
  poses.push({id:`pose-${poses.length}`,elevation,azimuth,distance,direction,view:{position:center.map((x,i)=>x+distance*direction[i]),target:[...center],up:unit(up,'up')}});
 }
 return poses;
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sameView=(a,b)=>['position','target','up'].every(k=>Array.isArray(a?.[k])&&Array.isArray(b?.[k])&&a[k].every((x,i)=>Math.abs(x-b[k][i])<=1e-6*Math.max(1,Math.abs(x))))&&['fov','zoom','near','far'].every(k=>b[k]===undefined||a[k]===b[k]);
export async function captureParallaxMatrix({poses,variants,adapter}){
 const report={schema:'kaminos.parallax-matrix.v1',status:'running',phase:'initial',captures:[]};let initial,primary;
 try{
  await adapter.persist(structuredClone(report));
  if(!Array.isArray(poses)||!poses.length||!Array.isArray(variants)||!variants.length)throw Error('poses and variants must be nonempty');
  initial=structuredClone(await adapter.read());
  if(!initial.identity||!initial.lighting||!initial.view||typeof initial.variant!=='string')throw Error('Host must expose identity, lighting, view and variant');
  report.initial=initial;
  for(const pose of poses){
   report.phase=`${pose.id}:view`;await adapter.setView({...initial.view,...pose.view});
   for(const variant of variants){
    report.phase=`${pose.id}:${variant}`;await adapter.setVariant(variant);
    const before=structuredClone(await adapter.read());report.lastObservation={requestedView:{...initial.view,...pose.view},state:before};
    const validate=state=>{
     if(!sameView(state.view,{...initial.view,...pose.view}))throw Error('Host view differs from requested pose');
     if(state.variant!==variant||state.effective!==variant)throw Error(`Requested ${variant}, effective ${state.effective}`);
     if(!same(state.identity,initial.identity))throw Error('Material/backend identity changed during matrix');
     if(!same(state.lighting,initial.lighting))throw Error('Host lighting changed during fixed-light matrix');
    };validate(before);
    const artifact=await adapter.capture({pose,variant,state:before});
    if(!artifact?.file||!(artifact.width>0)||!(artifact.height>0)||!(artifact.bytes>0))throw Error('Missing or empty capture');
    const after=structuredClone(await adapter.read());validate(after);
    report.captures.push({pose:structuredClone(pose),variant,state:after,artifact});await adapter.persist(structuredClone(report));
   }
  }
  report.status='complete';report.phase='complete';
 }catch(error){primary=error;report.status='failed';report.error=String(error.stack??error);}
 finally{
  if(initial)try{await adapter.setView(initial.view);await adapter.setVariant(initial.variant);}catch(error){report.restoreError=String(error.stack??error);report.status='failed';primary??=error;}
  await adapter.persist(structuredClone(report));
 }
 if(primary)throw primary;return report;
}
