import {createSceneDisplayGraph,prepareSceneEmissionSource} from './scene-display-graph.mjs';

// Ordinary output selection and A/B graph retention. The scene owner supplies
// live resources and owns their lifetime; UI callbacks project plain state.
export function createSceneDisplayOwner({THREE,graphs=new Map(),readSettings,readResources,
 createFireLightFieldReceiverPass,createSceneEmissiveCamera,onDiagnostic=()=>{},onOutput=()=>{},refresh=()=>{}}){
 let sceneEmissionSource=null;
 return Object.freeze({graphs,rebuild(){
  const settings=readSettings();
  const {sceneGI,scenePass,prePassDepth,prePassNormal,sceneBloom,selectionFeedback,renderPipeline}=readResources();
  const combined=settings.mode==='combined',diagnostic=combined&&settings.view!=='scene';
  onDiagnostic(diagnostic);
  const baseSceneOutput=combined?sceneGI.output(settings.view):scenePass;
  const bloom=sceneBloom.read().settings;
  sceneEmissionSource=prepareSceneEmissionSource({THREE,beauty:combined?sceneGI.beauty:scenePass,
   requested:bloom.enabled||bloom.composeFlame,previous:sceneEmissionSource});
  const activeSceneDepth=combined?sceneGI.depth:prePassDepth;
  const graphKey=`${sceneGI.debugState().filterImplementation}:${settings.mode}:${settings.denoise>0}:${settings.temporal}:${sceneGI.reflections.settings.enabled}:${settings.fireLightFieldRoute}:${settings.distributed}:${bloom.enabled&&bloom.radius>0&&bloom.strength>0&&!diagnostic}`;
  let graph=graphs.get(graphKey);
  const cached=Boolean(graph);
  if(!graph){
   // Three may retain these resources in cached bindings across an A/B toggle.
   graph=createSceneDisplayGraph({THREE,baseSceneOutput,depth:activeSceneDepth,
    receiverNormal:combined?sceneGI.source.getTextureNode('normal'):prePassNormal,
    sceneBloom,sceneEmissionSource,selectionFeedback,diagnostic,
    fireLightFieldRoute:settings.fireLightFieldRoute&&settings.sharedDeviceAvailable,
    distributed:settings.distributed,createFireLightFieldReceiverPass,createSceneEmissiveCamera});
   graphs.set(graphKey,graph);
  }
  const output={...graph,activeSceneDepth,sceneEmissionSource};
  onOutput(output);
  if(!cached&&graph.fireLightFieldPass)refresh();
  renderPipeline.outputNode=graph.outlinedSceneOutput;renderPipeline.outputColorTransform=true;renderPipeline.needsUpdate=true;
  if(cached)refresh();
  return output;
 }});
}
