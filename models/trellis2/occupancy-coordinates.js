import { WEBGPU_BUFFER_USAGE as U } from '../../webgpu-inference-kit/src/core.js';
export {buildSLatRegridPlan,createTrellisSLatRegridAdapter,SLAT_REGRID_SOURCE} from './slat-regrid.js';

export const OCCUPANCY_COORDINATES_ROUTE = 'trellis2.occupancy-coordinates.webgpu.v0';
export function buildOccupancyCoordinatesPlan({ resolution = 64 } = {}) {
  if (!Number.isSafeInteger(resolution) || resolution < 2 || resolution % 2) throw new RangeError('positive even occupancy resolution required');
  const outputResolution = resolution / 2, candidateRows = outputResolution ** 3;
  if (!Number.isSafeInteger(resolution ** 3 * 4) || resolution ** 3 * 4 >= 2 ** 32 || candidateRows * 12 >= 2 ** 32) {
    throw new RangeError('occupancy coordinates exceed WebGPU u32 addressing');
  }
  return Object.freeze({ resolution, outputResolution, candidateRows, inputShape: [1, 1, resolution, resolution, resolution],
    coordinateCapacityShape: [candidateRows, 3], coordinateOrder: 'z-y-x-lexicographic', metadataReadbackBytes: 4,
    stages: Object.freeze(['occupancy-max-any', 'occupancy-coordinate-compact']), threshold: 0, downsample: '2-cubed-max-any' });
}

export function occupancyDownsampleShader(plan) {
  const r = plan.resolution, s = plan.outputResolution;
  return `
@group(0) @binding(0) var<storage,read> logits:array<f32>;
@group(0) @binding(1) var<storage,read_write> flags:array<u32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>,@builtin(num_workgroups) grid:vec3<u32>){
  let i=gid.x+gid.y*grid.x*256u;if(i >= ${plan.candidateRows}u){return;}
  let z=i/${s * s}u;let y=(i/${s}u)%${s}u;let x=i%${s}u;var occupied=false;
  for(var dz=0u;dz<2u;dz++){for(var dy=0u;dy<2u;dy++){for(var dx=0u;dx<2u;dx++){
    occupied=occupied || (logits[((2u*z+dz)*${r}u+2u*y+dy)*${r}u+2u*x+dx] > 0.0);
  }}}
  flags[i]=select(0u,1u,occupied);
}`;
}

export function occupancyCompactionShader(plan) {
  const s = plan.outputResolution;
  //32768 source candidates at64³ is a small metadata scan, not a token cap.
  //Serial scatter preserves np.argwhere's exact lexicographic row identity.
  return `
@group(0) @binding(0) var<storage,read> flags:array<u32>;
@group(0) @binding(1) var<storage,read_write> coordinates:array<i32>;
@group(0) @binding(2) var<storage,read_write> count:array<u32>;
@compute @workgroup_size(1)
fn main(){
  var rows=0u;
  for(var i=0u;i < ${plan.candidateRows}u;i++){
    if(flags[i]!=0u){coordinates[rows*3u]=i32(i/${s * s}u);
      coordinates[rows*3u+1u]=i32((i/${s}u)%${s}u);coordinates[rows*3u+2u]=i32(i%${s}u);rows++;}
  }
  count[0]=rows;
}`;
}

