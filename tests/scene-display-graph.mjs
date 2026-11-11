// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
const module=await import('../scene-display-graph.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
const api=()=>{assert.equal(typeof module.createSceneDisplayGraph,'function','ordinary display graph must construct with worker-local scene resources');assert.equal(typeof module.prepareSceneEmissionSource,'function');return module;};
function fixture(){
 const calls=[],THREE={TSL:{output:{kind:'output'},emissive:{kind:'emissive'},mrt:nodes=>({outputNodes:nodes})}};
 const resources={THREE,baseSceneOutput:{kind:'scene'},depth:{kind:'depth'},receiverNormal:{kind:'normal'},sceneEmissionSource:{kind:'physical-emission'},diagnostic:false,fireLightFieldRoute:false,distributed:false,
  sceneBloom:{output:(raw,emission)=>{calls.push(['bloom',raw,emission]);return {kind:'bloom',raw};}},selectionFeedback:{output:input=>({kind:'outline',input})},
  createFireLightFieldReceiverPass:(...args)=>{calls.push(['fire',...args]);return {outputNode:{kind:'fire-lit'}};},
  createSceneEmissiveCamera:(...args)=>{calls.push(['camera',...args]);return {outputNode:{kind:'camera'}};}};
 return {resources,calls};
}
test('ordinary output preserves physical-emission bloom and selection decoration',()=>{
 const f=fixture(),r=api().createSceneDisplayGraph(f.resources);
 assert.equal(r.rawSceneOutput,f.resources.baseSceneOutput);assert.equal(r.fireLightFieldPass,null);assert.equal(r.sceneEmissiveCamera,null);
 assert.equal(r.outlinedSceneOutput.input.kind,'bloom');assert.equal(r.outlinedCameraOutput,null);assert.equal(f.calls[0][2],f.resources.sceneEmissionSource);
});
test('fire receiving, bloom and camera use the same supplied local sources',()=>{
 const f=fixture();f.resources.fireLightFieldRoute=true;f.resources.distributed=true;
 const r=api().createSceneDisplayGraph(f.resources);
 assert.deepEqual(f.calls.map(c=>c[0]),['fire','bloom','camera']);assert.equal(f.calls[0][1],f.resources.baseSceneOutput);assert.equal(f.calls[0][2],f.resources.depth);assert.equal(f.calls[0][3],f.resources.receiverNormal);
 assert.equal(r.rawSceneOutput,r.fireLightFieldPass.outputNode);assert.equal(r.outlinedCameraOutput.input,r.sceneEmissiveCamera.outputNode);assert.equal(f.calls[2][2].THREE,f.resources.THREE);
});
test('diagnostic output retains raw lighting without invoking bloom',()=>{
 const f=fixture();f.resources.diagnostic=true;const r=api().createSceneDisplayGraph(f.resources);
 assert.deepEqual(f.calls,[]);assert.equal(r.outlinedSceneOutput.input,f.resources.baseSceneOutput);
});
test('physical-emission attachments retain existing MRT fields and rebuild only once',()=>{
 const f=fixture();let mrt={outputNodes:{output:{kind:'existing'},normal:{kind:'normal'}}},disposed=0,sets=0;
 const emission={kind:'texture'},beauty={getMRT:()=>mrt,setMRT:value=>{mrt=value;sets++;},getTextureNode:name=>{assert.equal(name,'emissive');return emission;},renderTarget:{dispose(){disposed++;}}};
 const {prepareSceneEmissionSource}=api(),previous={kind:'previous'};
 assert.equal(prepareSceneEmissionSource({THREE:f.resources.THREE,beauty,requested:false,previous}),previous);assert.equal(sets,0);
 assert.equal(prepareSceneEmissionSource({THREE:f.resources.THREE,beauty,requested:true,previous}),emission);
 assert.equal(mrt.outputNodes.normal.kind,'normal');assert.equal(mrt.outputNodes.output.kind,'existing');assert.equal(mrt.outputNodes.emissive,f.resources.THREE.TSL.emissive);
 assert.equal(beauty.needsUpdate,true);assert.equal(disposed,1);
 prepareSceneEmissionSource({THREE:f.resources.THREE,beauty,requested:true,previous:emission});assert.equal(sets,1);assert.equal(disposed,1);
});
test('requested fire receiving cannot silently become a plain scene graph',()=>{
 const f=fixture();f.resources.fireLightFieldRoute=true;f.resources.createFireLightFieldReceiverPass=()=>null;
 assert.throws(()=>api().createSceneDisplayGraph(f.resources));
});

test('requested lighting and camera providers reject absent or incomplete outputs',()=>{
 for(const invalid of [null,{}, {outputNode:null},{outputNode:undefined}]){
  const f=fixture();f.resources.fireLightFieldRoute=true;f.resources.createFireLightFieldReceiverPass=()=>invalid;
  assert.throws(()=>api().createSceneDisplayGraph(f.resources),/fire light.field receiver.*output node/i);
  const c=fixture();c.resources.distributed=true;c.resources.createSceneEmissiveCamera=()=>invalid;
  assert.throws(()=>api().createSceneDisplayGraph(c.resources),/emissive camera.*output node/i);
 }
});
