import {Vector3} from '../lib/three.webgpu.js';

// This belongs to the earth specimen. It borrows the scene/camera and leaves the
// host's navigation, selection and transform keys alone.
export function mountEarthControls({document,host,session,root,tool,invoke,read,stop,trace}){
 const viewport=document.getElementById('viewport');if(!viewport)throw Error('Earth authoring requires the shared viewport');
 const layer=document.createElement('div'),style=document.createElement('style');layer.className='earth-in-scene';layer.dataset.vantageIgnore='';
 style.textContent=`
 body.has-authoring-workspace.experiment-workspace[data-workspace=workbench].earth-authoring {grid-template-columns:0 minmax(0,1fr) 316px}
 body.earth-authoring #experiment-instruments {display:none!important}
 .earth-in-scene {position:absolute;inset:0;pointer-events:none;z-index:35;font:12px -apple-system,sans-serif;color:#eee}
 .earth-in-scene [hidden] {display:none!important}
 .earth-anchor {position:absolute;pointer-events:auto;max-width:290px}
 .earth-chip,.earth-in-scene button {font:inherit;color:inherit;background:#242522e8;border:1px solid #777564;border-radius:5px;padding:6px 10px;cursor:pointer}
 .earth-chip {box-shadow:0 2px 10px #0004}
 .earth-in-scene button:hover {background:#44453b}
 .earth-in-scene button:focus-visible,.earth-in-scene input:focus-visible {outline:2px solid #d5c899;outline-offset:2px}
 .earth-in-scene button:disabled {opacity:.45;cursor:default}
 .earth-card {position:absolute;top:35px;left:0;box-sizing:border-box;width:270px;max-height:50vh;overflow:auto;background:#22231ff5;border:1px solid #777564;border-radius:7px;padding:12px;box-shadow:0 8px 24px #0007}
 .earth-card label {display:flex;align-items:center;justify-content:space-between;gap:12px;margin:8px 0;color:#d6d4c8}
 .earth-card input {box-sizing:border-box;width:104px;background:#33352f;border:1px solid #696b5d;border-radius:4px;color:#fff;padding:5px;font:inherit}
 .earth-card .authoring-number-wrap {width:104px;flex:0 0 104px}
 .earth-card .authoring-number {width:104px}
 .earth-card details {margin-top:12px;border-top:1px solid #55564c;padding-top:9px}
 .earth-card summary {cursor:pointer;color:#c9c4ad}
 .earth-card .earth-actions {display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
 .earth-card p {font-size:11px;line-height:1.45;color:#aaa894;margin:8px 0}
 .earth-tool-menu {display:inline-flex;gap:3px}
 .earth-feedback {position:absolute;bottom:90px;left:50%;transform:translateX(-50%);max-width:70%;padding:8px 12px;background:#292a25ef;border:1px solid #716d5c;border-radius:6px;pointer-events:auto}
 .earth-feedback button {margin-left:10px}
 @media(max-width:800px){body.has-authoring-workspace.experiment-workspace[data-workspace=workbench].earth-authoring {grid-template-columns:minmax(0,1fr) 270px;grid-template-rows:42px minmax(280px,1fr)}body.earth-authoring #viewport{grid-column:1;grid-row:2}}
 @media(max-width:540px){body.has-authoring-workspace.experiment-workspace[data-workspace=workbench].earth-authoring {grid-template-columns:minmax(0,1fr)}body.earth-authoring #authoring-right{display:none!important}}
 `;
 document.head.append(style);document.body.classList.add('earth-authoring');viewport.append(layer);
 const identity=read();
 const drags=[],fields=[],buttons=[],anchors=[];let error=null,disposed=false;
 const make=(tag,text,parent=layer)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;parent.append(el);return el;};
 const take=e=>e.stopPropagation();for(const type of ['pointerdown','pointerup','click','dblclick','wheel','keydown'])layer.addEventListener(type,take);
 const feedback=make('div');feedback.className='earth-feedback';feedback.hidden=true;feedback.setAttribute('role','status');const message=make('span','',feedback),stopButton=make('button','Stop',feedback);stopButton.onclick=()=>stop();
 const fail=e=>{error=e.message;refresh();};
 const run=action=>Promise.resolve().then(action).then(()=>{if(disposed)return;error=null;refresh();}).catch(e=>{if(!disposed)fail(e);});
 const button=(parent,text,action)=>{const b=make('button',text,parent);b.type='button';b.onclick=()=>run(action);buttons.push(b);return b;};
 const card=(object,offset,label)=>{const anchor=make('div');anchor.className='earth-anchor';const chip=make('button',label,anchor);chip.type='button';chip.className='earth-chip';const panel=make('div',undefined,anchor);panel.className='earth-card';panel.hidden=true;chip.setAttribute('aria-expanded','false');chip.onclick=()=>{panel.hidden=!panel.hidden;chip.setAttribute('aria-expanded',String(!panel.hidden));host.scene.select?.(object===tool?identity.toolId:identity.objectId);position();};anchors.push({anchor,panel,chip,object,offset});return {anchor,panel,chip};};
 const earth=card(root,()=>[-identity.physicsWidth/2,.04,identity.physicsWidth/2],'Earth ▾');earth.chip.setAttribute('aria-label','Earth material');
 const toolControls=card(tool,()=>[1.3,0,0],'Stroke ▾');toolControls.chip.setAttribute('aria-label','Forming tool settings');
 const press=button(toolControls.anchor,'Press',()=>invoke('press'));press.className='earth-chip';press.style.marginRight='4px';toolControls.anchor.insertBefore(press,toolControls.chip);
 const group=(parent,title)=>{const details=make('details',undefined,parent);make('summary',title,details);return details;};
 function number(parent,label,key,step,{material=false,costly=false,min=0,max}={}){
  const row=make('label',undefined,parent),grip=make('span',label,row),input=make('input',undefined,row);input.type='number';input.step=String(step);input.min=String(min);if(max!==undefined)input.max=String(max);input.setAttribute('aria-label',label);
  const value=()=>material?read().material[key]:read().settings[key];input.value=String(value());
  const commit=()=>{const n=Number(input.value);if(!input.value.trim()||!Number.isFinite(n)||n<min||(max!==undefined&&n>max)){error=`${label} must be ${min}–${max??'a finite value'}`;input.value=String(value());refresh();return;}
   return run(()=>invoke(material?'material':'configure',{[key]:n}));};
  if(costly){input.title='Type a value and press Enter to commit; no dragging';input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();void commit();input.blur();}if(e.key==='Escape'){input.value=String(value());input.blur();}};input.onblur=()=>{input.value=String(value());};}
  else {input.oninput=commit;input.onblur=()=>{input.value=String(value());};drags.push(host.controls.installNumberDrag({input,grip,step}));}
  fields.push({input,value});return input;
 }
 number(earth.panel,'Cohesion (N)','cohesion',.2,{material:true});number(earth.panel,'Friction','friction',.05,{material:true});number(earth.panel,'Yield strain','plasticYield',.01,{material:true});
 button(earth.panel,'Settle',()=>invoke('advance'));
 const timing=group(earth.panel,'Settling');number(timing,'Settle time (s)','advanceSeconds',.01,{costly:true,min:.01,max:1});
 const surface=group(earth.panel,'Surface');number(surface,'Preview detail','previewResolution',1,{costly:true,min:2});number(surface,'Capture detail','captureResolution',1,{costly:true,min:2});make('p','Detail rebuilds run separately from the viewport. Oversized requests are rejected before extraction.',surface);button(surface,'Render frozen surface',()=>trace());
 const files=group(earth.panel,'Specimen files'),actions=make('div',undefined,files);actions.className='earth-actions';
 const download=(value,name)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'})),a=make('a',undefined,layer);a.href=url;a.download=name;a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);};
 button(actions,'Save',async()=>download(await invoke('snapshot'),'earth-specimen.json'));
 const file=make('input',undefined,files);file.type='file';file.accept='.json,application/json';file.hidden=true;file.onchange=()=>run(async()=>{try{if(file.files[0])await invoke('load',JSON.parse(await file.files[0].text()));}finally{file.value='';}});button(actions,'Load',()=>file.click());button(actions,'New specimen',()=>invoke('reset'));button(actions,'Leave workshop',()=>window.kaminosWorkbenchExperiments.close());button(actions,'Export teacher',async()=>download({source:(await invoke('freeze')).source},'earth-material-teacher.json'));
 number(toolControls.panel,'Stroke depth (m)','pressDepth',.005,{min:.001});number(toolControls.panel,'Stroke time (s)','pressSeconds',.01,{costly:true,min:.01,max:1});number(toolControls.panel,'Release time (s)','releaseSeconds',.01,{costly:true,min:.01,max:1});make('p','Position the sphere with the scene gizmo, then press. The result includes settling after release.',toolControls.panel);
 function position(){
  if(disposed)return;const {camera,renderer}=host.scene.rendering(),canvas=renderer.domElement.getBoundingClientRect(),vp=viewport.getBoundingClientRect();camera.updateMatrixWorld();
  for(const a of anchors){a.object.updateWorldMatrix(true,false);const p=a.object.localToWorld(new Vector3(...a.offset())).project(camera);const x=canvas.left-vp.left+(p.x+1)*canvas.width/2,y=canvas.top-vp.top+(1-p.y)*canvas.height/2;a.anchor.hidden=!a.object.visible||!host.scene.isVisible(a.object===tool?identity.toolId:identity.objectId);
   const offscreen=p.z<-1||p.z>1||x<0||x>vp.width||y<0||y>vp.height;a.chip.dataset.offscreen=String(offscreen);a.chip.textContent=a.object===root?(offscreen?'Earth ↗':'Earth ▾'):(offscreen?'Stroke ↗':'Stroke ▾');a.chip.title=offscreen?'The object anchor is offscreen; its controls remain here at the viewport edge':'';
   a.anchor.style.left=`${Math.min(Math.max(Number.isFinite(x)?x:8,8),Math.max(8,vp.width-180))}px`;a.anchor.style.top=`${Math.min(Math.max(Number.isFinite(y)?y:70,70),Math.max(70,vp.height-100))}px`;
   a.panel.style.top=y>vp.height/2?'auto':'35px';a.panel.style.bottom=y>vp.height/2?'35px':'auto';a.panel.style.left=x>vp.width-280?'-100px':'0';}
 }
 function refresh(){const state=read();for(const f of fields){f.input.disabled=state.busy;if(document.activeElement!==f.input||f.input.readOnly)f.input.value=String(f.value());}for(const b of buttons)b.disabled=state.busy;feedback.hidden=!state.busy&&!state.failure&&!error;message.textContent=error??state.failure??(state.busy?'Working the specimen…':'');stopButton.hidden=!state.busy;position();}
 const dismiss=event=>{for(const a of anchors)if(!a.anchor.contains(event.target)){a.panel.hidden=true;a.chip.setAttribute('aria-expanded','false');}};document.addEventListener('pointerdown',dismiss,true);
 const unsubscribe=session.onFrame(position);refresh();
 return {refresh,dispose(){disposed=true;unsubscribe();document.removeEventListener('pointerdown',dismiss,true);for(const d of drags)d.dispose();layer.remove();style.remove();document.body.classList.remove('earth-authoring');}};
}

