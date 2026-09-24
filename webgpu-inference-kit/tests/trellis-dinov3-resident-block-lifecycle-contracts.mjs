import assert from 'node:assert/strict';
import {
  runTrellisDinoV3FinalNoAffineLayerNormResident,
  runTrellisDinoV3Block1AttentionResident,
  runTrellisDinoV3Block1MlpResident,
  runTrellisDinoV3LayerNormResident,
  runTrellisDinoV3TransformerBlockResident,
} from '../src/trellis-dinov3-prefix-block-phase-program.js';

const destroyed = [];
const destroyedUniformBuffers = [];
const kernels = [];
const runtime = {
  createTensor(input) {
    const { name, shape, dtype, usage } = input;
    const buffer = input.buffer || { destroy() { destroyed.push(name); } };
    return { name, shape, dtype, usage, buffer, ownsBuffer: !input.buffer };
  },
  createManagedBuffer({ label }) { return { label, destroy() { destroyed.push(label); } }; },
  uploadTensor() {},
  createUniformBuffer(input) { return { label: input.label, buffer: { destroy() { destroyedUniformBuffers.push(input.label); } } }; },
  defineComputeKernel(input) { kernels.push(input); return input; },
  async runKernel() {},
};

function tensor(name, shape = [1, 1029, 1024]) {
  return {
    name,
    shape,
    dtype: 'f32',
    usage: 0x0080,
    buffer: { destroy() { destroyed.push(name); } },
    ownsBuffer: true,
  };
}

const attentionMatrix = new Float32Array(1024 * 1024);
const mlpMatrix = new Float32Array(1024 * 4096);
const vector = new Float32Array(4096);
const channel = new Float32Array(1024);
const rope = new Float32Array(1024 * 64);
const beforeFailedPhase = destroyed.length;
await assert.rejects(() => runTrellisDinoV3LayerNormResident({
  runtime,
  inputTensor: tensor('failed.norm.input'),
  weight: channel,
  bias: channel,
  onPhase() { throw new Error('phase notification failed'); },
  releaseTransientTensors: true,
}), /phase notification failed/);
assert.deepEqual(destroyed.slice(beforeFailedPhase), [
  'trellis.dinov3.block1.norm1.weight',
  'trellis.dinov3.block1.norm1.bias',
  'trellis.dinov3.block1.norm1.output',
], 'a failed pre-dispatch phase must release its transient parameters and output');
assert.equal(destroyedUniformBuffers.includes('trellis.dinov3.block1.norm1.resident-dims'), true,
  'a failed pre-dispatch phase must release its uniform buffer');
const blockInput = tensor('upstream.block2.output');
const block = await runTrellisDinoV3TransformerBlockResident({
  runtime,
  device: { limits: { maxComputeWorkgroupsPerDimension: 65535 } },
  blockIndex: 3,
  inputTensor: blockInput,
  schedulerInvocation: { id: 'contract-test' },
  managedTensorBuffers: true,
  releaseConsumedTensors: true,
  ropeCos: rope,
  ropeSin: rope,
  weights: {
    norm1Weight: channel, norm1Bias: channel,
    qWeight: attentionMatrix, qBias: channel, kWeight: attentionMatrix, vWeight: attentionMatrix, vBias: channel,
    oWeight: attentionMatrix, oBias: channel, layerScale1: channel,
    norm2Weight: channel, norm2Bias: channel,
    mlpUpWeight: mlpMatrix, mlpUpBias: vector,
    mlpDownWeight: mlpMatrix, mlpDownBias: channel, layerScale2: channel,
  },
});

assert.equal(block.operation, 'dinov3-block3-complete-transformer-block');
assert.equal(block.inputTensor, blockInput);
assert.deepEqual(block.tensor.shape, [1, 1029, 1024]);
assert.equal(block.tensor.dtype, 'f32');
assert.equal(destroyed.includes(blockInput.name), true, 'the previous layer output must be releasable after its residual is folded into block-3 output');
assert.equal(kernels.some(kernel => kernel.name === 'trellis.dinov3.block3.attention.score'), true);
assert.equal(kernels.some(kernel => kernel.name === 'trellis.dinov3.block3.mlp-up'), true);
assert.equal(destroyed.includes('trellis.dinov3.block3.attention.scores-f32'), true,
  'the 16×1029×1029 attention-score buffer must be released before the next layer');
assert.equal(destroyed.includes('trellis.dinov3.block3.mlp.gelu-output'), true,
  'the expanded 1029×4096 MLP buffer must be released before the next layer');
