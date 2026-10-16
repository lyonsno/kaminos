import {installRelativeNumberDrag} from './scene-control-history.mjs';

const installed=new WeakSet();
// Preserve the input and its existing input/change handlers. Cost controls
// commit on release; live controls keep their existing input behavior.
export function installRenderingNumberControl(input,installNumberDrag=installRelativeNumberDrag) {
  if(installed.has(input))return;
  installed.add(input);
  input.type='number';
  let before=input.value;
  input.addEventListener('focus',()=>{before=input.value;});
  input.addEventListener('pointercancel',()=>{
    input.value=before;
    input.dispatchEvent(new input.ownerDocument.defaultView.Event('input',{bubbles:true}));
  });
  return installNumberDrag({input,grip:input,step:Number(input.step)>0?Number(input.step):.001,onStart:()=>{before=input.value;}});
}
export function installRenderingNumberControls(root) {
  for(const input of root.querySelectorAll('input[type="number"],input[type="range"]'))installRenderingNumberControl(input);
}
