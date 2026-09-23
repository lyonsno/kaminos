import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const implementation = await readFile(new URL('../src/trellis-dinov3-prefix-block-phase-program.js', import.meta.url), 'utf8');
const referenceExporter = await readFile(new URL('../tools/trellis-dinov3-mlx-reference.py', import.meta.url), 'utf8');
const browserSmoke = await readFile(new URL('../smokes/trellis-dinov3-prefix-block-browser.html', import.meta.url), 'utf8');
const browserRunner = await readFile(new URL('../tools/trellis-dinov3-prefix-block-browser-parity-smoke.mjs', import.meta.url), 'utf8');
const parityAssay = await readFile(new URL('../tools/trellis-dinov3-prefix-block-parity-assay.mjs', import.meta.url), 'utf8');
const publicIndex = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
const { validateRouteDefinition } = await import('../src/index.js');

const residentRoute = await import('../src/trellis-dinov3-prefix-block-phase-program.js');
const kit = await import('../src/index.js');

assert.equal(
  residentRoute.TRELLIS_DINOV3_PREFIX_BLOCK_PHASE_PROGRAM_ROUTE_ID,
  'trellis2.dinov3.prefix-block0.phase-program.webgpu-local.v0',
  'the synthetic patch-only witness does not provide the checkpointed CLS/register/patch prefix and complete DINO block-0 route',
);

assert.equal(typeof residentRoute.runTrellisDinoV3PrefixBlockPhaseProgramRoute, 'function');
const route = residentRoute.createTrellisDinoV3PrefixBlockPhaseProgramRouteDefinition({
  kernel: { profile: 'trellis2-dinov3-prefix-block0-phase-program-v0', commit: 'contract-test' },
});
assert.equal(validateRouteDefinition(route).ok, true, 'the pinned DINOv3 prefix/block-0 route must satisfy the shared route contract');
assert.deepEqual(route.requiredInputRoles, [
  'source-image',
  'trellis-dinov3-normalized-pixels',
  'trellis-dinov3-checkpoint-tensors',
]);
assert.deepEqual(route.requiredOutputRoles, [
  'trellis-dinov3-patch-embeddings',
  'trellis-dinov3-prefix-hidden-states',
  'trellis-dinov3-block0-hidden-states',
]);
assert.equal(route.model.id, 'facebook/dinov3-vitl16-pretrain-lvd1689m');
assert.equal(route.model.revision, 'ea8dc2863c51be0a264bab82070e3e8836b02d51');
assert.equal(route.model.dtype, 'fp32', 'the route must not silently substitute a reduced-precision checkpoint');

const shape = {
  batch: 1, imageHeight: 512, imageWidth: 512, imageChannels: 3, patchSize: 16,
  patchHeight: 32, patchWidth: 32, patchTokens: 1024, prefixTokens: 5,
  tokenCount: 1029, hiddenSize: 1024, heads: 16, headDim: 64,
  intermediateSize: 4096, ropeTheta: 100, layerNormEpsilon: 1e-5,
};
const dispatch = residentRoute.createTrellisDinoV3PrefixBlockDispatchPlan({ shape });
assert.deepEqual(dispatch.layerNorm1, [1029], 'each token needs one full-width F32 LayerNorm group');
assert.equal(dispatch.attentionScore.length, 2, 'attention-score dispatch must span all 16 global attention matrices without imposing a token cap');
assert.ok(dispatch.attentionScore[0] * dispatch.attentionScore[1] * 64 >= 16 * 1029 * 1029);
assert.equal(dispatch.mlpUp[0] * dispatch.mlpUp[1] * 64 >= 1029 * 4096, true);

const prefix = residentRoute.createTrellisDinoV3PrefixCpuOracle({
  batch: 1, hiddenSize: 2, registerCount: 2, patchCount: 2,
  classToken: new Float32Array([10, 11]),
  registerTokens: new Float32Array([20, 21, 30, 31]),
  patchEmbeddings: new Float32Array([40, 41, 50, 51]),
});
assert.deepEqual(Array.from(prefix), [10, 11, 20, 21, 30, 31, 40, 41, 50, 51],
  'prefix order must be CLS, registers in checkpoint order, then row-major patch embeddings');
