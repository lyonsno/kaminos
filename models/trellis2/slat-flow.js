// Source SLat shape/texture flow. Learned computation stays in the registered
// WebGPU runtime; fixtures and reference comparisons belong to offline observers.
import { WEBGPU_BUFFER_USAGE as U } from '../../webgpu-inference-kit/src/core.js';
import { buildSparseFlowPlan, createTrellisSparseFlowAdapter, createTrellisSparseFlowAdapterAsync } from './sparse-flow.js';

export const SLAT_FLOW_ROUTE = 'trellis2.slat-flow.webgpu.v0';

export function buildSLatFlowPlan(config = {}) {
  const { tokenRows, mode = 'shape' } = config;
  if (!Number.isSafeInteger(tokenRows) || tokenRows < 1) throw new RangeError('tokenRows must be a positive integer');
  if (!['shape', 'texture'].includes(mode)) throw new RangeError('SLat mode must be shape or texture');
  const flowConfig = { ...config, inChannels: mode === 'texture' ? 64 : 32, outChannels: 32 };
  const flow = buildSparseFlowPlan(flowConfig), pairs = flow.block.headDim / 2, frequencies = Math.floor(pairs / 3);
  return Object.freeze({ mode, tokenRows, flowConfig: Object.freeze(flowConfig), flow, frequencies,
    inputShape: [tokenRows, 32], outputShape: [tokenRows, 32], coordinateShape: [tokenRows, 3],
    phasesShape: [tokenRows, pairs, 2], stages: ['slat-coordinate-rope',
      ...(mode === 'texture' ? ['slat-texture-concat'] : []), ...flow.stages],
    arithmetic: flow.arithmetic, phaseArithmetic: 'source-f32-frequency/coordinate-product/cos-sin',
    inputLayout: 'token-major', coordinateOrder: 'z-y-x' });
}

export function slatCoordinateRopeShader(plan) {
  const pairs = plan.flow.block.headDim / 2;
  return `
@group(0) @binding(0) var<storage,read> coordinates:array<i32>;
@group(0) @binding(1) var<storage,read> frequencies:array<f32>;
@group(0) @binding(2) var<storage,read_write> phases:array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>,@builtin(num_workgroups) grid:vec3<u32>){
  let i=gid.x+gid.y*grid.x*64u;if(i>=${plan.tokenRows * pairs}u){return;}
  let row=i/${pairs}u;let pair=i%${pairs}u;var angle=0.0;
  ${plan.frequencies > 0 ? `if(pair<${3 * plan.frequencies}u){let axis=pair/${plan.frequencies}u;let frequency=pair%${plan.frequencies}u;
    angle=f32(coordinates[row * 3u + axis])*frequencies[frequency];}` : ''}
  phases[i*2u]=cos(angle);phases[i*2u+1u]=sin(angle);
}`;
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
  if (!tensor?.buffer || tensor.dtype !== dtype || !(tensor.usage & U.storage) ||
    tensor.byteLength !== shape.reduce((a, b) => a * b, 4) || JSON.stringify(tensor.shape) !== JSON.stringify(shape)) {
    throw new TypeError(`complete resident ${dtype} ${label} required`);
  }
}

export function createTrellisSLatFlowAdapter(options) {
  const construction=constructSLatFlow(options),step=construction.next();
  try{return construction.next(createTrellisSparseFlowAdapter(step.value)).value;}
  catch(error){construction.throw(error);throw error;}
}

export async function createTrellisSLatFlowAdapterAsync({loadBlockWeights,...options}) {
  const construction=constructSLatFlow(options),step=construction.next();
  try{return construction.next(await createTrellisSparseFlowAdapterAsync({...step.value,loadBlockWeights})).value;}
  catch(error){construction.throw(error);throw error;}
}

