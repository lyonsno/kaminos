import * as THREE from './lib/three.core.js';
import {checkedDock,rebuildDock,dockMembers} from './stockroom-dock.mjs';
import {checkedPose} from './scene-edit-session.mjs';
import {installSceneControlHistory} from './scene-control-history.mjs';

// The recipe is the only shape state. Native scene edits own each gesture.
export function createDockEditing({document,viewport,canvas,camera,navigation,entries,selected,edits,ownerControls,components,installNumberDrag,redraw,onError}){
 const seats=new Map(),targets=new Set();let gesture=null,syncing=false,suppressClick=false;
 const find=id=>entries().find(e=>e.id===id),recipe=id=>checkedDock(find(id)?.object.userData.stockroomDock);
 const active=seat=>selected()?.id===seat.id;
 function updateHandles(){
  for(const seat of seats.values()){
   const live=find(seat.id),show=live?.object===seat.root&&active(seat)&&live.object.visible;
   seat.overlay.hidden=!show;if(!show)continue;
   const p=recipe(seat.id),rect=canvas.getBoundingClientRect(),vp=viewport.getBoundingClientRect();seat.root.updateWorldMatrix(true,false);
   const points={width:[p.width/2,p.height,0],depth:[0,p.height,p.depth/2],height:[-p.width/2,p.height,-p.depth/2],stairRun:[p.width/2+p.stairRun,p.landingHeight,0]};
   for(const [key,b]of seat.handles){
    const world=new THREE.Vector3(...points[key]).applyMatrix4(seat.root.matrixWorld),screen=world.project(camera);
    b.hidden=screen.z<-1||screen.z>1||key==='stairRun'&&!p.stairs;
    b.style.left=`${rect.left-vp.left+(screen.x+1)*rect.width/2}px`;b.style.top=`${rect.top-vp.top+(1-screen.y)*rect.height/2}px`;
    b.title=`${key==='stairRun'?'Stair run':key[0].toUpperCase()+key.slice(1)} ${p[key].toFixed(2)} m`;
    b.setAttribute('aria-label',b.title);
   }
  }
 }
 function ray(event,root){const rect=canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2),camera);return ray.ray.clone().applyMatrix4(root.matrixWorld.clone().invert());}
 function finish(cancel){
  if(!gesture)return;const g=gesture;gesture=null;
  suppressClick=true;
  if(g.button.hasPointerCapture(g.pointerId))g.button.releasePointerCapture(g.pointerId);
  navigation.enabled=g.navigation;
  if(edits.state().active?.id===g.seat.target){if(cancel)edits.cancel();else edits.commit();}
  refresh();
 }
 function begin(event,seat,key){
  if(event.button!==0||gesture)return;
  event.preventDefault();event.stopPropagation();
  try{
   const p=recipe(seat.id),axis=new THREE.Vector3(key==='width'||key==='stairRun'?1:0,key==='height'?1:0,key==='depth'?1:0);
   const anchor=new THREE.Vector3(...(key==='width'?[p.width/2,p.height,0]:key==='depth'?[0,p.height,p.depth/2]:key==='height'?[-p.width/2,p.height,-p.depth/2]:[p.width/2+p.stairRun,p.landingHeight,0]));
   seat.root.updateWorldMatrix(true,false);const view=ray(event,seat.root),normal=view.direction.clone().addScaledVector(axis,-view.direction.dot(axis));
   if(normal.lengthSq()<1e-10)throw Error('View this edge from an angle to resize it');
   const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(normal.normalize(),anchor),start=view.intersectPlane(plane,new THREE.Vector3());if(!start)return;
   edits.begin(seat.target,`Resize dock ${key}`);
   gesture={seat,key,axis,plane,start,recipe:p,button:event.currentTarget,pointerId:event.pointerId,navigation:navigation.enabled};
   navigation.enabled=false;event.currentTarget.setPointerCapture(event.pointerId);
  }catch(error){onError(error);}
 }
 function move(event){
  const g=gesture;if(!g||g.pointerId!==event.pointerId)return;
  event.preventDefault();const point=ray(event,g.seat.root).intersectPlane(g.plane,new THREE.Vector3());if(!point)return;
  const delta=point.sub(g.start).dot(g.axis)*(g.key==='width'||g.key==='depth'?2:1),value=g.recipe[g.key]+delta;
  try{const next={...g.recipe,[g.key]:event.ctrlKey||event.metaKey?Math.round(value/.1)*.1:value};checkedDock(next);edits.preview(next);}catch(error){g.seat.error.textContent=error.message;}
 }
 const keydown=event=>{if(gesture&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();finish(true);}};
 const blur=()=>finish(true);
 document.addEventListener('keydown',keydown,true);document.defaultView.addEventListener('blur',blur);
 document.addEventListener('pointerdown',()=>{suppressClick=false;},true);
 document.addEventListener('click',event=>{if(!suppressClick)return;suppressClick=false;if(viewport.contains(event.target)){event.preventDefault();event.stopImmediatePropagation();}},true);
 navigation.addEventListener('change',updateHandles);
 const observer=new document.defaultView.ResizeObserver(updateHandles);observer.observe(canvas);
 const unsubscribe=edits.subscribe(()=>refresh());
 function mount(entry){
  const id=entry.id,target=`@dock:${id}`,pieceTarget=`@dock-piece:${id}`,root=entry.object,fields=new Map(),drags=[];
  if(!targets.has(target)){
   edits.register(target,{read:()=>recipe(id),check:checkedDock,write:value=>{const e=find(id);if(!e)throw Error('Dock is no longer in this scene');rebuildDock(e.object,value);e.dock=structuredClone(value);redraw();refresh();}});targets.add(target);
  }
  const properties=document.createElement('section');properties.dataset.dockProperties=id;
  const title=document.createElement('h3');title.textContent='Dock construction';properties.append(title);
  const error=document.createElement('p');error.className='error';error.setAttribute('role','status');
  for(const [key,label,min]of[['width','Width',.7],['depth','Depth',.7],['height','Deck height',.55],['bayLength','Support spacing',.3],['stairWidth','Stair width',.5],['stairRun','Stair run',.3],['landingHeight','Landing height',0]]){
   const row=document.createElement('label'),input=document.createElement('input');row.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:10px;margin:6px 0';input.type='number';input.step='.05';input.min=String(min);input.style.width='96px';input.dataset.dockField=key;input.setAttribute('aria-label',label);row.append(label,input);properties.append(row);fields.set(key,{input,row});
   input.addEventListener('input',()=>{if(input.value==='')return;try{const next={...recipe(id),[key]:Number(input.value)};if(edits.state().active?.id===target)edits.preview(next);else edits.apply(target,next,`Set dock ${label}`);error.textContent='';}catch(e){error.textContent=e.message;}});
  }
  const direction=document.createElement('select');direction.setAttribute('aria-label','Board direction');direction.dataset.dockField='boardDirection';for(const [value,label]of[['x','Lengthwise boards'],['z','Crosswise boards']]){const o=document.createElement('option');o.value=value;o.textContent=label;direction.append(o);}properties.append(direction);
  const stairRow=document.createElement('label'),stairs=document.createElement('input');stairs.type='checkbox';stairs.dataset.dockField='stairs';stairRow.append(stairs,'Attached stair');stairRow.style.cssText='display:block;margin:10px 0';properties.append(stairRow,error);
  for(const [input,key]of[[direction,'boardDirection'],[stairs,'stairs']])input.addEventListener('change',()=>{try{edits.apply(target,{...recipe(id),[key]:key==='stairs'?input.checked:input.value},`Change dock ${key}`);error.textContent='';}catch(e){error.textContent=e.message;}input.blur();});
  const history=installSceneControlHistory({controls:[...fields.values()].map(f=>f.input),edits,id:target,label:'Shape dock',onError:e=>{error.textContent=e.message;}});
  for(const {row,input}of fields.values()){drags.push(installNumberDrag({grip:row,input,step:.02}));input.style.width='100%';input.parentNode.style.cssText='flex:0 0 96px;width:96px;min-width:0';}
  direction.style.cssText='background:#25262a;color:#d6d7db;border:1px solid #424348;border-radius:4px;padding:5px;max-width:100%';
  const overlay=document.createElement('div');overlay.className='scene-owner-playback';overlay.style.cssText='position:absolute;inset:0;pointer-events:none;overflow:hidden';overlay.dataset.dockHandles=id;
  const handles=new Map(),proxy=new THREE.Group();proxy.userData.kaminosEditorHelper=true;root.parent.add(proxy);
  const seat={id,target,root,properties,error,fields,direction,stairs,overlay,handles,history,drags,proxy,piece:'deck:0',editMode:false};
  const member=()=>find(id)?.object.children.find(m=>m.name===seats.get(id)?.piece);
  const poseOf=object=>{object.updateWorldMatrix(true,false);const p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();object.matrixWorld.decompose(p,q,s);const e=new THREE.Euler().setFromQuaternion(q);return {position:p.toArray(),rotation:[e.x,e.y,e.z],scale:s.toArray()};};
  const snapshot=()=>{const current=seats.get(id),m=member();if(!current||!m)throw Error('Choose an existing dock piece');const pose=poseOf(m);return {...pose,anchor:structuredClone(pose),member:current.piece,dock:recipe(id)};};
  if(!targets.has(pieceTarget)){
   edits.register(pieceTarget,{read:snapshot,check:value=>{checkedPose(value);checkedPose(value.anchor);const p=checkedDock(value.dock);if(!dockMembers(p).some(m=>m.id===value.member))throw Error('Dock piece no longer exists');return {...structuredClone(value),dock:p};},write:value=>{
    let p=checkedDock(value.dock);const e=find(id);if(!e)throw Error('Dock is no longer in this scene');
    if(!['position','rotation','scale'].every(key=>value[key].every((v,i)=>v===value.anchor[key][i]))){
     const world=new THREE.Matrix4().compose(new THREE.Vector3(...value.position),new THREE.Quaternion().setFromEuler(new THREE.Euler(...value.rotation)),new THREE.Vector3(...value.scale));
     e.object.updateWorldMatrix(true,false);const local=e.object.matrixWorld.clone().invert().multiply(world),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();local.decompose(position,rotation,scale);const angles=new THREE.Euler().setFromQuaternion(rotation),base=dockMembers(p).find(m=>m.id===value.member);
     p.memberOffsets[value.member]={position:position.toArray().map((v,i)=>v-base.position[i]),rotation:[angles.x,angles.y,angles.z].map((v,i)=>v-base.rotation[i]),scale:scale.toArray().map((v,i)=>v/base.size[i])};p=checkedDock(p);
    }
    rebuildDock(e.object,p);e.dock=p;const current=seats.get(id);if(current)current.piece=value.member;redraw();refresh();
   }});targets.add(pieceTarget);
  }
  const placeProxy=()=>{const m=member();if(m){const pose=poseOf(m);proxy.position.fromArray(pose.position);proxy.rotation.set(...pose.rotation);proxy.scale.fromArray(pose.scale);proxy.updateMatrixWorld(true);}};
  seats.set(id,seat);
  seat.component=components.register(id,{
   enter(){seat.editMode=true;placeProxy();updateHandles();},exit(){seat.editMode=false;updateHandles();},
   target(){if(!member())seat.piece=root.children[0]?.name;if(!member())return null;if(!edits.state().active)placeProxy();return {id:pieceTarget,type:'dock-piece',label:seat.piece,object:proxy,read:snapshot,frameObjects:[member()]};},
   pick(event,{camera,canvas}){const rect=canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2),camera);const hit=ray.intersectObjects(root.children,false)[0];if(hit)seat.component.changed(()=>{seat.piece=hit.object.name;placeProxy();});},
  });
  for(const [key,icon,color]of[['width','↔','#63d6bd'],['depth','↔','#72aefb'],['height','↕','#f0c56b'],['stairRun','↔','#eaa0bc']]){
   const b=document.createElement('button');b.type='button';b.dataset.dockHandle=key;b.textContent=icon;b.style.cssText=`position:absolute;transform:translate(-50%,-50%);width:30px;height:30px;padding:0;border-radius:50%;border:2px solid ${color};background:#202526;color:${color};pointer-events:auto;touch-action:none;cursor:${key==='height'?'ns-resize':'ew-resize'};font-size:20px;line-height:24px`;
   b.addEventListener('pointerdown',e=>begin(e,seat,key));b.addEventListener('pointermove',move);b.addEventListener('pointerup',()=>finish(false));b.addEventListener('pointercancel',()=>finish(true));b.addEventListener('lostpointercapture',()=>finish(true));overlay.append(b);handles.set(key,b);
  }
  viewport.append(overlay);seat.mount=ownerControls.mount({asset:{id,root},properties,onSelected:refresh});
 }
 function refresh(){
  for(const seat of seats.values()){
   if(find(seat.id)?.object!==seat.root)continue;const p=recipe(seat.id);
   for(const [key,{input,row}]of seat.fields){if(document.activeElement!==input)input.value=String(p[key]);row.hidden=key.startsWith('stair')||key==='landingHeight'?!p.stairs:false;row.style.display=row.hidden?'none':'flex';}
   seat.direction.value=p.boardDirection;seat.stairs.checked=p.stairs;
  }
  updateHandles();
 }
 function sync(){
  if(syncing)return;syncing=true;try{
  for(const [id,seat]of seats)if(find(id)?.object!==seat.root){if(gesture?.seat===seat)finish(true);seat.component.dispose();seat.proxy.removeFromParent();seat.history.dispose();seat.drags.forEach(d=>d.dispose());seat.mount.dispose();seat.overlay.remove();seats.delete(id);}
  for(const entry of entries())if(entry.object?.userData.stockroomDock&&!seats.has(entry.id))mount(entry);
  refresh();
  }finally{syncing=false;}
 }
 return {sync,refresh};
}
