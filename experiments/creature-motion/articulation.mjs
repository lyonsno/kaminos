// Manual local rotations over a retained rest or held animation pose.
export function createCreatureArticulation({THREE,group,bones,caseSha256,update}) {
 if(!group?.isObject3D||!(bones instanceof Map)||!bones.size||typeof update!=='function'||!/^[a-f0-9]{64}$/.test(caseSha256??''))throw Error('Articulation requires the actual rig and binding identity');
 const names=[...bones.keys()],matrix=o=>{o.updateMatrix();return o.matrix.toArray();},capture=()=>({actor:matrix(group),bones:names.map(name=>({name,matrix:matrix(bones.get(name))}))});
 const validateMatrix=values=>{
  if(!Array.isArray(values)||values.length!==16||!values.every(Number.isFinite))throw Error('Pose matrix must contain sixteen finite values');
  const m=new THREE.Matrix4().fromArray(values),p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();m.decompose(p,q,s);
  const rigid=new THREE.Matrix4().compose(p,q,new THREE.Vector3(1,1,1));if(m.elements.some((v,i)=>Math.abs(v-rigid.elements[i])>1e-6))throw Error('Articulation requires rigid local poses');return {p,q,s};
 };
 const validate=(pose,rotations)=>{
  if(!Array.isArray(pose?.bones)||pose.bones.length!==names.length||new Set(pose.bones.map(b=>b.name)).size!==names.length||pose.bones.some(b=>!bones.has(b.name)))throw Error('Pose Bone inventory differs');
  validateMatrix(pose.actor);pose.bones.forEach(b=>validateMatrix(b.matrix));
  if(!rotations||Array.isArray(rotations)||typeof rotations!=='object'||Object.keys(rotations).some(n=>!bones.has(n))||Object.values(rotations).some(v=>!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite)))throw Error('Joint rotations require known Bones and three finite degrees');
 };
 const rest=capture();let base=structuredClone(rest),rotations={},label='Rest pose';
 function assign(o,values){const {p,q,s}=validateMatrix(values);o.position.copy(p);o.quaternion.copy(q);o.scale.copy(s);}
 function apply(){assign(group,base.actor);for(const b of base.bones){const bone=bones.get(b.name);assign(bone,b.matrix);const angles=rotations[b.name]??[0,0,0];bone.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...angles.map(x=>x*Math.PI/180),'XYZ')));}group.updateMatrixWorld(true);update();}
 function commit(nextBase,nextRotations,nextLabel){validate(nextBase,nextRotations);if(typeof nextLabel!=='string')throw Error('Pose label required');const before={base,rotations,label};base=structuredClone(nextBase);rotations=structuredClone(nextRotations);label=nextLabel;try{apply();}catch(e){({base,rotations,label}=before);apply();throw e;}return read();}
 function read(){return {base:label,rotations:structuredClone(rotations),joints:names.map(name=>({name,parent:bones.get(name).parent?.isBone?bones.get(name).parent.name:null,degrees:[...(rotations[name]??[0,0,0])]}))};}
 return Object.freeze({read,snapshot:()=>({schema:'kaminos.creature-articulation.v1',caseSha256,base:label,pose:structuredClone(base),rotations:structuredClone(rotations)}),
  rotate(name,degrees){return commit(base,{...rotations,[name]:degrees},label);},
  resetJoint(name){if(!bones.has(name))throw Error('Unknown Bone');const next={...rotations};delete next[name];return commit(base,next,label);},
  reset(){return commit(base,{},label);},neutral(){return commit(rest,{},'Rest pose');},
  captureBase(name){return commit(capture(),{},name);},setBase(pose,name){return commit(pose,{},name);},
  restore(snapshot){if(snapshot?.schema!=='kaminos.creature-articulation.v1'||snapshot.caseSha256!==caseSha256)throw Error('Pose belongs to another binding');return commit(snapshot.pose,snapshot.rotations,snapshot.base);},
 });
}
