// UniMate text-to-motion generation on a host's WebGPU device, without any scene: the model,
// its text encoder, the generation skeleton (a published bundle or an imported rig's in-memory
// one) and a cooperative generation as a kit route. A host supplies its device, a kit inference
// session and its foreground service's beginRun(runId) (the Kaminos app host's shape, or the demo
// page's own), so the host keeps drawing frames while each network evaluation runs as GPU duties.
//
//   const g = await createUniMateGenerator({ device, session, beginRun, weightsBase, t5Base, bundleBase });
//   const result = await g.generate({ text: 'A dog runs forward.', seed: 1 });   // result.motion: decoded joints
import { CooperativeUniMateDenoiser, UniMateDutyScheduler, createCooperativeCfgDrift } from './unimate-cooperative.js';
import { dopri5Solve } from './unimate-dopri5.js';
import { decodeUniMateMotion, groundedOffsets } from './unimate-decode.js';
import { T5Encoder } from './unimate-t5.js';
import { createWebGpuInferenceControl } from '../../webgpu-inference-kit/src/core.js';

export const UNIMATE_ROUTE_ID = 'unimate.text-to-motion.webgpu-local.v0';

// Gaussian noise from a 32-bit seed (splitmix32 + Box-Muller). Not torch's generator:
// a browser seed names a browser draw, never the matching PyTorch seed.
export function gaussianNoise(seed, n) {
  let s = seed >>> 0;
  const next = () => { s = (s + 0x9e3779b9) >>> 0; let z = s; z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0; z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0; return ((z ^ (z >>> 16)) >>> 0) / 4294967296; };
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const u = Math.max(next(), 1e-12), v = next(), r = Math.sqrt(-2 * Math.log(u));
    out[i] = r * Math.cos(2 * Math.PI * v);
    if (i + 1 < n) out[i + 1] = r * Math.sin(2 * Math.PI * v);
  }
  return out;
}

export function bundleArrays(index, bytes) {
  const out = {};
  for (const e of index.arrays) out[e.name] = new (e.dtype === 'int32' ? Int32Array : Float32Array)(bytes, e.offset, e.byteLength / 4);
  return out;
}

// Fetch with byte progress (content-length when the server sends it). With expectBytes, the
// response is kept in the Cache API so a return visit skips the download; a cached copy of the
// wrong length is discarded and fetched again.
const WEIGHT_CACHE = 'kaminos-unimate-weights-v1';
export async function fetchBytes(url, onBytes, { expectBytes = null } = {}) {
  let cache = null;
  if (expectBytes) {
    try { cache = await caches.open(WEIGHT_CACHE); } catch { cache = null; }
    const hit = await cache?.match(url).catch(() => null);
    if (hit) {
      const bytes = await hit.arrayBuffer();
      if (bytes.byteLength === expectBytes) { onBytes?.(bytes.byteLength, bytes.byteLength); return bytes; }
      await cache.delete(url).catch(() => {});
    }
  }
  const buffer = await download(url, onBytes);
  if (expectBytes && buffer.byteLength !== expectBytes) throw new Error(`${url}: ${buffer.byteLength} bytes, expected ${expectBytes}`);
  if (cache) await cache.put(url, new Response(buffer.slice(0))).catch(e => console.warn('could not cache', url, e));
  return buffer;
}
async function download(url, onBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || null;
  if (!res.body || !onBytes) return res.arrayBuffer();
  const reader = res.body.getReader(), chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); loaded += value.byteLength;
    onBytes(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out.buffer;
}


