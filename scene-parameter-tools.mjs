// UI adapters over the same authored history used by object placement.
export function installParameterTools({edits, descriptors, report = () => {}}) {
  let active=null;
  const bindings=new Map();
  const steal=e=>{e.preventDefault();e.stopImmediatePropagation();};
  function sync(binding) {
    const value=binding.read();
    for(const input of binding.inputs) {
      if(input.type==='range'){input.min=Math.min(Number(input.min),value);input.max=Math.max(Number(input.max),value);}
      if(document.activeElement!==input || !active)input.value=String(value);
    }
  }
  function finish(commit) {
    const owner=active;if(!owner)return;
    active=null;
    if(edits.state().active?.id===owner.binding.id) {
      try{commit?edits.commit():edits.cancel();}catch(error){edits.cancel();report(error.message);}
    }
    if(owner.capture?.hasPointerCapture(owner.pointerId))owner.capture.releasePointerCapture(owner.pointerId);
    sync(owner.binding);
  }
  function begin(binding) {
    if(active && edits.state().active?.id!==active.binding.id){const old=active;active=null;sync(old.binding);}
    if(active?.binding===binding)return true;
    finish(true);
    try{edits.begin(binding.id,binding.label);active={binding};return true;}catch(error){report(error.message);sync(binding);return false;}
  }
  function preview(binding,value) {
    if(!Number.isFinite(value))return;
    if(!begin(binding))return;
    try{edits.preview({value});report(`${binding.label} · Enter confirm · Esc cancel`);}
    catch(error){report(error.message);sync(binding);}
  }
  for(const descriptor of descriptors) {
    const binding={...descriptor,id:'@'+descriptor.id};bindings.set(binding.id,binding);
    edits.register(binding.id,{
      read:()=>({value:binding.read()}),
      check:state=>{if(!Number.isFinite(state.value))throw Error('Enter a finite number');binding.validate?.(state.value);return {value:state.value};},
      write:state=>{binding.write(state.value);sync(binding);},
    });
    for(const input of binding.inputs) {
      input.dataset.authoredParameter=descriptor.id;
      input.step='any';
      input.addEventListener('pointerdown',e=>{if(e.button===0 && input.type==='range' && !begin(binding))steal(e);},true);
      input.addEventListener('keydown',e=>{
        if(e.key==='Escape'){steal(e);finish(false);input.blur();return;}
        if(e.key==='Enter'){steal(e);finish(true);input.blur();return;}
        if(!e.ctrlKey&&!e.metaKey&&!e.altKey && (e.key.length===1 || ['Backspace','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(e.key)))begin(binding);
      },true);
      input.addEventListener('beforeinput',()=>begin(binding),true);
      input.addEventListener('input',e=>{if(!e.isTrusted){binding.adopt?.();return;}e.stopImmediatePropagation();if(input.value.trim())preview(binding,input.valueAsNumber);},true);
      input.addEventListener('change',e=>{if(!e.isTrusted)return;e.stopImmediatePropagation();finish(true);},true);
      input.addEventListener('blur',()=>{if(active?.binding===binding&&!active.capture)finish(true);});
      input.addEventListener('pointercancel',()=>finish(false));
    }
    const grip=binding.grip;
    if(grip) {
      grip.title='Drag to adjust · Shift for precision · click number to type';grip.style.cursor='ew-resize';grip.style.touchAction='none';
      grip.addEventListener('pointerdown',e=>{
        if(e.button!==0)return;steal(e);if(!begin(binding))return;
        Object.assign(active,{capture:grip,pointerId:e.pointerId,x:e.clientX,value:binding.read()});grip.setPointerCapture(e.pointerId);
      });
      grip.addEventListener('pointermove',e=>{
        if(active?.capture!==grip)return;
        const amount=(e.clientX-active.x)*binding.step*(e.shiftKey?.1:1);
        const value=active.value+amount;
        preview(binding,binding.integer?Math.round(value):Number(value.toPrecision(12)));
      });
      grip.addEventListener('pointerup',()=>{if(active?.capture===grip)finish(true);});
      for(const type of ['pointercancel','lostpointercapture'])grip.addEventListener(type,()=>{if(active?.capture===grip)finish(false);});
      grip.addEventListener('click',e=>e.preventDefault());
    }
    sync(binding);
  }
  edits.subscribe(state=>{
    if(active && state.active?.id!==active.binding.id){const old=active;active=null;if(old.capture?.hasPointerCapture(old.pointerId))old.capture.releasePointerCapture(old.pointerId);sync(old.binding);}
  });
  document.addEventListener('keydown',e=>{if(active?.capture && ['Escape','Enter'].includes(e.key)){steal(e);finish(e.key==='Enter');}},true);
  window.addEventListener('blur',()=>finish(false));
  return {finish,sync:()=>{for(const binding of bindings.values()){binding.adopt?.();sync(binding);}},
    discard(ids){const targets=new Set([...ids].map(id=>'@'+id));return edits.discard(entry=>targets.has(entry.id));},
    set(id,value){const binding=bindings.get('@'+id);if(!binding)throw Error(`Unknown authored parameter: ${id}`);edits.apply(binding.id,{value},binding.label);},
    state:()=>Object.fromEntries([...bindings.values()].map(b=>[b.id.slice(1),b.read()]))};
}
