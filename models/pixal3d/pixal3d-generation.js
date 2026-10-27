import { WEBGPU_BUFFER_USAGE as U } from '../../webgpu-inference-kit/src/core.js';
import { createTrellisSparseSamplerAdapter } from '../trellis2/sparse-sampler.js';
import { createTrellisSparseDecoderAdapter } from '../trellis2/sparse-decoder.js';
import { createTrellisOccupancyCoordinatesAdapter } from '../trellis2/occupancy-coordinates.js';
import { createTrellisSLatSamplerAdapter } from '../trellis2/slat-sampler.js';
import {
  createTrellisSLatCascadeSupportAdapter,
  createTrellisSLatCascadeSupportAdapterAsync,
} from '../trellis2/slat-cascade.js';
import { createTrellisSLatScaleAdapter } from '../trellis2/slat-scale.js';
import {
  createTrellisSLatDecoderAdapter,
  createTrellisSLatDecoderAdapterAsync,
} from '../trellis2/slat-decoder.js';
import { createTrellisDinoV3ConditioningAdapter } from '../trellis2/dinov3-serving.js';
import { normalizePreparedTrellisRgb } from '../trellis2/generation-inputs.js';
import { buildPixal3dNafPlan, createPixal3dNafAdapter } from './naf.js';
import {
  PIXAL3D_DEFAULT_FOV_RAD,
  createPixal3dProjGridAdapter,
} from './proj-grid.js';
import {
  createPixal3dSparseFlowAdapter,
  createPixal3dSparseFlowAdapterAsync,
  createPixal3dSLatFlowAdapter,
  createPixal3dSLatFlowAdapterAsync,
} from './pixal3d-flow.js';

export const PIXAL3D_GENERATION_ROLES = Object.freeze([
  'naf',
  'sparseFlow',
  'occupancyDecoder',
  'lowResolutionShape',
  'highResolutionShape',
  'shapeDecoder',
  'textureFlow',
  'textureDecoder',
]);

export function pixal3dGenerationPipelineType(options = {}) {
  const type = options.pipelineType ?? '1024_cascade';
  if (!['512', '1024_cascade'].includes(type)) {
    throw new TypeError('explicit supported source pipeline type required');
  }
  return type;
}

export function pixal3dGenerationRoles(options = {}) {
  return pixal3dGenerationPipelineType(options) === '512'
    ? PIXAL3D_GENERATION_ROLES.filter(role => role !== 'highResolutionShape')
    : PIXAL3D_GENERATION_ROLES;
}

export function preparePixal3dRgbInputs({ pixels, width = 512, height = 512 } = {}) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 16 ||
    height < 16 ||
    width !== height ||
    width % 16 !== 0 ||
    !(pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray) ||
    pixels.length !== width * height * 3
  ) {
    throw new TypeError('complete prepared square RGB bytes (divisible by 16) and explicit dimensions required');
  }
  const dinoPixelValues =
    width === 512 && height === 512
      ? normalizePreparedTrellisRgb({ pixels, width, height })
      : (() => {
          const mean = [0.485, 0.456, 0.406];
          const std = [0.229, 0.224, 0.225];
          const values = new Float32Array(pixels.length);
          for (let i = 0; i < pixels.length; i++) {
            values[i] = (Math.fround(pixels[i] / 255) - mean[i % 3]) / std[i % 3];
          }
          return values;
        })();
  const rawImageValues = new Float32Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    rawImageValues[i] = Math.fround(pixels[i] / 255);
  }
  return { rawImageValues, dinoPixelValues };
}

function browserNoise(seed) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError('unsigned32 browser noise seed required');
  }
  let counter = 0n;
  const uniform = () => {
    const lo = Number(counter & 0xffffffffn), hi = Number(counter >> 32n);
    counter++;
    let value = (lo ^ Math.imul(hi, 0x9e3779b9) ^ seed) >>> 0;
    value = Math.imul(value ^ (value >>> 16), 0x21f0aaad) >>> 0;
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97) >>> 0;
    value = (value ^ (value >>> 15)) >>> 0;
    return (value + 0.5) / 4294967296;
  };
  return count => {
    const values = new Float32Array(count);
    for (let i = 0; i < count; i += 2) {
      const radius = Math.sqrt(-2 * Math.log(uniform())), angle = 2 * Math.PI * uniform();
      values[i] = radius * Math.cos(angle);
      if (i + 1 < count) values[i + 1] = radius * Math.sin(angle);
    }
    return values;
  };
}

