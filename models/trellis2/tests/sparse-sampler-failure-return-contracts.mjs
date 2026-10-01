import assert from 'node:assert/strict';
import * as checks from '../sparse-sampler-witness-checks.js';
import {createWebGpuInferenceQueue} from '../../../webgpu-inference-kit/src/inference-queue.js';

const queue=createWebGpuInferenceQueue({routeId:'sampler-failure-contract',runtime:{
  routeId:'sampler-failure-contract',
  async runInvocation(input,execute){return execute({invocationId:input.invocationId});},
}});
const job=queue.enqueue({jobId:'failed-step',execute(){throw new Error('step3 sampler-euler-update failed');}});
const completion=await job.completion;
assert.equal(completion.status,'failed');
assert.equal(completion.failure.message,'step3 sampler-euler-update failed');
assert.equal(completion.error,undefined);
assert.equal(typeof checks.recordSamplerCompletion,'function','The recurrent observer must retain the actual execution failure before readback.');
assert.equal(typeof checks.preserveSamplerWitnessFailure,'function');
const report={status:'failed',phase:'complete-sampler-schedule'};
checks.recordSamplerCompletion(report,completion);
report.phase='observation-readback';
checks.preserveSamplerWitnessFailure(report);
assert.equal(report.phase,'complete-sampler-schedule');
assert.equal(report.error.message,'step3 sampler-euler-update failed');
assert.equal(report.observationFailure,undefined);
report.phase='observation-readback';
checks.preserveSamplerWitnessFailure(report,new Error('step2 readback failed'));
assert.equal(report.error.message,'step3 sampler-euler-update failed');
assert.equal(report.observationFailure.phase,'observation-readback');
assert.equal(report.observationFailure.message,'step2 readback failed');
assert.equal(report.executionStatus,'failed');
assert.equal(report.status,'failed');
const success={phase:'first-sampler-step'};
checks.recordSamplerCompletion(success,{status:'succeeded',output:{}});
assert.equal(success.executionFailure,undefined);
checks.preserveSamplerWitnessFailure(success,new Error('fixture read failed'));
assert.equal(success.error.message,'fixture read failed');
console.log('Actual queue failure message and execution phase survive observation; secondary readback errors remain distinct.');
