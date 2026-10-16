import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as vm from 'node:vm';
import { webcrypto } from 'node:crypto';

if (!vm.SourceTextModule) {
  const child = spawnSync(process.execPath, ['--experimental-vm-modules', fileURLToPath(import.meta.url)], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  console.log(child.stdout.trim());
} else {
  // Only external execution/loading boundaries are simulated. The three owned
  // production modules and their public factories execute unchanged in the VM.
  let clock = 0;
  let loads = 0;
  let acquired = 0;
  let invocationIndex = 0;
  const attentionCalls = [];
  const observed = {};
  let brokenOutput = null;
  function readback(name, data) {
    if (brokenOutput?.name !== name) return Array.from(data);
    if (brokenOutput.kind === 'missing') return undefined;
    if (brokenOutput.kind === 'short') return [0];
    return Array.from(data, (_, index) => index === 0 ? NaN : data[index]);
  }
  const advance = amount => { clock += amount; };
  const channels = 256;
  const queryTokens = 6;
  const multiplexCount = 16;
  const fpnLevels = [4, 2, 1].map((scaleFactor, level) => ({ level, scaleFactor, height: 2 * scaleFactor, width: 3 * scaleFactor }));
  const shape = {
    batch: 1, channels, multiplexCount, queryHeight: 2, queryWidth: 3, queryTokens,
    maskHeight: 8, maskWidth: 12, sourceImageHeight: 28, sourceImageWidth: 42,
    sourceMaskHeight: 32, sourceMaskWidth: 48, promptMaskHeight: 8, promptMaskWidth: 12,
    decoderMaskHeight: 8, decoderMaskWidth: 12, memoryInputMaskHeight: 32, memoryInputMaskWidth: 48,
    memorySpatialTokens: queryTokens, numObjPtrTokens: 16, memoryTokens: queryTokens + 16,
  };
  const entry = (role, extra = {}) => ({ role, sha256: `sha256:${role}`, shape: [1, 1, 1, 1], ...extra });
  const ingressWeights = ['patch-embed-projection-weight', 'vit-position-embeddings', 'vit-backbone-layernorm-weight', 'vit-backbone-layernorm-bias'];
  for (let index = 0; index < 32; index += 1) {
    for (const suffix of ['layernorm1-weight', 'layernorm1-bias', ...['q', 'k', 'v', 'o'].flatMap(name => [`${name}-proj-weight`, `${name}-proj-bias`]), 'layernorm2-weight', 'layernorm2-bias', 'mlp-fc1-weight', 'mlp-fc1-bias', 'mlp-fc2-weight', 'mlp-fc2-bias']) ingressWeights.push(`vit-block-stack-layer${index}-${suffix}`);
  }
  for (const branch of ['interactive', 'propagation']) {
    for (let level = 0; level < 3; level += 1) {
      for (const part of [...Array.from({ length: 2 - level }, (_, index) => `scale-${index}`), 'proj1', 'proj2']) {
        ingressWeights.push(`${branch}-level-${level}-${part}-weight`, `${branch}-level-${level}-${part}-bias`);
      }
    }
  }
  for (const level of ['s0', 's1']) ingressWeights.push(`decoder-high-resolution-${level}-weight`, `decoder-high-resolution-${level}-bias`);
  const memoryWeights = ['memory-mask-final-weight', 'memory-mask-final-bias', 'memory-feature-projection-weight', 'memory-feature-projection-bias', 'memory-no-object-spatial-embedding'];
  for (let index = 0; index < 4; index += 1) for (const part of ['conv', 'norm']) for (const suffix of ['weight', 'bias']) memoryWeights.push(`memory-downsample-${index}-${part}-${suffix}`);
  for (let index = 0; index < 2; index += 1) {
    for (const part of ['depthwise', 'norm', 'pointwise-1', 'pointwise-2']) for (const suffix of ['weight', 'bias']) memoryWeights.push(`memory-fuser-${index}-${part}-${suffix}`);
    memoryWeights.push(`memory-fuser-${index}-scale`);
  }
  const attentionWeights = ['final-norm-weight', 'final-norm-bias'];
  for (let index = 0; index < 4; index += 1) for (const part of ['norm1', 'self-q', 'self-k', 'self-v', 'self-out', 'norm2', 'cross-q', 'cross-k', 'cross-v', 'cross-out', 'image-cross-q', 'image-cross-k', 'norm3', 'linear1', 'linear2']) for (const suffix of ['weight', 'bias']) attentionWeights.push(`layer-${index}-${part}-${suffix}`);
  const reference = { model: { id: 'facebook/sam3.1', revision: 'cpu-contract-fixture' } };
  const manifests = {
    ingress: {
      schema: 'kaminos.sam31-two-image-ingress-meta-packet.v0', reference,
      shape: { imageHeight: 28, imageWidth: 42, imageChannels: 3, patchSize: 14, patchHeight: 2, patchWidth: 3, patchTokens: queryTokens, visionHiddenSize: 1024, visionHeads: 16, visionWindowSize: 24, visionMlpHidden: 4096, fpnLevels },
      sourceImages: [{ rgbaSha256: 'sha256:frame0' }, { rgbaSha256: 'sha256:frame1' }],
      tensors: [entry('frame-0-rgba'), entry('frame-1-rgba')],
      weights: ingressWeights.map(role => entry(role, role === 'vit-position-embeddings' ? { shape: [1, 5, 1024] } : {})),
    },
    episode: {
      schema: 'kaminos.sam31-two-image-tracker-meta-packet.v0', reference, shape,
      plan: { numFrames: 2, numMaskmem: 7, maxConditioningFrames: 4, maxObjectPointerFrames: 2, memoryTemporalStride: 1, useMaskmemTemporalPositionV2: true },
      stateTransition: { conditioningObjects: Array.from({ length: multiplexCount }, (_, index) => index) },
      tensors: ['frame-0-extra-per-object-embedding', 'frame-1-extra-per-object-embedding', 'frame-0-binary-mask-inputs'].map(role => entry(role)),
    },
    decoder: { reference, shape: { channels, multiplexCount, maskOutputsPerObject: 3 }, weights: [] },
    memory: { reference, shape: { memory: { featureChannels: channels, multiplexCount, conditionChannels: true } }, config: {}, weights: memoryWeights.map(role => entry(role)) },
    temporal: { tensors: ['maskmem-temporal-embeddings', 'pointer-position-projection-weight', 'pointer-position-projection-bias'].map(role => entry(role)), attentionWeights: attentionWeights.map(role => entry(role)) },
    pointer: { reference, shape: { ...shape, batch: multiplexCount, imageHeight: 2, imageWidth: 3 }, weights: [] },
  };
  const runtime = {
    packageId: 'cpu-model', invocationId: 'cpu-invocation', verificationId: null, verificationAttached: false, manifests,
    packageResolution: {
      schema: 'kaminos.sam31-browser-tracker-package-invocation-evidence.v0', packageId: 'cpu-model', invocationId: 'cpu-invocation',
      modelPackage: { schema: 'kaminos.sam31-browser-tracker-model-package.v0', sha256: 'model', effectiveSha256: 'model' },
      invocation: { schema: 'kaminos.sam31-browser-tracker-invocation.v0', sha256: 'invocation', effectiveSha256: 'invocation' }, verification: { attached: false },
    },
    async loadFloat32(tensor) {
      assert.ok(tensor, 'fixture must supply every requested tensor');
      advance(1);
      return new Float32Array(tensor.role === 'vit-position-embeddings' ? 5 * 1024 : 1);
    },
    async loadUint8(tensor) { advance(1); return new Uint8Array([tensor.role === 'frame-0-rgba' ? 0 : 1]); },
    cacheEvidence: () => ({}),
  };
  let resolveLost;
  const device = { queue: { async onSubmittedWorkDone() {} }, lost: new Promise(resolve => { resolveLost = resolve; }), destroy() { resolveLost({ reason: 'destroyed' }); } };
  const adapter = { info: { description: 'simulated-cpu', vendor: 'test' }, isFallbackAdapter: false, async requestDevice() { acquired += 1; advance(10); return device; } };
  const gpu = { async requestAdapter() { advance(10); return adapter; } };
  const inferenceSession = {
    sessionId: 'cpu-resident', adapter, device, deviceLost: device.lost,
    snapshot: () => ({ status: 'active' }),
    async registerRoute({ routeId }) { return { routeId }; },
    async drain() { return {}; }, unregisterRoute: () => ({ status: 'detached' }),
    close() { device.destroy(); return { status: 'closed' }; },
  };
  const modelResources = { ...runtime, residentTensorResolver: () => ({}), bind() {}, evidence: () => ({ resourceCount: 0, resources: [], allocationCount: 0, uploadCount: 0 }), release: () => ({ status: 'released' }) };
  async function outputs(input, debugReadback) {
    advance(10);
    const digestRoles = { 'sam31-mask-conditioning-logits': 'maskLogits', 'sam31-mask-conditioning-object-scores': 'objectScores', 'sam31-interactive-object-pointers': 'objectPointers' };
    const rows = await Promise.all(input.request.outputs.map(async output => {
      const { role } = output;
      const data = debugReadback[digestRoles[role]];
      const digest = data ? await webcrypto.subtle.digest('SHA-256', data) : null;
      const sha256 = digest ? `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}` : `sha256:${role}`;
      return { ...output, role, sha256 };
    }));
    return { receipt: { status: 'real', requestedRouteId: input.route.routeId, effectiveRouteId: input.route.routeId, backend: { kind: 'webgpu-local', runtime: 'browser' }, outputs: rows }, debugReadback };
  }
  const values = length => Float32Array.from({ length }, (_, index) => index / 100);
  const feature = () => values(queryTokens * channels);
  const routeMocks = {
    'sam-image-preprocess-phase-program.js': { runSam3ImagePreprocessPhaseProgramRoute: async input => outputs(input, { pixelValues: values(28 * 42 * 3) }) },
    'sam-image-patch-embed-phase-program.js': { runSam3ImagePatchEmbedPhaseProgramRoute: async input => outputs(input, { patchEmbeddings: values(queryTokens * 1024) }) },
    'sam-image-vit-prefix-phase-program.js': { runSam3ImageVitPrefixPhaseProgramRoute: async input => outputs(input, { vitPrefixHiddenStates: values(queryTokens * 1024) }) },
    'sam-image-vit-block-stack-phase-program.js': { runSam3ImageVitBlockStackPhaseProgramRoute: async input => outputs(input, { vitBlockStackHiddenStates: values(queryTokens * 1024) }) },
    'sam-image-fpn-neck-phase-program.js': Object.fromEntries(['interactive', 'propagation'].map(branch => [`runSam31${branch === 'interactive' ? 'Interactive' : 'ImagePropagation'}NeckPhaseProgramRoute`, async input => outputs(input, Object.fromEntries([...fpnLevels.map((level, index) => [`${branch}Feature${index}`, values(level.height * level.width * channels)]), [`${branch}Position2`, feature()]]))])),
    'sam31-decoder-high-resolution-projection-phase-program.js': { runSam31DecoderHighResolutionProjectionPhaseProgramRoute: async input => outputs(input, { highResolutionS0: values(32 * 8 * 12), highResolutionS1: values(64 * 4 * 6) }) },
    'sam31-mask-conditioning-phase-program.js': { runSam31MaskConditioningPhaseProgramRoute: async input => outputs(input, { maskLogits: values(multiplexCount * 32 * 48), objectScores: values(multiplexCount) }) },
    'sam31-interactive-pointer-phase-program.js': { runSam31InteractivePointerPhaseProgramRoute: async input => outputs(input, { objectPointers: values(multiplexCount * channels) }) },
    'sam31-memory-encoder-phase-program.js': { runSam31MemoryEncoderPhaseProgramRoute: async input => outputs(input, { memoryFeatures: feature(), memoryPositionEncoding: feature() }) },
    'sam31-temporal-memory-bank-phase-program.js': { runSam31TemporalMemoryBankPhaseProgramRoute: async input => outputs(input, { memoryImage: values(shape.memoryTokens * channels), memory: values(shape.memoryTokens * channels), memoryImagePosition: values(shape.memoryTokens * channels), memoryPosition: values(shape.memoryTokens * channels) }) },
    'sam31-memory-attention-phase-program.js': { runSam31MemoryAttentionPhaseProgramRoute: async input => {
      attentionCalls.push(input);
      observed.conditionedFeatures = feature();
      return outputs(input, { memory: readback('conditionedFeatures', observed.conditionedFeatures) });
    } },
    'sam31-multiplex-mask-decoder-phase-program.js': { runSam31MultiplexMaskDecoderPhaseProgramRoute: async input => {
      const dims = input.tensors.shape;
      assert.deepEqual(Array.from(dims ? [dims.maskHeight, dims.maskWidth] : []), [8, 12]);
      observed.selectedMasks = values(multiplexCount * dims.maskHeight * dims.maskWidth);
      observed.objectScores = values(multiplexCount);
      observed.objectPointers = values(multiplexCount * channels);
      return outputs(input, Object.fromEntries(['selectedMasks', 'objectScores', 'objectPointers'].map(name => [name, readback(name, observed[name])])));
    } },
  };
  const mocks = {
    ...routeMocks,
    'sam31-browser-tracker-package-runtime.js': {
      async loadSam31BrowserTrackerPackageRuntime() { loads += 1; advance(100); return runtime; },
      async loadSam31BrowserTrackerModelPackageRuntime() { loads += 1; advance(100); return runtime; },
    },
    'sam31-browser-tracker-caller-invocation.js': {
      async createSam31BrowserTrackerCallerInvocationRuntime() {
        advance(25);
        const invocationId = `cpu-invocation:${invocationIndex++}`;
        return { ...runtime, invocationId, packageResolution: { ...runtime.packageResolution, invocationId } };
      },
    },
    'inference-session.js': { async createWebGpuInferenceSession() { acquired += 1; advance(20); return inferenceSession; } },
    'sam31-resident-model-resources.js': { async createSam31ResidentModelResources() { advance(50); return modelResources; } },
  };
  const context = vm.createContext({ console, Float32Array, Uint8Array, TextEncoder, crypto: webcrypto, performance: { now: () => clock } });
  const modules = new Map();
  const owned = new Set(['sam31-browser-tracker-session.js', 'sam31-browser-tracker-session-driver.js', 'sam31-two-image-backbone.js']);
  async function load(url) {
    if (modules.has(url.href)) return modules.get(url.href);
    const name = url.pathname.split('/').at(-1);
    let module;
    if (owned.has(name)) module = new vm.SourceTextModule(await readFile(url, 'utf8'), { context, identifier: url.href });
    else {
      const namespace = { ...await import(url.href), ...mocks[name] };
      module = new vm.SyntheticModule(Object.keys(namespace), function () { for (const [key, value] of Object.entries(namespace)) this.setExport(key, value); }, { context, identifier: url.href });
    }
    modules.set(url.href, module);
    return module;
  }
  const sessionModule = await load(new URL('../src/sam31-browser-tracker-session.js', import.meta.url));
  await sessionModule.link((specifier, parent) => load(new URL(specifier, parent.identifier)));
  await sessionModule.evaluate();
  const { createSam31BrowserTrackerSession, createSam31BrowserTrackerResidentSession } = sessionModule.namespace;
  const options = { packageRoot: '/simulated-package', cache: {}, gpu };

  for (const memoryAttentionKernel of ['bogus', null, '', 0]) {
    await assert.rejects(() => createSam31BrowserTrackerSession({ ...options, memoryAttentionKernel }), /memoryAttentionKernel/);
    await assert.rejects(() => createSam31BrowserTrackerResidentSession({ modelPackageRoot: '/simulated-model', cache: {}, gpu, memoryAttentionKernel }), /memoryAttentionKernel/);
  }
  for (const captureOutputs of [null, 'true', 1]) {
    await assert.rejects(() => createSam31BrowserTrackerSession({ ...options, captureOutputs }), /captureOutputs/);
    await assert.rejects(() => createSam31BrowserTrackerResidentSession({ modelPackageRoot: '/simulated-model', cache: {}, gpu, captureOutputs }), /captureOutputs/);
  }
  const driver = modules.get(new URL('../src/sam31-browser-tracker-session-driver.js', import.meta.url).href).namespace.runSam31BrowserTrackerPackageInvocation;
  await assert.rejects(() => driver({ memoryAttentionKernel: 'fallback' }), /memoryAttentionKernel/);
  await assert.rejects(() => driver({ captureOutputs: 1 }), /captureOutputs/);
  assert.equal(loads, 0, 'invalid options must fail before package I/O');
  assert.equal(acquired, 0, 'invalid options must fail before device acquisition');
  for (const name of ['packageRuntime', 'executionContext', 'executeInvocation', 'modelPackageRuntime', 'callerInvocationRuntime', 'decodeImage']) await assert.rejects(() => createSam31BrowserTrackerSession({ ...options, [name]: {} }), new RegExp(`does not accept ${name}`));
  for (const name of ['modelPackageRuntime', 'inferenceSession', 'ownerRoute', 'residentResources', 'createCallerRuntime', 'executeInvocation', 'decodeImage']) await assert.rejects(() => createSam31BrowserTrackerResidentSession({ [name]: {} }), new RegExp(`does not accept ${name}`));

  function checkResult(result, mode, capture) {
    assert.equal(attentionCalls.at(-1).attentionKernel, mode, 'selector must reach the actual memory route call');
    assert.equal(attentionCalls.at(-1).captureIntermediateReadbacks, false, 'verification-free tracking must not request layer diagnostic readbacks');
    assert.equal(attentionCalls.at(-1).includeReadback, true, 'the decoder still consumes the final conditioned features');
    assert.equal(result.memoryAttentionKernel, mode);
    assert.equal(result.outputs != null, capture);
    assert.equal(result.evidence.passed, true);
    assert.equal(result.receipts.length, 19);
    const timing = result.timing;
    assert.equal(timing.kind, 'host-wall');
    assert.equal(timing.backbonePrecomputesBothFrames, true);
    for (const value of [timing.episodeWallMs, timing.setupMs, timing.sessionSetupMs, timing.sessionRunWallMs, timing.frame0.conditioningWallMs, timing.frame1.propagationWallMs]) assert.ok(Number.isFinite(value) && value >= 0);
    assert.equal(timing.frame1.backboneMs, 60);
    assert.equal(timing.frame0.backboneMs, 70);
    assert.equal(timing.frame1.temporalBankMs, 10);
    assert.equal(timing.frame1.memoryAttentionMs, 10);
    assert.equal(timing.frame1.decoderMs, 10);
    assert.equal(timing.frame1.attributedTotalMs, 90);
    assert.equal(timing.frame1.memoryAttentionShare, 10 / 90);
    assert.equal(timing.frame0.conditioningWallMs, 32);
    assert.equal(timing.frame1.propagationWallMs, 34);
    for (const frame of [timing.backbone.frame0, timing.backbone.frame1]) {
      assert.equal(frame.trunk.totalMs, 40);
      for (const name of ['preprocessMs', 'patchEmbedMs', 'vitPrefixMs', 'vitBlockStackMs']) assert.equal(frame.trunk[name], 10);
    }
    assert.ok(timing.episodeWallMs >= timing.setupMs + timing.frame0.backboneMs + timing.frame1.attributedTotalMs);
    assert.ok(timing.sessionRunWallMs >= timing.episodeWallMs);
    assert.equal('fps' in timing.frame1, false);
    if (capture) {
      for (const [name, length, expectedShape] of [
        ['conditionedFeatures', queryTokens * channels, [1, queryTokens, channels]],
        ['selectedMasks', multiplexCount * 8 * 12, [multiplexCount, 1, 8, 12]],
        ['objectScores', multiplexCount, [multiplexCount, 1]],
        ['objectPointers', multiplexCount * channels, [multiplexCount, channels]],
      ]) {
        const output = result.outputs.frame1[name];
        assert.ok(output instanceof Float32Array);
        assert.equal(output.length, length);
        assert.deepEqual(output, observed[name], 'capture must preserve the executed readback, not a reference or projection');
        assert.deepEqual(Array.from(result.outputs.shapes.frame1[name]), expectedShape);
      }
    }
  }
  const defaultSession = await createSam31BrowserTrackerSession(options);
  const defaultResult = await defaultSession.run();
  checkResult(defaultResult, 'online', false);
  assert.equal(defaultResult.timing.sessionSetupMs, 120);
  assert.equal(defaultResult.timing.callerInvocationMs, 0);
  const onlineSession = await createSam31BrowserTrackerSession({ ...options, memoryAttentionKernel: 'online', captureOutputs: true });
  checkResult(await onlineSession.run(), 'online', true);
  const callerSession = await createSam31BrowserTrackerSession({ modelPackageRoot: '/simulated-model', cache: {}, gpu, sourceImages: ['a', 'b'], initialMask: {}, session: {}, memoryAttentionKernel: 'online', captureOutputs: true });
  const callerResult = await callerSession.run();
  checkResult(callerResult, 'online', true);
  assert.equal(callerResult.timing.sessionSetupMs, 145);
  const resident = await createSam31BrowserTrackerResidentSession({ modelPackageRoot: '/simulated-model', cache: {}, gpu, captureOutputs: true });
  const deviceCount = acquired;
  const residentResult = await resident.run();
  checkResult(residentResult, 'online', true);
  assert.equal(residentResult.timing.sessionSetupMs, 170);
  assert.equal(residentResult.timing.callerInvocationMs, 25);
  checkResult(await resident.run({ memoryAttentionKernel: 'online' }), 'online', true);
  checkResult(await resident.run({ captureOutputs: false }), 'online', false);
  assert.equal(acquired, deviceCount, 'per-run A/B must reuse the same device');
  assert.equal(attentionCalls.at(-1).device, attentionCalls.at(-2).device);
  const attempts = resident.attemptCount;
  const calls = attentionCalls.length;
  await assert.rejects(() => resident.run({ memoryAttentionKernel: 'fallback' }), /memoryAttentionKernel/);
  await assert.rejects(() => resident.run({ captureOutputs: 'yes' }), /captureOutputs/);
  assert.equal(resident.attemptCount, attempts);
  assert.equal(attentionCalls.length, calls);
  assert.equal(resident.status, 'open');
  for (const name of ['conditionedFeatures', 'selectedMasks', 'objectScores', 'objectPointers']) {
    for (const kind of ['missing', 'short', 'non-finite']) {
      brokenOutput = { name, kind };
      await assert.rejects(() => resident.run(), new RegExp(`${name}.*(readback|length)`));
    }
  }
  brokenOutput = null;
  checkResult(await resident.run(), 'online', true);
  const configuredResident = await createSam31BrowserTrackerResidentSession({ modelPackageRoot: '/simulated-model', cache: {}, gpu, memoryAttentionKernel: 'online' });
  checkResult(await configuredResident.run(), 'online', false);
  checkResult(await configuredResident.run({ memoryAttentionKernel: 'flash', captureOutputs: true }), 'flash', true);
  checkResult(await configuredResident.run(), 'online', false);
  await resident.close();
  console.log('sam3.1 public tracker per-frame selector/output/timing contracts passed (simulated CPU execution)');
}
