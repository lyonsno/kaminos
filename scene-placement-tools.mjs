import { Vector3, Vector2, Raycaster, Plane } from './lib/three.core.js';
import { createSceneEdits, transformPose, axisVector } from './scene-edit-session.mjs';

export function installScenePlacementTools({viewport, camera, controls, gizmo, selected, read, write, object, refresh, allowed, busy, frameSelected = () => {}, selectionFeedback = () => {}}) {
  const hud=document.createElement('div');hud.id='scene-edit-hud';hud.setAttribute('role','status');
  const overlay=document.createElementNS('http://www.w3.org/2000/svg','svg');overlay.id='scene-edit-overlay';
  overlay.setAttribute('aria-hidden','true');viewport.append(overlay,hud);
  let modal=null,field=null,lastPointer={x:0,y:0},hover=false,suppressClick=false,gizmoEditing=false,gizmoPrior=null,pointerOrigin=null;
  const priorControls=()=>({controls:controls.enabled,gizmo:gizmo.enabled,helper:gizmo.getHelper().visible});
  const restoreControls=prior=>{if(prior){controls.enabled=prior.controls;gizmo.enabled=prior.gizmo;gizmo.getHelper().visible=prior.helper;}};
  const edits=createSceneEdits({read,write,admit:()=>{
    if(!allowed())throw Error('Finish preview or correction before editing placement');
    if(busy())throw Error('Wait for the current authoring action before editing placement');
  },changed:()=>{refresh();draw();}});
  const state=()=>({...edits.state(),gizmoEditing,gizmoDragging:gizmo.dragging,gizmoVisible:gizmo.getHelper().visible,controlsEnabled:controls.enabled,modal:modal?{operation:modal.operation,axis:modal.axis,frame:modal.frame,plane:modal.plane,numeric:modal.numeric,snapping:modal.snap}:null});
  const isText=target=>!!target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
  const steal=e=>{e.preventDefault();e.stopImmediatePropagation();};
  const pose=()=>read(selected());
  const viewAxis=()=>camera.getWorldDirection(new Vector3()).negate();
  function screen(v) {const p=v.clone().project(camera);return new Vector2((p.x+1)*viewport.clientWidth/2,(1-p.y)*viewport.clientHeight/2);}
  function ray(point) {const r=viewport.getBoundingClientRect(),cast=new Raycaster();cast.setFromCamera(new Vector2(2*(point.x-r.left)/r.width-1,1-2*(point.y-r.top)/r.height),camera);return cast.ray;}
  function finish(commit=true) {
    if(!edits.state().active && !gizmoEditing)return false;
    // Clear UI ownership before notification from commit/cancel.
    const prior=modal?.prior || gizmoPrior, capture=field?.capture || (gizmoEditing?pointerOrigin:null);
    modal=null;field=null;gizmoEditing=false;gizmoPrior=null;
    if(gizmo.dragging){gizmo.pointerUp({button:0});gizmo.dragging=false;gizmo.axis=null;}
    if(capture?.target?.hasPointerCapture?.(capture.pointerId))capture.target.releasePointerCapture(capture.pointerId);
    let error;
    try{commit?edits.commit():edits.cancel();}catch(e){error=e;edits.cancel();}
    restoreControls(prior);draw();if(error)hud.textContent=error.message;return !error;
  }
  function begin(id,label){try{edits.begin(id,label);return true;}catch(error){hud.textContent=error.message;return false;}}
  function start(operation) {
    if(!allowed() || busy() || !selected())return false;
    if(field)finish(true);
    if(!modal) {
      if(!begin(selected(),'Placement'))return false;
      modal={axis:null,plane:false,frame:'world',frameRotation:[...pose().rotation],numeric:'',snap:false,precise:false,
        prior:priorControls()};
    }
    modal.base=structuredClone(edits.state().active.before);
    edits.preview(modal.base);
    modal.operation=operation;modal.anchor={...lastPointer};modal.numeric='';modal.amount=operation==='scale'?1:0;
    // Axis scale is explicitly local: root TRS has no shear channel.
    if(operation==='scale' && modal.axis)modal.frame='local';
    controls.enabled=false;gizmo.enabled=false;gizmo.getHelper().visible=false;draw();return true;
  }
  function preview() {
    if(!modal)return;
    const m=modal,dx=lastPointer.x-m.anchor.x,dy=lastPointer.y-m.anchor.y;
    const pivot=new Vector3(...m.base.position),forward=viewAxis();
    let planeNormal=forward.clone(),axis=m.axis?axisVector(m.axis,m.frame,m.frameRotation):null;
    if(axis && !m.plane) {
      planeNormal.addScaledVector(axis,-planeNormal.dot(axis));
      if(planeNormal.lengthSq()<1e-8)planeNormal=camera.up.clone();
      planeNormal.normalize();
    } else if(axis)planeNormal=axis.clone();
    const plane=new Plane().setFromNormalAndCoplanarPoint(planeNormal,pivot);
    const p0=ray(m.anchor).intersectPlane(plane,new Vector3()),p1=ray(lastPointer).intersectPlane(plane,new Vector3());
    const unitsPerPixel=2*camera.position.distanceTo(pivot)*Math.tan(camera.fov*Math.PI/360)/viewport.clientHeight;
    let delta=p0&&p1?p1.sub(p0):new Vector3(dx*unitsPerPixel,-dy*unitsPerPixel,0);
    let amount=m.operation==='translate' ? (axis?delta.dot(axis):delta.length()) : m.operation==='scale'?1+dx/150:dx*.01;
    if(m.operation==='rotate') {
      const center=screen(pivot),rect=viewport.getBoundingClientRect();
      const a=new Vector2(m.anchor.x-rect.left-center.x,m.anchor.y-rect.top-center.y);
      const b=new Vector2(lastPointer.x-rect.left-center.x,lastPointer.y-rect.top-center.y);
      if(a.length()>20 && b.length()>20)amount=Math.atan2(a.x*b.y-a.y*b.x,a.dot(b)) * -1;
      if(axis && axis.dot(forward)<0)amount*=-1;
    }
    if(m.precise){delta.multiplyScalar(.1);amount=m.operation==='scale'?1+(amount-1)*.1:amount*.1;}
    if(m.numeric) {
      const value=Number(m.numeric);if(!Number.isFinite(value) || ['-','.','-.'].includes(m.numeric)){draw();return;}
      amount=m.operation==='rotate'?value*Math.PI/180:value;
      if(m.operation==='translate' && (!m.axis || m.plane)) {
        if(delta.lengthSq()<1e-12)delta=new Vector3(1,0,0).applyQuaternion(camera.quaternion);
        delta.normalize().multiplyScalar(amount);
      }
    }
    const snap=m.snap ? (m.operation==='rotate'?Math.PI/36:.1):0;
    edits.preview(transformPose(m.base,{...m,amount,delta:delta.toArray(),viewAxis:forward.toArray(),snap}));
    m.amount=amount;draw();
  }
  function draw() {
    camera.updateMatrixWorld(true);
    const id=selected(),target=id?object(id):null,m=modal;
    selectionFeedback(target);
    hud.dataset.active=String(!!edits.state().active);
    if(m) {
      const value=m.numeric || (m.operation==='rotate'?((m.amount||0)*180/Math.PI).toFixed(1)+'°':(m.amount??(m.operation==='scale'?1:0)).toFixed(3));
      hud.textContent=`${{translate:'Move',rotate:'Rotate',scale:'Scale'}[m.operation]} ${m.axis?(m.plane?'plane ⟂ ':'')+m.axis.toUpperCase():''} · ${m.axis?m.frame:'view'} · ${value} · ${m.snap?'Snap '+(m.operation==='rotate'?'5°':'0.1')+' · ':''}Enter / LMB confirm · Esc / RMB cancel`;
    } else if(field)hud.textContent='Edit value · drag axis label to adjust · Enter confirm · Esc cancel';
    else hud.textContent=id?`${id} · G Move · R Rotate · S Scale · X/Y/Z constrain · Ctrl snap · Shift precision · F frame selected · ⌘/Ctrl Z undo`:'Select an object to place it';
    overlay.setAttribute('viewBox',`0 0 ${viewport.clientWidth} ${viewport.clientHeight}`);
    let lines='';
    const line=(a,b,color,opacity=1,dash='')=>{if([a.x,a.y,b.x,b.y].every(Number.isFinite))lines+=`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" opacity="${opacity}" stroke-width="1.3" ${dash?`stroke-dasharray="${dash}"`:''}/>`;};
    if(target) {
      target.updateWorldMatrix(true,true);
      const origin=screen(new Vector3(...pose().position));
      for(const [a,b] of [[[0,-5],[5,0]],[[5,0],[0,5]],[[0,5],[-5,0]],[[-5,0],[0,-5]]])
        line(origin.clone().add(new Vector2(...a)),origin.clone().add(new Vector2(...b)),'#efa544');
      if(m?.axis) {
        const pivot=new Vector3(...m.base.position),p=screen(pivot);
        const d=axisVector(m.axis,m.frame,m.frameRotation).multiplyScalar(camera.position.distanceTo(pivot)*.01);
        const axisOnScreen=screen(pivot.clone().add(d)).sub(p).normalize().multiplyScalar(Math.hypot(viewport.clientWidth,viewport.clientHeight));
        line(p.clone().sub(axisOnScreen),p.clone().add(axisOnScreen),{x:'#ed6565',y:'#8cca68',z:'#669fee'}[m.axis],.8,'5 3');
      }
    }
    overlay.innerHTML=lines;
  }
  function changeSelection() {if(edits.state().active)finish(false);draw();}
  controls.addEventListener('change',draw);
  new ResizeObserver(draw).observe(viewport);
  viewport.addEventListener('pointerenter',()=>hover=true);
  viewport.addEventListener('pointerleave',()=>hover=false);
  document.addEventListener('pointermove',e=>{
    lastPointer={x:e.clientX,y:e.clientY};
    if(modal){modal.snap=e.ctrlKey;modal.precise=e.shiftKey;try{preview();}catch(error){finish(false);hud.textContent=error.message;}}
    if(field?.drag) {
      const delta=(e.clientX-field.startX)*(e.shiftKey?.1:1)*field.step;
      field.input.value=String(field.startValue+delta);fieldInput(field.input);
    }
  },true);
  document.addEventListener('pointerdown',e=>{if(modal && !viewport.contains(e.target))finish(false);},true);
  viewport.addEventListener('pointerdown',e=>{
    pointerOrigin={target:e.target,pointerId:e.pointerId,prior:priorControls()};
    if(!modal)return;steal(e);suppressClick=true;finish(e.button!==2);
  },true);
  for(const type of ['pointerup','mousedown','mouseup','click','dblclick','contextmenu'])viewport.addEventListener(type,e=>{
    if(modal || suppressClick){steal(e);if(type==='click' || type==='contextmenu')suppressClick=false;}
  },true);
  document.addEventListener('keydown',e=>{
    if(gizmoEditing && e.key==='Escape'){steal(e);finish(false);return;}
    if(field && e.key==='Escape'){steal(e);const input=field.input;finish(false);input.blur();refresh();return;}
    if(field && e.key==='Enter'){steal(e);const input=field.input;finish(true);input.blur();return;}
    if(isText(e.target))return;
    const key=e.key.toLowerCase();
    if(modal) {
      steal(e);
      if(e.key==='Escape'){finish(false);return;}
      if(e.key==='Enter'){finish(true);return;}
      if(['g','r','s'].includes(key)){start({g:'translate',r:'rotate',s:'scale'}[key]);return;}
      if(['x','y','z'].includes(key)) {
        if(modal.axis===key && modal.plane===e.shiftKey) {
          if(modal.frame==='world' && modal.operation!=='scale')modal.frame='local';else {modal.axis=null;modal.plane=false;modal.frame='world';}
        } else {modal.axis=key;modal.plane=e.shiftKey;modal.frame=modal.operation==='scale'?'local':'world';}
      } else if(e.key==='Backspace')modal.numeric=modal.numeric.slice(0,-1);
      else if(/^[0-9.\-]$/.test(e.key))modal.numeric+=e.key;
      modal.snap=e.ctrlKey;modal.precise=e.shiftKey;preview();return;
    }
    if(!(hover || viewport.contains(document.activeElement)) || !allowed() || busy())return;
    if((e.ctrlKey || e.metaKey) && key==='z') {steal(e);try{e.shiftKey?edits.redo():edits.undo();}catch(error){hud.textContent=error.message;}return;}
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    if(key==='f' || e.code==='NumpadDecimal'){steal(e);frameSelected();return;}
    if(['g','r','s'].includes(key)){steal(e);start({g:'translate',r:'rotate',s:'scale'}[key]);}
  },true);
  document.addEventListener('keyup',e=>{if(modal && ['Control','Shift'].includes(e.key)){modal.snap=e.ctrlKey;modal.precise=e.shiftKey;preview();}},true);
  window.addEventListener('blur',()=>{if(edits.state().active)finish(false);});
  function fieldInput(input) {
    if(!input.value.trim() || !Number.isFinite(input.valueAsNumber))return;
    const [group,axis]=input.dataset.transformField.split('.'),p=pose();
    if(!p)return;
    const i={x:0,y:1,z:2}[axis],factor=group==='rotation'?Math.PI/180:1;
    if(!field){if(!begin(selected(),'Edit '+input.dataset.transformField)){input.value=String(p[group][i]/factor);return;}field={input};}
    p[group][i]=input.valueAsNumber*factor;
    try{edits.preview(p);}catch(error){finish(false);input.value=String(pose()[group][i]/factor);hud.textContent=error.message;}
  }
  for(const input of document.querySelectorAll('[data-transform-field]')) {
    input.step='any';
    input.addEventListener('input',()=>fieldInput(input));
    input.addEventListener('blur',()=>{if(field?.input===input && !field.drag)finish(true);});
    input.addEventListener('change',()=>{if(field?.input===input && !field.drag)finish(true);});
    const grip=input.parentElement.querySelector('.transform-axis');
    grip.title='Drag to adjust; edit the number to type';grip.style.cursor='ew-resize';grip.style.touchAction='none';
    grip.addEventListener('pointerdown',e=>{
      if(e.button!==0 || !selected())return;
      e.preventDefault();if(edits.state().active)finish(true);
      const [group,axis]=input.dataset.transformField.split('.');
      const startValue=pose()[group][{x:0,y:1,z:2}[axis]]*(group==='rotation'?180/Math.PI:1);
      if(!begin(selected(),'Adjust '+input.dataset.transformField))return;
      field={input,drag:true,startX:e.clientX,startValue,step:group==='rotation'?.2:.01,capture:{target:grip,pointerId:e.pointerId}};grip.setPointerCapture(e.pointerId);draw();
    });
    grip.addEventListener('pointerup',()=>{if(field?.drag)finish(true);});
    grip.addEventListener('pointercancel',()=>{if(field?.drag)finish(false);});
    grip.addEventListener('lostpointercapture',()=>{if(field?.drag)finish(false);});
  }
  gizmo.addEventListener('mouseDown',()=>{
    if(!allowed())return; // The correction tool owns its own native gizmo.
    gizmoPrior=pointerOrigin?.prior || priorControls();gizmoEditing=true;
    if(!selected() || !begin(selected(),'Gizmo transform'))finish(false);
  });
  gizmo.addEventListener('mouseUp',()=>{if(gizmoEditing){const prior=gizmoPrior;finish(true);queueMicrotask(()=>restoreControls(prior));}});
  draw();
  return {edits,state,start,finish,selectionChanged:changeSelection,draw,
    clear(){finish(false);edits.clear();draw();},
    suspendVisuals(value){selectionFeedback(value?null:object(selected()));overlay.style.visibility=value?'hidden':'';hud.style.visibility=value?'hidden':'';}};
}
