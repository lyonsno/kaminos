// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const url=new URL('../experiments/hill-terrain/witness.mjs',import.meta.url);assert.ok(existsSync(url),'Hill witness must reject wrong route and incomplete GPU evidence');
const {validateTerrainRead,compareTerrainState}=await import(url);
const good={route:'kaminos/hill-terrain/gpu-height-material-v1',backend:'webgpu',initialized:true,prepared:true,readbackInRuntime:false,error:null,config:{resolution:3,seed:4},steps:2};
test('evidence cannot pass on fallback, wrong seed, stale step or missing state',()=>{
 assert.doesNotThrow(()=>validateTerrainRead(good,{seed:4,steps:2}));
 for(const patch of [{backend:'cpu'},{prepared:false},{error:'device lost'},{readbackInRuntime:true},{steps:0},{config:{seed:5,resolution:3}}])assert.throws(()=>validateTerrainRead({...good,...patch},{seed:4,steps:2}));
 assert.throws(()=>compareTerrainState(new Float32Array(4),new Float32Array(8)));assert.throws(()=>compareTerrainState(new Float32Array([NaN,0,0,0]),new Float32Array(4)));
 assert.throws(()=>compareTerrainState(new Float32Array([0,1,0,0]),new Float32Array(4)));
 assert.equal(compareTerrainState(new Float32Array(4),new Float32Array(4)).maxError,0);
});
