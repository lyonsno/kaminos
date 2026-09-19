import { Vector3, Quaternion, Euler } from './lib/three.core.js';
const clone = value => structuredClone(value);
export function checkedPose(pose) {
  const result = {};
  for (const key of ['position','rotation','scale']) {
    if (!Array.isArray(pose?.[key]) || pose[key].length !== 3 || !pose[key].every(Number.isFinite)) throw new Error(`Pose ${key} requires three finite numbers`);
    result[key] = [...pose[key]];
  }
  return result;
}
export function createSceneEdits({read, write, changed = () => {}, admit = () => {}}) {
  let active = null, past = [], future = [];
  const state = () => ({active:active ? clone(active) : null,undoCount:past.length,redoCount:future.length});
  const get = id => {const pose=read(id);if(!pose)throw new Error(`Scene object "${id}" was not found`);return checkedPose(pose);};
  const notify = () => changed(state());
  function begin(id,label='Transform') {
    admit();
    if(active)throw new Error('A scene edit is already active');
    active={id,label,before:get(id)};notify();return state();
  }
  function preview(patch) {
    admit();
    if(!active)throw new Error('No scene edit is active');
    const pose=checkedPose({...get(active.id),...patch});write(active.id,pose);notify();return clone(pose);
  }
  function commit() {
    if(!active)return false;
    admit();
    const after=get(active.id),entry={...active,after};
    if(JSON.stringify(entry.before)!==JSON.stringify(after)){past.push(entry);future=[];}
    active=null;notify();return true;
  }
  function cancel() {
    if(!active)return false;
    get(active.id);write(active.id,clone(active.before));active=null;notify();return true;
  }
  function apply(id,patch,label='Transform') {
    admit();
    if(active)throw new Error('Finish the active scene edit first');
    const pose=checkedPose({...get(id),...patch});begin(id,label);preview(pose);commit();return clone(pose);
  }
  function replay(from,to,key) {
    admit();
    if(active)throw new Error('Finish the active scene edit first');
    const entry=from.at(-1);if(!entry)return false;
    get(entry.id);write(entry.id,clone(entry[key]));from.pop();to.push(entry);notify();return true;
  }
  return {begin,preview,commit,cancel,apply,state,undo:()=>replay(past,future,'before'),redo:()=>replay(future,past,'after'),
    clear(){if(active)cancel();past=[];future=[];notify();}};
}
export function axisVector(axis, frame='world', frameRotation=[0,0,0]) {
  const vector=new Vector3(...({x:[1,0,0],y:[0,1,0],z:[0,0,1]}[axis] || [0,0,1]));
  if(frame==='local')vector.applyQuaternion(new Quaternion().setFromEuler(new Euler(...frameRotation)));
  return vector;
}
// All poses are the authored transform of a registered scene root. Asset
// correction lives below that root and never enters these calculations.
export function transformPose(base, {operation, axis=null, plane=false, frame='world', frameRotation=base.rotation,
  amount=0, delta=[0,0,0], viewAxis=[0,0,1], snap=0}) {
  const pose=checkedPose(base);
  if(!Number.isFinite(amount))throw new Error('Transform amount must be finite');
  if(snap)amount=Math.round(amount/snap)*snap;
  const direction=axisVector(axis,frame,frameRotation);
  if(operation==='translate') {
    let move=new Vector3(...delta);
    if(axis && !plane)move=direction.multiplyScalar(amount);
    else if(axis && plane)move.addScaledVector(direction,-move.dot(direction));
    if(snap && (!axis || plane)) {
      const q=new Quaternion().setFromEuler(new Euler(...frameRotation));
      if(frame==='local')move.applyQuaternion(q.clone().invert());
      move.set(...move.toArray().map(v=>Math.round(v/snap)*snap));
      if(axis && plane)move[axis]=0;
      if(frame==='local')move.applyQuaternion(q);
    }
    pose.position=new Vector3(...base.position).add(move).toArray();
  } else if(operation==='rotate') {
    const around=axis ? direction : new Vector3(...viewAxis).normalize();
    const q=new Quaternion().setFromAxisAngle(around,amount).multiply(new Quaternion().setFromEuler(new Euler(...base.rotation)));
    const e=new Euler().setFromQuaternion(q);pose.rotation=[e.x,e.y,e.z];
  } else if(operation==='scale') {
    // Root TRS cannot encode global nonuniform scaling of a rotated object
    // without shear. Axis scale therefore explicitly uses the object's axes.
    const index={x:0,y:1,z:2}[axis];
    pose.scale=base.scale.map((v,i)=>!axis || (plane ? i!==index : i===index) ? v*amount : v);
  } else throw new Error(`Unknown transform operation: ${operation}`);
  return checkedPose(pose);
}
