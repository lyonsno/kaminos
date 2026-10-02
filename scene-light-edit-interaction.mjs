// Defer geometry preparation during an input transaction, not flame rendering.
// Capture listeners start before ordinary authoring handlers mutate geometry.
export function bindSceneLightEditInteraction({document,window,getLighting}) {
  const held=new Set(),listeners=[];
  const input=e=>e.target?.matches?.('input[type="range"],input[type="number"],[data-transform-field]');
  const set=(key,active)=>{
    if(active)held.add(key);else held.delete(key);
    getLighting()?.setEditing(key,active);
  };
  const on=(target,name,fn)=>{target.addEventListener(name,fn,true);listeners.push(()=>target.removeEventListener(name,fn,true));};
  on(document,'pointerdown',e=>{if(input(e))set(`input-pointer:${e.pointerId}`,true);});
  for(const event of ['pointerup','pointercancel'])on(window,event,e=>set(`input-pointer:${e.pointerId}`,false));
  on(document,'keydown',e=>{if(input(e)&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End'].includes(e.key))set(`input-key:${e.key}`,true);});
  on(window,'keyup',e=>set(`input-key:${e.key}`,false));
  // Typed/programmatic input events without a held pointer/key end on commit.
  on(document,'input',e=>{if(input(e)&&!held.size)set(e.target,true);});
  for(const event of ['change','focusout'])on(document,event,e=>{if(input(e))set(e.target,false);});
  on(window,'blur',()=>{for(const key of [...held])set(key,false);set('gizmo',false);});
  return ()=>{for(const stop of listeners)stop();for(const key of [...held])set(key,false);};
}

export function lightingEditStatus(state) {
  if(state.status==='rebuild-failed')return `Lighting rebuild failed: ${state.error}`;
  if(state.status==='rebuild-pending'||state.status==='building-static-visibility')return 'Rebuilding lighting — previous geometry preview';
  if(state.previewStale)return 'Editing — lighting preview uses previous geometry; rebuild on release';
  return '';
}
