import { beginContinuousPointer } from './continuous-pointer.mjs';
const valueKeys = new Set(['ArrowDown','ArrowLeft','ArrowRight','ArrowUp','End','Home','PageDown','PageUp',' ']);

/** Existing control handlers own live updates; the shared session owns their gesture. */
export function installSceneControlHistory({controls, edits, id, label='Edit control', onError=()=>{}}) {
  let owner=null;
  const listeners=[];
  const active=()=>owner && edits.state().active?.id===id;
  const add=(control,type,listener,options)=>{
    control.addEventListener(type,listener,options);
    listeners.push(()=>control.removeEventListener(type,listener,options));
  };
  function cancel() {
    if (!active()) {owner=null;return false;}
    owner=null;
    try {return edits.cancel();} catch(error){onError(error);return false;}
  }
  function commit() {
    if (!active()) {owner=null;return false;}
    owner=null;
    try {return edits.commit();} catch(error){edits.cancel();onError(error);return false;}
  }
  function capture(event) {
    if(active() && owner!==event.currentTarget) commit();
    if(active()) return true;
    try {edits.begin(id,label);owner=event.currentTarget;return true;}
    catch(error){event.preventDefault?.();onError(error);return false;}
  }
  for(const control of controls) {
    add(control,'pointerdown',event=>{if(event.button===undefined||event.button===0) capture(event);},true);
    add(control,'focusin',capture,true);
    add(control,'beforeinput',capture,true);
    add(control,'keydown',event=>{
      if(event.key==='Escape'){if(owner===event.currentTarget){event.preventDefault();cancel();}return;}
      if(event.key==='Enter'){commit();control.blur?.();return;}
      if(valueKeys.has(event.key))capture(event);
    },true);
    add(control,'change',event=>{if(owner===event.currentTarget)commit();});
    add(control,'blur',event=>{if(owner===event.currentTarget)commit();});
    add(control,'pointercancel',event=>{if(owner===event.currentTarget)cancel();});
    add(control,'keyup',event=>{if(owner===event.currentTarget&&valueKeys.has(event.key)&&control.type==='range')commit();});
  }
  return {commit,cancel,state:()=>({pending:!!active(),id:active()?id:null}),dispose(){cancel();listeners.splice(0).forEach(remove=>remove());}};
}

export function formatAuthoringNumber(value) {
  const number=Number(value);
  return value!=='' && Number.isFinite(number) ? String(Number(number.toPrecision(3))) : String(value);
}

// Formatting is an overlay: the actual input value, editing and saved precision
// remain untouched. Observe native value assignment so undo/selection refreshes
// the presentation without another model or polling loop.
function installNumberPresentation(input) {
  const doc=input.ownerDocument;
  const descriptor=doc?.defaultView?.HTMLInputElement && Object.getOwnPropertyDescriptor(doc.defaultView.HTMLInputElement.prototype,'value');
  if(!descriptor || !input.parentNode)return;
  const wrapper=doc.createElement('span');wrapper.className='authoring-number-wrap';
  const display=doc.createElement('span');display.className='authoring-number-display';display.setAttribute('aria-hidden','true');
  input.before(wrapper);wrapper.append(input,display);
  const update=()=>{display.textContent=formatAuthoringNumber(descriptor.get.call(input));};
  Object.defineProperty(input,'value',{configurable:true,get(){return descriptor.get.call(this);},set(value){descriptor.set.call(this,value);update();}});
  input.addEventListener('input',update);input.addEventListener('change',update);update();
}

