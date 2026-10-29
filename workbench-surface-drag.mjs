import {Raycaster,Vector2,Vector3,Plane} from './lib/three.core.js';

// One scoped physical gesture over the existing camera and controls. Empty
// space, other owners and declined contacts keep their ordinary editor behavior.
export function bindWorkbenchSurfaceDrag({canvas,camera,controls,roots,sceneRoots=roots,callback,pick,onError=()=>{}}){
 if(!canvas?.addEventListener)throw Error('Surface dragging requires the live viewport canvas');
 const raycaster=new Raycaster(),pointer=new Vector2();let grab=null,pending=null,replaying=false,skipClick=false,disposed=false;
 function ray(event){const rect=canvas.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2);camera.updateMatrixWorld(true);raycaster.setFromCamera(pointer,camera);return raycaster.ray;}
 const consume=e=>{e.preventDefault();e.stopImmediatePropagation();};
 function finish(phase,event){if(!grab||event&&event.pointerId!==grab.pointerId)return;const current=grab;grab=null;controls.enabled=current.controlsEnabled;
  try{callback({phase,object:current.object,pointerId:current.pointerId,point:current.point.toArray()});}
  finally{if(canvas.hasPointerCapture?.(current.pointerId))canvas.releasePointerCapture(current.pointerId);}
 }
 function start(event){if(replaying||disposed||grab||pending||event.button!==0||event.ctrlKey||event.metaKey||event.altKey)return;
  ray(event);const visible=o=>{for(let n=o;n;n=n.parent)if(!n.visible)return false;return true;};
  raycaster.layers.mask=camera.layers.mask;
  if(pick){startResident(event,visible);return;}
  const hit=raycaster.intersectObjects(sceneRoots(),true).find(h=>h.object.isMesh&&visible(h.object));if(!hit)return;
  const own=new Set(roots());let belongs=false;for(let n=hit.object;n;n=n.parent)if(own.has(n)){belongs=true;break;}if(!belongs)return;
  const value={phase:'start',object:hit.object,faceIndex:hit.faceIndex,normal:hit.face?.normal.toArray(),point:hit.point.toArray(),pointerId:event.pointerId};
  if(callback(value)!==true)return;
  grab={object:hit.object,pointerId:event.pointerId,point:hit.point.clone(),plane:new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()),hit.point),controlsEnabled:controls.enabled};
  controls.enabled=false;skipClick=true;canvas.setPointerCapture?.(event.pointerId);consume(event);
 }
 function move(event){if(pending&&event.pointerId===pending.pointerId){pending.events.push(event);consume(event);return;}if(!grab||event.pointerId!==grab.pointerId)return;const point=ray(event).intersectPlane(grab.plane,new Vector3());if(point){grab.point.copy(point);callback({phase:'move',object:grab.object,pointerId:event.pointerId,point:point.toArray()});}consume(event);}
 function restorePending(p){controls.enabled=p.controlsEnabled;if(canvas.hasPointerCapture?.(p.pointerId))canvas.releasePointerCapture(p.pointerId);}
 function replay(events){replaying=true;try{for(const e of events){const init={bubbles:true,cancelable:true};for(const k of ['clientX','clientY','button','buttons','pointerId','pointerType','ctrlKey','metaKey','altKey','shiftKey'])init[k]=e[k];const clone=new e.constructor(e.type,init);for(const k of Object.keys(init))if(clone[k]===undefined)Object.defineProperty(clone,k,{value:init[k]});canvas.dispatchEvent(clone);}}finally{replaying=false;}}
 function startResident(event,visible){
  const owns=o=>{const own=new Set(roots());for(let n=o;n;n=n.parent)if(own.has(n))return true;return false;};
  const foreign=raycaster.intersectObjects(sceneRoots(),true).find(h=>h.object.isMesh&&visible(h.object)&&!owns(h.object));
  const p={pointerId:event.pointerId,controlsEnabled:controls.enabled,events:[event],ended:false};pending=p;controls.enabled=false;canvas.setPointerCapture?.(event.pointerId);consume(event);
  let task;try{task=pick({origin:raycaster.ray.origin.toArray(),direction:raycaster.ray.direction.toArray()});}catch(error){pending=null;restorePending(p);onError(error);return;}
  Promise.resolve(task).then(hit=>{
   if(disposed||pending!==p)return;pending=null;
   if(!hit||!owns(hit.object)||!visible(hit.object)||foreign&&foreign.distance<=hit.distance){restorePending(p);replay(p.events);return;}
   if(p.ended==='cancel'){restorePending(p);skipClick=!p.events.some(e=>e.type==='click');return;}
   const value={...hit,phase:'start',pointerId:p.pointerId};if(callback(value)!==true){restorePending(p);replay(p.events);return;}
   const point=new Vector3(...hit.point);grab={object:hit.object,pointerId:p.pointerId,point,plane:new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()),point),controlsEnabled:p.controlsEnabled};skipClick=true;
   for(const e of p.events.slice(1)){if(e.type==='pointermove')move(e);else if(e.type==='pointerup')end(e);}
   if(p.events.some(e=>e.type==='click'))skipClick=false;
  }).catch(error=>{if(pending===p)pending=null;if(!disposed)restorePending(p);onError(error);});
 }
 const end=e=>{if(pending&&e.pointerId===pending.pointerId){if(!pending.ended){pending.ended=e.type==='pointerup'?'end':'cancel';pending.events.push(e);}consume(e);return;}if(grab&&e.pointerId===grab.pointerId){try{if(e.type==='pointerup')move(e);finish(e.type==='pointerup'?'end':'cancel',e);}catch(error){finish('cancel',e);onError(error);}consume(e);}};
 const click=e=>{if(pending){pending.events.push(e);consume(e);return;}if(skipClick){skipClick=false;consume(e);}};
 for(const [type,listener]of [['pointerdown',start],['pointermove',move],['pointerup',end],['pointercancel',end],['lostpointercapture',end],['click',click]])canvas.addEventListener(type,listener,true);
 return()=>{if(disposed)return;disposed=true;try{if(pending){const p=pending;pending=null;restorePending(p);}finish('cancel');}finally{for(const [type,listener]of [['pointerdown',start],['pointermove',move],['pointerup',end],['pointercancel',end],['lostpointercapture',end],['click',click]])canvas.removeEventListener(type,listener,true);}};
}
