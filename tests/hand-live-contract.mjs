// kaminos-test: node
import assert from 'node:assert/strict';
import {liveMeshFrame, cameraCrop} from '../experiments/hand-live-contract.mjs';

const identity = {model:'mobrecon_densestack_spiralconv',backend:'pytorch',device:'cpu',checkpointSha256:'actual',sourceRevision:'actual'};
const capture = {captureId:'one',captureEpochMs:100};
const frame = {...capture,identity,available:true,interactionAuthority:false,
  authority:'live_native_diagnostic_not_interaction',handedness:'right',verticesMeters:Array.from({length:778},(_,i)=>[i*.001,0,0])};
assert.equal(liveMeshFrame(frame,capture,identity).length,2334);
assert.throws(()=>liveMeshFrame({...frame,captureId:'old'},capture,identity),/capture/);
assert.throws(()=>liveMeshFrame({...frame,identity:{...identity,model:'fallback'}},capture,identity),/identity/);
assert.throws(()=>liveMeshFrame({...frame,interactionAuthority:true},capture,identity),/authority/);
assert.throws(()=>liveMeshFrame({...frame,verticesMeters:[]},capture,identity),/mesh/);
assert.deepEqual(cameraCrop(640,480,.5,.5,1),[80,0,560,480]);
assert.deepEqual(cameraCrop(640,480,0,0,.5),[-120,-120,120,120]);
assert.throws(()=>cameraCrop(640,480,NaN,.5,1),/crop/);
