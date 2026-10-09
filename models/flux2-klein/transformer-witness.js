// Transformer parity witness: one Klein transformer evaluation on the
// reference's step inputs, every boundary compared to the CPU float32 oracle,
// then an untapped timing run. Served by run-transformer-witness.mjs with
// /weights -> packed bundles and /ref -> export-reference.py output.
import { KleinTransformer, ropeTable } from './klein-transformer.js';
import { kleinSchedule, transformerTime } from './klein-schedule.js';
import { KleinVaeDecoder } from './klein-vae.js';
import { KleinTextEncoder, gatherEmbeddings } from './klein-text-encoder.js';
import { QwenTokenizer } from './qwen-tokenizer.js';

const state = { phase: 'init' };
window.transformerWitnessState = state;

async function getJson(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); }
async function getBytes(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.arrayBuffer(); }
async function sha256(buf) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join(''); }

function nchwToNhwcInverse(nhwc, C, HW) { const o = new Float32Array(C * HW); for (let i = 0; i < HW; i++) for (let c = 0; c < C; c++) o[c * HW + i] = nhwc[i * C + c]; return o; }

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
    report.inputs = { step, timestep, imgTokens, txtTokens };

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

    // Schedule check: the browser's sigma schedule against the pipeline's.
    const steps = rm.steps;
    const sched = kleinSchedule(imgTokens, steps);
    report.schedule = { mine: sched.sigmas, reference: rm.sigmas,
      maxAbsDiff: Math.max(...sched.sigmas.map((v, i) => Math.abs(v - rm.sigmas[i]))) };

    state.phase = 'parity-denoise';
    model.allocate(imgTokens, txtTokens);
    model.prepare({ latents, promptEmbeds, imgIds, txtIds });
    const readback = async (buf, bytes, byteOffset = 0) => {
      const rb = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = device.createCommandEncoder(); enc.copyBufferToBuffer(buf, byteOffset, rb, 0, bytes); device.queue.submit([enc.finish()]);
      await rb.mapAsync(GPUMapMode.READ);
      const got = new Float32Array(rb.getMappedRange().slice(0)); rb.unmap(); rb.destroy();
      return got;
    };
    const check = async (name, refName, got) => {
      const ref = await refTensor(refName);
      if (ref.length !== got.length) { report.boundaries.push({ name, pass: false, shapeMismatch: [got.length, ref.length] }); return; }
      const row = { name, ...compare(got, ref) };
      row.pass = row.nonFinite === 0 && row.relL2 <= cfg.tolerance;
      report.boundaries.push(row);
      state.phase = `parity:${name}`;
    };
    if (cfg.textEncoder) {
      // Text path: tokenizer and Qwen3 encoder from the prompt string, written straight into the
      // transformer's prompt-embedding buffer, so the denoise below runs from browser text features.
      state.phase = 'text-encoder-load';
      const tm = await getJson('/te/manifest.json');
      const tokJson = await getJson(`/te/${tm.tokenizer.file}`);
      const tok = new QwenTokenizer(tokJson);
      const framed = tok.kleinPromptIds(rm.prompt);
      const refIds = await refTensor('tokenizer/input_ids'), refMask = await refTensor('tokenizer/attention_mask');
      report.tokenizer = { textMatches: framed.text === rm.chat_template_text, length: framed.length,
        idsMatch: framed.inputIds.every((v, i) => v === refIds[i]), maskMatches: framed.attentionMask.every((v, i) => v === refMask[i]) };
      if (!report.tokenizer.idsMatch || !report.tokenizer.maskMatches) throw new Error('tokenizer mismatch');
      const te = new KleinTextEncoder(device, tm);
      const t2 = performance.now();
      await te.loadBundles(async (file, bundle) => {
        const buf = await getBytes(`/te/${file}`);
        if (buf.byteLength !== bundle.bytes) throw new Error(`bundle ${file} size mismatch`);
        if (cfg.verifyDigests && await sha256(buf) !== bundle.sha256) throw new Error(`bundle digest mismatch ${file}`);
        return buf;
      }, name => { state.phase = `te-weights:${name}`; });
      report.textEncoderLoadMs = performance.now() - t2;
      const rowBytes = tm.embedding.row_bytes;
      const fetchRows = async ids => new Map(await Promise.all(ids.map(async id => {
        const r = await fetch(`/te/${tm.embedding.file}`, { headers: { Range: `bytes=${id * rowBytes}-${(id + 1) * rowBytes - 1}` } });
        if (r.status !== 206) throw new Error(`embedding range request returned ${r.status}`);
        const b = await r.arrayBuffer(); if (b.byteLength !== rowBytes) throw new Error('short embedding row');
        return [id, b];
      })));
      state.phase = 'text-encode';
      const emb = await gatherEmbeddings([...framed.inputIds], tm.config.hidden_size, fetchRows);
      te.allocate(framed.inputIds.length);
      const t3 = performance.now();
      await te.encode(emb, framed.attentionMask, model.act.promptEmbeds);
      report.textEncodeMs = performance.now() - t3;
      await check('text/prompt_embeds', 'text/prompt_embeds', await readback(model.act.promptEmbeds, txtTokens * tm.taps.length * tm.config.hidden_size * 4));
    }
    for (let i = 0; i < steps; i++) {
      if (i > 0) await check(`step${i}/latents_in`, `denoise/step${i}/latents_in`, await readback(model.act.latents, imgTokens * 128 * 4));
      const tModel = transformerTime(sched.timesteps[i]);
      const taps = async (name, buf, rows, cols, byteOffset) => {
        const refName = name === 'velocity' ? `denoise/step${i}/velocity` : `blocks_step${i}/${name}`;
        if (!rm.tensors[refName]) return;
        await check(i === 0 || name === 'velocity' ? `step${i}/${name}` : name, refName, await readback(buf, rows * cols * 4, byteOffset));
      };
      await model.forward({ tModel }, taps);
      await model.eulerStep(Math.fround(sched.sigmas[i + 1] - sched.sigmas[i]));
    }

    // VAE: latent prep from the browser's own final latents, then decode both the
    // browser latents and (teacher-forced) the reference decoder input.
    if (cfg.vae) {
      state.phase = 'vae-load';
      const vm = await getJson('/vae/manifest.json');
      const vbytes = await getBytes(`/vae/${vm.bundle.file}`);
      if (cfg.verifyDigests && await sha256(vbytes) !== vm.bundle.sha256) throw new Error('VAE bundle digest mismatch');
      const vae = new KleinVaeDecoder(device, vm);
      await vae.load(vbytes);
      const latH = Math.round(Math.sqrt(imgTokens)), latW = imgTokens / latH;
      vae.allocate(latH, latW);
      const nchwToNhwc = (src, C, HW) => { const o = new Float32Array(C * HW); for (let c = 0; c < C; c++) for (let i = 0; i < HW; i++) o[i * C + c] = src[c * HW + i]; return o; };
      const refZ = await refTensor('vae/latents_in');
      const refImg = await refTensor('vae/image');
      const HWz = (latH * 2) * (latW * 2), HWi = (latH * 16) * (latW * 16);
      state.phase = 'vae-prep';
      let enc = device.createCommandEncoder();
      vae.prepLatents(enc, model.act.latents);
      device.queue.submit([enc.finish()]);
      await check('vae/latents_in', 'vae/latents_in', nchwToNhwcInverse(await readback(vae.prepped, HWz * 32 * 4), 32, HWz));
      const decodeTo = async (zBuf, label) => {
        state.phase = `vae-decode:${label}`;
        const t1 = performance.now();
        vae.decode(zBuf);
        await device.queue.onSubmittedWorkDone();
        const ms = performance.now() - t1;
        const rgb = await readback(vae.out, HWi * 3 * 4);
        vae.releaseUniforms();
        await check(`vae/image(${label})`, 'vae/image', nchwToNhwcInverse(rgb, 3, HWi));
        report.vaeDecodeMs = { ...(report.vaeDecodeMs || {}), [label]: ms };
        return rgb;
      };
      const zRef = vae.buffer(HWz * 32 * 4); device.queue.writeBuffer(zRef, 0, nchwToNhwc(refZ, 32, HWz));
      await decodeTo(zRef, 'reference-latents');
      const rgb = await decodeTo(vae.prepped, 'browser-latents');
      const W = latW * 16, H = latH * 16;
      const img = new ImageData(W, H);
      for (let i = 0; i < W * H; i++) for (let c = 0; c < 3; c++) img.data[i * 4 + c] = Math.round(Math.min(1, Math.max(0, rgb[i * 3 + c] / 2 + 0.5)) * 255);
      for (let i = 0; i < W * H; i++) img.data[i * 4 + 3] = 255;
      const canvas = new OffscreenCanvas(W, H); canvas.getContext('2d').putImageData(img, 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const bytes = new Uint8Array(await blob.arrayBuffer()); let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const b64 = btoa(bin);
      report.browserImagePngBase64 = b64;
    }
    report.parityPass = report.boundaries.filter(b => b.pass !== undefined).every(b => b.pass);

    state.phase = 'timing';
    const timings = [];
    for (let r = 0; r < (cfg.timingRuns ?? 2); r++) {
      model.prepare({ latents, promptEmbeds, imgIds, txtIds });
      const t1 = performance.now(); const perStep = [];
      for (let i = 0; i < steps; i++) {
        const ts = performance.now();
        await model.forward({ tModel: transformerTime(sched.timesteps[i]) });
        await model.eulerStep(Math.fround(sched.sigmas[i + 1] - sched.sigmas[i]));
        perStep.push(performance.now() - ts);
      }
      timings.push({ totalMs: performance.now() - t1, perStepMs: perStep });
    }
    report.denoiseTiming = timings;
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
