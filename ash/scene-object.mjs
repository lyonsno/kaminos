import {Group,Mesh,Matrix4,Matrix3,Vector2,Vector3,Quaternion,BoxGeometry,LatheGeometry,CylinderGeometry,EdgesGeometry,LineSegments,LineBasicMaterial,TorusGeometry,MeshBasicMaterial,MeshStandardMaterial} from '../lib/three.core.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {normalizeBurner,annularBurnerCasterKey,createAnnularBurnerCaster} from '../annular-burner.mjs';
import {checkedAshRecord,checkedAshSettings,ashObjectLayout,ASH_OBJECT_TYPE} from './scene-record.mjs';
import {selectAshCollisionLod,applyRootVertexWarpToRung} from '../scene-lod-budget.mjs';

export {selectAshCollisionLod};

// Field coordinates belong to the object. Rigid scene triangles are borrowed,
// transformed into that frame, and never mutated or disposed by ash.
const ASH_COLLIDER_TYPES=['glb','pbr','procedural-mesh','burner-bed','brazier-room'];
const burnerRecipeOf=r=>r?.userData?.kaminosAnnularBurnerRecipe??(r?.userData?.kaminosSceneObject?.geometry?.kind==='annular'?r.userData.kaminosSceneObject.geometry.parameters:null);
export function createAshCollisionRecords(root,readObjects,{getCellSize=()=>0.04,resolveCollisionRung=null,resolveObstacle=null}={}){
 if(typeof resolveObstacle==='function')return createLegacyAshCollisionRecords(root,readObjects,{resolveObstacle});
 const proxies=new WeakMap(),burnerCasters=new WeakMap(),proxyMaterial=new MeshBasicMaterial(),inverse=new Matrix4(),invRung=new Matrix4(),repWorld=new Matrix4();
 return ()=>{
  root.updateWorldMatrix(true,false);if(Math.abs(root.matrixWorld.determinant())<1e-12)throw Error('Ash field transform must be invertible');inverse.copy(root.matrixWorld).invert();const result=[];
  for(const entry of readObjects()){
   if(entry.type===ASH_OBJECT_TYPE||!ASH_COLLIDER_TYPES.includes(entry.type)||!entry.object)continue;
   const restoreBeauty=entry.object.userData?.kaminosBeautyLodRestore?.()??null;
   try{
    entry.object.updateWorldMatrix(true,true);
    let objectVisible=true;
    for(let node=entry.object;node;node=node.parent)if(!node.visible||node.userData?.kaminosEditorOnly||node.userData?.kaminosEditorHelper){objectVisible=false;break;}
    if(!objectVisible)continue;
    let rung=resolveCollisionRung?.(entry.object,{cellSize:getCellSize()})??entry.object.userData?.kaminosAshCollisionRung??null;
    if(rung?.pending)continue;
    if(!rung){
     const recipe=burnerRecipeOf(entry.object);
     if(recipe){
      const normalized=normalizeBurner(recipe),key=annularBurnerCasterKey(normalized);let caster=burnerCasters.get(entry.object);
      if(!caster||caster.key!==key){
       caster?.geometry.dispose();
       const built=createAnnularBurnerCaster({LatheGeometry,CylinderGeometry,Vector2},mergeGeometries,normalized);
       const mesh=new Mesh(built.geometry,proxyMaterial);mesh.name=entry.object.name||'Annular burner caster';
       caster={key,root:mesh,geometry:built.geometry,faces:built.triangles,warpFn:undefined,warpRev:undefined};
       burnerCasters.set(entry.object,caster);
      }
      const warpFn=entry.object.userData?.kaminosVertexWarpFn??entry.object.userData?.kaminosVertexWarp??null;
      const warpRev=entry.object.userData?.kaminosVertexWarpRevision??0;
      if(caster.warpFn!==warpFn||caster.warpRev!==warpRev){
       if(warpFn||caster.warpFn)applyRootVertexWarpToRung({Matrix4,Matrix3,Vector3,Quaternion},caster.root,warpFn,{bounds:entry.object.userData?.kaminosVertexWarpBounds??entry.object.userData?.kaminosUnwarpedRootBox??null});
       caster.warpFn=warpFn;caster.warpRev=warpRev;
      }
      rung=warpFn?{root:caster.root,tier:'annular-caster',faces:caster.faces,analyticBurner:null}:{root:caster.root,tier:'annular-analytic',faces:0,analyticBurner:normalized};
     }
    }
    if(rung?.root){
     rung.root.updateWorldMatrix(true,true);invRung.copy(rung.root.matrixWorld).invert();
     const repCopies=(entry.object.children??[]).filter(c=>c.userData?.kaminosRepetitionCopy&&c.visible);
     const placements=[entry.object.matrixWorld,...repCopies.map(rep=>repWorld.clone().multiplyMatrices(entry.object.matrixWorld,rep.matrix))];
     let index=0;
     for(let p=0;p<placements.length;p++){
      const placementWorld=placements[p];
      rung.root.traverse(mesh=>{
       const part=index++;if(!mesh.isMesh)return;
       for(let node=mesh;node&&node!==rung.root.parent;node=node.parent)if(!node.visible||node.userData?.kaminosEditorOnly||node.userData?.kaminosEditorHelper||node.userData?.kaminosBeautyLodProxy)return;
       if(mesh.isSkinnedMesh||mesh.isInstancedMesh||mesh.morphTargetInfluences?.some(x=>x!==0))throw Error(`Ash needs rigid triangles: ${entry.label||entry.id}`);
       let byPlacement=proxies.get(mesh);if(!byPlacement){byPlacement=new Map();proxies.set(mesh,byPlacement);}
       let proxy=byPlacement.get(p);if(!proxy){proxy=new Mesh(mesh.geometry,mesh.material);proxy.matrixAutoUpdate=false;byPlacement.set(p,proxy);}
       proxy.geometry=mesh.geometry;proxy.material=mesh.material;proxy.name=mesh.name;
       proxy.userData.kaminosAnalyticAnnularBurner=rung.analyticBurner??null;
       proxy.matrix.multiplyMatrices(inverse,placementWorld).multiply(invRung).multiply(mesh.matrixWorld);proxy.updateMatrixWorld(true);
       result.push({id:entry.id,key:`${entry.id}:${part}`,object:proxy,collisionTier:rung.tier??null,collisionFaces:rung.faces??null});
      });
     }
    }else{
     let index=0;
     entry.object.traverse(mesh=>{
      const part=index++;if(!mesh.isMesh)return;
      for(let node=mesh;node;node=node.parent)if(!node.visible||node.userData?.kaminosEditorOnly||node.userData?.kaminosEditorHelper||node.userData?.kaminosBeautyLodProxy)return;
      if(mesh.isSkinnedMesh||mesh.isInstancedMesh||mesh.morphTargetInfluences?.some(x=>x!==0))throw Error(`Ash needs rigid triangles: ${entry.label||entry.id}`);
      let byPlacement=proxies.get(mesh);if(!byPlacement){byPlacement=new Map();proxies.set(mesh,byPlacement);}
      let proxy=byPlacement.get(0);if(!proxy){proxy=new Mesh(mesh.geometry,mesh.material);proxy.matrixAutoUpdate=false;byPlacement.set(0,proxy);}
      proxy.geometry=mesh.geometry;proxy.material=mesh.material;proxy.name=mesh.name;
      proxy.matrix.multiplyMatrices(inverse,mesh.matrixWorld);proxy.updateMatrixWorld(true);
      result.push({id:entry.id,key:`${entry.id}:${part}`,object:proxy,collisionTier:'hero',collisionFaces:null});
     });
    }
   }finally{restoreBeauty?.();}
  }return result;
 };
}
function createLegacyAshCollisionRecords(root,readObjects,{resolveObstacle=null}={}){
 const proxies=new WeakMap(),inverse=new Matrix4();
 return ()=>{
  root.updateWorldMatrix(true,false);if(Math.abs(root.matrixWorld.determinant())<1e-12)throw Error('Ash field transform must be invertible');inverse.copy(root.matrixWorld).invert();const result=[];
  const cellSize=root.userData?.kaminosSceneObject?.ash?.cellSize??0.04;
  for(const entry of readObjects()){
   if(entry.type===ASH_OBJECT_TYPE||!['glb','pbr','procedural-mesh','burner-bed','brazier-room'].includes(entry.type))continue;
   const restoreBeauty=entry.object.userData?.kaminosBeautyLodRestore?.();
   try{
    entry.object.updateWorldMatrix(true,true);
    const sourceObj=typeof resolveObstacle==='function'?resolveObstacle(entry,{voxelSize:cellSize}):entry.object;
    if(!sourceObj)continue;
    let index=0;
    sourceObj.traverse(mesh=>{
     const part=index++;if(!mesh.isMesh)return;
     for(let node=mesh;node;node=node.parent)if(!node.visible||node.userData?.kaminosBeautyLodProxy||node.userData?.kaminosEditorOnly||node.userData?.kaminosEditorHelper)return;
     if(mesh.isSkinnedMesh||mesh.isInstancedMesh||mesh.morphTargetInfluences?.some(x=>x!==0))throw Error(`Ash needs rigid triangles: ${entry.label||entry.id}`);
     let proxy=proxies.get(mesh);if(!proxy){proxy=new Mesh(mesh.geometry,mesh.material);proxy.matrixAutoUpdate=false;proxies.set(mesh,proxy);}
     proxy.geometry=mesh.geometry;proxy.material=mesh.material;proxy.name=mesh.name;
     proxy.matrix.multiplyMatrices(inverse,mesh.matrixWorld);proxy.updateMatrixWorld(true);
     result.push({id:entry.id,key:`${entry.id}:${part}`,object:proxy});
    });
   }finally{
    restoreBeauty?.();
   }
  }return result;
 };
}

