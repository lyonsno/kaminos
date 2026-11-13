import {visibleSceneIntersections} from './scene-visible-picking.mjs';
import {presentedSurface} from './scene-presented-surface.mjs';
import {applySceneWorkerCameraSnapshot} from './scene-worker-view.mjs';

// The actual registered roots stay in the worker. This synchronous query can
// run inside its existing Kit foreground boundary without waiting on a model.
export function pickSceneWorkerObject({THREE,ordinary,input}){
 const {ndc,viewport,camera:cameraSnapshot}=input??{};
 if(!ndc||![ndc.x,ndc.y].every(value=>Number.isFinite(value)&&Math.abs(value)<=1)
  ||!viewport||![viewport.width,viewport.height].every(value=>Number.isFinite(value)&&value>0))throw Error('Picking requires finite canvas coordinates and a positive CSS extent');
 const camera=ordinary.camera.clone();applySceneWorkerCameraSnapshot(camera,cameraSnapshot);
 const rows=ordinary.workingScene.objects.filter(row=>ordinary.visible(row.id)&&row.object.visible);
 const roots=rows.map(row=>row.object),lods=ordinary.beautyLods;
 const queryRoots=lods?lods.interactiveRoots(roots,{matchDisplay:true,pinnedObjects:new Set(ordinary.workingScene.selection.ids)}):roots;
 const checked=new Set();
 function check(root){if(!root.visible||checked.has(root))return;checked.add(root);
  // Presented fracture surfaces can submit GPU work and await a readback.
  // Refuse before invoking them; that owner is not mounted in this entry.
  if(presentedSurface(root))throw Error('Asynchronous presented-surface picking is not mounted in this worker entry');
  for(const child of root.children)check(child);
 }
 for(const root of [...roots,...queryRoots]){root.updateWorldMatrix(true,true);check(root);}
 const raycaster=new THREE.Raycaster();raycaster.setFromCamera(new THREE.Vector2(ndc.x,ndc.y),camera);
 const hits=visibleSceneIntersections({raycaster,roots:queryRoots,camera,viewport});
 const recordFor=hit=>{const object=lods?.interactiveOwner(hit.object)??hit.object;return rows.find(row=>{for(let node=object;node;node=node.parent)if(node===row.object)return true;return false;});};
 const records=hits.map(recordFor).filter(Boolean);
 return (records.find(row=>['flame-emitter','local-liquid-emitter'].includes(row.type))??records[0])?.id??null;
}
