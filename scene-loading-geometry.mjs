// An explicitly provisional frame of the actual registered static meshes. It
// borrows geometry and the existing camera/renderer; final lighting and scene
// admission remain with the ordinary restore path.
const TYPES=new Set(['glb','pbr','procedural-mesh','burner-bed','brazier-room']);
export function createSceneLoadingGeometry({THREE,renderer,camera,readObjects,isCurrent,isVisible=()=>true,waitForLighting=async()=>{},withRenderer=operation=>operation(),renderLighting=null,yieldForPaint=()=>new Promise(resolve=>setTimeout(resolve,0)),onStatus=()=>{}}){
 const scene=new THREE.Scene(),content=new THREE.Group(),material=new THREE.MeshLambertMaterial({color:0xa5acb5,side:THREE.DoubleSide});
 scene.name='Loading geometry preview';scene.background=new THREE.Color(0x171a20);scene.add(content,new THREE.HemisphereLight(0xdce8ff,0x45413a,2.5));
 let active=false,requestId=null,phase='idle',draws=0,error=null,lastPresentation=null,signature=null,unsupportedIds=[],disposed=false,pending=Promise.resolve(),lightingShown=false;
 const current=id=>!disposed&&active&&requestId===id&&isCurrent(id);
 const read=()=>({active,requestId,phase,draws,error,unsupportedIds:[...unsupportedIds],lastPresentation:lastPresentation?structuredClone(lastPresentation):null});
 function collect(visible=isVisible,authored=false){
  const meshes=[],unsupported=new Set();
  for(const entry of readObjects()){
   if(!TYPES.has(entry.type)||!entry.object||!visible(entry.id))continue;
   entry.object.updateWorldMatrix(true,true);
   entry.object.traverse(mesh=>{
    if(!mesh.isMesh)return;
    for(let node=mesh;node;node=node.parent)if(!node.visible||node.userData?.kaminosEditorHelper||node.userData?.kaminosEditorOnly)return;
    if(!authored&&(mesh.isSkinnedMesh||mesh.isInstancedMesh||mesh.isBatchedMesh||mesh.morphTargetInfluences?.some(v=>v!==0))){unsupported.add(entry.id);return;}
    meshes.push({id:entry.id,mesh,matrix:mesh.matrixWorld.clone()});
   });
  }
  return {meshes,unsupportedIds:[...unsupported]};
 }
 function present(id,{isVisible:visible=isVisible}={}){
  const task=pending.then(async()=>{
   if(!current(id))return false;
   await waitForLighting();if(!current(id))return false;
   const shown=await withRenderer(async()=>{
   if(!current(id))return false;
   const snapshot=collect(visible);unsupportedIds=snapshot.unsupportedIds;
   if(!snapshot.meshes.length)return false;
   const next=JSON.stringify(snapshot.meshes.map(({id,mesh,matrix})=>[id,mesh.uuid,mesh.geometry.uuid,mesh.geometry.attributes.position?.version,mesh.geometry.index?.version,...matrix.elements]));
   if(signature===next)return false;
   const target=renderer.getRenderTarget(),mrt=renderer.getMRT(),autoClear=renderer.autoClear;
   for(const {mesh,matrix} of snapshot.meshes){const copy=new THREE.Mesh(mesh.geometry,material);copy.matrixAutoUpdate=false;copy.matrix.copy(matrix);content.add(copy);}
   scene.updateMatrixWorld(true);camera.updateMatrixWorld();
   try{
    renderer.setRenderTarget(null);renderer.setMRT(null);renderer.autoClear=true;
    await renderer.compileAsync(scene,camera);
    if(!current(id))return false;
    renderer.render(scene,camera);signature=next;draws++;phase='geometry-visible';
    lastPresentation={requestId:id,ids:[...new Set(snapshot.meshes.map(row=>row.id))],meshes:snapshot.meshes.length,shading:'neutral-loading-preview',authority:'render-returned; final restoration pending'};
    onStatus(read());
   }finally{renderer.setRenderTarget(target);renderer.setMRT(mrt);renderer.autoClear=autoClear;content.clear();}
   return true;
   });
   // Release renderer ownership before letting the provisional frame paint.
   if(shown)await yieldForPaint();return shown&&current(id);
  }).catch(cause=>{if(current(id)){error=String(cause.message??cause);onStatus(read());}return false;});
  pending=task;return task;
 }
 function presentLighting(id,{isVisible:visible=isVisible}={}){
  const task=pending.then(async()=>{
   if(!current(id)||lightingShown||!renderLighting)return false;
   await waitForLighting();if(!current(id))return false;
   const shown=await withRenderer(async()=>{
    if(!current(id))return false;
    const snapshot=collect(visible,true);
    const prior={target:renderer.getRenderTarget(),mrt:renderer.getMRT(),autoClear:renderer.autoClear,
     contextNode:renderer.contextNode,toneMapping:renderer.toneMapping,outputColorSpace:renderer.outputColorSpace,
     transparent:renderer.transparent,opaque:renderer.opaque,xr:renderer.xr?.enabled};
    try{
     renderer.setRenderTarget(null);renderer.setMRT(null);renderer.autoClear=true;
     if(await renderLighting({isVisible:visible,isCurrent:()=>current(id)})!==true)return false;
     if(!current(id))return false;
     lightingShown=true;draws++;phase='lighting-visible';error=null;unsupportedIds=[];
     lastPresentation={requestId:id,ids:[...new Set(snapshot.meshes.map(row=>row.id))],meshes:snapshot.meshes.length,shading:'saved-scene-lighting',authority:'render-returned; final restoration pending'};
     onStatus(read());return true;
    }finally{
     renderer.setRenderTarget(prior.target);renderer.setMRT(prior.mrt);renderer.autoClear=prior.autoClear;
     for(const key of ['contextNode','toneMapping','outputColorSpace','transparent','opaque'])renderer[key]=prior[key];
     if(renderer.xr)renderer.xr.enabled=prior.xr;
    }
   });
   if(shown)await yieldForPaint();return shown&&current(id);
  }).catch(cause=>{if(current(id)){error=String(cause.message??cause);onStatus(read());}return false;});
  pending=task;return task;
 }
 return {read,present,presentLighting,whenIdle:()=>pending,
  begin(id){requestId=id;active=true;phase='loading';error=null;signature=null;lastPresentation=null;unsupportedIds=[];lightingShown=false;onStatus(read());},
  finish(id,ok){if(requestId!==id)return;active=false;phase=ok?'complete':'failed';onStatus(read());},
  async dispose(){disposed=true;active=false;await pending;content.clear();material.dispose();},
 };
}
