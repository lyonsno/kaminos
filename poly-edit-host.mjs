// Edit Mode inside the authoring app: Blender's keys and pointer grammar on top of
// the polygon Edit Mode controller. The app supplies its services; this module adds
// listeners in the capture phase and exposes the same operations to agents. Object
// tools must also check active() (admission guards), since listener order alone
// does not decide which mode owns a key.
import {createPolyEditMode} from './poly-edit-mode.mjs';

const CLICK_DRIFT=5,MODE_KEYS={Digit1:'vertex',Digit2:'edge',Digit3:'face'},LABEL={vertex:'Vertex',edge:'Edge',face:'Face'};

export function installPolyEditMode({document,viewport,canvas,camera,objectFor,selectedId,setInfo=()=>{},blocked=()=>false,gizmo=null,overlayHit=()=>false,redraw=()=>{},separate=null,slice=null,origin=null}) {
  let separating=false,cutLine=null,objectId=null,gizmoState=null,box=null,pointer=null,hover=null;
  const hud=()=>{
    if(!edit.active())return;const s=edit.read();
    setInfo(`Edit Mode · ${LABEL[s.mode]} · ${s.counts.vertices} vertices, ${s.counts.edges} edges, ${s.counts.faces} faces selected${s.through?' · X-ray':''} · Tab exits · 1 2 3 modes · A all · drag or B box · L linked · P separate · K slice · Shift+S origin · Alt+Z x-ray`);
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
    cancelAll();const state=edit.exit();objectId=null;
    if(gizmo&&gizmoState){gizmo.visible=gizmoState.visible;gizmo.enabled=gizmoState.enabled;const helper=gizmo.getHelper?.();if(helper&&gizmoState.helperVisible!==undefined)helper.visible=gizmoState.helperVisible;gizmoState=null;}
    setInfo('Object Mode');redraw();return state;
  }
  // The edited object can leave the scene (undo of its insertion, scene load); leave Edit Mode with it.
  const live=()=>{if(edit.active()&&!objectFor(objectId))exit();return edit.active();};
  // The cut for Slice (K). A drag draws a line (with Shift, a circle from a joint's centre to its
  // rim). It does not cut yet: it waits as a pending cut, anchored on the geometry at the
  // selection's depth, with a handle at each end and the outline it would cut drawn on the mesh.
  // Dragging a handle reshapes it; Enter or Space cuts; Escape drops it.
  const overlayDiv=style=>{const div=document.createElement?.('div');if(div){div.hidden=true;Object.assign(div.style,{position:'absolute',pointerEvents:'none',zIndex:20,...style});viewport.appendChild?.(div);}return div;};
  const line=overlayDiv({height:'0',borderTop:'2px dashed #ff9a1f',transformOrigin:'0 0'}),ring=overlayDiv({border:'2px dashed #ff9a1f',borderRadius:'50%'});
  const handles=[0,1].map(()=>overlayDiv({width:'12px',height:'12px',marginLeft:'-7px',marginTop:'-7px',borderRadius:'50%',border:'2px solid #ff9a1f',background:'#fff'}));
  const HANDLE_REACH=12;
  function armCut(){cancelBox();cutLine={start:null,pending:null,dragging:null};setInfo('Slice · drag a line across the selected faces · Shift-drag from a joint\'s centre to its rim for a hinge circle · Escape cancels');}
  function hideCut(){for(const div of [line,ring,...handles])if(div)div.hidden=true;}
  function cancelCut(){cutLine=null;hideCut();if(edit.active())edit.clearPreview();}
  // Drawn in the view it was made in, a cut's own outline lies edge-on along this line or ring,
  // so the line or ring carries the verdict: cyan when every outline closes, red when some stay
  // open. Orbit to see the outlines themselves on the mesh.
  const CUT_COLOURS={drawing:'#ff9a1f',closes:'#3cf0ff',open:'#ff3b30'};
  function paintCut(state){const colour=CUT_COLOURS[state];if(line)line.style.borderTopColor=colour;if(ring)ring.style.borderColor=colour;for(const h of handles)if(h)h.style.borderColor=colour;}
  function drawShape(a,b,circle){
    const v=viewport.getBoundingClientRect(),dx=b.x-a.x,dy=b.y-a.y,r=Math.hypot(dx,dy);
    if(line)line.hidden=circle;if(ring)ring.hidden=!circle;
    if(circle&&ring)Object.assign(ring.style,{left:a.x-r-v.left+'px',top:a.y-r-v.top+'px',width:2*r+'px',height:2*r+'px'});
    if(!circle&&line)Object.assign(line.style,{left:a.x-v.left+'px',top:a.y-v.top+'px',width:r+'px',transform:`rotate(${Math.atan2(dy,dx)}rad)`});
  }
  const pendingScreens=()=>cutLine.pending.anchors.map(anchor=>edit.screenOf(anchor));
  // Keep the drawn line and handles on their anchors as the view moves.
  function followView(){
    if(!cutLine?.pending)return;const v=viewport.getBoundingClientRect(),[a,b]=pendingScreens();
    drawShape(a,b,cutLine.pending.circle);
    [a,b].forEach((q,i)=>{if(handles[i]){Object.assign(handles[i].style,{left:q.x-v.left+'px',top:q.y-v.top+'px'});handles[i].hidden=false;}});
    globalThis.requestAnimationFrame?.(followView);
  }
  function reshapeCut(){
    const p=cutLine.pending,[a,b]=pendingScreens();
    p.shape=p.circle?edit.circleFromDrag(a.x,a.y,b.x,b.y):edit.planeFromLine(a.x,a.y,b.x,b.y);
    p.preview=edit.previewCut(p.shape);paintCut(p.preview.open?'open':'closes');
    setInfo(`Cut preview · ${p.preview.closed} outline${p.preview.closed===1?'':'s'} will close and fill (cyan)${p.preview.open?` · ${p.preview.open} stay open (red)`:''} · drag the handles to adjust · Enter or Space cuts · Escape cancels`);
  }
  function settleCut(from,to,circle){
    cutLine.start=null;
    const anchors=[edit.pointAtScreen(from.x,from.y),edit.pointAtScreen(to.x,to.y)];
    cutLine.pending={circle,anchors,shape:null,preview:null};
    if(attempt(()=>{reshapeCut();return true;})===null){cancelCut();return;}
    followView();
  }
  function adjustCut(index,x,y){
    const p=cutLine?.pending;if(!p)throw Error('No pending cut to adjust');
    const before=p.anchors[index];p.anchors[index]=edit.pointAtScreen(x,y);
    try{reshapeCut();}catch(error){p.anchors[index]=before;reshapeCut();throw error;}
    followView();return pendingCut();
  }
  function confirmCut(){const shape=cutLine?.pending?.shape;if(!shape)return null;cancelCut();hud();return runOnce(()=>slice(shape));}
  function pendingCut(){const p=cutLine?.pending;return p?{circle:p.circle,shape:p.shape,preview:p.preview,verdict:p.preview?.open?'open':'closes',handles:pendingScreens().map(({x,y})=>({x,y}))}:null;}
  function armBox(){cancelCut();box={start:null,mode:'extend'};setInfo('Box select · drag with the left button to add, the middle button to remove · Escape cancels');}
  function cancelBox(){box=null;pointer=null;if(rect)rect.hidden=true;}
  function cancelAll(){cancelBox();cancelCut();}
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
    if((box||cutLine)&&event.key==='Escape'){steal(event);cancelAll();hud();return;}
    if(cutLine?.pending&&['Enter','NumpadEnter','Space'].includes(event.code)){steal(event);confirmCut();return;}
    if(event.ctrlKey||event.metaKey){if(event.code==='KeyL'){steal(event);attempt(()=>edit.linked());}return;}
    if(MODE_KEYS[event.code]&&!event.altKey&&!event.shiftKey){steal(event);attempt(()=>edit.setMode(MODE_KEYS[event.code]));return;}
    if(event.code==='KeyA'&&!event.shiftKey){steal(event);attempt(()=>edit.selectAll(event.altKey?'deselect':'select'));return;}
    if(event.code==='KeyZ'&&event.altKey&&!event.shiftKey){steal(event);attempt(()=>edit.setThrough(!edit.read().through));return;}
    // Shift+S: Origin to Selection. Blender's Shift+S snap pie puts the 3D cursor there first;
    // Kaminos has no 3D cursor, so the origin goes straight to the selection's median.
    if(event.code==='KeyS'&&event.shiftKey&&!event.altKey&&origin){steal(event);runOnce(origin);return;}
    if(event.altKey||event.shiftKey)return;
    if(event.code==='KeyB'){steal(event);armBox();return;}
    // P: Separate > Selection. The app owns the scene change and its history; one runs at a time.
    if(event.code==='KeyP'&&separate){steal(event);runOnce(separate);return;}
    if(event.code==='KeyK'&&slice){steal(event);armCut();return;}
    if(event.code==='KeyL'){steal(event);if(hover)attempt(()=>edit.linked({at:hover}));return;}
  },true);

  document.addEventListener('pointermove',event=>{
    if(!edit.active())return;
    if(insideCanvas(event))hover={x:event.clientX,y:event.clientY};
    if(cutLine?.dragging!=null){attempt(()=>adjustCut(cutLine.dragging,event.clientX,event.clientY));return;}
    if(cutLine?.start){drawShape(cutLine.start,{x:event.clientX,y:event.clientY},cutLine.circle);return;}
    // A left drag past the click tolerance becomes a box, as Blender's Select Box tool.
    if(pointer&&!pointer.dragging&&event.pointerId===pointer.id&&Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>CLICK_DRIFT)pointer.dragging=true;
    const start=box?.start??(pointer?.dragging?pointer:null);
    if(start&&rect){
      const v=viewport.getBoundingClientRect();
      Object.assign(rect.style,{left:Math.min(start.x,event.clientX)-v.left+'px',top:Math.min(start.y,event.clientY)-v.top+'px',width:Math.abs(event.clientX-start.x)+'px',height:Math.abs(event.clientY-start.y)+'px'});
      rect.hidden=false;
    }
  },true);
  document.addEventListener('pointerdown',event=>{
    if(!live()||!insideCanvas(event)||overlayHit(event))return;
    // With Shift held, the drag is a circle from the joint's centre to its rim (a hinge cut).
    if(cutLine){
      // Other buttons navigate (orbit, pan) and leave a pending cut alone; a right click while
      // still drawing drops the drawing. Escape drops a pending cut.
      if(event.button!==0){if(cutLine.start&&event.button===2){steal(event);cancelCut();hud();}return;}
      steal(event);
      // On a handle, adjust the pending cut; anywhere else, draw a new one in its place.
      if(cutLine.pending){const near=pendingScreens().findIndex(q=>Math.hypot(q.x-event.clientX,q.y-event.clientY)<=HANDLE_REACH);if(near>=0){cutLine.dragging=near;return;}cutLine.pending=null;edit.clearPreview();hideCut();}
      cutLine.start={x:event.clientX,y:event.clientY};cutLine.circle=event.shiftKey;paintCut('drawing');return;
    }
    if(box){steal(event);if(event.button===2){cancelBox();hud();return;}box.start={x:event.clientX,y:event.clientY};box.mode=event.button===1?'subtract':'extend';return;}
    if(event.button===0)pointer={x:event.clientX,y:event.clientY,id:event.pointerId};
  },true);
  document.addEventListener('pointerup',event=>{
    if(!live())return;
    if(cutLine?.dragging!=null){steal(event);cutLine.dragging=null;return;}
    if(cutLine?.start){steal(event);settleCut(cutLine.start,{x:event.clientX,y:event.clientY},cutLine.circle);return;}
    if(box?.start){steal(event);const r={x0:box.start.x,y0:box.start.y,x1:event.clientX,y1:event.clientY},mode=box.mode;cancelBox();attempt(()=>edit.box(r,{mode}));return;}
    if(!pointer||event.button!==0||event.pointerId!==pointer.id)return;
    const down=pointer;pointer=null;
    if(down.dragging){
      steal(event);if(rect)rect.hidden=true;
      // Plain replaces, Shift adds, Ctrl or Cmd removes (Ctrl-click is a right click on a Mac trackpad).
      const mode=event.ctrlKey||event.metaKey?'subtract':event.shiftKey?'extend':'set';
      attempt(()=>edit.box({x0:down.x,y0:down.y,x1:event.clientX,y1:event.clientY},{mode}));return;
    }
    if(insideCanvas(event)&&!overlayHit(event))attempt(()=>edit.click(event.clientX,event.clientY,{extend:event.shiftKey}));
  },true);
  // Object selection listens to clicks; in Edit Mode a click picks components instead.
  for(const type of ['click','dblclick'])document.addEventListener(type,event=>{if(edit.active()&&insideCanvas(event)&&!overlayHit(event))steal(event);},true);

  // Separate and Slice change the scene through the app; one runs at a time.
  function runOnce(work){
    if(separating)return null;separating=true;
    // Called now, so the app reads the selection as it was when the key was pressed.
    let running;try{running=Promise.resolve(work());}catch(error){running=Promise.reject(error);}
    return running.catch(error=>{setInfo(error.message);return null;}).finally(()=>{separating=false;});
  }

  const api=Object.freeze({
    active:()=>live(),read:()=>edit.read(),enter,exit,
    setMode:mode=>edit.setMode(mode),pickAt:(x,y)=>edit.pickAt(x,y),click:(x,y,options)=>edit.click(x,y,options),selectAll:action=>edit.selectAll(action),
    box:(r,options)=>edit.box(r,options),linked:options=>edit.linked(options),setThrough:on=>edit.setThrough(on),separate:()=>runOnce(separate),slice:plane=>runOnce(()=>slice(plane)),pendingCut:()=>pendingCut(),adjustCut:(index,x,y)=>adjustCut(index,x,y),confirmCut:()=>confirmCut(),originToSelection:()=>runOnce(origin),selectionMedian:()=>edit.selectionMedian(),planeFromLine:(x0,y0,x1,y1)=>edit.planeFromLine(x0,y0,x1,y1),circleFromDrag:(x0,y0,x1,y1)=>edit.circleFromDrag(x0,y0,x1,y1),
    selectedFaceMask:()=>edit.selectedFaceMask(),geometry:()=>edit.geometry(),
    // Where a point in the edited mesh's own frame appears on screen, for agents aiming clicks.
    screenOf:point=>edit.screenOf(point),
    canvasRect:()=>{const r=canvas.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};},
  });
  return {active:()=>live(),api};
}
