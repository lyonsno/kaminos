import {createLiveLogExperiment} from '../../live-log-experiment.mjs';

export default {id:'live-log-heat',title:'Log heat and retained char',async create({host,inputs,record}) {
  const session=await host.scene.open();
  await host.volume.ready;
  const settings=host.fire.settings();
  if(!settings.source?.presetId)throw Error('Log experiment requires an explicitly mounted saved basin');
  const runtime=host.volume.get();runtime.setSimulationPaused(true);
  await host.fire.add(settings.source.presetId);
  host.fire.setEnabled(false);
  host.rendering.gi({mode:'combined',steps:4,slices:3});
  const state=runtime.debugState();
  if(state.simGrid!==32||state.gridHeight.heightCells!==32)throw Error('Log preview requires an effective 32x32x32 grid');
  for(const [id,value] of [['volume-steps',28],['volume-immersed-radius',.1]]) {
    if(Number(host.fire.settings().domControls[id]?.value)!==value)throw Error('Log preview setting mismatch: '+id);
  }
  let visible=true;
  const fire={availability:()=>({status:host.fire.read().authoredPresent?'mounted':'unavailable'}),
    read:()=>({status:host.fire.read().authoredPresent?'mounted':'unavailable',enabled:host.fire.read().emissionEnabled,visible,objectId:'flame-emitter',basin:{presetId:settings.source.presetId,label:settings.source.label}}),
    setEnabled:host.fire.setEnabled,setVisible(value){visible=value;host.fire.setVisible(value);},select:host.fire.select,
    showLibrary(){document.getElementById('flame-basin-select')?.focus();},
    async reacquire(){if(!host.fire.read().authoredPresent)await host.fire.add(settings.source.presetId);host.fire.setEnabled(false);},
    dispose(){host.fire.setEnabled(false);}};
  const scene={...host.scene,ready:Promise.resolve(),dirty:()=>session.redraw(),
    async load(url,options){const asset=await session.loadAsset({url,...options,normalize:true,arrival:'append'});host.scene.refreshPresentation(asset);return asset.root;}};
  let inspectionLighting=null;
  const inspection=enabled=>{
    if(enabled&&!inspectionLighting){
      inspectionLighting={gain:host.rendering.readGI().gain,muted:host.rendering.readFireLighting().witnessMuted===true};
      host.rendering.gi({...host.rendering.readGI(),gain:0});host.rendering.muteFireLighting(true);
    }else if(!enabled&&inspectionLighting){
      const previous=inspectionLighting;inspectionLighting=null;
      host.rendering.gi({...host.rendering.readGI(),gain:previous.gain});host.rendering.muteFireLighting(previous.muted);
    }
  };
  try {
    const instance=await createLiveLogExperiment({host:{scene,fire,volume:host.volume,inspection},inputs,record});
    const close=instance.dispose;instance.dispose=async()=>{try{await close();}finally{await session.dispose();}};
    return instance;
  } catch(error){await session.dispose();throw error;}
}};
