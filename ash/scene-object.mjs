import {Group,Mesh,Matrix4,BoxGeometry,EdgesGeometry,LineSegments,LineBasicMaterial,TorusGeometry,MeshStandardMaterial} from '../lib/three.core.js';
import {checkedAshRecord,checkedAshSettings,ashObjectLayout,ASH_OBJECT_TYPE} from './scene-record.mjs';

// Field coordinates belong to the object. Rigid scene triangles are borrowed,
// transformed into that frame, and never mutated or disposed by ash.
export function createAshCollisionRecords(root,readObjects){
 const proxies=new WeakMap(),inverse=new Matrix4();
 return ()=>{
  root.updateWorldMatrix(true,false);if(Math.abs(root.matrixWorld.determinant())<1e-12)throw Error('Ash field transform must be invertible');inverse.copy(root.matrixWorld).invert();const result=[];
  for(const entry of readObjects()){
   if(entry.type===ASH_OBJECT_TYPE||!['glb','pbr','procedural-mesh','burner-bed','brazier-room'].includes(entry.type))continue;
   entry.object.updateWorldMatrix(true,true);let index=0;
   entry.object.traverse(mesh=>{
    const part=index++;if(!mesh.isMesh)return;
    for(let node=mesh;node;node=node.parent)if(!node.visible||node.userData?.kaminosEditorOnly||node.userData?.kaminosEditorHelper)return;
    if(mesh.isSkinnedMesh||mesh.isInstancedMesh||mesh.morphTargetInfluences?.some(x=>x!==0))throw Error(`Ash needs rigid triangles: ${entry.label||entry.id}`);
    let proxy=proxies.get(mesh);if(!proxy){proxy=new Mesh(mesh.geometry,mesh.material);proxy.matrixAutoUpdate=false;proxies.set(mesh,proxy);}
    proxy.geometry=mesh.geometry;proxy.material=mesh.material;proxy.name=mesh.name;
    proxy.matrix.multiplyMatrices(inverse,mesh.matrixWorld);proxy.updateMatrixWorld(true);
    result.push({id:entry.id,key:`${entry.id}:${part}`,object:proxy});
   });
  }return result;
 };
}
export async function createAshSceneObject({record:raw,renderer,readObjects,onError=()=>{},createPatch=async options=>(await import('./tile-gpu.mjs')).createGpuTiledAsh(options)}){
 const record=checkedAshRecord(raw),root=new Group();root.name=record.label||'Ash';
 root.position.fromArray(record.transform?.position??[0,0,0]);root.rotation.set(...(record.transform?.rotation??[0,0,0]));root.scale.fromArray(record.transform?.scale??[1,1,1]);
 let settings=record.ash,patch=null,busy=false,disposed=false,pendingRestore=settings.checkpoint,initialized=false,lastTick=null,failure=null;
 const layout=ashObjectLayout(settings),device=renderer?.backend?.device;
 // Same effective capacity check as the GPU owner, before allocating the CPU mask.
 if(device)for(const bytes of [layout.count*4,layout.tiles.count*layout.tiles.cellsPerTile*24])if(bytes>device.limits.maxStorageBufferBindingSize||bytes>device.limits.maxBufferSize)throw Error('Ash field exceeds effective GPU capacity; increase cell width or reduce field dimensions');
 const boxGeometry=new BoxGeometry(settings.width,settings.height,settings.depth),edges=new EdgesGeometry(boxGeometry);boxGeometry.dispose();
 const guide=new LineSegments(edges,new LineBasicMaterial({color:0xa4aba4,transparent:true,opacity:.4}));guide.position.y=settings.height/2;guide.userData.kaminosEditorHelper=true;root.add(guide);
 const emitter=new Mesh(new TorusGeometry(1,.018,6,48),new MeshStandardMaterial({color:0x8abdb2,roughness:.8}));emitter.rotation.x=Math.PI/2;emitter.userData.kaminosEditorHelper=true;root.add(emitter);
 const sync=()=>{emitter.position.fromArray(settings.sourcePosition);emitter.scale.setScalar(Math.max(settings.spread,.01));root.userData.kaminosSceneObject={...record,ash:settings};};sync();
 const collisionRecords=createAshCollisionRecords(root,readObjects);
 const check=()=>{if(disposed)throw Error('Ash object disposed');if(busy)throw Error('Ash operation in progress');if(failure)throw Error(failure);};
 const source=()=>({position:[...settings.sourcePosition],rate:settings.emitting?settings.rate:0,spread:settings.spread,dt:1/30});
 const locked=async fn=>{check();busy=true;try{return await fn();}finally{busy=false;}};
 function dispose(){if(disposed)return;disposed=true;patch?.dispose();guide.geometry.dispose();guide.material.dispose();emitter.geometry.dispose();emitter.material.dispose();root.removeFromParent();}
 try{patch=await createPatch({renderer,cellSize:layout.cellSize,bounds:layout.bounds,solid:new Uint8Array(layout.count),tileSize:16,sceneRecords:collisionRecords,surfaceMode:'runs'});root.add(patch.root);}
 catch(error){dispose();throw error;}
 const api={root,
  async initialize(){if(initialized)return;return locked(async()=>{patch.syncScene();if(pendingRestore){patch.restore(pendingRestore);pendingRestore=null;}else if(settings.initialDepth>0)await patch.deposit({blanketDepth:settings.initialDepth,groundOnly:true});initialized=true;});},
  tick(timestamp,{active=true,selected=false}={}){
   guide.visible=emitter.visible=selected;
   if(disposed||busy||failure||!initialized||pendingRestore||!active||settings.paused){lastTick=null;return false;}
   if(lastTick!==null&&timestamp-lastTick<1000/30)return false;lastTick=timestamp;
   try{patch.step(null,source());return true;}catch(error){failure=error.message;onError(failure);return false;}
  },
  set(patchSettings){check();const next=checkedAshSettings({...settings,...patchSettings});
   for(const key of ['width','depth','height','cellSize','initialDepth','checkpoint'])if(JSON.stringify(next[key])!==JSON.stringify(settings[key]))throw Error('Field dimensions and initial layer belong to creation; add a new field to change its lattice without deleting retained ash');
   settings=next;sync();return api.read();
  },
  async checkpoint(){return locked(async()=>{const state=await patch.snapshot();settings={...settings,checkpoint:state};sync();return structuredClone(settings);});},
  cover(depth){return locked(()=>patch.deposit({blanketDepth:depth,groundOnly:true}));},
  burst(volume){check();patch.burst(volume);},
  advance(steps=1){check();if(!Number.isSafeInteger(steps)||steps<1)throw Error('Ash steps must be a positive integer');for(let i=0;i<steps;i++)patch.step(null,source());},
  diagnostics:options=>locked(()=>patch.diagnostics(options)),
  read:()=>({id:record.id,settings:{...settings,checkpoint:undefined},pendingRestore:!!pendingRestore,busy,failure,disposed,runtime:patch.read()}),
  dispose,
 };
 root.userData.disposeAshObject=dispose;return api;
}
