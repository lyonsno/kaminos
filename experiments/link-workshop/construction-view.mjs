import * as T from '../../lib/three.core.js';
import {createHeldPoseView} from './held-pose-view.mjs';
export function createConstructionView(root){
 const anchors=new Map(),selected=new Map();
 const clear=map=>{for(const v of map.values())v.dispose();map.clear();};
 return {update(state,entries,visible){
  const shown=[...state.anchors.map(a=>({...a,key:a.objectId})),...(state.requested??[]).filter(a=>a.status!=='held').map(a=>({...a,key:'requested:'+a.objectId}))],present=new Set(shown.map(a=>a.key));for(const [id,v]of anchors)if(!present.has(id)){v.dispose();anchors.delete(id);}
  for(const a of shown){let v=anchors.get(a.key);if(!v){v=createHeldPoseView(root);anchors.set(a.key,v);}const target=a.kind==='position'?{...a.target,position:a.target.position.map((v,i)=>a.axes&&!a.axes.includes(i)?a.actual?.position[i]??v:v),rotation:a.actual?.rotation??a.target.rotation}:a.kind==='orientation'?{...a.target,position:a.actual?.position??a.target.position,rotation:a.target.rotation.map((v,i)=>a.eulerAxis!==undefined&&a.eulerAxis!==i?a.actual?.rotation[i]??v:v)}:a.target;v.update({...a,target},entries,visible);v.pin.userData.constructionAnchor=a.objectId;}
  const wanted=new Set(state.active?state.selection:[]);for(const [id,v]of selected)if(!wanted.has(id)){v.dispose();selected.delete(id);}
  root.updateWorldMatrix(true,false);
  for(const id of wanted){const object=entries.find(e=>e.id===id)?.object;if(!object)continue;let v=selected.get(id);if(!v){const box=new T.BoxHelper(object,0xffc36b);box.userData.kaminosEditorOnly=true;box.userData.mechanismOverlay=true;box.material.depthTest=false;box.material.transparent=true;box.material.opacity=.7;box.raycast=()=>{};box.renderOrder=119;const group=new T.Group();group.userData.kaminosEditorOnly=true;group.userData.mechanismOverlay=true;group.matrixAutoUpdate=false;root.add(group);group.add(box);v={box,group,dispose(){group.removeFromParent();box.geometry.dispose();box.material.dispose();}};selected.set(id,v);}v.group.matrix.copy(root.matrixWorld).invert();v.group.visible=visible;v.box.update();v.group.updateMatrixWorld(true);}
 },dispose(){clear(anchors);clear(selected);}};
}