// skeleton: a published bundle directory (bundleBase) or in-memory data ({ b, a }, skeletonData).
// routeId: the model's kit route. A run starts with beginRun(runId, { routeId }), so the host's
// foreground service (its own or an app-wide one) carries UniMate's identity for the run.
export async function createUniMateGenerator({ device, session, beginRun, routeId = UNIMATE_ROUTE_ID, weightsBase, t5Base, bundleBase = null, skeletonData = null,
  onStatus = () => {}, onBytes = () => {} }) {
  const g = { bundle: null, arrays: null, skeleton: null, parameterCount: null, forwardFlops: null };
  // The generation skeleton (conditioning bundle). useSkeleton() swaps it between runs.
  let bundle, arrays, J, parents, jointNames, fps, T, rest, offsets;
  const Fe = 12;
  const fetchSkeleton = async base => {
    const b = await (await fetch(`${base}demo.json`)).json();
    return { b, a: bundleArrays(b, await fetchBytes(`${base}demo.bin`)) };
  };
  const applySkeleton = ({ b, a }) => {
    bundle = b; arrays = a;
    ({ joints: J, parents, jointNames, fps, frames: T } = b.skeleton);
    rest = Array.from({ length: J }, (_, j) => Array.from(arrays.restPositions.subarray(j * 3, j * 3 + 3)));
    offsets = groundedOffsets(rest, parents);
    Object.assign(g, { bundle, arrays, skeleton: { name: b.skeleton.name, parents, jointNames, rest, fps, frames: T } });
  };
  onStatus({ phase: 'load', detail: 'skeleton and prompts' });
  applySkeleton(skeletonData ?? await fetchSkeleton(bundleBase));
  // Downloads: weights and text encoder, reported together.
  const manifest = await (await fetch(`${weightsBase}manifest.json`)).json();
  let t5Manifest = null;
  try { t5Manifest = await (await fetch(`${t5Base}t5-manifest.json`)).json(); } catch (e) { console.warn('text encoder unavailable; captured prompts only', e); }
  const progress = { weights: [0, null], t5: [0, null] };
  const report = () => {
    const loaded = progress.weights[0] + progress.t5[0];
    const known = progress.weights[1] !== null && (!t5Manifest || progress.t5[1] !== null);
    onBytes(loaded, known ? progress.weights[1] + (t5Manifest ? progress.t5[1] : 0) : null);
  };
  onStatus({ phase: 'load', detail: 'model weights' });
  const [weightBytes, t5Bytes] = await Promise.all([
    fetchBytes(`${weightsBase}${manifest.file}`, (l, t) => { progress.weights = [l, t]; report(); }, { expectBytes: manifest.byteLength }),
    t5Manifest ? fetchBytes(`${t5Base}${t5Manifest.file}`, (l, t) => { progress.t5 = [l, t]; report(); }, { expectBytes: t5Manifest.byteLength }).catch(e => { console.warn('text encoder download failed', e); return null; }) : null,
  ]);
  onStatus({ phase: 'load', detail: 'GPU pipelines' });
  const den = await CooperativeUniMateDenoiser.create(device, manifest, weightBytes);
  den.configure({ B: 2, J });
  const scheduler = new UniMateDutyScheduler(device, { label: 'unimate' });
  let t5 = null;
  if (t5Bytes) {
    try { t5 = await T5Encoder.create(device, t5Manifest, t5Bytes, await (await fetch(`${t5Base}t5-tokenizer.json`)).json()); }
    catch (e) { console.warn('text encoder unavailable; captured prompts only', e); }
  }
  const zeros = new Float32Array(768);
  const conditioningFor = caption => {
    const two = a => { const o = new a.constructor(a.length * 2); o.set(a, 0); o.set(a, a.length); return o; };
    const cap = new Float32Array(2 * 768); cap.set(caption, 0); cap.set(zeros, 768);
    return { tpos: two(arrays.tpos), tposParents: two(arrays.tposParents), depths: two(arrays.depths), jointNamesEmb: two(arrays.jointNamesEmb),
      spectral: two(arrays.spectral), graphDist: two(arrays.graphDist), jointRelations: two(arrays.jointRelations), caption: cap,
      motionLength: [bundle.motionLength, bundle.motionLength] };
  };

  let active = null;
  async function solve({ caption, noise, schedule, onEvaluation, onStep }) {
    scheduler.setSchedule(schedule);
    den.writeConditioning(conditioningFor(caption));
    den.encodePrepare(scheduler.encoder());
    await scheduler.flush('unimate.prepare');
    const drift = createCooperativeCfgDrift(device, den, scheduler, { prompts: 1, onEvaluation });
    try {
      const res = await dopri5Solve({ y0: noise, drift, outputTimes: bundle.outputTimes, rtol: 1e-3, atol: 1e-6, onStep });
      const final = res.solution.at(-1);
      // Denormalize (motion * std + mean, float32) into [T, J, 12] features, then decode.
      const features = new Float32Array(T * J * Fe);
      for (let t = 0; t < T; t++) for (let j = 0; j < J; j++) for (let d = 0; d < Fe; d++) {
        features[(t * J + j) * Fe + d] = Math.fround(Math.fround(final[(j * Fe + d) * T + t] * arrays.std[j * Fe + d]) + arrays.mean[j * Fe + d]);
      }
      const motion = decodeUniMateMotion({ features, frames: T, parents, offsets });
      return { motion, features, steps: res.steps, evaluations: drift.evaluations, duties: scheduler.stats.history.slice() };
    } finally {
      drift.dispose();
      await scheduler.discard();
    }
  }

  // text: any prompt (browser T5), or promptIndex: a captured bundle prompt. seed null replays
  // the accepted run's noise, which exists only for captured prompts.
  async function generate({ text = null, promptIndex = null, seed = null, cooperative = true, targetDutyMs = 12, maxInFlight = 1,
    onEvaluation, onStep } = {}) {
    if (text === null) text = bundle.prompts[promptIndex ?? 0].text;
    const match = bundle.prompts.findIndex(p => p.text === text);
    if (seed === null && match < 0) throw new Error('the accepted run\'s noise exists only for captured prompts; choose a browser seed');
    if (!t5 && match < 0) throw new Error('no text encoder loaded: choose one of the captured prompts');
    if (active) throw new Error('a generation is already running');
    const encodeStart = performance.now();
    const caption = t5 ? (await t5.encode(text)).pooled : arrays[bundle.prompts[match].caption];
    const encodeMs = performance.now() - encodeStart;
    const prompt = match >= 0 ? bundle.prompts[match] : { text };
    const noise = seed === null ? Float32Array.from(arrays[prompt.referenceNoise]) : gaussianNoise(seed, J * Fe * T);
    const runId = `unimate:${crypto.randomUUID()}`;
    const abort = new AbortController();
    active = { abort, control: null };
    scheduler.stats.history.length = 0;
    const started = performance.now();
    let frameRun = null, route = null, result;
    try {
      if (cooperative) {
        frameRun = await beginRun(runId, { routeId });
        route = await session.registerRoute({ routeId, runtimeOptions: { runtimeLabel: 'unimate', foregroundOpportunities: frameRun.foregroundOpportunities } });
        const control = createWebGpuInferenceControl({ queue: device.queue, signal: abort.signal, withForeground: frameRun.withForeground });
        active.control = control;
        const job = route.enqueue({ jobId: runId, execute: invocation => solve({ caption, noise, onEvaluation, onStep,
          schedule: { runtime: route.runtime, invocation, control, signal: abort.signal, targetDutyMs, maxInFlight } }) });
        const completion = await job.completion;
        if (completion.status !== 'succeeded') {
          const error = new Error(completion.failure?.message ?? completion.status);
          error.name = completion.failure?.name ?? 'Error';
          throw error;
        }
        result = completion.output;
      } else {
        result = await solve({ caption, noise, schedule: null, onEvaluation, onStep });
      }
      result.prompt = text;
      result.seed = seed;
      result.textEncoder = t5 ? 'browser T5' : 'captured embedding';
      result.encodeMs = encodeMs;
      result.noise = seed === null ? 'reference (accepted CPU run)' : `browser seed ${seed}`;
      result.wallMs = performance.now() - started;
      result.cooperative = cooperative;
      result.dutyCount = result.duties.length;
      result.longestDutyMs = Math.max(0, ...result.duties.map(d => d.queueMs ?? 0));
      const ref = prompt.referencePositions && seed === null ? arrays[prompt.referencePositions] : null;
      if (ref) {
        let maxDev = 0;
        const p = result.motion.positions;
        for (let i = 0; i < T * J; i++) maxDev = Math.max(maxDev, Math.hypot(p[i * 3] - ref[i * 3], p[i * 3 + 1] - ref[i * 3 + 1], p[i * 3 + 2] - ref[i * 3 + 2]));
        result.referenceMaxJointDeviation = maxDev;
      }
      result.skeleton = g.skeleton;
      return result;
    } finally {
      try { await active.control?.close(); } catch { /* reported by the control */ }
      if (route) { await route.drain(); session.unregisterRoute(route.routeId); }
      if (frameRun) await frameRun.finish();
      active = null;
    }
  }

  async function togglePause() {
    const control = active?.control;
    if (!control) return null;
    const snap = control.snapshot();
    if (snap.status === 'paused' || snap.pauseRequested) { await control.resume(); return 'running'; }
    await control.pause(); return 'paused';
  }
  function stop(reason = 'stopped by user') { active?.abort.abort(new Error(reason)); }

  // Switch the generation skeleton (a bundle directory) between runs.
  async function useSkeleton(base) {
    if (active) throw new Error('a generation is running');
    applySkeleton(await fetchSkeleton(base));
    den.configure({ B: 2, J });
    return bundle;
  }

  // Switch to an in-memory skeleton bundle ({ b, a }: index and arrays, e.g. from the rig importer).
  async function useSkeletonData(data) {
    if (active) throw new Error('a generation is running');
    applySkeleton(data);
    den.configure({ B: 2, J });
    return bundle;
  }
  // The pooled Flan-T5 encoding of a text (a prompt, or a joint label for an imported rig).
  async function encodeText(text) {
    if (!t5) throw new Error('the text encoder is not loaded');
    return (await t5.encode(text)).pooled;
  }

  Object.assign(g, { generate, togglePause, stop, useSkeleton, useSkeletonData, encodeText, hasTextEncoder: () => Boolean(t5),
    get running() { return Boolean(active); }, forwardFlops: den.forwardFlops, parameterCount: manifest.parameterCount });
  onStatus({ phase: 'ready', detail: `${manifest.parameterCount.toLocaleString()} parameters${t5 ? ' · type any prompt' : ''}` });
  return g;
}
