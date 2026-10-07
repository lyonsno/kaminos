import assert from 'node:assert/strict';
import { stoneConsumerFixture } from './helpers/stone-consumer-fixture.mjs';
const mode=process.argv[2],f=await stoneConsumerFixture(),{api,node}=f;
assert.equal(api.witness().phase,'interactive');
if(mode==='pause'){
  api.pull(.02);const before=api.witness(),counts=f.counts();
  f.listeners.get('wheel')({deltaY:100,deltaMode:0,ctrlKey:false,clientX:640,clientY:450,preventDefault(){},stopPropagation(){}});
  assert.notDeepEqual(api.witness().camera,before.camera);
  await f.frame();
  assert(f.counts().renders>counts.renders,'paused native camera change must draw before any forcing capture');
  assert.equal(f.counts().steps,counts.steps);
  assert.deepEqual(api.witness().specimens.map(s=>s.state),before.specimens.map(s=>s.state));
}else if(mode==='reset'){
  api.pull(.3);assert.equal(node('#pull').value,'0.3');
  const camera=api.witness().camera;await api.reset();
  assert.equal(api.witness().paired,false);assert(api.witness().specimens.every(s=>s.state.hand===null));
  assert.equal(node('#pull').value,'0','Reset must clear displayed and applied pull together');
  assert.deepEqual(api.witness().camera,camera);
}else if(mode==='cohesion'){
  const entered=f.holdNextAcquisition(),replacement=api.reset();await entered;
  node('#strength').value='300';node('#strength').onchange();f.releaseAcquisition();await replacement;
  assert.deepEqual(api.witness().specimens.map(s=>s.state.config.strength),[300,300],'latest shared edit must apply atomically to both replacements');
  assert.equal(node('#strength').value,'300');
  assert.equal(api.witness().resetReceipt.constructionStrength,200);
  assert.equal(api.witness().resetReceipt.publishedStrength,300);
}else throw new Error('usage: node tests/structural-material-stone-consumer-contracts.mjs pause|reset|cohesion');
console.log(`stone consumer ${mode} contract passed; acquisition/render scheduling only, not native physics`);
