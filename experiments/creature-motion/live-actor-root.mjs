// Keep the ordinary scene handle at the actual pelvis without baking travel
// into authored placement. Translation-only factoring preserves nonuniform
// authored scales: P A = (P D) (inverse(D) A), with D the pelvis translation.
export function createLiveActorRoot({THREE,placement,getGuide=()=>null}) {
 const authored=new THREE.Group(),offset=new THREE.Vector3();
 const assign=(root,matrix)=>matrix.decompose(root.position,root.quaternion,root.scale);
 const translation=v=>new THREE.Matrix4().makeTranslation(v.x,v.y,v.z);
 function sync(){placement.updateMatrix();assign(authored,placement.matrix.clone().multiply(translation(offset.clone().negate())));authored.updateMatrixWorld(true);return authored;}
 function guide(){const line=getGuide();if(line){line.position.copy(offset).negate();line.updateMatrix();}}
 function capture(){sync();return {authored:authored.matrix.toArray(),placement:placement.matrix.toArray(),offset:offset.toArray()};}
 function rollback(state){assign(authored,new THREE.Matrix4().fromArray(state.authored));assign(placement,new THREE.Matrix4().fromArray(state.placement));offset.fromArray(state.offset);guide();placement.updateMatrixWorld(true);}
 function apply(pose){
  sync();const root=pose.bones.find(b=>b.parent===null);if(!root)throw Error('Live actor root requires the actual root Bone');
  const actor=new THREE.Matrix4().fromArray(pose.actorMatrix);
  offset.setFromMatrixPosition(new THREE.Matrix4().fromArray(root.localMatrix)).applyMatrix4(actor);
  assign(placement,authored.matrix.clone().multiply(translation(offset)));guide();placement.updateMatrixWorld(true);
  return translation(offset.clone().negate()).multiply(actor).toArray();
 }
 return {apply,capture,rollback,sync,guide,read(){sync();return {position:authored.position.toArray(),quaternion:authored.quaternion.toArray(),scale:authored.scale.toArray()};}};
}
