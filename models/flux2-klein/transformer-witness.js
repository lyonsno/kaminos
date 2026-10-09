// Transformer parity witness: one Klein transformer evaluation on the
// reference's step inputs, every boundary compared to the CPU float32 oracle,
// then an untapped timing run. Served by run-transformer-witness.mjs with
// /weights -> packed bundles and /ref -> export-reference.py output.
import { KleinTransformer, ropeTable } from './klein-transformer.js';

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

window.runTransformerWitness = async function (cfg) {
  const report = { schema: 'kaminos.flux2-klein.transformer-witness.v0', startedAt: new Date().toISOString(), config: cfg,
    userAgent: navigator.userAgent, boundaries: [], weightBundles: {} };
  try {
    state.phase = 'device';
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter.features.has('shader-f16')) throw new Error('shader-f16 unavailable');
    const info = adapter.info || {};
    report.adapter = { vendor: info.vendor, architecture: info.architecture, description: info.description };
    const device = await adapter.requestDevice({ requiredFeatures: ['shader-f16'], requiredLimits: {
      maxBufferSize: adapter.limits.maxBufferSize, maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxStorageBuffersPerShaderStage: adapter.limits.maxStorageBuffersPerShaderStage } });
    device.lost.then(l => { report.deviceLost = { reason: l.reason, message: l.message }; });
    device.onuncapturederror = e => { (report.gpuErrors ??= []).push(e.error.message); };

    state.phase = 'manifests';
    const wm = await getJson('/weights/manifest.json');
    const rm = await getJson('/ref/manifest.json');
    report.referenceManifest = { prompt: rm.prompt, seed: rm.seed, size: rm.size, steps: rm.steps, versions: rm.versions, timesteps: rm.timesteps };
    const refTensor = async name => {
      const t = rm.tensors[name]; if (!t) throw new Error(`reference lacks ${name}`);
      const buf = await getBytes(`/ref/${t.file}`);
      if (cfg.verifyDigests && await sha256(buf) !== t.sha256) throw new Error(`reference digest mismatch ${name}`);
      return t.dtype === 'int32' ? new Int32Array(buf) : new Float32Array(buf);
    };

    state.phase = 'weights';
    const model = new KleinTransformer(device, wm);
    const t0 = performance.now();
    await model.loadBundles(async (file, bundle) => {
      const buf = await getBytes(`/weights/${file}`);
      if (buf.byteLength !== bundle.bytes) throw new Error(`bundle ${file} size ${buf.byteLength} != ${bundle.bytes}`);
      if (cfg.verifyDigests && await sha256(buf) !== bundle.sha256) throw new Error(`bundle digest mismatch ${file}`);
      return buf;
    }, (name, bytes) => { report.weightBundles[name] = bytes; state.phase = `weights:${name}`; });
    report.weightLoadMs = performance.now() - t0;

    state.phase = 'inputs';
    const step = cfg.step ?? 0;
    const latents = await refTensor(`denoise/step${step}/latents_in`);
    const promptEmbeds = await refTensor('text/prompt_embeds');
    const timestep = (await refTensor(`denoise/step${step}/timestep`))[0];
    const imgIds = Float64Array.from(await refTensor('denoise/img_ids'));
    const txtIds = Float64Array.from(await refTensor('text/text_ids'));
    const imgTokens = imgIds.length / 4, txtTokens = txtIds.length / 4;
    const tModel = Math.fround(Math.fround(timestep) * 1000);
    report.inputs = { step, timestep, tModel, imgTokens, txtTokens };

    // RoPE table check against the oracle (host-side math, no GPU).
    const blockStep = rm.tensors['blocks_step0/rope/img_cos'] ? 0 : null;
    if (step === blockStep) {
      const mine = ropeTable(Float64Array.from([...txtIds, ...imgIds]));
      for (const [label, ids0, n] of [['txt', 0, txtTokens], ['img', txtTokens, imgTokens]]) {
        const cos = await refTensor(`blocks_step0/rope/${label}_cos`), sin = await refTensor(`blocks_step0/rope/${label}_sin`);
        const gotCos = new Float32Array(n * 128), gotSin = new Float32Array(n * 128);
        for (let i = 0; i < n * 128; i++) { gotCos[i] = mine[(ids0 * 128 + i) * 2]; gotSin[i] = mine[(ids0 * 128 + i) * 2 + 1]; }
        report.boundaries.push({ name: `rope/${label}_cos`, ...compare(gotCos, cos) });
        report.boundaries.push({ name: `rope/${label}_sin`, ...compare(gotSin, sin) });
      }
    }

    state.phase = 'parity-forward';
    model.allocate(imgTokens, txtTokens);
    const refNames = { 'velocity': `denoise/step${step}/velocity` };
    const taps = async (name, buf, rows, cols, byteOffset) => {
      const refName = refNames[name] ?? `blocks_step${step}/${name}`;
      if (!rm.tensors[refName]) return;
      const bytes = rows * cols * 4;
      const rb = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = device.createCommandEncoder(); enc.copyBufferToBuffer(buf, byteOffset, rb, 0, bytes); device.queue.submit([enc.finish()]);
      await rb.mapAsync(GPUMapMode.READ);
      const got = new Float32Array(rb.getMappedRange().slice(0)); rb.unmap(); rb.destroy();
      const ref = await refTensor(refName);
      if (ref.length !== got.length) { report.boundaries.push({ name, pass: false, shapeMismatch: [got.length, ref.length] }); return; }
      const row = { name, ...compare(got, ref) };
      row.pass = row.nonFinite === 0 && row.relL2 <= cfg.tolerance;
      report.boundaries.push(row);
      state.phase = `parity:${name}`;
    };
    await model.forward({ latents, promptEmbeds, tModel, imgIds, txtIds }, taps);
    report.parityPass = report.boundaries.filter(b => b.pass !== undefined).every(b => b.pass);

    state.phase = 'timing';
    const timings = [];
    for (let r = 0; r < (cfg.timingRuns ?? 2); r++) {
      const t1 = performance.now();
      await model.forward({ latents, promptEmbeds, tModel, imgIds, txtIds });
      await device.queue.onSubmittedWorkDone();
      timings.push(performance.now() - t1);
    }
    report.forwardMs = timings;
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
