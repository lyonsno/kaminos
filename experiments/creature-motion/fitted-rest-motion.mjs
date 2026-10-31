// A derived bind pose consumes the retained clip through explicit FK retargeting.
// Incoming-bone swing supplies a provisional local frame; axial twist is unobserved.
export function createFittedRestMotion({THREE,spec,names,parents,rest}) {
 const fail=()=>{throw Error('Invalid fitted-rest retarget specification');};
 if(spec?.schema!=='kaminos.fitted-rest-motion.v1'||spec.method!=='incoming-swing-local-deltas'||!Array.isArray(spec.jointNames)||JSON.stringify(spec.jointNames)!==JSON.stringify(names)||!/^[a-f0-9]{64}$/i.test(spec.fitSourceSha256??'')||spec.sourceRestPositions?.length!==names.length)fail();
 const source=spec.sourceRestPositions.map(p=>{if(p?.length!==3||!p.every(Number.isFinite))fail();return new THREE.Vector3().fromArray(p);});
 const target=rest.map(m=>{const p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();m.decompose(p,q,s);if(Math.abs(q.w)<1-1e-8)fail();return p;});
 const basis=names.map(()=>new THREE.Quaternion());
 for(let j=0;j<names.length;j++)if(parents[j]>=0){const p=parents[j],a=source[j].clone().sub(source[p]),b=target[j].clone().sub(target[p]);if(Math.min(a.length(),b.length())<1e-8)fail();basis[j].setFromUnitVectors(a.normalize(),b.normalize());}
 const inverse=basis.map(q=>q.clone().invert()),one=new THREE.Vector3(1,1,1);
 function frame(sourceWorld){
  const sourceP=sourceWorld.map(m=>new THREE.Vector3().setFromMatrixPosition(m));
  const sourceQ=sourceWorld.map(m=>new THREE.Quaternion().setFromRotationMatrix(m).normalize());
  // The supplied rest offsets must explain this actual retained source frame.
  for(let j=0;j<names.length;j++)if(parents[j]>=0){const p=parents[j],expected=source[j].clone().sub(source[p]).applyQuaternion(sourceQ[p]).add(sourceP[p]);if(expected.distanceTo(sourceP[j])>1e-4)throw Error('Fitted-rest source offsets disagree with retained motion');}
  const posedP=[],posedQ=[],world=[];
  function joint(j){
   if(world[j])return world[j];const p=parents[j];
   if(p<0){posedQ[j]=sourceQ[j].clone();posedP[j]=target[j].clone().sub(source[j]).applyQuaternion(sourceQ[j]).add(sourceP[j]);}
   else{
    joint(p);const local=sourceQ[p].clone().invert().multiply(sourceQ[j]);
    posedQ[j]=posedQ[p].clone().multiply(inverse[p]).multiply(basis[j]).multiply(local).normalize();
    posedP[j]=target[j].clone().sub(target[p]).applyQuaternion(inverse[p]).applyQuaternion(posedQ[p]).add(posedP[p]);
   }
   // Bind matrices remain translation-only. Publish the fitted-frame rotation delta.
   world[j]=new THREE.Matrix4().compose(posedP[j],posedQ[j].clone().multiply(inverse[j]).normalize(),one);return world[j];
  }
  names.forEach((_,j)=>joint(j));return world;
 }
 return Object.freeze({frame,identity:{route:'kaminos.fitted-rest-motion.v1',method:spec.method,fitSourceSha256:spec.fitSourceSha256,twist:'minimal incoming swing; unobserved'}});
}
