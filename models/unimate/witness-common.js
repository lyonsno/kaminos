// Shared helpers for the UniMate browser witnesses.
import { requestUniMateDevice } from './unimate-denoiser.js';
import { compareWebGpuParityArrays } from '../../webgpu-inference-kit/src/parity-primitives.js';

export async function fetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.arrayBuffer();
}

export async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

// Arrays of a bundle written by export-browser-fixture.py / export-browser-trace.py.
export function bundleArrays(index, bytes) {
  const out = {};
  for (const e of index.arrays) {
    const Ctor = e.dtype === 'int32' ? Int32Array : Float32Array;
    out[e.name] = { data: new Ctor(bytes, e.offset, e.byteLength / 4), shape: e.shape };
  }
  return out;
}

// Rows of a [Brows, ...] array, picked by index list, concatenated.
export function pickRows(arr, rows) {
  const per = arr.data.length / arr.shape[0];
  const out = new arr.data.constructor(rows.length * per);
  rows.forEach((r, i) => out.set(arr.data.subarray(r * per, (r + 1) * per), i * per));
  return out;
}

// [B, Jpad, ...rest] -> [B, J, ...rest]
export function sliceJoints(arr, J) {
  const [B, Jp, ...rest] = arr.shape;
  const inner = rest.reduce((a, b) => a * b, 1);
  const out = new arr.data.constructor(B * J * inner);
  for (let b = 0; b < B; b++) out.set(arr.data.subarray(b * Jp * inner, (b * Jp + J) * inner), b * J * inner);
  return out;
}

export function compare(stageId, actual, reference) {
  const c = compareWebGpuParityArrays(actual, reference, { stageId });
  const m = c.metrics;
  return { stageId, n: c.comparedElementCount, maxAbsoluteError: m.maxAbsoluteError, relativeL2Error: m.relativeL2Error,
    cosineSimilarity: m.cosineSimilarity, referenceAbsMax: Math.max(Math.abs(c.reference.min), Math.abs(c.reference.max)) };
}

// Conditioning rows for UniMateDenoiser.writeConditioning from a fixture bundle.
// rows: fixture batch rows per denoiser row; captionRows: fixture row whose
// caption a denoiser row gets, or -1 for the CFG-masked (zero) caption.
export function conditioningFor(fx, rows, captionRows) {
  const g = name => fx[`cond/${name}`];
  const caption = new Float32Array(rows.length * 768);
  const cap = g('caption_emb');
  captionRows.forEach((r, i) => { if (r >= 0) caption.set(cap.data.subarray(r * 768, (r + 1) * 768), i * 768); });
  return {
    tpos: pickRows(g('tpos_first_frame'), rows), tposParents: pickRows(g('tpos_first_frame_parents'), rows),
    depths: pickRows(g('joint_depths'), rows), jointNamesEmb: pickRows(g('joint_names_emb'), rows),
    spectral: pickRows(g('spectral_feats'), rows), graphDist: pickRows(g('graph_dist'), rows),
    jointRelations: pickRows(g('joint_relations'), rows), caption, motionLength: pickRows(g('motion_length'), rows),
  };
}

export async function createDevice(report) {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('no WebGPU adapter');
  report.adapter = adapter.info ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description } : null;
  const device = await requestUniMateDevice(adapter);
  device.addEventListener('uncapturederror', e => { (report.gpuErrors ??= []).push(String(e.error?.message ?? e.error)); });
  return device;
}
