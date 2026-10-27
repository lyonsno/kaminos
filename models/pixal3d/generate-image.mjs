#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  validatePixal3dGenerationInputs,
  loadPixal3dGenerationInputs,
} from './generation-inputs.js';
import {
  createPixal3dImageGenerationAdapter,
  pixal3dGenerationPipelineType,
} from './pixal3d-generation.js';
import { createPixal3dAssetAdapter } from './pixal3d-mesh.js';
import {
  PIXAL3D_DEFAULT_FOV_RAD,
  computePixal3dDistanceFromFov,
} from './proj-grid.js';
import { createGenerationCommandRunner } from '../trellis2/generate-image.mjs';
import { validateMetalFinishing } from '../trellis2/metal-remesh-finishing.mjs';
import { startProcessMemory } from '../trellis2/process-memory.mjs';
import { gitSourceIdentity } from '../trellis2/source-attestation.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export const PIXAL3D_LOCAL_CONFIG_SCHEMA = 'pixal3d.local-generation-config.v0';

export function resolvePixal3dGenerationFinishing(c = {}) {
  const cleanupMode = c.cleanupMode ?? 'reference-cleanup';
  if (!['reference-cleanup', 'mlx-surface-preserving', 'source-metal-remesh'].includes(cleanupMode)) {
    throw new Error('supported cleanup mode required');
  }
  const separate =
    c.finishingSourceRoot !== undefined || c.expectedFinishingSourceCommit !== undefined;
  if (
    separate &&
    (typeof c.finishingSourceRoot !== 'string' ||
      !path.isAbsolute(c.finishingSourceRoot) ||
      !/^[a-f0-9]{40}$/.test(c.expectedFinishingSourceCommit ?? ''))
  ) {
    throw new Error('paired exact finishing source root and commit required');
  }
  const selected = {
    sourceRoot: separate ? c.finishingSourceRoot : c.sourceRoot,
    expectedSourceCommit: separate ? c.expectedFinishingSourceCommit : c.expectedSourceCommit,
    cleanupMode,
  };
  if (cleanupMode === 'source-metal-remesh') {
    selected.metalFinishing = validateMetalFinishing(c.metalFinishing);
    selected.python = c.metalFinishing.python;
    selected.textureSize = c.textureSize;
  }
  return selected;
}

export function validatePixal3dLocalGenerationConfig(c) {
  if (c?.schema !== PIXAL3D_LOCAL_CONFIG_SCHEMA) {
    throw new Error('identified Pixal3D local generation config required');
  }
  for (const key of [
    'repoRoot',
    'checkpointBase',
    'python',
    'memoryPython',
    'sourceRoot',
    'chrome',
    'greenroomBin',
    'queueDir',
  ]) {
    if (typeof c[key] !== 'string' || !path.isAbsolute(c[key])) {
      throw new Error('explicit absolute ' + key + ' required');
    }
  }
  for (const key of ['expectedCommit', 'expectedSourceCommit']) {
    if (!/^[a-f0-9]{40}$/.test(c[key] ?? '')) {
      throw new Error('exact ' + key + ' required');
    }
  }
  if (
    !['512', '1024_cascade'].includes(c.pipelineType) ||
    !['f32', 'f16'].includes(c.decoderActivationStorage)
  ) {
    throw new Error('explicit supported pipeline and decoder storage required');
  }
  const cascade = c.pipelineType === '1024_cascade';
  const conditioningMode =
    c.conditioningMode ?? (cascade ? 'stage-specific-1024' : 'source-512');
  const validCondModes = cascade
    ? ['stage-specific-1024', 'shared-512-preview']
    : ['source-512'];
  if (!validCondModes.includes(conditioningMode)) {
    throw new Error(`unsupported conditioningMode ${conditioningMode} for ${c.pipelineType}`);
  }
  for (const key of ['steps', 'targetFaces', 'gpuBufferBudgetMiB', 'processMemoryBudgetMiB']) {
    if (!Number.isSafeInteger(c[key]) || c[key] < 1) {
      throw new Error('positive explicit ' + key + ' required');
    }
  }
  for (const key of ['gpuBufferBudgetMiB', 'processMemoryBudgetMiB']) {
    if (!Number.isSafeInteger(c[key] * 1048576)) {
      throw new Error('representable ' + key + ' required');
    }
  }
  if (!Number.isInteger(c.seed) || c.seed < 0 || c.seed > 0xffffffff) {
    throw new Error('unsigned32 source seed required');
  }
  const cameraAngleX = c.cameraAngleX ?? PIXAL3D_DEFAULT_FOV_RAD;
  const meshScale = c.meshScale ?? 1.0;
  computePixal3dDistanceFromFov({ cameraAngleX, meshScale, imageResolution: 512 });

  if (c.cleanupMode === 'source-metal-remesh') {
    if (!Number.isSafeInteger(c.textureSize) || c.textureSize < 1) {
      throw new Error('positive Metal texture size required');
    }
  } else if (c.textureSize !== undefined && c.textureSize !== 1024) {
    throw new Error('this finishing route supports 1024 textures; requested size cannot be ignored');
  }
  if (
    c.preparedPackageRoot !== undefined &&
    (typeof c.preparedPackageRoot !== 'string' || !path.isAbsolute(c.preparedPackageRoot))
  ) {
    throw new Error('explicit absolute preparedPackageRoot required');
  }
  resolvePixal3dGenerationFinishing(c);
  return c;
}

