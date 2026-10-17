export default {
  id:'surface-lighting-work',title:'Surface lighting work',
  async create({host,record}){
    const session=await host.scene.open(),document=host.controls.document,win=document.defaultView;
    const api=()=>{if(!win.kaminosLightingWork)throw Error('Surface lighting comparison is unavailable');return win.kaminosLightingWork;};
    const read=()=>api().read();
    let filter,reuse,status;
    const sync=()=>{
      const state=read();if(!status)return;
      filter.checked=state.filterImplementation==='shared';reuse.checked=state.surfaceLighting.enabled;
      if(state.effectiveMode!=='combined'){
        status.textContent=`Combined GI is inactive (${state.effectiveMode}). These selections apply when combined GI is enabled; AO/GI filter sharing and source-lighting reuse are not executing.`;return;
      }
      status.textContent=`${state.filtering?(filter.checked?'One shared AO/GI filter pass':'Two separate AO/GI filter passes'):'Spatial filtering bypassed'} · `+
        (state.surfaceLighting.mounted?`${state.surfaceLighting.materials} flame-lit materials; ${reuse.checked?'matching final receivers reuse source lighting':'final receivers evaluate flame lighting directly'}. Source irradiance export is allocated in both comparison modes.`:'No hybrid flame surface-lighting producer is mounted.');
    };
    const change=(kind,value)=>{const result=kind==='filter'?api().setFilter(value):api().setSurfaceReuse(value);record({kind:`lighting-work.${kind}`,phase:'applied',effective:result});sync();return result;};
    const stop=session.onFrame(sync);
    return{
      read,
      operations:{setFilter:value=>change('filter',value),setSurfaceReuse:value=>change('surface-reuse',value)},
      mount({root,document,invoke}){
        const add=(text,operation,value)=>{
          const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';
          label.append(input,document.createTextNode(` ${text}`));root.append(label);
          input.addEventListener('change',()=>invoke(operation,value(input.checked)).catch(error=>{status.textContent=error.message;}));return input;
        };
        filter=add('Share AO/GI filter work','setFilter',checked=>checked?'shared':'separate');
        reuse=add('Reuse flame lighting between scene draws','setSurfaceReuse',checked=>checked);
        status=document.createElement('p');status.setAttribute('role','status');root.append(status);sync();
      },
      dispose(){stop();session.dispose();},
    };
  },
};