export function mountEarthRenderControls({document,host,sessionRead,invoke,back}){
 const viewport=document.getElementById('viewport');if(!viewport)throw Error('Earth transport requires the shared viewport');
 const style=document.createElement('style');style.textContent='body.has-authoring-workspace.experiment-workspace[data-workspace=workbench].earth-authoring{grid-template-columns:0 minmax(0,1fr) 316px}body.earth-authoring #experiment-instruments{display:none!important}.earth-render-controls{position:absolute;bottom:90px;left:16px;z-index:35;display:flex;gap:6px;color:#eee;font:12px -apple-system,sans-serif}.earth-render-controls button,.earth-render-controls summary,.earth-render-controls input{font:inherit;color:inherit;background:#292a25ed;border:1px solid #716d5c;border-radius:5px;padding:6px 10px}.earth-render-controls details>div{position:absolute;bottom:38px;left:0;background:#22231ff5;padding:12px;border:1px solid #716d5c;border-radius:6px;min-width:245px}.earth-render-controls label{display:flex;justify-content:space-between;gap:12px;margin:8px 0}.earth-render-controls input{width:75px}.earth-render-controls [hidden]{display:none!important}.earth-render-controls output{max-width:300px;color:#efc9a3}';document.head.append(style);document.body.classList.add('earth-authoring');
 const layer=document.createElement('div');layer.className='earth-render-controls';layer.dataset.vantageIgnore='';viewport.append(layer);for(const type of ['pointerdown','pointerup','click','dblclick','wheel','keydown'])layer.addEventListener(type,e=>e.stopPropagation());
 const make=(tag,text,parent=layer)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;parent.append(el);return el;};
 const error=make('output','');error.setAttribute('role','status');error.hidden=true;
 const fail=e=>{error.textContent=e.message;error.hidden=false;};
 const button=(label,action)=>{const b=make('button',label);b.type='button';b.onclick=()=>Promise.resolve().then(action).catch(fail);return b;};
 button('Back to earth',back);const pause=button(sessionRead().configuration.paused?'Resume tracing':'Pause tracing',async()=>{const state=await invoke('configure',{paused:!sessionRead().configuration.paused});pause.textContent=state.configuration.paused?'Resume tracing':'Pause tracing';});
 const details=make('details'),summary=make('summary','Render settings',details),panel=make('div',undefined,details);summary.title='Interactive rendering settings';
 for(const [label,key,min,max,step]of [['Path bounces','bounces',1,8,1],['Resolution scale','scale',.02,1,.01],['Environment radiance','environment',0,10,.05]]){
  const row=make('label',undefined,panel);make('span',label,row);const input=make('input',undefined,row);input.type='number';input.min=String(min);input.max=String(max);input.step=String(step);input.value=String(sessionRead().configuration[key]);input.setAttribute('aria-label',label);input.title='Type and press Enter to commit; no dragging';
  input.onkeydown=async e=>{if(e.key!=='Enter')return;e.preventDefault();e.stopPropagation();const n=Number(input.value);try{if(!input.value.trim()||!Number.isFinite(n)||n<min||n>max||(key==='bounces'&&!Number.isSafeInteger(n)))throw Error(`${label}: interactive preview supports ${min}–${max}`);await invoke('configure',{[key]:n});error.hidden=true;}catch(e){fail(e);}finally{input.value=String(sessionRead().configuration[key]);}};input.onblur=()=>{input.value=String(sessionRead().configuration[key]);};
 }
 return {dispose(){layer.remove();style.remove();document.body.classList.remove('earth-authoring');}};
}
