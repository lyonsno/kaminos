import { buildPixal3dNafPlan, pixal3dNafWeightShapes } from './naf.js';
import { buildPixal3dBlockPlan, pixal3dBlockWeightShapes } from './pixal3d-block.js';
import {
  PIXAL3D_DEFAULT_FOV_RAD,
  computePixal3dDistanceFromFov,
} from './proj-grid.js';
import {
  pixal3dGenerationPipelineType,
  pixal3dGenerationRoles,
} from './pixal3d-generation.js';
import {
  buildSparseDecoderPlan,
  sparseDecoderWeightShapes,
  buildSLatDecoderPlan,
  slatDecoderWeightShapes,
} from '../trellis2/sparse-decoder.js';
import { generationTensorStorage } from '../trellis2/generation-storage.js';

export const PIXAL3D_INPUT_SCHEMA = 'pixal3d.generation-inputs.v0';

export function pixal3dGenerationInputShapes(manifest = {}) {
  const c = 1024;
  const h = 4096;
  const models = {};
  for (const role of pixal3dGenerationRoles(manifest)) {
    const config = manifest.models?.[role]?.config;
    if (!config) throw new TypeError('complete model config required ' + role);
    if (role === 'naf') {
      models.naf = pixal3dNafWeightShapes(buildPixal3dNafPlan(config));
    } else if (['sparseFlow', 'lowResolutionShape', 'highResolutionShape', 'textureFlow'].includes(role)) {
      const projInChannels = config.projInChannels ?? (role === 'sparseFlow' ? 1024 : 2048);
      const p = buildPixal3dBlockPlan({
        ...config,
        contextRows: config.contextRows ?? 5,
        projInChannels,
        ...(role === 'sparseFlow' ? {} : { tokenRows: 1 }),
      });
      const channels = p.channels;
      const ci = role === 'sparseFlow' ? 8 : role === 'textureFlow' ? 64 : 32;
      const co = role === 'sparseFlow' ? 8 : 32;
      const shapes = {
        'prefix.input.weight': [channels, ci],
        'prefix.input.bias': [channels],
        'prefix.time0.weight': [channels, config.frequencyDim],
        'prefix.time0.bias': [channels],
        'prefix.time2.weight': [channels, channels],
        'prefix.time2.bias': [channels],
        'prefix.mod.weight': [6 * channels, channels],
        'prefix.mod.bias': [6 * channels],
        'terminal.weight': [co, channels],
        'terminal.bias': [co],
        gelu: [65536],
      };
      for (let i = 0; i < config.numBlocks; i++) {
        for (const [key, shape] of Object.entries(pixal3dBlockWeightShapes(p))) {
          shapes[`block${i}.${key}`] = shape;
        }
      }
      models[role] = shapes;
    } else if (role === 'occupancyDecoder') {
      models[role] = sparseDecoderWeightShapes(buildSparseDecoderPlan(config));
    } else {
      models[role] = slatDecoderWeightShapes(
        buildSLatDecoderPlan({
          ...config,
          tokenRows: 1,
          ...(role === 'shapeDecoder' ? { structureOnly: false } : {}),
          mode: role === 'textureDecoder' ? 'texture' : 'shape',
        }),
      );
    }
  }
  return {
    image512: [1, 512, 512, 3],
    image1024: [1, 1024, 1024, 3],
    models,
    phases: [4096, 64, 2],
    silu: [65536],
    dinoPrefix: {
      patchProjection: [1024, 16, 16, 3],
      patchBias: [1024],
      classToken: [1, 1, 1024],
      registerTokens: [1, 4, 1024],
      ropeCos: [1024, 64],
      ropeSin: [1024, 64],
    },
    dinoLayer: {
      norm1Weight: [c],
      norm1Bias: [c],
      qWeight: [c, c],
      qBias: [c],
      kWeight: [c, c],
      vWeight: [c, c],
      vBias: [c],
      oWeight: [c, c],
      oBias: [c],
      layerScale1: [c],
      norm2Weight: [c],
      norm2Bias: [c],
      mlpUpWeight: [h, c],
      mlpUpBias: [h],
      mlpDownWeight: [c, h],
      mlpDownBias: [c],
      layerScale2: [c],
    },
  };
}