export async function runPixal3dNativeGeneration({
  route,
  manifest,
  fetchTensor,
  assetMode = 'raw-glb',
  unwrapMesh,
  uvUnwrapper,
  bakeMaterial,
  WorkerClass,
  postprocessMesh,
  textureSize = 1024,
  provenance = {},
  onPhase,
  onNoiseInput,
} = {}) {
  if (!route?.runtime) throw new TypeError('registered WebGPU route required');
  if (!['raw-glb', 'retained-fields-only'].includes(assetMode)) {
    throw new TypeError('explicit supported assetMode required');
  }
  validatePixal3dGenerationInputs(manifest);
  const inputs = await loadPixal3dGenerationInputs(manifest, fetchTensor);
  const implementation = createPixal3dImageGenerationAdapter({
    route,
    ...inputs,
    onPhase,
    onNoiseInput,
  });
  let consumer = null;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    try {
      consumer?.dispose();
    } finally {
      implementation.dispose();
    }
  };

  try {
    let completedOutput;
    if (typeof route.enqueue === 'function') {
      const job = route.enqueue({
        jobId: 'pixal3d-image-to-geometry-material',
        execute: invocation => implementation.run(invocation),
      });
      const completed = await job.completion;
      if (completed.status !== 'succeeded') {
        const err = new Error(completed.failure?.message ?? 'Pixal3D image generation ' + completed.status);
        err.name = completed.failure?.name ?? 'Error';
        throw err;
      }
      completedOutput = completed.output;
    } else {
      completedOutput = await implementation.run();
    }
    if (completedOutput !== implementation.outputs) {
      throw new Error('complete Pixal3D generation output identity required');
    }

    let asset = null;
    if (assetMode === 'raw-glb') {
      consumer = createPixal3dAssetAdapter({
        runtime: route.runtime,
        geometry: completedOutput.geometry,
        material: completedOutput.material,
        unwrapMesh: unwrapMesh ?? uvUnwrapper,
        bakeMaterial,
        WorkerClass,
        postprocessMesh,
        textureSize,
        provenance: {
          route: route.routeId,
          pipelineType: pixal3dGenerationPipelineType(manifest),
          modelIdentities: completedOutput.modelIdentities,
          ...provenance,
        },
        onPhase,
      });
      try {
        asset = await consumer.run();
      } finally {
        consumer.dispose();
        consumer = null;
      }
    }

    return Object.freeze({
      generation: completedOutput,
      asset,
      noiseInputs: implementation.noiseInputs,
      get disposed() {
        return disposed;
      },
      dispose,
    });
  } catch (error) {
    dispose();
    throw error;
  }
}

