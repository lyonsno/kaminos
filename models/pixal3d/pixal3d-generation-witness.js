import { createWebGpuInferenceSession } from '../../webgpu-inference-kit/src/core.js';
import {
  createPixal3dImageGenerationAdapter,
  pixal3dGenerationPipelineType,
} from './pixal3d-generation.js';
import {
  loadPixal3dGenerationInputs,
  validatePixal3dGenerationInputs,
} from './generation-inputs.js';
import {
  PIXAL3D_GENERATION_ROUTE,
  admitPixal3dGenerationGpuBudget,
  validatePixal3dGenerationResult,
} from './generation-witness-checks.js';
import { createPixal3dAssetAdapter } from './pixal3d-mesh.js';
import {
  validateNativePrefixBackend,
  prefixAdapterName,
} from '../trellis2/sparse-prefix-witness-checks.js';
import { observeDeviceMemory } from '../trellis2/device-memory.js';
import { createTrellisSharedHost } from '../trellis2/shared-host.js';
import {
  generationTensorStorage,
  readGenerationTensor,
} from '../trellis2/generation-storage.js';

const hash = async data =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), v =>
    v.toString(16).padStart(2, '0'),
  ).join('');

export const PIXAL3D_REQUIRED_STAGES = Object.freeze([
  'dinov3-serving-patch-embedding',
  'dinov3-serving-prefix-assembly',
  'dinov3-final-no-affine-layernorm-resident',
  'naf-encoder-1x1-0',
  'naf-concat-pool-rope',
  'naf-keys-pool',
  'naf-neighborhood-cross-attention',
  'pixal3d-global-conditioning',
  'pixal3d-proj-grid-sample',
  'flow-resident-conditioning-bf16',
  'cross-proj-linear',
  'block-modulation',
  'terminal-output-projection',
  'decoder-sparse-conv',
  'slat-coordinate-rope',
  'slat-texture-concat',
]);

export const PIXAL3D_KERNEL_EVENT_BATCH_SIZE = 2048;

export function createPixal3dKernelPhaseBuffer({
  report,
  postPhase,
  batchSize = PIXAL3D_KERNEL_EVENT_BATCH_SIZE,
}) {
  if (!report || typeof report !== 'object') {
    throw new TypeError('generation witness report object required');
  }
  if (typeof postPhase !== 'function') {
    throw new TypeError('generation phase persistence callback required');
  }
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new RangeError('positive integer kernel event batch size required');
  }
  const pending = [];
  let nextSeq = 0;
  const snapshot = () =>
    pending.map(entry => ({
      ...entry,
      kernel: {
        ...entry.kernel,
        dispatch: Array.isArray(entry.kernel?.dispatch) ? [...entry.kernel.dispatch] : entry.kernel?.dispatch,
      },
    }));
  const flush = async () => {
    if (!pending.length) return;
    const count = pending.length;
    const kernels = pending.slice(0, count);
    await postPhase({ kernels });
    pending.splice(0, count);
  };
  const recordKernel = async kernel => {
    report.lastKernel = kernel;
    pending.push({
      seq: ++nextSeq,
      phase: report.phase,
      modelRole: report.loadingModelRole ?? null,
      kernel,
      observedAt: new Date().toISOString(),
    });
    if (pending.length >= batchSize) {
      await flush();
    }
  };
  const savePhase = async extra => {
    await flush();
    await postPhase(extra);
  };
  return Object.freeze({
    get pendingCount() {
      return pending.length;
    },
    snapshot,
    flush,
    recordKernel,
    savePhase,
  });
}

