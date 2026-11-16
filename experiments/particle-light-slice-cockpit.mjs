import {BufferGeometry,Color,Float32BufferAttribute,Group,LineBasicMaterial,LineSegments,Mesh,MeshBasicMaterial,SphereGeometry,Vector3} from '../lib/three.core.js';
import {createLightSliceProbe,compareSliceSections,packLightSliceView} from '../particle-light-slice.mjs';
import {createLightSliceReceiverFollow} from '../particle-light-follow.mjs';
import {bindParticleNumber} from '../particle-number-control.mjs';

const initial=Object.freeze({enabled:false,mode:'ray',source:'probe',view:'fine',halfWidth:.15,offsets:7,sweepOffsets:17,sections:32,
 gain:1,refreshSteps:4,depthStride:4,acrossStride:3,correctionStart:.25,correctionExtent:.25,sharingRadius:.18,depth:1,showGeometry:true,smokeView:false,previewGain:12,followReceiver:false,followRadius:1});
const discrete=new Set(['offsets','sweepOffsets','sections','refreshSteps','depthStride','acrossStride']);
const ratios=new Set(['correctionStart','correctionExtent','sharingRadius','depth']);
const choices={mode:['ray','bundle','sweep'],source:['probe','flame'],view:['fine','coarse','shared','held']};
const vectors=new Set(['emitter','receiver']);
function checked(settings,patch){
 const result={...settings};
 for(const [key,v] of Object.entries(patch)){
  if(key==='enabled'||key==='showGeometry'||key==='smokeView'||key==='followReceiver'){if(typeof v!=='boolean')throw Error('Invalid '+key);}
  else if(key in choices){if(!choices[key].includes(v))throw Error('Unknown '+key);}
  else if(vectors.has(key)){if(!Array.isArray(v)||v.length!==3||!v.every(x=>Number.isFinite(Math.fround(x))))throw Error('Invalid '+key+' position');}
  else if(discrete.has(key)){if(!Number.isSafeInteger(v)||v<(key==='refreshSteps'?0:1))throw Error('Invalid '+key);}
  else if(ratios.has(key)){if(!Number.isFinite(v)||v<0||v>1)throw Error('Choose a fraction from 0 to 1 for '+key);}
  else if(key==='gain'||key==='halfWidth'||key==='previewGain'||key==='followRadius'){if(!Number.isFinite(Math.fround(v))||v<(key==='halfWidth'||key==='followRadius'?0.00001:0))throw Error('Invalid '+key);}
  else throw Error('Unknown light slice setting: '+key);
  result[key]=vectors.has(key)?[...v]:v;
 }
 return result;
}

