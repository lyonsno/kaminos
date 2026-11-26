import * as T from './lib/three.core.js';
import {createPlaceAuthoring} from './stockroom-place-state.mjs';

export function installPlaceControls({host,session,view,asset,record,inputs,proposal}){
 const document=host.controls.document,window=document.defaultView,canvas=host.scene.renderer().domElement,viewport=canvas.parentElement,camera=host.scene.camera(),navigation=host.scene.navigation(),author=createPlaceAuthoring(inputs);
 const listeners=[],listen=(node,name,fn,opts)=>{node.addEventListener(name,fn,opts);listeners.push(()=>node.removeEventListener(name,fn,opts));};
 let tool='material',reach=.48,drag=null,secondary=null,middle=false,hover=null,lastCamera='',pendingEvent=null,raf=null,domainPress=false;
 const overlay=document.createElement('div');overlay.dataset.sceneOwnerOverlay='';overlay.dataset.placeOverlay='';overlay.style.cssText='position:absolute;pointer-events:none;z-index:6;overflow:hidden';viewport.append(overlay);
 const bar=document.createElement('div');bar.style.cssText='position:absolute;left:12px;right:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center';overlay.append(bar);
 const group=()=>{const x=document.createElement('div');x.style.cssText='display:flex;gap:2px;padding:3px;background:#252b29e8;border:1px solid #75807b;border-radius:4px;pointer-events:auto';bar.append(x);return x;};
 const modeGroup=group(),toolsGroup=group(),resolutionGroup=group(),commands=group(),buttons=new Map();
 function button(parent,key,label,title,fn){const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=label;b.title=title;b.setAttribute('aria-label',title);b.dataset.placeAction=key;b.style.cssText='min-height:32px;min-width:34px;padding:5px 9px;border:1px solid transparent;border-radius:3px;background:transparent;color:#e5e9e6;font-size:12px';parent.append(b);listen(b,'click',()=>act(fn));buttons.set(key,b);return b;}
 for(const value of ['establish','work'])button(modeGroup,value,value==='establish'?'Establish':'Work',value==='establish'?'Establish material and space':'Work with the insert',()=>operations.mode({value}));
 for(const [value,label]of [['material','+ Material'],['space','- Space'],['fit','Fit'],['fold','Fold']])button(toolsGroup,value,label,label,()=>{tool=value;sync();});
 for(const value of ['proxy','deck'])button(resolutionGroup,value,value==='proxy'?'Unresolved':'Deck',value==='proxy'?'Unresolved allocation':'Resolve allocation as deck',()=>operations.realize({value}));
 button(commands,'back','\u2190','Back one intervention',()=>operations.back());button(commands,'erase','\u00d7','Withdraw selected region',()=>operations.remove({id:author.read().selected}));button(commands,'reset','\u21bb','Reset composition',()=>operations.reset());
 const status=document.createElement('div');status.style.cssText='position:absolute;left:14px;bottom:54px;max-width:calc(100% - 28px);padding:6px 9px;border-radius:3px;background:#252b29e8;color:#e5e9e6;font-size:12px;pointer-events:none';overlay.append(status);
 const error=document.createElement('div');error.setAttribute('role','status');error.style.cssText='position:absolute;left:14px;right:14px;bottom:90px;font-size:12px;color:#7e342b;pointer-events:none';overlay.append(error);
 const gizmo=new T.Group();gizmo.userData.kaminosEditorHelper=true;gizmo.visible=false;view.root.add(gizmo);const ring=new T.Mesh(new T.RingGeometry(.46,.474,48),new T.MeshBasicMaterial({color:0xe3d7b7,side:T.DoubleSide,depthTest:false,transparent:true,opacity:.8}));ring.rotation.x=-Math.PI/2;ring.renderOrder=50;gizmo.add(ring);
 const arrow=new T.ArrowHelper(new T.Vector3(1,0,0),new T.Vector3(),.65,0xe3d7b7,.12,.075);arrow.traverse(m=>{m.userData.kaminosEditorHelper=true;if(m.material){m.material.depthTest=false;m.material.depthWrite=false;}m.renderOrder=50;});gizmo.add(arrow);
 function emit(kind,requested){record({kind:'stockroom-place.'+kind,target:asset.id,requested,effective:author.read(),prepared:true});}
 function act(fn){try{fn();error.textContent='';}catch(e){error.textContent=e.message;session.redraw();}}
 function rect(){return canvas.getBoundingClientRect();}
 function project(point){const r=rect(),v=new T.Vector3(...point).project(camera);return {x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2};}
 function ray(event){const r=rect(),c=new T.Raycaster();c.setFromCamera(new T.Vector2(2*(event.clientX-r.left)/r.width-1,1-2*(event.clientY-r.top)/r.height),camera);return c;}
 function point(event){view.root.updateWorldMatrix(true,false);const m=author.read(),origin=view.root.localToWorld(new T.Vector3(0,m.height,0)),normal=new T.Vector3(0,1,0).applyNormalMatrix(new T.Matrix3().getNormalMatrix(view.root.matrixWorld)),hit=ray(event).ray.intersectPlane(new T.Plane().setFromNormalAndCoplanarPoint(normal,origin),new T.Vector3());if(!hit)return null;const v=view.root.worldToLocal(hit);return [v.x,v.z];}
 function hit(event){return ray(event).intersectObjects(view.targets(),false)[0]?.object;}
 function previewAt(event){const at=point(event);if(!at)return null;const m=author.read(),r=m.regions.find(r=>r.id===m.selected),weights=r?at.map((v,i)=>(v-r.center[i])/r.half[i]):[1,0],axis=Math.abs(weights[0])>=Math.abs(weights[1])?0:1,sign=Math.sign(weights[axis])||1;gizmo.position.set(at[0],m.height+.15,at[1]);gizmo.scale.setScalar(reach/.48);arrow.setDirection(new T.Vector3(axis===0?sign:0,0,axis===1?sign:0));gizmo.visible=m.mode==='establish';return {center:at,axis,sign};}
 function layout(){const r=rect(),p=viewport.getBoundingClientRect();Object.assign(overlay.style,{left:`${r.left-p.left}px`,top:`${r.top-p.top}px`,width:`${r.width}px`,height:`${r.height}px`});let y=12;for(const node of document.querySelectorAll('#authoring-viewport-tools,.scene-top-menu,#experiment-toolbar')){const b=node.getBoundingClientRect();if(b.height>0&&b.height<r.height/2&&b.top<r.top+120)y=Math.max(y,b.bottom-r.top+9);}bar.style.top=`${y}px`;}
 function sync(){const m=author.model();asset.root.userData.stockroomPlace=structuredClone(m);view.update(m);layout();const state=author.read(),active=state.stage!=='idle';
  for(const [key,b]of buttons){const selected=key===m.mode||key===m.realization||key===tool;b.setAttribute('aria-pressed',String(selected));b.style.background=selected?'#59685f':'transparent';b.style.borderColor=selected?'#c7c1ac':'transparent';b.disabled=active&&key!=='back'&&key!=='reset';if(['material','space','fit','fold'].includes(key))b.hidden=m.mode==='establish'?!['material','space'].includes(key):!['fit','fold'].includes(key);}
  buttons.get('erase').hidden=m.mode!=='establish';buttons.get('erase').disabled=active||!m.selected;buttons.get('fold').disabled=active||!m.insert.fitted;buttons.get('back').disabled=!active&&!state.depth;
  if(m.mode==='work'&&!['fit','fold'].includes(tool))tool='fit';if(m.mode==='establish'&&!['material','space'].includes(tool))tool='material';
  status.textContent=[m.mode==='establish'?'Establish':'Work',active?(drag?.spec.kind??state.stage):m.selected??'Place',m.insert.fitted?(view.plan().insert.hostSupported?'Receiver fitted':'Receiver without host support'):null].filter(Boolean).join(' / ');canvas.style.cursor=active?'move':hover?'pointer':'default';session.redraw();}
 function start(spec,event){author.begin(spec);drag={spec,start:point(event),base:spec.kind==='move'?[0,0]:0,last:spec.kind==='move'?[0,0]:0,offset:spec.kind==='fit'&&point(event)?author.model().insert.center.map((v,i)=>v-point(event)[i]):[0,0],screen:{x:event.clientX,y:event.clientY},valid:true};if(spec.kind==='create')author.preview(0);gizmo.visible=false;sync();emit('begin',spec);}
 function applyMove(event){if(!drag||secondary||middle||navigation.state().gesture||window.kaminosSceneEdits.state().active)return;const d=drag,m=author.model(),at=point(event);if(!at&&d.spec.kind!=='fold')return;
  try{let value;if(d.spec.kind==='fold'){const a=m.insert.angle,p0=project(view.foldPoint(a)),p1=project(view.foldPoint(a+.01)),dx=(p1.x-p0.x)/.01,dy=(p1.y-p0.y)/.01,length=dx*dx+dy*dy;if(length<1)throw Error('View the hinge from a less end-on angle');if(!d.screen){d.screen={x:event.clientX,y:event.clientY};return;}value=a+((event.clientX-d.screen.x)*dx+(event.clientY-d.screen.y)*dy)/length;d.screen={x:event.clientX,y:event.clientY};}
   else if(d.spec.kind==='fit'){if(!d.start){d.offset=m.insert.center.map((v,i)=>v-at[i]);d.start=at;return;}value=at.map((v,i)=>v+d.offset[i]);}
   else{if(!d.start){d.start=at;d.base=structuredClone(d.last);return;}value=d.spec.kind==='move'?at.map((v,i)=>v-d.start[i]+d.base[i]):(at[d.spec.axis]-d.start[d.spec.axis])*d.spec.sign+d.base;}
   author.preview(value);d.last=structuredClone(value);d.valid=true;error.textContent='';sync();emit('preview',{value});
  }catch(e){d.valid=false;error.textContent=e.message;session.redraw();}
 }
 function flush(){if(raf!==null)window.cancelAnimationFrame(raf);raf=null;if(pendingEvent){const e=pendingEvent;pendingEvent=null;applyMove(e);}}
 function left(event){
  if(event.button===0)domainPress=false;
  if(window.kaminosSceneEdits.state().active){if(drag){drag.start=null;drag.screen=null;}return;}
  if(event.button!==0||event.target!==canvas||event.shiftKey||navigation.state().gesture)return;act(()=>{flush();if(drag){if(!drag.valid)throw Error('Return to a valid preview before accepting');operations.commit();}
   else{const object=hit(event),spec=object?.userData.placeHandle;if(spec&&spec.kind!=='insert')start(spec,event);else if(author.read().mode==='work'){if(object?.userData.placeInsert||spec?.kind==='insert'||tool==='fit')start({kind:tool==='fold'?'fold':'fit'},event);}
    else{const probe=previewAt(event);if(probe)start({kind:'create',role:tool,center:probe.center,axis:probe.axis,sign:probe.sign,radius:reach},event);}}
  });domainPress=true;event.preventDefault();event.stopImmediatePropagation();}
 function goBack(){domainPress=false;pendingEvent=null;if(raf!==null)window.cancelAnimationFrame(raf);raf=null;author.back();drag=null;gizmo.visible=false;sync();emit('back');}
 listen(viewport,'pointerdown',event=>{if(event.target!==canvas&&!overlay.contains(event.target))return;if(event.button===2){secondary={x:event.clientX,y:event.clientY,id:event.pointerId,moved:false};if(drag){drag.start=null;drag.screen=null;}gizmo.visible=false;}if(event.button===1){middle=true;if(drag){drag.start=null;drag.screen=null;}}},true);
 // Native gizmos install their canvas listeners first and may acquire the edit.
 listen(canvas,'pointerdown',left);
 listen(viewport,'pointermove',event=>{if(secondary){if(Math.hypot(event.clientX-secondary.x,event.clientY-secondary.y)>5)secondary.moved=true;return;}if(middle||navigation.state().gesture)return;if(drag){pendingEvent={clientX:event.clientX,clientY:event.clientY};if(raf===null)raf=window.requestAnimationFrame(()=>{raf=null;flush();});}else if(event.target===canvas){if(proposal?.containsPointer(event)){gizmo.visible=false;canvas.style.cursor='pointer';canvas.title='';session.redraw();return;}hover=hit(event);canvas.title=hover?.userData.placeHandle?`Take up ${hover.userData.placeHandle.id??'insert'}`:'';previewAt(event);session.redraw();}},true);
 listen(window,'pointerup',event=>{if(event.button===0&&event.target!==canvas)domainPress=false;if(event.button===2&&secondary?.id===event.pointerId){const click=!secondary.moved;secondary=null;if(click){const proposalBack=!drag&&proposal?.backAt(event);if(proposalBack||author.read().depth||drag){navigation.cancel();if(!proposalBack)goBack();event.preventDefault();event.stopImmediatePropagation();}}}if(event.button===1)middle=false;},true);
 listen(window,'pointercancel',()=>{domainPress=false;},true);
 listen(canvas,'pointerup',event=>{if(event.button===0&&domainPress){event.preventDefault();event.stopImmediatePropagation();}});
 listen(canvas,'click',event=>{if(domainPress){domainPress=false;event.preventDefault();event.stopImmediatePropagation();}});
 listen(viewport,'contextmenu',event=>{if(event.target===canvas||overlay.contains(event.target)){event.preventDefault();event.stopImmediatePropagation();}},true);
 listen(window,'keydown',event=>{if(event.target.closest?.('input,textarea,select,[contenteditable="true"]'))return;if(event.key==='Escape'){event.preventDefault();goBack();}if(event.key==='Tab'&&drag){event.preventDefault();event.stopImmediatePropagation();}},true);
 const unsubscribe=session.onFrame(()=>{view.root.updateWorldMatrix(true,false);const key=[...camera.matrixWorld.elements,...camera.projectionMatrix.elements,...view.root.matrixWorld.elements].join(',');if(key!==lastCamera){lastCamera=key;if(drag){drag.start=null;drag.screen=null;}gizmo.visible=false;}layout();});
 const operations={mode({value}){author.mode(value);tool=value==='work'?'fit':'material';gizmo.visible=false;sync();emit('mode',{value});},realize({value}){author.realize(value);sync();emit('realize',{value});},add({role,center,half,shape}){author.add(role,{center,half,shape});sync();emit('add',{role,center,half,shape});},remove({id}){author.remove(id);sync();emit('remove',{id});},begin(spec){author.begin(spec);sync();emit('begin',spec);},preview({value}){author.preview(value);sync();emit('preview',{value});},commit(){flush();author.commit();drag=null;sync();emit('commit');},back:goBack,reset(){domainPress=false;pendingEvent=null;author.reset();drag=null;tool='material';sync();emit('reset');},frame(){session.setView({position:[7.8,6.6,8.3],target:[-.1,.55,.3],fov:43});},height({value}){author.height(value);sync();emit('height',{value});}};
 function read(){
  const handles=author.model().regions.map(r=>{
   const sides=[];
   for(const axis of [0,1])for(const sign of [-1,1])sides.push({axis,sign,...project(view.handlePoint({kind:'boundary',id:r.id,axis,sign}))});
   return {id:r.id,move:project(view.handlePoint({kind:'move',id:r.id})),sides};
  });
  return {place:author.model(),interaction:author.read(),plan:view.plan(),view:session.readView(),screen:{handles,insert:project(view.handlePoint({kind:'insert'}))},prepared:true,objectId:asset.id};
 }
 sync();return {operations,read,isEditing:author.isEditing,
  mount(panel){const title=document.createElement('h3');title.textContent='Place';panel.append(title);const make=(label,value,fn)=>{const row=document.createElement('label');row.textContent=label+' ';const input=document.createElement('input');input.type='number';input.value=String(value);input.step='any';input.style.width='90px';row.append(input);panel.append(row);listen(input,'change',()=>act(()=>fn(Number(input.value))));return host.controls.installNumberDrag({input,grip:row,step:.02});};const controls=[make('Deck height',author.model().height,value=>operations.height({value})),make('Reach',reach,value=>{if(!Number.isFinite(value)||value<=.04)throw Error('Reach must exceed four centimetres');reach=value;})];return ()=>controls.forEach(c=>c.dispose());},
  dispose(){if(raf!==null)window.cancelAnimationFrame(raf);unsubscribe();listeners.forEach(fn=>fn());overlay.remove();gizmo.removeFromParent();gizmo.traverse(m=>{m.geometry?.dispose();if(m.material)m.material.dispose();});canvas.style.cursor='';canvas.title='';},
 };
}
