import {bindParticleNumber} from '../particle-number-control.mjs';

const SVG='http://www.w3.org/2000/svg';
const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));

export function mountParticleLivePopups({document,root,controls,readCoverage,setCoverage,readLighting,setLighting}){
 const win=document.defaultView;
 const create=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
 const cleanups=[];
 function popup(id,title,key){
  const panel=create('section'),header=create('header'),name=create('strong',title),close=create('button','Close'),launcher=create('button',title+' · Alt-'+key);
  panel.id=id;panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label',title);panel.tabIndex=-1;
  panel.style.cssText='position:fixed;z-index:180;top:60px;right:16px;width:min(370px,calc(100vw - 32px));box-sizing:border-box;max-height:calc(100vh - 76px);overflow:auto;padding:14px;border:1px solid #62788a;border-radius:12px;background:#1b2633;color:#ecf1f7;box-shadow:0 8px 28px #0009;font:13px system-ui';
  header.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:9px';
  launcher.type=close.type='button';launcher.setAttribute('aria-controls',id);launcher.setAttribute('aria-expanded','false');
  header.append(name,close);panel.append(header);document.body.append(panel);root.append(launcher);
  const toggle=()=>{
   const opening=panel.hidden;panel.hidden=!opening;launcher.setAttribute('aria-expanded',String(opening));
   if(opening)panel.focus({preventScroll:true});else if(panel.contains(document.activeElement))document.activeElement.blur();
  };
  close.addEventListener('click',toggle);launcher.addEventListener('click',toggle);
  return {panel,toggle};
 }
 const light=popup('particle-live-lighting','Distributed lighting','F');
 const cover=popup('particle-live-coverage','Particle coverage','P');
 for(const [a,b] of [[light,cover],[cover,light]])a.panel.addEventListener('focusin',()=>{if(!b.panel.hidden)b.toggle();});
 const keyHandler=event=>{
  if(event.key==='Escape'){
   const active=[cover,light].find(item=>!item.panel.hidden&&item.panel.contains(document.activeElement))
    ??[cover,light].find(item=>!item.panel.hidden);
   if(active){event.preventDefault();event.stopPropagation();active.toggle();}
   return;
  }
  if(event.repeat||!event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
  const item=event.code==='KeyF'?light:event.code==='KeyP'?cover:null;
  if(item){event.preventDefault();event.stopPropagation();const other=item===light?cover:light;if(item.panel.hidden&&!other.panel.hidden)other.toggle();item.toggle();sync(true);}
 };
 document.addEventListener('keydown',keyHandler,true);
 const lightNote=create('p','Refresh uses the current scene. Between refreshes the last field is held. The switch leaves flame emission and extinction running.');
 const lightStatus=create('p');lightStatus.setAttribute('role','status');lightStatus.style.cssText='min-height:2em;color:#b4cddd;margin-bottom:0';
 const lightError=create('p');lightError.setAttribute('role','alert');lightError.style.color='#ffc181';lightError.hidden=true;
 const lightFields=[];
 const row=(name,input)=>{
  const label=create('label'),caption=create('span',name);input.setAttribute('aria-label',name);
  label.style.cssText='display:grid;grid-template-columns:1fr 7.5em;gap:12px;align-items:center;margin:8px 0';label.append(caption,input);return {label,caption};
 };
 const liveValues=s=>s?.requested??{enabled:true,intervalMs:250,...s?.native};
 const doLighting=patch=>{const next=setLighting(patch);lightError.hidden=true;sync(true);return next;};
 const lightFailed=e=>{lightError.hidden=false;lightError.textContent=e.message;};
 for(const [key,name,type,min,step,max] of [
  ['enabled','Distributed lighting','checkbox'],['intervalMs','Refresh interval (ms)','number',1,10],
  ['gain','Light gain','number',0,.05],['environmentBlur','Environment blur','number',0,.025,1],
  ['lightSurfaces','Light scene surfaces','checkbox'],
 ]){
  const input=create('input');input.type=type;
  const {label,caption}=row(name,input);light.panel.append(label);lightFields.push({key,input});
  if(type==='checkbox')input.addEventListener('change',()=>{try{doLighting({[key]:input.checked});}catch(e){lightFailed(e);sync(true);}});
  else{
   input.min=String(min);input.step=String(step);if(max!==undefined)input.max=String(max);
   const binding=bindParticleNumber({input,read:()=>liveValues(readLighting())[key],apply:v=>doLighting({[key]:v}),onError:lightFailed,onAccepted:()=>{lightError.hidden=true;}});
   const drag=controls.installNumberDrag?.({input,grip:caption,step});cleanups.push(()=>{binding.dispose();drag?.dispose?.();});
  }
 }
 light.panel.append(lightNote,lightStatus,lightError);

 const basis=create('select'),basisRow=row('Horizontal axis',basis);
 for(const [value,label] of [['lifetime','Lifetime'],['mixing','Fuel consumed']]){const option=create('option',label);option.value=value;basis.append(option);}
 const basisNote=create('p'),curveError=create('p');curveError.setAttribute('role','alert');curveError.style.color='#ffc181';curveError.hidden=true;
 cover.panel.append(basisRow.label,basisNote,create('p','Click to add a point; drag to shape. Select a point and press Delete to remove it. 1× keeps the existing value.'),curveError);
 let draft=null,pending=0;
 function commit(){
  pending=0;if(!draft)return;
  try{setCoverage(draft);curveError.hidden=true;}catch(e){curveError.textContent=e.message;curveError.hidden=false;}
  draft=null;redraw();
 }
 function edit(next){draft=next;if(!pending)pending=win.requestAnimationFrame(commit);redraw();}
 basis.addEventListener('change',()=>edit({...current(),basis:basis.value}));
 const current=()=>draft??readCoverage();
 const editors=[];
 for(const [kind,title,note,color] of [['footprint','Footprint','Multiplies radius before pixel floor and footprint ceiling. Zero hides the carrier.','#f9b167'],['opacity','Opacity','Multiplies optical depth. Direct emission stays independent.','#8bd8f3']]){
  const label=create('strong',title),description=create('div',note),reset=create('button','Reset'),chart=document.createElementNS(SVG,'svg');
  const line=document.createElementNS(SVG,'polyline'),grid=document.createElementNS(SVG,'path'),knots=document.createElementNS(SVG,'g');
  const top=create('div'),footer=create('div'),readout=create('span');
  reset.type='button';reset.setAttribute('aria-label','Reset '+title.toLowerCase());top.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-top:10px';
  description.style.cssText='color:#b4cddd;margin:3px 0';
  footer.style.cssText='display:flex;justify-content:space-between;color:#b4cddd;font-variant-numeric:tabular-nums';
  chart.setAttribute('viewBox','0 0 330 96');chart.setAttribute('preserveAspectRatio','none');chart.setAttribute('aria-label',title+' curve');chart.setAttribute('tabindex','0');
  chart.style.cssText='display:block;width:100%;height:100px;touch-action:none;background:#111a23;border:1px solid #506171;border-radius:5px;cursor:crosshair';
  grid.setAttribute('fill','none');grid.setAttribute('stroke','#354755');
  line.setAttribute('fill','none');line.setAttribute('stroke',color);line.setAttribute('stroke-width','2');
  chart.append(grid,line,knots);top.append(label,reset);footer.append(create('span','0%'),readout,create('span','100%'));cover.panel.append(top,description,chart,footer);
  let chosen=null,drag=null,upper=2;
  const px=x=>8+314*x,py=(y,limit)=>88-80*y/limit;
  function draw(){
   const points=current()[kind];if(chosen>=points.length)chosen=null;
   const limit=drag?.limit??Math.ceil(points.reduce((limit,p)=>Math.max(limit,p[1]),2));
   grid.setAttribute('d','M 8 8 V 88 H 322 M 8 '+py(1,limit)+' H 322 M 165 8 V 88');
   line.setAttribute('points',points.map(([x,y])=>px(x)+','+py(y,limit)).join(' '));
   const nodes=points.map(([x,y],i)=>{const dot=document.createElementNS(SVG,'circle');
    dot.setAttribute('cx',px(x));dot.setAttribute('cy',py(y,limit));dot.setAttribute('r',i===chosen?5:3.8);
    dot.setAttribute('fill',i===chosen?'#fff':color);dot.dataset.knot=String(i);return dot;});
   knots.replaceChildren(...nodes);
   readout.textContent=chosen===null?'0–'+limit+'×':Math.round(points[chosen][0]*100)+'% · '+Number(points[chosen][1].toFixed(2))+'×';
   upper=limit;
  }
  const coordinates=e=>{const r=chart.getBoundingClientRect();return [clamp(((e.clientX-r.left)/r.width*330-8)/314,0,1),clamp((88-(e.clientY-r.top)/r.height*96)/80,0,1)*(drag?.limit??upper)];};
  const replace=points=>edit({...current(),[kind]:points});
  chart.addEventListener('pointerdown',e=>{
   if(e.button!==0)return;
   const [x,y]=coordinates(e),points=current()[kind].map(point=>[...point]);
   const hit=e.target.dataset?.knot;
   if(hit!==undefined)chosen=Number(hit);
   else{
    const i=points.findIndex(([xx])=>xx>x),left=points[i-1],right=points[i];
    if(i<1||Math.fround(x)<=left[0]||Math.fround(x)>=right[0]){chosen=x<.5?0:points.length-1;}
    else{chosen=i;points.splice(i,0,[x,y]);}
   }
   chart.focus({preventScroll:true});chart.setPointerCapture(e.pointerId);drag={id:e.pointerId,limit:upper};replace(points);
  });
  chart.addEventListener('pointermove',e=>{
   if(drag?.id!==e.pointerId||chosen===null)return;
   const [x,y]=coordinates(e),points=current()[kind].map(point=>[...point]),point=points[chosen];
   if(chosen>0&&chosen<points.length-1){const lo=points[chosen-1][0],hi=points[chosen+1][0],t=Math.fround(clamp(x,lo,hi));if(t>lo&&t<hi)point[0]=t;}
   point[1]=y;replace(points);
  });
  chart.addEventListener('lostpointercapture',()=>{drag=null;draw();});
  chart.addEventListener('keydown',e=>{
   if(!['Delete','Backspace','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;
   e.preventDefault();e.stopPropagation();
   const points=current()[kind].map(point=>[...point]);
   if(chosen===null){chosen=0;draw();return;}
   if(e.key==='Delete'||e.key==='Backspace'){if(chosen>0&&chosen<points.length-1){points.splice(chosen,1);chosen=null;replace(points);}return;}
   if(e.key==='ArrowLeft'||e.key==='ArrowRight'){chosen=clamp(chosen+(e.key==='ArrowLeft'?-1:1),0,points.length-1);draw();return;}
   points[chosen][1]=Math.max(0,points[chosen][1]+(e.key==='ArrowUp'?.05:-.05));replace(points);
  });
  reset.addEventListener('click',()=>{chosen=null;replace([[0,1],[1,1]]);});
  editors.push(draw);
 }
 function redraw(){
  basis.value=current().basis;
  basisNote.textContent=basis.value==='mixing'?'Fuel consumed relative to birth. Fuel gained through exchange can move a carrier backward on this curve. Carriers born without fuel use lifetime.':'Uses the survival clock or an earlier maximum age. With neither set, carriers stay at the left endpoint.';
  editors.forEach(draw=>draw());
 }
 let last=0,lastCoverage=null;
 function sync(force=false){
  if(!cover.panel.hidden&&lastCoverage!==readCoverage()){lastCoverage=readCoverage();redraw();}
  if(light.panel.hidden||(!force&&performance.now()-last<250))return;
  last=performance.now();
  const s=readLighting(),v=liveValues(s);
  for(const {key,input} of lightFields){
   input.disabled=!s;
   if(input.type==='checkbox')input.checked=Boolean(v[key]);
   else if(document.activeElement!==input&&!input.classList.contains('scrubbing'))input.value=Number.isFinite(v[key])?String(v[key]):'';
  }
  const status=!s?'This scene does not have the shared hybrid lighting route.':
    s.error?'Last refresh failed: '+s.error:s.requested?.enabled===false?'Off · no new distributed solves.':
    !s.requested?'Using scene defaults · edits enable paced refresh.':
    s.applied?(Object.entries(s.requested).every(([k,value])=>s.applied[k]===value)?'Holding the field':'Settings queued · holding the previous field')+' from source frame '+s.applied.frame+'.':'Waiting for the next lighting refresh.';
  if(lightStatus.textContent!==status)lightStatus.textContent=status;
 }
 redraw();
 return {sync,dispose(){if(pending)win.cancelAnimationFrame(pending);document.removeEventListener('keydown',keyHandler,true);cleanups.forEach(fn=>fn());light.panel.remove();cover.panel.remove();}};
}