assert.equal(destroyedUniformBuffers.some(label => label.startsWith('trellis.dinov3.block3.')), true,
  'per-block uniform buffers must be retired after their commands are submitted');
assert.equal(destroyed.includes(block.tensor.name), false, 'the completed block output must remain resident for the next block');

await assert.rejects(() => runTrellisDinoV3FinalNoAffineLayerNormResident({ runtime, inputTensor:block.tensor }), /output of DINO block 23/,
  'the full-conditioning endpoint must reject an earlier transformer layer');
const finalInput = tensor('trellis.dinov3.block23.mlp.residual-output');
const finalNorm = await runTrellisDinoV3FinalNoAffineLayerNormResident({
  runtime,
  inputTensor: finalInput,
  schedulerInvocation: { id: 'contract-test' },
  releaseInput: true,
  managedTensorBuffers: true,
});
assert.equal(finalNorm.operation, 'dinov3-final-no-affine-layernorm-conditioning-features');
assert.deepEqual(finalNorm.tensor.shape, [1, 1029, 1024]);
assert.equal(finalNorm.tensor.dtype, 'f32');
assert.equal(finalNorm.tensor.ownsBuffer, false, 'the session route owns runtime context; conditioner output uses caller-owned buffer lifetime');
assert.equal(destroyed.includes(finalInput.name), true);
assert.equal(destroyed.includes(finalNorm.tensor.name), false, 'the full conditioning output must remain resident for its consumer');
assert.equal(destroyedUniformBuffers.includes('trellis.dinov3.final-no-affine-layernorm.resident-dims'), true);
const finalKernel=kernels.find(kernel=>kernel.name==='trellis.dinov3.final-no-affine-layernorm');
assert.ok(finalKernel);
assert.equal(finalKernel.code.includes('norm_weight'), false,
  'final model LayerNorm is no-affine and must not synthesize trainable scale or bias');

const failedManagedBuffers=[];
const failingRuntime={
  createTensor(input) { return { ...input,buffer:input.buffer||{destroy(){failedManagedBuffers.push(input.name);}},ownsBuffer:!input.buffer }; },
  createManagedBuffer({label}) { return {label,destroy(){failedManagedBuffers.push(label);} }; },
  uploadTensor() {},
  createUniformBuffer({label}) { return {label,buffer:{destroy(){}}}; },
  defineComputeKernel(input) { return input; },
  async runKernel() { throw new Error('simulated queue submission failure'); },
};
const beforeFailedAttention=failedManagedBuffers.length;
await assert.rejects(()=>runTrellisDinoV3Block1AttentionResident({
  runtime:failingRuntime,device:{limits:{maxComputeWorkgroupsPerDimension:65535}},
  inputTensor:tensor('failed.block1.attention.input'),residualTensor:tensor('failed.block1.attention.residual'),
  qWeight:attentionMatrix,qBias:channel,kWeight:attentionMatrix,vWeight:attentionMatrix,vBias:channel,
  oWeight:attentionMatrix,oBias:channel,layerScale1:channel,ropeCos:rope,ropeSin:rope,
  managedTensorBuffers:true,releaseTransientTensors:true,releaseConsumedTensors:true,
}),/simulated queue submission failure/);
assert.equal(failedManagedBuffers.length>beforeFailedAttention,true);
assert.equal(failedManagedBuffers.includes('trellis.dinov3.block1.attention.residual-output'),true,
  'a failed attention submission must release its would-be resident output instead of leaking it');

const beforeFailedMlp=failedManagedBuffers.length;
await assert.rejects(()=>runTrellisDinoV3Block1MlpResident({
  runtime:failingRuntime,inputTensor:tensor('failed.block1.mlp.input'),residualTensor:tensor('failed.block1.mlp.residual'),
  norm2Weight:channel,norm2Bias:channel,mlpUpWeight:mlpMatrix,mlpUpBias:vector,
  mlpDownWeight:mlpMatrix,mlpDownBias:channel,layerScale2:channel,
  managedTensorBuffers:true,releaseTransientTensors:true,releaseConsumedTensors:true,
}),/simulated queue submission failure/);
assert.equal(failedManagedBuffers.length>beforeFailedMlp,true);
assert.equal(failedManagedBuffers.includes('trellis.dinov3.block1.mlp.residual-output'),true,
  'a failed MLP submission must release its would-be resident output instead of leaking it');
