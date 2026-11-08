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

// Optional consumer of the completed support already used by the next shape model.
// This copies coordinates, not logits or latents, and performs no neural decoding.
export async function readTrellisOccupancyPreview({runtime,coordinates,plan,runId,routeId,steps,invocation}={}){
  if(!runtime?.readTensor||![runId,routeId,invocation?.jobId,invocation?.invocationId].every(v=>typeof v==='string'&&v.trim()))
    throw TypeError('occupancy preview needs its runtime and actual run/route/job/invocation identities');
  const r=plan?.outputResolution,n=coordinates?.shape?.[0];
  if(!Number.isSafeInteger(r)||r<1||plan.resolution!==2*r||plan.candidateRows!==r**3||plan.threshold!==0||plan.downsample!=='2-cubed-max-any'||plan.coordinateOrder!=='z-y-x-lexicographic'||
    !Number.isSafeInteger(steps)||steps<1||!coordinates?.buffer||coordinates.dtype!=='i32'||
    !(coordinates.usage&U.copySrc)||!Number.isSafeInteger(n)||n<1||n>plan.candidateRows||coordinates.shape.length!==2||coordinates.shape[1]!==3||coordinates.byteLength!==n*12)
    throw TypeError('complete source occupancy plan and resident Int32[N,3] support required');
  const raw=await runtime.readTensor(coordinates,{schedulerInvocation:invocation});
  const values=raw instanceof ArrayBuffer?new Int32Array(raw):raw;
  if(!(values instanceof Int32Array)||values.length!==n*3)throw Error('partial or retyped occupancy preview readback');
  // Own the CPU storage even when a runtime reuses its readback backing store.
  const snapshot=values.slice();let previous=-1;
  for(let i=0;i<n;i++){
    const z=snapshot[i*3],y=snapshot[i*3+1],x=snapshot[i*3+2],code=(z*r+y)*r+x;
    if(z<0||y<0||x<0||z>=r||y>=r||x>=r||code<=previous)throw Error('occupancy preview coordinates are outside the grid or not source-ordered unique rows');
    previous=code;
  }
  return Object.freeze({schema:'trellis2.sparse-occupancy-preview.v1',kind:'sparse-occupancy',stage:'occupancy-coordinates',status:'completed',
    runId,routeId,jobId:invocation.jobId,invocationId:invocation.invocationId,step:steps,steps,count:n,coordinates:snapshot,
    grid:{dimensions:[r,r,r],sourceDimensions:[plan.resolution,plan.resolution,plan.resolution],downsample:[2,2,2],threshold:plan.threshold,rule:plan.downsample},
    layout:{dtype:'int32',shape:[n,3],rowOrder:plan.coordinateOrder,componentOrder:['source-z','source-y','source-x']},
    spatial:{frame:'trellis-source',gridToSource:{scale:[1/r,1/r,1/r],offset:[-.5,-.5,-.5]},cellCenterOffset:[.5,.5,.5],
      sourceToGltf:[1,0,0,0, 0,0,-1,0, 0,1,0,0, 0,0,0,1],
      convention:'source components map directly to mesh position components; display transform belongs to the consumer'},
    lifetime:'owned-cpu-snapshot',coordinateBytesToCPU:snapshot.byteLength,additionalDecoderExecutions:0});
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
      async coordinates(invocation) {
        available(); if (!completed) throw Error('occupancy coordinate job not completed');
        if (coordinateView) return coordinateView;
        running = true;
        try {
          const raw = await runtime.readTensor(count,{schedulerInvocation:invocation}), values = raw instanceof ArrayBuffer ? new Uint32Array(raw) : raw;
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
