// Forward-parity witness: one UniMate denoiser evaluation on WebGPU against
// the PyTorch forward-mode capture (export-reference.py → export-browser-fixture.py).
// Rows run as one batch: [conditional rows..., unconditional rows...] for the capture's prompts.
// Publishes window.__unimateForwardWitness = { phase, report }.
import { UniMateDenoiser, readTap, requestUniMateDevice } from './unimate-denoiser.js';
import { conditioningFor } from './witness-common.js';
import { compareWebGpuParityArrays } from '../../webgpu-inference-kit/src/parity-primitives.js';

const state = { phase: 'start', report: null };
window.__unimateForwardWitness = state;

const params = new URL(location.href).searchParams;
const GATE_RELATIVE_L2 = Number(params.get('gate') ?? '1e-5');
// Negative control: 'swap-captions' feeds each conditional row the other prompt's caption.
// The comparison must then fail; a pass would mean it cannot see conditioning errors.
const NEGATIVE_CONTROL = params.get('negativeControl');

async function fetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.arrayBuffer();
}

function fixtureArrays(index, bytes) {
  const out = {};
  for (const e of index.arrays) {
    const Ctor = e.dtype === 'int32' ? Int32Array : Float32Array;
    out[e.name] = { data: new Ctor(bytes, e.offset, e.byteLength / 4), shape: e.shape };
  }
  return out;
}

// Rows of a [Brows, ...] array, picked by index list, concatenated.
function pickRows(arr, rows) {
  const per = arr.data.length / arr.shape[0];
  const out = new arr.data.constructor(rows.length * per);
  rows.forEach((r, i) => out.set(arr.data.subarray(r * per, (r + 1) * per), i * per));
  return out;
}

// [B, Jpad, ...rest] -> [B, J, ...rest]
function sliceJoints(arr, J) {
  const [B, Jp, ...rest] = arr.shape;
  const inner = rest.reduce((a, b) => a * b, 1);
  const out = new arr.data.constructor(B * J * inner);
  for (let b = 0; b < B; b++) out.set(arr.data.subarray(b * Jp * inner, (b * Jp + J) * inner), b * J * inner);
  return out;
}

function compare(stageId, actual, reference) {
  const c = compareWebGpuParityArrays(actual, reference, { stageId });
  const m = c.metrics;
  return { stageId, n: c.comparedElementCount, maxAbsoluteError: m.maxAbsoluteError, relativeL2Error: m.relativeL2Error,
    cosineSimilarity: m.cosineSimilarity, referenceAbsMax: Math.max(Math.abs(c.reference.min), Math.abs(c.reference.max)) };
}

