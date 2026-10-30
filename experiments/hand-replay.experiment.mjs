import {Group, Mesh, BufferGeometry, BufferAttribute, MeshNormalMaterial, DoubleSide, Sprite, SpriteMaterial, CanvasTexture, Line, LineBasicMaterial, SphereGeometry, MeshBasicMaterial} from '../lib/three.core.js';
import {validateExport,validateReplay,frameAtTime,ballisticArc} from './hand-replay-contract.mjs';
export default {
 id:'hand-replay',title:'Recorded hand / direction comparison',
 async create({host,inputs,record}){
  const document=host.controls.document;
  const fetchText=async url=>{const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw Error('replay source unavailable');return response.text();};
  const sha=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
  const reportURL=new URL('export-report.json',new URL(inputs.manifest,document.baseURI));
  const admission=async()=>JSON.parse(await fetchText(reportURL));
  const catalogText=await fetchText(inputs.manifest),catalog=JSON.parse(catalogText),receipt=await admission();
  validateExport(receipt,catalog.generation);
  if(await sha(catalogText)!==receipt.catalogSha256)throw Error('export catalog hash mismatch');
  if(!catalog.sequences?.length)throw Error('no recorded sequences');
  const scene=await host.scene.open();const objects=[];let data,images=[],index=0,playing=false,time=0,lastTick=null,finger=4,commonOrigin=true,loading=false,disposed=false,error=null,token=0;
  let status,preview,playButton,sequenceSelect,scrub,fingerSelect,originSelect;
  const read=()=>({source:'saved_camera_samples',inference:'precomputed',sequence:data?.label??null,frame:index,captureId:data?.frames[index]?.captureId??null,timeMs:time,playing,loading,error,finger,commonOrigin,models:data?.models.map(({id,label,checkpointSha256})=>({id,label,checkpointSha256}))??[],displayed:data?.frames[index]?.hands.map(h=>({status:h.status,reason:h.reason??null,fallback:h.fallback??false})),view:scene.readView(),fluid:false});
  const sync=()=>{
   if(status)status.dataset.recordedFrame=String(index);
   if(status)status.textContent=error?error:loading?'Loading recorded sequence…':`${index+1}/${data?.frames.length??0} · ${(time/1000).toFixed(2)} s · recorded timing · ${data?.frames[index]?.hands.map((h,i)=>`${data.models[i].label}: ${h.status}${h.fallback?' (manual fallback crop)':''}`).join(' · ')??''}`;
   if(playButton){playButton.textContent=playing?'Pause':'Play';playButton.disabled=loading||!data;}
   if(scrub){scrub.max=String((data?.frames.length??1)-1);scrub.value=String(index);scrub.disabled=loading;}
  };
  const labelTexture=(text,color='#ffffff')=>{
   const c=document.createElement('canvas');c.width=768;c.height=96;const x=c.getContext('2d');x.fillStyle='#171e29';x.fillRect(0,0,c.width,c.height);x.fillStyle=color;x.font='bold 36px system-ui';x.textAlign='center';x.fillText(text,c.width/2,62);return new CanvasTexture(c);
  };
  const makeObjects=async()=>{
   for(let i=0;i<catalog.models.length;i++){
    const root=new Group();root.position.set((i%2?1:-1)*1.5,i<2?6.5:3,0);root.scale.setScalar(5);
    const mesh=new Mesh(new BufferGeometry(),new MeshNormalMaterial({side:DoubleSide}));root.add(mesh);
    const color=[0x7fd5ff,0xffbd77,0x99efba,0xe1a0ff][i%4];
    const arc=new Line(new BufferGeometry(),new LineBasicMaterial({color,depthTest:false}));root.add(arc);
    const landing=new Mesh(new SphereGeometry(.009,12,8),new MeshBasicMaterial({color,depthTest:false}));root.add(landing);
    const label=new Sprite(new SpriteMaterial({map:labelTexture(catalog.models[i].label),depthTest:false}));label.scale.set(.52,.065,1);label.position.set(0,.28,0);root.add(label);
    root.name=catalog.models[i].label;await scene.attach(root,{owned:true,metadata:{label:root.name,type:'recorded-hand-comparison',source:catalog.models[i]}});
    objects.push({root,mesh,arc,landing,label});
   }
  };
  const draw=()=>{
   if(!data)return;const row=data.frames[index];
   for(let i=0;i<objects.length;i++){
    const o=objects[i],h=row.hands[i];o.mesh.visible=o.arc.visible=o.landing.visible=h.status==='observed';
    if(h.status!=='observed')continue;
    const wrist=h.joints[0],transform=v=>v.map((x,k)=>(x-wrist[k])*(k===1?-1:1));
    const vertices=h.vertices.flatMap(transform);o.mesh.geometry.setAttribute('position',new BufferAttribute(new Float32Array(vertices),3));o.mesh.geometry.setIndex(data.models[i].faces.flat());o.mesh.geometry.computeVertexNormals();o.mesh.geometry.computeBoundingSphere();
    const tipIndex=4*(finger+1),tip=transform(h.joints[tipIndex]),dip=transform(h.joints[tipIndex-1]);
    const direction=tip.map((x,k)=>x-dip[k]);const origin=commonOrigin?[0,0,0]:tip;
    if(Math.hypot(...direction)>1e-10){
     const points=ballisticArc(origin,direction,1,-.30);
     o.arc.geometry.setAttribute('position',new BufferAttribute(new Float32Array(points.flat()),3));o.arc.geometry.computeBoundingSphere();o.landing.position.fromArray(points.at(-1));
    }else{o.arc.visible=o.landing.visible=false;}
   }
   if(preview){preview.src=images[index].src;preview.dataset.captureId=row.captureId;}
   scene.redraw();sync();
  };
  const load=async(value=0)=>{
   const n=Number(value);if(!Number.isInteger(n)||!catalog.sequences[n])throw Error('unknown sequence');
   const ticket=++token;playing=false;loading=true;error=null;sync();
   try{
    const text=await fetchText(catalog.sequences[n].url);
    if(await sha(text)!==catalog.sequences[n].sha256)throw Error('sequence hash mismatch');
    const next=validateReplay(JSON.parse(text),await admission(),catalog.generation);
    if(JSON.stringify(next.models)!==JSON.stringify(catalog.models))throw Error('catalog model identity mismatch');
    const loaded=await Promise.all(next.frames.map(f=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error(`missing source image ${f.captureId}`));img.src=f.image;})));
    validateExport(await admission(),catalog.generation);
    if(disposed||ticket!==token)return read();
    data=next;images=loaded;if(sequenceSelect)sequenceSelect.value=String(n);index=0;time=data.frames[0].timeMs;lastTick=null;draw();record({kind:'hand-replay.load',phase:'applied',effective:read()});
   }catch(e){if(disposed||ticket!==token)return;data=null;images=[];for(const o of objects)o.mesh.visible=o.arc.visible=o.landing.visible=false;if(preview)preview.removeAttribute('src');scene.redraw();error=String(e);throw e;}finally{if(ticket===token){loading=false;sync();}}
   return read();
  };
  const seek=value=>{if(loading||!data)throw Error('sequence unavailable');const n=Number(value);if(!Number.isInteger(n)||n<0||n>=data.frames.length)throw Error('frame out of range');playing=false;index=n;time=data.frames[n].timeMs;draw();return read();};
  const toggle=()=>{if(loading||!data)throw Error('sequence unavailable');if(!playing&&index===data.frames.length-1){index=0;time=data.frames[0].timeMs;draw();}playing=!playing;lastTick=null;sync();return read();};
  const pause=()=>{playing=false;lastTick=null;sync();return read();};
  const frame=()=>scene.setView({position:[0,4.7,12],target:[0,4.7,0]});
  let unsubscribe;
  try{await makeObjects();document.defaultView.kaminosSelection?.clear();frame();await load(0);if(inputs.frame!==undefined)seek(inputs.frame);unsubscribe=scene.onFrame(({timestampMs})=>{
   if(!playing||loading){lastTick=null;return;}if(lastTick===null){lastTick=timestampMs;return;}
   time+=Math.max(0,timestampMs-lastTick);lastTick=timestampMs;const next=frameAtTime(data.frames,time);
   if(time>=data.frames.at(-1).timeMs){time=data.frames.at(-1).timeMs;playing=false;}
   if(next!==index){index=next;draw();}else sync();
  });}catch(e){await scene.dispose();throw e;}
  return {read,operations:{load,seek,toggle,pause,frame,setFinger(value){const n=Number(value);if(!Number.isInteger(n)||n<0||n>4)throw Error('invalid finger');finger=n;draw();return read();},setOrigin(value){if(!['shared','tip'].includes(value))throw Error('invalid origin');commonOrigin=value==='shared';draw();return read();}},
   mount({root,document,invoke}){
    const intro=document.createElement('p');intro.textContent='Same saved motion, precomputed models. Wrist aligned; equal scale. The arc follows the final finger segment at 1 m/s under gravity. Orbit the scene to inspect depth.';
    const limits=document.createElement('p');limits.textContent=catalog.limit;limits.style.fontSize='12px';
    preview=document.createElement('img');preview.alt='Exact recorded camera frame';preview.style.cssText='width:100%;display:block';
    const call=(op,v)=>invoke(op,v).catch(e=>{error=String(e);sync();});
    sequenceSelect=document.createElement('select');sequenceSelect.setAttribute('aria-label','Recording');catalog.sequences.forEach((s,i)=>{const o=document.createElement('option');o.value=i;o.textContent=s.label;sequenceSelect.append(o);});sequenceSelect.onchange=()=>call('load',sequenceSelect.value);
    playButton=document.createElement('button');playButton.onclick=()=>call('toggle');
    scrub=document.createElement('input');scrub.type='range';scrub.min='0';scrub.step='1';scrub.setAttribute('aria-label','Recorded frame');scrub.oninput=()=>call('seek',scrub.value);
    fingerSelect=document.createElement('select');fingerSelect.setAttribute('aria-label','Launch finger');['Thumb','Index','Middle','Ring','Pinky'].forEach((s,i)=>{const o=document.createElement('option');o.value=i;o.textContent=s;fingerSelect.append(o);});fingerSelect.value=String(finger);fingerSelect.onchange=()=>call('setFinger',fingerSelect.value);
    originSelect=document.createElement('select');originSelect.setAttribute('aria-label','Launch origin');for(const [value,text]of [['shared','Shared origin · direction only'],['tip','Fingertip origin · position + direction']]){const o=document.createElement('option');o.value=value;o.textContent=text;originSelect.append(o);}originSelect.onchange=()=>call('setOrigin',originSelect.value);
    const frameButton=document.createElement('button');frameButton.textContent='Frame comparison';frameButton.onclick=()=>call('frame');status=document.createElement('div');status.setAttribute('role','status');status.style.overflowWrap='anywhere';
    root.append(intro,limits,sequenceSelect,preview,playButton,scrub,fingerSelect,originSelect,frameButton,status);draw();sync();
   },async dispose(){disposed=true;token++;playing=false;unsubscribe?.();await scene.dispose();images=[];}
  };
 }
};