export async function generatePixal3dImage(values, deps = {}) {
  if (!values.report || !values.output) throw new Error('explicit output and report required');
  const output = path.resolve(values.output);
  const reportPath = path.resolve(values.report);
  const out = path.dirname(reportPath);
  const runId = values['run-id'] ?? randomUUID();
  const work = path.join(out, 'pixal3d-runs', runId);
  if (!/^[\w-]+$/.test(runId)) throw new Error('safe explicit run identity required');
  await fs.mkdir(work, { recursive: true });
  const report = {
    schema: 'kaminos.pixal3d-generation.v0',
    ok: false,
    status: 'running',
    phase: 'configuration',
    runId,
    output,
    work,
    commands: [],
    startedAt: new Date().toISOString(),
    backend: { modelFamily: 'Pixal3D', runtime: 'browser-webgpu' },
  };
  const persist = () => fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  let monitor;
  await persist();
  try {
    const configRaw = await fs.readFile(values.config);
    const c = validatePixal3dLocalGenerationConfig(JSON.parse(configRaw));
    if (values['expected-config-sha256'] && sha(configRaw) !== values['expected-config-sha256']) {
      throw new Error('generation config changed while queued');
    }
    const ownRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
    if (c.repoRoot !== ownRoot) {
      throw new Error('effective generation repo root differs from config');
    }
    const sourceIdentity = (deps.gitSourceIdentity ?? gitSourceIdentity)(ownRoot);
    if (sourceIdentity.commit !== c.expectedCommit || sourceIdentity.dirty) {
      throw new Error('exact clean generation source required');
    }
    const cascade = c.pipelineType === '1024_cascade';
    const effectiveConditioningMode =
      c.conditioningMode ?? (cascade ? 'stage-specific-1024' : 'source-512');
    const effectiveCameraAngleX = c.cameraAngleX ?? PIXAL3D_DEFAULT_FOV_RAD;
    const effectiveMeshScale = c.meshScale ?? 1.0;

    report.source = { repoRoot: ownRoot, ...sourceIdentity };
    report.config = {
      ...c,
      conditioningMode: effectiveConditioningMode,
      cameraAngleX: effectiveCameraAngleX,
      meshScale: effectiveMeshScale,
      sha256: sha(configRaw),
    };
    const runner = (deps.createGenerationCommandRunner ?? createGenerationCommandRunner)({
      cwd: ownRoot,
      record: report,
      persist,
    });
    monitor = await (deps.startProcessMemory ?? startProcessMemory)({
      python: c.memoryPython,
      script: path.join(ownRoot, 'models/trellis2/process-memory.py'),
      rawPath: path.join(work, 'process-memory.jsonl'),
      maxFootprintBytes: c.processMemoryBudgetMiB * 1048576,
      onUnsafe: reason => runner.stop(reason),
    });
    if (!values.input) throw new Error('selected input image required');
    const input = path.resolve(values.input);
    const bytes = await fs.readFile(input);
    const inputSha = sha(bytes);
    if (values['expected-input-sha256'] && inputSha !== values['expected-input-sha256']) {
      throw new Error('selected input changed while queued');
    }
    report.input = { path: input, sha256: inputSha, byteLength: bytes.length };
    const prepared = path.join(
      c.preparedPackageRoot ?? path.join(path.dirname(c.checkpointBase), 'pixal3d-image-packages'),
      runId,
    );
    report.preparedPackageRoot = prepared;
    report.phase = 'image-preparation';
    await persist();
    await runner.run(
      [
        c.python,
        '-B',
        path.join(ownRoot, 'models/pixal3d/pack-generation.py'),
        '--repo-root',
        ownRoot,
        '--expected-commit',
        c.expectedCommit,
        '--pixal-ckpts',
        c.checkpointBase,
        '--naf-weights',
        c.nafWeights ?? path.join(c.sourceRoot, 'weights/naf_release.safetensors'),
        '--dino-weights',
        c.dinoWeights,
        '--image',
        input,
        '--out',
        prepared,
        '--pipeline-type',
        c.pipelineType,
        '--conditioning-mode',
        effectiveConditioningMode,
        '--steps',
        String(c.steps),
        '--seed',
        String(c.seed),
        '--camera-angle-x',
        String(effectiveCameraAngleX),
        '--mesh-scale',
        String(effectiveMeshScale),
      ],
      'Pixal3D package preparation',
    );

    const manifestPath = path.join(prepared, 'manifest.json');
    const manifestRaw = await fs.readFile(manifestPath);
    const manifest = JSON.parse(manifestRaw);
    validatePixal3dGenerationInputs(manifest);
    if (
      manifest.pipelineType !== c.pipelineType ||
      manifest.conditioningMode !== effectiveConditioningMode ||
      manifest.samplingSteps !== c.steps ||
      manifest.seed !== c.seed ||
      Math.abs((manifest.camera?.cameraAngleX ?? NaN) - effectiveCameraAngleX) > 1e-6 ||
      Math.abs((manifest.camera?.meshScale ?? NaN) - effectiveMeshScale) > 1e-6
    ) {
      throw new Error('packaged manifest configuration disagrees with requested config');
    }
    report.package = {
      manifestPath,
      manifestSha256: sha(manifestRaw),
      pipelineType: manifest.pipelineType,
      conditioningMode: manifest.conditioningMode,
      samplingSteps: manifest.samplingSteps,
      seed: manifest.seed,
      camera: manifest.camera,
    };

    report.phase = 'webgpu-generation';
    await persist();
    const fetchDiskTensor = async name => {
      const row = manifest.tensors?.[name];
      if (!row) throw new Error('missing packaged tensor descriptor ' + name);
      const buf = await fs.readFile(path.join(prepared, row.file));
      return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    };
    const executeGeneration =
      deps.executeGeneration ??
      (async () => {
        if (!deps.route) {
          throw new Error(
            'registered WebGPU route required to execute Pixal3D generation after package preparation',
          );
        }
        const nativeRes = await runPixal3dNativeGeneration({
          route: deps.route,
          manifest,
          fetchTensor: fetchDiskTensor,
          assetMode: 'raw-glb',
          unwrapMesh: deps.unwrapMesh,
          bakeMaterial: deps.bakeMaterial,
          WorkerClass: deps.WorkerClass,
          postprocessMesh: deps.postprocessMesh,
          textureSize: c.textureSize ?? 1024,
          onPhase: async e => {
            if (e?.phase) {
              report.phase = e.phase;
              await persist();
            }
          },
        });
        try {
          if (!(nativeRes.asset?.glb instanceof ArrayBuffer) || nativeRes.asset.glb.byteLength < 12) {
            throw new Error('complete finished GLB buffer required from native generation');
          }
          await fs.mkdir(path.dirname(output), { recursive: true });
          const pending = output + '.pending-' + runId;
          await fs.writeFile(pending, Buffer.from(nativeRes.asset.glb));
          await fs.rename(pending, output);
          return { routeId: deps.route.routeId ?? 'injected-route' };
        } finally {
          nativeRes.dispose();
        }
      });

    const execInfo = await executeGeneration({
      manifest,
      manifestPath,
      prepared,
      output,
      config: report.config,
      fetchTensor: fetchDiskTensor,
      runner,
    });
    const glbBytes = await fs.readFile(output);
    const magic = glbBytes.length >= 4 ? glbBytes.readUInt32LE(0) : 0;
    if (magic !== 0x46546c67 || glbBytes.length < 20) {
      throw new Error('complete valid binary glTF (.glb) output required before reporting success');
    }
    report.memory = await monitor.stop();
    monitor = undefined;
    if (report.memory?.status && report.memory.status !== 'observed') {
      throw new Error('complete process-memory observation required before publication');
    }
    if (report.safety) {
      throw new Error('generation halted before publication');
    }
    report.artifact = {
      path: output,
      sha256: sha(glbBytes),
      byteLength: glbBytes.length,
      role: 'textured-mesh',
    };
    if (execInfo) report.execution = execInfo;
    report.ok = true;
    report.status = 'succeeded';
    report.phase = null;
  } catch (error) {
    report.ok = false;
    report.status = 'failed';
    report.error = { message: error.message, stack: error.stack };
  } finally {
    if (monitor) {
      try {
        report.memory = await monitor.stop();
        if ((report.memory?.status && report.memory.status !== 'observed') || report.safety) {
          report.ok = false;
          report.status = 'failed';
        }
      } catch (e) {
        report.ok = false;
        report.status = 'failed';
        report.memoryError = e.message;
      }
    }
    report.finishedAt = new Date().toISOString();
    await persist();
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: Object.fromEntries(
      [
        'input',
        'output',
        'report',
        'config',
        'run-id',
        'expected-config-sha256',
        'expected-input-sha256',
      ].map(k => [k, { type: 'string' }]),
    ),
  });
  const result = await generatePixal3dImage(values);
  console.log(
    JSON.stringify({
      ok: result.ok,
      phase: result.phase,
      error: result.error,
      artifact: result.artifact,
    }),
  );
  process.exitCode = result.ok ? 0 : 1;
}
