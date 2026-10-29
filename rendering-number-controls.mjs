import {installRelativeNumberDrag} from './scene-control-history.mjs';

const installed=new WeakSet();
let errorSerial=0;
// Preserve the input and its existing input/change handlers. Cost controls
// commit on release; live controls keep their existing input behavior.
export function installRenderingNumberControl(input,installNumberDrag=installRelativeNumberDrag) {
  if(installed.has(input))return;
  installed.add(input);
  const errorHost=input.closest?.('label')??input.closest?.('.field')??input.parentElement;
  const errorOutput=input.ownerDocument?.createElement&&errorHost?.append?input.ownerDocument.createElement('span'):null;
  if(errorOutput){errorOutput.className='rendering-number-error';errorOutput.id=`rendering-number-error-${++errorSerial}`;errorOutput.setAttribute('role','alert');errorOutput.hidden=true;Object.assign(errorOutput.style,{color:'#efaaa0',fontSize:'12px',gridColumn:'1 / -1'});errorHost.append(errorOutput);input.setAttribute('aria-describedby',[input.getAttribute('aria-describedby'),errorOutput.id].filter(Boolean).join(' '));}
  const wasRange=input.type==='range';
  input.type='number';
  let before=input.value,lastValid=input.value,dragging=false;
  const bound=value=>value!=='' && Number.isFinite(Number(value))?Number(value):null;
  const invalidReason=()=>{
    const value=bound(input.value),min=bound(input.min),max=bound(input.max),step=Number(input.step);
    if(value===null)return 'Enter a finite number.';
    if(min!==null&&value<min)return `Enter ${min} or more.`;
    if(max!==null&&value>max)return `Enter ${max} or less.`;
    if(wasRange&&step>0){const units=(value-(min??0))/step;if(Math.abs(units-Math.round(units))>1e-7)return `Use increments of ${step} from ${min??0}.`;}
    return '';
  };
  const valid=()=>!invalidReason();
  const feedback=message=>{if(errorOutput){errorOutput.textContent=message;errorOutput.hidden=!message;}input.setCustomValidity?.(message);if(message)input.setAttribute?.('aria-invalid','true');else input.removeAttribute?.('aria-invalid');};
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
    lastValid=input.value;feedback('');
  },true);
  const finishEdit=event=>{const reason=invalidReason();if(reason){const rejected=input.value;input.value=lastValid;feedback(`${reason} Kept ${lastValid}; rejected “${rejected}”.`);input.reportValidity?.();event.stopImmediatePropagation();}};
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
    if(input.closest?.('#scene-gi-controls'))continue;
    installRenderingNumberControl(input);
  }
}
