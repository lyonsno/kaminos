import {Vector2,Vector3,Raycaster,Plane} from './lib/three.core.js';

// Distance, rather than stroke speed, owns strength. There is no force cap.
export function dragVelocity(start,end,gain=2){
 if(![start,end].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite))||!Number.isFinite(gain)||gain<=0)throw Error('Invalid shove drag');
 const d=end.map((v,i)=>v-start[i]),length=Math.hypot(...d);
 return length?d.map(v=>v/length*gain*Math.log1p(length)):d;
}

// An operation tool on the native viewport. It never owns selection/transforms.
export function mountViewportImpulseGesture({document,viewport,canvas,camera,controls,isActive,onFrame,pick,begin,commit,cancel,onError=console.error,gain=()=>2,fling=false}){
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('aria-label','Rock shove vector');svg.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:15;overflow:visible';
 const make=(tag,attrs)=>{const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);svg.append(n);return n;};
 const line=make('line',{stroke:'#f5dc99','stroke-width':2,'stroke-dasharray':'3 6','stroke-linecap':'round'}),arrow=make('path',{fill:'none',stroke:'#ffe9b4','stroke-width':2.5}),dot=make('circle',{r:5,fill:'#292b2bcc',stroke:'#ffe9b4','stroke-width':2}),label=make('text',{fill:'#fff0cf','font-size':12,'font-family':'system-ui','paint-order':'stroke',stroke:'#222b','stroke-width':4});
 svg.hidden=true;viewport.append(svg);
 let disposed=false,hover=null,hoverPoint=null,querying=false,latest=null,sequence=0,drag=null,enabled=true,claimedPointer=null;
 const raycaster=new Raycaster();
 const rayAt=e=>{const r=canvas.getBoundingClientRect();camera.updateMatrixWorld(true);raycaster.setFromCamera(new Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);return{origin:raycaster.ray.origin.toArray(),direction:raycaster.ray.direction.toArray()};};
 const coords=e=>({clientX:e.clientX,clientY:e.clientY,t:e.timeStamp});
 const set=(n,a)=>{for(const [k,v] of Object.entries(a))n.setAttribute(k,v);};
 function hide(){svg.style.display='none';}
 function showHover(){if(!hover||!hoverPoint||drag||!enabled||!isActive()){hide();return;}const r=viewport.getBoundingClientRect(),x=hoverPoint.clientX-r.left,y=hoverPoint.clientY-r.top;svg.style.display='';svg.hidden=false;line.style.display=arrow.style.display='none';set(dot,{cx:x,cy:y,stroke:hover.released?'#ffe9b4':'#b6bec5'});set(label,{x:x+12,y:y-12});label.textContent=hover.released?(fling?'Drag and flick to fling':'Drag to shove'):'Attached · release its hold first';}
 async function queryHover(){if(querying||!latest||drag||disposed)return;querying=true;const request=latest;latest=null;const id=sequence;
  try{const hit=await pick(rayAt(request));if(!disposed&&!drag&&id===sequence){hover=hit;hoverPoint=request;showHover();}}catch(e){if(!disposed)onError(e);}finally{querying=false;if(latest&&!disposed&&!drag)queryHover();}
 }
 function renderDrag(previewTime){const d=drag;if(!d?.hit||d.finishing)return;const r=viewport.getBoundingClientRect(),a=d.start,b=d.end,x=a.clientX-r.left,y=a.clientY-r.top,X=b.clientX-r.left,Y=b.clientY-r.top;svg.style.display='';svg.hidden=false;line.style.display=arrow.style.display='';set(dot,{cx:x,cy:y,stroke:'#ffe9b4'});set(line,{x1:x,y1:y,x2:X,y2:Y});const angle=Math.atan2(Y-y,X-x),size=10;set(arrow,{d:`M ${X-size*Math.cos(angle-.5)} ${Y-size*Math.sin(angle-.5)} L ${X} ${Y} L ${X-size*Math.cos(angle+.5)} ${Y-size*Math.sin(angle+.5)}`});set(label,{x:X+12,y:Y-12});const speed=Math.hypot(...velocity(d,previewTime)),hot=fling?1-Math.exp(-speed/22):0;
 const color=`rgb(255 ${Math.round(232-195*hot)} ${Math.round(180-138*hot)})`;
 set(dot,{stroke:color});set(line,{stroke:color,'stroke-width':2+2*hot});set(arrow,{stroke:color,'stroke-width':2.5+2*hot});
 label.textContent=`${fling?'Fling':'Shove'} ${speed.toFixed(1)} m/s · Esc cancels`;}
 function planePoint(e,plane){const ray=rayAt(e);raycaster.ray.set(new Vector3(...ray.origin),new Vector3(...ray.direction));return raycaster.ray.intersectPlane(plane,new Vector3());}
 function sample(d,e){d.end=coords(e);d.samples.push(d.end);while(d.samples.length>2&&d.samples[1].t<d.end.t-85)d.samples.shift();d.dirty=true;}
 function velocity(d,previewTime=d.end.t){
  const endPoint=previewTime>d.end.t?{...d.end,t:previewTime}:d.end;
  const p=planePoint(endPoint,d.plane);if(!p)return[0,0,0];
  if(!fling)return dragVelocity(d.hit.worldPoint,p.toArray(),gain());
  const end=endPoint,cut=end.t-85;const samples=end===d.end?d.samples:[...d.samples,end];let at=0;while(at+1<samples.length-1&&samples[at+1].t<=cut)at++;let first=samples[at],next=samples[at+1];
  if(!next||end.t<=first.t||end.t-first.t<8)return[0,0,0];
  if(first.t<cut&&next.t>first.t){
   const f=Math.min(1,(cut-first.t)/(next.t-first.t));
   first={clientX:first.clientX+(next.clientX-first.clientX)*f,clientY:first.clientY+(next.clientY-first.clientY)*f,t:cut};
  }
  const start=planePoint(first,d.plane);if(!start)return[0,0,0];
  const v=p.clone().sub(start).divideScalar(Math.max(.008,(end.t-first.t)/1000));
  const distance=p.distanceTo(new Vector3(...d.hit.worldPoint));
  // A quick flick sets the direction and basic speed; longer wind-ups raise
  // the gain smoothly toward the upper end of the useful throwing range.
  return v.multiplyScalar(gain()*(1.8+7*(1-Math.exp(-distance*.65)))).toArray();
 }
 const swallow=e=>{e.preventDefault();e.stopImmediatePropagation();};
 async function finish(d,apply){if(d.finishing)return;d.finishing=true;
  if(fling){controls.enabled=d.previousControls;try{canvas.releasePointerCapture(d.pointerId);}catch{}hide();}
  try{await d.ready;if(drag!==d)return;if(apply&&Math.hypot(d.end.clientX-d.start.clientX,d.end.clientY-d.start.clientY)>=3)await commit({hit:d.hit,velocity:velocity(d)});else await cancel();}catch(e){if(!disposed)onError(e);await cancel().catch(onError);}finally{if(drag===d){drag=null;if(!fling){controls.enabled=d.previousControls;try{canvas.releasePointerCapture(d.pointerId);}catch{}}hide();hover=null;latest=null;sequence++;}}}
 function down(e){if(!drag)claimedPointer=null;if(e.button!==0||!enabled||!isActive()||!hover?.released||drag)return;
  // A hover may race a rapid pointer jump; never claim an unrelated click.
  if(Math.hypot(e.clientX-hoverPoint.clientX,e.clientY-hoverPoint.clientY)>12)return;
  swallow(e);claimedPointer=e.pointerId;sequence++;latest=null;const d={pointerId:e.pointerId,start:coords(e),end:coords(e),previousControls:controls.enabled,samples:[coords(e)],dirty:true};drag=d;controls.enabled=false;canvas.setPointerCapture(e.pointerId);
  if(fling){d.hit=hover;d.plane=new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()),new Vector3(...hover.worldPoint));renderDrag();}
  d.ready=Promise.resolve().then(()=>begin(rayAt(d.start))).then(hit=>{if(!hit?.released)throw Error('No released rock at the grab point');d.hit=hit;d.plane=new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()),new Vector3(...hit.worldPoint));if(drag===d&&!disposed){d.dirty=true;if(!fling)renderDrag();}return hit;});d.ready.catch(e=>{if(drag===d&&!d.finishing)finish(d,false);});
 }
 function move(e){if(drag){if(drag.finishing||e.pointerId!==drag.pointerId)return;swallow(e);for(const p of e.getCoalescedEvents?.()??[])sample(drag,p);sample(drag,e);if(!fling)renderDrag();return;}if(!enabled||!isActive()||e.buttons){hover=null;hide();return;}latest=coords(e);queryHover();}
 function up(e){if(!drag){if(e.pointerId===claimedPointer)swallow(e);return;}if(e.pointerId!==drag.pointerId)return;swallow(e);sample(drag,e);renderDrag();finish(drag,true);}
 const click=e=>{if(claimedPointer!==null){swallow(e);claimedPointer=null;}};
 const abort=e=>{if(e?.type==='pointercancel'||e?.type==='blur')claimedPointer=null;if(drag){if(e?.type==='keydown'&&e.key!=='Escape')return;swallow(e);finish(drag,false);}};
 const leave=()=>{if(!drag){sequence++;hover=null;latest=null;hide();}};
 const listeners=[];const listen=(t,k,f)=>{t.addEventListener(k,f,true);listeners.push(()=>t.removeEventListener(k,f,true));};
 listen(canvas,'pointerdown',down);listen(canvas,'pointermove',move);listen(canvas,'pointerup',up);listen(canvas,'click',click);listen(canvas,'pointercancel',abort);listen(canvas,'pointerleave',leave);listen(document,'keydown',abort);listen(document.defaultView,'blur',abort);
 const stop=onFrame(({timestampMs}={})=>{if(!enabled||!isActive()){if(drag)finish(drag,false);else hide();}else if(fling&&drag&&(drag.dirty||timestampMs<=drag.end.t+100)){drag.dirty=false;renderDrag(timestampMs);}});hide();
 return{setEnabled(v){enabled=v;if(!v){if(drag)finish(drag,false);else leave();}},read:()=>({enabled,dragging:Boolean(drag),hover:hover?.rock??null}),async dispose(){disposed=true;sequence++;listeners.forEach(f=>f());stop();if(drag)await finish(drag,false);svg.remove();}};
}
