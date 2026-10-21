// FLUX.3 Klein transformer parity witness: for each step export-flux3-reference.py saved, one
// transformer evaluation on the reference's inputs with every boundary (conditioning, embedders,
// each block, output norm, velocity) compared to the CPU float32 oracle run on the same quantized
// weights; then untapped timing runs, at the reference size and optionally at --timing-size.
// Served by run-flux3-transformer-witness.mjs with /weights -> packed bundles, /ref -> reference.
import { Flux3Transformer, flux3ImageIds, flux3TextIds } from './flux3-transformer.js';
import { flux3Schedule } from './flux3-schedule.js';

const state = { phase: 'init' };
window.transformerWitnessState = state;

async function getJson(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); }
async function getBytes(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.arrayBuffer(); }
async function sha256(buf) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join(''); }

function compare(got, ref) {
  let num = 0, den = 0, maxAbs = 0, refMax = 0, nonFinite = 0;
  for (let i = 0; i < ref.length; i++) {
    const g = got[i], r = ref[i];
    if (!Number.isFinite(g)) { nonFinite++; continue; }
    const d = g - r; num += d * d; den += r * r;
    maxAbs = Math.max(maxAbs, Math.abs(d)); refMax = Math.max(refMax, Math.abs(r));
  }
  return { relL2: Math.sqrt(num / den), maxAbsErr: maxAbs, refMaxAbs: refMax, nonFinite, n: ref.length };
}

function gaussian(n, seed) {
  let s = seed >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) + 0.5) / 4294967296;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const r = Math.sqrt(-2 * Math.log(rnd())), a = 2 * Math.PI * rnd();
    out[i] = r * Math.cos(a); if (i + 1 < n) out[i + 1] = r * Math.sin(a);
  }
  return out;
}

