import {Matrix4,Vector3,Quaternion,Euler,Group,Mesh} from './lib/three.core.js';
import {checkedPose} from './scene-edit-session.mjs';
export const REPETITION_SCHEMA='kaminos.repetition.v1';
export const repetitionDefaults=()=>({schema:REPETITION_SCHEMA,mode:'none',count:6,axis:'y',angle:360,step:[1,0,0],space:'world',center:[0,0,0],mirror:[false,false,false]});
export function checkedRepetition(raw){
 if(raw==null)return null;
 if(typeof raw!=='object'||Array.isArray(raw))throw Error('Repetition settings must be an object');
 const value={...repetitionDefaults(),...structuredClone(raw)};
 if(value.schema!==REPETITION_SCHEMA)throw Error('Unknown repetition schema');
 if(!['none','line','circle'].includes(value.mode)||!['x','y','z'].includes(value.axis)||!['world','local'].includes(value.space))throw Error('Invalid repetition arrangement or axes');
 if(!Number.isSafeInteger(value.count)||value.count<1)throw Error('Repetition count must be a positive whole number');
 if(!Number.isFinite(value.angle))throw Error('Repetition angle must be finite');
 for(const key of ['step','center'])if(!Array.isArray(value[key])||value[key].length!==3||!value[key].every(v=>typeof v==='number'&&Number.isFinite(v)))throw Error(`Repetition ${key} requires three finite numbers`);
 if(!Array.isArray(value.mirror)||value.mirror.length!==3||!value.mirror.every(v=>typeof v==='boolean'))throw Error('Mirror axes require three booleans');
 return value;
}
export function repetitionCount(raw){const s=checkedRepetition(raw);return s?(s.mode==='none'?1:s.count)*2**s.mirror.filter(Boolean).length:1;}
export function repetitionMatrices(raw,rawFrame){
 const s=checkedRepetition(raw);if(!s)return [new Matrix4()];
 const frame=checkedPose(rawFrame),local=s.space==='local',q=local?new Quaternion().setFromEuler(new Euler(...frame.rotation)):new Quaternion();
 const center=new Vector3(...s.center);if(local)center.multiply(new Vector3(...frame.scale)).applyQuaternion(q).add(new Vector3(...frame.position));
 const basis=new Matrix4().compose(center,q,new Vector3(1,1,1)),inverse=basis.clone().invert();
 let mirrors=[new Matrix4()];for(let axis=0;axis<3;axis++)if(s.mirror[axis]){const scale=[1,1,1];scale[axis]=-1;const flip=basis.clone().multiply(new Matrix4().makeScale(...scale)).multiply(inverse);mirrors.push(...mirrors.map(m=>flip.clone().multiply(m)));}
 const count=s.mode==='none'?1:s.count,axis=new Vector3(...({x:[1,0,0],y:[0,1,0],z:[0,0,1]}[s.axis])).applyQuaternion(q),step=new Vector3(...s.step);
 if(local)step.multiply(new Vector3(...frame.scale)).applyQuaternion(q);
 const result=[];
 for(let i=0;i<count;i++){
  let array=new Matrix4();
  if(s.mode==='line')array.makeTranslation(...step.clone().multiplyScalar(i).toArray());
  if(s.mode==='circle'&&i){const closed=Math.abs(s.angle)%360===0&&s.angle!==0,angle=s.angle*Math.PI/180*i/(closed?count:Math.max(1,count-1));array.makeTranslation(...center.toArray()).multiply(new Matrix4().makeRotationAxis(axis,angle)).multiply(new Matrix4().makeTranslation(...center.clone().negate().toArray()));}
  for(const mirror of mirrors)result.push(array.clone().multiply(mirror));
 }
 return result;
}
export const isRepetitionCopy=node=>node?.userData?.kaminosRepetitionCopy===true;
export function withoutRepetitionCopies(root,fn){
 const copies=root.children.filter(isRepetitionCopy);for(const copy of copies)root.remove(copy);
 try{return fn();}finally{root.add(...copies);}
}
function cloneBorrowed(node){
 if(node.isSkinnedMesh||node.isInstancedMesh||node.morphTargetInfluences?.length)throw Error('Repetition requires a static mesh');
 const copy=node.isMesh?new Mesh(node.geometry,node.material):new Group();
 copy.name=node.name;copy.position.copy(node.position);copy.quaternion.copy(node.quaternion);copy.scale.copy(node.scale);copy.matrix.copy(node.matrix);copy.matrixAutoUpdate=node.matrixAutoUpdate;copy.visible=node.visible;copy.layers.mask=node.layers.mask;copy.castShadow=node.castShadow;copy.receiveShadow=node.receiveShadow;copy.renderOrder=node.renderOrder;copy.frustumCulled=node.frustumCulled;
 for(const child of node.children)if(!isRepetitionCopy(child)&&!child.userData.kaminosEditorHelper&&!child.userData.kaminosEditorOnly)copy.add(cloneBorrowed(child));
 return copy;
}
export function createRepetitionView(){
 const states=new WeakMap();
 function clear(root){for(const copy of root.children.filter(isRepetitionCopy))root.remove(copy);states.delete(root);}
 function sync(root,settings,frame,{outer=[new Matrix4()]}={}){
  const own=repetitionMatrices(settings,frame),matrices=outer.flatMap(group=>own.map(m=>group.clone().multiply(m))),count=matrices.length-1;
  if(!count){clear(root);return 0;}
  const signature=[];function inspect(node){if(isRepetitionCopy(node))return;signature.push(node.uuid,node.geometry?.uuid,Array.isArray(node.material)?node.material.map(m=>m.uuid):node.material?.uuid,...node.children.filter(n=>!isRepetitionCopy(n)).map(n=>n.uuid));for(const child of node.children)if(!isRepetitionCopy(child))inspect(child);}inspect(root);
  const key=JSON.stringify(signature);let state=states.get(root);
  if(!state||state.key!==key){clear(root);state={key,copies:[]};states.set(root,state);}
  while(state.copies.length>count)state.copies.pop().removeFromParent();
  while(state.copies.length<count){const copy=cloneBorrowed(root);copy.userData.kaminosRepetitionCopy=true;copy.matrixAutoUpdate=false;copy.name=`${root.name||'Object'} repetition ${state.copies.length+1}`;state.copies.push(copy);root.add(copy);}
  root.updateWorldMatrix(true,false);const world=root.matrixWorld.clone(),inverse=world.clone().invert();
  for(let i=0;i<count;i++){const copy=state.copies[i];copy.matrix.copy(inverse).multiply(matrices[i+1]).multiply(world);copy.matrixWorldNeedsUpdate=true;}
  return count;
 }
 return {sync,clear};
}
