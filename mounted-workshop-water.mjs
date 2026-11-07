import {checkedMlsPresentationFrame} from './mls-presentation-frame.mjs';

// A retained water owner. Visibility switches presentation/clock ownership only;
// Pour never constructs a host or changes the physical coordinate system.
export function createMountedWorkshopWater({prepareHost,source,editSource,commitEdits=async()=>{},activate=()=>{},deactivate=()=>{},frame=()=>null,changed=()=>{}}){
 let host=null,pending=null,disposed=false,visible=false,wasPaused=true,error=null,epoch=0;
 const read=()=>({phase:disposed?'disposed':pending?'preparing':error?'error':host?'prepared':'unprepared',visible,paused:host?.paused??true,error,runtime:host?.state()??null});
 const publish=()=>changed(read());
 const api={read,
  prepare(){if(disposed)throw Error('Workshop water is disposed');if(host||pending)return pending??Promise.resolve(read());const token=epoch;
   pending=Promise.resolve().then(prepareHost).then(next=>{if(disposed||token!==epoch){next.dispose();return;}host=next;host.setPaused(true);if(visible){host.setPresentationFrame(frame());activate(host);}}).catch(e=>{if(!disposed&&token===epoch)error=e.message;}).finally(()=>{if(token===epoch)pending=null;publish();});publish();return pending;
  },
  present(value){if(disposed)return;const next=Boolean(value);if(next!==visible){visible=next;if(host){if(visible){host.setPresentationFrame(frame());activate(host);host.setPaused(wasPaused);}else{wasPaused=host.paused;host.setPaused(true);deactivate(host);}}publish();}else if(visible&&host)host.setPresentationFrame(frame());},
  async pour(){await commitEdits();if(!host||error)throw Error(error||'Water is still preparing');if(!visible)throw Error('Bring the workshop into view before pouring');if(!source())throw Error('The workshop water source was removed');editSource({emissionEnabled:true});host.setPaused(false);wasPaused=false;publish();return read();},
  async stop(){await commitEdits();editSource({emissionEnabled:false});publish();return read();},
  async reset(){await commitEdits();editSource({emissionEnabled:false});const old=host;host=null;++epoch;const oldWork=pending;pending=null;error=null;wasPaused=true;deactivate(old);old?.dispose();if(oldWork)await oldWork;return api.prepare();},
  sync(){if(host&&source())host.setEmitters([source()]);},
  async dispose(){if(disposed)return;disposed=true;++epoch;const old=host;host=null;deactivate(old);old?.setPaused(true);old?.dispose();if(pending)await pending;publish();},
 };
 return api;
}
export function mountedWaterPresentation(root){
 const e=root?.parent?.matrixWorld?.elements;if(!e)throw Error('Mounted water has no live workshop frame');
 if([1,2,3,4,6,7,8,9,11].some(i=>Math.abs(e[i])>1e-7)||Math.abs(e[0]-e[5])>1e-7||Math.abs(e[0]-e[10])>1e-7||Math.abs(e[15]-1)>1e-7)throw Error('Mounted water requires a translated, uniformly scaled workshop');
 return checkedMlsPresentationFrame({translation:[e[12],e[13],e[14]],scale:e[0]});
}