window.runTransformerWitness = async function (cfg) {
  const report = { schema: 'kaminos.flux3-klein.transformer-witness.v0', startedAt: new Date().toISOString(), config: cfg,
    userAgent: navigator.userAgent, boundaries: [], weightBundles: {} };
  try {
    state.phase = 'device';
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter.features.has('shader-f16')) throw new Error('shader-f16 unavailable');
    const info = adapter.info || {};
    report.adapter = { vendor: info.vendor, architecture: info.architecture, description: info.description };
    const features = ['shader-f16', ...(adapter.features.has('timestamp-query') ? ['timestamp-query'] : [])];
    const device = await adapter.requestDevice({ requiredFeatures: features, requiredLimits: {
      maxBufferSize: adapter.limits.maxBufferSize, maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxStorageBuffersPerShaderStage: adapter.limits.maxStorageBuffersPerShaderStage } });
    device.lost.then(l => { report.deviceLost = { reason: l.reason, message: l.message }; });
    device.onuncapturederror = e => { (report.gpuErrors ??= []).push(e.error.message); };

    state.phase = 'manifests';
    const wm = await getJson('/weights/manifest.json');
    const rm = await getJson('/ref/manifest.json');
    if (rm.phase !== 'done') throw new Error(`reference export ended in phase ${rm.phase}`);
    report.weights = { format: wm.format, globalsFormat: wm.globals_format, source: wm.source, totalBytes: wm.total_bytes };
    report.reference = { prompt: rm.prompt, seed: rm.seed, size: rm.size, steps: rm.steps, versions: rm.versions, weights: rm.weights, source: rm.source };
    if (rm.weights.format !== wm.format || rm.weights.globals_format !== wm.globals_format)
      throw new Error(`reference ran ${rm.weights.format}/${rm.weights.globals_format}, bundles are ${wm.format}/${wm.globals_format}`);
    const refTensor = async name => {
      const t = rm.tensors[name]; if (!t) throw new Error(`reference lacks ${name}`);
      const buf = await getBytes(`/ref/${t.file}`);
      if (cfg.verifyDigests && await sha256(buf) !== t.sha256) throw new Error(`reference digest mismatch ${name}`);
      return new Float32Array(buf);
    };

    // Host-side checks: schedule and position ids against the reference.
    const sched = flux3Schedule(rm.steps);
    report.schedule = { maxAbsDiff: Math.max(...sched.sigmas.map((v, i) => Math.abs(v - rm.sigmas[i]))) };
    const grid = rm.size / 16;
    const imgIds = flux3ImageIds(grid, grid);
    const refImgIds = await refTensor('denoise/img_ids');
    const promptEmbeds = await refTensor('text/prompt_embeds');
    const txtTokens = rm.tensors['text/prompt_embeds'].shape[0];
    const txtIds = flux3TextIds(txtTokens);
    const refTxtIds = await refTensor('text/txt_ids');
    report.ids = { img: imgIds.every((v, i) => v === refImgIds[i]), txt: txtIds.every((v, i) => v === refTxtIds[i]) };
    if (!report.ids.img || !report.ids.txt || report.schedule.maxAbsDiff > 1e-7) throw new Error('host-side schedule or ids mismatch');

    state.phase = 'weights';
    const model = new Flux3Transformer(device, wm);
    model.gemmVersion = cfg.gemmVersion ?? 2; model.sharedType = cfg.sharedType ?? 'f32';
    report.kernelConfig = { gemmVersion: model.gemmVersion, sharedType: model.sharedType };
    const t0 = performance.now();
    await model.loadBundles(async (file, bundle) => {
      const buf = await getBytes(`/weights/${file}`);
      if (buf.byteLength !== bundle.bytes) throw new Error(`bundle ${file} size ${buf.byteLength} != ${bundle.bytes}`);
      if (cfg.verifyDigests && await sha256(buf) !== bundle.sha256) throw new Error(`bundle digest mismatch ${file}`);
      return buf;
    }, (name, bytes) => { report.weightBundles[name] = bytes; state.phase = `weights:${name}`; });
    report.weightLoadMs = performance.now() - t0;

    const readback = async (buf, bytes, byteOffset = 0) => {
      const rb = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = device.createCommandEncoder(); enc.copyBufferToBuffer(buf, byteOffset, rb, 0, bytes); device.queue.submit([enc.finish()]);
      await rb.mapAsync(GPUMapMode.READ);
      const got = new Float32Array(rb.getMappedRange().slice(0)); rb.unmap(); rb.destroy();
      return got;
    };
    const imgTokens = grid * grid;
    model.allocate(imgTokens, txtTokens);
    const steps = Object.keys(rm.tensors).filter(n => /^step\d+\/latents_in$/.test(n)).map(n => Number(n.slice(4, n.indexOf('/'))));
    report.steps = steps;
    for (const step of steps) {
      state.phase = `parity:step${step}`;
      const latents = await refTensor(`step${step}/latents_in`);
      const tModel = Math.fround((await refTensor(`step${step}/timestep`))[0] * 1000);
      const targetModel = Math.fround((await refTensor(`step${step}/target_timestep`))[0] * 1000);
      model.prepare({ latents, promptEmbeds, imgIds, txtIds });
      await model.forward({ tModel, targetModel }, async (name, buf, rows, cols, byteOffset) => {
        const refName = `step${step}/${name.replace(/^model\//, '')}`;
        if (!rm.tensors[refName]) { report.boundaries.push({ name: refName, pass: false, missingReference: true }); return; }
        const ref = await refTensor(refName);
        const got = await readback(buf, rows * cols * 4, byteOffset);
        if (ref.length !== got.length) { report.boundaries.push({ name: refName, pass: false, shapeMismatch: [got.length, ref.length] }); return; }
        const row = { name: refName, ...compare(got, ref) };
        row.pass = row.nonFinite === 0 && row.relL2 <= cfg.tolerance;
        report.boundaries.push(row);
      });
    }
    report.parityPass = report.boundaries.length > 0 && report.boundaries.every(b => b.pass);

    // Timing: untapped forward passes at the reference size, then (optionally) at timingSize with
    // the same text features and seeded noise latents. Each figure is one transformer evaluation.
    state.phase = 'timing';
    report.timing = [];
    for (const size of [rm.size, ...(cfg.timingSize ? [cfg.timingSize] : [])]) {
      const g = size / 16, n = g * g;
      model.allocate(n, txtTokens);
      model.prepare({ latents: size === rm.size ? await refTensor(`step${steps[0]}/latents_in`) : gaussian(n * 128, 7), promptEmbeds, imgIds: flux3ImageIds(g, g), txtIds });
      const runs = [];
      for (let r = 0; r < 1 + (cfg.timingRuns ?? 1); r++) {
        const t1 = performance.now();
        await model.forward({ tModel: 1000, targetModel: Math.fround(sched.sigmas[1] * 1000) });
        await device.queue.onSubmittedWorkDone();
        runs.push(performance.now() - t1);
      }
      report.timing.push({ size, imgTokens: n, txtTokens, firstMs: runs[0], warmMs: runs.slice(1) });
    }
    if (cfg.profile && device.features.has('timestamp-query')) {
      state.phase = 'profile';
      model.startProfile();
      await model.forward({ tModel: 1000, targetModel: Math.fround(sched.sigmas[1] * 1000) });
      report.profile = await model.endProfile();
    }
    state.phase = 'done';
    report.phase = 'done';
  } catch (e) {
    report.error = String(e?.stack || e);
    report.phase = state.phase;
  }
  report.finishedAt = new Date().toISOString();
  return report;
};
window.transformerWitnessReady = true;
