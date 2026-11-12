import * as T from './lib/three.core.js';
import {FOLD_FLOW,FOLD_CHOICES,initialFoldFlow,receiverEncounter,receiverFrame,createFoldAuthoring} from './stockroom-fold-flow-state.mjs';

export function createFoldFlowView(){
 const root=new T.Group();root.name='Fold / receive - prepared interface';
 const wood=new T.MeshStandardMaterial({color:0x778b87,roughness:.72,metalness:.08});
 const end=new T.MeshStandardMaterial({color:0x49514e,roughness:.78});
 const iron=new T.MeshStandardMaterial({color:0x303b42,roughness:.37,metalness:.8});
 const brass=new T.MeshStandardMaterial({color:0xbba96b,roughness:.33,metalness:.72});
 const bytes=new Uint8Array(32*256*4);
 for(let y=0;y<256;y++)for(let x=0;x<32;x++){
  const n=Math.sin(x*2.7+Math.sin(y*.07))*7+Math.sin(y*.39+x*.21)*3,i=(y*32+x)*4;
  bytes[i]=140+n;bytes[i+1]=153+n;bytes[i+2]=145+n;bytes[i+3]=255;
 }
 const grain=new T.DataTexture(bytes,32,256);grain.needsUpdate=true;grain.wrapS=grain.wrapT=T.RepeatWrapping;wood.map=grain;
 const leafWood=wood.clone(),gateWood=wood.clone(),tipWood=wood.clone();
 const box=(parent,size,position,material=wood,action=null)=>{
  const mesh=new T.Mesh(new T.BoxGeometry(...size),material);mesh.position.set(...position);mesh.castShadow=mesh.receiveShadow=true;
  if(action)mesh.userData.flowAction=action;parent.add(mesh);return mesh;
 };
 const planks=(parent,length,width,action)=>{
  for(let i=0;i<8;i++)box(parent,[length,.13,width/8-.012],[length/2,0,-width/2+(i+.5)*width/8],action?leafWood:wood,action);
  for(const z of [-width/2+.12,width/2-.12])box(parent,[length,.12,.085],[length/2,-.12,z],iron,action);
 };
 const left=new T.Group();left.position.set(-3.8,1.05,0);root.add(left);planks(left,2.5,2.3);
 const right=new T.Group();right.position.set(1.4,1.05,0);root.add(right);planks(right,1.8,2.3);
 for(const x of [-3.5,-1.65,1.7,2.9])for(const z of [-.9,.9]){
  box(root,[.13,1,.13],[x,.5,z],iron);box(root,[.28,.07,.28],[x,.1,z],end);
 }
 const water=new T.Mesh(new T.PlaneGeometry(9,6),new T.MeshStandardMaterial({color:0x28505a,roughness:.26,metalness:.45}));
 water.rotation.x=-Math.PI/2;water.position.set(-.35,.04,0);water.receiveShadow=true;root.add(water);
 const leaf=new T.Group();leaf.position.set(...FOLD_FLOW.hinge);root.add(leaf);planks(leaf,FOLD_FLOW.length,FOLD_FLOW.width,'leaf');
 for(const x of [.22,1.2,2.45])box(leaf,[.08,.1,1.48],[x,-.15,0],iron,'leaf');
 const pin=(parent,position,axis='z')=>{
  const mesh=new T.Mesh(new T.CylinderGeometry(.055,.055,.24,16),brass);mesh.position.set(...position);
  if(axis==='z')mesh.rotation.x=Math.PI/2;parent.add(mesh);return mesh;
 };
 const hinge=new T.Group();leaf.add(hinge);for(const z of [-.7,.7])pin(hinge,[0,0,z]);
 const line=(parent,a,b)=>{
  const result=new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(...a),new T.Vector3(...b)]),new T.LineBasicMaterial({color:0xf0dfab,depthTest:false}));
  result.renderOrder=20;parent.add(result);return result;
 };
 const seam=line(leaf,[.03,.09,-.85],[.03,.09,.85]);
 const gate=new T.Group(),gateLower=new T.Group(),gateTip=new T.Group();root.add(gate);gate.add(gateLower,gateTip);
 const lower=[],upper=[];
 for(let i=0;i<8;i++){
  lower.push(box(gateLower,[.12,1,1],[0,0,0],gateWood,'receiver'));
  upper.push(box(gateTip,[.12,1,1],[0,0,0],tipWood,'tip'));
 }
 const lowerBars=[.16,.6].map(()=>box(gateLower,[.18,.09,1],[.025,0,0],iron,'receiver'));
 const upperBar=box(gateTip,[.18,.09,1],[.025,0,0],iron,'tip');
 for(const z of [-1.04,1.04])box(root,[.17,2.3,.17],[-3.05,2.2,z],iron);
 box(root,[.2,.14,2.25],[-3.05,3.34,0],iron);
 const fixed=Array.from({length:4},()=>box(root,[.12,1,1],[-3.05,0,0],wood));
 const gatePins=new T.Group();gate.add(gatePins);for(const y of [.14,.9])pin(gatePins,[0,y,0],'y');
 const tipPin=pin(gateTip,[0,0,0]),tipSeam=line(gateTip,[.1,0,-.5],[.1,0,.5]);
 const marker=new T.Mesh(new T.RingGeometry(.13,.155,40),new T.MeshBasicMaterial({color:0xedd9a4,side:T.DoubleSide,depthTest:false}));
 marker.renderOrder=25;root.add(marker);
 let state=initialFoldFlow(),hover=null;
 function update(value,{encounter=receiverEncounter(value),preview=false}={}){
  state={...value};leaf.rotation.z=state.angle;
  receiverFrame(state).decompose(gate.position,gate.quaternion,gate.scale);
  const width=state.receiver?state.receiverExtent:1.8,height=state.receiver?1.3:2;
  const lowerHeight=height*.58,upperHeight=height-lowerHeight;
  const zCenter=state.receiver?(state.receiverKind==='side'?-width/2:0):.9;
  gateTip.position.set(0,lowerHeight,0);gateTip.rotation.z=state.secondAngle;
  for(let i=0;i<8;i++){
   const z=zCenter-width/2+(i+.5)*width/8;
   lower[i].scale.set(1,lowerHeight-.015,width/8-.012);lower[i].position.set(0,lowerHeight/2,z);
   upper[i].scale.set(1,upperHeight-.015,width/8-.012);upper[i].position.set(0,upperHeight/2,z);
  }
  lowerBars.forEach((bar,i)=>{bar.scale.z=width;bar.position.set(.025,i?lowerHeight-.12:.12,zCenter);});
  upperBar.scale.z=width;upperBar.position.set(.025,upperHeight-.12,zCenter);
  const slab=(mesh,h,w,y,z)=>{mesh.visible=h>0&&w>0;if(mesh.visible){mesh.scale.set(1,h,w);mesh.position.set(-3.05,y,z);}};
  if(state.receiver){
   const margin=(1.8-width)/2,bottom=state.receiverCenter-.65-1.2,top=3.2-state.receiverCenter-.65;
   slab(fixed[0],2,margin,2.2,-width/2-margin/2);slab(fixed[1],2,margin,2.2,width/2+margin/2);
   slab(fixed[2],bottom,width,1.2+bottom/2,0);slab(fixed[3],top,width,3.2-top/2,0);
  }else fixed.forEach(mesh=>mesh.visible=false);
  hinge.visible=state.creased;gatePins.visible=state.receiver;tipPin.visible=state.secondCrease;
  tipPin.position.z=zCenter;tipPin.scale.y=width/.24;
  seam.visible=hover==='leaf';tipSeam.visible=state.receiver&&(hover==='tip'||!state.secondCrease);
  tipSeam.position.z=zCenter;tipSeam.scale.z=width;
  for(const material of [gateWood,tipWood])material.emissive.setHex(preview?0x273c35:0);
  marker.visible=!!encounter;if(encounter){marker.position.fromArray(encounter.point);marker.rotation.y=Math.PI/2;}
  root.updateMatrixWorld(true);
 }
 function setHover(value){
  if(value===hover)return false;hover=value;
  leafWood.emissive.setHex(value==='leaf'?0x253b33:0);
  seam.visible=value==='leaf';tipSeam.visible=state.receiver&&(value==='tip'||!state.secondCrease);return true;
 }
 function targets(){const out=[];root.traverse(o=>{if(o.isMesh&&o.userData.flowAction)out.push(o);});return out;}
 function frameFor(action){
  root.updateMatrixWorld(true);
  if(action==='leaf')return {matrix:root.matrixWorld.clone().multiply(new T.Matrix4().makeTranslation(...FOLD_FLOW.hinge)),axis:'z'};
  if(action==='receiver'){
   const position=gate.position.clone();return {matrix:root.matrixWorld.clone().multiply(new T.Matrix4().makeTranslation(...position.toArray())),axis:state.receiverKind==='side'?'y':'z'};
  }
  return {matrix:gate.matrixWorld.clone().multiply(new T.Matrix4().makeTranslation(0,gateTip.position.y,0)),axis:'z'};
 }
 function points(){
  root.updateMatrixWorld(true);const z=state.receiver?(state.receiverKind==='side'?-state.receiverExtent*.65:state.receiverExtent*.25):1.3;
  return {crease:leaf.localToWorld(new T.Vector3(.03,.12,0)).toArray(),leaf:leaf.localToWorld(new T.Vector3(2.45,.1,0)).toArray(),leafBase:leaf.localToWorld(new T.Vector3(.5,.1,.3)).toArray(),
   receiver:gate.localToWorld(new T.Vector3(.1,gateTip.position.y*.65,z)).toArray(),tip:gateTip.localToWorld(new T.Vector3(.1,.35,z)).toArray(),offer:marker.getWorldPosition(new T.Vector3()).toArray()};
 }
 update(state);return {root,leaf,gate,gateTip,targets,frameFor,points,update,setHover};
}

