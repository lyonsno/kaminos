// Resource construction only. The scene owner retains its existing graph
// cache, render pipeline, presentation policy and GPU lifetime.
export function prepareSceneEmissionSource({THREE,beauty,requested,previous=null}){
 if(!requested)return previous;
 if(!beauty.getMRT()?.outputNodes?.emissive){
  beauty.setMRT(THREE.TSL.mrt({output:THREE.TSL.output,...beauty.getMRT()?.outputNodes,emissive:THREE.TSL.emissive}));
  beauty.renderTarget.dispose();beauty.needsUpdate=true;
 }
 return beauty.getTextureNode('emissive');
}
export function createSceneDisplayGraph({THREE,baseSceneOutput,depth,receiverNormal,sceneBloom,sceneEmissionSource,
 selectionFeedback,diagnostic,fireLightFieldRoute,distributed,createFireLightFieldReceiverPass,createSceneEmissiveCamera}){
 const fireLightFieldPass=fireLightFieldRoute?createFireLightFieldReceiverPass(baseSceneOutput,depth,receiverNormal):null;
 if(fireLightFieldRoute&&!fireLightFieldPass?.outputNode)throw new TypeError('Fire light-field receiver must provide an output node');
 const rawSceneOutput=fireLightFieldRoute?fireLightFieldPass.outputNode:baseSceneOutput;
 const displaySceneOutput=diagnostic?rawSceneOutput:sceneBloom.output(rawSceneOutput,sceneEmissionSource);
 const sceneEmissiveCamera=distributed?createSceneEmissiveCamera(displaySceneOutput,{TSL:THREE.TSL,THREE}):null;
 if(distributed&&!sceneEmissiveCamera?.outputNode)throw new TypeError('Scene emissive camera must provide an output node');
 const outlinedSceneOutput=selectionFeedback.output(displaySceneOutput);
 const outlinedCameraOutput=sceneEmissiveCamera?selectionFeedback.output(sceneEmissiveCamera.outputNode):null;
 return {rawSceneOutput,outlinedSceneOutput,outlinedCameraOutput,sceneEmissiveCamera,fireLightFieldPass};
}
