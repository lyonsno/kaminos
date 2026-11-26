import {HAND_MODELS} from './hand-input-state.mjs';

const STEP_LABELS = {
  'finishing-previous':'Closing previous model',
  checking:'Checking setup', 'camera-permission':'Waiting for camera', 'camera-start':'Starting camera',
  gpu:'Connecting to GPU', package:'Reading package', weights:'Reading weights',
  'preparing-weights':'Preparing weights', building:'Building model', topology:'Reading mesh',
  finishing:'Finishing setup', 'native-start':'Starting WiLoR', 'native-imports':'Starting MLX',
  'native-pose':'Loading WiLoR weights', 'native-detector':'Loading detector',
  'native-check':'Checking files', 'native-topology':'Reading mesh',
};
const seconds=ms=>`${(ms/1000).toFixed(1)}s`;
const setText=(node,next)=>{if(node.textContent!==next)node.textContent=next;};

export function mountHandInput({document,input,before}) {
  const root=document.createElement('div');root.className='hand-input';
  root.innerHTML=`<button type="button" class="hand-input-power" aria-label="Enable hand tracking" aria-pressed="false" title="Toggle hand tracking"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12V5a1.5 1.5 0 0 1 3 0v6-8a1.5 1.5 0 0 1 3 0v8-6a1.5 1.5 0 0 1 3 0v8-4a1.5 1.5 0 0 1 3 0v7c0 4-2 6-6 6-3 0-5-1-7-4l-3-4c-1-2 1-3 2-2l2 2Z"/></svg></button>
    <button type="button" class="hand-input-menu" aria-haspopup="dialog" aria-expanded="false" title="Hand input settings">Hands <span class="hand-input-model"></span><span class="hand-input-elapsed" aria-hidden="true"></span><span aria-hidden="true">⌄</span></button>
    <progress class="hand-input-load" aria-label="Hand model loading progress" hidden></progress>
    <div class="hand-input-popover" role="dialog" aria-label="Hand input" hidden>
      <div class="hand-input-heading">Hands</div>
      <div class="hand-input-models" role="group" aria-label="Reconstruction model"></div>
      <label class="hand-input-side"><span>Left hand</span><small data-side="left">Off</small><input type="checkbox" data-auto="left" aria-label="Automatically track left hand when present"></label>
      <label class="hand-input-side"><span>Right hand</span><small data-side="right">Off</small><input type="checkbox" data-auto="right" aria-label="Automatically track right hand when present"></label>
      <p class="hand-input-hint">Acquire automatically when present</p><div class="hand-input-status"></div><span class="hand-input-announcement" role="status"></span>
    </div>`;
  before.before(root);
  const power=root.querySelector('.hand-input-power'),menu=root.querySelector('.hand-input-menu'),popover=root.querySelector('.hand-input-popover');
  const status=root.querySelector('.hand-input-status'),models=root.querySelector('.hand-input-models');
  const handle=promise=>promise.catch(()=>{});
  power.onclick=()=>handle(input.setEnabled(!input.read().enabled));
  const open=value=>{popover.hidden=!value;menu.setAttribute('aria-expanded',String(value));};
  menu.onclick=()=>open(popover.hidden);
  for(const [key,label] of Object.entries(HAND_MODELS)){
    const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.model=key;
    button.onclick=()=>handle(input.setModel(key));models.append(button);
  }
  for(const control of root.querySelectorAll('[data-auto]'))control.onchange=()=>handle(input.setAuto(control.dataset.auto,control.checked));
  const outside=event=>{if(!root.contains(event.target))open(false);};
  const escape=event=>{if(event.key==='Escape'&&!popover.hidden){open(false);menu.focus();event.stopPropagation();}};
  document.addEventListener('pointerdown',outside);root.addEventListener('keydown',escape);
  const label=root.querySelector('.hand-input-model'),elapsed=root.querySelector('.hand-input-elapsed');
  const meter=root.querySelector('.hand-input-load'),announcement=root.querySelector('.hand-input-announcement');
  const win=document.defaultView;
  let tick=null;
  function renderLoad(){
    tick=null;
    const state=input.read(),load=state.loading;
    if(!load)return;
    const step=STEP_LABELS[load.phase]??'Loading';
    const component=load.component==='hand-detector'?'Detector':load.component==='mobrecon'?'Mesh':null;
    const percent=load.progressRatio===null?null:`${Math.floor(load.progressRatio*100)}%`;
    const waiting=load.stalled&&load.phase!=='camera-permission';
    const progressLabel=component??(load.phase==='native-check'?'Files':step);
    const headline=percent?`${progressLabel} ${percent}`:step;
    setText(label,waiting?`${headline} · No update`:headline);
    setText(elapsed,seconds(load.elapsedMs));
    root.dataset.silent=String(waiting);
    const estimate=load.estimatedMs===null?null:`~${seconds(load.estimatedMs)} left`;
    const lag=waiting?`No update for ${seconds(load.silentMs)}`:null;
    setText(status,[component,step,percent,estimate,lag].filter(Boolean).join(' · '));
    setText(announcement,[component,step,lag?'No recent update':null].filter(Boolean).join(' · '));
    if(load.progressRatio===null){if(meter.hasAttribute('value'))meter.removeAttribute('value');}
    else if(!meter.hasAttribute('value')||meter.value!==load.progressRatio)meter.value=load.progressRatio;
    tick=win.requestAnimationFrame(renderLoad);
  }
  const unsubscribe=input.subscribe(state=>{
    power.setAttribute('aria-pressed',String(state.enabled));root.dataset.phase=state.phase;
    power.setAttribute('aria-label',state.enabled?'Disable hand tracking':'Enable hand tracking');
    meter.hidden=!state.loading;
    if(state.loading){if(tick===null)renderLoad();}
    else{
      if(tick!==null)win.cancelAnimationFrame(tick);
      tick=null;root.dataset.silent='false';
      setText(label,state.enabled?HAND_MODELS[state.model]:'');
      setText(elapsed,'');
      const summary=state.error??(state.enabled
        ?state.lastLoad?`Loaded in ${seconds(state.lastLoad.durationMs)}`:'Tracking enabled'
        :'Tracking is off');
      setText(status,summary);
      setText(announcement,summary);
    }
    for(const button of models.children)button.setAttribute('aria-pressed',String(button.dataset.model===state.model));
    for(const control of root.querySelectorAll('[data-auto]')){
      const side=control.dataset.auto;control.checked=state.auto[side];
      const tracked=state.last?.hands.some(hand=>hand.handedness===side);
      root.querySelector(`[data-side="${side}"]`).textContent=!state.auto[side]?'Off':!state.enabled||state.loading?'Armed':tracked?'Tracking':'Waiting';
    }
    status.dataset.error=String(!!state.error);
  });
  return {open:()=>open(true),close:()=>open(false),dispose(){unsubscribe();if(tick!==null)win.cancelAnimationFrame(tick);document.removeEventListener('pointerdown',outside);root.remove();}};
}