export function createTrellisOccupancyCoordinatesAdapter({ route, resolution = 64, logitsTensor }) {
  const plan = buildOccupancyCoordinatesPlan({ resolution }), runtime = route?.runtime;
  if (!runtime?.createTensor || !runtime?.runKernel || !runtime?.readTensor) throw new TypeError('registered coordinate runtime required');
  if (!logitsTensor?.buffer || logitsTensor.dtype !== 'f32' || !(logitsTensor.usage & U.storage) ||
      logitsTensor.byteLength !== resolution ** 3 * 4 || JSON.stringify(logitsTensor.shape) !== JSON.stringify(plan.inputShape)) {
    throw new TypeError('complete resident F32 occupancy logits required');
  }
  const resources = []; let disposed = false, running = false, completed = false, coordinateView;
  const tensor = (name, shape, dtype) => {
    if (shape.reduce((a, b) => a * b, 4) > (runtime.device?.limits?.maxStorageBufferBindingSize ?? 134217728)) {
      throw new RangeError('coordinate tensor exceeds effective binding capacity');
    }
    const t = runtime.createTensor({ name: 'trellis.occupancy.' + name, shape, dtype, usage: U.storage | U.copyDst | U.copySrc });
    resources.push(t); return t;
  };
  const available = () => { if (disposed) throw Error('occupancy coordinate adapter disposed'); if (running) throw Error('occupancy coordinate adapter in use'); };
  const cleanup = () => resources.forEach(t => t.buffer?.destroy?.());
  try {
    const flags = tensor('flags', [plan.candidateRows], 'u32'), capacity = tensor('coordinates', plan.coordinateCapacityShape, 'i32'), count = tensor('count', [1], 'u32');
    const limit = runtime.device?.limits?.maxComputeWorkgroupsPerDimension ?? 65535, groups = Math.ceil(plan.candidateRows / 256);
    const x = Math.min(groups, limit), y = Math.ceil(groups / x); if (y > limit) throw new RangeError('occupancy dispatch exceeds device capacity');
    const operation = (stage, code, tensors, dispatch) => ({ stage, dispatch, kernel: runtime.defineComputeKernel({ name: 'trellis.' + stage, code,
      bindings: tensors.map((resource, i) => ({ name: 'b' + i, resource, access: i === 0 ? 'read-only-storage' : 'storage' })) }) });
    const operations = [operation(plan.stages[0], occupancyDownsampleShader(plan), [logitsTensor, flags], [x, y, 1]),
      operation(plan.stages[1], occupancyCompactionShader(plan), [flags, capacity, count], [1, 1, 1])];
    return Object.freeze({ plan, runtime, routeId: route.routeId, inputs: Object.freeze({ logits: logitsTensor }),
      outputs: Object.freeze({ coordinateCapacity: capacity, count }),
      async run(invocation) {
        available(); running = true; completed = false; coordinateView = undefined;
        try {
          for (const op of operations) await runtime.runKernel(op.kernel, { stage: op.stage, dispatch: op.dispatch, schedulerInvocation: invocation, yieldAfter: true });
          completed = true; return { coordinateCapacity: capacity, count, coordinateOrder: plan.coordinateOrder };
        } finally { running = false; }
      },
      //Call after the coordinate job completes. Only the4-byte count metadata
      //crosses to CPU to specialize the next model's geometry. Latent/logits/
      //coordinate bytes remain resident. Views are overwritten by the next run.
      async coordinates() {
        available(); if (!completed) throw Error('occupancy coordinate job not completed');
        if (coordinateView) return coordinateView;
        running = true;
        try {
          const raw = await runtime.readTensor(count), values = raw instanceof ArrayBuffer ? new Uint32Array(raw) : raw;
          if (!(values instanceof Uint32Array) || values.length !== 1) throw Error('complete occupancy count metadata required');
          const rows = values[0]; if (rows > plan.candidateRows) throw Error('occupancy count exceeds coordinate capacity');
          if (rows === 0) throw Error('no occupied coordinates; no replacement support');
          coordinateView = runtime.createTensor({ name: 'trellis.occupancy.occupied-view', shape: [rows, 3], dtype: 'i32',
            buffer: capacity.buffer, usage: capacity.usage, metadata: { rowOrder: plan.coordinateOrder, metadataReadbackBytes: 4 } });
          return coordinateView;
        } finally { running = false; }
      },
      dispose() { if (disposed) return; available(); disposed = true; cleanup(); }
    });
  } catch (error) { cleanup(); throw error; }
}