assert.match(implementation, /dtype: 'f32'/, 'runtime tensors must stay on the explicitly requested F32 route');
assert.match(implementation, /fp16 and implicit numeric conversion are not accepted/,
  'the route must reject reduced-precision or implicitly converted weight and pixel arrays');
assert.match(implementation, /finalNoAffineLayerNormApplied:false/,
  'block-0 output must remain before TRELLIS’ final no-affine LayerNorm');
assert.match(implementation, /attentionScores: tensor\('layer0\.attention-scores-f32'/,
  'global attention scores must use F32 storage for the full 1029-token sequence');
assert.match(referenceExporter, /EXPECTED_SOURCE_SHA256 = "abf395cc52d81c26dadae9f024072d6c7301679be4e8fc08d572723d7ae32a21"/,
  'MLX reference export must reject a different source image instead of relabeling its output');
assert.match(referenceExporter, /sourceFileSha256/,
  'the MLX reference must bind its exact native DINOv3 implementation bytes');
assert.ok(/residentProbeCompleteTransformerBlockCount": 1/.test(referenceExporter),
  'reference metadata must state how many complete transformer blocks precede the attention-only probe boundary');
assert.ok(/residentProbeOutputBoundary": "after complete layer\.0 and block1 attention residual; before block1 norm2 and final model LayerNorm"/.test(referenceExporter),
  'the attention-only probe boundary must be named separately from the full block-1 output');
assert.ok(/residentBlock1CompleteTransformerBlockCount": 2/.test(referenceExporter),
  'reference metadata must state that the full block-1 output includes two completed transformer blocks');
assert.ok(/residentBlock1OutputBoundary": "after complete layer\.0 and complete layer\.1; before final model LayerNorm"/.test(referenceExporter),
  'the full block-1 output boundary must remain explicit');
assert.equal(/"blockCount"\s*:/.test(referenceExporter), false,
  'an unqualified block count must not obscure that the packet also includes only a partial second block');
assert.equal(/"outputBoundary"\s*:/.test(referenceExporter), false,
  'an unqualified output boundary must not collapse the attention-only and full block-1 outputs');
assert.ok(/complete MLP residual/.test(referenceExporter),
  'the exporter documentation must describe the full block-1 tensor packet as well as the attention-only probe');
assert.match(browserSmoke, /dcb2e45127cccbf1601e5f42fef165eea275c8e5213197e8dcf3f48822718179/,
  'the browser comparison must reject a checkpoint other than the pinned HF safetensors file');
assert.match(browserSmoke, /shaderF16Requested:false/,
  'the matched browser route must not request or silently use shader-f16');
assert.match(browserSmoke, /effectiveRouteId !== route\.routeId/,
  'fallback or substituted effective WebGPU routes cannot count as parity');
assert.match(browserSmoke, /maxAbs, meanAbs: sumAbs \/ actual\.length, rmse/,
  'each stage comparison must report auditable tensor-difference statistics');
assert.match(browserRunner, /expectedBytes=outputSizes\[name\.replace\(/,
  'missing or partial WebGPU tensors must not be persisted as successful evidence');
assert.match(browserRunner, /request\.headers\['x-output-sha256'\]!==sha256/,
  'persisted browser outputs must be byte-hash verified by the runner');
assert.match(browserRunner, /browserState\?\.mode!==mode/,
  'the runner must reject a stale/default browser page that silently ignored the requested smoke mode');
assert.match(browserRunner, /browserState\?\.requestedRouteId!==requestedRouteId/,
  'the runner must reject a browser page that exercised another effective route');
assert.match(browserRunner, /block1Attention:1029\*1024\*4/,
  'the resident mode must require the exact full-size downstream F32 tensor rather than accepting a partial result');
assert.match(browserRunner, /block1MlpHidden:1029\*4096\*4/,
  'the resident full-block mode must require the exact 1029×4096 F32 GELU tensor');
assert.match(parityAssay, /\['block1Attention','block1Norm2','block1MlpHidden','block1MlpProjection','block1Output'\]/,
  'the full-block assay must reject missing raw GPU readbacks at every captured block-1 boundary');
assert.match(browserSmoke, /adapterClassification === 'software-fallback'/,
  'software WebGPU fallback cannot satisfy the resident GPU evidence route');
assert.match(browserSmoke, /finiteNonzeroCount === 0/,
  'blank/all-zero output cannot masquerade as completed downstream evidence');
assert.match(browserSmoke, /actual\?\.operation !== 'dinov3-block1-attention-residual'/,
  'the browser consumer must accept the operation returned by the block-1 attention-residual producer');
assert.match(browserRunner, /failure_phase:phase/,
  'the browser smoke must retain the last failure phase when it cannot complete');
assert.match(parityAssay, /receiver:args.get\('--receiver'\)/,
  'the long matched command must preserve its caller-provided completion receiver');
assert.doesNotMatch(implementation, /let patch\s*=/, 'WGSL must not use the reserved patch identifier');
assert.match(implementation, /profile:runtime\.profile/, 'the route receipt consumes the staged timing profile');
assert.match(parityAssay, /referenceManifest:resolve\(referenceDir,'reference-manifest\.json'\)/,
  'the durable start receipt must identify both reference and terminal evidence paths');
assert.match(parityAssay, /last trustworthy MLX reference remained valid/,
  'a WebGPU failure must preserve the MLX reference as last trustworthy evidence without implying parity');
const routeImplementation = implementation.slice(implementation.indexOf('async function runTrellisDinoV3PrefixBlockPhaseProgramRouteInternal'));
assert.equal(typeof residentRoute.createTrellisDinoV3ResidentProbeTransferMetadata, 'function');
assert.match(routeImplementation, /transfer:createTrellisDinoV3ResidentProbeTransferMetadata\(\{ residentBlock1Probe \}\)/,
  'the probe route must publish the same transfer metadata exercised by the mode-specific contract below');
const attentionOnlyTransfers=residentRoute.createTrellisDinoV3ResidentProbeTransferMetadata({residentBlock1Probe:false});
assert.equal(Object.hasOwn(attentionOnlyTransfers,'norm2ToMlp'),false,
  'attention-only mode must not claim a norm2-to-MLP transfer it never executes');
assert.equal(Object.hasOwn(attentionOnlyTransfers,'block1AttentionToNorm2'),false,
  'attention-only mode must not claim a block1 attention-to-norm2 transfer it never executes');
const fullBlockTransfers=residentRoute.createTrellisDinoV3ResidentProbeTransferMetadata({residentBlock1Probe:true});
assert.equal(fullBlockTransfers.block1AttentionToNorm2,'same-runtime-device-buffer');
assert.equal(fullBlockTransfers.norm2ToMlp,'same-runtime-device-buffer');
assert.equal(typeof residentRoute.runTrellisDinoV3Block1LayerNormResident, 'function');
assert.equal(typeof residentRoute.runTrellisDinoV3Block1AttentionResident, 'function');
assert.equal(typeof residentRoute.runTrellisDinoV3Block1MlpResident, 'function',
  'block-1 norm2, GELU MLP, and LayerScale residual must continue from the live attention-residual tensor');
assert.equal(typeof residentRoute.assertTrellisDinoV3ResidentMlpHandoffIdentity, 'function',
  'the MLP contract must keep the exact block-1 attention residual as both norm2 input and residual');
assert.equal(typeof residentRoute.runTrellisDinoV3PrefixBlockResidentHandoffProbe, 'function');
assert.equal(typeof residentRoute.runTrellisDinoV3PrefixBlockResidentBlock1Probe, 'function');
assert.equal(typeof residentRoute.assertTrellisDinoV3ResidentAttentionHandoffIdentity, 'function',
  'the model-local probe must validate the attention input and original block-0 residual as separate identities');
assert.equal(typeof kit.runTrellisDinoV3Block1LayerNormResident, 'undefined', 'the probe kernel remains model-specific rather than expanding the shared kit root API');
assert.equal(typeof kit.runTrellisDinoV3Block1AttentionResident, 'undefined', 'block-1 attention remains model-specific rather than expanding the shared kit root API');
assert.equal(typeof kit.runTrellisDinoV3Block1MlpResident, 'undefined', 'block-1 MLP remains model-specific rather than expanding the shared kit root API');
assert.equal(typeof kit.runTrellisDinoV3PrefixBlockResidentHandoffProbe, 'undefined', 'the diagnostic probe is not promoted to the common kit API');
assert.equal(typeof kit.runTrellisDinoV3PrefixBlockResidentBlock1Probe, 'undefined', 'the full block-1 diagnostic probe is not promoted to the common kit API');
assert.equal(typeof kit.runTrellisDinoV3PrefixBlockPhaseProgramRoute, 'undefined', 'the model-specific route stays out of the shared kit root API');
assert.doesNotMatch(publicIndex, /TRELLIS_DINOV3/, 'the model-specific route must not append DINOv3 symbols to the current shared root surface');
assert.equal(residentRoute.TRELLIS_DINOV3_PREFIX_BLOCK_RESIDENT_HANDOFF_PROBE_ROUTE_ID,
  'trellis2.dinov3.block0-to-block1-attention.resident-probe.webgpu-local.v0');
const block0Identity={name:'block0.live-gpu'};
const norm1Identity={name:'block1.norm1.live-gpu'};
assert.equal(residentRoute.assertTrellisDinoV3ResidentAttentionHandoffIdentity({
  residentHandoff:{inputTensor:norm1Identity,residualTensor:block0Identity},
  block0HiddenStates:block0Identity,
  block1Norm1HiddenStates:norm1Identity,
}),true,'attention must consume normalized block-0 while retaining the original block-0 residual');
assert.throws(()=>residentRoute.assertTrellisDinoV3ResidentAttentionHandoffIdentity({
  residentHandoff:{inputTensor:block0Identity,residualTensor:block0Identity},
  block0HiddenStates:block0Identity,
  block1Norm1HiddenStates:norm1Identity,
}),/block-1 norm1 output/,'raw block-0 must not substitute for the attention input after normalization');
assert.throws(()=>residentRoute.assertTrellisDinoV3ResidentAttentionHandoffIdentity({
  residentHandoff:{inputTensor:norm1Identity,residualTensor:norm1Identity},
  block0HiddenStates:block0Identity,
  block1Norm1HiddenStates:norm1Identity,
}),/block-0 residual/,'the attention residual must retain the exact live block-0 tensor');
const residentFilterIndex = routeImplementation.indexOf("program.phases.filter(phase => phase.name !== 'readback-trellis-dinov3-prefix-block0-outputs')");
const residentConsumerIndex = routeImplementation.indexOf('runTrellisDinoV3Block1LayerNormResident({');
const attentionConsumerIndex = routeImplementation.indexOf('runTrellisDinoV3Block1AttentionResident({');
const downstreamReadbackIndex = routeImplementation.indexOf("readback-dinov3-block1-attention-resident-probe");
assert.ok(residentFilterIndex >= 0 && residentConsumerIndex > residentFilterIndex,
  'the resident probe must omit the block-0 output-readback phase and consume block-0 in resident block-1 LayerNorm');
assert.ok(attentionConsumerIndex > residentConsumerIndex && downstreamReadbackIndex > attentionConsumerIndex,
  'block-1 attention must consume the resident LayerNorm result before the only diagnostic readback');
assert.match(routeImplementation.slice(residentConsumerIndex, residentConsumerIndex + 500), /runtime, inputTensor:tensors\.block0HiddenStates[\s\S]*schedulerInvocation:invocation/,
  'block-1 LayerNorm must receive the live runtime, block-0 GPU tensor, and current scheduler invocation');
assert.match(routeImplementation.slice(attentionConsumerIndex, attentionConsumerIndex + 900), /runtime,device:input\.device,inputTensor:norm1Output\.tensor,residualTensor:tensors\.block0HiddenStates[\s\S]*schedulerInvocation:invocation/,
  'block-1 attention must use the live normalized GPU tensor plus the exact block-0 residual on the same invocation');
assert.match(routeImplementation, /block0Readback:'skipped'/,
  'the explicit resident probe must report that block-0 was not read back to the host');
assert.match(referenceExporter, /block1_norm1_hidden_states = block1\.norm1\(block0_hidden_states\)[\s\S]*block1_attention_output = block1\.attention\(block1_norm1_hidden_states, cos, sin, model\.num_prefix_tokens\)[\s\S]*block1_after_attention_hidden_states = block0_hidden_states \+ block1_attention_output \* block1\.layer_scale1/,
  'the MLX reference must reproduce native DINOv3 block-1 attention and its LayerScale residual as the resident-consumer oracle');
assert.match(referenceExporter, /block1_norm2_hidden_states = block1\.norm2\(block1_after_attention_hidden_states\)[\s\S]*block1_mlp_hidden_states = mx\.gelu\(block1\.mlp\.up_proj\(block1_norm2_hidden_states\)\)[\s\S]*block1_mlp_output = block1\.mlp\.down_proj\(block1_mlp_hidden_states\)[\s\S]*block1_after_mlp_hidden_states = block1_after_attention_hidden_states \+ block1_mlp_output \* block1\.layer_scale2/,
  'the MLX reference must expose native block-1 norm2, GELU up/down projections, and the exact LayerScale residual');
assert.match(implementation, /trellis2\.dinov3\.block0-to-block1-full-block\.resident-probe\.webgpu-local\.v0/,
  'the full block-1 probe must have a route identity distinct from the attention-only probe');
assert.match(browserSmoke, /mode === 'resident-block1'/,
  'the browser harness must expose a separately named full block-1 mode');
assert.match(browserRunner, /resident-block1/,
  'the runner must validate and preserve the full block-1 mode rather than relabeling the attention-only route');
assert.match(parityAssay, /residentBlock1Probe/,
  'the composite same-job assay must require the full block-1 reference identity');
assert.match(browserSmoke, /runTrellisDinoV3PrefixBlockResidentHandoffProbe/,
  'the live browser witness must exercise the resident probe API');

const { WEBGPU_BUFFER_USAGE } = await import('../src/runtime-primitives.js');
const sourceTensor = { name:'block0.source', shape:[1,1029,1024], dtype:'f32', usage:WEBGPU_BUFFER_USAGE.storage, buffer:{} };
let residentKernel = null;
let residentDispatch = null;
let residentReadbacks = 0;
const residentRuntime = {
  createTensor(input) { return { ...input, buffer:{} }; },
  uploadTensor() {},
  createUniformBuffer(input) { return { ...input, buffer:{} }; },
  defineComputeKernel(input) { residentKernel=input; return input; },
  async runKernel(kernel, options) { residentDispatch={ kernel, options }; },
  async readTensor() { residentReadbacks+=1; return new ArrayBuffer(0); },
};
const residentLayerNorm = await residentRoute.runTrellisDinoV3Block1LayerNormResident({
  runtime:residentRuntime, inputTensor:sourceTensor,
  weight:new Float32Array(1024).fill(1), bias:new Float32Array(1024),
  schedulerInvocation:{ invocationId:'resident-contract-invocation' },
});
assert.equal(residentLayerNorm.inputTensor, sourceTensor, 'the consumer keeps the exact live block-0 tensor object');
assert.equal(residentKernel.bindings[0].resource, sourceTensor, 'the kernel binds block-0 GPU storage directly, without a host tensor copy');
assert.equal(residentDispatch.kernel, residentKernel);
assert.deepEqual(residentDispatch.options.dispatch, [1029]);
assert.equal(residentReadbacks, 0, 'resident consumer setup/dispatch must not require a host readback');
assert.deepEqual(residentLayerNorm.shape, [1,1029,1024]);

const norm1Tensor={name:'block1.norm1',shape:[1,1029,1024],dtype:'f32',usage:WEBGPU_BUFFER_USAGE.storage,buffer:{}};
const block1Stages=[];
const block1Kernels=[];
const block1Runtime={
  createTensor(input) { return { ...input,buffer:{} }; },
  uploadTensor() {},
  createUniformBuffer(input) { return { ...input,buffer:{} }; },
  defineComputeKernel(input) { block1Kernels.push(input); return input; },
  async runKernel(kernel,options) { block1Stages.push({kernel,options}); },
};
const block1LinearWeights={
  qWeight:new Float32Array(1024*1024),qBias:new Float32Array(1024),kWeight:new Float32Array(1024*1024),
  vWeight:new Float32Array(1024*1024),vBias:new Float32Array(1024),oWeight:new Float32Array(1024*1024),
  oBias:new Float32Array(1024),layerScale1:new Float32Array(1024),
  ropeCos:new Float32Array(1024*64),ropeSin:new Float32Array(1024*64),
};
const residentAttention=await residentRoute.runTrellisDinoV3Block1AttentionResident({
  runtime:block1Runtime,inputTensor:norm1Tensor,residualTensor:sourceTensor,...block1LinearWeights,
  schedulerInvocation:{invocationId:'resident-contract-invocation'},
});
assert.equal(residentAttention.inputTensor,norm1Tensor,'attention consumes the exact resident block-1 LayerNorm output');
assert.equal(residentAttention.residualTensor,sourceTensor,'attention residual uses the exact resident block-0 tensor');
assert.equal(residentAttention.tensor.usage & WEBGPU_BUFFER_USAGE.copySrc,WEBGPU_BUFFER_USAGE.copySrc,'only the final attention-residual output is eligible for diagnostic readback');
assert.equal(block1Stages.length,10,'block-1 attention dispatches q/k/v, RoPE, score, softmax, context, projection, and residual without an internal readback');
assert.deepEqual(block1Stages.map(({options})=>options.stage),[
  'dinov3-block1-qkv-projection-resident','dinov3-block1-qkv-projection-resident','dinov3-block1-qkv-projection-resident',
  'dinov3-block1-patch-rope-resident','dinov3-block1-patch-rope-resident',
  'dinov3-block1-global-attention-resident','dinov3-block1-global-attention-resident','dinov3-block1-global-attention-resident',
  'dinov3-block1-output-residual-resident','dinov3-block1-output-residual-resident',
]);
assert.equal(block1Kernels.find(kernel=>kernel.name.endsWith('attention.layer-scale-residual')).bindings[0].resource,sourceTensor,
  'the DINOv3 block-1 attention residual is rooted at the original block-0 hidden-state buffer');
assert.equal(residentAttention.operation,'dinov3-block1-attention-residual');
assert.deepEqual(residentAttention.shape,[1,1029,1024]);

const mlpStages=[];
const mlpKernels=[];
const mlpRuntime={
  createTensor(input) { return { ...input,buffer:{} }; },
  uploadTensor() {},
  createUniformBuffer(input) { return { ...input,buffer:{} }; },
  defineComputeKernel(input) { mlpKernels.push(input); return input; },
  async runKernel(kernel,options) { mlpStages.push({kernel,options}); },
};
const mlpPhaseEvents=[];
const mlpWeights={
  norm2Weight:new Float32Array(1024).fill(1),norm2Bias:new Float32Array(1024),
  mlpUpWeight:new Float32Array(4096*1024),mlpUpBias:new Float32Array(4096),
  mlpDownWeight:new Float32Array(1024*4096),mlpDownBias:new Float32Array(1024),
  layerScale2:new Float32Array(1024),
};
const residentMlp=await residentRoute.runTrellisDinoV3Block1MlpResident({
  runtime:mlpRuntime,device:{limits:{maxComputeWorkgroupsPerDimension:65535}},
  inputTensor:residentAttention.tensor,residualTensor:residentAttention.tensor,...mlpWeights,
  schedulerInvocation:{invocationId:'resident-contract-invocation'},
  onPhase:event=>mlpPhaseEvents.push(event.phase),
});
assert.equal(residentMlp.inputTensor,residentAttention.tensor,'norm2 consumes the exact live attention-residual tensor');
assert.equal(residentMlp.residualTensor,residentAttention.tensor,'the MLP residual uses that same attention-residual tensor');
assert.equal(residentMlp.tensor.usage & WEBGPU_BUFFER_USAGE.copySrc,WEBGPU_BUFFER_USAGE.copySrc,
  'the final MLP-residual output can be read back only after the resident chain');
assert.equal(mlpStages.length,4,'block-1 MLP submits norm2, GELU up projection, down projection, then LayerScale residual');
assert.deepEqual(mlpStages.map(({options})=>options.stage),[
  'dinov3-block1-layernorm2-resident','dinov3-block1-mlp-up-resident',
  'dinov3-block1-mlp-down-resident','dinov3-block1-mlp-residual-resident',
]);
assert.deepEqual(mlpPhaseEvents,mlpStages.map(({options})=>options.stage),
  'failure progress must name each exact resident block-1 MLP stage before dispatch');
assert.deepEqual(residentMlp.mlpHiddenTensor.shape,[1,1029,4096]);
assert.match(mlpKernels.find(kernel=>kernel.name.endsWith('mlp-up')).code,/gelu_exact_approx/,
  'the MLP up projection must use the F32 GELU shader law');
assert.equal(mlpKernels.find(kernel=>kernel.name.endsWith('norm2')).bindings[0].resource,residentAttention.tensor,
  'block-1 norm2 reads the resident attention residual directly');
assert.equal(mlpKernels.find(kernel=>kernel.name.endsWith('mlp-up')).bindings[0].resource,residentMlp.norm2Tensor,
  'the GELU up projection consumes the resident norm2 output');
assert.equal(mlpKernels.find(kernel=>kernel.name.endsWith('mlp-up')).bindings[3].resource,residentMlp.mlpHiddenTensor,
  'the GELU up projection writes the resident intermediate tensor');
assert.equal(mlpKernels.find(kernel=>kernel.name.endsWith('mlp-down')).bindings[0].resource,residentMlp.mlpHiddenTensor,
  'the down projection consumes the GELU-activated resident intermediate');
assert.equal(mlpKernels.find(kernel=>kernel.name.endsWith('mlp.layer-scale-residual')).bindings[0].resource,residentAttention.tensor,
  'block-1 MLP LayerScale residual is rooted at the exact attention-residual tensor');
assert.equal(residentRoute.assertTrellisDinoV3ResidentMlpHandoffIdentity({
  residentMlp,attentionResidual:residentAttention.tensor,
}),true);
assert.throws(()=>residentRoute.assertTrellisDinoV3ResidentMlpHandoffIdentity({
  residentMlp:{...residentMlp,inputTensor:sourceTensor},attentionResidual:residentAttention.tensor,
}),/exact live block-1 attention residual/);
await assert.rejects(()=>residentRoute.runTrellisDinoV3Block1MlpResident({
  runtime:mlpRuntime,inputTensor:residentAttention.tensor,residualTensor:residentAttention.tensor,
  ...mlpWeights,mlpUpWeight:new Uint16Array(4096*1024),
}),/block1MlpUpWeight must be a Float32Array/,
'the resident MLP must reject reduced-precision checkpoint weights rather than silently converting them');

console.log('TRELLIS DINOv3 prefix/block-0 phase-program contracts passed');
