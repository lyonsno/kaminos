// Browser witness for SuperMat stage parity against the pinned CPU reference.
// Proof-only: reference tensors, captures and readbacks stay out of the route.
import {
  compareWebGpuParityArrays, createWebGpuInferenceSession, defineWebGpuModelResourceManifest,
} from '../../webgpu-inference-kit/src/core.js';
import { createSuperMatOps } from './supermat-ops.js';
import {
  createWeightAccessor, decodeLatent, decodeScaledLatent, encodeImage, runUnet, timeEmbedding,
} from './supermat-model.js';

// Predeclared before the first native run. A stage passes only when every
// captured boundary meets its tolerance; failures are retained, not relaxed.
export const STAGE_TOLERANCES = Object.freeze({
  'vae-encoder': { relativeL2: 1e-4, cosine: 0.999999 },
  'vae-decoder': { relativeL2: 1e-4, cosine: 0.999999 },
  unet: { relativeL2: 5e-4, cosine: 0.99999 },
  full: { relativeL2: 1e-3, cosine: 0.9999, outputMaxAbs: 2e-3 },
});

export const STAGE_RESOURCES = Object.freeze({
  'vae-encoder': ['vae-encoder'],
  'vae-decoder': ['vae-decoder'],
  unet: ['conditioning', 'unet-embed', 'unet-down-0', 'unet-down-1', 'unet-down-2', 'unet-down-3', 'unet-mid',
    'unet-up-0', 'unet-up-1', 'unet-up-2', 'unet-heads'],
  full: ['vae-encoder', 'vae-decoder', 'conditioning', 'unet-embed', 'unet-down-0', 'unet-down-1', 'unet-down-2',
    'unet-down-3', 'unet-mid', 'unet-up-0', 'unet-up-1', 'unet-up-2', 'unet-heads'],
});

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

