import * as T from './lib/three.core.js';
import {WORKPIECES,choiceFor,createWorkpieceAuthoring} from './stockroom-workpiece-state.mjs';

export function installWorkpieces({host,session,view,asset,record}){
 const document=host.controls.document,window=document.defaultView,canvas=host.scene.renderer().domElement,viewport=canvas.parentElement,camera=host.scene.camera(),navigation=host.scene.navigation(),author=createWorkpieceAuthoring();
 const listeners=[],listen=(node,name,fn,options)=>{node.addEventListener(name,fn,options);listeners.push(()=>node.removeEventListener(name,fn,options));};
 let anchor=null,secondary=null,middle=false,consumed=false,lastCamera='',lastLayout='',disposed=false,panelStatus=null,hovered=false;
 const priorCursor=canvas.style.cursor,overlay=document.createElement('div');overlay.dataset.workpieceOverlay='';overlay.dataset.sceneOwnerOverlay='';overlay.style.cssText='position:absolute;pointer-events:none;z-index:6;overflow:hidden';viewport.append(overlay);
 const top=document.createElement('div');top.style.cssText='position:absolute;left:12px;right:12px;display:flex;gap:8px;align-items:center';overlay.append(top);
 function iconButton(entity,label){const b=document.createElement('button');b.type='button';b.className='btn';b.innerHTML=entity;b.title=label;b.setAttribute('aria-label',label);b.style.cssText='width:34px;height:32px;padding:0;pointer-events:auto;font-size:20px';return b;}
 const back=iconButton('&#8592;','Back one decision'),reset=iconButton('&#8634;','Reset workpieces');top.append(back,reset);
 const status=document.createElement('div');status.style.cssText='background:#242827e8;color:#edf0eb;padding:7px 9px;border-radius:3px;font-size:12px;max-width:260px;min-width:0';top.append(status);
 const labels={},choiceBox=document.createElement('div');choiceBox.dataset.workpieceChoices='';choiceBox.style.cssText='position:absolute;display:flex;gap:6px;pointer-events:auto;align-items:stretch';overlay.append(choiceBox);
 const buttons=new Map();let buttonPiece=null;
 for(const [id,definition]of Object.entries(WORKPIECES)){
  const label=document.createElement('button');label.type='button';label.textContent=definition.label;label.title='Frame '+definition.label.toLowerCase();label.dataset.workpieceLabel=id;
  label.style.cssText='position:absolute;transform:translate(-50%,-50%);background:#242827d9;color:#e9eeea;border:1px solid #677570;border-radius:3px;font-size:11px;padding:5px 8px;white-space:nowrap;pointer-events:auto';overlay.append(label);labels[id]=label;
  listen(label,'click',()=>operations.frame({piece:id}));
 }
 function project(point){const r=canvas.getBoundingClientRect(),p=viewport.getBoundingClientRect(),v=new T.Vector3(...point).project(camera);return {x:r.left-p.left+(v.x+1)*r.width/2,y:r.top-p.top+(1-v.y)*r.height/2,visible:v.z>=-1&&v.z<=1};}
 function layout(){const r=canvas.getBoundingClientRect(),p=viewport.getBoundingClientRect();let safe=12;
  for(const node of document.querySelectorAll('#authoring-viewport-tools,.scene-top-menu,#experiment-toolbar')){const b=node.getBoundingClientRect();if(b.height>0&&b.height<r.height/2&&b.top<r.top+120)safe=Math.max(safe,b.bottom-r.top+10);}
  const key=[r.x,r.y,r.width,r.height,p.x,p.y,safe].join(',');if(key!==lastLayout){lastLayout=key;Object.assign(overlay.style,{left:`${r.x-p.x}px`,top:`${r.y-p.y}px`,width:`${r.width}px`,height:`${r.height}px`});top.style.top=`${safe}px`;}
  const frame=author.read(),points=view.points();for(const [id,label]of Object.entries(labels)){const at=project(points[id].label),x=at.x-(r.x-p.x),y=at.y-(r.y-p.y);label.hidden=!at.visible||x<0||x>r.width||y<0||y>r.height||frame.piece!==null;label.style.left=`${Math.max(65,Math.min(r.width-65,x))}px`;label.style.top=`${Math.max(safe+70,Math.min(r.height-24,y))}px`;}
  if(frame.piece){const compact=r.width<600&&r.height<500,at=project(points[frame.piece].offer),width=compact?112:Math.min(r.width-20,frame.piece==='stairs'?260:360);choiceBox.style.flexDirection=compact?'column':'row';choiceBox.style.width=`${width}px`;choiceBox.style.left=`${compact?r.width-width-10:Math.max(10,Math.min(r.width-width-10,at.x-(r.x-p.x)-width/2))}px`;choiceBox.style.top=`${compact?safe+52:Math.max(safe+65,Math.min(r.height-95,at.y-(r.y-p.y)))}px`;}
 }
 function makeButtons(piece){if(buttonPiece===piece)return;buttonPiece=piece;choiceBox.replaceChildren();buttons.clear();if(!piece)return;
  for(const choice of WORKPIECES[piece].choices){const b=document.createElement('button');b.type='button';b.className='btn';b.dataset.workpieceChoice=choice.id;b.textContent=choice.label;b.title=choice.label;b.style.cssText='flex:1;min-width:0;min-height:44px;padding:7px 8px;border-radius:3px;white-space:normal;font-size:12px;line-height:1.25';choiceBox.append(b);buttons.set(choice.id,b);let choicePoint=null;
   b.addEventListener('pointerdown',event=>{choicePoint={x:event.clientX,y:event.clientY};});
   b.addEventListener('pointerenter',()=>{if(author.read().stage==='choosing'){author.highlight(choice.id);sync();}});
   b.addEventListener('focus',()=>{if(author.read().stage==='choosing'){author.highlight(choice.id);sync();}});
   b.addEventListener('click',event=>{event.stopPropagation();if(author.read().stage==='choosing'){author.highlight(choice.id);author.choose();anchor=choicePoint;choicePoint=null;sync();emit('choose');}});
  }
 }
 function sync(){const frame=author.read(),models=author.display();view.update(models,frame.piece);makeButtons(frame.piece);
  back.hidden=!frame.depth;choiceBox.hidden=frame.stage!=='choosing';choiceBox.style.display=choiceBox.hidden?'none':'flex';
  let text=frame.piece?WORKPIECES[frame.piece].label:'Construction workpieces';
  if(frame.stage==='choosing')text+=' / '+(frame.highlighted?choiceFor(frame.piece,frame.highlighted).label:'Interpretation');
  if(frame.stage==='shaping'||frame.stage==='tuning'){const m=models[frame.piece],c=choiceFor(frame.piece,m.kind);text=c.label+' / '+c.parameters.map(([label,,,unit],i)=>`${label} ${unit==='deg'?Math.round(m[i?'v':'u']*180/Math.PI):m[i?'v':'u'].toFixed(2)}${unit==='deg'?' deg':' m'}`).join(' / ');}
  status.textContent=text;if(panelStatus)panelStatus.textContent=text;
  for(const [id,b]of buttons){const selected=id===frame.highlighted;b.setAttribute('aria-pressed',String(selected));b.style.background=selected?'#425b51':'#272d2b';b.style.borderColor=selected?'#dbc27c':'#72807b';}
  canvas.style.cursor=['shaping','tuning'].includes(frame.stage)?'move':priorCursor;layout();session.redraw();
 }
 function emit(kind){record({kind:'stockroom-workpieces.'+kind,target:asset.id,effective:author.read(),prepared:true});}
 function goBack(){author.back();anchor=null;sync();emit('back');}
 listen(back,'click',goBack);listen(reset,'click',()=>operations.reset());
 function hit(event){const r=canvas.getBoundingClientRect(),ray=new T.Raycaster();ray.setFromCamera(new T.Vector2(2*(event.clientX-r.left)/r.width-1,1-2*(event.clientY-r.top)/r.height),camera);return ray.intersectObjects(view.targets(),false)[0]?.object.userData.workpiece??null;}
 function left(event){if(event.button!==0||disposed||event.target!==canvas||event.target.closest?.('button,input,textarea,select,a'))return;
  if(window.kaminosSceneEdits.state().active||navigation.state().gesture)return;
  const frame=author.read();if(frame.stage==='idle'){const piece=hit(event);if(!piece)return;document.activeElement?.blur?.();author.begin(piece);anchor={x:event.clientX,y:event.clientY};}
  else if(frame.stage==='shaping'){author.hold();anchor=null;}
  else if(frame.stage==='tuning'){author.enter();anchor=null;}
  else if(frame.highlighted){author.choose();anchor={x:event.clientX,y:event.clientY};}
  else return;
  consumed=true;event.preventDefault();event.stopImmediatePropagation();sync();emit('click');
 }
 function move(event){if(secondary){if(Math.hypot(event.clientX-secondary.x,event.clientY-secondary.y)>5)secondary.moved=true;anchor=null;return;}
  if(middle||navigation.state().gesture){anchor=null;return;}
  const frame=author.read();if(['shaping','tuning'].includes(frame.stage)){
   if(!anchor){anchor={x:event.clientX,y:event.clientY};return;}
   const dx=event.clientX-anchor.x,dy=event.clientY-anchor.y;anchor={x:event.clientX,y:event.clientY};
   const model=frame.stage==='shaping'?frame.intent:frame.parameters,choice=choiceFor(frame.piece,model.kind),next={};
   for(const [i,key]of ['u','v'].entries()){const [,min,max]=choice.parameters[i];next[key]=Math.max(min,Math.min(max,model[key]+(i?-dy:dx)*(max-min)/350));}
   author[frame.stage==='shaping'?'shape':'tune'](next);sync();
  }else if(frame.stage==='idle'&&event.target===canvas){if(view.hover(hit(event)))session.redraw();}
 }
 listen(viewport,'pointerdown',event=>{if(event.target!==canvas&&!overlay.contains(event.target))return;if(event.button===2){secondary={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false};anchor=null;}if(event.button===1&&event.target===canvas){middle=true;anchor=null;}left(event);},true);
 listen(viewport,'pointermove',move,true);
 listen(window,'pointerup',event=>{if(event.button===2&&secondary?.id===event.pointerId){const click=!secondary.moved;secondary=null;anchor=null;if(click&&author.read().depth){navigation.cancel();event.preventDefault();event.stopImmediatePropagation();goBack();}}
  if(event.button===1){middle=false;anchor=null;}if(event.button===0&&consumed&&event.target===canvas){event.preventDefault();event.stopImmediatePropagation();}
 },true);
 listen(viewport,'click',event=>{if(consumed&&event.target===canvas){consumed=false;event.preventDefault();event.stopImmediatePropagation();}},true);
 listen(viewport,'contextmenu',event=>{if(event.target===canvas||overlay.contains(event.target)){event.preventDefault();event.stopImmediatePropagation();}},true);
 listen(viewport,'wheel',()=>anchor=null,true);listen(viewport,'pointerenter',()=>hovered=true);listen(viewport,'pointerleave',()=>{hovered=false;anchor=null;view.hover(null);session.redraw();});
 listen(window,'pointercancel',()=>{secondary=null;middle=false;anchor=null;});listen(window,'blur',()=>{secondary=null;middle=false;anchor=null;});
 listen(window,'keydown',event=>{if(event.target.closest?.('input,textarea,select,[contenteditable="true"]'))return;if(event.key==='Escape'&&author.read().depth){event.preventDefault();event.stopImmediatePropagation();goBack();}if(event.key==='Tab'&&hovered&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();event.stopImmediatePropagation();}},true);
 const unsubscribe=session.onFrame(()=>{const key=[...camera.matrixWorld.elements,...camera.projectionMatrix.elements].join(',');if(key!==lastCamera){lastCamera=key;anchor=null;}layout();});
 const operations={begin:({piece})=>{author.begin(piece);anchor=null;sync();emit('begin');},shape:parameters=>{author.shape(parameters);anchor=null;sync();emit('shape');},hold:()=>{author.hold();anchor=null;sync();emit('hold');},highlight:({choice})=>{author.highlight(choice);sync();},choose:()=>{author.choose();anchor=null;sync();emit('choose');},tune:parameters=>{author.tune(parameters);anchor=null;sync();emit('tune');},enter:()=>{author.enter();anchor=null;sync();emit('enter');},back:goBack,
  reset:()=>{author.reset();anchor=null;sync();emit('reset');},frame:({piece}={})=>{const origin=WORKPIECES[piece]?.origin;if(piece&&!origin)throw Error('Unknown workpiece');session.setView(origin?{position:[origin[0]+5.8,5.5,8.4],target:[origin[0],1.3,.3]}:{position:[10.5,10,18],target:[0,1,.3]});anchor=null;},};
 sync();return {operations,read:()=>({...author.read(),display:author.display(),plans:view.plans(),screen:Object.fromEntries(Object.entries(view.points()).map(([id,points])=>[id,Object.fromEntries(Object.entries(points).filter(([key])=>key!=='retained').map(([key,p])=>[key,project(p)]))])),view:session.readView(),objectId:asset.id,prepared:true}),
  mount(panel){const heading=document.createElement('h3');heading.textContent='Construction workpieces';panelStatus=document.createElement('div');panelStatus.setAttribute('role','status');panel.append(heading,panelStatus);sync();},
  dispose(){disposed=true;unsubscribe();listeners.forEach(fn=>fn());overlay.remove();canvas.style.cursor=priorCursor;},};
}
