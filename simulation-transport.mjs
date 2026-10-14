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
 const node=document.createElement('section');node.className='simulation-transport';node.setAttribute('aria-label','Simulation playback');
 node.innerHTML=`<style>.simulation-transport{display:flex;align-items:center;gap:5px;flex-wrap:wrap;min-width:0}.simulation-transport button,.simulation-transport select,.simulation-transport input{font:12px system-ui;background:#252c34;color:#e0e8ee;border:1px solid #4b626e;border-radius:4px;padding:6px}.simulation-transport button:disabled{opacity:.45}.simulation-transport input{width:75px}.simulation-transport label{display:flex;align-items:center;gap:4px;margin:0}.simulation-transport output{font:11px monospace}.simulation-transport details{position:relative}.simulation-transport details>div{position:absolute;bottom:28px;right:0;background:#191e24;border:1px solid #4b626e;padding:12px;min-width:250px;z-index:2;display:grid;gap:8px}.simulation-transport [role=alert]{color:#ffb7ac;font:11px system-ui}.simulation-transport .export-help{font:11px/1.5 system-ui;color:#adc3cd}</style>
 <button data-action="replay" title="Restart with current settings; leave paused">↺ Replay</button>
 <button data-action="back" title="Restart and recompute the previous tick with current settings">‹ Step</button>
 <button data-action="play">Play</button><button data-action="step" title="Advance one fixed physics tick">Step ›</button>
 <select data-rate aria-label="Playback speed"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select>
 <span data-rate-meaning></span><select data-cadence aria-label="Playback cadence"><option value="wall_time">Wall-time playback</option><option value="render_cadence">Ticks per drawn frame</option></select>
 <label>Time <input data-time type="number" min="0" step="any" aria-label="Seek simulated seconds"></label><button data-action="seek" title="Pause at nearest physics tick; backwards seeks restart using current settings">Go</button><output></output>
 <details><summary>Render sequence</summary><div><p class="export-help">Export the current view and settings. Water stays paused at the final frame. Choose a folder; a new sequence directory preserves each PNG. Cancel keeps completed frames.</p><label>From <input data-start type="number" min="0" step="any"></label><label>Through <input data-end type="number" min="0" step="any"></label><label>Frames/s <input data-fps type="number" min="0" step="any" value="30"></label><button data-action="export">Choose folder & render</button><button data-action="cancel" disabled>Cancel export</button><span data-progress></span></div></details><span role="alert"></span>`;
 root.append(node);let disposed=false,reading=false,exporting=false,abort=null,errorSource=null;
 const $=q=>node.querySelector(q),error=$('[role=alert]');
 const controls=[...node.querySelectorAll('button,select,input')];
 const lock=()=>{for(const c of controls)c.disabled=transport.state().busy||exporting;$('[data-action=cancel]').disabled=!exporting;if(!exportSequence)$('[data-action=export]').disabled=true;};
 const update=()=>{if(disposed||reading)return;if(transport.state().busy){lock();return;}reading=true;try{const s=transport.read();if(errorSource==='read'){error.textContent='';errorSource=null;}$('[data-action=play]').textContent=s.paused?'▶ Play':'Ⅱ Pause';$('output').textContent=`${(s.step*s.dt).toFixed(4)} s · tick ${s.step}`;if(document.activeElement!==$('[data-time]'))$('[data-time]').value=String(s.step*s.dt);$('select').value=String(s.rate);$('[data-cadence]').hidden=!s.cadence;if(s.cadence)$('[data-cadence]').value=s.cadence;$('[data-rate-meaning]').textContent=s.cadence==='render_cadence'?'ticks / drawn frame':'simulated / wall time';lock();}catch(e){error.textContent=e.message;errorSource='read';}finally{reading=false;}};
 const call=action=>{error.textContent='';errorSource=null;const p=action();lock();Promise.resolve(p).catch(e=>{error.textContent=e.message;errorSource='action';}).finally(update);};
 for(const [name,action]of Object.entries({replay:()=>transport.replay(),back:()=>transport.step(-1),play:()=>transport.toggle(),step:()=>transport.step(1),seek:()=>transport.seek(Number($('[data-time]').value))}))$(`[data-action=${name}]`).onclick=()=>call(action);
 $('select').onchange=()=>call(()=>transport.rate(Number($('select').value)));
 $('[data-cadence]').onchange=()=>call(()=>transport.cadence($('[data-cadence]').value));
 $('details').ontoggle=()=>{if($('details').open){const s=transport.read();if(!s.paused)call(()=>transport.toggle());$('[data-start]').value=String(s.step*s.dt);$('[data-end]').value=String(s.step*s.dt+1);}};
 $('[data-action=cancel]').onclick=()=>{abort?.abort();$('[data-progress]').textContent='Cancelling after the current frame…';};
 $('[data-action=export]').onclick=()=>{
  if(!exportSequence)return;
  const request={startSeconds:Number($('[data-start]').value),endSeconds:Number($('[data-end]').value),fps:Number($('[data-fps]').value)};
  abort=new AbortController();exporting=true;error.textContent='';errorSource=null;lock();
  // The producer's export function opens the picker synchronously in this gesture.
  let task;try{task=exportSequence({request,signal:abort.signal,onProgress:p=>{$('[data-progress]').textContent=`${p.completedFrames}/${p.requestedFrames} frames · ${p.timeSeconds.toFixed(4)} s`;}});}catch(e){task=Promise.reject(e);}
  Promise.resolve(task).then(result=>{$('[data-progress]').textContent=result;}).catch(e=>{error.textContent=e.message;errorSource='action';}).finally(()=>{exporting=false;abort=null;update();});
 };
 update();const timer=setInterval(update,250);
 return {node,update,async dispose(){disposed=true;clearInterval(timer);abort?.abort();await transport.dispose();node.remove();}};
}