async function run() {
  const report = { schema: 'kaminos.unimate.forward-witness.v0', gate: { metric: 'relativeL2Error', max: GATE_RELATIVE_L2,
    applies: ['out_cond', 'out_uncond', 'out_cfg'] }, stages: [] };
  state.report = report;
  state.phase = 'adapter';
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('no WebGPU adapter');
  report.adapter = adapter.info ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description } : null;
  const device = await requestUniMateDevice(adapter);
  device.addEventListener('uncapturederror', e => { (report.gpuErrors ??= []).push(String(e.error?.message ?? e.error)); });

  state.phase = 'load';
  const manifest = await (await fetch('/weights/manifest.json')).json();
  const weightBytes = await fetchBytes(`/weights/${manifest.file}`);
  const index = await (await fetch('/fixture/fixture.json')).json();
  const fx = fixtureArrays(index, await fetchBytes('/fixture/fixture.bin'));
  report.weights = { sha256: manifest.sha256, parameterCount: manifest.parameterCount, source: manifest.source };
  report.fixture = { sha256: index.sha256, capture: index.capture, captureInputs: index.capture_inputs, captureRoute: index.capture_route };

  const J = index.n_joints, P = fx['cond/n_joints'].data.length;            // prompts in the capture
  const prompts = Array.from({ length: P }, (_, i) => i), rows = [...prompts, ...prompts], B = rows.length;
  const den = await UniMateDenoiser.create(device, manifest, weightBytes);
  den.configure({ B, J });
  report.dispatches = den.dispatchCounts;

  state.phase = 'inputs';
  const g = name => fx[`cond/${name}`];
  const caption = new Float32Array(B * 768);
  caption.set(pickRows(g('caption_emb'), NEGATIVE_CONTROL === 'swap-captions' ? [...prompts].reverse() : prompts), 0); // unconditional rows stay zero: CFG-masked caption
  report.negativeControl = NEGATIVE_CONTROL;
  den.writeConditioning({
    tpos: pickRows(g('tpos_first_frame'), rows), tposParents: pickRows(g('tpos_first_frame_parents'), rows),
    depths: pickRows(g('joint_depths'), rows), jointNamesEmb: pickRows(g('joint_names_emb'), rows),
    spectral: pickRows(g('spectral_feats'), rows), graphDist: pickRows(g('graph_dist'), rows),
    jointRelations: pickRows(g('joint_relations'), rows), caption, motionLength: pickRows(g('motion_length'), rows),
  });
  const t = fx['forward/t'].data;
  den.writeTimesteps(rows.map(r => t[r]));
  const noise = { data: sliceJoints(fx['forward/noise'], J), shape: [P, J, 12, 60] };
  den.writeMotion(pickRows(noise, rows));

  state.phase = 'run';
  const taps = new Map(['tpos_emb', 'tpos_pool', 'depth_embedding', 'joint_name_embedder', 'cond_embedder', 'time_embedder', 'input_layer',
    ...Array.from({ length: 10 }, (_, l) => `block${String(l).padStart(2, '0')}`)].map(n => [n, null]));
  const enc = device.createCommandEncoder();
  den.encodePrepare(enc, taps);
  den.encodeForward(enc, taps);
  const outRead = device.createBuffer({ size: B * J * 12 * 60 * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  enc.copyBufferToBuffer(den.io.out, 0, outRead, 0, B * J * 12 * 60 * 4);
  const t0 = performance.now();
  device.queue.submit([enc.finish()]);
  await device.queue.onSubmittedWorkDone();
  report.firstRunMs = performance.now() - t0;

  state.phase = 'compare';
  const tapData = new Map();
  for (const [name, buf] of taps) tapData.set(name, await readTap(buf));
  const rowSlice = (arr, r0, r1) => arr.subarray(r0 * arr.length / B, r1 * arr.length / B);
  const act = name => fx[`act/${name}`].data;
  const both = (tapName, actName, rowsPerPass = P) => {
    const a = tapData.get(tapName);
    report.stages.push(compare(`cond/${actName}`, rowSlice(a, 0, rowsPerPass), act(`cond/${actName}`)));
    report.stages.push(compare(`uncond/${actName}`, rowSlice(a, rowsPerPass, 2 * rowsPerPass), act(`uncond/${actName}`)));
  };
  report.stages.push(compare('cond/input_layer/1 (tpos_emb)', rowSlice(tapData.get('tpos_emb'), 0, P), act('cond/input_layer/1')));
  report.stages.push(compare('cond/tpos_pool', rowSlice(tapData.get('tpos_pool'), 0, P), act('cond/tpos_pool/0')));
  report.stages.push(compare('cond/depth_embedding', rowSlice(tapData.get('depth_embedding'), 0, P), act('cond/depth_embedding/0')));
  report.stages.push(compare('cond/joint_name_embedder', rowSlice(tapData.get('joint_name_embedder'), 0, P), act('cond/joint_name_embedder/0')));
  both('cond_embedder', 'cond_embedder/0');
  both('time_embedder', 'time_embedder/0');
  both('input_layer', 'input_layer/0');
  for (let l = 0; l < 10; l++) both(`block${String(l).padStart(2, '0')}`, `block${String(l).padStart(2, '0')}/0`);

  await outRead.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(outRead.getMappedRange().slice(0));
  outRead.unmap();
  const outC = rowSlice(out, 0, P), outU = rowSlice(out, P, 2 * P);
  const refC = sliceJoints(fx['forward/out_cond'], J), refU = sliceJoints(fx['forward/out_uncond'], J), refCfg = sliceJoints(fx['forward/out_cfg'], J);
  const cfg = new Float32Array(outC.length);
  for (let i = 0; i < cfg.length; i++) cfg[i] = Math.fround(outU[i] + Math.fround(3 * Math.fround(outC[i] - outU[i])));
  const finals = [compare('out_cond', outC, refC), compare('out_uncond', outU, refU), compare('out_cfg', cfg, refCfg)];
  report.stages.push(...finals);
  report.pass = !report.gpuErrors && finals.every(s => s.relativeL2Error != null && s.relativeL2Error <= GATE_RELATIVE_L2);
  // When the capture carries a float64 run, judge both FP32 implementations against it.
  if (fx['forward/out_cfg_f64']) {
    const t64 = name => sliceJoints(fx[`forward/${name}_f64`], J);
    report.againstFloat64 = {
      webgpu: [compare('out_cond', outC, t64('out_cond')), compare('out_uncond', outU, t64('out_uncond')), compare('out_cfg', cfg, t64('out_cfg'))],
      torchFp32: [compare('out_cond', refC, t64('out_cond')), compare('out_uncond', refU, t64('out_uncond')), compare('out_cfg', refCfg, t64('out_cfg'))],
    };
  }

  // Depth-clamp probe (review F3): upstream clamps joint depth to max_depth, so a joint
  // at max_depth and one deeper must give identical output.
  if (params.get('depthProbe')) {
    state.phase = 'depth-probe';
    const runAt = async depth => {
      const c = conditioningFor(fx, rows, [...prompts, ...prompts.map(() => -1)]);
      c.depths = Int32Array.from(c.depths); for (let r = 0; r < B; r++) c.depths[r * J + 5] = depth;
      den.writeConditioning(c);
      den.writeMotion(pickRows(noise, rows));
      den.writeTimesteps(rows.map(r => t[r]));
      const e = device.createCommandEncoder(); den.encodePrepare(e); den.encodeForward(e);
      const rb = device.createBuffer({ size: B * J * 12 * 60 * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      e.copyBufferToBuffer(den.io.out, 0, rb, 0, B * J * 12 * 60 * 4);
      device.queue.submit([e.finish()]);
      return readTap(rb);
    };
    const maxDepth = den.maxDepth, a = await runAt(maxDepth), b = await runAt(maxDepth + 5);
    let maxAbs = 0; for (let i = 0; i < a.length; i++) maxAbs = Math.max(maxAbs, Math.abs(a[i] - b[i]));
    report.depthClampProbe = { joint: 5, depths: [maxDepth, maxDepth + 5], maxAbsDiff: maxAbs, pass: maxAbs === 0 };
    report.pass = report.pass && maxAbs === 0;
  }

  state.phase = 'timing';
  const times = [];
  for (let i = 0; i < 3; i++) {
    const e = device.createCommandEncoder();
    den.encodeForward(e);
    const s = performance.now();
    device.queue.submit([e.finish()]);
    await device.queue.onSubmittedWorkDone();
    times.push(performance.now() - s);
  }
  report.forwardMs = times;
  report.note = `forwardMs is one denoiser evaluation for ${B} rows (${P} prompts x cond/uncond), unshared device, no cooperative scheduling.`;
  state.phase = 'done';
}

run().catch(e => { state.error = String(e?.stack ?? e); state.phase = 'failed'; });
