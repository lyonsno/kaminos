import {installRelativeNumberDrag} from './scene-control-history.mjs';

const installed=new WeakSet();
// Preserve the input and its existing input/change handlers. Cost controls
// commit on release; live controls keep their existing input behavior.
export function installRenderingNumberControl(input,installNumberDrag=installRelativeNumberDrag) {
  if(installed.has(input))return;
  installed.add(input);
  const wasRange=input.type==='range';
  input.type='number';
  let before=input.value,lastValid=input.value,dragging=false;
  const bound=value=>value!=='' && Number.isFinite(Number(value))?Number(value):null;
  const valid=()=>{
    const value=bound(input.value),min=bound(input.min),max=bound(input.max),step=Number(input.step);
    if(value===null || (min!==null && value<min) || (max!==null && value>max))return false;
    if(wasRange && step>0){const units=(value-(min??0))/step;if(Math.abs(units-Math.round(units))>1e-7)return false;}
    return true;
  };
  // Capture before the existing live handlers: number inputs permit incomplete
  // text and step mismatches that native ranges never emitted.
  input.addEventListener('input',event=>{
    if(wasRange && dragging){
      const min=bound(input.min),max=bound(input.max),step=Number(input.step),base=min??0;
      if(step>0){
        let units=Math.round((Number(input.value)-base)/step);
        if(max!==null)units=Math.min(units,Math.floor((max-base)/step+1e-7));
        if(min!==null)units=Math.max(0,units);
        input.value=String(Number((base+units*step).toPrecision(12)));
      }
    }
    if(!valid()){event.stopImmediatePropagation();return;}
    lastValid=input.value;
  },true);
  const finishEdit=event=>{if(!valid()){input.value=lastValid;event.stopImmediatePropagation();}};
  input.addEventListener('change',finishEdit,true);
  input.addEventListener('blur',finishEdit,true);
  input.addEventListener('focus',()=>{before=input.value;if(valid())lastValid=input.value;});
  input.addEventListener('pointercancel',()=>{
    input.value=before;
    input.dispatchEvent(new input.ownerDocument.defaultView.Event('input',{bubbles:true}));
  });
  return installNumberDrag({input,grip:input,step:Number(input.step)>0?Number(input.step):.001,onStart:()=>{before=input.value;if(valid())lastValid=input.value;dragging=true;},onEnd:()=>{dragging=false;}});
}
export function installRenderingNumberControls(root) {
  for(const input of root.querySelectorAll('input[type="number"],input[type="range"]')) {
    // GI already owns a scrub tied to its edit-history transaction. A second
    // drag listener would survive that owner's stop/cancel subscription.
    if(input.closest?.('#scene-gi-controls, #scene-bloom-controls'))continue;
    installRenderingNumberControl(input);
  }
}
