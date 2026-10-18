// Reuse observed motion verbatim. Added source-rig joints have only fixed
// local rest offsets; this is not a learned motion on the extended skeleton.
export function extendRestDescendantMotion({THREE,adapter,sourceFrame,targetFrame}) {
 const fail=message=>{throw Error(message);};
 const matrix=rows=>{
  if(rows?.length!==4||rows.some(row=>row?.length!==4||!row.every(Number.isFinite)))fail('Invalid descendant rest matrix');
  return new THREE.Matrix4().set(...rows.flat());
 };
 const base=new Map((sourceFrame?.bones??[]).map(b=>[b.name,b]));
 const target=new Map((targetFrame?.bones??[]).map(b=>[b.name,b]));
 if(base.size!==adapter?.jointNames?.length||new Set(adapter.jointNames).size!==base.size||adapter.jointNames.some(n=>!base.has(n))||target.size!==targetFrame.bones.length)fail('Base motion/frame inventory differs');
 for(const [name,b] of base){
  const next=target.get(name);if(!next||next.parent!==b.parent)fail('Changed base parent or missing base joint');
  if(next.restMatrix?.flat().length!==16||next.restMatrix.flat().some((v,i)=>v!==b.restMatrix.flat()[i]))fail('Changed base rest matrix');
 }
 const extra=[],pending=[...target.values()].filter(b=>!base.has(b.name)),known=new Set(base.keys());
 while(pending.length){
  const index=pending.findIndex(b=>known.has(b.parent));if(index<0)fail('Unresolved or cyclic rest descendant');
  const b=pending.splice(index,1)[0],rest=matrix(b.restMatrix),parent=matrix(target.get(b.parent).restMatrix);
  extra.push({...b,local:parent.invert().multiply(rest),inverseRest:rest.clone().invert()});known.add(b.name);
 }
 const names=Object.freeze([...target.keys()]);
 return Object.freeze({frames:adapter.frames,fps:adapter.fps,jointNames:names,
  derivation:Object.freeze({kind:'retained-motion-with-fixed-rest-descendants',baseJoints:base.size,addedJoints:extra.length}),
  frame(index){
   if(!Number.isInteger(index)||index<0||index>=adapter.frames)throw RangeError('Source frame outside retained motion');
   const original=adapter.frame(index),bones=new Map(original.bones.map(b=>[b.name,b])),inverseActor=new THREE.Matrix4().fromArray(original.actorMatrix).invert();
   for(const b of extra){
    const parent=bones.get(b.parent);if(!parent)fail('Missing posed descendant parent');
    const world=new THREE.Matrix4().fromArray(parent.worldMatrix).multiply(b.local);
    bones.set(b.name,{name:b.name,parent:b.parent,worldMatrix:world.toArray(),localMatrix:b.local.toArray(),skinMatrix:inverseActor.clone().multiply(world).multiply(b.inverseRest).toArray()});
   }
   return {...original,bones:names.map(name=>bones.get(name))};
  }});
}