function* constructSLatFlow({ route, config = {}, weights, conditioning, conditioningTensor, coordinates,
  coordinateTensor, sampleTensor, concatTensor, concatConditioning, ropeFrequencies }) {
  const plan = buildSLatFlowPlan(config), runtime = route?.runtime;
  if (!runtime?.createTensor || !runtime?.runKernel) throw new TypeError('registered WebGPU runtime required');
  if (sampleTensor) validateBorrowed(sampleTensor, plan.inputShape, 'f32', 'SLat sample');
  if (coordinateTensor) {
    validateBorrowed(coordinateTensor, plan.coordinateShape, 'i32', 'coordinates');
    if (coordinates !== undefined) throw new TypeError('borrowed coordinates must not have a CPU replacement');
  } else if (!(coordinates instanceof Int32Array) || coordinates.length !== plan.tokenRows * 3) {
    throw new TypeError('complete source-ordered Int32 coordinates required');
  }
  if (plan.mode === 'texture') {
    if (concatTensor) { validateBorrowed(concatTensor, plan.inputShape, 'f32', 'shape conditioning');
      if (concatConditioning !== undefined) throw new TypeError('borrowed shape conditioning forbids CPU replacement'); }
    else if (!(concatConditioning instanceof Float32Array) || concatConditioning.length !== plan.tokenRows * 32 ||
      !concatConditioning.every(Number.isFinite)) throw new TypeError('complete finite shape conditioning required');
  } else if (concatTensor !== undefined || concatConditioning !== undefined) throw new TypeError('shape flow has no concatenated texture conditioning');
  const frequencies = ropeFrequencies ?? Float32Array.from({ length: plan.frequencies }, (_, i) =>
    Math.fround(1 / Math.fround(Math.pow(10000, Math.fround(i / plan.frequencies)))));
  if (!(frequencies instanceof Float32Array) || frequencies.length !== plan.frequencies ||
    !frequencies.every(v => Number.isFinite(v) && v > 0)) throw new TypeError('complete finite source RoPE frequencies required');
  const owned = []; let flow, ownedSample, disposed = false, parametersRetired = false, running = false, phasesInitialized = false, initialized = !!sampleTensor;
  const tensor = (name, shape, dtype = 'f32') => {
    const bytes = shape.reduce((a, b) => a * b, 4);
    if (bytes > (runtime.device?.limits?.maxStorageBufferBindingSize ?? 134217728)) throw new RangeError(`${name} exceeds actual storage binding capacity`);
    const t = runtime.createTensor({ name: `trellis.slat.${name}`, shape, dtype, usage: U.storage | U.copyDst | U.copySrc }); owned.push(t); return t;
  };
  const grid = count => { const groups = Math.ceil(count / 64), limit = runtime.device?.limits?.maxComputeWorkgroupsPerDimension ?? 65535;
    const x = Math.min(groups, limit), y = Math.ceil(groups / x); if (y > limit) throw new RangeError('SLat dispatch exceeds device capacity'); return [x, y, 1]; };
  const define = (stage, code, resources, dispatch) => ({ stage, dispatch, kernel: runtime.defineComputeKernel({ name: `trellis.${stage}`, code,
    bindings: resources.map((resource, i) => ({ name: `b${i}`, resource, access: i === resources.length - 1 ? 'storage' : 'read-only-storage' })) }) });
  const releaseParameters = () => {
    if(disposed||parametersRetired)return;if(running)throw new Error('SLat flow adapter in use');
    flow?.releaseParameters();for(const t of owned)if(t!==ownedSample)t.buffer?.destroy?.();parametersRetired=true;
  };
  const cleanup = () => { releaseParameters();flow?.dispose();ownedSample?.buffer?.destroy?.(); };
  try {
    const sample = sampleTensor ?? (ownedSample=tensor('sample', plan.inputShape));
    const coords = coordinateTensor ?? tensor('coordinates', plan.coordinateShape, 'i32');
    if (!coordinateTensor) runtime.uploadTensor(coords, coordinates);
    const freqs = tensor('rope-frequencies', [Math.max(1, plan.frequencies)]);
    runtime.uploadTensor(freqs, plan.frequencies ? frequencies : new Float32Array(1));
    const phases = tensor('rope-phases', plan.phasesShape);
    const phaseOperation = define('slat-coordinate-rope', slatCoordinateRopeShader(plan), [coords, freqs, phases], grid(plan.tokenRows * plan.flow.block.headDim / 2));
    let packed = sample, concatOperation;
    if (plan.mode === 'texture') {
      const shape = concatTensor ?? tensor('shape-conditioning', plan.inputShape);
      if (!concatTensor) runtime.uploadTensor(shape, concatConditioning);
      packed = tensor('texture-model-input', [plan.tokenRows, 64]);
      concatOperation = define('slat-texture-concat', concatShader(plan.tokenRows), [sample, shape, packed], grid(plan.tokenRows * 32));
    }
    flow = yield { route, config: plan.flowConfig, weights, conditioning, conditioningTensor, phaseTensor: phases, sampleTensor: packed };
    const dispatch = (op, invocation) => runtime.runKernel(op.kernel, { stage: op.stage, dispatch: op.dispatch, schedulerInvocation: invocation, yieldAfter: true });
    return Object.freeze({ plan: Object.freeze({ ...plan, block: flow.plan.block }), runtime, routeId: route.routeId,
      inputs: Object.freeze({ sample, coordinates: coords,
        ...(conditioningTensor!==undefined?{conditioning:conditioningTensor}:{}) }), outputs: flow.outputs, diagnostics: Object.freeze({ ...flow.diagnostics, phases }),
      async run({ sample: initial, timestep, conditioning: nextConditioning, zeroConditioning = false } = {}, invocation) {
        if (disposed) throw new Error('SLat flow adapter disposed'); if(parametersRetired)throw new Error('SLat flow parameters retired');
        if (running) throw new Error('SLat flow adapter in use');
        if (!Number.isFinite(timestep)) throw new TypeError('finite model timestep required');
        if (sampleTensor && initial !== undefined) throw new TypeError('borrowed SLat sample forbids CPU reupload');
        if (initial !== undefined && (!(initial instanceof Float32Array) || initial.length !== plan.tokenRows * 32 ||
          !initial.every(Number.isFinite))) throw new TypeError('complete finite SLat sample required');
        if (!initialized && initial === undefined) throw new TypeError('initial SLat noise upload required');
        running = true;
        try {
          if (initial !== undefined) { runtime.uploadTensor(sample, initial); initialized = true; }
          if (!phasesInitialized) { await dispatch(phaseOperation, invocation); phasesInitialized = true; }
          if (concatOperation) await dispatch(concatOperation, invocation);
          return await flow.run({ timestep, conditioning: nextConditioning, zeroConditioning }, invocation);
        } finally { running = false; }
      },
      releaseParameters,
      dispose() { if (running) throw new Error('SLat flow adapter in use'); if (disposed) return; cleanup(); disposed = true; }
    });
  } catch (error) { cleanup(); throw error; }
}