export async function runPixal3dGenerationWitness(
  expectedSha,
  {
    memoryMonitor = false,
    sharedComposition,
    assetMode = 'raw-glb',
    gpuBufferBudgetBytes,
    decoderActivationStorage,
  } = {},
) {
  const report = {
    status: 'failed',
    phase: 'input-manifest',
    requestedRoute: PIXAL3D_GENERATION_ROUTE,
    numericalStatus: 'not-compared',
    comparison:
      'actual WebGPU Pixal3D image generation with retained prepared pixels and browser noise; no matched MLX fidelity claim',
    outputs: {},
  };
  const errors = [];
  let session;
  let device;
  let implementation;
  let assetConsumer;
  let runtime;
  let scope = false;
  let invocationOwner;
  let serving = false;
  let currentPhase = 'new';
  let memory;
  let bridge;
  let sharedRun;
  report.memory = { requested: memoryMonitor };
  report.assetMode = assetMode;

  const setPhase = (phase, modelRole) => {
    report.phase = phase;
    memory?.setPhase(modelRole ? `${phase}:${modelRole}` : phase);
  };
  const stageCounts = {};
  const save = async (name, values, shape, dtype) => {
    const response = await fetch('/output/' + name, {
      method: 'POST',
      headers: { 'X-Tensor-Dtype': dtype },
      body: values,
    });
    if (!response.ok) throw new Error('complete raw output not saved ' + name);
    await response.text();
    report.outputs[name] = {
      shape,
      dtype,
      byteLength: values.byteLength,
      sha256: await hash(values),
      finite: values.every(Number.isFinite),
    };
  };
  const postPhase = async extra => {
    const saved = await fetch('/phase', {
      method: 'POST',
      body: JSON.stringify({
        phase: report.phase,
        effectiveRoute: report.effectiveRoute,
        sessionId: session.snapshot().sessionId,
        modelRole: report.loadingModelRole ?? null,
        verifiedTensorCount: report.verifiedTensorCount,
        verifiedInputBytes: report.verifiedInputBytes,
        ...(memory ? { deviceMemory: memory.snapshot() } : {}),
        ...extra,
      }),
    });
    if (!saved.ok) {
      throw new Error('generation phase evidence not saved: ' + (await saved.text()));
    }
    await saved.text();
  };
  const phaseBuffer = createPixal3dKernelPhaseBuffer({ report, postPhase });
  const { flush: flushKernels, recordKernel, savePhase } = phaseBuffer;

  try {
    if (typeof memoryMonitor !== 'boolean') {
      throw new TypeError('explicit boolean memory-monitor selection required');
    }
    if (!['raw-glb', 'retained-fields-only'].includes(assetMode)) {
      throw new TypeError('explicit supported asset mode required');
    }
    if (sharedComposition && gpuBufferBudgetBytes !== undefined) {
      throw new Error(
        'GPU buffer budget currently requires an isolated owned device; borrowed host allocations must not be capped',
      );
    }
    const fetched = await fetch('/fixture/manifest.json', { cache: 'no-store' });
    if (!fetched.ok) throw new Error('Pixal3D generation inputs unavailable');
    const bytes = await fetched.arrayBuffer();
    if ((await hash(bytes)) !== expectedSha) throw new Error('changed generation manifest');
    const m = JSON.parse(new TextDecoder().decode(bytes));
    validatePixal3dGenerationInputs(m);
    report.referenceDecoderStorage = Object.fromEntries(
      ['shapeDecoder', 'textureDecoder'].map(role => [
        role,
        m.models[role].config.activationStorage ?? 'f32',
      ]),
    );
    if (decoderActivationStorage !== undefined) {
      if (!['f32', 'f16'].includes(decoderActivationStorage)) {
        throw new Error('f32 or f16 decoder activation storage required');
      }
      for (const role of ['shapeDecoder', 'textureDecoder']) {
        m.models[role].config.activationStorage = decoderActivationStorage;
      }
      validatePixal3dGenerationInputs(m);
    }
    setPhase('memory-budget-admission');
    report.memory.admission = admitPixal3dGenerationGpuBudget(m, gpuBufferBudgetBytes);
    const pipelineType = pixal3dGenerationPipelineType(m);
    const conditioningMode =
      m.conditioningMode ??
      (pipelineType === '1024_cascade' ? 'stage-specific-1024' : 'source-512');
    report.input = {
      manifestSha256: expectedSha,
      producer: m.producer,
      references: m.references,
      image: m.image,
      camera: m.camera,
      modelIdentities: Object.fromEntries(
        Object.entries(m.models).map(([k, v]) => [k, v.identity]),
      ),
      dinoIdentity: m.dino.identity,
      seed: m.seed,
      meshResolution: m.meshResolution,
      pipelineType,
      conditioningMode,
      samplingSteps: m.samplingSteps ?? 12,
    };
    report.verifiedTensorCount = 0;
    report.verifiedInputBytes = 0;
    report.verifiedDecodedBytes = 0;
    report.verifiedInputMeaning =
      'cumulative successful fetches/bytes, including repeated stage use; not resident memory';

    const fetchTensor = async name => {
      const row = m.tensors[name];
      if (!row) throw new Error('complete identified input required ' + name);
      const storage = generationTensorStorage(row);
      report.inputLoading = {
        tensor: name,
        ...storage,
        decodedByteLength: row.byteLength,
        decodedSha256: row.sha256,
        ...(report.loadingModelRole ? { modelRole: report.loadingModelRole } : {}),
        phase: 'fetch',
      };
      const values = await readGenerationTensor(row, {
        fetchFile: file => fetch('/fixture/' + file, { cache: 'no-store' }),
        hash,
        onPhase: phase => {
          report.inputLoading.phase = phase;
        },
      });
      report.verifiedTensorCount++;
      report.verifiedInputBytes += storage.byteLength;
      report.verifiedDecodedBytes += values.byteLength;
      return values;
    };

    setPhase('native-device');
    const adapter = sharedComposition
      ? sharedComposition.sharedGpu?.adapter
      : await navigator.gpu?.requestAdapter();
    if (!adapter) throw new Error('WebGPU unavailable');
    report.backend = {
      vendor: adapter.info.vendor,
      architecture: adapter.info.architecture,
      description: adapter.info.description,
      device: adapter.info.device,
      isFallbackAdapter: adapter.info.isFallbackAdapter ?? adapter.isFallbackAdapter,
    };
    validateNativePrefixBackend(report.backend);
    if (report.backend.isFallbackAdapter !== false) {
      throw new Error('explicit nonfallback native adapter required');
    }
    const limits = sharedComposition?.sharedGpu?.device?.limits ?? adapter.limits;
    report.requiredLimits = {
      maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
      maxBufferSize: limits.maxBufferSize,
      maxComputeWorkgroupsPerDimension: limits.maxComputeWorkgroupsPerDimension,
    };
    report.requiredFeatures = ['shapeDecoder', 'textureDecoder'].some(
      role => m.models[role].config.activationStorage === 'f16',
    )
      ? ['shader-f16']
      : [];
    if (
      report.requiredFeatures.some(
        feature => !(sharedComposition?.sharedGpu?.device?.features ?? adapter.features).has(feature),
      )
    ) {
      throw new Error('requested decoder activation storage requires shader-f16');
    }
    device = sharedComposition
      ? sharedComposition.sharedGpu.device
      : await adapter.requestDevice({
          requiredLimits: report.requiredLimits,
          requiredFeatures: report.requiredFeatures,
        });
    report.deviceTopology = sharedComposition ? 'same-device' : 'isolated-device';
    if (memoryMonitor || gpuBufferBudgetBytes !== undefined) {
      memory = observeDeviceMemory(device, { maxLiveBytes: gpuBufferBudgetBytes });
    }
    setPhase('native-device');
    device.pushErrorScope('validation');
    scope = true;
    device.addEventListener('uncapturederror', e => errors.push(e.error.message));
    device.lost.then(info => {
      if (info.reason !== 'destroyed') {
        errors.push('device lost: ' + info.reason + ' ' + info.message);
      }
    });
    const sessionId = 'pixal3d-image-generation-' + crypto.randomUUID();
    if (sharedComposition) {
      bridge = await createTrellisSharedHost({ ...sharedComposition, sessionId });
      session = bridge.session;
      sharedRun = await bridge.beginRun({ runId: sessionId });
    } else {
      session = await createWebGpuInferenceSession({
        sessionId,
        adapter,
        device,
        adapterName: prefixAdapterName(adapter.info),
      });
    }
    const actual =
      sharedRun?.route ??
      (await session.registerRoute({
        routeId: PIXAL3D_GENERATION_ROUTE,
        runtimeOptions: {
          requiredStages: PIXAL3D_REQUIRED_STAGES,
          kernel: { profile: 'pixal3d-complete-image-generation-v0' },
        },
      }));
    report.effectiveRoute = actual.routeId;
    if (actual.routeId !== PIXAL3D_GENERATION_ROUTE) {
      throw new Error('effective Pixal3D generation route mismatch');
    }
    runtime = {
      ...actual.runtime,
      async runKernel(k, o) {
        if (o.schedulerInvocation !== invocationOwner) {
          throw new Error('same generation invocation required');
        }
        await recordKernel({ stage: o.stage, dispatch: o.dispatch, point: 'before-native-kernel' });
        await actual.runtime.runKernel(k, o);
        const counts = (stageCounts[currentPhase] ??= {});
        counts[o.stage] = (counts[o.stage] ?? 0) + 1;
        await recordKernel({ stage: o.stage, dispatch: o.dispatch, point: 'native-kernel-returned' });
      },
      async readTensor(t, options) {
        if (serving && (t.dtype !== 'u32' || t.byteLength !== 4)) {
          throw new Error('learned-feature/coordinate CPU read during serving forbidden');
        }
        if (serving) {
          report.servingMetadataReadbackBytes = (report.servingMetadataReadbackBytes ?? 0) + 4;
        }
        return actual.runtime.readTensor(t, options);
      },
    };

    setPhase('cached-checkpoint-input-loading');
    const inputs = await loadPixal3dGenerationInputs(m, fetchTensor);
    report.checkpointLoading =
      'per-role uncached complete weights; flow blocks fetched/uploaded sequentially with queue drains; shared identity-checked activation tables';
    const onPhase = async e => {
      currentPhase = e.phase;
      setPhase(e.phase, e.modelRole);
      report.loadingModelRole = e.modelRole ?? null;
      await savePhase({ backend: report.backend, requiredLimits: report.requiredLimits });
    };
    implementation = createPixal3dImageGenerationAdapter({
      ...inputs,
      route: { ...actual, runtime },
      onPhase,
      async onNoiseInput(input) {
        await save('noise.' + input.stage, input.values, input.shape, 'f32');
        await savePhase({
          noiseInput: {
            stage: input.stage,
            ...report.outputs['noise.' + input.stage],
            source: input.source,
            seed: input.seed,
          },
        });
      },
    });
    setPhase('complete-image-generation');
    const started = performance.now();
    serving = true;
    const job = actual.enqueue({
      jobId: 'actual-pixal3d-image-to-geometry-material',
      execute: invocation => {
        invocationOwner = invocation;
        return implementation.run(invocation);
      },
    });
    const completed = await job.completion;
    serving = false;
    await flushKernels();
    report.hostElapsedMs = performance.now() - started;
    report.jobCompletion = {
      schema: completed.schema,
      routeId: completed.routeId,
      jobId: completed.jobId,
      status: completed.status,
      outputPresent: completed.outputPresent,
      failure: completed.failure,
      cancellation: completed.cancellation,
    };
    for (const [name, n] of Object.entries(implementation.noiseInputs)) {
      if (!report.outputs['noise.' + name]) {
        await save('noise.' + name, n.values, n.shape, 'f32');
      }
    }
    if (completed.status !== 'succeeded') {
      const error = new Error(
        completed.failure?.message ?? 'actual Pixal3D image generation ' + completed.status,
      );
      error.name = completed.failure?.name ?? 'Error';
      throw error;
    }
    const out = completed.output;
    if (out !== implementation.outputs) {
      throw new Error('actual complete Pixal3D generation output identity required');
    }
    report.composition = {
      dinoBlocksExecuted: out.dino.blocksExecuted,
      ...(out.highResolutionDino
        ? { highResolutionDinoBlocksExecuted: out.highResolutionDino.blocksExecuted }
        : {}),
      lowResolutionRows: out.lowResolutionRows,
      highResolutionRows: out.highResolutionRows,
      phases: out.phases.map(p => p.phase),
      sameInvocation: true,
      featureBytesToCPUDuringServing: out.featureBytesToCPUDuringServing,
      coordinateBytesToCPUDuringServing: out.coordinateBytesToCPUDuringServing,
      stageCounts,
      sessionId: session.snapshot().sessionId,
      geometryResolution: out.geometry.resolution,
      materialResolution: out.material.resolution,
      pipelineType: out.pipelineType,
      conditioningMode: out.conditioningMode,
      camera: out.camera,
      geometryLevels: out.geometry.levels,
      materialLevels: out.material.levels,
      decoderActivationStorage: {
        shape: out.geometry.activationStorage,
        texture: out.material.activationStorage,
      },
    };
    setPhase('post-model-observation-retention');
    const fields = {
      conditioning: out.conditioning,
      ...(out.highResolutionConditioning
        ? { highResolutionConditioning: out.highResolutionConditioning }
        : {}),
      'geometry.features': out.geometry.features,
      'geometry.coordinates': out.geometry.coordinates,
      'material.features': out.material.features,
      'material.coordinates': out.material.coordinates,
      shapeCodes: out.shapeCodes,
      textureCodes: out.textureCodes,
    };
    for (const [i, t] of out.geometry.subdivisions.entries()) {
      fields['geometry.subdivision' + i] = t;
    }
    for (const [name, t] of Object.entries(fields)) {
      const raw = await runtime.readTensor(t);
      const data = t.dtype === 'i32' ? new Int32Array(raw) : new Float32Array(raw);
      await save(name, data, t.shape, t.dtype);
    }
    if (assetMode === 'raw-glb') {
      assetConsumer = createPixal3dAssetAdapter({
        runtime,
        geometry: out.geometry,
        material: out.material,
        provenance: {
          inputManifestSha256: expectedSha,
          route: actual.routeId,
          sessionId: session.snapshot().sessionId,
          modelIdentities: out.modelIdentities,
          pipelineType: out.pipelineType,
          conditioningMode: out.conditioningMode,
          camera: out.camera,
          input: 'actual current WebGPU Pixal3D image generation; exact borrowed geometry/material tensors',
          comparison: report.comparison,
        },
        async onPhase(e) {
          setPhase(e.phase, e.modelRole);
          await savePhase({ backend: report.backend, requiredLimits: report.requiredLimits });
        },
      });
      const asset = await assetConsumer.run();
      setPhase('post-model-asset-retention');
      const persisted = await fetch('/asset-output', { method: 'POST', body: asset.glb });
      if (!persisted.ok) throw new Error('learned Pixal3D PBR GLB was not saved');
      report.assetArtifact = await persisted.json();
      if (
        report.assetArtifact.sha256 !== (await hash(asset.glb)) ||
        report.assetArtifact.byteLength !== asset.glb.byteLength
      ) {
        throw new Error('partial/changed learned asset receipt');
      }
      report.assetHandoff = asset.handoff;
      report.assetPostprocess = {
        uv: asset.mesh.uvMetadata,
        material: asset.textures.metadata,
        textureSize: [asset.textures.width, asset.textures.height],
        coveredPixels: asset.textures.coveredPixels,
      };
    }
    setPhase('profile');
    report.profile = actual.runtime.finishProfile({
      requiredStages: PIXAL3D_REQUIRED_STAGES,
      evidence: { mode: 'live', source: 'actual-pixal3d-image-to-learned-fields' },
    });
    report.profileStatus = 'passed';
    const validation = await device.popErrorScope();
    scope = false;
    if (validation) errors.push(validation.message);
    if (errors.length) throw new Error(errors.join('\n'));
    report.status = 'succeeded';
    validatePixal3dGenerationResult(report, m);
    report.phase = null;
    report.handoff =
      assetMode === 'retained-fields-only'
        ? 'complete retained WebGPU Pixal3D learned fields; cleanup/UV/PBR finishing is a separate model-free consumer'
        : 'actual borrowed learned fields become retained Pixal3D PBR GLB; Kaminos inspection/placement/save/reopen outstanding';
  } catch (error) {
    report.status = 'failed';
    report.error = { name: error.name, message: error.message, stack: error.stack };
    report.lastGenerationPhase = implementation?.phase;
    if (error.memoryBudget) report.memory.refusal = error.memoryBudget;
    memory?.setPhase('failure-retention-readback');
    if (phaseBuffer.pendingCount > 0 && session && report.effectiveRoute) {
      try {
        await flushKernels();
      } catch (e) {
        report.retentionErrors ??= [];
        report.retentionErrors.push(e.message);
      }
    }
    if (phaseBuffer.pendingCount > 0) {
      report.unflushedKernelEvents = phaseBuffer.snapshot();
    }
    if (implementation) {
      serving = false;
      for (const [name, n] of Object.entries(implementation.noiseInputs)) {
        if (!report.outputs['noise.' + name]) {
          try {
            await save('noise.' + name, n.values, n.shape, 'f32');
          } catch (e) {
            report.retentionErrors ??= [];
            report.retentionErrors.push(e.message);
          }
        }
      }
    }
    if (implementation?.conditioning && !report.outputs.conditioning) {
      try {
        const t = implementation.conditioning;
        await save('conditioning', new Float32Array(await runtime.readTensor(t)), t.shape, 'f32');
      } catch (e) {
        report.retentionErrors ??= [];
        report.retentionErrors.push(e.message);
      }
    }
    if (implementation?.highResolutionConditioning && !report.outputs.highResolutionConditioning) {
      try {
        const t = implementation.highResolutionConditioning;
        await save(
          'highResolutionConditioning',
          new Float32Array(await runtime.readTensor(t)),
          t.shape,
          'f32',
        );
      } catch (e) {
        report.retentionErrors ??= [];
        report.retentionErrors.push(e.message);
      }
    }
    report.stageCounts = stageCounts;
  } finally {
    memory?.setPhase('cleanup');
    if (scope) {
      try {
        const e = await device.popErrorScope();
        if (e) errors.push(e.message);
      } catch (e) {
        errors.push(e.message);
      }
    }
    report.errors = errors;
    if (errors.length) report.status = 'failed';
    if (sharedRun) {
      try {
        report.sharedRelease = await sharedRun.finish();
      } catch (error) {
        report.cleanupErrors ??= [];
        report.cleanupErrors.push({ name: 'shared-run', message: error.message });
        report.status = 'failed';
      }
    }
    const held = sharedRun && report.sharedRelease?.status !== 'released';
    for (const [name, cleanup] of held
      ? []
      : [
          ['asset', () => assetConsumer?.dispose()],
          ['generation', () => implementation?.dispose()],
          [
            'session',
            async () => {
              if (bridge) await bridge.dispose();
              else if (session) {
                await session.drain();
                session.close();
              }
            },
          ],
          [
            'device',
            () => {
              if (!sharedComposition) device?.destroy();
            },
          ],
        ]) {
      try {
        await cleanup();
      } catch (error) {
        report.cleanupErrors ??= [];
        report.cleanupErrors.push({ name, message: error.message });
        report.status = 'failed';
      }
    }
  }
  if (memory) {
    report.memory.device = memory.snapshot();
    report.memory.deviceEvents = [...memory.events];
    memory.restore();
  } else if (memoryMonitor) {
    report.memory.status = 'unavailable';
    report.memory.error = 'device allocation observer was not installed';
  }
  return report;
}
