import {Raycaster,Vector2,Vector3,Plane} from './lib/three.core.js';

// One scoped physical gesture over the existing camera and controls. Empty
// space, other owners and declined contacts keep their ordinary editor behavior.
export function bindWorkbenchSurfaceDrag({canvas,camera,controls,roots,callback}){
 if(!canvas?.addEventListener)throw Error('Surface dragging requires the live viewport canvas');
 const raycaster=new Raycaster(),pointer=new Vector2();let grab=null,skipClick=false,disposed=false;
 function ray(event){const rect=canvas.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2);camera.updateMatrixWorld(true);raycaster.setFromCamera(pointer,camera);return raycaster.ray;}
 const consume=e=>{e.preventDefault();e.stopImmediatePropagation();};
 function finish(phase,event){if(!grab||event&&event.pointerId!==grab.pointerId)return;const current=grab;grab=null;controls.enabled=current.controlsEnabled;
  try{callback({phase,object:current.object,pointerId:current.pointerId,point:current.point.toArray()});}
  finally{if(canvas.hasPointerCapture?.(current.pointerId))canvas.releasePointerCapture(current.pointerId);}
 }
 function start(event){if(disposed||grab||event.button!==0||event.ctrlKey||event.metaKey||event.altKey)return;
  ray(event);const visible=o=>{for(let n=o;n;n=n.parent)if(!n.visible)return false;return true;};
  const hit=raycaster.intersectObjects(roots(),true).find(h=>visible(h.object));if(!hit)return;
  const value={phase:'start',object:hit.object,faceIndex:hit.faceIndex,normal:hit.face?.normal.toArray(),point:hit.point.toArray(),pointerId:event.pointerId};
  if(callback(value)!==true)return;
  grab={object:hit.object,pointerId:event.pointerId,point:hit.point.clone(),plane:new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()),hit.point),controlsEnabled:controls.enabled};
  controls.enabled=false;skipClick=true;canvas.setPointerCapture?.(event.pointerId);consume(event);
 }
 function move(event){if(!grab||event.pointerId!==grab.pointerId)return;const point=ray(event).intersectPlane(grab.plane,new Vector3());if(point){grab.point.copy(point);callback({phase:'move',object:grab.object,pointerId:event.pointerId,point:point.toArray()});}consume(event);}
 const end=e=>{if(grab&&e.pointerId===grab.pointerId){finish(e.type==='pointerup'?'end':'cancel',e);consume(e);}};
 const click=e=>{if(skipClick){skipClick=false;consume(e);}};
 for(const [type,listener]of [['pointerdown',start],['pointermove',move],['pointerup',end],['pointercancel',end],['lostpointercapture',end],['click',click]])canvas.addEventListener(type,listener,true);
 return()=>{if(disposed)return;disposed=true;try{finish('cancel');}finally{for(const [type,listener]of [['pointerdown',start],['pointermove',move],['pointerup',end],['pointercancel',end],['lostpointercapture',end],['click',click]])canvas.removeEventListener(type,listener,true);}};
}
