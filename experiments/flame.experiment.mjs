export default {
  id:'flame',title:'Flame',
  async create({host,inputs}) {
    if(Object.keys(inputs).length)throw Error('Flame inputs cannot replace the existing scene; apply a preset explicitly');
    if(!host.flame?.open)throw Error('Flame Workbench host is unavailable');
    const flame=await host.flame.open();
    let paused,status,presets,apply,stop=()=>{};
    const sync=()=>{
      const state=flame.read();
      if(paused){paused.checked=state.paused;paused.disabled=!state.active;}
      if(status)status.textContent=state.active?(state.settings.source?.label||'Scene flame'):'No active flame';
    };
    const operations={
      read:flame.read,
      setControls:patch=>{const result=flame.setControls(patch);sync();return result;},
      setPaused:value=>{const result=flame.setPaused(value);sync();return result;},
      applyBasin:async id=>{await flame.applyBasin(id);sync();return flame.read();},
      saveBasin:input=>flame.saveBasin(input),
      select:target=>flame.select(target),frame:()=>flame.frame(),listBasins:()=>flame.listBasins(),
    };
    return {
      read:flame.read,operations,
      async mount({root,document,invoke}) {
        const commands=document.createElement('div');commands.className='flame-basin-actions';
        const failed=error=>{sync();status.textContent=error.message;};
        for(const [label,operation,value] of [['Emitter','select','emitter'],['Simulation box','select','domain'],['Frame','frame']]) {
          const button=document.createElement('button');button.type='button';button.className='btn';button.textContent=label;
          button.addEventListener('click',()=>invoke(operation,value).catch(failed));commands.append(button);
        }
        const pauseLabel=document.createElement('label');pauseLabel.className='slider-row';
        paused=document.createElement('input');paused.type='checkbox';paused.setAttribute('aria-label','Pause flame');
        pauseLabel.append(paused,' Paused');paused.addEventListener('change',()=>invoke('setPaused',paused.checked).catch(failed));
        const presetLabel=document.createElement('label');presetLabel.textContent='Preset';
        presets=document.createElement('select');presets.setAttribute('aria-label','Flame Workbench preset');
        const empty=document.createElement('option');empty.value='';empty.textContent='Choose a preset';presets.append(empty);
        apply=document.createElement('button');apply.type='button';apply.className='btn';apply.textContent='Apply preset';apply.disabled=true;
        presets.addEventListener('change',()=>{apply.disabled=!presets.value;});
        apply.addEventListener('click',async()=>{apply.disabled=true;try{await invoke('applyBasin',presets.value);}catch(error){failed(error);}finally{apply.disabled=!presets.value;}});
        status=document.createElement('div');status.className='owner-experiment-status';status.setAttribute('role','status');
        presetLabel.append(presets);root.append(commands,pauseLabel,presetLabel,apply,status);
        stop=flame.subscribe(sync);sync();
        try {for(const entry of (await flame.listBasins()).entries){const option=document.createElement('option');option.value=entry.presetId;option.textContent=entry.label;presets.append(option);}}
        catch(error){failed(error);}
      },
      dispose(){stop();},
    };
  },
};
