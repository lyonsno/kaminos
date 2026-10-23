// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const core=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const start=core.indexOf('  function encodeFollowingDomain(');
const fn=core.slice(start,core.indexOf('\n  }',start)+4);
for(const parity of [0,1])for(const sign of [-1,1]){
  let passed;
  const coordinates=[{id:'coordinates0'},{id:'coordinates1'}];
  const context={followingDomain:{pending:[sign,0,0],gpu:{encode(_encoder,args){passed=args;}}},gridSize:8,gridHeight:12,
    fluidBuffers:['f0','f1'],frontBuffers:['t0','t1'],quenchBuffers:['q0','q1'],reactantTextures:['r0','r1'],
    waveletTextures:coordinates,waveletSidecarFull:true,currentFluid:parity,currentFront:parity,currentQuench:parity,
    pressureBuffers:[],reactantSidecarFull:true,REACTANT_MODEL:{ambientOxidizer:1}};
  vm.createContext(context);vm.runInContext(fn,context);context.encodeFollowingDomain({});
  assert.deepEqual(Array.from(passed.coordinates),[coordinates[parity],coordinates[1-parity]],'remap consumes the latest quench-owned coordinate slot and writes the next');
  assert.equal(passed.coordinatesFull,true);
  assert.equal(context.currentQuench,1-parity);
  assert.equal(context.followingDomain.pending,null);
}
console.log('following-domain remap carries the same coordinate parity as retained gas for both shift signs');
