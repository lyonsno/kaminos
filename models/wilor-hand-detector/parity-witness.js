// Browser half of the hand detector parity witness. For every reference case
// (WiLoR-MLX run by export-reference.py): the GPU letterbox from decoded source
// pixels against MLX's letterbox bytes; the WebGPU network from the MLX
// letterbox against MLX's decoded head (and every named stage for full cases);
// the JS post-processing on MLX's own head against MLX's detections; and the
// WebGPU detections against MLX's. A negative control crosses two cases.
import { createWebGpuInferenceSession } from '../../webgpu-inference-kit/src/core.js';
import { admitAdapter, compareTensor } from '../mobrecon/parity-checks.js';
import { HAND_DETECTOR_ROUTE_ID, loadHandDetector } from './detector-route.js';
import { DETECTOR_SIZE, unitTable } from './detector-kernels.js';
import { decodeDetections } from './detections.js';

// Detection gates in source pixels and score units.
export const DETECTION_GATES = Object.freeze({ bboxPx: 0.1, keypointPx: 0.1, confidence: 1e-3 });

const hex = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
async function referenceBytes(base, row, dtype) {
  const response = await fetch(new URL(row.file.split('/').map(encodeURIComponent).join('/'), base));
  if (!response.ok) throw new Error(`reference ${row.file}: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (await hex(bytes) !== row.sha256) throw new Error(`reference ${row.file}: sha256 mismatch`);
  if (row.dtype !== dtype) throw new Error(`reference ${row.file}: expected ${dtype}, found ${row.dtype}`);
  return bytes;
}
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

// MLX detections ({hand_side, confidence, bbox, keypoints_2d}) against ours.
export function compareDetections(label, ours, theirs, gates = DETECTION_GATES) {
  const failures = [];
  if (ours.length !== theirs.length) return { failures: [`${label}: ${ours.length} detections vs reference ${theirs.length}`], rows: [] };
  const rows = theirs.map((want, i) => {
    const got = ours[i];
    const bbox = Math.max(...want.bbox.map((v, k) => Math.abs(v - got.bbox[k])));
    const keypoint = Math.max(...want.keypoints_2d.flatMap((p, k) => [Math.abs(p[0] - got.keypoints[k][0]), Math.abs(p[1] - got.keypoints[k][1])]));
    const confidence = Math.abs(want.confidence - got.confidence);
    if (want.hand_side !== got.handSide) failures.push(`${label}[${i}]: hand ${got.handSide} vs reference ${want.hand_side}`);
    if (!(bbox <= gates.bboxPx)) failures.push(`${label}[${i}]: bbox differs by ${bbox} px`);
    if (!(keypoint <= gates.keypointPx)) failures.push(`${label}[${i}]: keypoints differ by ${keypoint} px`);
    if (!(confidence <= gates.confidence)) failures.push(`${label}[${i}]: confidence differs by ${confidence}`);
    return { handSide: got.handSide, confidence: got.confidence, bboxPx: bbox, keypointPx: keypoint, confidenceDiff: confidence };
  });
  return { failures, rows };
}

export async function runParityWitness({ packageUrl, referenceUrl, fullCases = [], timedRuns = 20, report }) {
  report.phase = 'adapter';
  const adapter = await navigator.gpu?.requestAdapter();
  report.adapter = admitAdapter(adapter?.info);
  report.phase = 'session';
  const session = await createWebGpuInferenceSession({ sessionId: crypto.randomUUID(), gpu: navigator.gpu, adapterName: 'hand-detector-parity' });
  let model;
  try {
    const route = await session.registerRoute({ routeId: HAND_DETECTOR_ROUTE_ID });
    const device = route.runtime.device;
    // WebGPU validation errors do not throw; any one fails the witness.
    const deviceErrors = [];
    route.runtime.device.addEventListener('uncapturederror', event => deviceErrors.push(String(event.error?.message ?? event.error)));
    report.deviceErrors = deviceErrors;
    report.phase = 'package';
    model = await loadHandDetector({ route, packageUrl });
    report.identity = model.identity;
    const base = new URL(referenceUrl.endsWith('/') ? referenceUrl : `${referenceUrl}/`, location.href);
    const manifest = await (await fetch(new URL('manifest.json', base), { cache: 'no-store' })).json();
    if (manifest.schema !== 'wilor-hand-detector.reference.v0' || manifest.status !== 'succeeded') throw new Error('succeeded wilor-hand-detector.reference.v0 required');
    if (manifest.provenance.weightsSha256 !== model.identity.provenance.weightsSha256) throw new Error('reference and package use different weights');
    report.reference = { provenance: manifest.provenance, runtime: manifest.runtime, caseCount: manifest.cases.length };
    const unit = unitTable(), failures = [];
    report.cases = [];
    const outputs = {};
    for (const c of manifest.cases) {
      report.phase = `case ${c.id}`;
      const [width, height] = c.size;
      const row = { id: c.id, full: fullCases.includes(c.id) };
      // 1. Network from MLX's own letterbox bytes.
      const letterbox = new Uint8Array(await referenceBytes(base, c.tensors['letterbox.rgb'], 'u8'));
      const plane = DETECTOR_SIZE * DETECTOR_SIZE, input = new Float32Array(3 * plane);
      for (let i = 0; i < plane; i++) for (let k = 0; k < 3; k++) input[k * plane + i] = unit[letterbox[3 * i + k]];
      const capture = row.full ? model.network.names().filter(n => c.tensors[n] && n !== 'output') : [];
      const result = await model.network.run({ input, capture });
      const want = new Float32Array(await referenceBytes(base, c.tensors.output, 'f32'));
      outputs[c.id] = { got: result.output, want };
      const anchors = want.length / 69, rowsOf = (data, from, to) => data.subarray(from * anchors, to * anchors);
      row.output = [compareTensor('output.box', rowsOf(result.output, 0, 4), rowsOf(want, 0, 4)),
        compareTensor('output.class', rowsOf(result.output, 4, 6), rowsOf(want, 4, 6)),
        compareTensor('output.keypoints', rowsOf(result.output, 6, 69), rowsOf(want, 6, 69))];
      row.stages = [];
      for (const n of capture) row.stages.push(compareTensor(n, result.captures[n].data, new Float32Array(await referenceBytes(base, c.tensors[n], 'f32'))));
      // 2. Post-processing alone: our decode of MLX's head against MLX's detections.
      row.detections = {};
      for (const [threshold, mlx] of Object.entries(c.detections)) {
        const options = { width, height, threshold: Number(threshold) };
        const own = compareDetections(`${c.id}@${threshold}:decode-of-reference`, decodeDetections(want, options), mlx, { bboxPx: 1e-3, keypointPx: 1e-3, confidence: 0 });
        const gpu = compareDetections(`${c.id}@${threshold}:webgpu`, decodeDetections(result.output, options), mlx);
        failures.push(...own.failures, ...gpu.failures);
        row.detections[threshold] = { reference: mlx.length, decodeOfReference: own, webgpu: gpu };
      }
      // 3. GPU letterbox from decoded source pixels.
      const rgb = new Uint8Array(await referenceBytes(base, c.tensors['source.rgb'], 'u8'));
      const rgba = new Uint8Array(width * height * 4);
      for (let i = 0; i < width * height; i++) { rgba.set(rgb.subarray(3 * i, 3 * i + 3), 4 * i); rgba[4 * i + 3] = 255; }
      const texture = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      device.queue.writeTexture({ texture }, rgba, { bytesPerRow: width * 4 }, [width, height]);
      const fromSource = await model.detect({ texture, threshold: Number(Object.keys(c.detections)[0]) });
      const ours = new Uint8Array(await readBuffer(device, model.letterbox.bytes, 0, plane * 4));
      texture.destroy();
      let mismatches = 0, maxDiff = 0;
      for (let i = 0; i < plane; i++) for (let k = 0; k < 3; k++) {
        const d = Math.abs(ours[4 * i + k] - letterbox[3 * i + k]);
        if (d) { mismatches++; maxDiff = Math.max(maxDiff, d); }
      }
      row.letterbox = { mismatches, maxDiff, of: plane * 3 };
      const firstThreshold = Object.keys(c.detections)[0];
      const fromSourceCheck = compareDetections(`${c.id}@${firstThreshold}:from-source`, fromSource, c.detections[firstThreshold]);
      failures.push(...fromSourceCheck.failures);
      row.fromSource = fromSourceCheck;
      report.cases.push(row);
    }
    report.phase = 'negative-control';
    const ids = Object.keys(outputs);
    const crossed = compareTensor('output.class', outputs[ids[0]].got.subarray(4 * 5376, 6 * 5376), outputs[ids[ids.length - 1]].want.subarray(4 * 5376, 6 * 5376));
    report.negativeControl = { output: ids[0], reference: ids[ids.length - 1], crossed };
    if (!(crossed.maxAbs > DETECTION_GATES.confidence)) failures.push('negative control: crossed class scores pass the confidence gate');
    report.phase = 'timing';
    const times = [];
    for (let i = 0; i < timedRuns; i++) {
      const t = performance.now();
      await model.network.run({});
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    report.timing = { authority: 'diagnostic wall clock on a shared machine; detector network plus output readback; not a benchmark',
      runs: timedRuns, medianMs: times[Math.floor(times.length / 2)], minMs: times[0], maxMs: times[times.length - 1] };
    if (deviceErrors.length) failures.push(`${deviceErrors.length} WebGPU device errors`);
    report.failures = failures;
    report.status = failures.length ? 'failed' : 'passed';
    report.phase = null;
  } finally {
    model?.release();
    await session.close?.();
  }
  return report;
}
