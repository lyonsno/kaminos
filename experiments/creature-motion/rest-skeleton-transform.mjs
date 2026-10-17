import {Vector3,Matrix4,Quaternion,Euler} from '../../lib/three.core.js';
import {checkedPose} from '../../scene-edit-session.mjs';
import {validateRestPlan,restHeads,withRestHeads} from './rest-skeleton-edit.mjs';

const matrix=value=>{if(!Array.isArray(value)||value.length!==16||!value.every(Number.isFinite))throw Error('Explicit finite skeleton frame required');const m=new Matrix4().fromArray(value);if(Math.abs(m.determinant())<1e-12||m.elements[3]||m.elements[7]||m.elements[11]||m.elements[15]!==1)throw Error('Invertible affine skeleton frame required');return m;};
const poseMatrix=p=>{p=checkedPose(p);if(p.scale.some(v=>Math.abs(v)<1e-10))throw Error('A component transform cannot collapse its axes');return new Matrix4().compose(new Vector3(...p.position),new Quaternion().setFromEuler(new Euler(...p.rotation)),new Vector3(...p.scale));};
const partner=name=>name.includes('-left-')?name.replace('-left-','-right-'):name.includes('-right-')?name.replace('-right-','-left-'):null;
function selection(plan,options){
 const names=new Set(plan.joints.map(j=>j.name)),chosen=options.selected;
 if(!Array.isArray(chosen)||!chosen.length||new Set(chosen).size!==chosen.length||chosen.some(name=>!names.has(name))||!chosen.includes(options.active))throw Error('Choose existing rest-joint components');
 if(typeof options.mirror!=='boolean'||typeof options.descendants!=='boolean')throw Error('Explicit symmetry and branch options required');
 return chosen;
}
export function captureRestTransform(plan,options){
 plan=validateRestPlan(plan);const selected=selection(plan,options),frame=matrix(options.localToWorld),heads=restHeads(plan);
 const pivot=options.pivot??'median';if(!['median','active','individual'].includes(pivot))throw Error('Unknown component pivot');
 const center=new Vector3();for(const name of selected)center.add(new Vector3(...heads[name]).applyMatrix4(frame));center.multiplyScalar(1/selected.length);
 if(pivot==='active')center.fromArray(heads[options.active]).applyMatrix4(frame);
 const anchor=checkedPose({position:center.toArray(),rotation:options.rotation??[0,0,0],scale:[1,1,1]});
 return {...structuredClone(options),pivot,heads,anchor,...structuredClone(anchor)};
}
export function applyRestTransform(plan,state){
 plan=validateRestPlan(plan);const chosen=selection(plan,state),frame=matrix(state.localToWorld),inverse=frame.clone().invert(),anchor=poseMatrix(state.anchor),delta=poseMatrix(state).multiply(anchor.invert());
 const original=restHeads(withRestHeads(plan,state.heads)),heads=structuredClone(original),by=new Map(plan.joints.map(j=>[j.name,j]));
 const affected=new Set(chosen);if(state.descendants)for(const j of plan.joints){for(let p=j.parent;p;p=by.get(p).parent)if(affected.has(p)){affected.add(j.name);break;}}
 const identity=new Matrix4();if(delta.elements.every((v,i)=>Math.abs(v-identity.elements[i])<1e-12))return withRestHeads(plan,heads);
 if(!['median','active','individual'].includes(state.pivot??'median'))throw Error('Unknown component pivot');
 const linear=delta.clone();linear.elements[12]=linear.elements[13]=linear.elements[14]=0;
 const translation=new Vector3(...state.position).sub(new Vector3(...state.anchor.position));
 // Symmetry belongs to the source skeleton, even when its scene object is
 // rotated, offset or scaled. A central handle cannot translate its branch
 // sideways and thereby widen the paired limbs it owns.
 const localTranslation=translation.clone().applyMatrix4(inverse).sub(new Vector3().applyMatrix4(inverse));
 const lateral=new Vector3(localTranslation.x,0,0).applyMatrix4(frame).sub(new Vector3().applyMatrix4(frame));
 const translationOnly=linear.elements.every((v,i)=>Math.abs(v-identity.elements[i])<1e-12);
 const preferred=[state.active,...chosen].find(name=>partner(name)),side=preferred?.includes('-left-')?'left':'right';
 for(const name of affected){
  const pair=partner(name);if(state.mirror&&pair&&affected.has(pair)&&!name.includes('-'+side+'-'))continue;
  let owner=name;while(!chosen.includes(owner))owner=by.get(owner).parent;
  const centralOwner=state.mirror&&!partner(owner);
  const point=new Vector3(...original[name]).applyMatrix4(frame);
  if(state.pivot==='individual'){
   // Each chosen joint owns its branch; a chosen descendant starts its own pivot.
   let origin=name;while(!chosen.includes(origin))origin=by.get(origin).parent;
   const pivot=new Vector3(...original[origin]).applyMatrix4(frame);point.sub(pivot).applyMatrix4(linear).add(pivot).add(translation);
  }else point.applyMatrix4(delta);
  if(centralOwner)point.sub(lateral);
  // A pivot origin is mathematically unchanged by rotation/scale. Keep its
  // source bytes instead of manufacturing an anatomy edit from frame roundoff.
  const fixedOrigin=(state.pivot==='active'&&name===state.active)||(state.pivot==='individual'&&chosen.includes(name));
  const unchanged=centralOwner&&translationOnly&&translation.clone().sub(lateral).lengthSq()<1e-24;
  const next=unchanged||fixedOrigin&&translation.lengthSq()===0?[...original[name]]:point.applyMatrix4(inverse).toArray();
  // Preserve the current axial coordinate, including inherited source offsets;
  // toggling symmetry is not permission to snap the authored rig to x=0.
  if(state.mirror&&!pair)next[0]=original[name][0];
  heads[name]=next;
  if(state.mirror&&pair){if(!original[pair])throw Error('Mirrored component missing: '+pair);heads[pair]=original[pair].map((v,k)=>v+(k===0?-1:1)*(next[k]-original[name][k]));}
 }
 return withRestHeads(plan,heads);
}
