// Edit Mode inside the authoring app: Blender's keys and pointer grammar on top of
// the polygon Edit Mode controller. The app supplies its services; this module adds
// listeners in the capture phase and exposes the same operations to agents. Object
// tools must also check active() (admission guards), since listener order alone
// does not decide which mode owns a key.
import {createPolyEditMode} from './poly-edit-mode.mjs';

const MODE_KEYS={Digit1:'vertex',Digit2:'edge',Digit3:'face'},LABEL={vertex:'Vertex',edge:'Edge',face:'Face'};

export function installPolyEditMode({document,viewport,canvas,camera,objectFor,selectedId,setInfo=()=>{},blocked=()=>false,gizmo=null,overlayHit=()=>false,redraw=()=>{}}) {
  let objectId=null,gizmoState=null,box=null,pointer=null,hover=null;
  const hud=()=>{
    if(!edit.active())return;const s=edit.read();
    setInfo(`Edit Mode · ${LABEL[s.mode]} · ${s.counts.vertices} vertices, ${s.counts.edges} edges, ${s.counts.faces} faces selected${s.through?' · X-ray':''} · Tab exits · 1 2 3 modes · A all · B box · L linked · Alt+Z x-ray`);
  };
  const edit=createPolyEditMode({camera,canvas,onChange:()=>{hud();redraw();}});
  const rect=document.createElement?.('div');
  if(rect){rect.hidden=true;Object.assign(rect.style,{position:'absolute',border:'1px dashed #ff9a1f',background:'rgba(255,154,31,.08)',pointerEvents:'none',zIndex:20});viewport.appendChild?.(rect);}

  function enter(id=selectedId()){
    const object=id&&objectFor(id);if(!object)throw Error('Select a mesh object, then press Tab to edit it');
    const state=edit.enter(object,{objectId:id});objectId=id;
    // TransformControls draws through a separate helper object in current Three; stand both down.
    const helper=gizmo?.getHelper?.();
    if(gizmo&&!gizmoState){gizmoState={visible:gizmo.visible,enabled:gizmo.enabled,helperVisible:helper?.visible};gizmo.visible=false;gizmo.enabled=false;if(helper)helper.visible=false;}
    hud();redraw();return state;
  }
  function exit(){
    cancelBox();const state=edit.exit();objectId=null;
    if(gizmo&&gizmoState){gizmo.visible=gizmoState.visible;gizmo.enabled=gizmoState.enabled;const helper=gizmo.getHelper?.();if(helper&&gizmoState.helperVisible!==undefined)helper.visible=gizmoState.helperVisible;gizmoState=null;}
    setInfo('Object Mode');redraw();return state;
  }
  // The edited object can leave the scene (undo of its insertion, scene load); leave Edit Mode with it.
  const live=()=>{if(edit.active()&&!objectFor(objectId))exit();return edit.active();};
  function armBox(){box={start:null,mode:'extend'};setInfo('Box select · drag with the left button to add, the middle button to remove · Escape cancels');}
  function cancelBox(){box=null;if(rect)rect.hidden=true;}
  const insideCanvas=event=>{const r=canvas.getBoundingClientRect();return event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom;};
  const isText=target=>target?.closest?.('input,textarea,select,[contenteditable="true"]');
  const scoped=()=>document.activeElement===document.body||viewport.contains?.(document.activeElement)||viewport.matches?.(':hover');
  const steal=event=>{event.preventDefault();event.stopImmediatePropagation();};
  const attempt=work=>{try{return work();}catch(error){setInfo(error.message);return null;}};

  document.addEventListener('keydown',event=>{
    if(event.defaultPrevented||isText(event.target)||blocked())return;
    if(event.key==='Tab'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey){
      if(!scoped())return;steal(event);attempt(()=>edit.active()?exit():enter());return;
    }
    if(!live())return;
    if(box&&event.key==='Escape'){steal(event);cancelBox();hud();return;}
    if(event.ctrlKey||event.metaKey){if(event.code==='KeyL'){steal(event);attempt(()=>edit.linked());}return;}
    if(MODE_KEYS[event.code]&&!event.altKey&&!event.shiftKey){steal(event);attempt(()=>edit.setMode(MODE_KEYS[event.code]));return;}
    if(event.code==='KeyA'&&!event.shiftKey){steal(event);attempt(()=>edit.selectAll(event.altKey?'deselect':'select'));return;}
    if(event.code==='KeyZ'&&event.altKey&&!event.shiftKey){steal(event);attempt(()=>edit.setThrough(!edit.read().through));return;}
    if(event.altKey||event.shiftKey)return;
    if(event.code==='KeyB'){steal(event);armBox();return;}
    if(event.code==='KeyL'){steal(event);if(hover)attempt(()=>edit.linked({at:hover}));return;}
  },true);

  document.addEventListener('pointermove',event=>{
    if(!edit.active())return;
    if(insideCanvas(event))hover={x:event.clientX,y:event.clientY};
    if(box?.start&&rect){
      const v=viewport.getBoundingClientRect();
      Object.assign(rect.style,{left:Math.min(box.start.x,event.clientX)-v.left+'px',top:Math.min(box.start.y,event.clientY)-v.top+'px',width:Math.abs(event.clientX-box.start.x)+'px',height:Math.abs(event.clientY-box.start.y)+'px'});
      rect.hidden=false;
    }
  },true);
  document.addEventListener('pointerdown',event=>{
    if(!live()||!insideCanvas(event)||overlayHit(event))return;
    if(box){steal(event);if(event.button===2){cancelBox();hud();return;}box.start={x:event.clientX,y:event.clientY};box.mode=event.button===1?'subtract':'extend';return;}
    if(event.button===0)pointer={x:event.clientX,y:event.clientY,id:event.pointerId};
  },true);
  document.addEventListener('pointerup',event=>{
    if(!live())return;
    if(box?.start){steal(event);const r={x0:box.start.x,y0:box.start.y,x1:event.clientX,y1:event.clientY},mode=box.mode;cancelBox();attempt(()=>edit.box(r,{mode}));return;}
    if(!pointer||event.button!==0||event.pointerId!==pointer.id)return;
    const drift=Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y);pointer=null;
    if(drift<=5&&insideCanvas(event)&&!overlayHit(event))attempt(()=>edit.click(event.clientX,event.clientY,{extend:event.shiftKey}));
  },true);
  // Object selection listens to clicks; in Edit Mode a click picks components instead.
  for(const type of ['click','dblclick'])document.addEventListener(type,event=>{if(edit.active()&&insideCanvas(event)&&!overlayHit(event))steal(event);},true);

  const api=Object.freeze({
    active:()=>live(),read:()=>edit.read(),enter,exit,
    setMode:mode=>edit.setMode(mode),pickAt:(x,y)=>edit.pickAt(x,y),click:(x,y,options)=>edit.click(x,y,options),selectAll:action=>edit.selectAll(action),
    box:(r,options)=>edit.box(r,options),linked:options=>edit.linked(options),setThrough:on=>edit.setThrough(on),
    // Where a point in the edited mesh's own frame appears on screen, for agents aiming clicks.
    screenOf:point=>edit.screenOf(point),
    canvasRect:()=>{const r=canvas.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};},
  });
  return {active:()=>live(),api};
}