export function validatePixal3dGenerationInputs(manifest) {
  return validatePixal3dGenerationPackage(manifest, true);
}

export function validatePixal3dGenerationCheckpoints(manifest) {
  return validatePixal3dGenerationPackage(manifest, false);
}

function validatePixal3dGenerationPackage(m, includeImage) {
  if (m?.schema !== PIXAL3D_INPUT_SCHEMA || m.status !== 'succeeded' || m.modelCalls !== 0) {
    throw new TypeError('successful model-free Pixal3D checkpoint package required');
  }
  const type = pixal3dGenerationPipelineType(m);
  const cascade = type === '1024_cascade';
  const conditioningMode =
    m.conditioningMode ?? (cascade ? 'stage-specific-1024' : 'source-512');
  const validCondModes = cascade
    ? ['stage-specific-1024', 'shared-512-preview']
    : ['source-512'];
  if (!validCondModes.includes(conditioningMode)) {
    throw new TypeError(`unsupported conditioningMode ${conditioningMode} for ${type}`);
  }
  const steps = m.samplingSteps ?? 12;
  if (
    m.meshResolution !== (type === '512' ? 512 : 1024) ||
    !Number.isSafeInteger(steps) ||
    steps < 1 ||
    !Number.isInteger(m.seed) ||
    m.seed < 0 ||
    m.seed > 0xffffffff
  ) {
    throw new TypeError('matching source pipeline/resolution/steps and unsigned32 seed required');
  }

  const cameraAngleX = m.camera?.cameraAngleX ?? PIXAL3D_DEFAULT_FOV_RAD;
  const meshScale = m.camera?.meshScale ?? 1.0;
  computePixal3dDistanceFromFov({ cameraAngleX, meshScale, imageResolution: 512 });

  const shapes = pixal3dGenerationInputShapes(m);
  const admitted = new Set();
  const tensor = (key, shape) => {
    const row = m.tensors?.[key];
    if (
      !row ||
      row.dtype !== 'float32' ||
      JSON.stringify(row.shape) !== JSON.stringify(shape) ||
      row.byteLength !== shape.reduce((n, x) => n * x, 4) ||
      !/^[a-f0-9]{64}$/.test(row.sha256 ?? '')
    ) {
      throw new TypeError('complete identified tensor required ' + key);
    }
    if (!/^[\w.-]+$/.test(row.file ?? '')) {
      throw new TypeError('safe tensor file required ' + key);
    }
    generationTensorStorage(row);
    admitted.add(key);
  };

  if (includeImage) {
    tensor(m.image?.dinoPixelTensor, shapes.image512);
    tensor(m.image?.rawImageTensor, shapes.image512);
    if (cascade && conditioningMode === 'stage-specific-1024') {
      tensor(m.image?.highResolutionDinoPixelTensor, shapes.image1024);
      tensor(m.image?.highResolutionRawImageTensor, shapes.image1024);
    }
  }

  if (
    !/^[a-f0-9]{64}$/.test(m.dino?.identity?.files?.['model.safetensors']?.sha256 ?? '') ||
    m.dino?.layers?.length !== 24
  ) {
    throw new TypeError('identified complete 24-layer DINO checkpoint required');
  }
  for (const [key, shape] of Object.entries(shapes.dinoPrefix)) {
    tensor(m.dino.prefix?.[key], shape);
  }
  for (const layer of m.dino.layers) {
    for (const [key, shape] of Object.entries(shapes.dinoLayer)) {
      tensor(layer?.[key], shape);
    }
  }

  if (cascade) {
    const identity = m.models.highResolutionShape?.identity?.sha256;
    if (!identity || identity === m.models.lowResolutionShape?.identity?.sha256) {
      throw new TypeError('separate high-resolution checkpoint required');
    }
    if (conditioningMode === 'stage-specific-1024') {
      const hrNaf = buildPixal3dNafPlan(m.models.naf?.highResolutionConfig ?? {});
      if (hrNaf.imageHeight !== 1024 || hrNaf.featureHeight !== 64) {
        throw new TypeError('stage-specific 1024_cascade requires 1024-pixel / 64x64 NAF highResolutionConfig');
      }
    }
  }

  for (const [role, weightShapes] of Object.entries(shapes.models)) {
    const model = m.models[role];
    if (!/^[a-f0-9]{64}$/.test(model?.identity?.sha256 ?? '')) {
      throw new TypeError('identified checkpoint required ' + role);
    }
    if (
      JSON.stringify(Object.keys(model.tensors ?? {}).sort()) !==
      JSON.stringify(Object.keys(weightShapes).sort())
    ) {
      throw new TypeError('complete parameter coverage required ' + role);
    }
    for (const [key, shape] of Object.entries(weightShapes)) {
      tensor(model.tensors[key], shape);
    }
    if (role === 'sparseFlow') tensor(model.phases, shapes.phases);
    if (role === 'shapeDecoder' || role === 'textureDecoder') {
      tensor(model.siluTable, shapes.silu);
    }
  }

  const geluHash = m.tensors[m.models.sparseFlow.tensors.gelu].sha256;
  const siluHash = m.tensors[m.models.shapeDecoder.siluTable].sha256;
  for (const role of pixal3dGenerationRoles(m).filter(r =>
    ['lowResolutionShape', 'highResolutionShape', 'textureFlow'].includes(r),
  )) {
    if (m.tensors[m.models[role].tensors.gelu].sha256 !== geluHash) {
      throw new TypeError('shared GELU activation table content identity required ' + role);
    }
  }
  if (m.tensors[m.models.textureDecoder.siluTable].sha256 !== siluHash) {
    throw new TypeError('shared SiLU activation table content identity required textureDecoder');
  }

  return Object.freeze({
    tensorCount: admitted.size,
    tensorKeys: Object.freeze([...admitted]),
    shapes,
  });
}

