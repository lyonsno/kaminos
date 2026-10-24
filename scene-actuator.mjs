// A length drive between a grounded body and one hinged follower. No force solver.
import {Vector3,Quaternion,Euler,Matrix4} from './lib/three.core.js';
import {checkedPose} from './scene-edit-session.mjs';
const copy=value=>structuredClone(value), V=a=>new Vector3(...a);
const vector=(a,name)=>{if(!Array.isArray(a)||a.length!==3||!a.every(Number.isFinite))throw Error(`${name} needs three finite coordinates`);return [...a];};
const positive=(n,name)=>{if(!Number.isFinite(n)||n<=0)throw Error(`${name} must be positive`);return n;};
const matrix=p=>new Matrix4().compose(V(p.position),new Quaternion().setFromEuler(new Euler(...p.rotation)),V(p.scale));
function poseOf(m){
 const p=new Vector3(),q=new Quaternion(),s=new Vector3();m.decompose(p,q,s);
 const check=new Matrix4().compose(p,q,s),extent=Math.max(1,...m.elements.map(Math.abs));
 if(m.elements.some((v,i)=>Math.abs(v-check.elements[i])>1e-8*extent))throw Error('Actuator pose would introduce shear');
 const e=new Euler().setFromQuaternion(q);return {position:p.toArray(),rotation:[e.x,e.y,e.z],scale:s.toArray()};
}
function uniform(p){if(p.scale.some(s=>!(s>0)||Math.abs(s-p.scale[0])>1e-8*Math.max(...p.scale)))throw Error('Actuator base needs positive uniform scale');return p;}
function geometry(r){
 const n=V(r.axis).normalize(),a=V(r.baseMount).sub(V(r.hinge)),v=V(r.movingMount).sub(V(r.hinge));
 const ap=a.dot(n),vp=v.dot(n),av=a.clone().addScaledVector(n,-ap),vv=v.clone().addScaledVector(n,-vp);
 const A=av.dot(vv),B=av.dot(n.clone().cross(vv)),radius=Math.hypot(A,B);
 if(radius<1e-10*Math.max(a.lengthSq(),v.lengthSq(),1))throw Error('Mounts must have leverage about the hinge');
 const constant=a.lengthSq()+v.lengthSq()-2*ap*vp,phase=Math.atan2(B,A);
 if(Math.abs(B)<1e-10*radius)throw Error('Install away from the straight-line toggle position');
 return {n,A,B,radius,constant,phase,branch:B>0?-1:1,min:Math.sqrt(Math.max(0,constant-2*radius)),max:Math.sqrt(Math.max(0,constant+2*radius))};
}
export function checkedActuator(raw){
 if(!raw||typeof raw!=='object')throw Error('Actuator recipe is required');
 const r={id:raw.id,label:raw.label||'Piston',fixedId:raw.fixedId,followerId:raw.followerId,barrelId:raw.barrelId,rodId:raw.rodId};
 for(const key of ['id','label','fixedId','followerId','barrelId','rodId'])if(typeof r[key]!=='string'||!r[key].trim())throw Error(`Actuator ${key} is required`);
 if(new Set([r.fixedId,r.followerId,r.barrelId,r.rodId]).size!==4)throw Error('Base, boom, barrel and rod must be distinct objects');
 for(const k of ['baseMount','movingMount','hinge','axis'])r[k]=vector(raw[k],k);
 if(V(r.axis).length()<1e-10)throw Error('Hinge axis must be nonzero');r.axis=V(r.axis).normalize().toArray();
 r.carried=raw.carried===undefined?[]:copy(raw.carried);if(!Array.isArray(r.carried)||!r.carried.every(id=>typeof id==='string'&&id))throw Error('Carried objects must be IDs');
 const ids=[r.fixedId,r.followerId,r.barrelId,r.rodId,...r.carried];if(new Set(ids).size!==ids.length)throw Error('Actuator roles cannot overlap');
 r.reference={};for(const id of ids)r.reference[id]=checkedPose(raw.reference?.[id]);uniform(r.reference[r.fixedId]);
 r.length=positive(raw.length,'Length');
 r.drive={min:positive(raw.drive?.min,'Short length'),max:positive(raw.drive?.max,'Long length'),period:positive(raw.drive?.period,'Period'),outward:raw.drive?.outward??0.5};
 if(r.drive.min>=r.drive.max)throw Error('Long length must exceed short length');
 if(!Number.isFinite(r.drive.outward)||r.drive.outward<=0||r.drive.outward>=1)throw Error('Outward fraction must lie between zero and one');
 const g=geometry(r),eps=1e-8*Math.max(1,g.max);
 if(r.length<g.min-eps||r.length>g.max+eps||r.drive.min<g.min-eps||r.drive.max>g.max+eps)throw Error(`Length exceeds hinge reach (${g.min.toPrecision(4)}–${g.max.toPrecision(4)})`);
 return r;
}
export function checkedActuators(raw=[]){
 if(!Array.isArray(raw))throw Error('Actuators must be a list');
 const rows=raw.map(checkedActuator),ids=new Set(),driven=new Set();
 for(const r of rows){if(ids.has(r.id))throw Error('Duplicate actuator ID');ids.add(r.id);for(const id of [r.followerId,r.barrelId,r.rodId,...r.carried]){if(driven.has(id))throw Error('Object is already driven by another actuator');driven.add(id);}}
 // First slice: independent mechanisms, not coupled chains/cycles.
 for(const r of rows)if(driven.has(r.fixedId))throw Error('Actuator bases must not be driven by another actuator');
 return rows;
}
export function actuatorReach(raw){const r=checkedActuator(raw),g=geometry(r);return {min:g.min,max:g.max,rest:V(r.movingMount).distanceTo(V(r.baseMount))};}
export function prepareActuator(raw){
 const r=copy(raw);for(const k of ['baseMount','movingMount','hinge','axis'])r[k]=vector(r[k],k);
 const g=geometry(r),rest=V(r.baseMount).distanceTo(V(r.movingMount));
 const excursion=Math.min(rest-g.min,g.max-rest)*0.45;
 return checkedActuator({...r,length:r.length??rest,drive:{min:rest-excursion,max:rest+excursion,period:2,outward:.5,...r.drive}});
}
export function solveActuator(raw,length=raw.length,fixedPose=raw.reference?.[raw.fixedId]){
 const r=checkedActuator({...raw,length}),g=geometry(r);
 const cosine=(g.constant-length*length)/(2*g.radius);
 const angle=g.phase+g.branch*Math.acos(Math.max(-1,Math.min(1,cosine)));
 const delta=matrix(uniform(checkedPose(fixedPose))).multiply(matrix(r.reference[r.fixedId]).invert());
 const rotate=new Matrix4().makeTranslation(...r.hinge).multiply(new Matrix4().makeRotationAxis(g.n,angle)).multiply(new Matrix4().makeTranslation(...r.hinge.map(v=>-v)));
 const moving=V(r.movingMount).applyMatrix4(rotate),base=V(r.baseMount);
 const axis=V(r.movingMount).sub(base).normalize(),direction=moving.clone().sub(base).normalize();
 const q=new Quaternion().setFromUnitVectors(axis,direction),rotation=new Matrix4().makeRotationFromQuaternion(q);
 const around=(from,to)=>new Matrix4().makeTranslation(...to.toArray()).multiply(rotation).multiply(new Matrix4().makeTranslation(...from.toArray().map(v=>-v)));
 const poses={};for(const id of [r.followerId,...r.carried])poses[id]=poseOf(delta.clone().multiply(rotate).multiply(matrix(r.reference[id])));
 poses[r.barrelId]=poseOf(delta.clone().multiply(around(base,base)).multiply(matrix(r.reference[r.barrelId])));
 poses[r.rodId]=poseOf(delta.clone().multiply(around(V(r.movingMount),moving)).multiply(matrix(r.reference[r.rodId])));
 return {poses,angle,length,base:base.applyMatrix4(delta).toArray(),end:moving.applyMatrix4(delta).toArray()};
}
export function driveLength(raw,seconds){
 const r=checkedActuator(raw);if(!Number.isFinite(seconds))throw Error('Drive time must be finite');
 const phase=((seconds/r.drive.period)%1+1)%1,part=phase<r.drive.outward?phase/r.drive.outward:1-(phase-r.drive.outward)/(1-r.drive.outward);
 const ease=part*part*(3-2*part);return r.drive.min+(r.drive.max-r.drive.min)*ease;
}