async function fetchReference(manifest, name) {
  const row = manifest.tensors[name];
  if (!row) throw new Error(`reference tensor ${name} is missing`);
  const response = await fetch(`/fixture/${encodeURIComponent(row.file)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`reference ${name}: HTTP ${response.status}`);
  const values = new Float32Array(await response.arrayBuffer());
  const expected = row.shape.reduce((a, b) => a * b, 1);
  if (values.length !== expected) throw new Error(`reference ${name}: ${values.length} values, expected ${expected}`);
  return { values, shape: row.shape };
}

function squeezeBatch(shape) {
  return shape[0] === 1 ? shape.slice(1) : shape;
}

export async function runSuperMatWitness({ stage, fixtureSha256, weightsSha256 }) {
  const result = { schema: 'supermat.stage-witness.browser.v0', stage, status: 'failed', phase: 'admission',
    fixtureSha256, weightsSha256, tolerances: STAGE_TOLERANCES[stage], comparisons: {}, timings: {} };
  let session, route, ops;
  const leases = [];
  const captures = new Map();
  try {
    if (!STAGE_TOLERANCES[stage]) throw new Error(`unknown witness stage ${stage}`);
    const reference = await fetchJson('/fixture/manifest.json');
    if (reference.status !== 'succeeded') throw new Error('reference manifest is not a succeeded export');
    const weightPackage = await fetchJson('/weights/package.json');
    if (weightPackage.status !== 'succeeded') throw new Error('weight package is not a succeeded pack');

    result.phase = 'device';
    session = await createWebGpuInferenceSession({ sessionId: `supermat-witness-${stage}`, gpu: navigator.gpu,
      adapterName: 'supermat-witness' });
    route = await session.registerRoute({ routeId: 'supermat.image-to-pbr.webgpu-local.v0' });
    const device = route.runtime.device;
    result.adapter = route.runtime.backendIdentity ?? null;
    result.limits = { maxBufferSize: device.limits.maxBufferSize,
      maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize };

    result.phase = 'weights';
    const tensors = {};
    const loadStart = performance.now();
    for (const resourceId of STAGE_RESOURCES[stage]) {
      const row = weightPackage.resources.find(item => item.resourceId === resourceId);
      if (!row) throw new Error(`weight resource ${resourceId} is missing`);
      const manifest = defineWebGpuModelResourceManifest(row.manifest);
      const lease = await route.loadModelResourcesFromSource({ manifest, source: new URL(`/weights/${row.file}`, location.origin) });
      leases.push(lease);
      Object.assign(tensors, lease.tensors);
    }
    result.timings.weightLoadMs = performance.now() - loadStart;
    const w = createWeightAccessor(tensors);

    result.phase = 'execution';
    device.pushErrorScope('validation');
    device.pushErrorScope('out-of-memory');
    ops = createSuperMatOps(device, { label: `supermat.${stage}` });
    const capture = (name, tensor) => {
      const copy = device.createBuffer({ label: `capture.${name}`, size: tensor.byteLength, usage: 0x0004 | 0x0008 | 0x0080 });
      ops.copy(tensor, { buffer: copy, offset: 0, byteLength: tensor.byteLength }, { size: tensor.byteLength });
      captures.set(name, { buffer: copy, byteLength: tensor.byteLength });
    };
    const outputs = {};
    const runStart = performance.now();
    if (stage === 'vae-encoder' || stage === 'full') {
      const rgb = await fetchReference(reference, 'input.rgb');
      const image = ops.upload(squeezeBatch(rgb.shape), rgb.values, 'input.rgb');
      outputs.latent = encodeImage(ops, w, image, { capture });
      ops.release(image);
    }
    if (stage === 'unet') {
      const sample = await fetchReference(reference, 'unet.in.sample');
      outputs.latent = ops.upload(squeezeBatch(sample.shape), sample.values, 'unet.in.sample');
    }
    if (stage === 'unet' || stage === 'full') {
      const context = { tensor: tensors['conditioning.empty_prompt'], rows: 77 };
      const tembSilu = timeEmbedding(ops, w, { capture });
      const [vAlbedo, vOrm] = runUnet(ops, w, outputs.latent, context, tembSilu, { capture });
      ops.release(tembSilu);
      const scale = weightPackage.constants?.vScale;
      if (!Number.isFinite(scale)) throw new Error('weight package lacks the source scheduler vScale constant');
      result.x0Scale = { package: scale, reference: reference.x0Rule?.vScale ?? null };
      outputs.x0 = [vAlbedo, vOrm].map((v, index) => {
        const x0 = ops.affine({ x: v, shape: v.shape, scale, name: `x0.${index}` });
        ops.release(v);
        return x0;
      });
    }
    if (stage === 'full') {
      outputs.images = outputs.x0.map((x0, call) => decodeLatent(ops, w, x0, { capture, call }));
      capture('output.albedo', outputs.images[0]);
      capture('output.orm', outputs.images[1]);
    }
    if (stage === 'vae-decoder') {
      outputs.images = [];
      for (const call of [0, 1]) {
        const input = await fetchReference(reference, `vae.decode.in#${call}`);
        const z = ops.upload(squeezeBatch(input.shape), input.values, `vae.decode.in#${call}`);
        outputs.images.push(decodeScaledLatent(ops, w, z, { capture, call }));
        ops.release(z);
      }
      capture('output.albedo', outputs.images[0]);
      capture('output.orm', outputs.images[1]);
    }
    if (stage === 'vae-encoder') capture('unet.in.sample', outputs.latent);
    await ops.flush();
    result.timings.executeMs = performance.now() - runStart;
    const oom = await device.popErrorScope();
    const validation = await device.popErrorScope();
    if (oom || validation) throw new Error(`WebGPU ${oom ? 'out-of-memory' : 'validation'} error: ${(oom ?? validation).message}`);
    result.opStats = { ...ops.stats };

    result.phase = 'comparison';
    const tolerance = STAGE_TOLERANCES[stage];
    let pass = true;
    for (const [name, captured] of captures) {
      const ref = await fetchReference(reference, name);
      const actual = await readBuffer(device, captured.buffer, captured.byteLength);
      const comparison = compareWebGpuParityArrays(actual, ref.values, { stageId: name });
      const m = comparison.metrics;
      const row = { shape: ref.shape, relativeL2Error: m.relativeL2Error, cosineSimilarity: m.cosineSimilarity,
        maxAbsoluteError: m.maxAbsoluteError, meanAbsoluteError: m.meanAbsoluteError,
        worstSourceIndex: m.worstSourceIndex, worstActual: m.worstActual, worstReference: m.worstReference,
        nonFinite: comparison.nonFinite };
      const isOutput = name.startsWith('output.');
      row.pass = m.relativeL2Error !== null && m.relativeL2Error <= tolerance.relativeL2
        && m.cosineSimilarity >= tolerance.cosine
        && (!isOutput || tolerance.outputMaxAbs === undefined || m.maxAbsoluteError <= tolerance.outputMaxAbs)
        && comparison.nonFinite.actual.count === 0;
      pass &&= row.pass;
      result.comparisons[name] = row;
      if (isOutput) {
        const saved = await fetch(`/output/${name}`, { method: 'POST', body: actual.buffer });
        if (!saved.ok) throw new Error(`raw output ${name} was not persisted: HTTP ${saved.status}`);
      }
    }
    result.phase = 'complete';
    result.status = pass ? 'passed' : 'failed-tolerance';
  } catch (error) {
    result.error = `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`;
  } finally {
    for (const { buffer } of captures.values()) buffer.destroy();
    ops?.destroy();
    for (const lease of leases) lease.release();
    if (route) { await route.drain?.(); session?.unregisterRoute(route.routeId); }
    await session?.close?.();
  }
  return result;
}

async function readBuffer(device, buffer, byteLength) {
  const staging = device.createBuffer({ size: byteLength, usage: 0x0001 | 0x0008 });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(buffer, 0, staging, 0, byteLength);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(0x0001);
  const values = new Float32Array(staging.getMappedRange().slice(0));
  staging.unmap();
  staging.destroy();
  return values;
}
