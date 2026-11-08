import {Group, Mesh, BufferGeometry, BufferAttribute, MeshNormalMaterial, DoubleSide, Sprite, SpriteMaterial, CanvasTexture, Line, LineBasicMaterial, SphereGeometry, MeshBasicMaterial, SRGBColorSpace} from '../lib/three.core.js';
import {validateExport,validateReplay,frameAtTime,ballisticArc} from './hand-replay-contract.mjs';
import {createHandInspection,mountInspectionControls} from './hand-replay-inspection.mjs';
import {createCameraComparison} from './hand-replay-camera-view.mjs';
import {displayScales,validateGuide,validateMoment,deformationTrace,loopTime} from './hand-replay-guide.mjs';
import {isStillGallery,mountStillGallery} from './hand-replay-gallery.mjs';
export default {
 id:'hand-replay',title:'Recorded hand / direction comparison',
 async create({host,inputs,record,updateInputs=()=>{}}){
  const document=host.controls.document;
  const fetchText=async url=>{const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw Error('replay source unavailable');return response.text();};
  const sha=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
  const reportURL=new URL('export-report.json',new URL(inputs.manifest,document.baseURI));
  const admission=async()=>JSON.parse(await fetchText(reportURL));
  const catalogText=await fetchText(inputs.manifest),catalog=JSON.parse(catalogText),receipt=await admission();
  validateExport(receipt,catalog.generation);
  if(await sha(catalogText)!==receipt.catalogSha256)throw Error('export catalog hash mismatch');
  if(!catalog.sequences?.length)throw Error('no recorded sequences');
  const galleryMode=isStillGallery(catalog);
  const labelFor=model=>typeof inputs.modelLabels?.[model.id]==='string'&&inputs.modelLabels[model.id].trim()?inputs.modelLabels[model.id]:model.label;
  const guide=inputs.guide?validateGuide(JSON.parse(await fetchText(inputs.guide)),catalog,await sha(catalogText)):null;
  const pair=['original','trained'].map(id=>catalog.models.findIndex(m=>m.id===id));
  if(guide&&pair.some(i=>i<0))throw Error('guided comparison requires original and trained models');
  const scene=await host.scene.open();const objects=[];let data,images=[],index=0,sequenceIndex=0,playing=false,time=0,lastTick=null,finger=4,commonOrigin=true,loading=false,disposed=false,error=null,token=0;
  let status,preview,playButton,sequenceSelect,scrub,fingerSelect,originSelect,momentSelect,question,scaleSelect,teacherToggle,arcToggle,sourceSelect,tracePanel;
  let inspection,inspectionControls,cameraComparison,viewMode='spatial',viewModeChosen=false,requestedViewMode=null,viewSelect,projectionNote,overlayOpacity=.55,sourceTitle,traceMetric='segment',traceMetricChosen=false,traceSelect;
  let moment=null,scaleMode='predicted',showTeachers=galleryMode||(inputs.showTeachers??!guide),showArcs=!guide&&!galleryMode,sourceMode='crop',trace=null,sourceSprite,sourceCanvas,sourceTexture,galleryControls,pairDetails;
  let reference=pair[0];let pairSelects=[];
  const visibleModels=()=>catalog.models.filter((m,i)=>!guide||showTeachers||pair.includes(i)).map(m=>m.id);
  const scales=()=>data?displayScales(data.frames[index].hands,reference,scaleMode):[];
  const rebuildTrace=()=>{trace=guide&&data?deformationTrace(data,moment?.start??0,moment?.end??data.frames.length-1,finger,pair,traceMetric):null;};
  const read=()=>({gallery:galleryMode?{index:sequenceIndex,total:catalog.sequences.length,label:catalog.sequences[sequenceIndex].label}:null,comparisonModels:pair.map(i=>catalog.models[i]?.id),inspection:inspection?.read()??null,viewMode,requestedViewMode:requestedViewMode??'auto',projection:cameraComparison?.read(index)??{available:false},overlayOpacity,moment:moment?.id??null,scaleMode,visibleModels:visibleModels(),displayScales:scales(),trace:trace?{...trace,cursorFrame:index}:null,sourceMode,showArcs,source:'saved_camera_samples',inference:'precomputed',sequence:data?.label??null,frame:index,captureId:data?.frames[index]?.captureId??null,timeMs:time,playing,loading,error,finger,commonOrigin,models:data?.models.map(model=>({id:model.id,label:labelFor(model),sourceLabel:model.label,checkpointSha256:model.checkpointSha256}))??[],displayed:data?.frames[index]?.hands.map(h=>({status:h.status,reason:h.reason??null,fallback:h.fallback??false})),view:scene.readView(),fluid:false});
  const sync=()=>{
   inspectionControls?.sync();galleryControls?.sync();if(pairDetails)pairDetails.open=viewMode==='camera';pairSelects.forEach((select,i)=>select.value=catalog.models[pair[i]]?.id??'');
   if(status)status.dataset.recordedFrame=String(index);
   if(status)status.textContent=error?error:loading?'Loading recorded sequence…':`${index+1}/${data?.frames.length??0} · ${(time/1000).toFixed(2)} s · recorded timing · ${data?.frames[index]?.hands.map((h,i)=>`${data.models[i].label}: ${h.status}${h.fallback?' (manual fallback crop)':''}`).join(' · ')??''}`;
   if(guide&&status&&!error&&!loading){const alerts=data?.frames[index]?.hands.flatMap((h,i)=>visibleModels().includes(data.models[i].id)&&(h.status!=='observed'||h.fallback||scales()[i]===null)?[`${data.models[i].label}: ${h.status!=='observed'?h.status:h.fallback?'manual fallback crop':'display scale unavailable'}`]:[])??[];status.textContent=`Frame ${index+1}/${data?.frames.length??0} · ${(time/1000).toFixed(2)} s · saved recording${alerts.length?' · '+alerts.join(' · '):''}`;}
   if(momentSelect)momentSelect.value=moment?.id??'';
   if(question)question.textContent=moment?.question??'Explore the saved recording.';
   if(scaleSelect){scaleSelect.value=scaleMode;scaleSelect.disabled=viewMode!=='spatial';}
   if(sourceSelect)sourceSelect.value=sourceMode;
   if(viewSelect)viewSelect.value=viewMode;
   if(traceSelect)traceSelect.value=traceMetric;
   if(projectionNote){const p=cameraComparison?.read(index);projectionNote.textContent=p?.available?`Cyan / orange: each model only. Purple: overlap. This is disagreement, not ground-truth error. Projection: ${[...new Set(p.methods)].join('; ')}.${viewMode==='time'?` Time runs into depth: ${p.pairedFrames}/${p.totalFrames} paired slices. Orbit to inspect.`:''}`:`Recorded-camera view unavailable: ${p?.reason??'no metadata'}`;}
   if(teacherToggle)teacherToggle.checked=showTeachers;
   if(arcToggle)arcToggle.checked=showArcs;
   if(fingerSelect)fingerSelect.value=String(finger);
   if(originSelect)originSelect.value=commonOrigin?'shared':'tip';
   if(playButton){playButton.textContent=playing?'Pause':moment?.loop?'Play loop':'Play';playButton.disabled=loading||!data;}
   if(scrub){scrub.min=String(moment?.start??0);scrub.max=String(moment?.end??(data?.frames.length??1)-1);scrub.value=String(index);scrub.disabled=loading;}
  };
  const labelTexture=(text,color='#ffffff')=>{
   const c=document.createElement('canvas');c.width=768;c.height=96;const x=c.getContext('2d');x.fillStyle='#171e29';x.fillRect(0,0,c.width,c.height);x.fillStyle=color;x.font='bold 36px system-ui';x.textAlign='center';x.fillText(text,c.width/2,62);const texture=new CanvasTexture(c);texture.colorSpace=SRGBColorSpace;return texture;
  };
  const makeObjects=async()=>{
   for(let i=0;i<catalog.models.length;i++){
    const root=new Group();root.position.set((i%2?1:-1)*1.5,i<2?6.5:3,0);root.scale.setScalar(5);
    const mesh=new Mesh(new BufferGeometry(),new MeshNormalMaterial({side:DoubleSide}));root.add(mesh);
    const color=[0x7fd5ff,0xffbd77,0x99efba,0xe1a0ff][i%4];
    const arc=new Line(new BufferGeometry(),new LineBasicMaterial({color,depthTest:false}));root.add(arc);
    const landing=new Mesh(new SphereGeometry(.009,12,8),new MeshBasicMaterial({color,depthTest:false}));root.add(landing);
    const label=new Sprite(new SpriteMaterial({map:labelTexture(labelFor(catalog.models[i])),depthTest:false}));label.scale.set(.52,.065,1);label.position.set(0,.28,0);root.add(label);
    root.name=labelFor(catalog.models[i]);await scene.attach(root,{owned:true,metadata:{label:root.name,type:'recorded-hand-comparison',source:catalog.models[i]}});
    objects.push({root,mesh,arc,landing,label});
   }
   if(guide){
    sourceCanvas=document.createElement('canvas');sourceCanvas.width=640;sourceCanvas.height=640;sourceTexture=new CanvasTexture(sourceCanvas);sourceTexture.colorSpace=SRGBColorSpace;
    sourceSprite=new Sprite(new SpriteMaterial({map:sourceTexture,depthTest:false,toneMapped:false}));sourceSprite.position.set(-2.5,4.8,0);sourceSprite.scale.set(1.8,1.8,1);
    await scene.attach(sourceSprite,{owned:true,metadata:{label:'Recorded camera image',type:'recorded-camera'}});
    const title=sourceTitle=new Sprite(new SpriteMaterial({map:labelTexture('Recorded camera'),depthTest:false}));title.position.set(-2.5,6,0);title.scale.set(1.8,.225,1);await scene.attach(title,{owned:true,metadata:{label:'Recorded camera label'}});
   }
  };
  const draw=()=>{
   if(!data)return;const row=data.frames[index],display=scales();
   cameraComparison?.draw(index,viewMode,sourceMode,overlayOpacity);
   inspection?.draw(index,viewMode==='inspection',sourceMode,visibleModels());
   if(sourceSprite)sourceSprite.visible=sourceTitle.visible=viewMode==='spatial';
   for(let i=0;i<objects.length;i++){
    const o=objects[i],h=row.hands[i];
    o.root.visible=viewMode==='spatial'&&(!guide||showTeachers||pair.includes(i));
    if(guide){const p=pair.indexOf(i),remaining=catalog.models.map((_,j)=>j).filter(j=>!pair.includes(j)),slot=p>=0?p:2+remaining.indexOf(i);o.root.scale.setScalar(7);o.root.position.set(slot%2?1.3:-.7,1+3*(Math.ceil(catalog.models.length/2)-1)-3*Math.floor(slot/2),0);o.label.scale.set(.27,.034,1);}
    o.mesh.visible=h.status==='observed'&&display[i]!==null;o.arc.visible=o.landing.visible=o.mesh.visible&&showArcs;
    if(!o.mesh.visible)continue;
    const wrist=h.joints[0],transform=v=>v.map((x,k)=>(x-wrist[k])*(k===1||(k===2&&h.camera?.basis==='opencv_x_right_y_down_z_forward')?-1:1)*display[i]);
    const vertices=h.vertices.flatMap(transform);o.mesh.geometry.setAttribute('position',new BufferAttribute(new Float32Array(vertices),3));o.mesh.geometry.setIndex(data.models[i].faces.flat());o.mesh.geometry.computeVertexNormals();o.mesh.geometry.computeBoundingSphere();
    const tipIndex=4*(finger+1),tip=transform(h.joints[tipIndex]),dip=transform(h.joints[tipIndex-1]);
    const direction=tip.map((x,k)=>x-dip[k]);const origin=commonOrigin?[0,0,0]:tip;
    if(Math.hypot(...direction)>1e-10){
     const points=ballisticArc(origin,direction,1,-.30);
     o.arc.geometry.setAttribute('position',new BufferAttribute(new Float32Array(points.flat()),3));o.arc.geometry.computeBoundingSphere();o.landing.position.fromArray(points.at(-1));
    }else{o.arc.visible=o.landing.visible=false;}
   }
   if(preview){preview.src=images[index].src;preview.dataset.captureId=row.captureId;}
   if(sourceCanvas){
    const ctx=sourceCanvas.getContext('2d'),im=images[index],crop=row.hands[reference]?.cropBox;ctx.fillStyle='#303844';ctx.fillRect(0,0,640,640);
    const box=sourceMode==='crop'&&crop?crop:[0,0,im.naturalWidth??im.width,im.naturalHeight??im.height];
    const w=box[2]-box[0],h=box[3]-box[1],fit=640/Math.max(w,h);
    ctx.drawImage(im,(640-w*fit)/2-box[0]*fit,(640-h*fit)/2-box[1]*fit,(im.naturalWidth??im.width)*fit,(im.naturalHeight??im.height)*fit);sourceTexture.needsUpdate=true;
   }
   drawTrace();scene.redraw();sync();
  };
  const load=async(value=0,selectedMoment=null)=>{
   const n=Number(value);if(!Number.isInteger(n)||!catalog.sequences[n])throw Error('unknown sequence');
   const ticket=++token;playing=false;loading=true;error=null;sync();
   try{
    const text=await fetchText(catalog.sequences[n].url);
    if(await sha(text)!==catalog.sequences[n].sha256)throw Error('sequence hash mismatch');
    const next=validateReplay(JSON.parse(text),await admission(),catalog.generation);
    if(galleryMode&&next.frames.length!==1)throw Error('still gallery requires exactly one frame per example');
    if(JSON.stringify(next.models)!==JSON.stringify(catalog.models))throw Error('catalog model identity mismatch');
    const loaded=await Promise.all(next.frames.map(f=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error(`missing source image ${f.captureId}`));img.src=f.image;})));
    validateExport(await admission(),catalog.generation);
    if(disposed||ticket!==token)return read();
    if(selectedMoment)validateMoment(selectedMoment,next);
    moment=selectedMoment;if(moment)finger=moment.finger;
    data=next;images=loaded;sequenceIndex=n;
    const support=cameraComparison.load(next,loaded,pair);inspection.load(next,loaded);
    if(!viewModeChosen){viewMode=support.available?(inputs.viewMode==='inspection'?'inspection':'camera'):'spatial';if(!traceMetricChosen)traceMetric=support.available?'palmWidth':'segment';}
    else viewMode=support.available?requestedViewMode:'spatial';
    if(sequenceSelect)sequenceSelect.value=String(n);index=moment?.frame??0;time=data.frames[index].timeMs;lastTick=null;rebuildTrace();draw();record({kind:'hand-replay.load',phase:'applied',effective:read()});
   }catch(e){if(disposed||ticket!==token)return;data=null;images=[];cameraComparison?.clear();inspection?.clear();trace=null;if(tracePanel)tracePanel.textContent='Comparison unavailable';if(sourceCanvas){sourceCanvas.getContext('2d').clearRect(0,0,640,640);sourceTexture.needsUpdate=true;}for(const o of objects)o.mesh.visible=o.arc.visible=o.landing.visible=false;if(preview)preview.removeAttribute('src');scene.redraw();error=String(e);throw e;}finally{if(ticket===token){loading=false;sync();}}
   return read();
  };
  const seek=value=>{if(loading||!data)throw Error('sequence unavailable');const n=Number(value);if(!Number.isInteger(n)||n<0||n>=data.frames.length)throw Error('frame out of range');playing=false;if(moment&&(n<moment.start||n>moment.end)){moment=null;rebuildTrace();}index=n;time=data.frames[n].timeMs;draw();return read();};
  const toggle=()=>{if(loading||!data)throw Error('sequence unavailable');if(!playing&&index===(moment?.end??data.frames.length-1)){index=moment?.start??0;time=data.frames[index].timeMs;draw();}playing=!playing;lastTick=null;sync();return read();};
  const pause=()=>{playing=false;lastTick=null;sync();return read();};
  const galleryFrame=()=>{const viewport=document.querySelector?.('#viewport'),aspect=(viewport?.clientWidth??1400)/(viewport?.clientHeight??1000),distance=Math.max(12.5,Math.min(3,catalog.models.length)*3.2/(2*Math.tan(Math.PI/9)*aspect)*1.1);return {position:[0,5.8,distance],target:[0,5.1,0],fov:40};};
  const frame=()=>scene.setView(viewMode==='camera'?{position:[0,4.8,11.4],target:[0,4.8,0]}:viewMode==='inspection'&&galleryMode?galleryFrame():viewMode==='inspection'?{position:[1,catalog.models.length>4?6.6:6,catalog.models.length>2?5*(Math.ceil(catalog.models.length/2)+1):10],target:[0,catalog.models.length>4?5.3:4.7,0],fov:40}:viewMode==='time'?{position:[5,7.5,10],target:[0,4.6,-1.5]}:guide&&showTeachers&&catalog.models.length>4?{position:[-.4,1+1.5*(Math.ceil(catalog.models.length/2)-1)+.8,5+4*Math.ceil(catalog.models.length/2)],target:[-.4,1+1.5*(Math.ceil(catalog.models.length/2)-1)+.8,0]}:guide?{position:[-.4,showTeachers?3.8:4.9,showTeachers?13:10],target:[-.4,showTeachers?3.8:4.9,0]}:{position:[0,4.7,12],target:[0,4.7,0]});
  const selectExample=async value=>{const n=Number(value);if(!galleryMode||!Number.isInteger(n)||n<0||n>=catalog.sequences.length)throw Error('unknown example');const selected=guide?.moments.find(m=>m.sequence===n)??null;const result=await load(n,selected);if(result.captureId!==data?.frames[0].captureId||sequenceIndex!==n)return result;updateInputs({...inputs,example:n});return result;};
  const setMoment=async id=>{const m=guide?.moments.find(m=>m.id===id);if(!m)throw Error('unknown comparison moment');if(galleryMode)return selectExample(m.sequence);const result=await load(m.sequence,m);frame();return result;};
  const drawTrace=()=>{
   if(!tracePanel||!trace)return;const a=data.frames[trace.start].timeMs,b=data.frames[trace.end].timeMs;
   const raw=traceMetric!=='segment',metricLabel={palmWidth:'Palm width · raw millimeters',palmLength:'Palm length · raw millimeters',palmRatio:'Palm length / width'}[traceMetric];const plot=p=>raw?p.value:p.percent;
   const values=trace.series.flatMap(s=>s.points.map(plot).filter(v=>v!==null));const lo=Math.min(raw?Infinity:95,...values),hi=Math.max(raw?-Infinity:105,...values);
   const x=t=>10+(t-a)/Math.max(1,b-a)*300,y=v=>110-(v-lo)/Math.max(1e-9,hi-lo)*90;
   const colors=['#55c7ff','#ffb875'];let drawing='';
   trace.series.forEach((s,i)=>{let path='',joined=false;for(const p of s.points){if(plot(p)===null){joined=false;continue;}path+=(joined?'L':'M')+x(p.timeMs)+','+y(plot(p));joined=true;}drawing+=`<path d="${path}" fill="none" stroke="${colors[i]}" stroke-width="2"/>`;if(s.points.length===1&&plot(s.points[0])!==null)drawing+=`<circle cx="${x(s.points[0].timeMs)}" cy="${y(plot(s.points[0]))}" r="4" fill="${colors[i]}"/>`;});
   drawing+=`<line x1="${x(data.frames[index].timeMs)}" x2="${x(data.frames[index].timeMs)}" y1="10" y2="120" stroke="white"/>`;
   const names=['Thumb','Index','Middle','Ring','Pinky'];tracePanel.innerHTML=`<strong>${raw?metricLabel:names[finger]+' · first segment length'}</strong><div>${raw?'Source geometry before camera placement; no display normalization.':'Relative to palm width; each line’s median = 100%.'}</div><svg viewBox="0 0 320 130" style="width:100%;background:#17202b;cursor:crosshair" aria-label="Finger deformation trace">${drawing}</svg><div><span style="color:${colors[0]}">Left</span> / <span style="color:${colors[1]}">Right</span> ${raw?'now':'variation'}: ${trace.series.map(s=>raw?(s.points[index-trace.start]?.value?.toFixed(traceMetric==='palmRatio'?3:1)??'unavailable')+(traceMetric==='palmRatio'?'':' mm'):s.rangePercent===null?'unavailable':s.rangePercent.toFixed(1)+'%').join(' / ')}</div><small>Click trace to seek. Changing geometry is not a correctness score.</small>`;
   const valuesPanel=document.createElement('div');for(let mi=0;mi<data.models.length;mi++){const h=data.frames[index].hands[mi],line=document.createElement('div');if(h.status!=='observed'){line.textContent=data.models[mi].label+': unavailable';}else{const dist=(a,b)=>Math.hypot(...a.map((v,k)=>v-b[k])),length=dist(h.joints[0],h.joints[9])*1000,width=dist(h.joints[5],h.joints[17])*1000;line.textContent=`${data.models[mi].label}: length ${length.toFixed(1)} mm · width ${width.toFixed(1)} mm · ratio ${width>1e-10?(length/width).toFixed(3):'unavailable'}`;}valuesPanel.append(line);}tracePanel.append(valuesPanel);
   const svg=tracePanel.querySelector?.('svg');if(svg)svg.onclick=e=>{const box=svg.getBoundingClientRect(),u=Math.max(0,Math.min(1,((e.clientX-box.left)/box.width*320-10)/300));seek(Math.min(trace.end,Math.max(trace.start,frameAtTime(data.frames,a+u*(b-a)))));};
  };
  let unsubscribe;
  try{await makeObjects();cameraComparison=await createCameraComparison(scene,document,labelTexture,labelFor);inspection=await createHandInspection(scene,document,catalog.models,labelTexture,{columns:galleryMode?3:2,labelFor});document.defaultView.kaminosSelection?.clear();frame();if(galleryMode){await selectExample(inputs.example??0);frame();}else if(guide)await setMoment(inputs.moment??guide.moments[0].id);else {await load(0);frame();}if(inputs.frame!==undefined)seek(inputs.frame);unsubscribe=scene.onFrame(({timestampMs})=>{
   if(!playing||loading){lastTick=null;return;}if(lastTick===null){lastTick=timestampMs;return;}
   time+=Math.max(0,timestampMs-lastTick);lastTick=timestampMs;
   if(moment?.loop)time=loopTime(data.frames,moment.start,moment.end,time);
   else if(time>=data.frames[moment?.end??data.frames.length-1].timeMs){time=data.frames[moment?.end??data.frames.length-1].timeMs;playing=false;}
   const next=Math.min(moment?.end??data.frames.length-1,frameAtTime(data.frames,time));
   if(next!==index){index=next;draw();}else sync();
  });}catch(e){await scene.dispose();throw e;}
  return {read,operations:{selectExample,setProjectionLocked(value){inspection.lock(value);draw();record({kind:'hand-replay.lock',effective:read()});return read();},rotateHands(value){inspection.rotate(value);draw();record({kind:'hand-replay.rotate',effective:read()});return read();},snapHands(){inspection.reset();draw();record({kind:'hand-replay.snap-all',effective:read()});return read();},snapHand(value){inspection.reset(value);draw();record({kind:'hand-replay.snap',model:value,effective:read()});return read();},setMeshFrozen(value){inspection.freeze(value);draw();record({kind:'hand-replay.hold',effective:read()});return read();},setComparisonPair(value){if(!Array.isArray(value)||value.length!==2)throw Error('comparison requires two models');const next=value.map(id=>catalog.models.findIndex(m=>m.id===id));if(next.some(i=>i<0))throw Error('unknown comparison model');if(next[0]===next[1])throw Error('comparison models must be distinct');pair.splice(0,2,...next);error=null;reference=pair[0];if(data)cameraComparison.load(data,images,pair);rebuildTrace();draw();record({kind:'hand-replay.comparison-pair',effective:read()});return read();},setTraceMetric(value){if(!['segment','palmWidth','palmLength','palmRatio'].includes(value))throw Error('invalid trace metric');traceMetric=value;traceMetricChosen=true;rebuildTrace();draw();return read();},load,seek,toggle,pause,frame,setMoment,setViewMode(value){if(!['spatial','camera','time','inspection'].includes(value))throw Error('invalid view mode');if(value!=='spatial'&&!cameraComparison.support().available)throw Error(cameraComparison.support().reason);viewMode=value;requestedViewMode=value;viewModeChosen=true;draw();frame();record({kind:'hand-replay.view',effective:read()});return read();},setOverlayOpacity(value){const n=Number(value);if(!Number.isFinite(n)||n<0||n>1)throw Error('invalid overlay opacity');overlayOpacity=n;draw();return read();},setScaleMode(value){if(!['predicted','palm'].includes(value))throw Error('invalid scale mode');scaleMode=value;draw();record({kind:'hand-replay.scale',effective:read()});return read();},setTeachers(value){showTeachers=!!value;draw();frame();return read();},setArcs(value){showArcs=!!value;draw();return read();},setSource(value){if(!['crop','full'].includes(value))throw Error('invalid camera view');sourceMode=value;draw();return read();},setFinger(value){const n=Number(value);if(!Number.isInteger(n)||n<0||n>4)throw Error('invalid finger');finger=n;rebuildTrace();draw();return read();},setOrigin(value){if(!['shared','tip'].includes(value))throw Error('invalid origin');commonOrigin=value==='shared';draw();return read();}},
   mount({root,document,invoke}){
    inspectionControls=mountInspectionControls(document,invoke,read,{compact:galleryMode});
    if(galleryMode)galleryControls=mountStillGallery({root,document,read,invoke,catalog,title:inputs.galleryTitle,description:inputs.galleryDescription});
    const intro=document.createElement('p');intro.textContent='Same saved motion, precomputed models. Wrist aligned; equal scale. The arc follows the final finger segment at 1 m/s under gravity. Orbit the scene to inspect depth.';
    const limits=document.createElement('p');limits.textContent=catalog.limit;limits.style.fontSize='12px';
    preview=document.createElement('img');preview.alt='Exact recorded camera frame';preview.style.cssText='width:100%;display:block';
    const call=(op,v)=>invoke(op,v).catch(e=>{error=String(e);sync();});
    sequenceSelect=document.createElement('select');sequenceSelect.setAttribute('aria-label','Recording');catalog.sequences.forEach((s,i)=>{const o=document.createElement('option');o.value=i;o.textContent=s.label;sequenceSelect.append(o);});sequenceSelect.onchange=()=>call('load',sequenceSelect.value);
    playButton=document.createElement('button');playButton.onclick=()=>call('toggle');
    scrub=document.createElement('input');scrub.type='range';scrub.min='0';scrub.step='1';scrub.setAttribute('aria-label','Recorded frame');scrub.oninput=()=>call('seek',scrub.value);
    fingerSelect=document.createElement('select');fingerSelect.setAttribute('aria-label','Launch finger');['Thumb','Index','Middle','Ring','Pinky'].forEach((s,i)=>{const o=document.createElement('option');o.value=i;o.textContent=s;fingerSelect.append(o);});fingerSelect.value=String(finger);fingerSelect.onchange=()=>call('setFinger',fingerSelect.value);
    originSelect=document.createElement('select');originSelect.setAttribute('aria-label','Launch origin');for(const [value,text]of [['shared','Shared origin · direction only'],['tip','Fingertip origin · position + direction']]){const o=document.createElement('option');o.value=value;o.textContent=text;originSelect.append(o);}originSelect.onchange=()=>call('setOrigin',originSelect.value);
    viewSelect=document.createElement('select');viewSelect.setAttribute('aria-label','Comparison view');for(const [value,text]of (galleryMode?[['inspection','3D hands + photograph'],['camera','Exact camera overlays'],['spatial','Free 3D shape']]:[['inspection','Meshes + camera planes'],['camera','Recorded camera · silhouettes'],['spatial','Free 3D shape'],['time','Disagreement through time']])){const option=document.createElement('option');option.value=value;option.textContent=text;viewSelect.append(option);}viewSelect.onchange=()=>call('setViewMode',viewSelect.value);
    projectionNote=document.createElement('small');projectionNote.style.cssText='display:block;font-size:12px;line-height:1.5';
    const opacityLabel=document.createElement('label');opacityLabel.textContent='Silhouette opacity ';const opacityInput=document.createElement('input');opacityInput.type='number';opacityInput.min='0';opacityInput.max='1';opacityInput.step='.05';opacityInput.value=String(overlayOpacity);opacityInput.style.width='75px';opacityInput.oninput=()=>call('setOverlayOpacity',opacityInput.value);opacityLabel.append(opacityInput);host.controls.installNumberDrag?.({input:opacityInput,step:.05});root.append(viewSelect);const pairRoot=galleryMode?document.createElement('details'):root;if(galleryMode){pairDetails=pairRoot;const heading=document.createElement('summary');heading.textContent='Compare two silhouettes';pairRoot.append(heading);}pairRoot.append(opacityLabel,projectionNote);pairSelects=['First compared model','Second compared model'].map((label,i)=>{const wrap=document.createElement('label');wrap.textContent=label;const select=document.createElement('select');select.setAttribute('aria-label',label);catalog.models.forEach(m=>{const option=document.createElement('option');option.value=m.id;option.textContent=labelFor(m);select.append(option);});select.value=catalog.models[pair[i]]?.id??'';select.onchange=()=>{const ids=pair.map(j=>catalog.models[j].id);ids[i]=select.value;call('setComparisonPair',ids);};wrap.append(select);pairRoot.append(wrap);return select;});
    const frameButton=document.createElement('button');frameButton.textContent='Frame comparison';frameButton.onclick=()=>call('frame');status=document.createElement('div');status.setAttribute('role','status');status.style.overflowWrap='anywhere';
    if(galleryMode){
     sourceSelect=document.createElement('select');sourceSelect.setAttribute('aria-label','Camera view');for(const [value,text]of [['crop','Hand crop'],['full','Full photograph']]){const option=document.createElement('option');option.value=value;option.textContent=text;sourceSelect.append(option);}sourceSelect.onchange=()=>call('setSource',sourceSelect.value);
     const sourceLabel=document.createElement('label');sourceLabel.textContent='Photograph';sourceLabel.append(sourceSelect);root.append(sourceLabel,frameButton);
     frameButton.textContent='Fit all hands';
     const measurements=document.createElement('details'),heading=document.createElement('summary');heading.textContent='Measurements and source';question=document.createElement('p');question.style.cssText='font:12px/1.5 system-ui;overflow-wrap:anywhere';measurements.append(heading,question,limits);root.append(pairRoot,measurements);
    }else if(guide){
     momentSelect=document.createElement('select');momentSelect.setAttribute('aria-label','Comparison moment');
     const all=document.createElement('option');all.value='';all.textContent='Explore full recording';momentSelect.append(all);
     guide.moments.forEach(m=>{const o=document.createElement('option');o.value=m.id;o.textContent=m.title;momentSelect.append(o);});momentSelect.onchange=()=>momentSelect.value?call('setMoment',momentSelect.value):call('load',sequenceSelect.value);
     question=document.createElement('p');
     scaleSelect=document.createElement('select');scaleSelect.setAttribute('aria-label','Hand display size');for(const [value,text]of [['predicted','As predicted'],['palm','Same palm width']]){const o=document.createElement('option');o.value=value;o.textContent=text;scaleSelect.append(o);}scaleSelect.onchange=()=>call('setScaleMode',scaleSelect.value);
     const sizeNote=document.createElement('small');sizeNote.textContent='Same palm width rescales each frame for shape comparison. Saved predictions and the trace stay unchanged.';
     sourceSelect=document.createElement('select');sourceSelect.setAttribute('aria-label','Camera view');for(const [value,text]of [['crop','Hand crop'],['full','Full camera view']]){const o=document.createElement('option');o.value=value;o.textContent=text;sourceSelect.append(o);}sourceSelect.onchange=()=>call('setSource',sourceSelect.value);
     traceSelect=document.createElement('select');traceSelect.setAttribute('aria-label','Geometry trace');for(const [value,text]of [['palmLength','Palm length · raw mm'],['palmRatio','Palm length / width'],['palmWidth','Palm width · raw mm'],['segment','Selected segment / palm']]){const o=document.createElement('option');o.value=value;o.textContent=text;traceSelect.append(o);}traceSelect.onchange=()=>call('setTraceMetric',traceSelect.value);
     tracePanel=document.createElement('div');tracePanel.style.cssText='font-size:12px;line-height:1.5;margin:12px 0';
     const more=document.createElement('details'),heading=document.createElement('summary');heading.textContent='Teachers, trajectories and recording details';more.append(heading);
     const checkbox=(label,op)=>{const wrap=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.onchange=()=>call(op,input.checked);wrap.append(input,document.createTextNode?document.createTextNode(label):label);more.append(wrap);return input;};
     teacherToggle=checkbox('Show teachers','setTeachers');arcToggle=checkbox('Show fingertip trajectories','setArcs');
     more.append(sequenceSelect,fingerSelect,originSelect,frameButton,limits);
     preview.style.display='none';root.append(momentSelect,question,scaleSelect,sizeNote,sourceSelect,playButton,scrub,status,traceSelect,tracePanel,more,preview);
    }else root.append(intro,limits,sequenceSelect,preview,playButton,scrub,fingerSelect,originSelect,frameButton,status);draw();sync();
   },async dispose(){disposed=true;token++;playing=false;unsubscribe?.();cameraComparison?.dispose();inspectionControls?.dispose();galleryControls?.dispose();inspection?.dispose();await scene.dispose();images=[];}
  };
 }
};
