import * as T from './lib/three.core.js';
import {createPlaceAuthoring,initialPlace,westAt,westSpan} from './stockroom-place-state.mjs';

const dock='dock',reaches={stretch:.32,run:.86};
function fixture(){
 const p=initialPlace();
 p.realization='deck';
 p.pitch=.17;
 p.regions[0].west=[[-1,0],[1,0]];
 p.regions.push({id:'opening',role:'space',shape:'box',center:[-1.45,.08],half:[.42,.27]});
 return p;
}
export function installDirectSpan({host,session,view,asset,record}){
 const document=host.controls.document,win=document.defaultView,canvas=host.scene.renderer().domElement,viewport=canvas.parentElement;
 const camera=host.scene.camera(),navigation=host.scene.navigation(),author=createPlaceAuthoring(fixture());
 const originalCursor=canvas.style.cursor,listeners=[];
 let mode='run',model=author.model(),hover=null,drag=null,pending=null,frame=null,spentPress=false,lastPose='';
 const ribbon=new T.Mesh(new T.BufferGeometry(),new T.MeshBasicMaterial({color:0x5be3c3,side:T.DoubleSide,depthWrite:false}));
 ribbon.name='Active dock span';ribbon.userData.kaminosEditorHelper=true;ribbon.renderOrder=12;ribbon.frustumCulled=false;ribbon.visible=false;view.root.add(ribbon);
 const on=(target,type,fn,options)=>{target.addEventListener(type,fn,options);listeners.push(()=>target.removeEventListener(type,fn,options));};
 const bar=document.createElement('div');
 bar.dataset.sceneOwnerOverlay='';bar.dataset.directSpan='';
 bar.style.cssText='position:absolute;display:flex;gap:3px;z-index:6;align-items:center;padding:3px;background:#252d2bf2;border:1px solid #778580;border-radius:5px;';
 viewport.append(bar);
 const buttons={};
 function button(id,text,title,fn){
  const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=text;b.title=title;b.setAttribute('aria-label',title);
  b.style.cssText='min-height:32px;min-width:34px;padding:4px 9px;border:1px solid transparent;border-radius:3px;background:transparent;color:#ecf3ef;font-size:12px;';
  b.dataset.directSpanAction=id;bar.append(b);on(b,'click',fn);return buttons[id]=b;
 }
 function layout(){
  const b=canvas.getBoundingClientRect(),p=viewport.getBoundingClientRect();
  bar.style.left=(b.left-p.left+12)+'px';
  let top=b.top+12;
  for(const el of document.querySelectorAll('#authoring-viewport-tools,.scene-top-menu,#experiment-toolbar')){
   const r=el.getBoundingClientRect();
   if(r.height>0&&r.height<b.height/2&&r.top<b.top+120)top=Math.max(top,r.bottom+8);
  }
  bar.style.top=(top-p.top)+'px';
 }
 const r=()=>model.regions.find(r=>r.id===dock);
 function sync(){
  model=author.model();asset.root.userData.stockroomPlace=model;view.update(model);draw();
  buttons.back.disabled=!author.read().depth||!!drag;
 }
 function draw(){
  const span=drag??hover;
  ribbon.visible=!!span;
  if(span){
   const [lo,,hi]=westSpan(r(),span.z,span.reach),z0=r().center[1],h=r().half[1];
   const zs=[lo,...r().west.map(([t])=>z0+t*h).filter(z=>z>lo&&z<hi),hi];
   const points=[],y=model.height+.024;
   for(let i=1;i<zs.length;i++){
    const a=zs[i-1],b=zs[i],x=westAt(r(),a),u=westAt(r(),b),w=.038;
    points.push(x-w,y,a,x+w,y,a,u-w,y,b, u-w,y,b,x+w,y,a,u+w,y,b);
   }
   let position=ribbon.geometry.getAttribute('position');
   if(!position||position.array.length<points.length){
    ribbon.geometry.dispose();ribbon.geometry=new T.BufferGeometry();
    position=new T.BufferAttribute(new Float32Array(18*2**Math.ceil(Math.log2(points.length/18))),3).setUsage(T.DynamicDrawUsage);
    ribbon.geometry.setAttribute('position',position);
   }
   position.array.set(points);position.needsUpdate=true;
   ribbon.geometry.setDrawRange(0,points.length/3);
  }
  canvas.style.cursor=drag?'grabbing':hover?'grab':originalCursor;session.redraw();
 }
 const consume=e=>{e.preventDefault();e.stopImmediatePropagation();};
 const sample=e=>({x:e.clientX,y:e.clientY});
 function screen(x,z){
  const b=canvas.getBoundingClientRect(),v=view.root.localToWorld(new T.Vector3(x,model.height,z)).project(camera);
  return {x:b.left+(v.x+1)*b.width/2,y:b.top+(1-v.y)*b.height/2};
 }
 function target(at){
  const b=canvas.getBoundingClientRect();
  const ray=new T.Raycaster();ray.setFromCamera(new T.Vector2(2*(at.x-b.left)/b.width-1,1-2*(at.y-b.top)/b.height),camera);
  view.root.updateWorldMatrix(true,false);
  const origin=view.root.localToWorld(new T.Vector3(0,model.height,0));
  const normal=new T.Vector3(0,1,0).applyNormalMatrix(new T.Matrix3().getNormalMatrix(view.root.matrixWorld));
  const hit=ray.ray.intersectPlane(new T.Plane().setFromNormalAndCoplanarPoint(normal,origin),new T.Vector3());
  if(!hit)return null;
  const local=view.root.worldToLocal(hit),z=local.z;
  if(Math.abs(z-r().center[1])>=r().half[1])return null;
  const x=westAt(r(),z),p=screen(x,z);
  return Math.hypot(p.x-at.x,p.y-at.y)<=22?{z,reach:reaches[mode]}:null;
 }
 function aim(at){
  hover=at&&!navigation.state().gesture&&!win.kaminosSceneEdits?.state().active?target(at):null;draw();
 }
 function emit(stage,requested){record({kind:'stockroom-direct-span.'+stage,target:asset.id,requested,effective:author.read(),prepared:true});}
 function start(e){
  if(e.button!==0)return;
  if(drag||e.shiftKey||e.metaKey||e.altKey||e.ctrlKey||navigation.state().gesture||win.kaminosSceneEdits?.state().active)return;
  const at=sample(e),span=target(at);
  if(!span)return;
  const x=westAt(r(),span.z),a=screen(x,span.z),b=screen(x+.2,span.z),dx=(b.x-a.x)/.2,dy=(b.y-a.y)/.2,length=dx*dx+dy*dy;
  if(length<1)return;
  const spec={kind:'span',id:dock,...span};
  canvas.setPointerCapture(e.pointerId);author.begin(spec);
  drag={...span,id:e.pointerId,start:at,dx,dy,length,last:0,travel:false};spentPress=true;
  draw();emit('begin',spec);consume(e);
 }
 function preview(at){
  if(!drag)return;
  const x=at.x-drag.start.x,y=at.y-drag.start.y;
  if(!drag.travel&&Math.hypot(x,y)<3)return;
  drag.travel=true;
  const value=(x*drag.dx+y*drag.dy)/drag.length;
  if(value===drag.last)return;
  drag.last=value;author.preview(value);sync();emit('preview',{value});
 }
 function flush(){
  if(frame!==null)win.cancelAnimationFrame(frame);
  frame=null;
  const at=pending;pending=null;
  if(at)preview(at);
 }
 function finish(cancel,at){
  if(!drag)return;
  const current=drag;
  if(!cancel){flush();if(at)preview(at);author.commit();}else{pending=null;flush();author.cancel();}
  drag=null;hover=null;
  if(canvas.hasPointerCapture(current.id))canvas.releasePointerCapture(current.id);
  sync();if(at&&!cancel)aim(at);
  emit(cancel?'cancel':'commit',{value:current.last});
 }
 const operations={
  reach({value}){if(!Object.hasOwn(reaches,value)||drag)return;mode=value;for(const k of Object.keys(reaches)){const b=buttons[k],active=k===mode;b.setAttribute('aria-pressed',String(active));b.style.background=active?'#3e594f':'transparent';b.style.borderColor=active?'#9bc5b7':'transparent';}if(hover){hover.reach=reaches[mode];draw();}},
  back(){if(drag)finish(true);else{author.back();hover=null;sync();emit('back');}},
  reset(){finish(true);author.reset();hover=null;sync();emit('reset');},
  frame(){finish(true);session.setView({position:[-6.6,7.2,7.9],target:[-1,.65,0],fov:43});},
 };
 button('stretch','Short','Short reach',()=>operations.reach({value:'stretch'}));
 button('run','Long','Long reach',()=>operations.reach({value:'run'}));
 button('back','\u2190','Undo last pull',operations.back);
 button('reset','\u21bb','Reset dock',operations.reset);
 operations.reach({value:mode});
 // Native gizmos see presses first; misses and modified clicks are untouched.
 on(win,'pointerdown',e=>{if(e.button===0&&!drag)spentPress=false;},true);
 on(canvas,'pointerdown',start);
 on(canvas,'pointermove',e=>{
  if(drag){
   if(e.pointerId!==drag.id)return;
   pending=sample(e);if(frame===null)frame=win.requestAnimationFrame(()=>{frame=null;flush();});consume(e);
  }else if(!e.buttons)aim(sample(e));else if(hover)aim(null);
 });
 on(canvas,'pointerup',e=>{if(drag?.id===e.pointerId&&e.button===0){consume(e);finish(false,sample(e));}});
 on(canvas,'click',e=>{if(spentPress&&e.detail>0){spentPress=false;consume(e);}},true);
 on(canvas,'pointerleave',()=>{if(!drag&&hover)aim(null);});
 for(const type of ['pointercancel','lostpointercapture'])on(canvas,type,e=>{if(drag?.id===e.pointerId)finish(true);});
 on(win,'blur',()=>{finish(true);if(hover)aim(null);});
 on(win,'keydown',e=>{if(drag&&e.key==='Escape'){consume(e);finish(true);}},true);
 const stop=session.onFrame(()=>{
  layout();
  const pose=[...camera.matrixWorld.elements,...camera.projectionMatrix.elements,...view.root.matrixWorld.elements].join(',');
  if(pose!==lastPose){lastPose=pose;if(drag)finish(true);else if(hover)aim(null);}
 });
 sync();layout();
 return {operations,read(){
  const span=drag??hover;
  return {place:author.model(),plan:view.plan(),interaction:{stage:drag?'dragging':hover?'hover':'idle',depth:author.read().depth,mode,span:span?{z:span.z,reach:span.reach}:null},
   screen:{prepared:[-.84,-.3,0,.34,.83].map(z=>({z,...screen(westAt(r(),z),z),out:screen(westAt(r(),z)-.65,z)}))},prepared:true,objectId:asset.id};
 },dispose(){finish(true);stop();listeners.forEach(fn=>fn());bar.remove();ribbon.removeFromParent();ribbon.geometry.dispose();ribbon.material.dispose();canvas.style.cursor=originalCursor;}};
}
