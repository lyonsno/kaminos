export function composeStoneWorkbenchSource(source){
 const replace=(anchor,value)=>{if(source.split(anchor).length!==2)throw Error(`Shared host source anchor missing or duplicated: ${anchor}`);source=source.replace(anchor,value);};
 replace('let ownerExperimentEntry=null,',`const stoneFrameSubscribers=new Set();let stoneHostAdapter=null;
let ownerExperimentEntry=null,`);
 replace('function installFluidWorkbench({entryOnly=false,investigation=null}={}) {',`function installFluidWorkbench({entryOnly=false,investigation=null}={}) {
entryOnly=entryOnly||new URLSearchParams(location.search).get('experiment')==='stone/fracture';`);
 replace("tools:[...document.querySelectorAll('.tab[data-tab]')].map(node=>({id:node.dataset.tab,label:node.textContent.trim()})),",`tools:[...document.querySelectorAll('.tab[data-tab]')].map(node=>({id:node.dataset.tab,label:node.textContent.trim()})).concat({id:'stone/fracture',label:'Stone fracture'}),`);
 replace('openTool:tab=>setActiveTab(tab),',`openTool:tab=>tab==='stone/fracture'?ownerExperimentEntry.open(tab).catch(error=>setInfo(error.message)):setActiveTab(tab),`);
 replace('if(fingerFluidBenchScene?.group)objects.push(fingerFluidBenchScene.group);',`if(fingerFluidBenchScene?.group)objects.push(fingerFluidBenchScene.group);if(window.__stoneSharedHost?.runtime()?.object)objects.push(window.__stoneSharedHost.runtime().object);`);
 replace("onOpen:(definition,inputs)=>{fingerFluidOwnerDefinition={id:definition.id,inputs};},",`onOpen:(definition,inputs)=>{
if(definition.id==='stone/fracture'){stopFingerFluidBench();fingerFluidBenchSimulationPaused=true;document.getElementById('finger-fluid-bench-operator-panel').hidden=true;fluidWorkbench.setTool(definition.id);fingerFluidOwnerDefinition=null;}
else{fluidWorkbench.setTool('finger-fluid-bench');fingerFluidOwnerDefinition={id:definition.id,inputs};}},`);
 replace('onChange:({id,inputs})=>{const url=new URL(location.href);',`onChange:({id,inputs})=>{
if(id==='stone/fracture'){fluidWorkbench.setTool(id);document.getElementById('experiment-tool-slot').hidden=true;document.querySelector('#experiment-instruments .experiment-panel-heading p').textContent='';setInfo('Stone fracture');frameObjects([window.__stoneSharedHost.runtime().object],camera,controls);window._kaminosDirty?.();}
else if(!id)fluidWorkbench.setTool(window.__kaminosActiveTab());
const url=new URL(location.href);`);
 replace('window.kaminosWorkbenchExperiments=ownerExperimentEntry;',`window.kaminosWorkbenchExperiments=ownerExperimentEntry;
root.querySelector('select').setAttribute('aria-label','Experiment');`);
 replace('grInit();\ninitKaminosFingerFluidBenchRoute();',`grInit();
window.__kaminosInvestigationEntryOnly=new URLSearchParams(location.search).get('experiment')==='stone/fracture';
initKaminosFingerFluidBenchRoute();`);
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
