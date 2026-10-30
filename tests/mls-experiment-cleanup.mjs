// kaminos-test: node
import assert from 'node:assert/strict';
import experiment from '../experiments/mls-juice.experiment.mjs';
let opened=0,mounted=false,sceneDisposed=0,fluidDisposed=0,failFrame=false;
const scene={setView(){if(failFrame)throw Error('fixture frame failure');},dispose(){sceneDisposed++;},onFrame:()=>()=>{}};
const host={scene:{open:async()=>{opened++;return scene;}},fluid:{openInlets:async()=>{
  assert.equal(mounted,false,'prior candidate leaked');mounted=true;
  return{read:()=>({}),setPaused(){},setPacket(){},dispose(){mounted=false;fluidDisposed++;}};
}}};
await assert.rejects(experiment.create({host,inputs:{sourceFlux:-1},record(){}}),/Invalid emission rate/);
assert.equal(opened,0,'invalid inputs acquired the scene');assert.equal(mounted,false,'invalid inputs left fluid mounted');
const first=await experiment.create({host,inputs:{},record(){}});await first.dispose();
assert.equal(mounted,false);
failFrame=true;
await assert.rejects(experiment.create({host,inputs:{},record(){}}),/fixture frame failure/);
assert.equal(mounted,false,'late creation failure leaked the fluid');assert.equal(fluidDisposed,2);assert.equal(sceneDisposed,2);
failFrame=false;const reopened=await experiment.create({host,inputs:{},record(){}});await reopened.dispose();
console.log('MLS experiment invalid input and post-acquisition cleanup OK');