/** One field: relative dragging while idle, ordinary text editing after a click. */
export function installRelativeNumberDrag({grip,input,step,onStart=()=>{},onEnd=()=>{}}) {
  let gesture=null, suppressClick=false;
  const doc=input.ownerDocument || document;
  const targets=[...new Set([grip,input].filter(Boolean))];
  input.readOnly=true;
  input.classList?.add('authoring-number');
  installNumberPresentation(input);
  input.title='Drag to adjust · Click to type · Shift for fine · Esc to cancel';
  input.addEventListener('focus',()=>{if(!gesture)input.readOnly=false;}); // Tab preserves normal keyboard editing.
  input.addEventListener('blur',()=>{if(gesture)finish(true);input.readOnly=true;});
  function releaseGesture() {
    if(!gesture)return null;
    const ended=gesture;gesture=null;ended.continuous?.stop();
    if(ended.target.hasPointerCapture?.(ended.pointerId))ended.target.releasePointerCapture(ended.pointerId);
    input.classList?.remove('scrubbing');
    return ended;
  }
  function finish(cancel=false) {
    const ended=releaseGesture();if(!ended)return;
    if(cancel) {input.dispatchEvent(new Event('pointercancel'));suppressClick=true;}
    else if(ended.moved) {input.dispatchEvent(new Event('change',{bubbles:true}));suppressClick=true;input.readOnly=true;input.blur?.();}
    else {input.readOnly=false;input.focus?.();input.select?.();}
    onEnd();
  }
  function adjust(dx,fine) {
    if(!gesture)return;
    gesture.moved=true;gesture.value+=dx*step*(fine?.1:1);
    let value=step>=1?Math.round(gesture.value):gesture.value;
    if(input.min!==undefined && input.min!=='')value=Math.max(Number(input.min),value);
    if(input.max!==undefined && input.max!=='')value=Math.min(Number(input.max),value);
    input.classList?.add('scrubbing');input.value=String(value);
    input.dispatchEvent(new Event('input',{bubbles:true}));
  }
  doc.addEventListener('mouseup',event=>{if(gesture?.continuous?.locked && event.button===0)finish();});
  for(const target of targets) {
    target.style.cursor='ew-resize';target.style.touchAction='none';
    target.addEventListener('click',event=>{
      if(suppressClick){event.preventDefault();suppressClick=false;return;}
      if(target!==input){event.preventDefault();input.readOnly=false;input.focus?.();input.select?.();}
    });
    target.addEventListener('pointerdown',event=>{
      if(event.button!==0 || gesture || input.disabled)return;
      if(target===input && doc.activeElement===input && !input.readOnly)return;
      event.preventDefault();onStart();suppressClick=false;
      input.dispatchEvent(new Event('focusin'));
      gesture={target,x:event.clientX,lastX:event.clientX,startValue:Number(input.value),value:Number(input.value),pointerId:event.pointerId,moved:false};
      target.setPointerCapture(event.pointerId);
      gesture.continuous=beginContinuousPointer(target,{x:event.clientX,y:event.clientY},{move:({dx,event})=>adjust(dx,event.shiftKey),lost:()=>finish(true),unavailable:()=>{input.title='Continuous pointer unavailable · Drag to adjust · Click to type';}});
    });
    target.addEventListener('pointermove',event=>{
      if(!gesture || gesture.continuous?.locked || gesture.target!==target || (event.pointerId!==undefined && event.pointerId!==gesture.pointerId))return;
      if(!gesture.moved && Math.abs(event.clientX-gesture.x)<3)return;
      const dx=event.clientX-gesture.lastX;gesture.lastX=event.clientX;gesture.moved=true;
      adjust(dx,event.shiftKey);
      gesture?.continuous.request({x:event.clientX,y:event.clientY});
    });
    target.addEventListener('pointerup',()=>{if(gesture?.target===target)finish();});
    target.addEventListener('pointercancel',()=>{if(gesture?.target===target)finish(true);});
    target.addEventListener('lostpointercapture',()=>{if(gesture?.target===target && !gesture.continuous?.locked)finish(true);});
  }
  window.addEventListener('blur',()=>finish(true));
  document.addEventListener('keydown',event=>{if(!gesture && doc.activeElement===input && event.key==='Escape'){event.preventDefault();input.dispatchEvent(new Event('pointercancel'));input.blur?.();return;}if(gesture&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();finish(true);}},true);
  // The transaction owner can finish via Escape/Enter/selection before our
  // document listener runs. Release pointer ownership without emitting a second
  // transaction-ending event back into that owner.
  return {stop(){if(releaseGesture()){suppressClick=true;input.readOnly=true;onEnd();}}};
}