export async function createAshSceneObject({record:raw,renderer,readObjects,readSources=()=>[],lodController=null,resolveObstacle=null,onError=()=>{},createPatch=async options=>(await import('./tile-gpu.mjs')).createGpuTiledAsh(options)}){
 const record=checkedAshRecord(raw),root=new Group();root.name=record.label||'Ash';
 root.position.fromArray(record.transform?.position??[0,0,0]);root.rotation.set(...(record.transform?.rotation??[0,0,0]));root.scale.fromArray(record.transform?.scale??[1,1,1]);
 let settings=record.ash,patch=null,busy=false,disposed=false,pendingRestore=settings.checkpoint,initialized=false,lastTick=null,failure=null;
 const device=renderer?.backend?.device;
 function checkedLayout(s){const layout=ashObjectLayout(s);
  if(device)for(const bytes of [layout.count*4,layout.tiles.count*layout.tiles.cellsPerTile*24])if(bytes>device.limits.maxStorageBufferBindingSize||bytes>device.limits.maxBufferSize)throw Error('Ash field exceeds effective GPU capacity; increase cell width or reduce field dimensions');
  return layout;
 }
 checkedLayout(settings);
 const boxGeometry=new BoxGeometry(settings.width,settings.height,settings.depth),edges=new EdgesGeometry(boxGeometry);boxGeometry.dispose();
 const guide=new LineSegments(edges,new LineBasicMaterial({color:0xa4aba4,transparent:true,opacity:.4}));guide.position.y=settings.height/2;guide.userData.kaminosEditorHelper=true;root.add(guide);
 const emitter=new Mesh(new TorusGeometry(1,.018,6,48),new MeshStandardMaterial({color:0x8abdb2,roughness:.8}));emitter.rotation.x=Math.PI/2;emitter.userData.kaminosEditorHelper=true;root.add(emitter);
 const sync=()=>{emitter.position.fromArray(settings.sourcePosition);emitter.scale.setScalar(Math.max(settings.spread,.01));root.userData.kaminosSceneObject={...(root.userData.kaminosSceneObject??record),ash:settings};};sync();
 let collisionSource='adaptive';
 const adaptiveCollisionRecords=createAshCollisionRecords(root,readObjects,{getCellSize:()=>settings.cellSize,resolveCollisionRung:(obj,opts)=>lodController?.resolveCollisionRung?.(obj,opts)??null,resolveObstacle});
 const originalCollisionRecords=createLegacyAshCollisionRecords(root,readObjects);
 const collisionRecords=()=>collisionSource==='checkpoint-original'?originalCollisionRecords():adaptiveCollisionRecords();
 const prepareCollision=cellSize=>lodController?.prepareCollision?.(readObjects().filter(e=>e.type!==ASH_OBJECT_TYPE&&ASH_COLLIDER_TYPES.includes(e.type)).map(e=>e?.object).filter(Boolean),{cellSize});
 const check=()=>{if(disposed)throw Error('Ash object disposed');if(busy)throw Error('Ash operation in progress');};
 const source=()=>({position:[...settings.sourcePosition],rate:settings.emitting?settings.rate:0,spread:settings.spread,dt:1/30,sources:[...readSources(),...(settings.fallout?[{position:[0,settings.height,0],spread:0,rate:settings.rate,halfExtents:[settings.width/2,settings.depth/2]}]:[])]});
 const locked=async fn=>{check();busy=true;try{return await fn();}finally{busy=false;}};
 function dispose(){if(disposed)return;disposed=true;patch?.dispose();guide.geometry.dispose();guide.material.dispose();emitter.geometry.dispose();emitter.material.dispose();root.removeFromParent();}
 async function build(s){const layout=checkedLayout(s);let candidate;
  try{candidate=await createPatch({renderer,cellSize:layout.cellSize,bounds:layout.bounds,solid:new Uint8Array(layout.count),tileSize:16,sceneRecords:collisionRecords,surfaceMode:'runs',sliding:{variation:s.slideVariation,scale:s.slideScale,release:s.slideRelease}});
   candidate.setSoftNormals?.(s.softNormals);return candidate;
  }catch(error){candidate?.dispose();throw error;}
 }
 try{patch=await build(settings);root.add(patch.root);}
 catch(error){dispose();throw error;}
 const api={root,
  async initialize(){if(initialized)return;return locked(async()=>{
   await prepareCollision(settings.cellSize);patch.syncScene();
   if(pendingRestore){
    try{patch.restore(pendingRestore);}
    catch(error){
     if(error.code!=='ASH_CHECKPOINT_COLLISION_MISMATCH'||(!lodController&&typeof resolveObstacle!=='function'))throw error;
     // Older checkpoints can name original triangles even when the current
     // scene selects a collision LOD. The same strict identity and material
     // checks must pass against the original before retaining that source.
     collisionSource='checkpoint-original';
     try{patch.restore(pendingRestore);}catch(originalError){collisionSource='adaptive';throw originalError;}
    }
    pendingRestore=null;
   }else if(settings.initialDepth>0)await patch.deposit({blanketDepth:settings.initialDepth,groundOnly:true});
   patch.setSliding?.({variation:settings.slideVariation,scale:settings.slideScale,release:settings.slideRelease});initialized=true;
  });},
  due(timestamp,{active=true}={}){
   return !(disposed||busy||!initialized||pendingRestore||!active||settings.paused)&&(lastTick===null||timestamp-lastTick>=1000/30);
  },
  tick(timestamp,{active=true,selected=false,advance=true}={}){
   guide.visible=selected;emitter.visible=selected&&settings.emitting;
   if(disposed||busy||!initialized||pendingRestore||!active||settings.paused){lastTick=null;return false;}
   if(!advance)return false;
   if(lastTick!==null&&timestamp-lastTick<1000/30)return false;lastTick=timestamp;
   try{patch.step(null,source());if(failure){failure=null;onError(null);}return true;}catch(error){const changed=failure!==error.message;failure=error.message;if(changed)onError(failure);return false;}
  },
  set(patchSettings){check();if(Object.hasOwn(patchSettings,'checkpoint'))throw Error('Checkpoint state is owned by scene saving');const next=checkedAshSettings({...settings,...patchSettings,checkpoint:null});next.checkpoint=settings.checkpoint;
   for(const key of ['width','depth','height','cellSize','initialDepth'])if(JSON.stringify(next[key])!==JSON.stringify(settings[key]))throw Error('Use Reset at cell width to rebuild the lattice; dimensions belong to creation');
   patch.setSliding?.({variation:next.slideVariation,scale:next.slideScale,release:next.slideRelease});settings=next;patch.setSoftNormals?.(settings.softNormals);sync();return api.read();
  },
  regrid(cellSize){return locked(async()=>{
   const next=checkedAshSettings({...settings,cellSize,initialDepth:0,checkpoint:null}),prevSettings=settings;let candidate;
   try{candidate=await build(next);await prepareCollision(next.cellSize);if(disposed)throw Error('Ash object disposed during regrid');settings=next;candidate.syncScene();}
   catch(error){settings=prevSettings;candidate?.dispose();throw error;}
   const previous=patch;patch=candidate;pendingRestore=null;initialized=true;lastTick=null;failure=null;
   root.add(patch.root);sync();previous.root.removeFromParent();previous.dispose();return api.read();
  });},
  async checkpoint(){return locked(async()=>{patch.syncScene();const state=await patch.snapshot();failure=null;settings={...settings,checkpoint:state};sync();return structuredClone(settings);});},
  cover(depth){return locked(()=>patch.deposit({blanketDepth:depth,groundOnly:true}));},
  burst(volume){check();patch.burst(volume);},
  advance(steps=1){check();if(!Number.isSafeInteger(steps)||steps<1)throw Error('Ash steps must be a positive integer');for(let i=0;i<steps;i++)patch.step(null,source());},
  diagnostics:options=>locked(()=>patch.diagnostics(options)),
  read:()=>({id:record.id,settings:{...settings,checkpoint:undefined},pendingRestore:!!pendingRestore,collisionSource,busy,failure,disposed,runtime:patch.read()}),
  dispose,
 };
 root.userData.disposeAshObject=dispose;return api;
}