export function createParticleLightSliceCockpit({runtime,session,select,refresh,host,onSettings=()=>{},record=()=>{},inputs={}}){
 let settings=checked(initial,inputs),refs=null,mounting=null,disposed=false,view=null,held=null,observed=null,comparison=null,comparisonKey=null,lastWorld=null,error=null,previewOwner=null,previewSnapshot=null,previewProfiles=null,previewGain=null,followReceiverPosition=null,followWorldKey=null;
 const controls=[],disposers=[];
 const reader=createLightSliceProbe({runtime,onChange:()=>{if(!disposed){draw();session.redraw();}}});
 const follow=createLightSliceReceiverFollow({runtime,onRead:state=>{
  if(disposed||!refs||!settings.enabled||!settings.followReceiver)return;
  if(state.state==='following'){
   const previous=refs.receiver.getWorldPosition(new Vector3());
   const at=new Vector3(...state.position);
   if(settings.source==='flame')refs.emitter.position.add(at.clone().sub(previous));
   refs.receiver.position.copy(at);
   followReceiverPosition=points().receiver;followWorldKey=JSON.stringify(Object.values(points()));
  }
  draw();session.redraw();
 }});
 function attachReceiver(){
  if(!refs)return;
  followReceiverPosition=points().receiver;follow.start(followReceiverPosition,settings.followRadius);
 }

 function marker(name,color,point){
  const root=new Group(),mesh=new Mesh(new SphereGeometry(.04,16,12),new MeshBasicMaterial({color,depthTest:false,depthWrite:false}));
  root.name=name;root.position.fromArray(point);mesh.renderOrder=101;root.add(mesh);
  root.userData.kaminosDocumentTransient=true;
  root.traverse(o=>{o.userData.kaminosEditorHelper=true;o.userData.kaminosEditorOnly=true;});
  return root;
 }
 async function make(){
  const emitter=marker('Light slice emitter',0xffb564,settings.emitter??[0,.2,0]);
  const receiver=marker('Light slice receiver',0x87d6fb,settings.receiver??[.43,.91,0]);
  const lines=new LineSegments(new BufferGeometry(),new LineBasicMaterial({vertexColors:true,depthTest:false,depthWrite:false,transparent:true,opacity:.95}));
  lines.name='Light slice paths';lines.renderOrder=100;
  lines.userData.kaminosDocumentTransient=true;lines.userData.kaminosEditorHelper=true;lines.userData.kaminosEditorOnly=true;
  const options={owned:true,metadata:{source:'optical-particles:light-slice',type:'experiment'}};
  const a=await session.attach(emitter,{...options,metadata:{...options.metadata,label:emitter.name}}),b=await session.attach(receiver,{...options,metadata:{...options.metadata,label:receiver.name}});
  await session.attach(lines,{...options,presentation:true});
  if(disposed)return;
  refs={emitter,receiver,lines,a,b};
  updateVisibility();
 }
 function updateVisibility(){if(refs){refs.emitter.visible=settings.enabled;refs.receiver.visible=settings.enabled;refs.lines.visible=settings.enabled&&settings.showGeometry;}}
 function read(){const a=reader.read(),r=a.result;return {settings:structuredClone(settings),follow:follow.read(),probe:{prepared:a.prepared,inFlight:a.inFlight,error:error??a.error,reason:a.reason,
  ...(r?{identity:r.identity,route:r.route,source:r.source,model:r.model,width:r.width,sections:r.sections,emitter:r.emitter,receiver:r.receiver}:{}),
  center:r?.profiles[Math.floor(r.width/2)*(r.width+1)]?.at(-1)??null,heldIdentity:held?.identity??null},handles:refs?{emitter:refs.a.id,receiver:refs.b.id}:null};}
 async function configure(patch){
  const wasFollowing=settings.followReceiver&&settings.enabled;
  const next=checked(settings,patch);
  if('receiver' in patch&&!('followReceiver' in patch))next.followReceiver=false;
  if(next.view==='held'&&!held)throw Error('Hold a sampled profile first');
  settings=next;error=null;
  if(settings.enabled&&!refs){await(mounting??=make().finally(()=>{mounting=null;}));}
  if(refs)for(const key of vectors)if(key in patch){
   refs[key].position.fromArray(settings[key]);const h=key==='emitter'?refs.a:refs.b;refresh?.(h);
  }
  if(settings.enabled&&settings.followReceiver){
   if(!wasFollowing||'followRadius'in patch||'followReceiver'in patch||'receiver'in patch)attachReceiver();
  }else if(wasFollowing){follow.stop();followReceiverPosition=null;followWorldKey=null;}
  updateVisibility();onSettings(structuredClone(settings));record({kind:'particle.light-slice',settings:structuredClone(settings)});
  draw();session.redraw();return read();
 }
 function pick({endpoint}){
  if(!settings.enabled||!refs)throw Error('Enable the light slice first');
  if(!vectors.has(endpoint))throw Error('Choose emitter or receiver');
  const asset=endpoint==='emitter'?refs.a:refs.b;
  select(asset.id);return {id:asset.id,endpoint};
 }
 function hold(){
  if(!reader.read().result)throw Error('No current optical profile to hold');
  held=reader.read().result;draw();return read();
 }
 function points(){
  return {emitter:refs.emitter.getWorldPosition(new Vector3()).toArray(),receiver:refs.receiver.getWorldPosition(new Vector3()).toArray()};
 }
 function tick(){
  if(disposed||!settings.enabled||!refs)return;
  const {emitter,receiver}=points();
  const key=JSON.stringify([emitter,receiver]);
  if(settings.followReceiver&&followReceiverPosition&&receiver.some((v,c)=>Math.abs(v-followReceiverPosition[c])>1e-7)){
   follow.stop();followReceiverPosition=null;followWorldKey=null;settings={...settings,followReceiver:false};
  }
  if(lastWorld!==key){
   lastWorld=key;
   settings={...settings,emitter,receiver};if(key!==followWorldKey)onSettings(structuredClone(settings));draw();session.redraw();
  }
  if(settings.followReceiver)follow.tick();
  try{
   reader.tick({emitter,receiver,halfWidth:settings.halfWidth,sections:settings.sections,
    width:settings.mode==='ray'?1:settings.mode==='bundle'?settings.offsets:settings.sweepOffsets,
    refreshSteps:settings.refreshSteps,source:settings.source,gain:settings.gain});
  }catch(e){error=e.message;}
 }

 function geometry(snapshot,profiles){
  if(!refs||!settings.enabled||!settings.showGeometry)return;
  const positions=[],colors=[],put=(a,b,c)=>{positions.push(...a.toArray(),...b.toArray());colors.push(...c.toArray(),...c.toArray());};
  const {emitter,receiver}=points(),a=new Vector3(...emitter),b=new Vector3(...receiver);
  const forward=b.clone().sub(a),distance=forward.length();
  if(distance<=0.00001){refs.lines.geometry.setAttribute('position',new Float32BufferAttribute([],3));return;}
  forward.normalize();
  const right=new Vector3().crossVectors(Math.abs(forward.y)<.9?new Vector3(0,1,0):new Vector3(1,0,0),forward).normalize();
  const up=new Vector3().crossVectors(forward,right);
  const offset=(point,x,y)=>point.clone().addScaledVector(right,x).addScaledVector(up,y);
  const guide=new Color(0x8aa5c5);
  const markerScale=snapshot?.transform?.scale??Math.max(1,distance*.65);
  refs.emitter.children[0].scale.setScalar(markerScale);refs.receiver.children[0].scale.setScalar(markerScale);
  if(settings.mode!=='ray'){
   const w=settings.halfWidth,corners=[[-w,-w],[w,-w],[w,w],[-w,w]];
   corners.forEach(([x,y],i)=>{const [nx,ny]=corners[(i+1)%4];put(offset(a,x,y),offset(a,nx,ny),guide);put(offset(b,x,y),offset(b,nx,ny),guide);put(offset(a,x,y),offset(b,x,y),guide);});
  }
  put(a,b,guide);
  if(snapshot&&profiles){
   const s=new Vector3(...snapshot.emitter),e=new Vector3(...snapshot.receiver);
   const r=profiles[Math.floor(snapshot.width/2)*(snapshot.width+1)];
   for(let i=0;i<r.length;i++){
    const level=.25+.75*(1-Math.exp(-Math.max(...r[i].light)*2));
    const color=new Color(settings.view==='held'?0xbb9afc:0xffaa56).multiplyScalar(level);
    put(s.clone().lerp(e,i/r.length),s.clone().lerp(e,(i+1)/r.length),color);
   }
  }
  const p=a.clone().lerp(b,settings.depth);put(p.clone().addScaledVector(right,-.035),p.clone().addScaledVector(right,.035),new Color(0x87d6fb));
  refs.lines.geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
  refs.lines.geometry.setAttribute('color',new Float32BufferAttribute(colors,3));
  refs.lines.geometry.computeBoundingSphere();
 }
 function heat(canvas,profiles,width,{end=false,sections,depth,snapshot}){
  if(!profiles){canvas.hidden=true;return;}
  canvas.hidden=false;
  canvas.width=end?width:sections;canvas.height=width;
  const ctx=canvas.getContext('2d'),img=ctx.createImageData(canvas.width,canvas.height);
  const tone=v=>Math.round(255*(1-Math.exp(-Math.max(0,v)*2)));
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
   const ray=end?y*width+x:y*width+Math.floor(width/2),z=end?depth:x;
   const light=profiles[ray][z].light,at=(y*canvas.width+x)*4;
   img.data.set(light.map(tone),at);img.data[at+3]=255;
  }
  ctx.putImageData(img,0,0);
  canvas.title=(end?'Across the beam at chosen depth':'Left to right: emitter to receiver. Rows: offsets through center of the patch.')+
   ' · sampled material step '+snapshot.identity.step;
 }
 function clearPreview(){
  previewOwner?.setOpticalParticleLightSliceView?.(null);previewOwner=previewSnapshot=previewProfiles=previewGain=null;
 }
 function preview(snapshot,profiles){
  if(!snapshot||!profiles||!settings.enabled||!settings.smokeView){if(previewOwner)clearPreview();return;}
  const owner=runtime();
  if(owner!==previewOwner&&previewOwner)clearPreview();
  if(snapshot===previewSnapshot&&profiles===previewProfiles&&settings.previewGain===previewGain)return;
  if(!owner?.setOpticalParticleLightSliceView)throw Error('Smoke-only beam output is unavailable on this renderer');
  owner.setOpticalParticleLightSliceView(packLightSliceView(snapshot,profiles,settings.previewGain));
  previewOwner=owner;previewSnapshot=snapshot;previewProfiles=profiles;previewGain=settings.previewGain;
 }
 function draw(){
  const a=reader.read(),snapshot=settings.view==='held'?held:a.result;let profiles=null;
  if(snapshot){
   const quality={width:snapshot.width,depthStride:settings.depthStride,acrossStride:settings.acrossStride,correctionStart:settings.correctionStart,
    correctionExtent:settings.correctionExtent,sharingRadius:settings.sharingRadius,source:snapshot.source,gain:snapshot.gain};
   const key=JSON.stringify(quality);
   if(observed!==snapshot||comparisonKey!==key){observed=snapshot;comparisonKey=key;comparison=compareSliceSections(snapshot.moments,quality);}
   profiles=comparison[settings.view==='held'?'fine':settings.view];
  }
  try{preview(snapshot,profiles);}catch(e){error=e.message;clearPreview();}
  geometry(snapshot,profiles);
  if(!view)return;
  updateVisibility();
  for(const [key,el] of controls){const v=settings[key];if(el===el.ownerDocument.activeElement||el.classList.contains('scrubbing'))continue;
   if(el.type==='checkbox')el.checked=v;else if(el.value!==String(v))el.value=String(v);}
  let line=error??a.error??a.reason??(a.inFlight?'Sampling native material…':a.prepared?'Waiting for an optical sample':'Preparing the selected native transport…');
  if(snapshot&&profiles){
   const width=snapshot.width,z=Math.min(snapshot.sections-1,Math.floor(settings.depth*snapshot.sections));
   const sample=profiles[Math.floor(width/2)*(width+1)][z];
   const behind=runtime()?.opticalParticleState?.()?.step;
   const moved=!!refs&&JSON.stringify([snapshot.emitter,snapshot.receiver])!==JSON.stringify(Object.values(points()));
   line=`Material step ${snapshot.identity.step}${Number.isFinite(behind)?' / current '+behind:''} · ${width}×${width} rays · ${snapshot.sections} sections · transmission ${(sample.transmission*100).toFixed(1)}% · light ${sample.light.map(x=>x.toFixed(3)).join(' / ')}`+
    (settings.view==='held'?' · held measurement':moved?' · measured endpoints differ from current handles':'')+(a.inFlight?' · updating':'')+(a.error??error?' · '+(a.error??error):'');
   heat(view.depth,profiles,width,{sections:snapshot.sections,depth:z,snapshot});
   heat(view.cross,profiles,width,{end:true,sections:snapshot.sections,depth:z,snapshot});
  }else{view.depth.hidden=true;view.cross.hidden=true;}
  const anchor=follow.read();
  if(settings.followReceiver)line+=' · '+(anchor.state==='following'?'Following carrier at step '+anchor.step:anchor.reason??'Seeking nearby material');
  view.status.textContent=settings.enabled?line:'Light slice off';
  view.hold.disabled=!a.result;
  view.panel.hidden=!settings.enabled;
 }
 function mount(root,document,invoke){
  const fieldset=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='Moving light slice';fieldset.append(legend);root.append(fieldset);
  fieldset.style.cssText='min-width:0;border:1px solid #555;border-radius:6px;padding:8px;margin:12px 0';
  const panel=document.createElement('div');
  const call=(op,args)=>Promise.resolve(invoke(op,args)).catch(e=>{error=e.message;draw();});
  const checkbox=(parent,key,label)=>{const row=document.createElement('label'),e=document.createElement('input');e.type='checkbox';e.checked=settings[key];row.append(e,' '+label);parent.append(row);controls.push([key,e]);e.addEventListener('change',()=>call('setLightSlice',{[key]:e.checked}));};
  checkbox(fieldset,'enabled','Inspect native light through particles');fieldset.append(panel);
  const labels={mode:['Paths',['One ray','Bundle patch','One-direction sweep']],source:['Source',['Diagnostic emitter','Native flame']],
   view:['Display',['Fresh fine profile','Coarse patch','Shared correction','Held measurement']]};
  for(const [key,[title,names]] of Object.entries(labels)){
   const label=document.createElement('label'),e=document.createElement('select');label.style.cssText='display:flex;justify-content:space-between;gap:5px;margin:6px 0';
   choices[key].forEach((v,i)=>{const option=document.createElement('option');option.value=v;option.textContent=names[i];e.append(option);});
   label.append(title,e);panel.append(label);controls.push([key,e]);e.addEventListener('change',()=>call('setLightSlice',{[key]:e.value}));
  }
  const plots=document.createElement('div');panel.append(plots);
  const advanced=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Sampling and correction controls';advanced.append(summary);
  for(const [key,title,step] of [['previewGain','Smoke display gain',.5],['followRadius','Receiver attachment radius',.05],['halfWidth','Beam half-width',.01],['offsets','Bundle rays across',1],['sweepOffsets','Sweep rays across',1],['sections','Depth sections',1],
   ['gain','Probe light',.05],['refreshSteps','Refresh every N sim steps (0 holds)',1],['depthStride','Coarse depth grouping',1],['acrossStride','Coarse offset grouping',1],
   ['correctionStart','Correction starts (0–1)',.025],['correctionExtent','Correction length (0–1)',.025],['sharingRadius','Sharing radius (0–1)',.025],['depth','Cross-section depth (0–1)',.025]]){
   const row=document.createElement('label'),input=document.createElement('input'),grip=document.createElement('span');
   row.style.cssText='display:grid;grid-template-columns:minmax(0,1fr) 86px;align-items:center;gap:5px;margin:5px 0';grip.textContent=title;input.type='number';input.step=step===1?'1':'any';input.setAttribute('aria-label',title);
   row.append(grip,input);(key==='previewGain'||key==='depth'?panel:advanced).append(row);controls.push([key,input]);
   disposers.push(host.controls.installNumberDrag({input,grip,step,...(step===1?{snap:Math.round}:{})}));
   disposers.push(bindParticleNumber({input,read:()=>settings[key],apply:v=>invoke('setLightSlice',{[key]:v}),onAccepted:draw,onError:e=>{error=e.message;draw();}}));
  }
  checkbox(panel,'showGeometry','Show beam in scene');
  checkbox(panel,'smokeView','Smoke with selected light only');
  checkbox(panel,'followReceiver','Follow receiver material');
  const buttons=document.createElement('div');buttons.style.cssText='display:flex;flex-wrap:wrap;gap:4px;margin:6px 0';
  for(const endpoint of vectors){const button=document.createElement('button');button.type='button';button.textContent='Select '+endpoint;button.addEventListener('click',()=>call('pickLightSliceHandle',{endpoint}));buttons.append(button);}
  const hold=document.createElement('button');hold.type='button';hold.textContent='Hold this sample';hold.addEventListener('click',()=>call('holdLightSlice',{}));buttons.append(hold);panel.append(buttons);
  const depth=document.createElement('canvas'),cross=document.createElement('canvas'),status=document.createElement('p');
  for(const c of [depth,cross])c.style.cssText='display:block;width:100%;image-rendering:pixelated;background:#10151a';
  depth.style.height='64px';cross.style.height='86px';
  status.style.cssText='font:12px monospace;overflow-wrap:anywhere';
  plots.append(status,'Along beam',depth,'Across beam at selected depth',cross);
  panel.append(advanced);
  const note=document.createElement('p');note.textContent='Probe and native flame use the same selected projected particle optics. Coarse is a grouped patch from that deposition; it is not the legacy global field. Shared replaces the chosen stretch with the center-ray optics. Smoke-only keeps the flame emitting into the light solve and hides its direct camera emission.';
  panel.append(note);view={panel,depth,cross,status,hold};draw();
 }
 return {read,configure,pick,hold,tick,mount,dispose(){disposed=true;clearPreview();follow.dispose();reader.dispose();disposers.forEach(d=>d?.dispose?.());}};
}
