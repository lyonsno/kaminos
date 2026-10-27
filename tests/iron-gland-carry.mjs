// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as mechanism from '../experiments/iron-gland/mechanism.mjs';
import * as controls from '../experiments/iron-gland/capture-controls.mjs';
import { gestureProtocol } from '../experiments/iron-gland/capture.mjs';

test('carry reference translates without inheriting hand rotation; targets report only XY proximity',()=>{
  assert.equal(typeof mechanism.createCarryTask,'function','carry reference must exist');
  const task=mechanism.createCarryTask();
  const cue=gestureProtocol().find(c=>c.destination);
  const capture={status:'recording',mode:'neutral',cue,protocolComplete:false,paused:false};
  task.update({visible:true,position:[.2,2.7,.8],scale:.5,capture});
  const orientation=task.root.quaternion.toArray();
  assert.equal(task.read().orientationAuthority,'fixed-instructional-reference');
  task.update({visible:true,position:cue.destination.position,scale:.6,capture});
  assert.deepEqual(task.root.quaternion.toArray(),orientation);
  assert.deepEqual(task.root.position.toArray(),cue.destination.position);
  assert.equal(task.read().insideTarget,true);
  assert.equal(task.read().activeTarget,cue.destination.id);
  task.update({visible:false,position:cue.destination.position,scale:.6,capture});
  assert.equal(task.root.visible,false);assert.equal(task.read().insideTarget,false);
  task.update({visible:true,position:[0,2.7,.8],scale:.5,capture:{...capture,status:'saving'}});
  assert.equal(task.read().activeTarget,null);assert.equal(task.targets.visible,false);
});

test('cue projection clears old instructions and previews on every terminal or error state',()=>{
  assert.equal(typeof controls.captureInstructions,'function','now/next must have one projection');
  const protocol=gestureProtocol();
  const c={status:'recording',cue:{...protocol[0],elapsedSeconds:1.2,total:protocol.length},nextCue:protocol[1],paused:false,protocolComplete:false};
  const p=controls.captureInstructions(c);
  assert.equal(p.current.title,protocol[0].title);assert.equal(p.next.title,protocol[1].title);
  assert.equal(p.next.seconds,Math.ceil(protocol[0].seconds-1.2));
  assert.equal(controls.captureInstructions({...c,paused:true}).next.paused,true);
  const completed=controls.captureInstructions({...c,protocolComplete:true});
  assert.equal(completed.current.title,'Sequence complete');assert.equal(completed.next,null);
  for(const status of ['idle','starting','saving','complete','partial','failed']){
    assert.deepEqual(controls.captureInstructions({...c,status}),{current:null,next:null});
  }
  assert.deepEqual(controls.captureInstructions({...c,error:'disk full'}),{current:null,next:null});
});
