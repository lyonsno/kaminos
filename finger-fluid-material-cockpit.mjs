import {materialControlsURL} from './finger-fluid-material-controls.mjs';

const fields=[
  ['particleRepulsionStrength','Particle repulsion',0,2,.01,null],
  ['densityIterations','Density passes',1,6,1,null],
  ['capillaryStrength','Surface cohesion',0,2,.01,2],
  ['freeFlightViscosityBoost','Flight smoothing boost',0,.3,.01,.3],
];

export function mountMaterialCockpit(root,{id,read,apply,getPaused,setPaused,captureCamera,restoreCamera,onReplay}={}) {
  if(!root)return null;
  const document=root.ownerDocument;
  if(!document.getElementById('fluid-material-cockpit-style')){
    const style=document.createElement('style');style.id='fluid-material-cockpit-style';
    style.textContent=`.fluid-material-cockpit{padding:10px 0;border-bottom:1px solid #34505c;margin-bottom:10px;color:#d8e7e8;font:11px/1.5 'SF Mono',monospace}.fluid-material-cockpit h3{font-size:12px;color:#8adce2;margin:0 0 6px}.fluid-material-row{display:grid;grid-template-columns:minmax(115px,1fr) minmax(75px,1fr) 65px;gap:7px;align-items:center;margin:7px 0}.fluid-material-row input{min-width:0;width:100%;box-sizing:border-box}.fluid-material-row input[type=number]{background:#101e26;color:#eef7f8;border:1px solid #38586a;border-radius:4px;padding:4px}.fluid-material-row input[type=range]{accent-color:#83d7df}.fluid-material-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.fluid-material-actions button{color:#d7edef;background:#192b35;border:1px solid #416272;border-radius:4px;padding:5px 8px;cursor:pointer}.fluid-material-hint{font-size:10px;color:#a9bec5}.fluid-material-status{margin-top:5px;font-size:10px;color:#9bddb3}.fluid-material-error{color:#ffbe9b}.fluid-material-recipe{width:100%;box-sizing:border-box;margin-top:6px;background:#111e24;color:#d8e7e8;border:1px solid #38586a;padding:5px}`;
    document.head.append(style);
  }
  const panel=document.createElement('section');panel.className='fluid-material-cockpit';panel.id=id;
  const title=document.createElement('h3');title.textContent='Live fluid tuning';panel.append(title);
  const hint=document.createElement('div');hint.className='fluid-material-hint';
  hint.textContent='Repulsion: 0 = off, 1 = previous strength. Changes keep the current water and view.';panel.append(hint);
  const controls=new Map();
  for(const [key,label,min,max,step,limit] of fields){
    const row=document.createElement('div');row.className='fluid-material-row';
    const text=document.createElement('label');text.textContent=label;text.htmlFor=`${id}-${key}-number`;
    const slider=document.createElement('input');slider.type='range';slider.min=min;slider.max=max;slider.step=step;
    slider.id=`${id}-${key}`;slider.dataset.fluidControl=key;slider.setAttribute('aria-label',label);
    const number=document.createElement('input');number.type='number';number.min=min;number.step=step;
    if(limit!==null)number.max=limit;number.id=text.htmlFor;number.setAttribute('aria-label',`${label} value`);
    row.append(text,slider,number);panel.append(row);controls.set(key,{slider,number,max});
    for(const input of [slider,number])input.addEventListener('input',()=>{
      if(input.value.trim()==='')return;
      try{
        const receipt=apply({[key]:Number(input.value)});
        if(!receipt?.available||!receipt.effective||receipt.generation!==receipt.effectiveGeneration)throw Error('Water has not applied this control');
        const next=materialControlsURL(location.href,receipt.effective);
        history.replaceState(history.state,'',next);
        error=null;refresh();
      }catch(e){error=e.message;refresh(true);}
    });
  }
  const actions=document.createElement('div');actions.className='fluid-material-actions';
  const pause=document.createElement('button');pause.type='button';pause.textContent='Pause';pause.dataset.fluidAction='pause';
  pause.addEventListener('click',()=>{try{setPaused(!getPaused());error=null;refresh(true);}catch(e){error=e.message;refresh(true);}});
  const replay=document.createElement('button');replay.type='button';replay.textContent='Replay water';replay.dataset.fluidAction='replay';
  const cameraKey=`fluid-tuning-camera:${id}:${location.pathname}:${location.hash}:${new URL(location.href).searchParams.get('finger_fluid_truth_scene')||'authored'}`;
  replay.addEventListener('click',()=>{
    try{
      const state=read();if(!state?.effective)throw Error('Water is not mounted');
      const view=captureCamera?.();if(view)sessionStorage.setItem(cameraKey,JSON.stringify(view));
      const url=materialControlsURL(location.href,state.effective);
      if(onReplay)onReplay(url);else location.assign(url);
    }catch(e){error=e.message;refresh(true);}
  });
  const copy=document.createElement('button');copy.type='button';copy.textContent='Copy settings link';copy.dataset.fluidAction='copy';
  const recipe=document.createElement('input');recipe.className='fluid-material-recipe';recipe.readOnly=true;recipe.hidden=true;recipe.setAttribute('aria-label','Fluid settings link');
  copy.addEventListener('click',async()=>{
    try{const state=read();recipe.value=materialControlsURL(location.href,state.effective);recipe.hidden=false;
      if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(recipe.value);else {recipe.focus();recipe.select();}
    }catch(e){error=e.message;refresh(true);}
  });
  actions.append(pause,replay,copy);panel.append(actions,recipe);
  const status=document.createElement('div');status.className='fluid-material-status';status.setAttribute('role','status');panel.append(status);
  root.prepend(panel);
  let error=null,restored=false;
  function refresh(force=false){
    const state=read(),active=state?.available&&state.effective;
    for(const {slider,number} of controls.values()){slider.disabled=!active;number.disabled=!active;}
    pause.disabled=replay.disabled=copy.disabled=!active;
    if(!active){status.textContent=error||'Waiting for water…';status.classList.toggle('fluid-material-error',!!error);return;}
    if(!restored){const saved=sessionStorage.getItem(cameraKey);if(saved){restoreCamera?.(JSON.parse(saved));sessionStorage.removeItem(cameraKey);}restored=true;}
    for(const [key,{slider,number,max}] of controls){
      const value=state.effective[key];slider.max=Math.max(max,value);
      if(force||document.activeElement!==slider)slider.value=value;
      if(force||document.activeElement!==number)number.value=value;
    }
    pause.textContent=getPaused()?'Resume':'Pause';pause.setAttribute('aria-pressed',String(getPaused()));
    status.textContent=error||`${getPaused()?'Paused':'Live'} · ${state.particleCount.toLocaleString()} particles · ${state.effective.densityIterations} density ${state.effective.densityIterations===1?'pass':'passes'}`;
    status.classList.toggle('fluid-material-error',!!error);
  }
  refresh();const timer=setInterval(()=>{try{refresh();}catch(e){error=e.message;status.textContent=error;status.classList.add('fluid-material-error');}},250);
  return {refresh,destroy(){clearInterval(timer);panel.remove();}};
}