export async function loadPixal3dGenerationCheckpoints(manifest, fetchTensor) {
  return loadPixal3dCheckpointPlan(
    manifest,
    fetchTensor,
    validatePixal3dGenerationCheckpoints(manifest),
  );
}

export async function loadPixal3dGenerationInputs(manifest, fetchTensor) {
  const plan = validatePixal3dGenerationInputs(manifest);
  const checkpoints = await loadPixal3dCheckpointPlan(manifest, fetchTensor, plan);
  const dinoPixelValues = await fetchTensor(manifest.image.dinoPixelTensor);
  const rawImageValues = await fetchTensor(manifest.image.rawImageTensor);
  const cascade = pixal3dGenerationPipelineType(manifest) === '1024_cascade';
  const conditioningMode =
    manifest.conditioningMode ?? (cascade ? 'stage-specific-1024' : 'source-512');
  const highResolutionDinoPixelValues =
    cascade && conditioningMode === 'stage-specific-1024'
      ? await fetchTensor(manifest.image.highResolutionDinoPixelTensor)
      : undefined;
  const highResolutionRawImageValues =
    cascade && conditioningMode === 'stage-specific-1024'
      ? await fetchTensor(manifest.image.highResolutionRawImageTensor)
      : undefined;
  return {
    ...checkpoints,
    dinoPixelValues,
    rawImageValues,
    highResolutionDinoPixelValues,
    highResolutionRawImageValues,
  };
}

