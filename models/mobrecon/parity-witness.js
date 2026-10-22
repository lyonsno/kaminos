// Browser half of the MobRecon parity witness: loads the packed model through a
// kit session route, runs every reference case's exact source input through the
// WebGPU network, and compares outputs (and, for named cases, every block
// boundary the network materializes) with the PyTorch reference. Reference
// tensors are verified against their recorded SHA-256 before use.
import { createWebGpuInferenceSession } from '../../webgpu-inference-kit/src/core.js';
import { loadMobRecon, MOBRECON_ROUTE_ID } from './mobrecon-route.js';
import { createMobReconCrop, CROP_SIZE } from './mobrecon-crop.js';
import { admitAdapter, admitOutputs, compareTensor, gateCase } from './parity-checks.js';

const hex = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');

async function referenceBytes(base, row, dtype) {
  const response = await fetch(new URL(row.file.split('/').map(encodeURIComponent).join('/'), base));
  if (!response.ok) throw new Error(`reference ${row.file}: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (await hex(bytes) !== row.sha256) throw new Error(`reference ${row.file}: sha256 mismatch`);
  if (row.dtype !== dtype) throw new Error(`reference ${row.file}: expected ${dtype}, found ${row.dtype}`);
  return bytes;
}
const referenceTensor = async (base, row) => new Float32Array(await referenceBytes(base, row, 'f32'));

async function readBuffer(device, buffer, offset, bytes) {
  const staging = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(buffer, offset, staging, 0, bytes);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const copy = staging.getMappedRange().slice(0);
  staging.unmap();
  staging.destroy();
  return copy;
}

// Source pixels -> GPU crop -> network in one submission; returns crop bytes,
// network input and outputs. The source texture is the reference's decoded RGB.
async function runFromSource(device, model, crop, c, base) {
  const [height, width] = c.tensors['source.rgb'].shape;
  const rgb = new Uint8Array(await referenceBytes(base, c.tensors['source.rgb'], 'u8'));
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) { rgba.set(rgb.subarray(3 * i, 3 * i + 3), 4 * i); rgba[4 * i + 3] = 255; }
  const texture = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture }, rgba, { bytesPerRow: width * 4 }, [width, height]);
  const encoder = device.createCommandEncoder();
  crop.encode(encoder, { texture, box: c.cropBox, handedness: c.handedness });
  model.network.encode(encoder);
  device.queue.submit([encoder.finish()]);
  const { input, outputs } = model.network;
  const out = {
    crop: new Uint8Array(await readBuffer(device, crop.crop, 0, CROP_SIZE * CROP_SIZE * 4)),
    input: new Float32Array(await readBuffer(device, input.buffer, 0, 3 * CROP_SIZE * CROP_SIZE * 4)),
    mesh: new Float32Array(await readBuffer(device, outputs.mesh.buffer, outputs.mesh.offset * 4, 778 * 3 * 4)),
    uv: new Float32Array(await readBuffer(device, outputs.uv.buffer, outputs.uv.offset * 4, 21 * 2 * 4)),
  };
  texture.destroy();
  return out;
}

export async function runParityWitness({ packageUrl, referenceUrl, fullCases = [], timedRuns = 20, report }) {
  report.phase = 'adapter';
  const adapter = await navigator.gpu?.requestAdapter();
  report.adapter = admitAdapter(adapter?.info);
  report.phase = 'session';
  const session = await createWebGpuInferenceSession({ sessionId: crypto.randomUUID(), gpu: navigator.gpu, adapterName: 'mobrecon-parity' });
  let model, crop;
  try {
    const route = await session.registerRoute({ routeId: MOBRECON_ROUTE_ID });
    report.phase = 'package';
    model = await loadMobRecon({ route, packageUrl });
    report.identity = model.identity;
    crop = createMobReconCrop({ device: route.runtime.device, input: model.network.input });
    report.phase = 'reference';
    const base = new URL(referenceUrl.endsWith('/') ? referenceUrl : `${referenceUrl}/`, location.href);
    const manifest = await (await fetch(new URL('manifest.json', base), { cache: 'no-store' })).json();
    if (manifest.schema !== 'mobrecon.reference.v0' || manifest.status !== 'succeeded') throw new Error('succeeded mobrecon.reference.v0 required');
    if (manifest.provenance.checkpointSha256 !== model.identity.provenance.checkpointSha256) throw new Error('reference and package use different checkpoints');
    report.reference = { provenance: manifest.provenance, runtime: manifest.runtime, caseCount: manifest.cases.length };
    report.cases = [];
    const failures = [];
    for (const c of manifest.cases) {
      report.phase = `case ${c.id}`;
      const input = await referenceTensor(base, c.tensors.input);
      const full = fullCases.includes(c.id);
      const capture = full ? model.network.names().filter(name => c.tensors[name] && name !== 'mesh_pred' && name !== 'uv_pred') : [];
      const result = await model.network.run({ input, capture });
      admitOutputs(result);
      const comparisons = [
        compareTensor('mesh_pred', result.mesh, await referenceTensor(base, c.tensors.mesh_pred)),
        compareTensor('uv_pred', result.uv, await referenceTensor(base, c.tensors.uv_pred)),
      ];
      for (const name of capture) comparisons.push(compareTensor(name, result.captures[name].data, await referenceTensor(base, c.tensors[name])));
      const caseFailures = gateCase(c.id, comparisons);
      // The same capture from its decoded source pixels through the GPU crop:
      // crop bytes must equal OpenCV's, the network input must equal the
      // source's base_transform bit for bit, and the mesh must pass the gate.
      const fromSource = await runFromSource(route.runtime.device, model, crop, c, base);
      admitOutputs(fromSource);
      const wantCrop = new Uint8Array(await referenceBytes(base, c.tensors['crop.rgb'], 'u8'));
      let cropMismatches = 0, cropMaxDiff = 0;
      for (let i = 0; i < CROP_SIZE * CROP_SIZE; i++) for (let k = 0; k < 3; k++) {
        const d = Math.abs(fromSource.crop[4 * i + k] - wantCrop[3 * i + k]);
        if (d) { cropMismatches++; cropMaxDiff = Math.max(cropMaxDiff, d); }
      }
      let inputMismatches = 0;
      for (let i = 0; i < input.length; i++) if (fromSource.input[i] !== input[i]) inputMismatches++;
      const sourceComparisons = [
        compareTensor('mesh_pred', fromSource.mesh, await referenceTensor(base, c.tensors.mesh_pred)),
        compareTensor('uv_pred', fromSource.uv, await referenceTensor(base, c.tensors.uv_pred)),
      ];
      const sourceFailures = gateCase(`${c.id}:from-source`, sourceComparisons);
      if (cropMismatches) sourceFailures.push(`${c.id}: GPU crop differs from OpenCV in ${cropMismatches} bytes (max ${cropMaxDiff})`);
      if (inputMismatches) sourceFailures.push(`${c.id}: network input differs from base_transform in ${inputMismatches} values`);
      caseFailures.push(...sourceFailures);
      failures.push(...caseFailures);
      report.cases.push({ id: c.id, handedness: c.handedness, cropBox: c.cropBox, native: c.native ?? null, full, comparisons,
        fromSource: { cropMismatches, cropMaxDiff, inputMismatches, comparisons: sourceComparisons }, failures: caseFailures });
    }
    // Negative control: one case's output against a different capture's
    // reference must fail the same gate, or the comparison cannot discriminate.
    report.phase = 'negative-control';
    if (manifest.cases.length < 2) throw new Error('negative control needs two reference cases');
    const [own, other] = manifest.cases;
    const control = await model.network.run({ input: await referenceTensor(base, own.tensors.input) });
    const crossed = [compareTensor('mesh_pred', control.mesh, await referenceTensor(base, other.tensors.mesh_pred)),
      compareTensor('uv_pred', control.uv, await referenceTensor(base, other.tensors.uv_pred))];
    const controlFailures = gateCase(`${own.id}-vs-${other.id}`, crossed);
    report.negativeControl = { output: own.id, reference: other.id, comparisons: crossed, gateFailures: controlFailures };
    if (controlFailures.length !== crossed.length) failures.push('negative control passed the gate: comparison does not discriminate');
    report.phase = 'timing';
    const input = await referenceTensor(base, manifest.cases[0].tensors.input);
    const times = [];
    for (let i = 0; i < timedRuns; i++) {
      const t = performance.now();
      await model.network.run({ input });
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    report.timing = { authority: 'diagnostic wall clock on a shared machine; includes upload and readback; not a benchmark',
      runs: timedRuns, medianMs: times[Math.floor(times.length / 2)], minMs: times[0], maxMs: times[times.length - 1] };
    report.failures = failures;
    report.status = failures.length ? 'failed' : 'passed';
    report.phase = null;
  } finally {
    crop?.dispose();
    model?.release();
    await session.close?.();
  }
  return report;
}
