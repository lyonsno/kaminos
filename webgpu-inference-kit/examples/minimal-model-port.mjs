import {
  WEBGPU_BUFFER_USAGE,
  createWebGpuInferenceSession,
} from '@kaminos/webgpu-inference-kit';

export const MINIMAL_MODEL_ROUTE_ID = 'example.affine-f32.webgpu-local.v0';
export const GETTING_STARTED_REPORT_SCHEMA = 'kaminos.webgpu-inference-kit.getting-started.v0';

const VALUE_COUNT = 4;
const AFFINE_KERNEL = `
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read_write> output_values: array<f32>;

@compute @workgroup_size(4)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x < 4u) {
    output_values[id.x] = input_values[id.x] * 2.0 + 1.0;
  }
}
`;

function normalizeValues(values) {
  if (!Array.isArray(values) && !ArrayBuffer.isView(values)) {
    throw new Error('minimal model input must be an array-like value');
  }
  if (values.length !== VALUE_COUNT) {
    throw new Error(`minimal model input must contain exactly ${VALUE_COUNT} values`);
  }
  const normalized = Float32Array.from(values);
  if ([...normalized].some(value => !Number.isFinite(value))) {
    throw new Error('minimal model input values must be finite');
  }
  return normalized;
}

export function createMinimalModelAdapter({ route }) {
  if (!route || typeof route !== 'object') throw new Error('route is required');
  const runtime = route.runtime;
  if (!runtime || typeof runtime.createTensor !== 'function') {
    throw new Error('route runtime must expose WebGPU tensor helpers');
  }

  const inputTensor = runtime.createTensor({
    name: 'getting-started.input',
    shape: [VALUE_COUNT],
    dtype: 'f32',
    usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst,
  });
  const outputTensor = runtime.createTensor({
    name: 'getting-started.output',
    shape: [VALUE_COUNT],
    dtype: 'f32',
    usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copySrc,
  });
  const kernel = runtime.defineComputeKernel({
    name: 'getting-started.affine-f32',
    code: AFFINE_KERNEL,
    bindings: [
      { name: 'input', resource: inputTensor, access: 'read-only-storage' },
      { name: 'output', resource: outputTensor, access: 'storage' },
    ],
  });
  let disposed = false;

  return Object.freeze({
    modelId: 'affine-f32-v0',
    async run(values, invocation) {
      if (disposed) throw new Error('minimal model adapter is disposed');
      if (!invocation || typeof invocation.reportProgress !== 'function') {
        throw new Error('queued invocation context with reportProgress is required');
      }
      const input = normalizeValues(values);
      runtime.uploadTensor(inputTensor, input);
      invocation.reportProgress({ phase: 'input-upload', completed: 1, total: 3 });

      await runtime.runKernel(kernel, {
        stage: 'affine-transform',
        dispatch: [1, 1, 1],
        schedulerInvocation: invocation,
        yieldAfter: true,
      });
      invocation.reportProgress({ phase: 'gpu-dispatch', completed: 2, total: 3 });

      const bytes = await runtime.readTensor(outputTensor, {
        schedulerInvocation: invocation,
      });
      invocation.reportProgress({ phase: 'output-readback', completed: 3, total: 3 });
      return Array.from(new Float32Array(bytes));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      inputTensor.buffer?.destroy?.();
      outputTensor.buffer?.destroy?.();
    },
  });
}

function terminalFailure(completion) {
  const message = completion.failure?.message || completion.cancellation?.reason || completion.status;
  const error = new Error(`minimal model job ${completion.jobId} ${message}`);
  error.completion = completion;
  return error;
}

export async function runMinimalModelPort({
  gpu = globalThis.navigator?.gpu,
  sessionId = globalThis.crypto?.randomUUID?.() || 'getting-started-session',
  jobIds = ['affine-first', 'affine-second'],
  inputs = [[0, 1, 2, 3], [4, 5, 6, 7]],
} = {}) {
  if (!gpu || typeof gpu.requestAdapter !== 'function') {
    throw new Error('WebGPU is unavailable; run this example in a browser with navigator.gpu');
  }
  if (!Array.isArray(inputs) || inputs.length !== 2) {
    throw new Error('the getting-started route requires exactly two invocation inputs');
  }
  if (!Array.isArray(jobIds) || jobIds.length !== inputs.length) {
    throw new Error('jobIds must identify every invocation');
  }

  const session = await createWebGpuInferenceSession({
    sessionId,
    gpu,
    adapterName: 'browser-primary-adapter',
  });
  let route;
  let adapter;
  let completions = [];

  try {
    route = await session.registerRoute({
      routeId: MINIMAL_MODEL_ROUTE_ID,
      runtimeOptions: {
        runtimeLabel: 'getting-started-affine-runtime',
        kernel: { profile: 'getting-started.affine-f32.v0' },
        requiredStages: ['affine-transform'],
        yieldMs: 0,
      },
    });
    adapter = createMinimalModelAdapter({ route });

    const jobs = inputs.map((values, index) => route.enqueue({
      jobId: jobIds[index],
      metadata: { modelId: adapter.modelId, invocationIndex: index },
      execute: invocation => adapter.run(values, invocation),
    }));
    completions = await Promise.all(jobs.map(job => job.completion));
    const failed = completions.find(completion => completion.status !== 'succeeded');
    if (failed) throw terminalFailure(failed);

    for (const job of jobs) route.forgetJob(job.jobId);
  } finally {
    if (route) await route.drain();
    adapter?.dispose();
    if (route) session.unregisterRoute(route.routeId);
    await session.drain();
    session.close();
  }

  return Object.freeze({
    schema: GETTING_STARTED_REPORT_SCHEMA,
    status: 'succeeded',
    routeId: MINIMAL_MODEL_ROUTE_ID,
    outputs: completions.map(completion => completion.output),
    completions,
    session: session.snapshot(),
  });
}
