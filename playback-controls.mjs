// Shared presentation only. Owners keep their clock, seek law and scheduler.
// read(): {playing,time,duration:null|seconds,stepSeconds,rate,busy?,canSeek?,canStep?}
// invoke(): replay/play/pause/seek({seconds})/step({direction})/rate({rate}).
export function mountPlaybackControls({document,root,read,invoke,extra=null,label='Playback'}) {
 if(!document||!root||typeof read!=='function'||typeof invoke!=='function')throw Error('Playback requires an owner read, operations and a mount');
 const make=(tag,text,attributes={})=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;for(const [k,v]of Object.entries(attributes))n.setAttribute(k,v);return n;};
 const node=make('section',undefined,{'aria-label':label});node.className='playback-controls';
 const style=make('style');style.textContent=`
 .playback-controls{box-sizing:border-box;display:grid;grid-template-columns:max-content minmax(100px,1fr) max-content;grid-template-rows:40px;align-items:center;gap:10px;width:100%;min-width:0;padding:4px 10px;background:#202529;color:#dfe8eb;font:12px system-ui}
 .playback-controls[hidden]{display:none}.playback-actions,.playback-timeline,.playback-options{display:flex;align-items:center;gap:5px;min-width:0;flex-wrap:nowrap}
 .playback-controls button,.playback-controls select,.playback-controls input[type=number]{font:inherit;background:#2c3439;color:inherit;border:1px solid #54636b;border-radius:5px;padding:6px 8px;white-space:nowrap}
 .playback-controls button:disabled,.playback-controls select:disabled{opacity:.45}.playback-controls .playback-replay{background:#365d66;border-color:#71a1ad;font-weight:600}
 .playback-controls .playback-play{width:76px}.playback-controls input[type=range]{flex:1 1 0;width:0;min-width:30px;margin:0;accent-color:#7fc6d6;touch-action:none}
 .playback-controls output{font:11px ui-monospace,monospace;font-variant-numeric:tabular-nums;width:17ch;flex:0 0 17ch;white-space:nowrap;overflow:hidden;text-align:right}
 .playback-controls details{position:relative}.playback-controls summary{cursor:pointer;padding:7px;white-space:nowrap}.playback-controls .playback-more{position:absolute;bottom:36px;right:0;background:#202529;padding:12px;border:1px solid #54636b;border-radius:6px;min-width:230px;display:grid;gap:9px;z-index:40}
 .playback-controls .playback-error:empty{display:none}.playback-controls .playback-error{position:absolute;bottom:52px;left:10px;right:10px;padding:8px;background:#462b2b;color:#ffd6d0;white-space:normal;font:12px system-ui;z-index:40}
 .playback-controls .playback-seek{display:flex;gap:6px;align-items:center}.playback-controls input[type=number]{width:95px}
 @media(max-width:850px){.playback-controls{gap:6px;padding-inline:6px}.playback-controls .playback-step{display:none}.playback-controls output{width:12ch;flex-basis:12ch}}
 @media(max-width:520px){.playback-controls{grid-template-columns:max-content 1fr;grid-template-rows:40px 30px}.playback-timeline{grid-column:1/-1;grid-row:2}.playback-options{justify-self:end}.playback-controls .playback-error{bottom:82px}}
 `;
 const actions=make('div');actions.className='playback-actions';
 const button=(text,title,cls='')=>{const n=make('button',text,{type:'button',title});n.className=cls;return n;};
 const replay=button('↻ Replay','Start over and play','playback-replay'),play=button('▶ Play','Play or pause','playback-play');
 const back=button('‹','Previous frame or simulation tick','playback-step'),forward=button('›','Next frame or simulation tick','playback-step');
 back.setAttribute('aria-label','Previous step');forward.setAttribute('aria-label','Next step');actions.append(replay,play,back,forward);
 const track=make('div');track.className='playback-timeline';
 const timeline=make('input',undefined,{type:'range',min:0,step:'any','aria-label':'Playback position'}),time=make('output');track.append(timeline,time);
 const options=make('div');options.className='playback-options';
 const rate=make('select',undefined,{'aria-label':'Playback speed'});
 for(const value of [.25,.5,1,2,4]){const o=make('option',value+'×',{value});o.value=String(value);rate.append(o);}
 const details=make('details'),summary=make('summary','More'),more=make('div');more.className='playback-more';
 const seek=make('label','Time (seconds)');seek.className='playback-seek';
 const seconds=make('input',undefined,{type:'number',min:0,step:'any','aria-label':'Seek time in seconds'}),go=button('Go','Pause at this time');seek.append(seconds,go);more.append(seek);
 if(extra)more.append(extra);details.append(summary,more);options.append(rate,details);
 const error=make('div',undefined,{role:'alert'});error.className='playback-error';error.textContent='';
 node.append(style,actions,track,options,error);root.append(node);
 let disposed=false,working=0,scrubbing=false,pendingSeek=null,seekTask=null;
 const buttons=[replay,play,back,forward,rate,go];
 const state=()=>{
  const s=read();if(!s||typeof s.playing!=='boolean'||!Number.isFinite(s.time)||s.time<0||!Number.isFinite(s.rate)||s.rate<=0||(s.duration!=null&&(!Number.isFinite(s.duration)||s.duration<0)))throw Error('Effective playback clock is unavailable');return s;
 };
 const showError=e=>{error.textContent=e.message||String(e);};
 function update(){
  if(disposed)return;
  try{
   const s=state();
   replay.disabled=play.disabled=rate.disabled=Boolean(s.busy||working);
   back.disabled=forward.disabled=Boolean(s.busy||working||s.canStep===false);
   timeline.disabled=go.disabled=Boolean(s.busy||s.canSeek===false);
   timeline.hidden=s.duration==null||s.canSeek===false;
   timeline.max=String(s.duration??0);timeline.step=String(s.stepSeconds>0?s.stepSeconds:'any');
   if(!scrubbing&&!seekTask)timeline.value=String(Math.min(s.time,s.duration??s.time));
   if(document.activeElement!==seconds)seconds.value=String(s.time);
   play.textContent=s.playing?'Ⅱ Pause':'▶ Play';
   time.textContent=s.duration==null?`${s.time.toFixed(2)} s`:`${s.time.toFixed(2)} / ${s.duration.toFixed(2)} s`;
   // Preserve owner rates outside the visual presets without rounding them.
   if(!Array.from(rate.children).some(o=>o.value===String(s.rate))){const o=make('option',s.rate+'×',{value:s.rate});o.value=String(s.rate);rate.append(o);}
   rate.value=String(s.rate);
  }catch(e){showError(e);for(const c of [...buttons,timeline])c.disabled=true;}
 }
 async function call(name,input){
  if(disposed)return;working++;error.textContent='';update();
  try{return await invoke(name,input);}catch(e){showError(e);}finally{working--;update();}
 }
 // Pointer previews may supersede earlier unstarted previews, never producer
 // operations already in flight. The final requested position is always held.
 function seekTo(value){
  if(disposed)return Promise.resolve();
  const target=Number(value);if(!Number.isFinite(target)||target<0){showError(Error('Seek time must be finite and nonnegative'));return Promise.resolve();}
  pendingSeek=target;
  if(!seekTask)seekTask=(async()=>{
   working++;error.textContent='';
   try{
    await invoke('pause');
    while(pendingSeek!==null&&!disposed){const target=pendingSeek;pendingSeek=null;await invoke('seek',{seconds:target});}
   }catch(e){pendingSeek=null;showError(e);}finally{working--;seekTask=null;update();}
  })();
  return seekTask;
 }
 replay.onclick=()=>call('replay');play.onclick=()=>{try{return call(state().playing?'pause':'play');}catch(e){showError(e);return Promise.resolve();}};
 back.onclick=()=>call('step',{direction:-1});forward.onclick=()=>call('step',{direction:1});
 rate.onchange=()=>call('rate',{rate:Number(rate.value)});go.onclick=()=>seekTo(seconds.value);
 timeline.onpointerdown=e=>{scrubbing=true;timeline.setPointerCapture?.(e.pointerId);};
 timeline.oninput=()=>seekTo(timeline.value);
 timeline.onpointerup=e=>{scrubbing=false;timeline.releasePointerCapture?.(e.pointerId);return seekTo(timeline.value);};
 timeline.onpointercancel=()=>{scrubbing=false;update();};
 update();
 return {node,elements:{replay,play,back,forward,timeline,time,rate,seconds,go,error,details,more},update,dispose(){disposed=true;pendingSeek=null;node.remove();}};
}
