import {createReflectionComparison} from './fluid-reflection-budget.mjs';
import {installRelativeNumberDrag} from './scene-control-history.mjs';

// The adapter owns water, clock, redraw and recording. This component owns
// only the A/B choice and the candidate settings.
export function mountReflectionCockpit(root,{read,apply,setPaused,requestRayStats=()=>{},onOperation=()=>{}}) {
  const document=root.ownerDocument;
  if(!document.getElementById('fluid-reflection-cockpit-style')){
    const style=document.createElement('style');style.id='fluid-reflection-cockpit-style';
    style.textContent='.fluid-reflection-cockpit{padding:12px;border:1px solid #3c636c;border-radius:7px;margin-bottom:12px;color:#dce9ed;font:12px/1.5 system-ui}.fluid-reflection-cockpit h3{margin:0 0 7px;color:#a5e8ec}.fluid-reflection-cockpit .ab{display:flex;gap:7px;margin:8px 0}.fluid-reflection-cockpit button{background:#172d38;border:1px solid #487481;border-radius:5px;color:#e3f4f5;padding:8px;cursor:pointer}.fluid-reflection-cockpit .ab button{flex:1}.fluid-reflection-cockpit button[aria-pressed=true]{background:#27535d;border-color:#a9eeee}.fluid-reflection-cockpit label{display:block;margin:8px 0}.fluid-reflection-cockpit select,.fluid-reflection-cockpit input{box-sizing:border-box;width:100%;margin-top:4px;background:#12252d;color:#e6f4f6;border:1px solid #487481;padding:6px}.fluid-reflection-cockpit .hint{font-size:11px;color:#b2c9cf}.fluid-reflection-cockpit .status{margin-top:8px;color:#b8e6cc}.fluid-reflection-cockpit .error{color:#ffbba4}.fluid-reflection-cockpit .ray-readout{border-top:1px solid #3c636c;margin-top:10px;padding-top:6px;font-size:11px;white-space:pre-line}.fluid-reflection-cockpit .ray-readout input{width:auto;margin:0}.fluid-reflection-cockpit .authoring-number{appearance:textfield;font-variant-numeric:tabular-nums}.fluid-reflection-cockpit .authoring-number::-webkit-inner-spin-button,.fluid-reflection-cockpit .authoring-number::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}.fluid-reflection-cockpit .authoring-number.scrubbing{border-color:#c3a06b}.fluid-reflection-cockpit .authoring-number:focus:not([readonly]){cursor:text!important}';
    document.head.append(style);
  }
  const panel=document.createElement('section');panel.id='fluid-reflection-cockpit';panel.className='fluid-reflection-cockpit';
  const heading=document.createElement('h3');heading.textContent='Reflection A/B';panel.append(heading);
  const help=document.createElement('div');help.className='hint';help.textContent='Switch A/B while water plays, or pause it separately to compare one state.';panel.append(help);
  const buttons=document.createElement('div');buttons.className='ab';
  const a=document.createElement('button'),b=document.createElement('button');a.type=b.type='button';a.textContent='A · Full';b.textContent='B · Candidate';
  a.dataset.reflectionSide='A';b.dataset.reflectionSide='B';buttons.append(a,b);panel.append(buttons);
  const modeLabel=document.createElement('label');modeLabel.textContent='Candidate reflection budget';
  const mode=document.createElement('select');mode.dataset.reflectionControl='mode';mode.setAttribute('aria-label','Candidate reflection budget');
  for(const [value,label] of [['adaptive','Skip weak scene reflections'],['single','One scene ray']]){const option=document.createElement('option');option.value=value;option.textContent=label;mode.append(option);}
  modeLabel.append(mode);panel.append(modeLabel);
  const cutoffLabel=document.createElement('label');cutoffLabel.textContent='Skip scene rays below this reflection weight (%)';
  const cutoff=document.createElement('input');cutoff.type='number';cutoff.min=0;cutoff.max=100;cutoff.step=.1;cutoff.value='4';cutoff.dataset.reflectionControl='cutoff';cutoff.setAttribute('aria-label','Reflection weight cutoff percent');cutoffLabel.append(cutoff);panel.append(cutoffLabel);
  const tradeoff=document.createElement('div');tradeoff.className='hint';tradeoff.textContent='Skipped scene reflections use environment light. Reflected objects can disappear there. Transmission stays the same.';panel.append(tradeoff);
  const freeze=document.createElement('button');freeze.type='button';freeze.dataset.reflectionAction='freeze';panel.append(freeze);
  const status=document.createElement('div');status.className='status';status.setAttribute('role','status');panel.append(status);
  const rayPanel=document.createElement('div');rayPanel.className='ray-readout';
  const rayToggleLabel=document.createElement('label');const rayToggle=document.createElement('input');rayToggle.type='checkbox';rayToggle.checked=true;rayToggle.dataset.reflectionControl='count-rays';rayToggleLabel.append(rayToggle,document.createTextNode(' Live ray counts (1 frame/sec)'));rayPanel.append(rayToggleLabel);
  const rayText=document.createElement('div');rayText.setAttribute('role','status');rayText.dataset.reflectionReadout='rays';rayPanel.append(rayText);panel.append(rayPanel);
  let counting=true;
  let error=null,generation=null;
  const comparison=createReflectionComparison({apply:policy=>{
    if(read().reflection?.status!=='executed_shaded')throw Error('Reflection comparison requires shaded refracted water');
    const receipt=apply(policy);
    onOperation({kind:'fluid.reflection-budget',phase:'applied',target:'fluid',requested:policy,effective:receipt,clock:read().clock});
    return receipt;
  }});
  function update(){
    const current=read();
    if(current.clock?.available && generation!==current.clock.generation){comparison.reset();generation=current.clock.generation;error=null;}
    const state=comparison.read();
    const comparisonAvailable=current.clock?.available && current.reflection?.status==='executed_shaded';
    for(const control of [a,b,mode,cutoff])control.disabled=!comparisonAvailable;
    freeze.disabled=!current.clock?.available;
    const effective=current.reflection?.effective;
    a.setAttribute('aria-pressed',String(effective?.mode==='full'));b.setAttribute('aria-pressed',String(effective?.mode===state.candidate.mode && effective?.fresnelCutoff===Math.fround(state.candidate.fresnelCutoff)));
    mode.value=state.candidate.mode;cutoff.disabled=!comparisonAvailable||mode.value!=='adaptive';if(document.activeElement!==cutoff || cutoff.readOnly)cutoff.value=String(state.candidate.fresnelCutoff*100);
    freeze.textContent=current.clock?.paused?'Play water':'Pause water';
    const policy=effective?.mode==='full'?'Full scene reflections':effective?.mode==='single'?'One scene reflection ray':effective?.mode==='adaptive'?`Environment below ${(effective.fresnelCutoff*100).toFixed(1)}%; full scene reflections above`:'Comparison requires shaded refracted water';
    status.textContent=error||`${current.clock?.paused?`Frozen at step ${current.clock.step}`:'Live water'} · ${policy}`;status.classList.toggle('error',Boolean(error));
    const counts=current.rayStats,sample=counts?.sample;
    const matching=sample && effective && sample.policy.mode===effective.mode && sample.policy.fresnelCutoff===effective.fresnelCutoff;
    if(sample?.waterPixels && matching){
      const line=(label,c)=>`${label} P50 ${c.p50} · P95 ${c.p95} · P99 ${c.p99} · avg ${c.mean.toFixed(2)}`;
      const age=Math.max(0,(performance.now()-sample.measuredAt)/1000).toFixed(1);
      rayText.textContent=`${line('Reflection',sample.reflection)}\n${line('All scene queries',sample.total)}\n${(sample.skippedReflectionFraction*100).toFixed(1)}% skip reflection · ${sample.waterPixels.toLocaleString()} water pixels\nFrame ${sample.frameId}, step ${sample.step} · ${age}s ago${counts.status==='failed'?` · count failed: ${counts.failure}`:counting?' · sampled frame':' · counts held'}`;
    }else if(counts?.status==='failed')rayText.textContent=`Ray count failed: ${counts.failure}`;
    else if(sample && !matching)rayText.textContent='Previous reflection setting · awaiting current ray count';
    else if(sample?.waterPixels===0)rayText.textContent='No visible shaded water pixels in measured frame';
    else rayText.textContent=counts?.status==='unsupported_view'?'Counts require shaded refracted water':'Awaiting a measured water frame';

  }
  const act=fn=>{try{fn();error=null;}catch(e){error=e.message;}update();};
  a.addEventListener('click',()=>act(()=>comparison.select('A')));b.addEventListener('click',()=>act(()=>comparison.select('B')));
  mode.addEventListener('change',()=>act(()=>comparison.configureB({mode:mode.value})));
  let cutoffStart=comparison.read().candidate.fresnelCutoff;
  cutoff.addEventListener('focus',()=>{cutoffStart=comparison.read().candidate.fresnelCutoff;});
  const applyCutoff=()=>act(()=>{if(cutoff.value.trim()==='')throw Error('Enter a reflection cutoff');return comparison.configureB({fresnelCutoff:Number(cutoff.value)/100});});
  cutoff.addEventListener('input',applyCutoff);
  cutoff.addEventListener('change',applyCutoff);
  cutoff.addEventListener('pointercancel',()=>act(()=>{comparison.configureB({fresnelCutoff:cutoffStart});cutoff.value=String(cutoffStart*100);}));
  cutoff.addEventListener('keydown',event=>{if(event.key==='Enter'){applyCutoff();cutoff.blur();}});
  cutoff.addEventListener('blur',()=>{cutoff.value=String(comparison.read().candidate.fresnelCutoff*100);});
  const scrub=installRelativeNumberDrag({input:cutoff,step:.1,onStart:()=>{cutoffStart=comparison.read().candidate.fresnelCutoff;}});
  freeze.addEventListener('click',()=>act(()=>setPaused(!read().clock.paused)));
  const refreshCounts=()=>{
    update();
    if(counting && read().clock?.available && read().reflection?.status==='executed_shaded')Promise.resolve(requestRayStats()).catch(e=>{rayText.textContent=`Ray count failed: ${e.message}`;});
  };
  rayToggle.addEventListener('change',()=>{counting=rayToggle.checked;refreshCounts();});
  const rayTimer=setInterval(refreshCounts,1000);
  root.prepend(panel);update();
  return {node:panel,read:comparison.read,
    select(side){const result=comparison.select(side);error=null;update();return result;},
    configureB(patch){const result=comparison.configureB(patch);error=null;update();return result;},
    update,destroy:()=>{clearInterval(rayTimer);scrub.stop();panel.remove();}};
}
