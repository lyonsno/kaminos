import {HAND_MODELS} from './hand-input-state.mjs';

export function mountHandInput({document,input,before}) {
  const root=document.createElement('div');root.className='hand-input';
  root.innerHTML=`<button type="button" class="hand-input-power" aria-label="Enable hand tracking" aria-pressed="false" title="Toggle hand tracking"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12V5a1.5 1.5 0 0 1 3 0v6-8a1.5 1.5 0 0 1 3 0v8-6a1.5 1.5 0 0 1 3 0v8-4a1.5 1.5 0 0 1 3 0v7c0 4-2 6-6 6-3 0-5-1-7-4l-3-4c-1-2 1-3 2-2l2 2Z"/></svg></button>
    <button type="button" class="hand-input-menu" aria-haspopup="dialog" aria-expanded="false" title="Hand input settings">Hands <span class="hand-input-model"></span><span aria-hidden="true">⌄</span></button>
    <div class="hand-input-popover" role="dialog" aria-label="Hand input" hidden>
      <div class="hand-input-heading">Hands</div>
      <div class="hand-input-models" role="group" aria-label="Reconstruction model"></div>
      <label class="hand-input-side"><span>Left hand</span><small data-side="left">Off</small><input type="checkbox" data-auto="left" aria-label="Automatically track left hand when present"></label>
      <label class="hand-input-side"><span>Right hand</span><small data-side="right">Off</small><input type="checkbox" data-auto="right" aria-label="Automatically track right hand when present"></label>
      <p class="hand-input-hint">Acquire automatically when present</p><div class="hand-input-status" role="status"></div>
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
  const unsubscribe=input.subscribe(state=>{
    power.setAttribute('aria-pressed',String(state.enabled));root.dataset.phase=state.phase;
    power.setAttribute('aria-label',state.enabled?'Disable hand tracking':'Enable hand tracking');
    root.querySelector('.hand-input-model').textContent=state.enabled?HAND_MODELS[state.model]:'';
    for(const button of models.children)button.setAttribute('aria-pressed',String(button.dataset.model===state.model));
    for(const control of root.querySelectorAll('[data-auto]')){
      const side=control.dataset.auto;control.checked=state.auto[side];
      const tracked=state.last?.hands.some(hand=>hand.handedness===side);
      root.querySelector(`[data-side="${side}"]`).textContent=!state.enabled||!state.auto[side]?'Off':tracked?'Tracking':'Waiting';
    }
    status.textContent=state.error??(state.phase==='loading'?`Loading ${HAND_MODELS[state.model]}…`:state.enabled?(state.effectiveModel==='wilor'?'WiLoR · MLX Metal':'MobRecon · WebGPU'):'Tracking is off');
    status.dataset.error=String(!!state.error);
  });
  return {open:()=>open(true),close:()=>open(false),dispose(){unsubscribe();document.removeEventListener('pointerdown',outside);root.remove();}};
}
