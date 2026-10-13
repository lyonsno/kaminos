// Same given joint tree, two observed coordinate frames. Motion quaternions
// are canonical model-local rotations, never original-Bone pose deltas.
export function createGivenPaletteMotion({THREE,motion,rigFrame}) {
 const fail=message=>{throw Error(message);};
 const names=motion?.skeleton?.jointNames,parents=motion?.skeleton?.parents,n=names?.length,frames=motion?.frames,fps=motion?.skeleton?.fps;
 if(!Number.isInteger(n)||n<1||new Set(names).size!==n||motion.joints!==n||!Number.isInteger(frames)||frames<1||!Number.isFinite(fps)||fps<=0||parents?.length!==n)fail('Incomplete given motion hierarchy');
 const array=(value,length,label)=>{if(value?.length!==length||!Array.from(value).every(Number.isFinite))fail(`Incomplete/nonfinite ${label}`);return value;};
 array(motion.positions,frames*n*3,'world positions');array(motion.localRotations,frames*n*4,'local rotations');
 const matrix=(rows,label)=>{
  if(!Array.isArray(rows)||rows.length!==4||rows.some(r=>!Array.isArray(r)||r.length!==4||!r.every(Number.isFinite)))fail(`Invalid ${label} matrix`);
  const m=new THREE.Matrix4().set(...rows.flat());
  if(rows[3].some((v,i)=>Math.abs(v-(i===3?1:0))>1e-8))fail(`Invalid ${label} affine row`);return m;
 };
 const conversion=matrix(rigFrame?.canonicalWorldToSourceNormalized,'similarity');
 const basis=[0,1,2].map(i=>new THREE.Vector3().setFromMatrixColumn(conversion,i));
 const scale=basis.map(v=>v.length()),mean=scale.reduce((a,b)=>a+b,0)/3;
 if(!(mean>0)||conversion.determinant()<=0||scale.some(s=>Math.abs(s/mean-1)>1e-5)||basis.some((v,i)=>basis.some((w,j)=>i!==j&&Math.abs(v.dot(w)/(mean*mean))>1e-5)))fail('Frame conversion must be one positive similarity');
 const rotation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(conversion)).normalize(),inverseRotation=rotation.clone().invert();
 const specs=new Map((rigFrame.bones??[]).map(b=>[b.name,b]));
 if(specs.size!==n||rigFrame.bones.length!==n||names.some(name=>!specs.has(name)))fail('Given Bone inventory differs from motion');
 const roots=[];
 for(let j=0;j<n;j++){
  const p=parents[j];if(!Number.isInteger(p)||p< -1||p>=n||p===j||specs.get(names[j]).parent!==(p<0?null:names[p]))fail('Given Bone parent hierarchy differs from motion');
  if(p<0)roots.push(j);const seen=new Set();let k=j;while(k>=0){if(seen.has(k))fail('Cyclic given motion hierarchy');seen.add(k);k=parents[k];}
 }
 if(roots.length!==1)fail('Given motion requires one actor root');const root=roots[0];
 const rest=names.map(name=>matrix(specs.get(name).restMatrix,'rest Bone'));
 const restRotation=rest.map(m=>{const p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();m.decompose(p,q,s);if(s.toArray().some(v=>Math.abs(v-1)>1e-5))fail('Rest Bone scaling is not rigid');return q.normalize();});
 const inverseRest=rest.map(m=>m.clone().invert());
 function frame(index){
  if(!Number.isInteger(index)||index<0||index>=frames)throw RangeError('Source frame is outside retained motion');
  const global=new Array(n);
  function worldRotation(j){
   if(global[j])return global[j];const offset=(index*n+j)*4,[w,x,y,z]=motion.localRotations.slice(offset,offset+4);
   if(Math.abs(Math.hypot(w,x,y,z)-1)>1e-3)fail('Motion local rotation is not normalized');
   const q=new THREE.Quaternion(x,y,z,w).normalize();global[j]=parents[j]<0?q:worldRotation(parents[j]).clone().multiply(q).normalize();return global[j];
  }
  const world=names.map((name,j)=>{
   const p=new THREE.Vector3().fromArray(motion.positions,(index*n+j)*3).applyMatrix4(conversion);
   const q=rotation.clone().multiply(worldRotation(j)).multiply(inverseRotation).multiply(restRotation[j]).normalize();
   return new THREE.Matrix4().compose(p,q,new THREE.Vector3(1,1,1));
  });
  // Common root motion belongs to the actor, so even the fixed influence
  // channel travels. Bone deltas are factored relative to that same actor.
  const actor=world[root].clone().multiply(inverseRest[root]),inverseActor=actor.clone().invert();
  return {frame:index,time:index/fps,actorMatrix:actor.toArray(),bones:names.map((name,j)=>({
   name,parent:specs.get(name).parent,worldMatrix:world[j].toArray(),
   localMatrix:(parents[j]<0?inverseActor.clone():world[parents[j]].clone().invert()).multiply(world[j]).toArray(),
   skinMatrix:inverseActor.clone().multiply(world[j]).multiply(inverseRest[j]).toArray(),
  }))};
 }
 return Object.freeze({frames,fps,jointNames:Object.freeze([...names]),frame});
}
