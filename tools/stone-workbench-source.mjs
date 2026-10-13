export function composeStoneWorkbenchSource(source){
 const replace=(anchor,value)=>{if(source.split(anchor).length!==2)throw Error(`Shared host source anchor missing or duplicated: ${anchor}`);source=source.replace(anchor,value);};
 replace('let ownerExperimentEntry=null,',`const stoneFrameSubscribers=new Set();let stoneHostAdapter=null;
let ownerExperimentEntry=null,`);
 replace('await renderer.init();',`await renderer.init();stoneHostAdapter=sharedGpu?.adapter||samHostContext?.adapter||renderer.backend.adapter;`);
 replace('ownerExperimentEntry=await installOwnerExperimentEntry({document,root,host,',`await fluidViewportReady;
const {createStoneWorkbenchCapability}=await import('/__stone/structural-material-workbench-host.mjs');
const stoneCapability=createStoneWorkbenchCapability({renderer,device:renderer.backend.device,adapter:stoneHostAdapter,scene,camera,controls,document,position:[0,1,0],subscribeFrame(hooks){stoneFrameSubscribers.add(hooks);window._kaminosDirty?.();return()=>{stoneFrameSubscribers.delete(hooks);window._kaminosDirty?.();};}});
host.stone=stoneCapability.stone;host.controls.mountStone=stoneCapability.controls.mountStone;
window.__stoneSharedHost={runtime:stoneCapability.current,identity:()=>({three:THREE.REVISION,canvas:renderer.domElement.id,scene:scene.uuid,deviceMatches:stoneCapability.current()?.viewport.deviceMatches??false,callbacks:stoneFrameSubscribers.size})};
ownerExperimentEntry=await installOwnerExperimentEntry({document,root,host,`);
 replace('sceneFrameCount++;',`sceneFrameCount++;for(const hooks of stoneFrameSubscribers)hooks.after();`);
 replace('const liquidFireCompositionActive = fingerFluidPyroCompositionRequested();',`const stoneActive=Array.from(stoneFrameSubscribers,hooks=>hooks.before()).some(Boolean);
const liquidFireCompositionActive = fingerFluidPyroCompositionRequested();`);
 replace('const mainRendererNeeded = Boolean(fingerFluidBenchViewport)',`const mainRendererNeeded = stoneFrameSubscribers.size>0 || Boolean(fingerFluidBenchViewport)`);
 replace('(needsRender || localWaterActive || motionAgencyActive',`(needsRender || stoneActive || localWaterActive || motionAgencyActive`);
 return source;
}
