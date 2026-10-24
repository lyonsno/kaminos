// Offline boundary replay: serving sampler/runtime, recorded model predictions.
import { createWebGpuInferenceRuntime, WEBGPU_BUFFER_USAGE as U } from '../../webgpu-inference-kit/src/core.js';
import { createTrellisSparseSamplerAdapter } from './sparse-sampler.js';

export const CFG_OUTPUTS = ['positive', 'negative', 'guided', 'x0Positive', 'x0Guided', 'stds', 'rescaled', 'mixed', 'final', 'sampleNext'];
export function compareFrozenCfgArray(actual, expected) {
  if (actual.length !== expected.length || !actual.length) throw Error('complete equal-sized tensors required');
  let maxAbs = 0, squared = 0, unequal = 0;
  for (let i = 0; i < actual.length; i++) {
    if (!Number.isFinite(actual[i]) || !Number.isFinite(expected[i])) throw Error('nonfinite frozen arithmetic');
    const delta = actual[i] - expected[i]; maxAbs = Math.max(maxAbs, Math.abs(delta)); squared += delta * delta;
    if (actual[i] !== expected[i]) unequal++;
  }
  return { elements: actual.length, exact: unequal === 0, unequal, maxAbs, rms: Math.sqrt(squared / actual.length) };
}

export async function runFrozenCfgCase(manifest, trial) {
  let device, runtime, sampler;
  const errors = [], calls = [], routeId = 'trellis2.observed-kiln-cfg.webgpu.v0';
  const sha = async data => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), x => x.toString(16).padStart(2, '0')).join('');
  const load = async name => {
    const d = manifest.tensors[name], response = await fetch('/' + d.file, { cache: 'no-store' });
    if (!response.ok) throw Error('missing frozen input ' + name);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== d.bytes || await sha(bytes) !== d.sha256) throw Error('changed frozen input ' + name);
    return new Float32Array(bytes);
  };
  try {
    const adapter = await navigator.gpu?.requestAdapter(); if (!adapter) throw Error('WebGPU unavailable');
    const backend = { vendor: adapter.info.vendor, architecture: adapter.info.architecture,
      isFallbackAdapter: adapter.info.isFallbackAdapter ?? adapter.isFallbackAdapter };
    if (backend.vendor !== 'apple' || !backend.architecture.includes('metal') || backend.isFallbackAdapter !== false) throw Error('native Apple Metal required');
    device = await adapter.requestDevice();
    device.addEventListener('uncapturederror', e => errors.push(e.error.message));
    runtime = await createWebGpuInferenceRuntime({ adapter, device, routeId, gpuTiming: false });
    const shape = [manifest.config.tokenRows, 32];
    const tensor = name => runtime.createTensor({ name, shape, dtype: 'f32', usage: U.storage | U.copySrc | U.copyDst });
    const sample = tensor('recorded sample'), prediction = tensor('recorded prediction');
    const input = await load('sample'), positive = await load('positive'), negative = await load('negative');
    const flow = { runtime, routeId, plan: { block: { contextRows: 1, contextChannels: 1 } },
      inputs: { sample }, outputs: { prediction },
      async run(args) {
        if (args.sample !== undefined) runtime.uploadTensor(sample, args.sample);
        const branch = args.conditioning[0] === 1 ? 'positive' : 'negative';
        runtime.uploadTensor(prediction, branch === 'positive' ? positive : negative);
        calls.push({ branch, timestep: args.timestep });
      } };
    sampler = createTrellisSparseSamplerAdapter({ route: { runtime, routeId }, flow,
      config: manifest.config, conditioning: new Float32Array([1]) });
    const clock = sampler.plan.steps[manifest.stepIndex];
    if (!clock || !clock.guided || Math.fround(clock.time) !== manifest.capturedClockF32[0] ||
      Math.fround(clock.previousTime) !== manifest.capturedClockF32[1]) throw Error('recorded sampler clock mismatch');
    const result = await sampler.step({ sample: input, stepIndex: manifest.stepIndex });
    if (result.sample !== sample || result.modelCalls !== 2 || !result.guidanceRescaled ||
      calls.length !== 2 || calls[0].branch !== 'positive' || calls[1].branch !== 'negative' ||
      calls.some(c => c.timestep !== clock.modelTime)) throw Error('frozen prediction branch/clock mismatch');
    // No readback occurs between predictions and Euler update. Persist every
    // complete diagnostic only after the serving sampler returns.
    const outputs = {};
    for (const name of CFG_OUTPUTS) {
      const raw = await runtime.readTensor(name === 'sampleNext' ? sample : sampler.diagnostics[name]);
      const bytes = raw instanceof ArrayBuffer ? raw : raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
      const response = await fetch(`/output/${trial}/${name}.f32`, { method: 'POST', body: bytes });
      if (!response.ok) throw Error('raw output not retained: ' + name);
      outputs[name] = { bytes: bytes.byteLength, sha256: await sha(bytes) };
    }
    if (errors.length) throw Error(errors.join('; '));
    return { trial, backend, effectiveRoute: routeId, clock, calls, outputs,
      predictionSource: 'recorded native tensors; no model forward', gpuTiming: false };
  } finally {
    sampler?.dispose(); await runtime?.dispose(); device?.destroy();
  }
}
