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

/** Drag a field label relatively; keep the number itself available for ordinary typing. */
export function installRelativeNumberDrag({grip,input,step,onStart=()=>{},onEnd=()=>{}}) {
  let drag=null;
  grip.style.cursor='ew-resize';grip.style.touchAction='none';
  grip.title='Drag to adjust · Shift for fine · Esc to cancel';
  grip.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    event.preventDefault();onStart();
    input.dispatchEvent(new Event('focusin'));
    drag={x:event.clientX,value:Number(input.value),pointerId:event.pointerId};
    grip.setPointerCapture(event.pointerId);
  });
  grip.addEventListener('pointermove',event=>{
    if(!drag)return;
    const delta=(event.clientX-drag.x)*step*(event.shiftKey?.1:1);
    input.value=String(drag.value+delta);
    input.dispatchEvent(new Event('input',{bubbles:true}));
  });
  function finish(cancel=false) {
    if(!drag)return;
    if(grip.hasPointerCapture(drag.pointerId))grip.releasePointerCapture(drag.pointerId);
    if(cancel)input.dispatchEvent(new Event('pointercancel'));
    else input.dispatchEvent(new Event('change',{bubbles:true}));
    drag=null;onEnd();
  }
  grip.addEventListener('pointerup',()=>finish());
  grip.addEventListener('pointercancel',()=>finish(true));
  window.addEventListener('blur',()=>finish(true));
  document.addEventListener('keydown',event=>{if(drag&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();finish(true);}},true);
}
