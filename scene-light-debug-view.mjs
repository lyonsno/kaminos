import * as THREE from './lib/three.webgpu.js';
import {measureSceneGpu} from './scene-light-timing.mjs';

// One JSON session is the interface for interactive and headless consumers.
// History is retained until the caller explicitly leaves/saves the session.
export function mountLightingDebugView({document,renderer,camera,getLighting,getPrototype,drawFrame}){
  const panel=document.getElementById('rendering-light-debug');
  const session={identity:'kaminos-lighting-inspection-session-v1',records:[]};
  let armed=false,busy=false,savedRecords=0;
  const text=document.getElementById('rendering-light-debug-status'),select=document.getElementById('rendering-light-debug-sample'),plot=document.getElementById('rendering-light-debug-plot'),table=document.getElementById('rendering-light-debug-rays');
  const status=message=>{text.textContent=message;};
  const signature=()=>{const d=getLighting()?.debugState();return JSON.stringify({camera:camera.matrixWorld.elements.map(Math.fround),projection:camera.projectionMatrix.elements.map(Math.fround),viewport:[renderer.domElement.width,renderer.domElement.height],matchedCamera:document.getElementById('rendering-match-flame-camera').checked,geometryBuilds:d?.geometryBuilds,spacingRequested:d?.receiverSpacingRequested,sampling:d?.receiverSampling,directions:d?.frame?.directions,pattern:d?.frame?.angularPattern,gain:d?.gain,surfaceGain:d?.surfaceGain,sourceSoftness:d?.sourceSoftness,surfaceReconstruction:d?.surfaceReconstruction,surfaceScattering:d?.surfaceScattering});};
  const measure=async(samples=20)=>{if(busy)return {status:'failed',phase:'admission',error:'lighting inspection/timing already active',records:[]};busy=true;const prototype=getPrototype(),paused=prototype.debugState().selectiveHeadLiveCapturePaused;prototype.setSelectiveHeadLiveCapturePaused(true);try{status(`Measuring ${samples} explicit held-frame scene GPU draws; lighting gather and volume costs are separate.`);const record=await measureSceneGpu(renderer,{samples,getSignature:signature,drawFrame});record.identity='kaminos-scene-gpu-profile-v1';record.capturedAt=new Date().toISOString();record.volumeScheduling='paused-during-explicit-scene-draws';session.records.push(record);status(`${record.status}: Three scene GPU capture; ${record.records.length}/${samples} records. ${record.error||record.reason||''} Save JSON for raw frame identities and timings.`);return record;}finally{prototype.setSelectiveHeadLiveCapturePaused(!!paused);busy=false;}};
  const peak=rgb=>Math.max(...rgb);
  function renderRecord(record){
    select.replaceChildren();table.replaceChildren();plot.replaceChildren();
    if(record.status!=='captured'){status(`Failed during ${record.phase}: ${record.error}. Failure retained in this session.`);return;}
    const meta=record.metadata;
    status(`Held inspection generation ${meta.generation}; ${meta.directions} ${meta.angularPattern} rays; spacing ${meta.receiverSampling.spacing}; ${record.inputs.rows.length} actual sample rows. CPU replay ${record.replay.status}. ${session.records.length-savedRecords} unsaved snapshots. This is not a live contribution overlay.`);
    for(const row of record.inputs.rows){const option=document.createElement('option');option.value=String(row.id);option.textContent=`Receiver ${row.id} · RGB ${row.front.map(x=>x.toPrecision(3)).join('/')} front, ${row.back.map(x=>x.toPrecision(3)).join('/')} back`;select.append(option);}
    const show=()=>{
      table.replaceChildren();plot.replaceChildren();
      const row=record.replay.rows?.find(r=>r.id===Number(select.value));
      if(!row){const p=document.createElement('p');p.textContent=record.replay.reason||'Raw values retained; ray replay unavailable.';table.append(p);return;}
      const max=Math.max(...row.rays.map(r=>peak(r.contribution)),1e-30);
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 440 260');svg.setAttribute('role','img');svg.setAttribute('aria-label','Top view of actual receiver rays through the source box');
      const map=p=>[220+p[0]*85,130+p[2]*55];
      const shape=(tag,attrs)=>{const e=document.createElementNS(svg.namespaceURI,tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,String(v));svg.append(e);return e;};
      shape('rect',{x:135,y:75,width:170,height:110,fill:'#252d31',stroke:'#8c9a9f'});
      const [sx,sy]=map(row.position);
      for(const ray of row.rays){const end=Math.min(ray.firstSolidDistance,ray.span[1]),endpoint=row.position.map((x,a)=>x+ray.direction[a]*end),[x,y]=map(endpoint),strength=Math.sqrt(peak(ray.contribution)/max);
        shape('line',{x1:sx,y1:sy,x2:x,y2:y,stroke:`rgb(${80+175*strength},${100+90*strength},${120-70*strength})`,'stroke-width':1+strength});
        const [px,py]=map(ray.point);shape('circle',{cx:px,cy:py,r:2,fill:'#83a9d5'});
        if(ray.firstSolidDistance<ray.span[1])shape('circle',{cx:x,cy:y,r:3,fill:'#e87472'});
      }
      shape('circle',{cx:sx,cy:sy,r:4,fill:'#9fffb0'});plot.append(svg);
      const caption=document.createElement('p');caption.textContent='Source-local x/z top view. Green: receiver; blue: direction-selecting volume points (not point lights); red: first solid before volume exit. Line strength is captured raw contribution. Full 3D vectors remain in JSON.';plot.append(caption);
      const summary=document.createElement('p');summary.textContent=`CPU/GPU maximum raw RGB error ${row.error.toExponential(3)}. ${meta.surfaceReconstruction.passes?'GPU output includes graph diffusion; direct sum is not parity evidence.':'Raw irradiance is before material response, surface trim and camera display.'}`;table.append(summary);
      const rows=document.createElement('table');const heading=document.createElement('tr');for(const label of ['Ray','Side','First solid','Cosine','Raw RGB contribution']){const th=document.createElement('th');th.textContent=label;heading.append(th);}rows.append(heading);
      for(const ray of row.rays){const tr=document.createElement('tr');for(const value of [ray.a,ray.side,ray.firstSolidDistance>1e19?'none':ray.firstSolidDistance.toPrecision(4),ray.cosine.toFixed(3),ray.contribution.map(x=>x.toPrecision(3)).join(' / ')]){const td=document.createElement('td');td.textContent=String(value);tr.append(td);}rows.append(tr);}table.append(rows);
    };
    select.onchange=show;show();
  }
  async function captureAt(x,y){
    if(busy)throw new Error('lighting inspection already in progress');busy=true;status('Copying one coherent lighting frame; the volume presentation pauses only for readback.');
    try{
      const lighting=getLighting(),rect=renderer.domElement.getBoundingClientRect();
      if(!lighting?.inspectSurface)throw new Error('distributed inspection is not mounted');
      const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(2*(x-rect.left)/rect.width-1,1-2*(y-rect.top)/rect.height),camera);
      const hit=ray.intersectObjects(lighting.inspectionMeshes(),false)[0];if(!hit)throw new Error('no receiving surface at this pixel');
      const record=await lighting.inspectSurface({mesh:hit.object,face:hit.face,point:hit.point,cameraPosition:camera.position});
      record.route=location.href;session.records.push(record);renderRecord(record);return record;
    }catch(error){const record={identity:'kaminos-lighting-inspection-v1',status:'failed',phase:'selection',error:String(error.message||error),capturedAt:new Date().toISOString(),route:location.href};session.records.push(record);renderRecord(record);return record;}
    finally{busy=false;armed=false;}
  }
  const pick=document.getElementById('rendering-light-debug-pick');pick.onclick=()=>{if(busy){status('Finish the current inspection/timing first.');return;}armed=!armed;status(armed?'Click a receiving kiln surface. Geometry and material edits are not performed.':'Surface picking cancelled.');};
  document.getElementById('rendering-light-debug-time').onclick=()=>void measure();
  const pointer=e=>{if(!armed||!renderer.domElement.parentElement.contains(e.target)||e.target.closest('button,input,select,textarea,summary'))return;e.preventDefault();e.stopImmediatePropagation();void captureAt(e.clientX,e.clientY);};
  document.addEventListener('pointerdown',pointer,true);
  document.getElementById('rendering-light-debug-save').onclick=async()=>{
    const contents=JSON.stringify(session);
    if(globalThis.showSaveFilePicker){const file=await showSaveFilePicker({suggestedName:'lighting-debug-session.json',types:[{description:'Lighting inspection JSON',accept:{'application/json':['.json']}}]});const stream=await file.createWritable();await stream.write(contents);await stream.close();}
    else{const url=URL.createObjectURL(new Blob([contents],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='lighting-debug-session.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    savedRecords=session.records.length;status(`Exported ${savedRecords} complete inspection/failure records; all raw source fields and selected GPU inputs included.`);
  };
  const unload=e=>{if(session.records.length>savedRecords){e.preventDefault();e.returnValue='Unsaved lighting inspection snapshots';}};globalThis.addEventListener('beforeunload',unload);
  const api={captureAt,measure,session,renderRecord,dispose(){document.removeEventListener('pointerdown',pointer,true);globalThis.removeEventListener('beforeunload',unload);}};
  window.__kaminosLightingDebug=api;panel.hidden=false;return api;
}
