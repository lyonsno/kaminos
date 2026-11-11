// Re-seat the three existing analytical examples on visible receiver blocks.
// The caller opens its source scene and owns the saved output via retain().
export default async function ({page,retain,inputs={}}){
 const assembly=await page.evaluate(async()=>{
  const T=await import('/lib/three.core.js'),{hingeMountFrames}=await import('/experiments/link-workshop/hinge-primitives.mjs'),api=window.kaminosWorkbenchExperiments,state=await api.read(),old=state.recipe.attachments.filter(a=>a.hardware);
  if(old.length!==3)throw Error('Open the three-family hinge scene');
  const recipe={schema:'kaminos.links.v1',period:3,nodes:[],pistons:[],mounts:[],attachments:[]},families=['clevis','knuckle','flange'];
  const matrix=f=>new T.Matrix4().compose(new T.Vector3(...f.position),new T.Quaternion().setFromEuler(new T.Euler(...f.rotation)),new T.Vector3(1,1,1));
  for(const [i,family]of families.entries()){
   const binding=old.find(a=>a.hardware.family===family);if(!binding)throw Error('Missing '+family);const hardware={...binding.hardware,mounting:'part-frames'},mounts=hingeMountFrames(hardware),axis=new T.Matrix4().makeTranslation((i-1)*2.4,1,0),fixedFrame={position:[.25,0,0],rotation:[0,-Math.PI/2,0]},fixedPose=axis.clone().multiply(matrix(mounts.fixed)).multiply(matrix(fixedFrame).invert()),p=new T.Vector3(),q=new T.Quaternion();fixedPose.decompose(p,q,new T.Vector3());const e=new T.Euler().setFromQuaternion(q);
   const id=window.kaminosSceneAuthoring.addMesh('box',{width:.5,height:.36,depth:.36});window.renameSceneObject(id,family+' receiver');window.kaminosSetSceneObjectTransform(id,{position:p.toArray(),rotation:[e.x,e.y,e.z]});window.kaminosSceneAuthoring.setMaterial(id,{color:'#405765',metalness:.5,roughness:.4});
   const sourceId=family+'-moving',targetId=family+'-fixed';recipe.mounts.push({id:sourceId,label:'Moving mount',owner:{objectId:binding.objectId},position:[-.4,0,0],rotation:[0,-Math.PI/2,0]},{id:targetId,label:'Fixed mount',owner:{objectId:id},...fixedFrame});recipe.attachments.push({objectId:binding.objectId,sourceMount:sourceId,targetMount:targetId,offset:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},hinge:[0,.7],hardware});
  }
  await api.invoke('restore',recipe);await api.invoke('selectConnection',{objectId:recipe.attachments[0].objectId});await api.invoke('mode',{value:'A'});await api.invoke('editAxle');window.kaminosSetCameraDebugPose({position:[.7,2.8,13.6],target:[.7,1.3,0]});
  return {recipe,ids:recipe.attachments.map(a=>a.objectId)};
 });
 const first=await retain({name:inputs.name??'Hinge families — seated mounts',observe:()=>assembly});return {assembly,first};
}
