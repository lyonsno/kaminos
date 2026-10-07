// Reuse the controls' live setters; the shared scene ledger owns transactions.
export function createLightingControlTarget(controls) {
  controls=[...controls];
  const read=()=>Object.fromEntries(controls.map(control=>[control.id,
    control.type==='checkbox'?control.checked:control.tagName==='SELECT'||control.type==='color'?control.value:Number(control.value)]));
  function check(state) {
    if(!state || controls.some(control=>!Object.hasOwn(state,control.id)))throw Error('Incomplete lighting snapshot');
    const next={};
    for(const control of controls) {
      const value=state[control.id];
      if(control.type==='checkbox') {
        if(typeof value!=='boolean')throw Error(`Invalid ${control.id}`);
      } else if(control.tagName==='SELECT') {
        if(![...control.options].some(option=>option.value===value))throw Error(`Invalid ${control.id}`);
      } else if(control.type==='color') {
        if(!/^#[0-9a-f]{6}$/i.test(value))throw Error(`Invalid ${control.id}`);
      } else if(!Number.isFinite(value)||(control.min!==''&&value<Number(control.min))||(control.max!==''&&value>Number(control.max)))throw Error(`Invalid ${control.id}`);
      next[control.id]=value;
    }
    return next;
  }
  function write(state) {
    const next=check(state);
    for(const control of controls) {
      if(control.type==='checkbox')control.checked=next[control.id];else control.value=String(next[control.id]);
      control.dispatchEvent(new Event(control.tagName==='SELECT'||control.type==='checkbox'?'change':'input',{bubbles:true}));
      if(control.type==='number')control.dispatchEvent(new Event('change',{bubbles:true}));
    }
  }
  return {controls,read,write,check};
}
