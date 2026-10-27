import { WEBGPU_BUFFER_USAGE as U } from '../../webgpu-inference-kit/src/core.js';
import { buildSparsePrefixPlan, createTrellisSparsePrefixAdapter } from '../trellis2/sparse-prefix.js';
import { slatCoordinateRopeShader } from '../trellis2/slat-flow.js';
import {
  buildPixal3dBlockPlan,
  createPixal3dBlockWorkspace,
  createPixal3dBlockAdapter,
} from './pixal3d-block.js';

export const PIXAL3D_SPARSE_FLOW_ROUTE = 'pixal3d.sparse-flow.webgpu.v0';
export const PIXAL3D_SLAT_FLOW_ROUTE = 'pixal3d.slat-flow.webgpu.v0';

export function buildPixal3dSparseFlowPlan(config = {}) {
  const prefix = buildSparsePrefixPlan(config);
  const block = buildPixal3dBlockPlan(config);
  const { numBlocks = 30, outChannels = 8 } = config;
  for (const [name, value] of Object.entries({ numBlocks, outChannels })) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive integer`);
    }
  }
  return Object.freeze({
    prefix,
    block,
    numBlocks,
    outChannels,
    outputShape:
      config.tokenRows === undefined
        ? [1, outChannels, block.resolution, block.resolution, block.resolution]
        : [block.rows, outChannels],
    stages: Object.freeze([
      ...prefix.stages,
      ...Array.from({ length: numBlocks }, () => block.stages).flat(),
      'terminal-layernorm',
      'terminal-output-projection',
    ]),
    arithmetic: 'bf16-torso/f32-terminal-layernorm-and-output',
    terminalEpsilon: 1e-5,
  });
}

const terminalNormShader = (rows, width) => `
@group(0) @binding(0) var<storage,read> input:array<f32>;
@group(0) @binding(1) var<storage,read_write> output:array<f32>;
var<workgroup> partial:array<f32,256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) wid:vec3<u32>) {
  let row=wid.x; var sum=0.0;
  for(var i=lane;i<${width}u;i+=256u){sum+=input[row*${width}u+i];}
  partial[lane]=sum;workgroupBarrier();
  for(var stride=128u;stride>0u;stride/=2u){if(lane<stride){partial[lane]+=partial[lane+stride];}workgroupBarrier();}
  let mean=partial[0]/${width}.0;workgroupBarrier();sum=0.0;
  for(var i=lane;i<${width}u;i+=256u){let delta=input[row*${width}u+i]-mean;sum+=delta*delta;}
  partial[lane]=sum;workgroupBarrier();
  for(var stride=128u;stride>0u;stride/=2u){if(lane<stride){partial[lane]+=partial[lane+stride];}workgroupBarrier();}
  let inverse=inverseSqrt(partial[0]/${width}.0+0.00001);
  for(var i=lane;i<${width}u;i+=256u){output[row*${width}u+i]=(input[row*${width}u+i]-mean)*inverse;}
}`;

const terminalProjectionShader = (rows, width, columns, tokenMajor = false) => `
@group(0) @binding(0) var<storage,read> input:array<f32>;
@group(0) @binding(1) var<storage,read> weight:array<f32>;
@group(0) @binding(2) var<storage,read> bias:array<f32>;
@group(0) @binding(3) var<storage,read_write> output:array<f32>;
var<workgroup> tile_a:array<f32,256>;
var<workgroup> tile_b:array<f32,256>;
@compute @workgroup_size(16,16)
fn main(@builtin(local_invocation_id) lid:vec3<u32>,@builtin(workgroup_id) wid:vec3<u32>) {
  let row=wid.y*16u+lid.y;let col=wid.x*16u+lid.x;var sum=0.0;
  for(var base=0u;base<${width}u;base+=16u){
    var a=0.0;var b=0.0;
    if(row<${rows}u&&base+lid.x<${width}u){a=input[row*${width}u+base+lid.x];}
    if(col<${columns}u&&base+lid.y<${width}u){b=weight[col*${width}u+base+lid.y];}
    tile_a[lid.y*16u+lid.x]=a;tile_b[lid.y*16u+lid.x]=b;workgroupBarrier();
    for(var k=0u;k<16u;k++){sum+=tile_a[lid.y*16u+k]*tile_b[k*16u+lid.x];}workgroupBarrier();
  }
  if(row<${rows}u&&col<${columns}u){output[${tokenMajor ? `row * ${columns}u + col` : `col * ${rows}u + row`}]=sum+bias[col];}
}`;

export function createPixal3dSparseFlowAdapter(options) {
  return constructPixal3dSparseFlow(options).next().value;
}

export async function createPixal3dSparseFlowAdapterAsync({ loadBlockWeights, ...options }) {
  if (typeof loadBlockWeights !== 'function') {
    throw new TypeError('complete source block checkpoint loader required');
  }
  const queue = options.route?.runtime?.device?.queue;
  if (typeof queue?.onSubmittedWorkDone !== 'function') {
    throw new TypeError('WebGPU upload completion queue required');
  }
  const construction = constructPixal3dSparseFlow(options, true);
  let step = construction.next();
  try {
    while (!step.done) {
      let blockWeights = await loadBlockWeights(step.value);
      step = construction.next(blockWeights);
      blockWeights = null;
      await queue.onSubmittedWorkDone();
    }
    return step.value;
  } catch (error) {
    if (step.done) step.value?.dispose();
    else construction.throw(error);
    throw error;
  }
}

function* constructPixal3dSparseFlow(
  {
    route,
    config = {},
    weights,
    conditioning,
    conditioningTensor,
    projectedConditioning,
    projectedConditioningTensor,
    phases,
    phaseTensor,
    sampleTensor,
  },
  streaming = false,
) {
  const plan = buildPixal3dSparseFlowPlan(config);
  const runtime = route?.runtime;
  if (!runtime?.createTensor || !runtime?.runKernel) {
    throw new TypeError('registered WebGPU runtime required');
  }
  if (!streaming && (!Array.isArray(weights?.blocks) || weights.blocks.length !== plan.numBlocks)) {
    throw new TypeError('complete source block weight sets required');
  }
  for (const [key, count] of [
    ['weight', plan.outChannels * plan.block.channels],
    ['bias', plan.outChannels],
  ]) {
    if (
      !(weights?.terminal?.[key] instanceof Float32Array) ||
      weights.terminal[key].length !== count ||
      !weights.terminal[key].every(Number.isFinite)
    ) {
      throw new TypeError(`complete finite terminal ${key} required`);
    }
  }
  const resources = [], blocks = [];
  let prefix, workspace, ownedSample, disposed = false, parametersRetired = false, running = false, initialized = !!sampleTensor;
  const tensor = (name, shape) => {
    const t = runtime.createTensor({
      name: `pixal3d.flow.${name}`,
      shape,
      dtype: 'f32',
      usage: U.storage | U.copyDst | U.copySrc,
    });
    resources.push(t);
    return t;
  };
  const releaseParameters = () => {
    if (disposed || parametersRetired) return;
    if (running) throw new Error('pixal3d sparse flow adapter in use');
    for (const block of blocks) block.dispose();
    prefix?.dispose();
    workspace?.dispose();
    for (const t of resources) if (t !== ownedSample) t.buffer?.destroy?.();
    parametersRetired = true;
  };
  const cleanup = () => {
    releaseParameters();
    ownedSample?.buffer?.destroy?.();
  };

  try {
    const sample = sampleTensor ?? (ownedSample = tensor('sample', plan.prefix.inputShape));
    prefix = createTrellisSparsePrefixAdapter({ route, config, weights: weights.prefix, sampleTensor: sample });
    workspace = createPixal3dBlockWorkspace({
      route,
      config,
      conditioning,
      conditioningTensor,
      projectedConditioning,
      projectedConditioningTensor,
      phases,
      phaseTensor,
    });
    let hidden = prefix.outputs.projected;
    for (let i = 0; i < plan.numBlocks; i++) {
      let blockWeights = streaming ? (yield i) : weights.blocks[i];
      const block = createPixal3dBlockAdapter({
        route,
        config,
        weights: blockWeights,
        inputs: { projected: hidden, modulation: prefix.outputs.modulation },
        workspace,
      });
      blocks.push(block);
      hidden = block.outputs.hidden;
      blockWeights = null;
    }
    const normalized = tensor('terminal-normalized', plan.block.outputShape);
    const prediction = tensor('prediction', plan.outputShape);
    const weight = tensor('output.weight', [plan.outChannels, plan.block.channels]);
    const bias = tensor('output.bias', [plan.outChannels]);
    runtime.uploadTensor(weight, weights.terminal.weight);
    runtime.uploadTensor(bias, weights.terminal.bias);
    const define = (name, code, args, dispatch) => ({
      name,
      dispatch,
      kernel: runtime.defineComputeKernel({
        name: `pixal3d.flow.${name}`,
        code,
        bindings: args.map((resource, i) => ({
          name: `b${i}`,
          resource,
          access: i === args.length - 1 ? 'storage' : 'read-only-storage',
        })),
      }),
    });
    const terminal = [
      define(
        'terminal-layernorm',
        terminalNormShader(plan.block.rows, plan.block.channels),
        [hidden, normalized],
        [plan.block.rows, 1, 1],
      ),
      define(
        'terminal-output-projection',
        terminalProjectionShader(plan.block.rows, plan.block.channels, plan.outChannels, config.tokenRows !== undefined),
        [normalized, weight, bias, prediction],
        [Math.ceil(plan.outChannels / 16), Math.ceil(plan.block.rows / 16), 1],
      ),
    ];
    return Object.freeze({
      plan,
      runtime,
      routeId: route.routeId,
      inputs: Object.freeze({
        sample,
        ...(conditioningTensor !== undefined ? { conditioning: conditioningTensor } : {}),
        ...(projectedConditioningTensor !== undefined ? { projectedConditioning: projectedConditioningTensor } : {}),
      }),
      outputs: Object.freeze({ prediction }),
      diagnostics: Object.freeze({ hidden, normalized, ...prefix.outputs }),
      async run(
        {
          sample: cpuSample,
          timestep,
          conditioning: nextConditioning,
          projectedConditioning: nextProjectedConditioning,
          zeroConditioning = false,
        } = {},
        invocation,
      ) {
        if (disposed) throw new Error('pixal3d sparse flow adapter disposed');
        if (parametersRetired) throw new Error('pixal3d sparse flow parameters retired');
        if (running) throw new Error('pixal3d sparse flow adapter in use');
        if (!Number.isFinite(timestep)) throw new TypeError('finite model timestep required');
        if (typeof zeroConditioning !== 'boolean') throw new TypeError('explicit conditioning polarity required');
        if (conditioningTensor !== undefined && (nextConditioning !== undefined || nextProjectedConditioning !== undefined)) {
          throw new TypeError('borrowed resident conditioning forbids CPU replacement');
        }
        if (conditioningTensor === undefined && zeroConditioning) {
          throw new TypeError('GPU-zero context requires resident conditioning');
        }
        if (sampleTensor && cpuSample !== undefined) {
          throw new TypeError('borrowed sampler state must not be CPU-reuploaded');
        }
        if (
          cpuSample !== undefined &&
          (!(cpuSample instanceof Float32Array) ||
            cpuSample.length !== plan.block.rows * plan.prefix.inChannels ||
            !cpuSample.every(Number.isFinite))
        ) {
          throw new TypeError(`complete finite ${plan.prefix.inputLayout} sample required`);
        }
        if (!initialized && cpuSample === undefined) {
          throw new TypeError('initial sample upload required');
        }
        running = true;
        try {
          if (nextConditioning !== undefined) {
            workspace.setConditioning(nextConditioning, nextProjectedConditioning);
          }
          await workspace.prepareConditioning(zeroConditioning, invocation);
          if (cpuSample !== undefined) {
            runtime.uploadTensor(sample, cpuSample);
            initialized = true;
          }
          await prefix.run({ timestep }, invocation);
          for (const block of blocks) await block.run(invocation);
          for (const { name, kernel, dispatch } of terminal) {
            await runtime.runKernel(kernel, {
              stage: name,
              dispatch,
              schedulerInvocation: invocation,
              yieldAfter: true,
            });
          }
          return { prediction, blocksExecuted: blocks.length, arithmetic: plan.arithmetic };
        } finally {
          running = false;
        }
      },
      releaseParameters,
      dispose() {
        if (running) throw new Error('pixal3d sparse flow adapter in use');
        if (disposed) return;
        cleanup();
        disposed = true;
      },
    });
  } catch (error) {
    cleanup();
    throw error;
  }
}

export function buildPixal3dSLatFlowPlan(config = {}) {
  const { tokenRows, mode = 'shape' } = config;
  if (!Number.isSafeInteger(tokenRows) || tokenRows < 1) {
    throw new RangeError('tokenRows must be a positive integer');
  }
  if (!['shape', 'texture'].includes(mode)) {
    throw new RangeError('SLat mode must be shape or texture');
  }
  const flowConfig = { ...config, inChannels: mode === 'texture' ? 64 : 32, outChannels: 32 };
  const flow = buildPixal3dSparseFlowPlan(flowConfig);
  const pairs = flow.block.headDim / 2;
  const frequencies = Math.floor(pairs / 3);
  return Object.freeze({
    mode,
    tokenRows,
    flowConfig: Object.freeze(flowConfig),
    flow,
    frequencies,
    inputShape: [tokenRows, 32],
    outputShape: [tokenRows, 32],
    coordinateShape: [tokenRows, 3],
    phasesShape: [tokenRows, pairs, 2],
    stages: Object.freeze([
      'slat-coordinate-rope',
      ...(mode === 'texture' ? ['slat-texture-concat'] : []),
      ...flow.stages,
    ]),
    arithmetic: flow.arithmetic,
    phaseArithmetic: 'source-f32-frequency/coordinate-product/cos-sin',
    inputLayout: 'token-major',
    coordinateOrder: 'z-y-x',
  });
}

const concatShader = rows => `
@group(0) @binding(0) var<storage,read> input_sample:array<f32>;
@group(0) @binding(1) var<storage,read> shape:array<f32>;
@group(0) @binding(2) var<storage,read_write> output:array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>,@builtin(num_workgroups) grid:vec3<u32>){
  let i=gid.x+gid.y*grid.x*64u;if(i>=${rows * 32}u){return;}
  let row=i/32u;let ch=i%32u;output[row*64u+ch]=input_sample[row * 32u + ch];output[row*64u+32u+ch]=shape[i];
}`;

function validateBorrowed(tensor, shape, dtype, label) {
  if (
    !tensor?.buffer ||
    tensor.dtype !== dtype ||
    !(tensor.usage & U.storage) ||
    tensor.byteLength !== shape.reduce((a, b) => a * b, 4) ||
    JSON.stringify(tensor.shape) !== JSON.stringify(shape)
  ) {
    throw new TypeError(`complete resident ${dtype} ${label} required`);
  }
}

export function createPixal3dSLatFlowAdapter(options) {
  const construction = constructPixal3dSLatFlow(options);
  const step = construction.next();
  try {
    return construction.next(createPixal3dSparseFlowAdapter(step.value)).value;
  } catch (error) {
    construction.throw(error);
    throw error;
  }
}

export async function createPixal3dSLatFlowAdapterAsync({ loadBlockWeights, ...options }) {
  const construction = constructPixal3dSLatFlow(options);
  const step = construction.next();
  try {
    return construction.next(await createPixal3dSparseFlowAdapterAsync({ ...step.value, loadBlockWeights })).value;
  } catch (error) {
    construction.throw(error);
    throw error;
  }
}

function* constructPixal3dSLatFlow({
  route,
  config = {},
  weights,
  conditioning,
  conditioningTensor,
  projectedConditioning,
  projectedConditioningTensor,
  coordinates,
  coordinateTensor,
  sampleTensor,
  concatTensor,
  concatConditioning,
  ropeFrequencies,
}) {
  const plan = buildPixal3dSLatFlowPlan(config);
  const runtime = route?.runtime;
  if (!runtime?.createTensor || !runtime?.runKernel) {
    throw new TypeError('registered WebGPU runtime required');
  }
  if (sampleTensor) validateBorrowed(sampleTensor, plan.inputShape, 'f32', 'SLat sample');
  if (coordinateTensor) {
    validateBorrowed(coordinateTensor, plan.coordinateShape, 'i32', 'coordinates');
    if (coordinates !== undefined) throw new TypeError('borrowed coordinates must not have a CPU replacement');
  } else if (!(coordinates instanceof Int32Array) || coordinates.length !== plan.tokenRows * 3) {
    throw new TypeError('complete source-ordered Int32 coordinates required');
  }
  if (plan.mode === 'texture') {
    if (concatTensor) {
      validateBorrowed(concatTensor, plan.inputShape, 'f32', 'shape conditioning');
      if (concatConditioning !== undefined) throw new TypeError('borrowed shape conditioning forbids CPU replacement');
    } else if (
      !(concatConditioning instanceof Float32Array) ||
      concatConditioning.length !== plan.tokenRows * 32 ||
      !concatConditioning.every(Number.isFinite)
    ) {
      throw new TypeError('complete finite shape conditioning required');
    }
  } else if (concatTensor !== undefined || concatConditioning !== undefined) {
    throw new TypeError('shape flow has no concatenated texture conditioning');
  }
  const frequencies =
    ropeFrequencies ??
    Float32Array.from({ length: plan.frequencies }, (_, i) =>
      Math.fround(1 / Math.fround(Math.pow(10000, Math.fround(i / plan.frequencies)))),
    );
  if (
    !(frequencies instanceof Float32Array) ||
    frequencies.length !== plan.frequencies ||
    !frequencies.every(v => Number.isFinite(v) && v > 0)
  ) {
    throw new TypeError('complete finite source RoPE frequencies required');
  }

  const owned = [];
  let flow, ownedSample, disposed = false, parametersRetired = false, running = false, phasesInitialized = false, initialized = !!sampleTensor;
  const tensor = (name, shape, dtype = 'f32') => {
    const bytes = shape.reduce((a, b) => a * b, 4);
    if (bytes > (runtime.device?.limits?.maxStorageBufferBindingSize ?? 134217728)) {
      throw new RangeError(`${name} exceeds actual storage binding capacity`);
    }
    const t = runtime.createTensor({
      name: `pixal3d.slat.${name}`,
      shape,
      dtype,
      usage: U.storage | U.copyDst | U.copySrc,
    });
    owned.push(t);
    return t;
  };
  const grid = count => {
    const groups = Math.ceil(count / 64);
    const limit = runtime.device?.limits?.maxComputeWorkgroupsPerDimension ?? 65535;
    const x = Math.min(groups, limit), y = Math.ceil(groups / x);
    if (y > limit) throw new RangeError('SLat dispatch exceeds device capacity');
    return [x, y, 1];
  };
  const define = (stage, code, resources, dispatch) => ({
    stage,
    dispatch,
    kernel: runtime.defineComputeKernel({
      name: `pixal3d.${stage}`,
      code,
      bindings: resources.map((resource, i) => ({
        name: `b${i}`,
        resource,
        access: i === resources.length - 1 ? 'storage' : 'read-only-storage',
      })),
    }),
  });
  const releaseParameters = () => {
    if (disposed || parametersRetired) return;
    if (running) throw new Error('pixal3d SLat flow adapter in use');
    flow?.releaseParameters();
    for (const t of owned) if (t !== ownedSample) t.buffer?.destroy?.();
    parametersRetired = true;
  };
  const cleanup = () => {
    releaseParameters();
    flow?.dispose();
    ownedSample?.buffer?.destroy?.();
  };

  try {
    const sample = sampleTensor ?? (ownedSample = tensor('sample', plan.inputShape));
    const coords = coordinateTensor ?? tensor('coordinates', plan.coordinateShape, 'i32');
    if (!coordinateTensor) runtime.uploadTensor(coords, coordinates);
    const freqs = tensor('rope-frequencies', [Math.max(1, plan.frequencies)]);
    runtime.uploadTensor(freqs, plan.frequencies ? frequencies : new Float32Array(1));
    const phases = tensor('rope-phases', plan.phasesShape);
    const phaseOperation = define(
      'slat-coordinate-rope',
      slatCoordinateRopeShader(plan),
      [coords, freqs, phases],
      grid((plan.tokenRows * plan.flow.block.headDim) / 2),
    );
    let packed = sample, concatOperation;
    if (plan.mode === 'texture') {
      const shape = concatTensor ?? tensor('shape-conditioning', plan.inputShape);
      if (!concatTensor) runtime.uploadTensor(shape, concatConditioning);
      packed = tensor('texture-model-input', [plan.tokenRows, 64]);
      concatOperation = define(
        'slat-texture-concat',
        concatShader(plan.tokenRows),
        [sample, shape, packed],
        grid(plan.tokenRows * 32),
      );
    }
    flow = yield {
      route,
      config: plan.flowConfig,
      weights,
      conditioning,
      conditioningTensor,
      projectedConditioning,
      projectedConditioningTensor,
      phaseTensor: phases,
      sampleTensor: packed,
    };
    const dispatch = (op, invocation) =>
      runtime.runKernel(op.kernel, {
        stage: op.stage,
        dispatch: op.dispatch,
        schedulerInvocation: invocation,
        yieldAfter: true,
      });
    return Object.freeze({
      plan: Object.freeze({ ...plan, block: flow.plan.block }),
      runtime,
      routeId: route.routeId,
      inputs: Object.freeze({
        sample,
        coordinates: coords,
        ...(conditioningTensor !== undefined ? { conditioning: conditioningTensor } : {}),
        ...(projectedConditioningTensor !== undefined ? { projectedConditioning: projectedConditioningTensor } : {}),
      }),
      outputs: flow.outputs,
      diagnostics: Object.freeze({ ...flow.diagnostics, phases }),
      async run(
        {
          sample: initial,
          timestep,
          conditioning: nextConditioning,
          projectedConditioning: nextProjectedConditioning,
          zeroConditioning = false,
        } = {},
        invocation,
      ) {
        if (disposed) throw new Error('pixal3d SLat flow adapter disposed');
        if (parametersRetired) throw new Error('pixal3d SLat flow parameters retired');
        if (running) throw new Error('pixal3d SLat flow adapter in use');
        if (!Number.isFinite(timestep)) throw new TypeError('finite model timestep required');
        if (sampleTensor && initial !== undefined) throw new TypeError('borrowed SLat sample forbids CPU reupload');
        if (
          initial !== undefined &&
          (!(initial instanceof Float32Array) || initial.length !== plan.tokenRows * 32 || !initial.every(Number.isFinite))
        ) {
          throw new TypeError('complete finite SLat sample required');
        }
        if (!initialized && initial === undefined) throw new TypeError('initial SLat noise upload required');
        running = true;
        try {
          if (initial !== undefined) {
            runtime.uploadTensor(sample, initial);
            initialized = true;
          }
          if (!phasesInitialized) {
            await dispatch(phaseOperation, invocation);
            phasesInitialized = true;
          }
          if (concatOperation) await dispatch(concatOperation, invocation);
          return await flow.run(
            {
              timestep,
              conditioning: nextConditioning,
              projectedConditioning: nextProjectedConditioning,
              zeroConditioning,
            },
            invocation,
          );
        } finally {
          running = false;
        }
      },
      releaseParameters,
      dispose() {
        if (running) throw new Error('pixal3d SLat flow adapter in use');
        if (disposed) return;
        cleanup();
        disposed = true;
      },
    });
  } catch (error) {
    cleanup();
    throw error;
  }
}
