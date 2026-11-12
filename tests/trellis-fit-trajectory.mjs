// kaminos-test: node
import assert from 'node:assert/strict';
import {fitCheckpointSteps,runFitTrajectory} from '../trellis-fit-trajectory.mjs';
assert.deepEqual(fitCheckpointSteps({steps:8,checkpointSteps:[2,4,6,8]}),[0,2,4,6,8]);
assert.deepEqual(fitCheckpointSteps({steps:8}),[0,8]);
assert.throws(()=>fitCheckpointSteps({steps:8,checkpointSteps:[2,9]}),/checkpoint/);
assert.throws(()=>fitCheckpointSteps({steps:8,checkpointSteps:[2,2]}),/checkpoint/);
const events=[];let optimizerStep=0;
await runFitTrajectory({fit:{steps:8,checkpointSteps:[2,4,6]},update:async step=>{assert.equal(step,++optimizerStep);events.push('u'+step);},checkpoint:async step=>{assert.equal(step,optimizerStep);events.push('c'+step);}});
assert.deepEqual(events,['c0','u1','u2','c2','u3','u4','c4','u5','u6','c6','u7','u8','c8']);
const partial=[];await assert.rejects(runFitTrajectory({fit:{steps:4,checkpointSteps:[2]},update:async step=>{if(step===3)throw Error('update failed');},checkpoint:async step=>partial.push(step)}),/update failed/);assert.deepEqual(partial,[0,2]);
console.log('TRELLIS trajectory contracts passed');