function resolveConditioningMode(pipelineType, conditioningMode) {
  const cascade = pixal3dGenerationPipelineType({ pipelineType }) === '1024_cascade';
  const mode = conditioningMode ?? (cascade ? 'stage-specific-1024' : 'source-512');
  if (cascade) {
    if (!['stage-specific-1024', 'shared-512-preview'].includes(mode)) {
      throw new TypeError('1024_cascade conditioningMode must be stage-specific-1024 or shared-512-preview');
    }
  } else if (mode !== 'source-512') {
    throw new TypeError('512 pipelineType requires conditioningMode source-512');
  }
  return mode;
}

export function createPixal3dImageGenerationAdapter({
  route,
  pixelValues,
  rawImageTensor,
  rawImageValues,
  preparedPixels,
  highResolutionPixelValues,
  highResolutionRawImageTensor,
  highResolutionRawImageValues,
  highResolutionPreparedPixels,
  camera = {},
  prefixWeights,
  highResolutionPrefixWeights,
  loadLayerWeights,
  dinoIdentity = null,
  models,
  loadModels,
  modelInputs,
  loadModel,
  meshResolution = 1024,
  pipelineType = '1024_cascade',
  conditioningMode,
  seed = 42,
  initialNoise = {},
  onPhase,
  onNoiseInput,
} = {}) {
  if (onNoiseInput !== undefined && typeof onNoiseInput !== 'function') {
    throw new TypeError('noise input observer must be a function');
  }
  const effectiveConditioningMode = resolveConditioningMode(pipelineType, conditioningMode);
  const needsHrConditioning = effectiveConditioningMode === 'stage-specific-1024';
  const staged = loadModel !== undefined || modelInputs !== undefined;
  if (staged) {
    if (typeof loadModel !== 'function' || !modelInputs || models !== undefined || loadModels !== undefined) {
      throw new TypeError('one complete staged checkpoint input source required');
    }
  } else {
    if (models !== undefined && loadModels !== undefined) {
      throw new TypeError('one checkpoint input source required');
    }
    if (models === undefined && typeof loadModels !== 'function') {
      throw new TypeError('complete generation checkpoint inputs or loader required');
    }
  }
  let effectiveDinoPixels = pixelValues;
  let effectiveRawValues = rawImageValues;
  if (preparedPixels !== undefined) {
    if (pixelValues !== undefined || rawImageValues !== undefined || rawImageTensor !== undefined) {
      throw new TypeError('preparedPixels cannot be combined with explicit pixelValues or rawImage inputs');
    }
    const prepared = preparePixal3dRgbInputs({ pixels: preparedPixels, width: 512, height: 512 });
    effectiveDinoPixels = prepared.dinoPixelValues;
    effectiveRawValues = prepared.rawImageValues;
  }
  if (rawImageTensor === undefined && effectiveRawValues === undefined) {
    throw new TypeError('rawImageTensor, rawImageValues, or preparedPixels required for Pixal3D NAF upsampling');
  }

  let effectiveHrDinoPixels = highResolutionPixelValues;
  let effectiveHrRawValues = highResolutionRawImageValues;
  if (highResolutionPreparedPixels !== undefined) {
    if (
      highResolutionPixelValues !== undefined ||
      highResolutionRawImageValues !== undefined ||
      highResolutionRawImageTensor !== undefined
    ) {
      throw new TypeError(
        'highResolutionPreparedPixels cannot be combined with explicit highResolutionPixelValues or highResolutionRawImage inputs',
      );
    }
    const preparedHr = preparePixal3dRgbInputs({
      pixels: highResolutionPreparedPixels,
      width: 1024,
      height: 1024,
    });
    effectiveHrDinoPixels = preparedHr.dinoPixelValues;
    effectiveHrRawValues = preparedHr.rawImageValues;
  }
  if (needsHrConditioning) {
    if (effectiveHrDinoPixels === undefined) {
      throw new TypeError(
        'highResolutionPixelValues or highResolutionPreparedPixels (1024x1024) required for default 1024_cascade conditioning',
      );
    }
    if (highResolutionRawImageTensor === undefined && effectiveHrRawValues === undefined) {
      throw new TypeError(
        'highResolutionRawImageTensor, highResolutionRawImageValues, or highResolutionPreparedPixels required for 1024_cascade NAF upsampling',
      );
    }
  }

  let state = 'new', phase = 'new', result, disposed = false, generation;
  const enter = async e => {
    phase = e.phase;
    await onPhase?.({ ...e, routeId: route.routeId });
  };
  const producer = createTrellisDinoV3ConditioningAdapter({
    route,
    pixelValues: effectiveDinoPixels,
    imageSize: 512,
    prefixWeights,
    loadLayerWeights,
    modelIdentity: dinoIdentity,
    onPhase: enter,
  });
  const hrProducer = needsHrConditioning
    ? createTrellisDinoV3ConditioningAdapter({
        route,
        pixelValues: effectiveHrDinoPixels,
        imageSize: 1024,
        prefixWeights: highResolutionPrefixWeights ?? prefixWeights,
        loadLayerWeights,
        modelIdentity: dinoIdentity,
        onPhase: enter,
      })
    : null;

  return Object.freeze({
    runtime: route.runtime,
    routeId: route.routeId,
    get state() { return state; },
    get phase() { return phase; },
    get outputs() { return result; },
    get conditioning() { return producer.outputs?.conditioning; },
    get highResolutionConditioning() { return hrProducer?.outputs?.conditioning; },
    get noiseInputs() { return generation?.noiseInputs ?? Object.freeze({}); },
    get decoderFailureContext() { return disposed ? undefined : generation?.decoderFailureContext; },
    async run(invocation) {
      if (disposed) throw new Error('pixal3d image generation adapter disposed');
      if (state !== 'new') throw new Error('pixal3d image generation adapter is ' + state);
      state = 'running';
      try {
        const dino = await producer.run(invocation);
        const hrDino = hrProducer ? await hrProducer.run(invocation) : null;
        if (loadModels) await enter({ phase: 'generation-checkpoint-input-loading' });
        const checkpointModels = staged ? modelInputs : models ?? (await loadModels());
        generation = createPixal3dGenerationFromConditioningAdapter({
          route,
          conditioningTensor: dino.conditioning,
          rawImageTensor,
          rawImageValues: effectiveRawValues,
          ...(hrDino
            ? {
                highResolutionConditioningTensor: hrDino.conditioning,
                highResolutionRawImageTensor,
                highResolutionRawImageValues: effectiveHrRawValues,
              }
            : {}),
          camera,
          models: checkpointModels,
          ...(staged ? { loadModel } : {}),
          meshResolution,
          pipelineType,
          conditioningMode: effectiveConditioningMode,
          seed,
          initialNoise,
          onPhase: enter,
          onNoiseInput,
        });
        const fields = await generation.run(invocation);
        result = Object.freeze({
          ...fields,
          conditioning: dino.conditioning,
          dino,
          ...(hrDino
            ? {
                highResolutionConditioning: hrDino.conditioning,
                highResolutionDino: hrDino,
              }
            : {}),
        });
        state = 'completed';
        phase = 'completed';
        return result;
      } catch (error) {
        state = 'failed';
        result = undefined;
        throw error;
      }
    },
    dispose() {
      if (state === 'running') throw new Error('pixal3d image generation adapter in use');
      if (disposed) return;
      disposed = true;
      generation?.dispose();
      hrProducer?.dispose();
      producer.dispose();
    },
  });
}