// The accepted recipe is the shared history target. Per-frame output is derived,
// not a separate animation ledger or an edit on every frame.
export function createActuatorController({edits,readPose,writePoses,validatePoses=()=>{},changed=()=>{},admit=()=>{}}){
 let recipes=[],running=null,elapsed=0,error=null,lastLength=null;
 const read=()=>copy(recipes),find=id=>{const r=recipes.find(r=>r.id===id);if(!r)throw Error('Choose an installed actuator');return r;};
 const available=r=>[r.fixedId,r.followerId,r.barrelId,r.rodId,...r.carried].every(id=>readPose(id));
 const present=(r,length=r.length)=>{if(!available(r))throw Error('Actuator attachment is missing; restore it or detach the actuator');const result=solveActuator(r,length,readPose(r.fixedId));writePoses(result.poses);return result;};
 const stage=(rows,required=[])=>{
  const outputs={};
  for(const r of rows){
   try{if(!available(r))throw Error('Actuator attachment is missing');const solved=solveActuator(r,r.length,readPose(r.fixedId));validatePoses(solved.poses);Object.assign(outputs,solved.poses);}
   catch(e){if(required.includes(r.id))throw e;}
  }
  validatePoses(outputs);return outputs;
 };
 const restore=value=>{const next=checkedActuators(value.actuators),outputs=stage(next);writePoses(outputs);recipes=next;running=null;error=null;changed();};
 edits.register('@actuators',{read:()=>({actuators:read()}),check:v=>({actuators:checkedActuators(v.actuators)}),write:restore});
 const apply=(next,label,required=[])=>{
  admit();if(running&&!required.includes(running))next=next.map(r=>r.id===running?{...r,length:lastLength}:r);
  const checked=checkedActuators(next);stage(checked,required);
  return edits.apply('@actuators',{actuators:checked},label);
 };
 const configuration=(id,patch)=>{find(id);return recipes.map(r=>r.id===id?{...r,...(running===id?{length:lastLength}:{}),...patch,drive:{...r.drive,...patch.drive}}:r);};
 const scrubConfiguration=(id,patch)=>{
  admit();const next=checkedActuators(configuration(id,patch).map(r=>r.id===running&&r.id!==id?{...r,length:lastLength}:r));stage(next,[id]);stop();
  if(!edits.state().active)edits.begin('@actuators','Adjust piston');
  if(edits.state().active.id!=='@actuators')throw Error('Finish the current edit');
  edits.preview({actuators:next});
 };
 const acceptLive=()=>{const id=running;if(!id)return;recipes=recipes.map(r=>r.id===id?{...r,length:lastLength}:r);running=null;};
 const stop=()=>{if(!running)return;const id=running;apply(recipes.map(r=>r.id===id?{...r,length:lastLength}:r),'Stop piston',[id]);};
 let previousHistory=edits.state();
 edits.subscribe(state=>{
  const previous=previousHistory;previousHistory=state;
  if(!running||state.active?.id==='@actuators')return;
  if(state.active&&!previous.active){
   const before={actuators:read()};acceptLive();
   // recordApplied explicitly permits a distinct active target: stopping becomes
   // the entry immediately before that ordinary edit, not a nested gesture.
   edits.recordApplied('@actuators',before,{actuators:read()},'Stop piston before edit');changed();
  }else if(state.replaying||state.undoCount!==previous.undoCount||state.redoCount!==previous.redoCount){
   // Undo/Redo owns its ledger movement; stopping playback must not erase Redo.
   acceptLive();changed();
  }
 });
 return {
  read,restore:rows=>restore({actuators:rows}),clear(){running=null;if(edits.state().active?.id==='@actuators')edits.cancel();recipes=[];error=null;changed();},
  install(raw){const r=checkedActuator(raw);apply([...recipes,r],'Install piston',[r.id]);return copy(r);},
  configure(id,patch){apply(configuration(id,patch),'Adjust piston',[id]);return copy(find(id));},
  scrubConfiguration,
  scrub(id,length){scrubConfiguration(id,{length});},
  finishScrub(){if(edits.state().active?.id==='@actuators')edits.commit();},
  cancelScrub(){if(edits.state().active?.id==='@actuators')edits.cancel();},
  detach(id){find(id);apply(recipes.filter(r=>r.id!==id),'Detach piston');},
  play(id){admit();if(edits.state().active||edits.state().replaying)throw Error('Finish the current scene edit');const r=find(id);stage([r],[id]);if(running===id)return;stop();present(r);running=id;lastLength=r.length;const fraction=Math.max(0,Math.min(1,(r.length-r.drive.min)/(r.drive.max-r.drive.min)));elapsed=(.5-Math.sin(Math.asin(1-2*fraction)/3))*r.drive.outward*r.drive.period;error=null;changed();},
  pause:stop,
  tick(dt){if(!running)return;try{admit();if(!Number.isFinite(dt)||dt<0)throw Error('Invalid actuator frame delta');const nextTime=elapsed+dt,nextLength=driveLength(find(running),nextTime);present(find(running),nextLength);elapsed=nextTime;lastLength=nextLength;changed();}catch(e){acceptLive();error=e.message;changed();}},
  state(){return {running,error,actuators:recipes.map(r=>({id:r.id,label:r.label,available:available(r),length:running===r.id?driveLength(r,elapsed):r.length,reach:actuatorReach(r)}))};},
 };
}
