import {bindParticleNumber} from '../particle-number-control.mjs';

const SVG='http://www.w3.org/2000/svg';
const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));

export function mountParticleLivePopups({document,root,controls,readCoverage,setCoverage,saveCoverage,readSupport,setSupport,readSmokeAvailable,readLighting,setLighting}){
 const win=document.defaultView;
 const create=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
 const cleanups=[];
 function popup(id,title,key){
  const panel=create('section'),header=create('header'),name=create('strong',title),close=create('button','Close'),launcher=create('button',title+' · Alt-'+key);
  panel.id=id;panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label',title);panel.tabIndex=-1;
  panel.style.cssText='position:fixed;z-index:180;top:60px;right:16px;width:min(370px,calc(100vw - 32px));box-sizing:border-box;max-height:calc(100vh - 76px);overflow:auto;padding:14px;border:1px solid #62788a;border-radius:12px;background:#1b2633;color:#ecf1f7;box-shadow:0 8px 28px #0009;font:13px system-ui';
  panel.className='particle-live-popup';
  header.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:9px';
  launcher.type=close.type='button';launcher.setAttribute('aria-controls',id);launcher.setAttribute('aria-expanded','false');
  header.append(name,close);panel.append(header);document.body.append(panel);root.append(launcher);
  const toggle=()=>{
   const opening=panel.hidden;panel.hidden=!opening;launcher.setAttribute('aria-expanded',String(opening));
   if(opening){panel.focus({preventScroll:true});sync(true);}else{if(key==='P')finishCurve(false);if(panel.contains(document.activeElement))document.activeElement.blur();}
  };
  close.addEventListener('click',toggle);launcher.addEventListener('click',toggle);
  return {panel,toggle};
 }
 const style=create('style');
 style.textContent=`
  .particle-live-popup { color-scheme: dark }
  .particle-live-popup :is(button,select,input[type=number]) {
   background:#111a23;color:#ecf1f7;border:1px solid #506171;border-radius:4px;padding:2px 6px;font:inherit
  }
  .particle-live-popup input[type=number] { width:100%;box-sizing:border-box;text-align:right;font-variant-numeric:tabular-nums }
  .particle-live-popup input[type=checkbox] { justify-self:start;accent-color:#8bd8f3 }
  .particle-live-popup :focus-visible { outline:2px solid #8bd8f3;outline-offset:2px }
 `;
 document.head.append(style);
 const light=popup('particle-live-lighting','Distributed lighting','F');
 const cover=popup('particle-live-coverage','Particle coverage','P');
 for(const [a,b] of [[light,cover],[cover,light]])a.panel.addEventListener('focusin',()=>{if(!b.panel.hidden)b.toggle();});
 const keyHandler=event=>{
  if(event.key==='Escape'){
   const active=[cover,light].find(item=>!item.panel.hidden&&item.panel.contains(document.activeElement))
    ??[cover,light].find(item=>!item.panel.hidden);
   if(active){event.preventDefault();event.stopPropagation();if(active!==cover||!finishCurve(false))active.toggle();}
   return;
  }
  if(event.repeat||!event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
  const item=event.code==='KeyF'?light:event.code==='KeyP'?cover:null;
  if(item){event.preventDefault();event.stopPropagation();const other=item===light?cover:light;if(item.panel.hidden&&!other.panel.hidden)other.toggle();item.toggle();sync(true);}
 };
 document.addEventListener('keydown',keyHandler,true);
 const lightNote=create('p','Receiver grid stores incoming light. Transport grid holds the emission and extinction that the rays sample. The flame simulation and Fill are unchanged.');
 const lightStatus=create('p');lightStatus.setAttribute('role','status');lightStatus.style.cssText='min-height:2em;color:#b4cddd;margin-bottom:0';
 const useScene=create('button','Use scene settings');useScene.type='button';
 useScene.addEventListener('click',()=>{try{doLighting(null);}catch(error){lightFailed(error);}});
 const lightQuality=create('p');lightQuality.style.cssText='color:#b4cddd;margin:8px 0';
 const lightError=create('p');lightError.setAttribute('role','alert');lightError.style.color='#ffc181';lightError.hidden=true;
 const lightFields=[];
 const row=(name,input)=>{
  const label=create('label'),caption=create('span',name);input.setAttribute('aria-label',name);
  label.style.cssText='display:grid;grid-template-columns:minmax(0,1fr) minmax(9.3em,auto);gap:12px;align-items:center;margin:8px 0';label.append(caption,input);return {label,caption};
 };
 const gridWidth=key=>key==='volumeGrid'||key==='sourceGrid';
 const qualityStep=(key,s)=>key==='directions'?2:gridWidth(key)?(s?.widthStep??1):null;
 const liveValues=s=>s?.requested??{enabled:true,intervalMs:250,...s?.native};
 const doLighting=patch=>{const next=setLighting(patch);lightError.hidden=true;sync(true);return next;};
 const lightFailed=e=>{lightError.hidden=false;lightError.textContent=e.message;};
 for(const [key,name,type,min,step,max] of [
  ['enabled','Distributed lighting','checkbox'],['intervalMs','Refresh interval (ms)','number',1,10],
  ['gain','Light gain','number',0,.05],
  ['directions','Directions','number',2,2],
  ['volumeGrid','Receiver grid width','number',1,1],
  ['sourceGrid','Transport grid width','number',1,1],['environmentBlur','Environment blur','number',0,.025,1],
  ['lightSurfaces','Light scene surfaces','checkbox'],
 ]){
  const input=create('input');input.type=type;
  const {label,caption}=row(name,input);light.panel.append(label);lightFields.push({key,input});
  if(type==='checkbox')input.addEventListener('change',()=>{try{doLighting({[key]:input.checked});}catch(e){lightFailed(e);sync(true);}});
  else{
   input.min=String(min);input.step=String(step);if(max!==undefined)input.max=String(max);
   const quality=qualityStep(key,null)!==null;
   const binding=bindParticleNumber({input,read:()=>liveValues(readLighting())[key],apply:v=>doLighting({[key]:v}),onError:lightFailed,onAccepted:()=>{lightError.hidden=true;},scrubCommit:quality?'release':'live'});
   const drag=controls.installNumberDrag?.({input,grip:caption,step,...(quality?{snap:value=>{const width=qualityStep(key,readLighting());return Math.max(width,Math.round(value/width)*width);}}:{})});cleanups.push(()=>{binding.dispose();drag?.dispose?.();});
  }
 }
 light.panel.append(lightQuality,lightNote,lightStatus,lightError,useScene);

 const basis=create('select'),basisRow=row('Horizontal axis',basis);
 for(const [value,label] of [['lifetime','Lifetime'],['mixing','Fuel consumed']]){const option=create('option',label);option.value=value;basis.append(option);}
 const basisNote=create('p'),curveError=create('p');curveError.setAttribute('role','alert');curveError.style.color='#ffc181';curveError.hidden=true;
 const smokeFields=create('fieldset'),smokeInputs=[],smokeStatus=create('p');
 smokeFields.style.cssText='margin:10px 0 16px;padding:3px 10px 8px;min-width:0;border:1px solid #506171;border-radius:5px';
 smokeStatus.style.cssText='color:#b4cddd;margin:.5em 0';smokeStatus.setAttribute('role','status');
 smokeFields.append(create('legend','Drifting smoke footprint'),smokeStatus);
 cover.panel.append(smokeFields,curveError,basisRow.label,basisNote,create('p','Grab a point to move it, or click the graph to add one. Use Delete or Remove point to remove a selected interior point. 1× keeps the existing value.'));
 const supportFields=[];
 for(const [key,name,step] of [['pixelFloor','Pixel floor',.05],['maxFootprint','Footprint ceiling (px)',.25]]){
  const input=create('input');input.type='number';input.min='0';input.step=String(step);
  const {label,caption}=row(name,input);cover.panel.append(label);supportFields.push({key,input});
  const binding=bindParticleNumber({input,read:()=>readSupport()[key],apply:v=>{setSupport({[key]:v});sync(true);},onError:e=>{curveError.textContent=e.message;curveError.hidden=false;},onAccepted:()=>{curveError.hidden=true;}});
  const drag=controls.installNumberDrag?.({input,grip:caption,step});cleanups.push(()=>{binding.dispose();drag?.dispose?.();});
 }
 const supportNote=create('p','If the footprint stops growing, raise the ceiling. Zero removes the ceiling.');supportNote.style.cssText='color:#b4cddd';cover.panel.append(supportNote);
 const edits=win.kaminosSceneEdits,curveTarget=edits?'@particle-coverage:'+win.crypto.randomUUID():null;
 const curvePart=({basis,footprint,opacity})=>({basis,footprint,opacity});
 let draft=null,pending=0,gesture=null;
 const curveFailed=e=>{curveError.textContent=e.message;curveError.hidden=false;};
 if(edits)edits.register(curveTarget,{
  read:()=>curvePart(readCoverage()),
  check:value=>curvePart(value),
  write:value=>{
   setCoverage({...readCoverage(),...value},{preview:edits.state().active?.id===curveTarget});
   redraw();
  },
 });
 function beginCurve(label){
  if(gesture)return false;
  try{edits?.begin(curveTarget,label);gesture={before:curvePart(readCoverage())};curveError.hidden=true;return true;}
  catch(e){curveFailed(e);return false;}
 }
 function flushCurve(){
  if(pending)win.cancelAnimationFrame(pending);pending=0;
  if(!draft)return;
  const next=draft;draft=null;
  if(edits){if(edits.state().active?.id!==curveTarget)throw Error('The scene cancelled this curve edit');edits.preview(curvePart(next));}
  else setCoverage(next,{preview:true});
 }
 function finishCurve(accept){
  if(!gesture)return false;
  const {before}=gesture;gesture=null;
  try{
   if(accept){
    flushCurve();
    edits?.commit();
    if(JSON.stringify(before)!==JSON.stringify(curvePart(readCoverage())))saveCoverage();
   }else{
    if(pending)win.cancelAnimationFrame(pending);pending=0;draft=null;
    if(edits){if(edits.state().active?.id===curveTarget)edits.cancel();}
    else setCoverage({...readCoverage(),...before},{preview:true});
   }
  }catch(e){
   if(edits?.state().active?.id===curveTarget)edits.cancel();
   curveFailed(e);
  }
  redraw();return true;
 }
 function edit(next){
  draft=next;if(!pending)pending=win.requestAnimationFrame(()=>{pending=0;try{flushCurve();}catch(e){finishCurve(false);curveFailed(e);}});redraw();
 }
 function oneEdit(next,label){if(!beginCurve(label))return false;draft=next;return finishCurve(true);}
 basis.addEventListener('change',()=>{if(!oneEdit({...current(),basis:basis.value},'Change particle coverage axis'))redraw();});
 const historyKey=event=>{
  if(!edits||cover.panel.hidden||!cover.panel.contains(event.target)||!(event.metaKey||event.ctrlKey)||event.altKey||event.key.toLowerCase()!=='z'||event.target.closest?.('input,textarea,[contenteditable]'))return;
  event.preventDefault();event.stopPropagation();
  if(finishCurve(false))return;
  try{const result=event.shiftKey?edits.redo():edits.undo();Promise.resolve(result).catch(curveFailed);}
  catch(e){curveFailed(e);}
 };
 win.addEventListener('keydown',historyKey,true);
 const current=()=>draft??readCoverage();
 for(const [key,name,min,step,title] of [
  ['radius','Smoke radius multiplier',1,.1,'1× off. A larger footprint spreads the same optical weight.'],
  ['minExtinction','Minimum extinction',0,.05,'Local extinction before parcel weight. Growth eases in between this value and twice it.'],
  ['maxEmission','Maximum intrinsic emission',0,.25,'Growth eases out from half this value to this value, before display gain and incident light. Zero disables growth.'],
  ['ageStart','Start age (reaction steps)',0,1,'Age only opens the ramp. The carrier must still meet both optical thresholds.'],
  ['ageRamp','Age ramp (reaction steps)',0,1,'Time from the start age to full growth for eligible smoke.'],
  ['maxFootprint','Smoke footprint ceiling (px)',0,.25,'Can extend the ordinary ceiling for eligible smoke. Zero uses the ordinary ceiling.'],
 ]){
  const input=create('input');input.type='number';input.min=String(min);input.step=String(step);input.title=title;
  const {label,caption}=row(name,input);caption.title=title;smokeFields.append(label);smokeInputs.push({key,input});
  const binding=bindParticleNumber({input,read:()=>current().smoke[key],apply:value=>{
   if(gesture)finishCurve(true);
   const coverage=readCoverage();setCoverage({...coverage,smoke:{...coverage.smoke,[key]:value}});sync(true);
  },onError:e=>{curveError.textContent=e.message;curveError.hidden=false;},onAccepted:()=>{curveError.hidden=true;}});
  const drag=controls.installNumberDrag?.({input,grip:caption,step});cleanups.push(()=>{binding.dispose();drag?.dispose?.();});
 }
 const editors=[];
 for(const [kind,title,note,color] of [['footprint','Footprint','Multiplies radius before pixel floor and footprint ceiling. Zero hides the carrier.','#f9b167'],['opacity','Opacity','Multiplies optical depth. Direct emission stays independent.','#8bd8f3']]){
  const label=create('strong',title),description=create('div',note),reset=create('button','Reset'),remove=create('button','Remove point'),chart=document.createElementNS(SVG,'svg');
  const line=document.createElementNS(SVG,'polyline'),grid=document.createElementNS(SVG,'path'),knots=document.createElementNS(SVG,'g');
  const top=create('div'),footer=create('div'),readout=create('span');
  reset.type=remove.type='button';reset.setAttribute('aria-label','Reset '+title.toLowerCase());remove.setAttribute('aria-label','Remove '+title.toLowerCase()+' point');top.style.cssText='display:flex;justify-content:space-between;align-items:center;gap:5px;margin-top:10px';label.style.marginRight='auto';
  description.style.cssText='color:#b4cddd;margin:3px 0';
  footer.style.cssText='display:flex;justify-content:space-between;color:#b4cddd;font-variant-numeric:tabular-nums';
  chart.setAttribute('viewBox','0 0 330 96');chart.setAttribute('preserveAspectRatio','none');chart.setAttribute('aria-label',title+' curve');chart.setAttribute('tabindex','0');
  chart.style.cssText='display:block;width:100%;height:100px;touch-action:none;background:#111a23;border:1px solid #506171;border-radius:5px;cursor:crosshair';
  grid.setAttribute('fill','none');grid.setAttribute('stroke','#354755');
  line.setAttribute('fill','none');line.setAttribute('stroke',color);line.setAttribute('stroke-width','2');
  chart.append(grid,line,knots);top.append(label,remove,reset);footer.append(create('span','0%'),readout,create('span','100%'));cover.panel.append(top,description,chart,footer);
  let chosen=null,hovered=null,drag=null,upper=2;
  const px=x=>8+314*x,py=(y,limit)=>88-80*y/limit;
  function draw(){
   const points=current()[kind];if(chosen>=points.length)chosen=null;
   remove.disabled=chosen===null||chosen===0||chosen===points.length-1;
   const limit=drag?.limit??Math.ceil(points.reduce((limit,p)=>Math.max(limit,p[1]),2));
   grid.setAttribute('d','M 8 8 V 88 H 322 M 8 '+py(1,limit)+' H 322 M 165 8 V 88');
   line.setAttribute('points',points.map(([x,y])=>px(x)+','+py(y,limit)).join(' '));
   const nodes=points.map(([x,y],i)=>{const dot=document.createElementNS(SVG,'circle');
    dot.setAttribute('cx',px(x));dot.setAttribute('cy',py(y,limit));dot.setAttribute('r',i===chosen||i===hovered?5:3.8);
    dot.setAttribute('fill',i===chosen?'#fff':color);return dot;});
   knots.replaceChildren(...nodes);
   readout.textContent=chosen===null?'0–'+limit+'×':Math.round(points[chosen][0]*100)+'% · '+Number(points[chosen][1].toFixed(2))+'×';
   upper=limit;
  }
  const coordinates=e=>{const r=chart.getBoundingClientRect();return [clamp(((e.clientX-r.left)/r.width*330-8)/314,0,1),clamp((88-(e.clientY-r.top)/r.height*96)/80,0,1)*(drag?.limit??upper)];};
  const hit=e=>{
   const box=chart.getBoundingClientRect();let nearest=null,best=12;
   current()[kind].forEach(([x,y],i)=>{
    const distance=Math.hypot(e.clientX-box.left-px(x)*box.width/330,e.clientY-box.top-py(y,upper)*box.height/96);
    if(distance<best){best=distance;nearest=i;}
   });
   return nearest;
  };
  const showHit=next=>{chart.style.cursor=drag&&gesture?'grabbing':next===null?'crosshair':'grab';if(hovered!==next){hovered=next;draw();}};
  const removePoint=()=>{
   if(remove.disabled)return;
   const points=current()[kind].map(point=>[...point]);points.splice(chosen,1);chosen=null;oneEdit({...current(),[kind]:points},'Remove '+title.toLowerCase()+' point');
  };
  remove.addEventListener('click',removePoint);
  chart.addEventListener('pointerdown',e=>{
   if(e.button!==0||drag)return;
   const [x,y]=coordinates(e),points=current()[kind].map(point=>[...point]),near=hit(e);
   const i=points.findIndex(([xx])=>xx>x),insert=near===null&&i>0&&Math.fround(x)>points[i-1][0]&&Math.fround(x)<points[i][0];
   if(!beginCurve((insert?'Add ':'Move ')+title.toLowerCase()+' point'))return;
   chosen=near??(insert?i:x<.5?0:points.length-1);
   if(insert)points.splice(i,0,[x,y]);
   const [startX,startY]=points[chosen];
   drag={id:e.pointerId,limit:upper,offset:[startX-x,startY-y]};
   chart.focus({preventScroll:true});chart.setPointerCapture(e.pointerId);showHit(chosen);
   if(insert)edit({...current(),[kind]:points});else draw();
  });
  chart.addEventListener('pointermove',e=>{
   if(!drag){showHit(hit(e));return;}
   if(drag.id!==e.pointerId||chosen===null||!gesture)return;
   const [a,b]=coordinates(e),points=current()[kind].map(point=>[...point]),point=points[chosen];
   const x=clamp(a+drag.offset[0],0,1),y=clamp(b+drag.offset[1],0,drag.limit);
   if(chosen>0&&chosen<points.length-1){const lo=points[chosen-1][0],hi=points[chosen+1][0],t=Math.fround(clamp(x,lo,hi));if(t>lo&&t<hi)point[0]=t;}
   point[1]=y;edit({...current(),[kind]:points});
  });
  const finishPointer=(e,accept)=>{if(drag?.id!==e.pointerId)return;drag=null;finishCurve(accept);showHit(accept?hit(e):null);};
  chart.addEventListener('pointerup',e=>finishPointer(e,true));
  chart.addEventListener('pointercancel',e=>finishPointer(e,false));
  chart.addEventListener('lostpointercapture',e=>finishPointer(e,false));
  chart.addEventListener('pointerleave',()=>{if(!drag)showHit(null);});
  chart.addEventListener('keydown',e=>{
   if(!['Delete','Backspace','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;
   e.preventDefault();e.stopPropagation();
   const points=current()[kind].map(point=>[...point]);
   if(chosen===null){chosen=0;draw();return;}
   if(e.key==='Delete'||e.key==='Backspace'){removePoint();return;}
   if(e.key==='ArrowLeft'||e.key==='ArrowRight'){chosen=clamp(chosen+(e.key==='ArrowLeft'?-1:1),0,points.length-1);draw();return;}
   points[chosen][1]=Math.max(0,points[chosen][1]+(e.key==='ArrowUp'?.05:-.05));oneEdit({...current(),[kind]:points},'Move '+title.toLowerCase()+' point');
  });
  reset.addEventListener('click',()=>{chosen=null;oneEdit({...current(),[kind]:[[0,1],[1,1]]},'Reset '+title.toLowerCase()+' curve');});
  editors.push(draw);
 }
 function redraw(){
  basis.value=current().basis;
  basisNote.textContent=basis.value==='mixing'?'Fuel consumed relative to birth. Fuel gained through exchange can move a carrier backward on this curve. Carriers born without fuel use lifetime.':'Uses the survival clock or an earlier maximum age. With neither set, carriers stay at the left endpoint.';
  editors.forEach(draw=>draw());
 }
 let last=0,lastCoverage=null,lastSupport='';
 function sync(force=false){
  if(!cover.panel.hidden){
   const coverage=readCoverage(),changed=lastCoverage!==coverage;
   if(changed){lastCoverage=coverage;redraw();}
   const smokeAvailable=readSmokeAvailable(),smokeNote=smokeAvailable?'Strong extinction and weak emission. Age eases in the spread. 1× off.':'Available with emitter births in the normal optical view.';
   smokeFields.disabled=!smokeAvailable;
   if(smokeStatus.textContent!==smokeNote)smokeStatus.textContent=smokeNote;
   if(force||changed)for(const {key,input} of smokeInputs)if(document.activeElement!==input&&!input.classList.contains('scrubbing'))input.value=String(coverage.smoke[key]);
   const support=readSupport(),key=JSON.stringify(support);
   if(force||key!==lastSupport){lastSupport=key;for(const {key,input} of supportFields)if(document.activeElement!==input&&!input.classList.contains('scrubbing'))input.value=String(support[key]);}
  }
  if(light.panel.hidden||(!force&&performance.now()-last<250))return;
  last=performance.now();
  const s=readLighting(),v=liveValues(s);
  useScene.hidden=!s?.requested&&!s?.restoreError;
  for(const {key,input} of lightFields){
   input.disabled=!s;
   if(gridWidth(key)){const step=String(qualityStep(key,s));if(input.step!==step)input.min=input.step=step;}
   if(input.type==='checkbox')input.checked=Boolean(v[key]);
   else if(document.activeElement!==input&&!input.classList.contains('scrubbing'))input.value=Number.isFinite(v[key])?String(v[key]):'';
  }
  const effective=s?.applied??(!s?.requested?s?.native:null);
  const quality=effective?'Field · '+effective.directions+' directions · receiver '+effective.volumeGrid+' · transport '+(effective.sourceDimensions?.join('×')??effective.sourceGrid):'';
  lightQuality.hidden=!quality;
  if(lightQuality.textContent!==quality)lightQuality.textContent=quality;
  const status=!s?'This scene does not have the shared hybrid lighting route.':
    s.restoreError?'Saved lighting settings were not applied to this scene: '+s.restoreError:s.error?'Lighting edit unavailable: '+s.error+(s.applied?' · holding the previous field.':''):s.requested?.enabled===false?'Off · no new distributed solves.':
    !s.requested?'Using scene defaults · edits enable paced refresh.':
    s.applied?(Object.entries(s.requested).every(([k,value])=>s.applied[k]===value)?'Holding the field':'Settings queued · holding the previous field')+' from source frame '+s.applied.frame+'.':'Waiting for the next lighting refresh.';
  if(lightStatus.textContent!==status)lightStatus.textContent=status;
 }
 redraw();
 return {sync,async dispose(){
  finishCurve(false);document.removeEventListener('keydown',keyHandler,true);win.removeEventListener('keydown',historyKey,true);
  cleanups.forEach(fn=>fn());light.panel.remove();cover.panel.remove();style.remove();
  if(edits){await edits.waitForReplay();if(edits.hasHistoryEntry(curveTarget))edits.discard(entry=>entry.id===curveTarget,{preserveUnrelatedActive:true});edits.unregister(curveTarget);}
 }};
}