async function loadPixal3dCheckpointPlan(m, fetchTensor, plan) {
  const roles = pixal3dGenerationRoles(m);
  let gelu;
  let silu;
  const loadModel = async (role, { streamBlocks = false, streamParameters = false } = {}) => {
    if (!roles.includes(role)) throw new RangeError('known active Pixal3D model role required');
    const model = m.models[role];
    const flat = {};
    const flow = 'gelu' in plan.shapes.models[role];
    const table = flow
      ? await (gelu ??= fetchTensor(m.models.sparseFlow.tensors.gelu))
      : undefined;
    for (const [key, name] of Object.entries(model.tensors)) {
      if (!flow && streamParameters && ['shapeDecoder', 'textureDecoder'].includes(role)) continue;
      if (flow && streamBlocks && /^block\d+\./.test(key)) continue;
      flat[key] = key === 'gelu' ? table : await fetchTensor(name);
    }
    const loadBlockWeights = async i => {
      if (!Number.isSafeInteger(i) || i < 0 || i >= model.config.numBlocks) {
        throw new RangeError('actual flow block index required');
      }
      const prefix = `block${i}.`;
      const block = {};
      for (const [key, name] of Object.entries(model.tensors)) {
        if (key.startsWith(prefix)) {
          block[key.slice(prefix.length)] = await fetchTensor(name);
        }
      }
      return { ...block, gelu: table };
    };
    const loadWeight = async name => {
      const key = model.tensors[name];
      if (!key) throw new RangeError('actual decoder parameter required: ' + name);
      return fetchTensor(key);
    };
    const weights = !flow
      ? streamParameters && ['shapeDecoder', 'textureDecoder'].includes(role)
        ? {}
        : flat
      : {
          prefix: Object.fromEntries(
            Object.entries(flat)
              .filter(([key]) => key.startsWith('prefix.'))
              .map(([key, value]) => [key.slice(7), value]),
          ),
          ...(streamBlocks
            ? {}
            : {
                blocks: Array.from({ length: model.config.numBlocks }, (_, i) => {
                  const prefix = `block${i}.`;
                  const block = { gelu: flat.gelu };
                  for (const [key, value] of Object.entries(flat)) {
                    if (key.startsWith(prefix)) block[key.slice(prefix.length)] = value;
                  }
                  return block;
                }),
              }),
          terminal: { weight: flat['terminal.weight'], bias: flat['terminal.bias'] },
        };
    return {
      role,
      config: model.config,
      ...(role === 'naf'
        ? {
            highResolutionConfig: model.highResolutionConfig,
            textureConfig: model.textureConfig,
          }
        : {}),
      identity: model.identity,
      weights,
      ...(flow && streamBlocks ? { loadBlockWeights } : {}),
      ...(!flow && streamParameters && ['shapeDecoder', 'textureDecoder'].includes(role)
        ? { loadWeight }
        : {}),
      ...(role === 'sparseFlow' ? { phases: await fetchTensor(model.phases) } : {}),
      ...(['shapeDecoder', 'textureDecoder'].includes(role)
        ? { siluTable: await (silu ??= fetchTensor(model.siluTable)) }
        : {}),
    };
  };
  return {
    pipelineType: pixal3dGenerationPipelineType(m),
    conditioningMode:
      m.conditioningMode ??
      (pixal3dGenerationPipelineType(m) === '1024_cascade' ? 'stage-specific-1024' : 'source-512'),
    meshResolution: m.meshResolution,
    samplingSteps: m.samplingSteps ?? 12,
    seed: m.seed,
    camera: m.camera,
    prefixWeights: Object.fromEntries(
      await Promise.all(
        Object.entries(m.dino.prefix).map(async ([key, name]) => [key, await fetchTensor(name)]),
      ),
    ),
    async loadLayerWeights(i) {
      const layer = m.dino.layers[i];
      if (!layer) throw new RangeError('DINO layer index out of range');
      return Object.fromEntries(
        await Promise.all(
          Object.entries(layer).map(async ([key, name]) => [key, await fetchTensor(name)]),
        ),
      );
    },
    modelInputs: Object.fromEntries(
      roles.map(role => [
        role,
        {
          config: m.models[role].config,
          ...(role === 'naf'
            ? {
                highResolutionConfig: m.models[role].highResolutionConfig,
                textureConfig: m.models[role].textureConfig,
              }
            : {}),
          identity: m.models[role].identity,
        },
      ]),
    ),
    loadModel,
    async loadModels() {
      return Object.fromEntries(await Promise.all(roles.map(async role => [role, await loadModel(role)])));
    },
  };
}
