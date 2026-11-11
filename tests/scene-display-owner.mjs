// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
const module=await import('../scene-display-owner.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
function fixture(){
 assert.equal(typeof module.createSceneDisplayOwner,'function','the ordinary page and worker need the same retained display policy');
 const calls=[],graphs=new Map(),settings={mode:'gtao',view:'scene',denoise:1,temporal:false,fireLightFieldRoute:true,distributed:false,sharedDeviceAvailable:true};
 const bloomSettings={enabled:false,composeFlame:false,radius:1,strength:1};
 const beauty=name=>({name,getMRT:()=>({outputNodes:{emissive:{}}}),getTextureNode:field=>({name,field})});
 const scenePass=beauty('ordinary'),combined=beauty('combined'),pipeline={};
 const resources={scenePass,prePassDepth:{name:'ordinary-depth'},prePassNormal:{name:'ordinary-normal'},renderPipeline:pipeline,
  sceneGI:{beauty:combined,depth:{name:'combined-depth'},source:beauty('source'),output:view=>({view}),debugState:()=>({filterImplementation:'shared'}),reflections:{settings:{enabled:false}}},
  sceneBloom:{read:()=>({settings:bloomSettings}),output:(raw,emission)=>{calls.push(['bloom',emission]);return {raw,emission};}},selectionFeedback:{output:input=>({input})}};
 const owner=module.createSceneDisplayOwner({THREE:{TSL:{}},graphs,readSettings:()=>settings,readResources:()=>resources,
  createFireLightFieldReceiverPass:(base,depth,normal)=>{calls.push(['receiver',base,depth,normal]);return {outputNode:{base,depth}};},
  createSceneEmissiveCamera:input=>{calls.push(['camera']);return {outputNode:input};},
  onDiagnostic:value=>calls.push(['diagnostic',value]),onOutput:value=>calls.push(['output',value]),refresh:()=>calls.push(['refresh'])});
 return {owner,graphs,settings,bloomSettings,resources,pipeline,calls};
}
test('retained display policy selects actual depth, emission, receiver and cached graph without reallocating on A/B',()=>{
 const f=fixture(),a=f.owner.rebuild();assert.equal(a.activeSceneDepth,f.resources.prePassDepth);assert.equal(f.pipeline.outputNode,a.outlinedSceneOutput);
 assert.equal(f.calls.filter(row=>row[0]==='receiver').length,1);
 const repeated=f.owner.rebuild();assert.equal(repeated.rawSceneOutput,a.rawSceneOutput);assert.equal(f.graphs.size,1);
 f.bloomSettings.enabled=true;const lit=f.owner.rebuild();assert.notEqual(lit.rawSceneOutput,a.rawSceneOutput);assert.equal(lit.sceneEmissionSource.name,'ordinary');
 f.bloomSettings.enabled=false;assert.equal(f.owner.rebuild().rawSceneOutput,a.rawSceneOutput);assert.equal(f.calls.filter(row=>row[0]==='receiver').length,2);
 assert.equal(f.pipeline.outputColorTransform,true);assert.equal(f.pipeline.needsUpdate,true);
});
test('combined diagnostic and distributed camera retain their current resources and plain UI projection',()=>{
 const f=fixture();f.settings.mode='combined';f.settings.view='normal';f.settings.distributed=true;f.bloomSettings.enabled=true;
 const value=f.owner.rebuild();assert.equal(value.activeSceneDepth,f.resources.sceneGI.depth);assert.equal(value.sceneEmissionSource.name,'combined');
 assert.equal(f.calls.some(row=>row[0]==='bloom'),false);assert.equal(f.calls.filter(row=>row[0]==='camera').length,1);
 assert.deepEqual(f.calls.find(row=>row[0]==='diagnostic'),['diagnostic',true]);
});
test('renderer replacement and preexisting graph cache publish the retained output into the current pipeline',()=>{
 const f=fixture(),first=f.owner.rebuild(),previous=f.pipeline;
 f.resources.renderPipeline={};const value=f.owner.rebuild();assert.equal(value.rawSceneOutput,first.rawSceneOutput);assert.equal(f.resources.renderPipeline.outputNode,first.outlinedSceneOutput);
 assert.equal(previous.outputNode,first.outlinedSceneOutput);assert.equal(f.graphs.size,1);
});
