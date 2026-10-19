import {mountPlaybackControls} from './playback-controls.mjs';
// Producer operations only. No frame pump, GPU reads or retained state history.
export function createSimulationTransport(adapter){
 let busy=false,disposed=false,closing=false,pending=Promise.resolve();
 const read=()=>{
  if(disposed)throw Error('Simulation transport is disposed');
  const s=adapter.read();
  if(!Number.isSafeInteger(s.step)||s.step<0||!Number.isFinite(s.dt)||s.dt<=0||typeof s.paused!=='boolean')throw Error('Effective fixed clock unavailable');
  return s;
 };
 const run=action=>{
  if(disposed||closing)return Promise.reject(Error('Simulation transport is disposed'));
  if(busy)return Promise.reject(Error('Simulation transport is busy'));
  busy=true;pending=Promise.resolve().then(action).finally(()=>{busy=false;});return pending;
 };
 const seekStep=async target=>{
  await adapter.pause(true);
  if(target<read().step)await adapter.restart();
  await adapter.pause(true);
  if(target>read().step)await adapter.advance(target);
  const s=read();if(s.step!==target||!s.paused)throw Error('Producer did not hold the requested completed step');
  return s;
 };
 return {
  read,state:()=>({busy,disposed}),
  toggle:()=>run(async()=>{await adapter.pause(!read().paused);return read();}),
  rate:value=>run(async()=>{if(!Number.isFinite(value)||value<=0)throw Error('Playback rate must be finite and positive');await adapter.rate(value);return read();}),
  cadence:value=>run(async()=>{if(!adapter.cadence)throw Error('Playback cadence capability unavailable');await adapter.cadence(value);return read();}),
  step:direction=>run(()=>{if(![-1,1].includes(direction))throw Error('Step direction must be -1 or 1');return seekStep(Math.max(0,read().step+direction));}),
  seek:seconds=>run(()=>{if(!Number.isFinite(seconds)||seconds<0)throw Error('Seek requires nonnegative simulated seconds');const n=Math.round(seconds/read().dt);if(!Number.isSafeInteger(n))throw Error('Target tick is not representable');return seekStep(n);}),
  replay:()=>run(async()=>{await adapter.pause(true);await adapter.restart();await adapter.pause(true);return read();}),
  exclusive:action=>run(action),
  async dispose(){closing=true;await pending.catch(()=>{});disposed=true;},
 };
}


export function mountSimulationTransport({document,root,transport,exportSequence=null}){
 const make=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 const extra=make('details'),body=make('div');extra.append(make('summary','Render sequence'),body);
 const start=make('input'),end=make('input'),fps=make('input'),render=make('button','Choose folder & render'),cancel=make('button','Cancel'),progress=make('div');
 for(const [name,input,value] of [['From (s)',start,0],['Through (s)',end,1],['Frames/s',fps,30]]){const label=make('label',name);input.type='number';input.min='0';input.step='any';input.value=String(value);label.append(input);body.append(label);}
 body.append(make('p','Export the current view and settings. Cancel preserves completed frames; the simulation remains paused.'),render,cancel,progress);
 extra.hidden=!exportSequence;let exporting=false,abort=null,disposed=false;
 const controls=mountPlaybackControls({document,root,label:'Simulation playback',extra,
  read(){const s=transport.read();return {playing:!s.paused,time:s.step*s.dt,duration:null,stepSeconds:s.dt,rate:s.rate,busy:transport.state().busy||exporting};},
  async invoke(name,input){
   if(name==='replay'){await transport.replay();return transport.toggle();}
   if(name==='play'||name==='pause'){const s=transport.read();return s.paused===(name==='play')?transport.toggle():s;}
   if(name==='step')return transport.step(input.direction);
   if(name==='seek')return transport.seek(input.seconds);
   if(name==='rate')return transport.rate(input.rate);
   throw Error('Unknown simulation playback operation: '+name);
  }});
 cancel.disabled=true;cancel.onclick=()=>abort?.abort();
 extra.ontoggle=()=>{if(extra.open){const s=transport.read();if(!s.paused)transport.toggle().then(controls.update,e=>{progress.textContent=e.message;});start.value=String(s.step*s.dt);end.value=String(s.step*s.dt+1);}};
 render.onclick=()=>{
  if(!exportSequence||exporting||disposed)return;
  const request={startSeconds:Number(start.value),endSeconds:Number(end.value),fps:Number(fps.value)};
  abort=new AbortController();exporting=true;render.disabled=true;cancel.disabled=false;controls.update();
  let task;try{task=exportSequence({request,signal:abort.signal,onProgress:p=>{if(!disposed)progress.textContent=p.completedFrames+'/'+p.requestedFrames+' frames · '+p.timeSeconds.toFixed(4)+' s';}});}catch(e){task=Promise.reject(e);}
  Promise.resolve(task).then(result=>{if(!disposed)progress.textContent=String(result);},e=>{if(!disposed)progress.textContent=e.message;}).finally(()=>{exporting=false;abort=null;if(!disposed){render.disabled=false;cancel.disabled=true;controls.update();}});
 };
 const timer=setInterval(controls.update,250);
 return {node:controls.node,update:controls.update,async dispose(){disposed=true;clearInterval(timer);abort?.abort();controls.dispose();await transport.dispose();}};
}
