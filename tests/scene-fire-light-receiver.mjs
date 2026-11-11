// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
const receiverModule=await import('../scene-fire-light-receiver.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
const api=()=>{assert.equal(typeof receiverModule.createSceneFireLightReceiver,'function','ordinary fire receiving must construct from worker-local scene and live field inputs');return receiverModule.createSceneFireLightReceiver;};
// Recording GPU allocation only: these tests execute real TSL graph construction,
// never shaders or native GPU admission.
globalThis.GPUTextureUsage??={TEXTURE_BINDING:4,COPY_DST:2};
function fixture(){
 let lightField=null;const textures=[],shadowCalls=[];
 const device={createTexture(descriptor){const t={descriptor,destroyed:0,destroy(){this.destroyed++;}};textures.push(t);return t;}};
 const shadow={visibility:THREE.TSL.float(1),debugState:()=>({effective:true}),setEnabled:enabled=>enabled,dispose:()=>shadowCalls.push('dispose-shadow')};
 const casters={setEnabled:enabled=>shadowCalls.push(['casters',enabled]),dispose:()=>shadowCalls.push('dispose-casters')};
 const camera=new THREE.PerspectiveCamera(),scene=new THREE.Scene(),renderer={},sceneGiProxies={};
 const context={THREE,sharedGpu:{device,identity:'owned-shared-device'},renderer,scene,camera,sceneGiProxies,
  routeParams:new URLSearchParams('volume_light_field_shadows=1&volume_light_field_strength=2'),
  readLightField:()=>lightField,
  createFireLightFieldShadow:options=>{shadowCalls.push(['shadow',options]);return shadow;},
  createFireShadowCasters:options=>{shadowCalls.push(['casters-create',options]);return casters;},
  renderFireShadowBatch:options=>shadowCalls.push(['render-shadow',options])};
 const result=api()(context,THREE.TSL.vec4(1),THREE.TSL.texture(new THREE.Texture()),THREE.TSL.texture(new THREE.Texture()));
 const setField=value=>{lightField=value;};
 const effective=()=>({identity:'gpu-fire-irradiance-lattice-atlas-v0',status:'effective',device,
  generation:1,atlasTexture:{borrowed:true},atlasWidth:16,atlasHeight:8,grid:4,gridY:8,tilesX:4,worldMin:[-2,-1,-2],worldMax:[2,7,2]});
 return {result,context,textures,shadowCalls,setField,effective};
}
test('ordinary receiver constructs actual graph without a page or hidden device',()=>{
 assert.equal(typeof document,'undefined');const f=fixture();assert.ok(f.result.outputNode.isNode);
 assert.equal(f.textures.length,2);assert.deepEqual(f.textures.map(t=>t.descriptor.size.width),[1,4]);
 assert.equal(f.result.debugState().identity,'world-position-fire-light-field-receiver-pass-v0');
 assert.equal(f.shadowCalls[0][1].renderer,f.context.renderer);assert.equal(f.shadowCalls[0][1].requested,true);
 assert.equal(f.shadowCalls[1][1].giProxies,f.context.sceneGiProxies);
 assert.equal(f.result.update(),false);assert.equal(f.result.debugState().reason,'volume-prototype-light-field-unavailable');
});
test('receiver adopts only the live producer on its exact shared device',()=>{
 const f=fixture();f.setField(f.effective());assert.equal(f.result.update(),true);
 let s=f.result.debugState();assert.equal(s.sameDevice,true);assert.equal(s.strength,2);assert.equal(s.atlasGrid,4);
 assert.equal(s.lightField.atlasTexture,undefined);assert.equal(s.lightField.device,undefined);
 f.result.setGainStops(1);f.result.update();assert.equal(f.result.debugState().strength,4);
 f.result.setWitnessMute(true);assert.equal(f.result.debugState().strength,0);f.result.setWitnessMute(false);
 f.setField({...f.effective(),device:{}});assert.equal(f.result.update(),false);s=f.result.debugState();
 assert.equal(s.sameDevice,false);assert.equal(s.strength,0);assert.equal(s.reason,'producer-consumer-device-mismatch');
 f.setField({...f.effective(),generation:2});assert.equal(f.result.update(),true);assert.equal(f.result.debugState().adoptionKey,'2:16x8');
});
test('shadow render uses current world bounds and unavailable fields disable casting',()=>{
 const f=fixture();f.setField(f.effective());f.result.update();f.result.renderShadows();
 const call=f.shadowCalls.find(c=>c[0]==='render-shadow');assert.deepEqual(call[1].flameBox,{min:[-2,-1,-2],max:[2,7,2]});
 f.setField(null);f.result.update();const before=f.shadowCalls.length;f.result.renderShadows();
 assert.deepEqual(f.shadowCalls.slice(before),[['casters',false]]);
});
test('receiver releases its placeholders and shadow owners without destroying borrowed field textures',()=>{
 const f=fixture(),field=f.effective();let borrowedDestroyed=0;field.atlasTexture.destroy=()=>borrowedDestroyed++;
 f.setField(field);f.result.update();f.result.dispose();
 assert.deepEqual(f.textures.map(t=>t.destroyed),[1,1]);assert.equal(borrowedDestroyed,0);
 assert.ok(f.shadowCalls.includes('dispose-shadow'));assert.ok(f.shadowCalls.includes('dispose-casters'));
});
function graphNodes(root){const nodes=new Set();root.traverse(node=>nodes.add(node));return [...nodes];}
test('same-generation producer replacement rebinds both actual sampled texture nodes',()=>{
 const f=fixture();const first={...f.effective(),metaTexture:{id:'meta-first'},metaWidth:4,metaHeight:1,visualExtentIdentity:'undiffused-emission-moments-v1'};
 f.setField(first);f.result.update();const nodes=graphNodes(f.result.outputNode);
 const atlas=nodes.find(node=>node.value?.sourceTexture===first.atlasTexture),meta=nodes.find(node=>node.value?.sourceTexture===first.metaTexture);
 assert.ok(atlas,'actual output graph samples the producer atlas');assert.ok(meta,'actual output graph samples the producer metadata');
 const next={...first,atlasTexture:{id:'atlas-next'},metaTexture:{id:'meta-next'}};f.setField(next);f.result.update();
 assert.equal(atlas.value.sourceTexture,next.atlasTexture);assert.equal(meta.value.sourceTexture,next.metaTexture);
});
test('live relocation refreshes actual shading bounds and cell pitch without rebinding stable textures',()=>{
 const f=fixture(),field=f.effective();f.setField(field);f.result.update();const nodes=graphNodes(f.result.outputNode);
 const vec=values=>nodes.find(node=>node.isUniformNode&&node.value?.isVector3&&node.value.toArray().every((v,i)=>v===values[i]));
 const min=vec(field.worldMin),max=vec(field.worldMax);assert.ok(min);assert.ok(max);
 const pitchCandidates=nodes.filter(node=>node.isUniformNode&&node.value===1);
 const atlas=nodes.find(node=>node.value?.sourceTexture===field.atlasTexture),wrapper=atlas.value;
 f.setField({...field,worldMin:[1,2,3],worldMax:[9,18,11]});f.result.update();
 assert.deepEqual(min.value.toArray(),[1,2,3]);assert.deepEqual(max.value.toArray(),[9,18,11]);
 assert.equal(atlas.value,wrapper,'domain motion preserves unchanged texture wrapper');
 assert.ok(pitchCandidates.some(node=>node.value===2),'actual field pitch follows world width / grid');
});

test('metadata-only replacement and validity changes update the actual metadata sample',()=>{
 const f=fixture(),field={...f.effective(),metaTexture:{id:'first'},metaWidth:4,metaHeight:1,visualExtentIdentity:'undiffused-emission-moments-v1'};
 f.setField(field);f.result.update();const meta=graphNodes(f.result.outputNode).find(node=>node.value?.sourceTexture===field.metaTexture);assert.ok(meta);
 const next={...field,metaTexture:{id:'next'}};f.setField(next);f.result.update();assert.equal(meta.value.sourceTexture,next.metaTexture);
 f.setField({...next,visualExtentIdentity:'unavailable'});f.result.update();assert.equal(meta.value.sourceTexture,f.textures[1]);
 f.setField({...next,metaHeight:2});f.result.update();assert.equal(meta.value.sourceTexture,next.metaTexture);assert.equal(meta.value.image.height,2);
});
