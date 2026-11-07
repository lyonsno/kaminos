import {checkedMlsPresentationFrame} from './mls-presentation-frame.mjs';

// A retained water owner. Visibility switches presentation/clock ownership only;
// Pour never constructs a host or changes the physical coordinate system.
export function createMountedWorkshopWater({prepareHost,currentHost=null,retireHost=host=>host?.dispose(),setPaused=null,source,editSource,commitEdits=async()=>{},activate=()=>{},deactivate=()=>{},frame=()=>null,changed=()=>{}}){
 let host=null,pending=null,disposed=false,visible=false,wasPaused=true,error=null,epoch=0;
 const live=()=>currentHost?currentHost():host;
 const pause=value=>setPaused?setPaused(value):host?.setPaused(value);
 const read=()=>({phase:disposed?'disposed':pending?'preparing':error?'error':live()?'prepared':'unprepared',visible,paused:live()?.paused??true,error,runtime:live()?.state()??null});
 const publish=()=>changed(read());
 const api={read,
  prepare(){if(disposed)throw Error('Workshop water is disposed');host=live();if(host||pending)return pending??Promise.resolve(read());const token=epoch;
   pending=Promise.resolve().then(prepareHost).then(next=>{if(disposed||token!==epoch){next.dispose();return;}host=next;pause(true);if(visible){host.setPresentationFrame(frame());activate(host);}}).catch(e=>{if(!disposed&&token===epoch)error=e.message;}).finally(()=>{if(token===epoch)pending=null;publish();});publish();return pending;
  },
  present(value){if(disposed)return;const next=Boolean(value);if(next!==visible){if(host){if(next){host.setPresentationFrame(frame());activate(host);pause(wasPaused);}else{wasPaused=host.paused;pause(true);deactivate(host);}}visible=next;publish();}else if(visible&&host)host.setPresentationFrame(frame());},
  async pour(){await commitEdits();host=live();if(!host||error)throw Error(error||'Water is still preparing');if(!visible)throw Error('Bring the workshop into view before pouring');if(!source())throw Error('The workshop water source was removed');editSource({emissionEnabled:true});pause(false);wasPaused=false;publish();return read();},
  async stop(){await commitEdits();editSource({emissionEnabled:false});publish();return read();},
  async reset(){await commitEdits();editSource({emissionEnabled:false});const old=host;host=null;++epoch;const oldWork=pending;pending=null;error=null;wasPaused=true;deactivate(old);await retireHost(old);if(oldWork)await oldWork;return api.prepare();},
  sync(){const next=live();if(next!==host){host=next;if(!host&&!pending&&!error&&!disposed)void api.prepare();else if(host&&visible){host.setPresentationFrame(frame());activate(host);}}if(host&&source())host.setEmitters([source()]);},
  async dispose(){if(disposed)return;disposed=true;++epoch;const old=host;pause(true);host=null;deactivate(old);await retireHost(old);if(pending)await pending;publish();},
 };
 return api;
}
export function mountedWaterPresentation(root){
 const e=root?.parent?.matrixWorld?.elements;if(!e)throw Error('Mounted water has no live workshop frame');
 if([1,2,3,4,6,7,8,9,11].some(i=>Math.abs(e[i])>1e-7)||Math.abs(e[0]-e[5])>1e-7||Math.abs(e[0]-e[10])>1e-7||Math.abs(e[15]-1)>1e-7)throw Error('Mounted water requires a translated, uniformly scaled workshop');
 return checkedMlsPresentationFrame({translation:[e[12],e[13],e[14]],scale:e[0]});
}
