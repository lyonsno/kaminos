import {createTrellisVoxelVisual} from './trellis-voxel-view.mjs';
import {mountPlaybackControls} from './playback-controls.mjs';
import {VOXEL_HISTORY_SCHEMA,voxelFrameFromPreview,validateVoxelHistory,readVoxelHistoryFrame,trellisHistoryUrl,coordinatesBase64} from './models/trellis2/voxel-history.js';

export async function createAuthoringTrellisHistory({renderer,scene,foreground,document,fetcher=fetch,changed=()=>{}}){
 if(renderer?.backend?.isWebGPUBackend!==true||!foreground?.request)throw Error('TRELLIS history needs the app WebGPU renderer and foreground service');
 const session=await scene.open(),records=new Map(),mounts=new Set();let liveRunId=null,current=null,playing=false,time=0,rate=1,visible=false,savedView=null,epoch=0,navigation=0,disposed=false;
 const device=renderer.backend.device;
 const post=async body=>{const r=await fetcher('/api/trellis-history',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Error(v.error||'History save failed');return v;};
 const summary=()=>({liveRunId,runId:current?.runId??null,label:current?.label??null,visible,playing,time,rate,frames:current?.frames.map(f=>({id:f.id,stage:f.stage,step:f.step,steps:f.steps,state:f.state,count:f.count,atSeconds:f.atSeconds}))??[],
  gaps:current?.gaps??[],status:current?.status??'idle',error:current?.error??null,retention:current?{pending:current.pending,saved:current.saved,failed:current.failed}:null,
  presentation:current?.selected?.visual?.read()??null,clock:current?.source.clock??null});
 const publish=()=>{for(const m of mounts)m.update();try{changed(summary());}catch(e){console.warn(e);}};
 const duration=()=>current?.frames.at(-1)?.atSeconds??0;
 const readPlayback=()=>({playing,time,duration:duration(),stepSeconds:null,rate,busy:false,canSeek:!!current?.frames.length,canStep:!!current?.frames.length});
 async function present(frame){
  if(!current||!frame)return;const owner=current,ticket=++epoch;
  let item=owner.items.get(frame.id);
  if(!item){const coordinates=await readVoxelHistoryFrame({frame,fetcher});if(disposed||ticket!==epoch||owner!==current)return;
   const visual=createTrellisVoxelVisual({renderer,frame,coordinates});const receipt=await session.attach(visual.root,{owned:true,presentation:true,metadata:{source:trellisHistoryUrl(owner.runId),label:owner.label}});
   item={visual,receipt};owner.items.set(frame.id,item);
  }
  if(disposed||ticket!==epoch||owner!==current)return;
  if(owner.selected)owner.selected.visual.root.visible=false;
  owner.selected=item;item.visual.root.visible=visible;session.redraw();publish();
 }
 async function seek(seconds){
  if(!Number.isFinite(seconds)||seconds<0)throw Error('History position must be finite and nonnegative');
  time=Math.min(seconds,duration());const frame=current?.frames.findLast(f=>f.atSeconds<=time)??current?.frames[0];await present(frame);publish();return summary();
 }
 const close=()=>{navigation++;epoch++;playing=false;visible=false;if(current?.selected)current.selected.visual.root.visible=false;if(savedView){session.setView(savedView);savedView=null;}session.redraw();publish();return summary();};
 const frameView=()=>{if(!savedView)savedView=session.readView();session.setView({position:[1.2,.85,1.6],target:[0,0,0],near:.005,far:100});};
 async function show(record){
  playing=false;if(current?.selected)current.selected.visual.root.visible=false;current=record;visible=true;
  frameView();time=0;await seek(0);publish();return summary();
 }
 const operations={
  async replay(){await seek(0);playing=current?.frames.length>1;publish();return summary();},
  play(){playing=!!current?.frames.length;publish();return summary();},pause(){playing=false;publish();return summary();},
  seek({seconds}){playing=false;return seek(seconds);},
  step({direction}){playing=false;const index=Math.max(0,current?.frames.findLastIndex(f=>f.atSeconds<=time)??0);const i=Math.max(0,Math.min((current?.frames.length??1)-1,index+Math.sign(direction)));return seek(current?.frames[i]?.atSeconds??0);},
  rate({rate:value}){if(!Number.isFinite(value)||value<=0)throw Error('Positive replay rate required');rate=value;publish();return summary();},
  frame(){frameView();return summary();},close,
  async retrySaving(){
   const owner=current;if(!owner)return summary();
   await Promise.all([...owner.unsaved.values()].map(async entry=>{owner.pending++;publish();try{await persist(owner,entry);}catch(error){entry.error=error.message;}finally{owner.pending--;syncRetention(owner);publish();}}));
   if(owner.outcome!=='capturing')await finishHistory(owner);return summary();
  },
 };
 const unsubscribe=session.onFrame(({deltaSeconds})=>{if(!playing)return;const next=Math.min(duration(),time+deltaSeconds*rate);if(next===duration())playing=false;seek(next).catch(error=>{playing=false;current.error=error.message;publish();});});
 function newRecord({runId,label,source,status='capturing',frames=[],gaps=[],error=null}){
  const record={runId,label,source,status,outcome:status,frames:[...frames],gaps:[...gaps],items:new Map(),unsaved:new Map(),local:false,pending:0,saved:frames.length,failed:gaps.length,error,retainedError:error,terminalError:null,selected:null,tasks:[],started:performance.now()};records.set(runId,record);return record;
 }
 function syncRetention(owner){
  owner.failed=owner.gaps.length+owner.unsaved.size+(owner.terminalError?1:0);
  owner.error=[...owner.unsaved.values()].find(e=>e.error)?.error??owner.terminalError??owner.retainedError??owner.gaps.at(-1)?.reason??null;
  owner.status=owner.outcome==='completed'&&(owner.failed||!owner.saved)?'incomplete':owner.outcome;
 }
 async function persist(owner,entry){
  const {frame,visual}=entry;
  // Display uses the retained GPU buffer. CPU rows exist only for durable history
  // and remain owned here after a failed save, so retry never needs inference.
  if(!entry.coordinates){
   const staging=device.createBuffer({size:Math.max(4,frame.count*12),usage:9});
   try{
    if(frame.count){const read=foreground.request({requestId:'trellis-history-save:'+crypto.randomUUID(),metadata:{operation:'explicit-history-retention-readback',bytes:frame.count*12},run(lease){const e=device.createCommandEncoder();e.copyBufferToBuffer(visual.buffer(),0,staging,0,frame.count*12);lease.submit([e.finish()]);return {encoded:true};}});
     const r=await read.completion;if(!r.result?.encoded)throw Error('History retention copy was not admitted');await staging.mapAsync(1,0,frame.count*12);entry.coordinates=new Int32Array(staging.getMappedRange(0,frame.count*12).slice(0));staging.unmap();
    }else entry.coordinates=new Int32Array();
   }finally{staging.destroy();}
  }
  const response=await post({schema:VOXEL_HISTORY_SCHEMA,runId:owner.runId,label:owner.label,source:owner.source,frame,coordinatesBase64:coordinatesBase64(entry.coordinates)});
  if(response.runId!==owner.runId||response.frameId!==frame.id)throw Error('Stored history frame identity differs');owner.saved++;owner.unsaved.delete(frame.id);syncRetention(owner);
 }
 async function finishHistory(owner){
  owner.terminalError=null;syncRetention(owner);
  try{await post({schema:VOXEL_HISTORY_SCHEMA,runId:owner.runId,label:owner.label,source:owner.source,status:owner.status,error:owner.error,gaps:owner.gaps});}catch(error){owner.terminalError=error.message;}
  syncRetention(owner);publish();return summary();
 }
 function markGap(owner,frame,error){owner.gaps.push({id:frame.id,stage:frame.stage,step:frame.step,reason:error.message});syncRetention(owner);publish();}
 function observe(task,owner,frame){owner.pending++;owner.tasks.push(task.catch(error=>markGap(owner,frame,error)).finally(()=>{owner.pending--;publish();}));}
 const api={read:summary,operations,
  start({runId,label,source}){if(records.has(runId))throw Error('TRELLIS history run already exists');const actual={kind:'live-generation',clock:'elapsed-generation-seconds',...source};if(!['live-generation','retained-reference-replay'].includes(actual.kind))throw Error('Explicit TRELLIS history source required');liveRunId=runId;newRecord({runId,label,source:actual}).local=true;publish();return summary();},
  capture(preview){
   const owner=records.get(preview.runId);if(!owner||preview.runId!==liveRunId)throw Error('Preview does not belong to the current live TRELLIS run');
   if(preview.device!==device)throw Error('Preview device differs from the app renderer');
   const frame=voxelFrameFromPreview(preview,{atSeconds:(performance.now()-owner.started)/1000});let visual,receipt;
   // Request an ordinary admitted opportunity, without awaiting it in inference.
   // The lifetime check and retaining-copy submission share one synchronous turn.
   const handle=foreground.request({requestId:'trellis-history-copy:'+crypto.randomUUID(),metadata:{runId:preview.runId,frameId:frame.id},run(lease){
    if(disposed||!preview.isCurrent())return {copied:false,reason:'Source support retired before preview copy admission'};
    visual=createTrellisVoxelVisual({renderer,frame});const encoder=device.createCommandEncoder({label:'TRELLIS resident preview retention'});
    if(frame.count)encoder.copyBufferToBuffer(preview.coordinates.buffer,preview.coordinates.bufferOffset??0,visual.buffer(),0,frame.count*12);
    lease.submit([encoder.finish()],{metadata:{operation:'retain-trellis-voxel-preview',bytes:frame.count*12}});return {copied:true};
   }});
   const task=(async()=>{
    const delivered=await handle.completion;if(!delivered.result?.copied)throw Error(delivered.result?.reason||delivered.failure?.error?.message||'Preview copy opportunity failed');
    receipt=await session.attach(visual.root,{owned:true,presentation:true,metadata:{source:trellisHistoryUrl(owner.runId),label:owner.label}});
    owner.items.set(frame.id,{visual,receipt});owner.frames.push(frame);owner.frames.sort((a,b)=>a.atSeconds-b.atSeconds);
    if(current===owner&&visible){time=frame.atSeconds;await present(frame);}publish();
    const entry={frame,visual,coordinates:null,error:null};owner.unsaved.set(frame.id,entry);
    try{await persist(owner,entry);}catch(error){entry.error=error.message;syncRetention(owner);publish();}
   })().catch(error=>{if(visual&&!receipt)visual.dispose();throw error;});
   observe(task,owner,frame);return undefined;
  },
  finish(runId,status='completed'){
   const owner=records.get(runId);if(!owner)return Promise.resolve(null);owner.outcome=status;syncRetention(owner);publish();
   // This completion is deliberately separate from the model and asset result.
   return Promise.all(owner.tasks).then(()=>finishHistory(owner));
  },
  async open({runId,assetSource=null}){
   const ticket=++navigation;
   visible=false;if(current?.selected)current.selected.visual.root.visible=false;session.redraw();publish();
   let record=records.get(runId);
   if(!record?.local){const r=await fetcher(trellisHistoryUrl(runId),{cache:'no-store'});const value=await r.json();if(disposed||ticket!==navigation)return summary();if(!r.ok)throw Error(value.error||'Retained history unavailable');validateVoxelHistory(value,runId);
    if(record){for(const frame of value.frames){const previous=record.frames.find(f=>f.id===frame.id);if(previous&&previous.coordinates.sha256!==frame.coordinates.sha256)throw Error('Retained history frame changed');}
     Object.assign(record,{frames:[...value.frames],gaps:[...(value.gaps??[])],status:value.status,outcome:value.status,error:value.error??null,retainedError:value.error??null,saved:value.frames.length,failed:value.gaps?.length??0});
    }else record=newRecord(value);
   }
   record.assetSource=assetSource;return show(record);
  },
  watch(){navigation++;const record=records.get(liveRunId);if(!record)throw Error('No TRELLIS run to watch');return show(record);},
  mount({root}){
   const pane=document.createElement('section');pane.className='trellis-history-view';pane.hidden=true;pane.setAttribute('aria-label','TRELLIS generation history');
   const style=document.createElement('style');style.textContent='.trellis-history-view{box-sizing:border-box;min-width:0;max-width:100%;padding:8px}.trellis-history-view p{white-space:normal;overflow-wrap:anywhere;line-height:1.45}.trellis-history-view>select{width:100%;max-width:100%;margin-bottom:8px}.trellis-history-view .playback-controls{grid-template-columns:1fr;grid-template-rows:auto;gap:8px;padding:8px 0}.trellis-history-view .playback-actions{grid-column:1;grid-row:1;flex-wrap:wrap}.trellis-history-view .playback-timeline{grid-column:1;grid-row:2}.trellis-history-view .playback-options{grid-column:1;grid-row:3;justify-self:start}.trellis-history-view .playback-controls output{width:12ch;flex-basis:12ch}.trellis-history-view .playback-more{left:0;right:auto}';pane.append(style);
   const title=document.createElement('strong'),status=document.createElement('p'),select=document.createElement('select');select.setAttribute('aria-label','TRELLIS snapshot');
   const frameButton=document.createElement('button');frameButton.textContent='Frame voxels';frameButton.type='button';frameButton.onclick=()=>operations.frame();
   const closeButton=document.createElement('button');closeButton.textContent='Close history';closeButton.type='button';closeButton.onclick=close;
   const retryButton=document.createElement('button');retryButton.textContent='Retry saving history';retryButton.type='button';retryButton.onclick=()=>operations.retrySaving();
   pane.append(title,status,select,frameButton,closeButton,retryButton);root.append(pane);
   const playback=mountPlaybackControls({document,root:pane,read:readPlayback,invoke:(name,input)=>operations[name](input),label:'TRELLIS snapshot replay'});
   let optionKey='';const m={update(){pane.hidden=!visible;title.textContent=current?.label??'TRELLIS history';
    const list=current?.frames??[],selected=list.findLast(f=>f.atSeconds<=time)??list[0];
    const terminal={completed:'Completed',failed:'Failed',stopped:'Stopped',incomplete:'History incomplete'}[current?.status];
    status.textContent=(current?.source.kind==='retained-reference-replay'?'Reference replay · ':'Live generation · ')+(terminal?terminal+' · ':'')+
     (selected?`Step ${selected.step} of ${selected.steps} · ${selected.count.toLocaleString()} occupied voxels`:current?.pending?'Snapshot capture pending':terminal?'No snapshots retained':'Waiting for the first occupied grid')+
     (current?.source.clock==='presentation-sequence'?' · Timeline spacing is for playback':'')+(current?.error?` · ${current.error}`:current?.pending?' · Saving history…':'');
    const key=JSON.stringify(list.map(f=>[f.id,f.count]));if(key!==optionKey){optionKey=key;select.replaceChildren(...list.map((f,i)=>{const n=document.createElement('option');n.value=String(i);n.textContent=`${i+1}. ${f.state==='predicted-clean'?'Predicted shape':f.stage==='cascade-support'?'Refined occupied volume':'Completed coarse shape'} · step ${f.step}/${f.steps}`;return n;}));}
    retryButton.hidden=!current?.local||(!current.unsaved.size&&!current.terminalError);retryButton.disabled=!!current?.pending;
    if(selected)select.value=String(list.indexOf(selected));select.disabled=!list.length;playback.update();},dispose(){mounts.delete(m);playback.dispose();pane.remove();}};
   select.onchange=()=>operations.seek({seconds:current.frames[Number(select.value)].atSeconds}).catch(e=>{current.error=e.message;publish();});mounts.add(m);m.update();return m;
  },
  async dispose(){if(disposed)return;disposed=true;unsubscribe();close();for(const m of [...mounts])m.dispose();await Promise.all([...records.values()].flatMap(r=>r.tasks));await session.dispose();for(const r of records.values())for(const i of r.items.values())i.visual.dispose();records.clear();},
 };
 return api;
}
