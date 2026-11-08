// A worked assembly using an existing timber and post shoe. Invoke with the
// ordinary visual-work runner and a scene containing that stock; no generation.
export default async function ({page,retain,inputs={}}){
 const assembly=await page.evaluate(async inputs=>{
  const T=await import('/lib/three.core.js'),api=window.kaminosWorkbenchExperiments,stock=window.kaminosSceneObjectDebugState(),post=stock.find(o=>o.id===inputs.postId)||stock.find(o=>o.label==='Timber');
  if(!post||post.type!=='glb')throw Error('Open a scene with the existing Timber stock, or supply postId');
  await api.invoke('restore',{schema:'kaminos.links.v1',nodes:[],pistons:[],period:3});
  const beam=window.kaminosSceneAuthoring.duplicate(post.id);window.renameSceneObject(post.id,'Fixed timber post');window.renameSceneObject(beam,'Hinged timber beam');
  window.kaminosSetSceneObjectTransform(beam,{position:[0,0,0],rotation:[0,0,0],scale:post.transform.scale});
  const all=window.kaminosSceneObjectDebugState(),p=all.find(o=>o.id===post.id),b=all.find(o=>o.id===beam),pb=p.worldBounds,bb=b.worldBounds;
  if(!pb||!bb)throw Error('Stock bounds are unavailable');
  const matrix=o=>new T.Matrix4().compose(new T.Vector3(...o.transform.position),new T.Quaternion().setFromEuler(new T.Euler(...o.transform.rotation)),new T.Vector3(...o.transform.scale));
  const local=(o,world,rotation)=>{const q=new T.Quaternion().setFromEuler(new T.Euler(...o.transform.rotation)).invert().multiply(new T.Quaternion().setFromEuler(new T.Euler(...rotation))),e=new T.Euler().setFromQuaternion(q);return {position:new T.Vector3(...world).applyMatrix4(matrix(o).invert()).toArray(),rotation:[e.x,e.y,e.z]};};
  const size=inputs.size??Math.min(pb.max[0]-pb.min[0],pb.max[2]-pb.min[2])/.65;
  const receiver=local(p,[pb.max[0],pb.max[1]-.3,(pb.min[2]+pb.max[2])/2],[0,-Math.PI/2,0]),source=local(b,[bb.min[0],(bb.min[1]+bb.max[1])/2,(bb.min[2]+bb.max[2])/2],[0,-Math.PI/2,0]);
  await api.invoke('tool',{value:'connect'});await api.invoke('connectEnd',{objectId:beam,...source});await api.invoke('connectEnd',{objectId:post.id,...receiver});await api.invoke('previewConnection',{kind:'hinge'});await api.invoke('commitConnection');await api.invoke('hingeHardware',{family:'clevis',size});
  const state=await api.read();state.recipe.attachments[0].hinge=[0,inputs.angle??.6];await api.invoke('restore',state.recipe);await api.invoke('selectConnection',{objectId:beam});await api.invoke('mode',{value:'A'});
  const box=new T.Box3(),include=()=>{for(const o of window.kaminosSceneObjectDebugState().filter(o=>o.id!==state.objectId&&o.worldBounds))box.union(new T.Box3(new T.Vector3(...o.worldBounds.min),new T.Vector3(...o.worldBounds.max)));};include();await api.invoke('mode',{value:'B'});include();await api.invoke('mode',{value:'A'});const c=box.getCenter(new T.Vector3()),extent=box.getSize(new T.Vector3()).length();
  await api.invoke('editAxle');window.kaminosSetCameraDebugPose({position:c.clone().add(new T.Vector3(.7,.4,1.25).multiplyScalar(extent)).toArray(),target:c.toArray()});
  return {postId:post.id,beamId:beam,mechanismId:state.objectId,size,source,receiver,frames:await api.invoke('hingeFrames'),recipe:(await api.read()).recipe};
 },inputs);
 const first=await retain({name:inputs.name??'Hinge on timber — mounted faces',observe:()=>assembly});
 return {assembly,first};
}