export function installFoldFlow({host,session,view,asset,record}){
 const document=host.controls.document,window=document.defaultView,canvas=host.scene.renderer().domElement;
 const camera=host.scene.camera(),navigation=host.scene.navigation(),viewport=canvas.parentElement,author=createFoldAuthoring();
 let anchor=null,right=null,cameraHeld=false,hovered=false,disposed=false,handledClick=false,lastCamera='',lastBounds='',status;
 const listeners=[],priorCursor=canvas.style.cursor;
 const listen=(node,name,fn,options)=>{node.addEventListener(name,fn,options);listeners.push(()=>node.removeEventListener(name,fn,options));};
 const overlay=document.createElement('div');overlay.className='stockroom-fold-overlay';overlay.dataset.sceneOwnerOverlay='';
 overlay.style.cssText='position:absolute;pointer-events:none;overflow:hidden;z-index:6';viewport.append(overlay);
 const header=document.createElement('div');header.style.cssText='position:absolute;top:18px;left:16px;right:16px;display:flex;align-items:center;gap:12px;pointer-events:none';overlay.append(header);
 const back=document.createElement('button');back.type='button';back.className='btn';back.innerHTML='&#8592;';back.title='Back one decision';back.setAttribute('aria-label','Back one decision');
 back.style.cssText='width:36px;height:32px;padding:0;pointer-events:auto;font-size:20px';header.append(back);
 const phase=document.createElement('div');phase.dataset.foldPhase='';phase.style.cssText='background:#242725e8;color:#eee;padding:7px 10px;border-radius:3px;font-size:12px;max-width:calc(100% - 48px)';header.append(phase);
 const phaseTitle=document.createElement('div'),pair=document.createElement('div'),spanValue=document.createElement('span'),angleValue=document.createElement('span');
 pair.style.cssText='display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:3px;color:#d6dfd9';pair.append(spanValue,angleValue);phase.append(phaseTitle,pair);
 const hint=document.createElement('div');hint.hidden=true;hint.setAttribute('role','tooltip');
 hint.style.cssText='position:absolute;background:#242725;color:#eee;padding:5px 7px;border-radius:3px;font-size:12px';overlay.append(hint);
 const choices=document.createElement('div');choices.dataset.foldChoices='';choices.style.cssText='position:absolute;left:50%;transform:translateX(-50%);display:flex;gap:8px;width:360px;max-width:calc(100% - 24px);pointer-events:auto';overlay.append(choices);
 const buttons=new Map();
 for(const choice of FOLD_CHOICES){
  const button=document.createElement('button');button.type='button';button.className='btn';button.dataset.foldChoice=choice.id;
  button.style.cssText='flex:1;min-width:0;min-height:68px;border-radius:4px;text-align:left;padding:10px 12px;line-height:1.4;white-space:normal';
  const title=document.createElement('strong'),axis=document.createElement('span');title.textContent=choice.label;axis.textContent=choice.axis;
  axis.style.cssText='display:block;font-size:11px;color:#aebbb7';button.append(title,axis);choices.append(button);buttons.set(choice.id,button);
  listen(button,'pointerenter',()=>{if(author.read().stage==='choosing'){author.highlight(choice.id);sync();}});
  listen(button,'focus',()=>{if(author.read().stage==='choosing'){author.highlight(choice.id);sync();}});
  listen(button,'click',event=>{event.stopPropagation();if(author.read().stage==='choosing'){author.highlight(choice.id);author.choose();anchor={x:event.clientX,y:event.clientY};sync();}});
 }
 function project(point){const r=canvas.getBoundingClientRect(),p=viewport.getBoundingClientRect(),v=new T.Vector3(...point).project(camera);return {x:r.left-p.left+(v.x+1)*r.width/2,y:r.top-p.top+(1-v.y)*r.height/2,visible:v.z>=-1&&v.z<=1};}
 function fitOverlay(){
  const r=canvas.getBoundingClientRect(),p=viewport.getBoundingClientRect();let top=16;
  for(const node of document.querySelectorAll('#authoring-viewport-tools,.scene-top-menu,#experiment-toolbar')){
   const b=node.getBoundingClientRect();if(b.height>0&&b.height<r.height/2&&b.top<r.top+120)top=Math.max(top,b.bottom-r.top+12);
  }
  const key=[r.x,r.y,r.width,r.height,p.x,p.y,top].join(',');
  if(key===lastBounds)return;lastBounds=key;
  Object.assign(overlay.style,{left:`${r.x-p.x}px`,top:`${r.y-p.y}px`,width:`${r.width}px`,height:`${r.height}px`});
  header.style.top=`${top}px`;choices.style.top=`${top+66}px`;
 }
 function sync(){
  fitOverlay();
  const frame=author.read(),model=author.display(),encounter=frame.encounter??(!model.receiver?receiverEncounter(model):null);
  view.update(model,{encounter,preview:frame.stage==='tuning'||frame.stage==='choosing'&&!!frame.highlighted});
  const label=frame.stage==='bending'?'Bend':frame.stage==='choosing'&&!frame.highlighted?'Receiving opening':frame.stage==='tuning'||frame.stage==='choosing'?FOLD_CHOICES.find(c=>c.id===(frame.choice??frame.highlighted)).label:frame.model.receiver?'Receiving part':'Fold / receive';
  phaseTitle.textContent=label;pair.hidden=frame.stage!=='tuning'&&!(frame.stage==='choosing'&&frame.highlighted);pair.style.display=pair.hidden?'none':'flex';
  spanValue.textContent=`Span \u2194 ${model.receiverExtent.toFixed(2)} m`;angleValue.textContent=`${model.receiverKind==='side'?'Swing':'Fold'} \u2195 ${Math.round(model.receiverAngle*180/Math.PI)} deg`;
  choices.hidden=frame.stage!=='choosing';choices.style.display=choices.hidden?'none':'flex';back.hidden=frame.depth===0;
  for(const [id,button]of buttons){const selected=id===frame.highlighted;button.setAttribute('aria-pressed',String(selected));button.style.borderColor=selected?'#e4cf99':'#697773';button.style.background=selected?'#384b43':'#242b29';}
  if(status)status.textContent=label;canvas.style.cursor=frame.stage==='bending'?'move':frame.stage==='tuning'?'crosshair':priorCursor;
  session.redraw();
 }
 const eventRecord=kind=>record({kind:'stockroom-fold-flow.'+kind,target:asset.id,effective:author.read(),prepared:true});
 function goBack(){author.back();anchor=null;hint.hidden=true;sync();eventRecord('back');}
 listen(back,'click',goBack);
 function caster(event){const r=canvas.getBoundingClientRect(),ray=new T.Raycaster();ray.setFromCamera(new T.Vector2(2*(event.clientX-r.left)/r.width-1,1-2*(event.clientY-r.top)/r.height),camera);return ray;}
 function picked(event){const model=author.read().model;return caster(event).intersectObjects(view.targets(),false).map(hit=>hit.object.userData.flowAction).find(action=>action==='leaf'||model.receiver)??null;}
 function angleAt(event,frame){const ray=caster(event).ray.clone().applyMatrix4(frame.inverse),hit=ray.intersectPlane(new T.Plane(frame.axis==='y'?new T.Vector3(0,1,0):new T.Vector3(0,0,1),0),new T.Vector3());return hit?(frame.axis==='y'?Math.atan2(hit.x,hit.z):Math.atan2(hit.y,hit.x)):null;}
 function bendAnchor(event){const frame=author.read(),basis=view.frameFor(frame.part),key=frame.part==='leaf'?'angle':frame.part==='receiver'?'receiverAngle':'secondAngle';
  const next={inverse:basis.matrix.clone().invert(),axis:basis.axis,angle:frame.model[key],last:0,total:0};next.last=angleAt(event,next);return next;
 }
 function start(event){
  if(event.button!==0||disposed||event.target.closest?.('button,input,textarea,select,a,[role="button"]'))return;
  const bounds=canvas.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)return;
  const frame=author.read();if(window.kaminosSceneEdits.state().active||navigation.state().gesture)return;
  if(frame.stage==='idle'){
   if(event.target!==canvas)return;
   const action=picked(event);if(!action)return;document.activeElement?.blur?.();author.begin(action);sync();anchor=bendAnchor(event);
  }else if(frame.stage==='bending'){author.hold();anchor=null;sync();}
  else if(frame.stage==='tuning'){author.enter();anchor=null;sync();}
  else if(frame.highlighted){author.choose();anchor={x:event.clientX,y:event.clientY};sync();}
  event.preventDefault();event.stopImmediatePropagation();handledClick=true;hint.hidden=true;eventRecord('click');
 }
 function move(event){
  if(right){if(Math.hypot(event.clientX-right.x,event.clientY-right.y)>5)right.moved=true;anchor=null;return;}
  if(cameraHeld||navigation.state().gesture){anchor=null;return;}
  const frame=author.read();
  if(frame.stage==='bending'){
   if(!anchor){anchor=bendAnchor(event);return;}const at=angleAt(event,anchor);if(at===null||anchor.last===null){anchor.last=at;return;}
   anchor.total+=Math.atan2(Math.sin(at-anchor.last),Math.cos(at-anchor.last));anchor.last=at;author.bend(anchor.angle+anchor.total);sync();
  }else if(frame.stage==='tuning'){
   if(!anchor){anchor={x:event.clientX,y:event.clientY};return;}
   const dx=event.clientX-anchor.x,dy=event.clientY-anchor.y;anchor={x:event.clientX,y:event.clientY};
   author.tune({extent:Math.max(.13,Math.min(1.8,frame.parameters.extent+dx*.004)),angle:frame.parameters.angle-dy*.01});sync();
  }else if(frame.stage==='idle'&&event.target===canvas){
   const action=picked(event);if(view.setHover(action))session.redraw();hint.hidden=!action;
   if(action){const r=viewport.getBoundingClientRect();hint.textContent=action==='leaf'?'Fold span':action==='tip'?'Fold upper part':'Fold receiver';hint.style.left=`${Math.max(0,Math.min(viewport.clientWidth-120,event.clientX-r.left+14))}px`;hint.style.top=`${Math.max(0,Math.min(viewport.clientHeight-30,event.clientY-r.top+14))}px`;}
  }
 }
 // Observe secondary clicks before the shared canvas route; drags stay native.
 listen(viewport,'pointerdown',event=>{
  if(event.button===2){right={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false};anchor=null;}
  if(event.button===1){cameraHeld=true;anchor=null;}
  start(event);
 },true);
 listen(viewport,'pointermove',move,true);
 listen(viewport,'pointerup',event=>{
  if(event.button===2&&right?.id===event.pointerId){const click=!right.moved;right=null;anchor=null;
   if(click&&author.read().depth){navigation.cancel();event.preventDefault();event.stopImmediatePropagation();goBack();}
  }
  if(event.button===1){cameraHeld=false;anchor=null;}
  if(event.button===0&&handledClick&&!event.target.closest?.('button,input,textarea,select,a,[role="button"]')){event.preventDefault();event.stopImmediatePropagation();}
 },true);
 listen(viewport,'click',event=>{if(handledClick&&!event.target.closest?.('button,input,textarea,select,a,[role="button"]')){handledClick=false;event.preventDefault();event.stopImmediatePropagation();}},true);
 listen(viewport,'contextmenu',event=>{event.preventDefault();event.stopImmediatePropagation();});
 listen(viewport,'wheel',()=>{anchor=null;hint.hidden=true;},true);
 listen(viewport,'pointerenter',()=>hovered=true);listen(viewport,'pointerleave',()=>{hovered=false;hint.hidden=true;view.setHover(null);anchor=null;session.redraw();});
 listen(viewport,'pointercancel',()=>{right=null;cameraHeld=false;anchor=null;});
 listen(window,'blur',()=>{right=null;cameraHeld=false;anchor=null;if(['bending','tuning'].includes(author.read().stage))goBack();});
 listen(window,'keydown',event=>{
  if(event.target.closest?.('input,textarea,select,[contenteditable="true"]'))return;
  if(event.key==='Escape'&&author.read().depth){event.preventDefault();event.stopImmediatePropagation();goBack();}
  if(event.key==='Tab'&&hovered&&!event.shiftKey&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();event.stopImmediatePropagation();}
 },true);
 const unsubscribe=session.onFrame(()=>{
  fitOverlay();
  const key=[...camera.matrixWorld.elements,...camera.projectionMatrix.elements].join(',');
  if(key!==lastCamera){lastCamera=key;anchor=null;hint.hidden=true;}
 });
 sync();
 const operations={
  begin:({part='leaf'}={})=>{author.begin(part);anchor=null;sync();eventRecord('begin');},
  bend:({angle})=>{author.bend(angle);anchor=null;sync();eventRecord('bend');},
  hold:()=>{author.hold();anchor=null;sync();eventRecord('hold');},
  highlight:({choice})=>{author.highlight(choice);sync();},
  choose:()=>{author.choose();anchor=null;sync();eventRecord('choose');},
  tune:parameters=>{author.tune(parameters);anchor=null;sync();eventRecord('tune');},
  enter:()=>{author.enter();anchor=null;sync();eventRecord('enter');},back:goBack,
  reset:()=>{author.reset();anchor=null;right=null;cameraHeld=false;sync();eventRecord('reset');},
  frame:()=>session.setView({position:[6.6,5.9,9.3],target:[-.5,1.5,0]}),
 };
 return {
  read:()=>{const frame=author.read(),model=author.display();return {...model,stage:frame.stage,depth:frame.depth,part:frame.part,highlighted:frame.highlighted,choice:frame.choice,parameters:frame.parameters,
   committed:frame.model,encounter:frame.encounter??receiverEncounter(model),screen:Object.fromEntries(Object.entries(view.points()).map(([key,p])=>[key,project(p)])),
   view:session.readView(),rootMatrix:[...view.root.matrixWorld.elements],objectId:asset.id,prepared:true};},operations,
  mount(panel){
   const heading=document.createElement('h3');heading.textContent='Fold / receive';const provenance=document.createElement('span');provenance.textContent='Prepared interface';
   status=document.createElement('div');status.setAttribute('role','status');const actions=document.createElement('div');actions.style.cssText='display:flex;gap:8px;margin-top:12px';
   for(const [label,key]of [['Reset','reset'],['Frame','frame']]){const button=document.createElement('button');button.type='button';button.className='btn';button.textContent=label;button.addEventListener('click',()=>operations[key]());actions.append(button);}
   panel.append(heading,provenance,status,actions);sync();
  },
  dispose(){disposed=true;unsubscribe();listeners.forEach(fn=>fn());overlay.remove();canvas.style.cursor=priorCursor;view.setHover(null);},
 };
}
