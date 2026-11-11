import * as THREE from './lib/three.core.js';
import {checkedSpace,rebuildSpace,pullSpace,spaceDirection,nextSpaceClaimId,transformSpaceClaim,compileSpace} from './stockroom-space.mjs';

export function createSpaceEditing({document,viewport,canvas,camera,navigation,entries,selected,edits,ownerControls,components,nativeInteraction=()=>false,redraw,onError}){
 const seats=new Map(),targets=new Set();let gesture=null,hover=null,syncing=false,suppressClick=false;
 const find=id=>entries().find(e=>e.id===id),recipe=id=>checkedSpace(find(id)?.object.userData.stockroomSpace);
 const isActive=seat=>seat.enabled&&find(seat.id)?.object===seat.root&&(selected()?.id===seat.id||selected()?.ownerId===seat.id)&&seat.root.visible;
 function ray(event){const r=canvas.getBoundingClientRect(),caster=new THREE.Raycaster();caster.setFromCamera(new THREE.Vector2(2*(event.clientX-r.left)/r.width-1,1-2*(event.clientY-r.top)/r.height),camera);return caster;}
 function screen(point,root){root.updateWorldMatrix(true,false);const r=canvas.getBoundingClientRect(),vp=viewport.getBoundingClientRect(),p=new THREE.Vector3(...point).applyMatrix4(root.matrixWorld).project(camera);return {x:r.left-vp.left+(p.x+1)*r.width/2,y:r.top-vp.top+(1-p.y)*r.height/2,visible:p.z>=-1&&p.z<=1};}
 function hidePreview(){if(hover)hover.seat.helper.visible=false;hover=null;for(const s of seats.values()){s.surface.hidden=true;delete s.overlay.dataset.spacePreview;}redraw();}
 function preview(seat,probe){
  const axis=spaceDirection(recipe(seat.id),probe),next={...structuredClone(probe),axis};
  if(!probe.claim&&seat.role==='empty')next.axis=axis.map(x=>-x);
  if(hover?.seat!==seat)hidePreview();hover={seat,probe:next};
  const point=new THREE.Vector3(...probe.point).applyMatrix4(seat.root.matrixWorld),direction=new THREE.Vector3(...next.axis).transformDirection(seat.root.matrixWorld);
  seat.helper.position.copy(point);seat.forward.setDirection(direction);seat.backward.setDirection(direction.clone().negate());seat.helper.visible=true;
  seat.ring.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),direction);
  seat.overlay.dataset.spacePreview=JSON.stringify({point:probe.point,axis:next.axis,claim:probe.claim??null,role:probe.claim?recipe(seat.id).claims.find(c=>c.id===probe.claim).role:seat.role});
  redraw();return next;
 }
 function updateHandles(){
  for(const seat of seats.values()){
   const active=isActive(seat);seat.overlay.hidden=!active;seat.helper.visible=active&&hover?.seat===seat;if(!active)continue;
   const p=recipe(seat.id),wanted=new Set(),distance=compileSpace(p);
   for(const c of p.claims){
    if(c.id!==seat.focus)continue;
    const rotation=new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...c.rotation));
    for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
     const key=`${c.id}:${axis}:${sign}`;wanted.add(key);let button=seat.handles.get(key);
     if(!button){button=document.createElement('button');button.type='button';button.dataset.spaceHandle=key;
      button.style.cssText='position:absolute;transform:translate(-50%,-50%);width:18px;height:18px;padding:0;border-radius:50%;border:2px solid #e6e4dc;background:#303335;pointer-events:auto;touch-action:none;cursor:grab;box-shadow:0 1px 4px #0008';
      button.addEventListener('pointerenter',()=>{if(!gesture)preview(seat,button.probe);});wireGesture(button,seat,()=>button.probe);seat.overlay.append(button);seat.handles.set(key,button);
     }
     const offset=new THREE.Vector3();offset.setComponent(axis,c.radii[axis]*sign);offset.applyMatrix4(rotation).add(new THREE.Vector3(...c.center));button.probe={claim:c.id,point:offset.toArray()};
     const pos=screen(offset.toArray(),seat.root);button.hidden=!pos.visible||Math.abs(distance(...offset.toArray()))>.06;button.style.left=`${pos.x}px`;button.style.top=`${pos.y}px`;button.style.background=c.role==='empty'?'#303335':'#e6e4dc';
     button.title=`${c.id} - ${c.role==='empty'?'Keep empty':'Occupy'} - ${['width','height','depth'][axis]} ${sign>0?'+':'-'}`;button.setAttribute('aria-label',button.title);
    }
   }
   for(const [key,b]of seat.handles)if(!wanted.has(key)){b.remove();seat.handles.delete(key);}
  }
 }
 function begin(event,seat,probe){
  if(event.button!==0||gesture||!isActive(seat))return;event.preventDefault();event.stopPropagation();
  try{
   // Lock precisely the affordance already displayed before mouse-down.
   const locked=hover?.seat===seat&&JSON.stringify(hover.probe.point)===JSON.stringify(probe.point)?structuredClone(hover.probe):preview(seat,probe),original=recipe(seat.id);locked.id=nextSpaceClaimId(original);
   seat.root.updateWorldMatrix(true,false);const origin=new THREE.Vector3(...locked.point).applyMatrix4(seat.root.matrixWorld),worldAxis=new THREE.Vector3(...locked.axis).transformDirection(seat.root.matrixWorld),view=ray(event).ray;
   const normal=view.direction.clone().addScaledVector(worldAxis,-view.direction.dot(worldAxis));if(normal.lengthSq()<1e-8)throw Error('View this direction from the side to pull it');
   const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(normal.normalize(),origin),start=view.intersectPlane(plane,new THREE.Vector3());if(!start)return;
   edits.begin(seat.target,locked.claim?'Shape region':'Claim region');
   gesture={seat,probe:locked,original,plane,start,inverse:seat.root.matrixWorld.clone().invert(),element:event.currentTarget,pointerId:event.pointerId,navigation:navigation.enabled,role:seat.role};
   navigation.enabled=false;event.currentTarget.setPointerCapture(event.pointerId);seat.overlay.dataset.spaceDragging='true';
  }catch(error){onError(error);}
 }
 function move(event){
  const g=gesture;if(!g||g.pointerId!==event.pointerId)return;event.preventDefault();event.stopPropagation();const point=ray(event).ray.intersectPlane(g.plane,new THREE.Vector3());if(!point)return;
  const delta=point.applyMatrix4(g.inverse).sub(g.start.clone().applyMatrix4(g.inverse)).dot(new THREE.Vector3(...g.probe.axis));
  try{edits.preview(pullSpace(g.original,g.probe,delta,g.role));g.seat.error.textContent='';}catch(error){g.seat.error.textContent=error.message;}
 }
 function finish(cancel){
  if(!gesture)return;const g=gesture;gesture=null;g.seat.overlay.dataset.spaceDragging='false';navigation.enabled=g.navigation;suppressClick=g.element===canvas;
  if(edits.state().active?.id===g.seat.target){if(cancel)edits.cancel();else edits.commit();}
  if(!cancel&&!g.probe.claim&&recipe(g.seat.id).claims.some(c=>c.id===g.probe.id)){g.seat.focus=g.probe.id;g.seat.list.value=g.probe.id;}
  if(g.element.hasPointerCapture(g.pointerId))g.element.releasePointerCapture(g.pointerId);hidePreview();sync();
 }
 function wireGesture(button,seat,probe){
  button.addEventListener('pointerdown',e=>begin(e,seat,probe()));button.addEventListener('pointermove',move);button.addEventListener('pointerup',e=>{e.preventDefault();e.stopPropagation();finish(false);});
  button.addEventListener('pointercancel',()=>finish(true));button.addEventListener('lostpointercapture',()=>finish(true));button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();});
 }
 function pointerMove(event){
  if(gesture||event.buttons||event.target.closest?.('[data-space-handle]'))return;if(nativeInteraction()){hidePreview();return;}const seat=[...seats.values()].find(isActive);if(!seat)return;
  if(event.target!==canvas&&!event.target.closest?.('[data-space-surface]')){hidePreview();return;}
  const hits=ray(event).intersectObjects(entries().filter(e=>e.object.visible).map(e=>e.object),true).filter(h=>h.object.isMesh&&!h.object.userData.kaminosEditorHelper),hit=hits[0];
  let belongs=false;for(let o=hit?.object;o;o=o.parent)if(o===seat.root)belongs=true;if(!belongs||!hit.face){hidePreview();return;}
  seat.root.updateWorldMatrix(true,false);const point=seat.root.worldToLocal(hit.point.clone()).toArray(),worldNormal=hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)),normal=worldNormal.transformDirection(seat.root.matrixWorld.clone().invert()).toArray();
  preview(seat,{point,normal});seat.surface.probe={point,normal};const pos=screen(point,seat.root);seat.surface.style.left=`${pos.x}px`;seat.surface.style.top=`${pos.y}px`;seat.surface.hidden=false;
 }
 function mount(entry){
  const {id,object:root}=entry,target=`@space:${id}`,properties=document.createElement('section');properties.dataset.spaceProperties=id;
  const heading=document.createElement('h3');heading.textContent='Place';properties.append(heading);
  const toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=true;toggle.dataset.spaceTool='enabled';const toggleLabel=document.createElement('label');toggleLabel.append(toggle,' Shape');properties.append(toggleLabel);
  const modes=document.createElement('fieldset');modes.style.cssText='display:flex;gap:12px;border:0;padding:8px 0;margin:0';const legend=document.createElement('legend');legend.textContent='New region';legend.style.fontSize='12px';modes.append(legend);
  for(const [value,label]of [['occupy','Occupy'],['empty','Keep empty']]){const input=document.createElement('input');input.type='radio';input.name=`space-role-${id}`;input.value=value;input.checked=value==='occupy';input.dataset.spaceRole=value;const row=document.createElement('label');row.append(input,label);modes.append(row);input.addEventListener('change',()=>{seat.role=value;hidePreview();});}
  const list=document.createElement('select');list.setAttribute('aria-label','Authored regions');list.style.cssText='max-width:100%;width:100%;margin:8px 0';const error=document.createElement('p');error.className='error';error.setAttribute('role','status');properties.append(modes,list,error);
  const overlay=document.createElement('div');overlay.className='scene-owner-playback';overlay.dataset.spaceHandles=id;overlay.style.cssText='position:absolute;inset:0;pointer-events:none;overflow:hidden';viewport.append(overlay);
  const surface=document.createElement('div');surface.dataset.spaceSurface=id;surface.hidden=true;surface.setAttribute('aria-hidden','true');surface.style.cssText='position:absolute;transform:translate(-50%,-50%);width:32px;height:32px;box-sizing:border-box;border-radius:50%;background:#26292b66;border:1px solid #f3f0e2;pointer-events:none';overlay.append(surface);
  const helper=new THREE.Group();helper.userData.kaminosEditorHelper=true;helper.visible=false;root.parent.add(helper);
  const forward=new THREE.ArrowHelper(new THREE.Vector3(0,1,0),new THREE.Vector3(),.72,0xf1e3b7,.13,.09),backward=new THREE.ArrowHelper(new THREE.Vector3(0,-1,0),new THREE.Vector3(),.38,0xe4e7e8,.1,.07),ring=new THREE.Mesh(new THREE.RingGeometry(.4,.414,48),new THREE.MeshBasicMaterial({color:0xe6e4dc,side:THREE.DoubleSide,transparent:true,opacity:.65,depthTest:false}));
  helper.add(forward,backward,ring);helper.traverse(o=>{o.userData.kaminosEditorHelper=true;o.renderOrder=999;if(o.material){o.material.depthTest=false;o.material.depthWrite=false;}});
  const proxy=new THREE.Object3D();proxy.userData.kaminosEditorHelper=true;root.parent.add(proxy);
  const seat={id,target,root,enabled:true,role:'occupy',properties,list,error,overlay,surface,helper,forward,backward,ring,proxy,focus:recipe(id).claims[0].id,handles:new Map()};seats.set(id,seat);
  if(!targets.has(target)){edits.register(target,{read:()=>recipe(id),check:checkedSpace,write:value=>{const e=find(id);if(!e)throw Error('Place is no longer in the scene');rebuildSpace(e.object,value);e.space=checkedSpace(value);redraw();sync();}});targets.add(target);}
  toggle.addEventListener('change',()=>{if(gesture)finish(true);seat.enabled=toggle.checked;hidePreview();updateHandles();});
  const componentTarget=`@space-region:${id}`;
  const snapshot=()=>{
   const current=seats.get(id),space=recipe(id),c=space.claims.find(c=>c.id===current?.focus)??space.claims[0];
   const liveRoot=find(id).object;liveRoot.updateWorldMatrix(true,false);const matrix=liveRoot.matrixWorld.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(...c.center),new THREE.Quaternion().setFromEuler(new THREE.Euler(...c.rotation)),new THREE.Vector3(...c.radii))),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();matrix.decompose(position,rotation,scale);
   const euler=new THREE.Euler().setFromQuaternion(rotation),pose={position:position.toArray(),rotation:[euler.x,euler.y,euler.z],scale:scale.toArray()};return {...pose,anchor:structuredClone(pose),space,claim:c.id};
  };
  const placeProxy=()=>{const value=snapshot(),live=seats.get(id).proxy;live.position.fromArray(value.position);live.rotation.set(...value.rotation);live.scale.fromArray(value.scale);live.updateMatrixWorld(true);};seat.placeProxy=placeProxy;
  if(!targets.has(componentTarget)){edits.register(componentTarget,{read:snapshot,check:value=>{const e=find(id);if(!e)throw Error('Place is no longer in the scene');e.object.updateWorldMatrix(true,false);transformSpaceClaim(value,e.object.matrixWorld);return structuredClone(value);},write:value=>{const e=find(id);if(!e)throw Error('Place is no longer in the scene');e.object.updateWorldMatrix(true,false);const next=transformSpaceClaim(value,e.object.matrixWorld);rebuildSpace(e.object,next);e.space=next;const current=seats.get(id);if(current){current.focus=value.claim;placeProxy();}redraw();sync();}});targets.add(componentTarget);}
  seat.component=components.register(id,{enter(){seat.editMode=true;placeProxy();},exit(){seat.editMode=false;},target(){if(!edits.state().active)placeProxy();return {id:componentTarget,type:'space-region',label:seat.focus,object:proxy,read:snapshot,localOrientation:snapshot().rotation,frameObjects:[root]};},pick(event){
   const hit=ray(event).intersectObject(root,true)[0];if(!hit)return;const point=root.worldToLocal(hit.point.clone()),claims=recipe(id).claims;
   const nearest=claims.map(c=>({c,d:Math.abs(Math.hypot(...point.toArray().map((v,i)=>(v-c.center[i])/c.radii[i]))-1)})).sort((a,b)=>a.d-b.d)[0];
   if(nearest)seat.component.changed(()=>{seat.focus=nearest.c.id;seat.list.value=seat.focus;updateHandles();placeProxy();});
  }});
  list.addEventListener('change',()=>{seat.component.changed(()=>{seat.focus=list.value;placeProxy();updateHandles();});const c=recipe(id).claims.find(c=>c.id===list.value);if(c)preview(seat,{claim:c.id,point:new THREE.Vector3(0,c.radii[1],0).applyEuler(new THREE.Euler(...c.rotation)).add(new THREE.Vector3(...c.center)).toArray()});});
  seat.mount=ownerControls.mount({asset:{id,root},properties});
 }
 function sync(){
  if(syncing)return;syncing=true;
  try{
   for(const [id,seat]of seats)if(find(id)?.object!==seat.root){if(gesture?.seat===seat)finish(true);if(hover?.seat===seat)hidePreview();seat.component.dispose();seat.proxy.removeFromParent();seat.mount.dispose();seat.overlay.remove();seat.helper.removeFromParent();
    const geometries=new Set(),materials=new Set();seat.helper.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();seats.delete(id);}
   for(const e of entries())if(e.object?.userData.stockroomSpace&&!seats.has(e.id))mount(e);
   for(const seat of seats.values()){const p=recipe(seat.id);if(!p.claims.some(c=>c.id===seat.focus))seat.focus=p.claims[0].id;const signature=JSON.stringify(p.claims.map(c=>[c.id,c.role]));if(signature!==seat.signature){seat.list.replaceChildren();for(const c of p.claims){const option=document.createElement('option');option.value=c.id;option.textContent=`${c.id} - ${c.role==='empty'?'Keep empty':'Occupy'}`;seat.list.append(option);}seat.signature=signature;}seat.list.value=seat.focus;if(seat.editMode&&!edits.state().active)seat.placeProxy();}
   updateHandles();
  }finally{syncing=false;}
 }
 const escape=e=>{if(gesture&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();finish(true);}},blur=()=>finish(true),leave=()=>{if(!gesture)hidePreview();};
 // Only an already-previewed surface takes the primary drag. Other pointer
 // buttons and wheel/trackpad input remain with the native camera controls.
 canvas.addEventListener('pointerdown',event=>{suppressClick=false;if(event.button===0&&hover&&!hover.probe.claim&&isActive(hover.seat)&&!nativeInteraction()){begin(event,hover.seat,hover.probe);if(gesture)event.stopImmediatePropagation();}},true);
 canvas.addEventListener('pointermove',event=>{if(gesture?.element===canvas){move(event);event.stopImmediatePropagation();}},true);
 canvas.addEventListener('pointerup',event=>{if(gesture?.element===canvas){event.preventDefault();event.stopImmediatePropagation();finish(false);}},true);
 canvas.addEventListener('pointercancel',()=>{if(gesture?.element===canvas)finish(true);});canvas.addEventListener('lostpointercapture',()=>{if(gesture?.element===canvas)finish(true);});
 canvas.addEventListener('click',event=>{if(suppressClick){suppressClick=false;event.preventDefault();event.stopImmediatePropagation();}},true);
 viewport.addEventListener('pointermove',pointerMove);viewport.addEventListener('pointerleave',leave);document.addEventListener('keydown',escape,true);document.defaultView.addEventListener('blur',blur);navigation.addEventListener('change',updateHandles);
 const observer=new document.defaultView.ResizeObserver(updateHandles);observer.observe(canvas);edits.subscribe(sync);
 return {sync,read(id){return {id,recipe:recipe(id),focus:seats.get(id)?.focus,preview:hover?.seat.id===id?structuredClone(hover.probe):null,dragging:gesture?.seat.id===id};},apply(id,probe,amount,role){const before=recipe(id),next=pullSpace(before,probe,amount,role),result=edits.apply(`@space:${id}`,next,'Shape place'),seat=seats.get(id);if(next.claims.length>before.claims.length&&seat){seat.focus=next.claims.at(-1).id;sync();}return result;}};
}
