import {Vector3} from './lib/three.core.js';

// Spatial annotations for explicit constraints on registered scene objects.
// The owner supplies world-space mounts and performs the actual release.
export function mountViewportAttachmentControls({document,viewport,canvas,camera,onFrame,isActive,asset,attachments,onRelease}){
 if(!asset?.id||!asset.root)throw Error('Attachment controls need a registered owner');
 const layer=document.createElement('div');layer.className='pose-anchor-layer';layer.dataset.ownerId=asset.id;layer.setAttribute('aria-label','Pose anchors');layer.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:16';
 const style=document.createElement('style');style.textContent=`.pose-anchor-pin{position:absolute;width:30px;height:30px;padding:4px;border:1px solid #bdc9cf99;border-radius:50%;background:#252e35a8;color:#d5e0e5;pointer-events:auto;cursor:grab;opacity:.55;touch-action:none;box-shadow:0 1px 5px #0004}.pose-anchor-pin:hover,.pose-anchor-pin:focus-visible,.pose-anchor-pin[data-pulling=true]{opacity:1;background:#38434bee;border-color:#f2dda5;outline:none}.pose-anchor-pin svg{display:block;width:20px;height:20px}.pose-anchor-caption{position:absolute;left:35px;top:-4px;width:max-content;max-width:215px;padding:5px 8px;border-radius:5px;background:#202930ed;color:#edf2f2;font:11px/1.35 system-ui;text-align:left;opacity:0;pointer-events:none;white-space:normal}.pose-anchor-pin:hover .pose-anchor-caption,.pose-anchor-pin:focus-visible .pose-anchor-caption,.pose-anchor-pin[data-pulling=true] .pose-anchor-caption,.pose-anchor-pin[data-error=true] .pose-anchor-caption{opacity:1}.pose-anchor-caption strong{display:block;font-size:12px;color:#f0d99b}.pose-anchor-pin[aria-disabled=true]{border-style:dashed;color:#aab6bb}.pose-anchor-layer[hidden]{display:none}`;layer.append(style);
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('aria-hidden','true');svg.style.cssText='position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none';layer.append(svg);viewport.append(layer);
 const entries=new Map();let visible=true,disposed=false;
 const set=(n,a)=>{for(const [k,v] of Object.entries(a))n.setAttribute(k,String(v));};
 function message(e,text){e.message=text;e.button.dataset.error='true';e.detail.textContent=text;}
 async function release(e,source){if(e.busy||disposed)return;if(!source.canRelease){message(e,source.reason||'This anchor cannot be released');return;}e.busy=true;e.button.setAttribute('aria-busy','true');
  try{await onRelease({id:source.id,generation:source.generation});if(!disposed){e.message=null;e.button.dataset.error='false';update();}}
  catch(error){if(!disposed)message(e,error.message);}finally{e.busy=false;e.button.removeAttribute('aria-busy');}
 }
 function cancel(e){if(!e.drag)return;e.drag=null;e.ignoreClick=true;e.cancelledPointer=true;e.button.dataset.pulling='false';update();}
 function create(record){
  const button=document.createElement('button');button.type='button';button.className='pose-anchor-pin';button.dataset.anchorId=record.id;
  const icon=document.createElementNS(ns,'svg');icon.setAttribute('viewBox','0 0 20 20');icon.setAttribute('aria-hidden','true');const path=document.createElementNS(ns,'path');set(path,{d:'M6 3h8l-2 5 3 3H5l3-3z M10 11v7',fill:'none',stroke:'currentColor','stroke-width':1.6,'stroke-linejoin':'round','stroke-linecap':'round'});icon.append(path);button.append(icon);
  const caption=document.createElement('span');caption.className='pose-anchor-caption';const title=document.createElement('strong'),detail=document.createElement('span');caption.append(title,detail);button.append(caption);layer.append(button);
  const line=document.createElementNS(ns,'path'),dot=document.createElementNS(ns,'circle'),face=document.createElementNS(ns,'polygon');set(line,{fill:'none',stroke:'#cbd8df','stroke-width':1,'stroke-dasharray':'2 3',opacity:.6});set(dot,{r:3,fill:'#27333b',stroke:'#dce6e8','stroke-width':1.2});set(face,{fill:'#e8d6a411',stroke:'#f4dda4','stroke-width':1.3,opacity:0});svg.append(face,line,dot);
  const e={button,detail,title,line,dot,face,record,drag:null,busy:false,ignoreClick:false,message:null,listeners:[],hot:false};
  const listen=(target,type,fn)=>{target.addEventListener(type,fn);e.listeners.push(()=>target.removeEventListener(type,fn));};
  for(const type of ['pointerdown','pointermove','pointerup','click','dblclick','wheel','keydown','keyup'])listen(button,type,event=>event.stopPropagation());
  listen(button,'pointerenter',()=>{e.hot=true;set(face,{opacity:1});});listen(button,'pointerleave',()=>{e.hot=false;if(!e.drag)set(face,{opacity:0});});
  listen(button,'focus',()=>set(face,{opacity:1}));listen(button,'blur',()=>{cancel(e);set(face,{opacity:0});});
  listen(button,'pointerdown',event=>{if(event.button!==0||e.busy||!isActive())return;e.ignoreClick=false;e.cancelledPointer=false;e.message=null;button.dataset.error='false';if(!e.record.canRelease){message(e,e.record.reason);return;}e.drag={x:event.clientX,y:event.clientY,dx:0,dy:0,source:{...e.record}};e.pointerId=event.pointerId;button.dataset.pulling='true';button.setPointerCapture(event.pointerId);});
  listen(button,'pointermove',event=>{if(!e.drag||event.pointerId!==e.pointerId)return;e.drag.dx=event.clientX-e.drag.x;e.drag.dy=event.clientY-e.drag.y;const length=Math.hypot(e.drag.dx,e.drag.dy);detail.textContent=length>=18?'Release to unpin':'Pull out, then release · Esc cancels';update();});
  listen(button,'pointerup',event=>{if(event.pointerId!==e.pointerId)return;if(!e.drag){if(e.cancelledPointer){event.preventDefault();e.cancelledPointer=false;try{button.releasePointerCapture(event.pointerId);}catch{}}return;}const d=e.drag;e.drag=null;button.dataset.pulling='false';try{button.releasePointerCapture(event.pointerId);}catch{}if(Math.hypot(d.dx,d.dy)>=18){event.preventDefault();e.ignoreClick=true;release(e,d.source);}update();});
  listen(button,'pointercancel',()=>cancel(e));listen(button,'click',event=>{event.preventDefault();if(e.ignoreClick){e.ignoreClick=false;return;}if(isActive())release(e,{...e.record});});
  listen(button,'keydown',event=>{if(event.key==='Escape'){event.preventDefault();cancel(e);}});
  entries.set(record.id,e);return e;
 }
 function remove(e){cancel(e);try{e.button.releasePointerCapture(e.pointerId);}catch{}e.listeners.forEach(f=>f());for(const n of [e.button,e.line,e.dot,e.face])n.remove();}
 function update(){
  if(disposed)return;const active=visible&&isActive();layer.hidden=!active;if(!active){for(const e of entries.values())if(e.drag)cancel(e);return;}
  camera.updateMatrixWorld(true);const v=viewport.getBoundingClientRect(),r=canvas.getBoundingClientRect(),placed=[],records=attachments().filter(a=>a.attached&&a.worldPoint);
  const ids=new Set(records.map(a=>a.id));for(const [id,e] of entries)if(!ids.has(id)){entries.delete(id);remove(e);}
  const project=p=>{const q=new Vector3(...p).project(camera);return{x:r.left-v.left+(q.x+1)*r.width/2,y:r.top-v.top+(1-q.y)*r.height/2,z:q.z};};
  for(const a of records){const e=entries.get(a.id)??create(a);if(e.drag&&e.drag.source.generation!==a.generation)cancel(e);e.record=a;const p=project(a.worldPoint),shown=Number.isFinite(p.x+p.y+p.z)&&p.z>=-1&&p.z<=1&&p.x>=0&&p.x<=v.width&&p.y>=0&&p.y<=v.height;e.button.hidden=!shown;e.line.style.display=e.dot.style.display=e.face.style.display=shown?'':'none';if(!shown)continue;
   let x=p.x,y=p.y-29;for(let i=0;i<placed.length;){if(placed.some(q=>Math.hypot(q.x-x,q.y-y)<34)){x+=34;i++;}else break;}x=Math.max(16,Math.min(x,v.width-16));y=Math.max(17,Math.min(y,v.height-17));placed.push({x,y});
   const dx=e.drag?.dx??0,dy=e.drag?.dy??0;e.button.style.left=(x+dx-15)+'px';e.button.style.top=(y+dy-15)+'px';e.button.style.transform='';e.button.dataset.pulling=String(Boolean(e.drag));
   set(e.line,{d:`M ${p.x} ${p.y} L ${x+dx} ${y+dy}`});set(e.dot,{cx:p.x,cy:p.y});set(e.face,{points:a.worldFace.map(p=>{const q=project(p);return q.x+','+q.y;}).join(' ')});
   e.button.setAttribute('aria-label','Release pose anchor — '+a.bodyId);e.button.setAttribute('aria-disabled',String(!a.canRelease));e.title.textContent='Pose anchor · '+a.bodyId;
   if(!e.drag)e.detail.textContent=e.message??(a.canRelease?'Holds position + orientation · pull pin or click to release':a.reason);
   e.button.title='Pose anchor: '+a.bodyId+'. '+e.detail.textContent;
   e.detail.parentNode.style.left=x>v.width-240?'auto':'35px';e.detail.parentNode.style.right=x>v.width-240?'35px':'auto';
  }
 }
 const stop=onFrame(update),blur=()=>{for(const e of entries.values())cancel(e);};document.defaultView.addEventListener('blur',blur);update();
 return{setVisible(value){visible=Boolean(value);update();},update,dispose(){if(disposed)return;disposed=true;stop();document.defaultView.removeEventListener('blur',blur);for(const e of entries.values())remove(e);entries.clear();layer.remove();}};
}
