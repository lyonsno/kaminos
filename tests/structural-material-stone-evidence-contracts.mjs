import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildGpuStoneFixture } from '../structural-material-stone-fixture.js';
import { inspectStoneThickness } from '../structural-material-stone-evidence.mjs';

const prepared=JSON.parse(fs.readFileSync(new URL('../artifacts/imported-stone-thickness/prepared.json',import.meta.url)));
const expected={sourceSha256:prepared.sourceSha256,preparedSha256:'a'.repeat(64),strength:200};
const state={route:'kaminos.structural-material.imported-stone-thickness.webgpu.v0',phase:'interactive',failure:null,failures:[],identity:{backend:'webgpu',adapterFallback:false,isFallbackAdapter:false},...expected,
  specimens:prepared.specimens.map(p=>{const f=buildGpuStoneFixture(p),bodies=f.cells.map(c=>({...c,position:Object.fromEntries(['x','y','z'].map((a,i)=>[a,c.position[i]])),quaternion:{x:0,y:0,z:0,w:1}}));return{preparation:p,normalMapped:true,offset:[0,0,0],state:{backend:'webgpu-avbd',config:f.config,bodies},rendererPoses:f.cells.map(c=>({index:c.index,position:c.position,quaternion:[0,0,0,1]}))};})};
assert.deepEqual(inspectStoneThickness(state,expected),[]);
for(const mutate of [s=>s.route='arch-default',s=>s.identity.adapterFallback=true,s=>s.preparedSha256='b'.repeat(64),s=>s.specimens.pop(),s=>s.specimens[0].normalMapped=false,s=>s.specimens[0].state.config.strength=1e8,s=>s.specimens[0].rendererPoses[1].position[0]+=1,s=>s.specimens[0].rendererPoses.pop()]){
  const bad=structuredClone(state);mutate(bad);assert(inspectStoneThickness(bad,expected).length>0);
}
const additive=structuredClone(state);additive.future={unknown:true};assert.deepEqual(inspectStoneThickness(additive,expected),[]);
console.log('synthetic inspector rejects route, source, config, partial and render substitutions; native conformance remains separate');