export function createPixal3dGenerationFromConditioningAdapter({
  route,
  conditioningTensor,
  rawImageTensor,
  rawImageValues,
  highResolutionConditioningTensor,
  highResolutionRawImageTensor,
  highResolutionRawImageValues,
  textureConditioningTensor,
  textureRawImageTensor,
  textureRawImageValues,
  camera = {},
  models,
  loadModel,
  meshResolution = 1024,
  pipelineType = '1024_cascade',
  conditioningMode,
  seed = 42,
  initialNoise = {},
  onPhase,
  onNoiseInput,
} = {}) {
  const runtime = route?.runtime;
  const roles = pixal3dGenerationRoles({ pipelineType });
  const cascade = pipelineType === '1024_cascade';
  const effectiveConditioningMode = resolveConditioningMode(pipelineType, conditioningMode);
  const stageSpecificCascade = cascade && effectiveConditioningMode === 'stage-specific-1024';
  if (!runtime?.runKernel || !conditioningTensor?.buffer) {
    throw new TypeError('registered runtime and resident image conditioning required');
  }
  if (rawImageTensor !== undefined && rawImageValues !== undefined) {
    throw new TypeError('provide either resident rawImageTensor or CPU rawImageValues, not both');
  }
  if (rawImageTensor === undefined && !(rawImageValues instanceof Float32Array)) {
    throw new TypeError('complete rawImageTensor or Float32Array rawImageValues required for NAF');
  }
  if (stageSpecificCascade) {
    if (!highResolutionConditioningTensor?.buffer) {
      throw new TypeError(
        'highResolutionConditioningTensor (1024-stage DINO conditioning) required for 1024_cascade unless conditioningMode is shared-512-preview',
      );
    }
    if (
      highResolutionConditioningTensor === conditioningTensor ||
      highResolutionConditioningTensor.buffer === conditioningTensor.buffer
    ) {
      throw new TypeError(
        'source 1024_cascade requires separate highResolutionConditioningTensor extracted at 1024 pixels, not 512 conditioningTensor reuse',
      );
    }
    if (highResolutionRawImageTensor !== undefined && highResolutionRawImageValues !== undefined) {
      throw new TypeError(
        'provide either resident highResolutionRawImageTensor or CPU highResolutionRawImageValues, not both',
      );
    }
    if (
      highResolutionRawImageTensor === undefined &&
      !(highResolutionRawImageValues instanceof Float32Array)
    ) {
      throw new TypeError(
        'complete highResolutionRawImageTensor or Float32Array highResolutionRawImageValues required for 1024-stage NAF',
      );
    }
    if (highResolutionRawImageTensor !== undefined && highResolutionRawImageTensor === rawImageTensor) {
      throw new TypeError('separate highResolutionRawImageTensor required for 1024-stage NAF');
    }
  }
  if (textureRawImageTensor !== undefined && textureRawImageValues !== undefined) {
    throw new TypeError('provide either resident textureRawImageTensor or CPU textureRawImageValues, not both');
  }
  const staged = loadModel !== undefined;
  if (staged && typeof loadModel !== 'function') {
    throw new TypeError('per-role checkpoint loader required');
  }
  for (const role of roles) {
    if (staged ? !models?.[role]?.config : !models?.[role]?.weights) {
      throw new TypeError('actual model weight role required: ' + role);
    }
  }
  if (
    cascade &&
    ((!staged && models.lowResolutionShape.weights === models.highResolutionShape.weights) ||
      (staged &&
        models.lowResolutionShape.identity?.sha256 &&
        models.lowResolutionShape.identity.sha256 === models.highResolutionShape.identity?.sha256))
  ) {
    throw new TypeError('source cascade requires the separate high-resolution model, not low-resolution weight reuse');
  }
  if (onPhase !== undefined && typeof onPhase !== 'function') {
    throw new TypeError('phase observer must be a function');
  }
  if (onNoiseInput !== undefined && typeof onNoiseInput !== 'function') {
    throw new TypeError('noise input observer must be a function');
  }

  const deriveStageNafConfig = (baseConfig, overrideConfig, condTensor, rawTensor, rawVals) => {
    if (overrideConfig) return overrideConfig;
    const prefix = baseConfig.prefixTokens ?? 5;
    const tokens = condTensor.shape.length === 3 ? condTensor.shape[1] : condTensor.shape[0];
    const patches = tokens - prefix;
    const fSide = Math.round(Math.sqrt(patches));
    let imgH = baseConfig.imageHeight ?? 512;
    let imgW = baseConfig.imageWidth ?? 512;
    if (rawTensor?.shape) {
      imgH = rawTensor.shape[1];
      imgW = rawTensor.shape[2];
    } else if (rawVals instanceof Float32Array) {
      const side = Math.round(Math.sqrt(rawVals.length / 3));
      imgH = side;
      imgW = side;
    }
    return {
      ...baseConfig,
      imageHeight: imgH,
      imageWidth: imgW,
      featureHeight: fSide,
      featureWidth: fSide,
    };
  };

  const lrNafPlan = buildPixal3dNafPlan(models.naf.config);
  const hrCondTensor = stageSpecificCascade ? highResolutionConditioningTensor : conditioningTensor;
  const hrNafPlan = stageSpecificCascade
    ? buildPixal3dNafPlan(
        deriveStageNafConfig(
          models.naf.config,
          models.naf.highResolutionConfig,
          hrCondTensor,
          highResolutionRawImageTensor,
          highResolutionRawImageValues,
        ),
      )
    : lrNafPlan;
  const texCondTensor = textureConditioningTensor ?? hrCondTensor;
  const texRawTensor =
    textureRawImageTensor ?? (stageSpecificCascade ? highResolutionRawImageTensor : rawImageTensor);
  const texRawValues =
    textureRawImageValues ?? (stageSpecificCascade ? highResolutionRawImageValues : rawImageValues);
  const hasExplicitTextureConditioning = Boolean(
    textureConditioningTensor || textureRawImageTensor || textureRawImageValues,
  );
  const texNafPlan =
    models.naf.textureConfig && (stageSpecificCascade || hasExplicitTextureConditioning)
      ? buildPixal3dNafPlan(models.naf.textureConfig)
      : hasExplicitTextureConditioning
        ? buildPixal3dNafPlan(
            deriveStageNafConfig(models.naf.config, null, texCondTensor, texRawTensor, texRawValues),
          )
        : hrNafPlan;

  if (stageSpecificCascade) {
    if (
      hrNafPlan.imageHeight <= lrNafPlan.imageHeight &&
      hrNafPlan.featureHeight <= lrNafPlan.featureHeight
    ) {
      throw new TypeError(
        'stage-specific 1024_cascade requires higher-resolution conditioning/NAF config than 512 LR stage',
      );
    }
  }

  const cameraConfig = {
    cameraAngleX: camera.cameraAngleX ?? PIXAL3D_DEFAULT_FOV_RAD,
    ...(camera.distance !== undefined ? { distance: camera.distance } : {}),
    meshScale: camera.meshScale ?? 1.0,
  };

  const gaussian = browserNoise(seed);
  const owned = new Set(), ownedTensors = new Set(), noiseInputs = {}, phases = [];
  let state = 'new', phase = 'new', result, disposed = false, lastDecoder, nafCheckpointCache;
  const decode = (decoder, invocation) => {
    lastDecoder = decoder;
    return decoder.run(invocation);
  };
  const own = a => {
    owned.add(a);
    return a;
  };
  const retire = async (...adapters) => {
    await runtime.device?.queue?.onSubmittedWorkDone?.();
    for (const a of adapters) {
      a?.dispose?.();
      owned.delete(a);
    }
  };
  const noise = async (stage, shape) => {
    const count = shape.reduce((a, b) => a * b, 1);
    const values = initialNoise[stage] ?? gaussian(count);
    if (!(values instanceof Float32Array) || values.length !== count || !values.every(Number.isFinite)) {
      throw new TypeError('complete finite initial noise required for ' + stage + ' ' + shape);
    }
    noiseInputs[stage] = Object.freeze({
      shape: Object.freeze([...shape]),
      values,
      source: initialNoise[stage] === undefined ? 'browser-u32-counter-mix/Box-Muller/F32' : 'explicit-caller-F32-input',
      seed,
    });
    await onNoiseInput?.({ stage, ...noiseInputs[stage] });
    return values;
  };
  const enter = async name => {
    phase = name;
    phases.push({ phase: name });
    await onPhase?.({ phase: name, routeId: route.routeId });
  };
  const consume = async (role, name, factory) => {
    let checkpoint;
    if (role === 'naf' && nafCheckpointCache) {
      checkpoint = nafCheckpointCache;
    } else {
      if (staged) {
        phase = 'generation-checkpoint-input-loading';
        await onPhase?.({ phase, modelRole: role, routeId: route.routeId });
      }
      checkpoint = staged
        ? await loadModel(role, {
            streamBlocks: true,
            streamParameters: ['shapeDecoder', 'textureDecoder'].includes(role),
          })
        : models[role];
      if (!checkpoint?.weights || (checkpoint.role !== undefined && checkpoint.role !== role)) {
        throw new TypeError('actual checkpoint weights for model role required: ' + role);
      }
      if (role === 'naf') nafCheckpointCache = checkpoint;
    }
    if (name) await enter(name);
    return factory({
      ...models[role],
      weights: checkpoint.weights,
      phases: checkpoint.phases,
      siluTable: checkpoint.siluTable,
      loadBlockWeights: checkpoint.loadBlockWeights,
      loadWeight: checkpoint.loadWeight,
    });
  };
  const runNafStage = async ({ phaseName, plan, stageCondTensor, stageRawTensor, stageRawValues, invocation }) => {
    let ownedImageTensor;
    const imageTensor =
      stageRawTensor ??
      (() => {
        const expectedCount = plan.imageHeight * plan.imageWidth * 3;
        if (
          !(stageRawValues instanceof Float32Array) ||
          stageRawValues.length !== expectedCount ||
          !stageRawValues.every(Number.isFinite)
        ) {
          throw new TypeError(`complete finite rawImageValues of length ${expectedCount} required`);
        }
        const t = runtime.createTensor({
          name: `pixal3d.generation.raw-image.${phaseName}`,
          shape: [1, plan.imageHeight, plan.imageWidth, 3],
          dtype: 'f32',
          usage: U.storage | U.copyDst | U.copySrc,
        });
        ownedTensors.add(t);
        runtime.uploadTensor(t, stageRawValues);
        ownedImageTensor = t;
        return t;
      })();
    const naf = await consume('naf', phaseName, model =>
      own(
        createPixal3dNafAdapter({
          route,
          config: plan,
          weights: model.weights,
          imageTensor,
          conditioningTensor: stageCondTensor,
        }),
      ),
    );
    await naf.run(invocation);
    await runtime.device?.queue?.onSubmittedWorkDone?.();
    naf.releaseParameters();
    if (ownedImageTensor) {
      ownedImageTensor.buffer?.destroy?.();
      ownedTensors.delete(ownedImageTensor);
    }
    return naf;
  };
  const buildSparseProj = (gridResolution, coordTensor, stageNaf, stageCondTensor) =>
    own(
      createPixal3dProjGridAdapter({
        route,
        config: {
          gridResolution,
          imageResolution: stageNaf.plan.imageHeight,
          featureHeight: stageNaf.plan.featureHeight,
          featureWidth: stageNaf.plan.featureWidth,
          channels: stageNaf.plan.featureChannels,
          highResFeatureHeight: stageNaf.plan.outputHeight,
          highResFeatureWidth: stageNaf.plan.outputWidth,
          highResChannels: stageNaf.plan.featureChannels,
          tokenRows: coordTensor.shape[0],
          prefixTokens: stageNaf.plan.prefixTokens,
        },
        conditioningTensor: stageCondTensor,
        highResTensor: stageNaf.outputs.highResFeatures,
        coordinateTensor: coordTensor,
      }),
    );
  const releaseFlow = async flow => {
    await runtime.device?.queue?.onSubmittedWorkDone?.();
    flow.releaseParameters();
  };
  const shapeFlow = (role, coordinates, globalConditioning, projectedConditioning, concatTensor) =>
    consume(
      role,
      role === 'lowResolutionShape'
        ? 'low-resolution-shape-sampling'
        : role === 'highResolutionShape'
          ? 'high-resolution-shape-sampling'
          : 'shape-conditioned-texture-sampling',
      async model =>
        own(
          await (model.loadBlockWeights ? createPixal3dSLatFlowAdapterAsync : createPixal3dSLatFlowAdapter)({
            route,
            config: {
              ...model.config,
              tokenRows: coordinates.shape[0],
              mode: role === 'textureFlow' ? 'texture' : 'shape',
            },
            weights: model.weights,
            loadBlockWeights: model.loadBlockWeights,
            conditioningTensor: globalConditioning,
            projectedConditioningTensor: projectedConditioning,
            coordinateTensor: coordinates,
            ...(concatTensor ? { concatTensor } : {}),
          }),
        ),
    );
  const sampleShape = async (role, flow, stage, globalConditioning, invocation) => {
    const sampler = own(
      createTrellisSLatSamplerAdapter({
        route,
        flow,
        config: {
          ...models[role].config,
          tokenRows: flow.plan.tokenRows,
          mode: flow.plan.mode,
        },
        conditioningTensor: globalConditioning,
      }),
    );
    await sampler.run({ sample: await noise(stage, flow.plan.inputShape) }, invocation);
    await releaseFlow(flow);
    return { sampler, sample: sampler.outputs.sample };
  };

  return Object.freeze({
    runtime,
    routeId: route.routeId,
    conditioningMode: effectiveConditioningMode,
    inputs: Object.freeze({
      conditioning: conditioningTensor,
      ...(rawImageTensor ? { rawImage: rawImageTensor } : {}),
      ...(highResolutionConditioningTensor ? { highResolutionConditioning: highResolutionConditioningTensor } : {}),
      ...(highResolutionRawImageTensor ? { highResolutionRawImage: highResolutionRawImageTensor } : {}),
    }),
    get state() { return state; },
    get phase() { return phase; },
    get noiseInputs() { return Object.freeze({ ...noiseInputs }); },
    get outputs() { return result; },
    get decoderFailureContext() {
      return disposed || state !== 'failed' ? undefined : lastDecoder?.failureContext;
    },
    async run(invocation) {
      if (disposed) throw new Error('pixal3d generation adapter disposed');
      if (state !== 'new') {
        throw new Error(state === 'running' ? 'pixal3d generation adapter in use' : 'pixal3d generation adapter is ' + state);
      }
      state = 'running';
      try {
        const lrNaf = await runNafStage({
          phaseName: 'naf-feature-upsampling',
          plan: lrNafPlan,
          stageCondTensor: conditioningTensor,
          stageRawTensor: rawImageTensor,
          stageRawValues: rawImageValues,
          invocation,
        });

        const denseResolution = models.sparseFlow.config?.resolution ?? 16;
        const denseProj = own(
          createPixal3dProjGridAdapter({
            route,
            config: {
              gridResolution: denseResolution,
              imageResolution: lrNaf.plan.imageHeight,
              featureHeight: lrNaf.plan.featureHeight,
              featureWidth: lrNaf.plan.featureWidth,
              channels: lrNaf.plan.featureChannels,
              prefixTokens: lrNaf.plan.prefixTokens,
            },
            conditioningTensor,
          }),
        );
        await denseProj.run(cameraConfig, invocation);
        const lrGlobalConditioning = denseProj.outputs.globalConditioning;

        const sparse = await consume('sparseFlow', 'sparse-structure-sampling', async model =>
          own(
            await (model.loadBlockWeights ? createPixal3dSparseFlowAdapterAsync : createPixal3dSparseFlowAdapter)({
              route,
              config: model.config,
              weights: model.weights,
              loadBlockWeights: model.loadBlockWeights,
              phases: model.phases,
              conditioningTensor: lrGlobalConditioning,
              projectedConditioningTensor: denseProj.outputs.projectedConditioning,
            }),
          ),
        );
        const sparseSampler = own(
          createTrellisSparseSamplerAdapter({
            route,
            flow: sparse,
            config: models.sparseFlow.config,
            conditioningTensor: lrGlobalConditioning,
          }),
        );
        await sparseSampler.run({ sample: await noise('sparse', sparse.plan.prefix.inputShape) }, invocation);
        await releaseFlow(sparse);
        denseProj.releaseProjectedConditioning();

        const occupancy = await consume('occupancyDecoder', 'occupancy-decoding', model =>
          own(
            createTrellisSparseDecoderAdapter({
              route,
              config: model.config,
              weights: model.weights,
              sampleTensor: sparseSampler.outputs.sample,
            }),
          ),
        );
        await occupancy.run({}, invocation);
        const coordinates = own(
          createTrellisOccupancyCoordinatesAdapter({
            route,
            resolution: occupancy.plan.outputResolution,
            logitsTensor: occupancy.outputs.logits,
          }),
        );
        await coordinates.run(invocation);
        const lrCoordinates = await coordinates.coordinates(invocation);
        const lrResolution = coordinates.plan.outputResolution;
        await retire(occupancy, sparseSampler, sparse);

        const lrProj = buildSparseProj(lrResolution, lrCoordinates, lrNaf, conditioningTensor);
        await lrProj.run(cameraConfig, invocation);
        if (!cascade || stageSpecificCascade) await retire(lrNaf);

        const lrFlow = await shapeFlow(
          'lowResolutionShape',
          lrCoordinates,
          lrGlobalConditioning,
          lrProj.outputs.projectedConditioning,
        );
        const lr = await sampleShape(
          'lowResolutionShape',
          lrFlow,
          'lowResolutionShape',
          lrGlobalConditioning,
          invocation,
        );

        let finalCoordinates = lrCoordinates;
        let finalResolution = lrResolution;
        let finalSample = lr.sample;
        let finalProj = lrProj;
        let finalGlobalConditioning = lrGlobalConditioning;
        let activeHrNaf = null;
        let sampledAdapters;
        if (cascade) {
          const support = await consume('shapeDecoder', 'learned-cascade-support', async model =>
            own(
              await (model.loadWeight ? createTrellisSLatCascadeSupportAdapterAsync : createTrellisSLatCascadeSupportAdapter)({
                route,
                config: { ...model.config, tokenRows: lrCoordinates.shape[0], resolution: lrResolution },
                weights: model.weights,
                loadWeight: model.loadWeight,
                siluTable: model.siluTable,
                sampleTensor: lr.sample,
                coordinateTensor: lrCoordinates,
                meshResolution,
              }),
            ),
          );
          const hr = await support.run(invocation);
          await retire(lr.sampler, lrFlow, lrProj, coordinates);
          if (stageSpecificCascade) {
            await retire(denseProj);
            activeHrNaf = await runNafStage({
              phaseName: 'naf-hr-feature-upsampling',
              plan: hrNafPlan,
              stageCondTensor: hrCondTensor,
              stageRawTensor: highResolutionRawImageTensor,
              stageRawValues: highResolutionRawImageValues,
              invocation,
            });
          } else {
            activeHrNaf = lrNaf;
          }
          const hrProj = buildSparseProj(hr.resolution, hr.coordinates, activeHrNaf, hrCondTensor);
          await hrProj.run(cameraConfig, invocation);
          await retire(activeHrNaf);
          activeHrNaf = null;
          const hrGlobalConditioning = stageSpecificCascade
            ? hrProj.outputs.globalConditioning
            : lrGlobalConditioning;
          const hrFlow = await shapeFlow(
            'highResolutionShape',
            hr.coordinates,
            hrGlobalConditioning,
            hrProj.outputs.projectedConditioning,
          );
          const hrSample = await sampleShape(
            'highResolutionShape',
            hrFlow,
            'highResolutionShape',
            hrGlobalConditioning,
            invocation,
          );
          finalCoordinates = hr.coordinates;
          finalResolution = hr.resolution;
          finalSample = hrSample.sample;
          finalProj = hrProj;
          finalGlobalConditioning = hrGlobalConditioning;
          sampledAdapters = [hrSample.sampler, hrFlow];
        } else {
          sampledAdapters = [lr.sampler, lrFlow];
        }

        const rows = finalCoordinates.shape[0];
        const shapeScale = own(createTrellisSLatScaleAdapter({ route, tokenRows: rows, sampleTensor: finalSample }));
        await shapeScale.run(invocation);
        await retire(...sampledAdapters);

        const geometryDecoder = await consume('shapeDecoder', 'learned-geometry-decoding', async model =>
          own(
            await (model.loadWeight ? createTrellisSLatDecoderAdapterAsync : createTrellisSLatDecoderAdapter)({
              route,
              config: { ...model.config, tokenRows: rows, resolution: finalResolution, mode: 'shape', structureOnly: false },
              weights: model.weights,
              loadWeight: model.loadWeight,
              siluTable: model.siluTable,
              sampleTensor: shapeScale.outputs.sample,
              coordinateTensor: finalCoordinates,
            }),
          ),
        );
        const geometry = await decode(geometryDecoder, invocation);

        const needsSeparateTexProjection =
          texCondTensor !== (cascade ? hrCondTensor : conditioningTensor) ||
          texRawTensor !== (stageSpecificCascade ? highResolutionRawImageTensor : rawImageTensor) ||
          texRawValues !== (stageSpecificCascade ? highResolutionRawImageValues : rawImageValues) ||
          JSON.stringify(texNafPlan) !== JSON.stringify(cascade ? hrNafPlan : lrNafPlan);

        let texProj = finalProj;
        let texGlobalConditioning = finalGlobalConditioning;
        if (needsSeparateTexProjection) {
          await retire(finalProj);
          const texNaf = await runNafStage({
            phaseName: 'naf-texture-feature-upsampling',
            plan: texNafPlan,
            stageCondTensor: texCondTensor,
            stageRawTensor: texRawTensor,
            stageRawValues: texRawValues,
            invocation,
          });
          texProj = buildSparseProj(finalResolution, finalCoordinates, texNaf, texCondTensor);
          await texProj.run(cameraConfig, invocation);
          await retire(texNaf);
          texGlobalConditioning = texProj.outputs.globalConditioning ?? finalGlobalConditioning;
        }

        const shapeNormalize = own(
          createTrellisSLatScaleAdapter({
            route,
            tokenRows: rows,
            direction: 'normalize',
            sampleTensor: shapeScale.outputs.sample,
          }),
        );
        const textureFlow = await shapeFlow(
          'textureFlow',
          finalCoordinates,
          texGlobalConditioning,
          texProj.outputs.projectedConditioning,
          shapeNormalize.outputs.sample,
        );
        await shapeNormalize.run(invocation);
        const textureSample = await sampleShape('textureFlow', textureFlow, 'texture', texGlobalConditioning, invocation);
        const textureScale = own(
          createTrellisSLatScaleAdapter({
            route,
            tokenRows: rows,
            mode: 'texture',
            sampleTensor: textureSample.sample,
          }),
        );
        await textureScale.run(invocation);
        await retire(textureSample.sampler, textureFlow, shapeNormalize, texProj, denseProj);

        const textureDecoder = await consume('textureDecoder', 'shape-guided-material-decoding', async model =>
          own(
            await (model.loadWeight ? createTrellisSLatDecoderAdapterAsync : createTrellisSLatDecoderAdapter)({
              route,
              config: { ...model.config, tokenRows: rows, resolution: finalResolution, mode: 'texture' },
              weights: model.weights,
              loadWeight: model.loadWeight,
              siluTable: model.siluTable,
              sampleTensor: textureScale.outputs.sample,
              coordinateTensor: finalCoordinates,
              guideSubdivisions: geometry.subdivisions,
            }),
          ),
        );
        const material = await decode(textureDecoder, invocation);
        await runtime.device?.queue?.onSubmittedWorkDone?.();
        nafCheckpointCache = undefined;
        result = Object.freeze({
          geometry,
          material,
          shapeCodes: shapeScale.outputs.sample,
          textureCodes: textureScale.outputs.sample,
          lowResolutionRows: lrCoordinates.shape[0],
          highResolutionRows: rows,
          meshResolution,
          pipelineType,
          conditioningMode: effectiveConditioningMode,
          camera: Object.freeze({ ...cameraConfig }),
          modelIdentities: Object.freeze(Object.fromEntries(roles.map(role => [role, models[role].identity ?? null]))),
          phases: Object.freeze(phases.map(Object.freeze)),
          initialNoise: Object.freeze({ ...noiseInputs }),
          featureBytesToCPUDuringServing: 0,
          coordinateBytesToCPUDuringServing: 0,
          handoff: 'resident learned geometry/material fields; post-model mesh/UV/PBR consumers outstanding',
          comparison:
            effectiveConditioningMode === 'shared-512-preview'
              ? 'browser preview generation reusing 512 conditioning across cascade stages; non-source-faithful preview'
              : 'browser generation with stage-specific conditioning resolutions; no assertion of matched MLX noise or model fidelity',
        });
        state = 'completed';
        phase = 'completed';
        return result;
      } catch (error) {
        nafCheckpointCache = undefined;
        state = 'failed';
        result = undefined;
        throw error;
      }
    },
    dispose() {
      if (state === 'running') throw new Error('pixal3d generation adapter in use');
      if (disposed) return;
      disposed = true;
      nafCheckpointCache = undefined;
      for (const a of [...owned].reverse()) a.dispose();
      owned.clear();
      for (const t of ownedTensors) t.buffer?.destroy?.();
      ownedTensors.clear();
    },
  });
}
