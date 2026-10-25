// FLUX.2 Klein text-to-image in the browser: tokenizer -> Qwen3 text encoder ->
// 4-step flow-matching transformer -> VAE decoder. Weight roots are URLs to
// directories produced by pack-text-encoder.py, pack-transformer.py and
// pack-vae.py (any of the f16/i8/i4 formats). Noise comes from a seeded
// in-browser Gaussian, so images are reproducible per seed but do not match
// torch's generator.
import { KleinTransformer } from './klein-transformer.js';
import { KleinTextEncoder, gatherEmbeddings } from './klein-text-encoder.js';
import { KleinVaeDecoder } from './klein-vae.js';
import { QwenTokenizer } from './qwen-tokenizer.js';
import { kleinSchedule, transformerTime } from './klein-schedule.js';
import { KleinDutyScheduler } from './klein-duties.js';
import { kleinWeightUrls } from './klein-weights.js';
import { createWebGpuLatentPreview } from '../../webgpu-inference-kit/src/core.js';
import { LATENT_PREVIEW_FIT, LATENT_PREVIEW_WEIGHTS, LATENT_PREVIEW_BIAS } from './klein-latent-preview.js';

// fetch that names the URL when the request fails outright: browsers report a blocked or missing
// cross-origin file only as "Failed to fetch".
async function fetchNamed(url, init) {
  try { return await fetch(url, init); } catch (error) { throw new Error(`${url}: ${error?.message ?? error}`, { cause: error }); }
}
async function getJson(url) { const r = await fetchNamed(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); }

// Weight files are immutable per manifest digest, so they are cached in the browser Cache API
// under URL + sha256: a second visit loads from disk with no network. Downloads stream so the
// caller can show byte progress; a size mismatch against the manifest fails loud and is not
// cached. Cache failures (private windows, quota) fall back to the network.
//
// A manifest entry may name a gzip copy ({ gzip: { file, bytes } }). When the browser has
// DecompressionStream, the copy is downloaded and decompressed in the page; progress and download
// counts are then in transferred (compressed) bytes, and the cache still holds the decompressed
// file under the original URL. A missing copy falls back to the original file.
export const WEIGHT_CACHE = 'flux2-klein-weights-v1';
const canGunzip = typeof DecompressionStream === 'function';
async function openWeightCache() {
  try { return await caches.open(WEIGHT_CACHE); } catch { return null; }
}
// Bytes a file costs to fetch: its gzip copy when one is published and the browser can inflate it.
export function transferBytes(entry) { return canGunzip && entry?.gzip ? entry.gzip.bytes : entry?.bytes; }

async function readAll(stream, expected) {
  const out = expected ? new Uint8Array(expected) : null;
  const chunks = []; let n = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (out && n + value.byteLength <= expected) out.set(value, n); else chunks.push(value);
    n += value.byteLength;
  }
  return { buf: out && n === expected ? out.buffer : await new Blob(out ? [out.subarray(0, Math.min(n, expected)), ...chunks] : chunks).arrayBuffer(), n };
}

// The response body, counted as it arrives and inflated when it starts with the gzip magic bytes
// (a host may already have decoded it).
async function inflatedBody(response, onChunk) {
  const reader = response.body.getReader();
  const first = await reader.read();
  const counted = new ReadableStream({
    start(controller) { if (!first.done) { onChunk(first.value.byteLength); controller.enqueue(first.value); } else controller.close(); },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) { controller.close(); return; }
      onChunk(value.byteLength); controller.enqueue(value);
    },
    cancel(reason) { return reader.cancel(reason); },
  });
  const gzipped = !first.done && first.value[0] === 0x1f && first.value[1] === 0x8b;
  return gzipped ? counted.pipeThrough(new DecompressionStream('gzip')) : counted;
}

async function getWeightBytes(url, { sha256 = null, bytes = null, gzip = null, onBytes = () => {} } = {}, stats) {
  const cache = await openWeightCache();
  const key = sha256 ? `${url}#sha256=${sha256}` : url;
  const hit = cache ? await cache.match(key).catch(() => null) : null;
  if (hit) {
    const buf = await hit.arrayBuffer();
    if (bytes == null || buf.byteLength === bytes) {
      const cost = transferBytes({ bytes: buf.byteLength, gzip });
      stats.cachedBytes += cost; onBytes(cost); return buf;
    }
    await cache.delete(key).catch(() => {});
  }
  let received = 0;
  const count = n => { received += n; onBytes(n); };
  let response = canGunzip && gzip ? await fetch(url.replace(/[^/]+$/, gzip.file)).catch(() => null) : null;
  let body;
  if (response?.ok) body = await inflatedBody(response, count);
  else {
    response = await fetchNamed(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    body = await inflatedBody(response, count);
  }
  const { buf, n } = await readAll(body, bytes);
  if (bytes != null && n !== bytes) throw new Error(`${url}: received ${n} bytes, manifest says ${bytes}`);
  stats.downloadedBytes += received;
  if (cache) await cache.put(key, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } })).catch(e => { stats.cacheErrors.push(String(e)); });
  return buf;
}

// How much of a weight set is already in the browser cache, from its manifests alone, so a page
// can say whether loading means a download before starting one.
export async function kleinWeightStatus({ textEncoderUrl: te, transformerUrl: dit, vaeUrl: vae }) {
  const [teM, ditM, vaeM] = await Promise.all([te, dit, vae].map(root => getJson(`${root}/manifest.json`)));
  const files = [[te, teM.tokenizer], ...[[te, teM], [dit, ditM]].flatMap(([root, m]) => Object.values(m.bundles).map(b => [root, b])),
    [vae, vaeM.bundle]];
  const cache = await openWeightCache();
  // Byte totals cover what loading transfers (gzip copies where published); a file without a
  // listed size (an older tokenizer entry) only counts toward complete.
  let totalBytes = 0, cachedBytes = 0, missing = 0;
  for (const [root, f] of files) {
    const hit = cache ? await cache.match(`${root}/${f.file}#sha256=${f.sha256}`).catch(() => null) : null;
    const cost = transferBytes(f) ?? 0;
    totalBytes += cost;
    if (hit) cachedBytes += cost; else missing++;
  }
  return { totalBytes, cachedBytes, complete: missing === 0 };
}

// splitmix64-seeded xoshiro128** with Box-Muller, f32 output.
export function gaussianNoise(n, seed) {
  let s = [0, 0, 0, 0];
  let x = BigInt.asUintN(64, BigInt(seed));
  for (let i = 0; i < 4; i += 2) {
    x = BigInt.asUintN(64, x + 0x9E3779B97F4A7C15n);
    let z = x; z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n); z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94D049BB133111EBn); z ^= z >> 31n;
    s[i] = Number(z & 0xffffffffn) >>> 0; s[i + 1] = Number(z >> 32n) >>> 0;
  }
  const rotl = (v, k) => ((v << k) | (v >>> (32 - k))) >>> 0;
  const next = () => {
    const r = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3]; s[2] ^= t; s[3] = rotl(s[3], 11);
    return (r + 0.5) / 4294967296;
  };
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const u1 = next(), u2 = next(), r = Math.sqrt(-2 * Math.log(u1));
    out[i] = r * Math.cos(2 * Math.PI * u2);
    if (i + 1 < n) out[i + 1] = r * Math.sin(2 * Math.PI * u2);
  }
  return out;
}

export class KleinPipeline {
  // Product kernels default to GEMM v2 with f16 shared tiles (about 1.7x faster than the
  // parity kernel; final-velocity drift about 5e-3, small next to int4 weight drift).
  // residency 'all' keeps every model's weights on the GPU. 'lean' (for 8 GB machines and phones)
  // never holds the text encoder and the transformer together: a new prompt loads the text encoder
  // from the browser cache in place of the transformer, encodes, and swaps back, so peak memory is
  // about 2.6 GB at 512 instead of 4 GB, at the cost of those reloads. A re-roll swaps nothing.
  // Weights: the hosted copy by default; weightsBase and level choose another base or jank level
  // (see klein-weights.js), and explicit textEncoderUrl / transformerUrl / vaeUrl roots override both.
  constructor(device, { textEncoderUrl, transformerUrl, vaeUrl, weightsBase, level, gemmVersion = 2, sharedType = 'f16', vaeActType = 'f16', residency = 'all' } = {}) {
    const defaults = kleinWeightUrls({ base: weightsBase, level });
    this.device = device;
    this.urls = { textEncoderUrl: textEncoderUrl ?? defaults.textEncoderUrl, transformerUrl: transformerUrl ?? defaults.transformerUrl,
      vaeUrl: vaeUrl ?? defaults.vaeUrl };
    this.kernels = { gemmVersion, sharedType, vaeActType };
    this.residency = residency;
    this.timings = {}; this.residentBytes = {};
    // One duty scheduler for all three components so a cooperative run has a single
    // fence chain and FLOP budget from the first text-encoder layer to the last VAE stage.
    this.sched = new KleinDutyScheduler(device, { label: 'flux2-klein' });
  }

  // onProgress(part, name, { loadedBytes, totalBytes }) reports per-bundle progress over all weights.
  async load(onProgress = () => {}, { runWarmup } = {}) {
    this.assertUsable();
    const { textEncoderUrl: te, transformerUrl: dit, vaeUrl: vae } = this.urls;
    const t0 = performance.now();
    this.teManifest = await getJson(`${te}/manifest.json`);
    this.ditManifest = await getJson(`${dit}/manifest.json`);
    this.vaeManifest = await getJson(`${vae}/manifest.json`);
    const bundleBytes = m => Object.values(m.bundles ?? {}).reduce((sum, b) => sum + transferBytes(b), 0);
    const totalBytes = bundleBytes(this.teManifest) + bundleBytes(this.ditManifest) + transferBytes(this.vaeManifest.bundle)
      + (transferBytes(this.teManifest.tokenizer) ?? 0);
    const stats = this.loadStats = { totalBytes, cachedBytes: 0, downloadedBytes: 0, cacheErrors: [] };
    let loadedBytes = 0;
    const progress = (part, name) => onProgress(part, name, { loadedBytes, totalBytes });
    const fetchBundle = (root, part) => (file, bundle) => getWeightBytes(`${root}/${file}`,
      { sha256: bundle?.sha256, bytes: bundle?.bytes, gzip: bundle?.gzip, onBytes: n => { loadedBytes += n; progress(part, file); } }, stats);
    const tok = this.teManifest.tokenizer;
    const tokenizerBytes = await getWeightBytes(`${te}/${tok.file}`, { sha256: tok.sha256, bytes: tok.bytes, gzip: tok.gzip,
      onBytes: n => { if (transferBytes(tok)) { loadedBytes += n; progress('text-encoder', tok.file); } } }, stats);
    this.tokenizer = new QwenTokenizer(JSON.parse(new TextDecoder().decode(tokenizerBytes)));
    this.textEncoder = new KleinTextEncoder(this.device, this.teManifest);
    Object.assign(this.textEncoder, this.kernels); this.textEncoder.sched = this.sched;
    const lean = this.residency === 'lean';
    let bytes = 0;
    if (!lean) {
      await this.textEncoder.loadBundles(fetchBundle(te, 'text-encoder'), (n, b) => { bytes += b; });
      this.residentBytes.textEncoder = bytes;
    }
    this.transformer = this.createTransformer(this.ditManifest);
    Object.assign(this.transformer, this.kernels); this.transformer.sched = this.sched;
    bytes = 0;
    await this.transformer.loadBundles(fetchBundle(dit, 'transformer'), (n, b) => { bytes += b; });
    this.residentBytes.transformer = bytes;
    this.vae = new KleinVaeDecoder(this.device, this.vaeManifest);
    this.vae.sharedType = this.kernels.sharedType; this.vae.actType = this.kernels.vaeActType; this.vae.sched = this.sched;
    const vb = await fetchBundle(vae, 'vae')(this.vaeManifest.bundle.file, this.vaeManifest.bundle);
    await this.vae.load(vb); this.residentBytes.vae = vb.byteLength;
    // Live previews: decoder-space latents to RGB, up to 1024 x 1024 (128 x 128 latent pixels).
    this.preview = await createWebGpuLatentPreview({ device: this.device, channels: 32, weights: LATENT_PREVIEW_WEIGHTS,
      bias: LATENT_PREVIEW_BIAS, kernel: LATENT_PREVIEW_FIT.kernel ?? 1, maxPixels: 128 * 128 });
    await this.precompile({ runWarmup });
    // Lean: the first generation needs the text encoder, so it takes the transformer's place now
    // (downloading it on a first visit).
    if (lean) await this.useWeights('textEncoder', fetchBundle(te, 'text-encoder'));
    this.timings.loadMs = performance.now() - t0;
  }

  // Swap the transformer for the one at `url` (another quantization level); the text encoder,
  // decoder and tokenizer stay. The old weights are freed first so two transformers are never
  // resident together; if loading fails there is no transformer until a later swap succeeds.
  // onProgress(part, name, { loadedBytes, totalBytes }) as for load(); returns the load stats.
  async loadTransformer(url, onProgress = () => {}) {
    this.assertUsable();
    const manifest = await getJson(`${url}/manifest.json`);
    const totalBytes = Object.values(manifest.bundles).reduce((sum, b) => sum + transferBytes(b), 0);
    const stats = { totalBytes, cachedBytes: 0, downloadedBytes: 0, cacheErrors: [] };
    this.transformer?.destroy(); this.transformer = null; this.residentBytes.transformer = 0;
    // Lean residency never holds the text encoder and a transformer together.
    if (this.residency === 'lean' && this.textEncoder?.weightsResident) { this.textEncoder.unloadWeights(); this.residentBytes.textEncoder = 0; }
    const next = this.createTransformer(manifest);
    Object.assign(next, this.kernels); next.sched = this.sched;
    let loadedBytes = 0, bytes = 0;
    try {
      await next.loadBundles((file, bundle) => getWeightBytes(`${url}/${file}`, { sha256: bundle.sha256, bytes: bundle.bytes, gzip: bundle.gzip,
        onBytes: n => { loadedBytes += n; onProgress('transformer', file, { loadedBytes, totalBytes }); } }, stats), (n, b) => { bytes += b; });
    } catch (e) { next.destroy(); throw e; }
    this.transformer = next; this.ditManifest = manifest; this.urls.transformerUrl = url;
    this.residentBytes.transformer = bytes;
    await this.precompile();
    return stats;
  }

  // What this device's buffer limits allow at a size: the most prompt tokens the transformer can
  // pad to (its largest buffer, the fused projection, grows with image plus prompt tokens), and
  // whether the decoder fits. Phones commonly allow 128 MiB per storage binding, which at 512 × 512
  // leaves about 189 prompt tokens and rules out 768 and above.
  sizeLimits(width, height = width) {
    const cap = Math.min(this.device.limits.maxStorageBufferBindingSize, this.device.limits.maxBufferSize);
    const { D, F } = this.transformer, imgTokens = (width / 16) * (height / 16);
    const maxTextTokens = Math.min(this.maxPromptTokens, Math.floor(cap / ((3 * D + 2 * F) * 4)) - imgTokens);
    const vaeAct = this.kernels.vaeActType === 'f16' ? 2 : 4, latentPixels = (width / 8) * (height / 8);
    // The decoder's attention scores are chunked by query rows (at least 64 at a time).
    const decoderFits = width * height * 256 * vaeAct <= cap && 64 * latentPixels * 4 <= cap;
    return { maxTextTokens, fits: decoderFits && maxTextTokens >= 32, cap };
  }

  // Model hooks: FLUX.2 Klein's choices here; another model on the same kernels and decoder (FLUX.3
  // Klein's Flux3Pipeline) overrides them.
  get maxPromptTokens() { return 512; }
  createTransformer(manifest) { return new KleinTransformer(this.device, manifest); }
  // The text length a generation asks for before device limits: the reference's padding (512) or
  // 'fitN', the prompt's own length plus N padding tokens.
  requestedTextTokens(prompt, textLength) {
    return /^fit\d*$/.test(String(textLength))
      ? Math.min(512, this.framePrompt(prompt).length + Number(String(textLength).slice(3) || 0)) : Number(textLength);
  }
  // { inputIds, attentionMask, length[, positionIds] } padded to maxLength (default the model's own padding).
  framePrompt(prompt, maxLength) { return this.tokenizer.kleinPromptIds(prompt, maxLength); }
  // Transformer RoPE ids for the latent grid and the text tokens.
  tokenIds(latH, latW, txtTokens) {
    const imgIds = new Float64Array(latH * latW * 4), txtIds = new Float64Array(txtTokens * 4);
    for (let h = 0; h < latH; h++) for (let w = 0; w < latW; w++) { const r = (h * latW + w) * 4; imgIds[r + 1] = h; imgIds[r + 2] = w; }
    for (let l = 0; l < txtTokens; l++) txtIds[l * 4 + 3] = l;
    return { imgIds, txtIds };
  }
  // { sigmas: [steps + 1], forwardArgs(i) }: the Euler sigmas and the transformer's per-step inputs.
  denoiseSchedule(imgTokens, steps) {
    const sched = kleinSchedule(imgTokens, steps);
    return { sigmas: sched.sigmas, forwardArgs: i => ({ tModel: transformerTime(sched.timesteps[i]) }) };
  }

  // Encode a live preview of the current step (before the Euler update, which overwrites the
  // latents), submit it, and hand the image to onPreview when its readback lands; the run does not
  // wait for it. Dry runs record and warm the pipeline without a readback.
  async encodePreview(sigma, latH, latW, step, steps, onPreview) {
    const pixels = latH * 2 * latW * 2;
    if (this.previewInput?.size !== pixels * 32 * 4) {
      this.previewInput?.destroy();
      this.previewInput = this.device.createBuffer({ size: pixels * 32 * 4, usage: GPUBufferUsage.STORAGE });
    }
    const a = this.transformer.act;
    this.vae.prepPreview(this.sched, a.latents, a.velocity, sigma, latH, latW, this.previewInput);
    if (this.collecting) return;
    const take = this.preview.encode(this.sched.encoder(), this.previewInput, { width: latW * 2, height: latH * 2 });
    await this.sched.boundary(`preview[${step}]`, { force: true });
    const read = take?.();
    if (onPreview) read?.then(image => onPreview({ ...image, step, steps }), () => {});
    else await read; // the warm-up generation: dispatch once, then free the slot
  }

  // Release every GPU buffer this pipeline owns: both models' weights and activations, the decoder's
  // weights and working memory, the live-preview resources and the prompt cache. The device belongs
  // to the caller and stays usable for its own work or another model. Waits for submitted work, and
  // is a no-op the second time; generate() and the loaders refuse afterwards.
  async destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    try { await this.sched.discard(); } catch { /* nothing unsubmitted to drop */ }
    await this.device.queue.onSubmittedWorkDone?.();
    for (const model of [this.textEncoder, this.transformer, this.vae]) model?.destroy();
    this.preview?.destroy(); this.previewInput?.destroy(); this.promptCache?.buffer?.destroy();
    this.textEncoder = this.transformer = this.vae = this.preview = this.previewInput = this.promptCache = null;
    this.residentBytes = {};
  }

  assertUsable() { if (this.destroyed) throw new Error('this KleinPipeline has been destroyed'); }

  // Lean residency: make `which` ('textEncoder' or 'transformer') the resident model, freeing the
  // other's weights first. Encoded work is submitted before anything is freed. Weights come from
  // the browser cache (or the network if the cache was cleared). Returns milliseconds spent.
  async useWeights(which, fetchBundle = null) {
    const model = this[which], other = which === 'textEncoder' ? this.transformer : this.textEncoder;
    if (model.weightsResident) return 0;
    const t0 = performance.now();
    await this.sched.flush(`swap.${which}`);
    if (other?.weightsResident) { other.unloadWeights(); this.residentBytes[which === 'textEncoder' ? 'transformer' : 'textEncoder'] = 0; }
    const root = which === 'textEncoder' ? this.urls.textEncoderUrl : this.urls.transformerUrl;
    const stats = { cachedBytes: 0, downloadedBytes: 0, cacheErrors: [] };
    const fetchFrom = fetchBundle ?? ((file, bundle) => getWeightBytes(`${root}/${file}`, { sha256: bundle.sha256, bytes: bundle.bytes, gzip: bundle.gzip }, stats));
    let bytes = 0;
    const upload = () => model.loadBundles(fetchFrom, (n, b) => { bytes += b; });
    // In a cooperative run the reload is not a duty, so it runs as a foreground window: the
    // renderer keeps getting frames while the weights stream in from the cache.
    const withForeground = this.sched.schedule?.withForeground;
    if (withForeground) await withForeground('klein-weight-swap', upload); else await upload();
    this.residentBytes[which] = bytes;
    return performance.now() - t0;
  }

  // Compile every GPU pipeline a generation uses before the first one runs. A tiny dry generation
  // (64x64, one step, zero embeddings, nothing dispatched) records each pipeline the code would
  // create; they are then compiled with createComputePipelineAsync, off the GPU process's main
  // thread, so a page's rendering does not stall the way it does when pipelines are compiled
  // synchronously at first use. Returns the number of pipelines compiled.
  async precompile({ runWarmup = work => work() } = {}) {
    const t0 = performance.now();
    const collected = new Map(), models = [this.textEncoder, this.transformer, this.vae];
    for (const m of models) m.pipelineCollector = collected;
    const stubbed = [this.textEncoder, this.transformer].filter(m => !m.weightsResident);
    for (const m of stubbed) m.stubWeights();
    this.collecting = true;
    try {
      await this.generateScheduled({ prompt: 'x', seed: 0, width: 64, height: 64, steps: 1, textLength: 'fit0', dry: true });
    } finally {
      for (const m of models) m.pipelineCollector = null;
      for (const m of stubbed) m.weights = {};
      this.collecting = false;
      // The dry run tracked uniforms without encoding any dispatch; drop them so the next
      // generation starts with a clean scheduler.
      await this.sched.discard();
    }
    // Keyed by model and pipeline name: the models reuse some names (softmax, swiglu, GEMM keys) for
    // their own caches, and each cache needs its own entry.
    await Promise.all([...collected.values()].map(async ({ owner, key, code }) => {
      const p = await this.device.createComputePipelineAsync({ layout: 'auto', compute: { module: this.device.createShaderModule({ code }), entryPoint: 'main' } });
      p.label = key; owner.pipelines[key] = p;
    }));
    // Run the same tiny generation once on the GPU, so each pipeline's first dispatch happens
    // here rather than as a long stall at the start of the visitor's first image.
    // The application owns admission for actual GPU execution. Downloads, the dry
    // collection pass and asynchronous compilation don't reserve the foreground run.
    await runWarmup(async () => {
      const t1 = performance.now();
      try {
        await this.generateScheduled({ prompt: 'x', seed: 0, width: 64, height: 64, steps: 1, textLength: 'fit0', dry: true });
        await this.sched.flush('warm');
      } catch (error) { await this.sched.discard(); throw error; }
      this.sched.stats.history.length = 0;
      this.timings.warmMs = performance.now() - t1;
    });
    this.timings.precompileMs = performance.now() - t0; this.timings.precompiledPipelines = collected.size;
    return collected.size;
  }

  async fetchEmbeddingRows(ids) {
    const { textEncoderUrl: te } = this.urls; const { file, row_bytes: rb } = this.teManifest.embedding;
    return new Map(await Promise.all(ids.map(async id => {
      const r = await fetchNamed(`${te}/${file}`, { headers: { Range: `bytes=${id * rb}-${(id + 1) * rb - 1}` } });
      if (r.status !== 206) throw new Error(`embedding range request returned ${r.status}`);
      const b = await r.arrayBuffer(); if (b.byteLength !== rb) throw new Error('short embedding row');
      return [id, b];
    })));
  }

  // Returns { rgba: Uint8ClampedArray, width, height, timings, duties }.
  // `schedule` (optional) runs the image as kit command duties: { runtime, invocation, control,
  // signal, targetDutyMs, onDuty }. Without it the run is uncooperative but still submits per block.
  // textLength: the number of text tokens the prompt is padded to; 512 as in the reference pipeline,
  // or 'fitN' for the prompt's own length plus N padding tokens (fewer tokens for the transformer).
  // onPreview({ width, height, rgba, step, steps }), if given, receives a rough image after each step:
  // the clean-image estimate at latent resolution (an eighth of the output), mapped linearly to RGB.
  async generate({ prompt, seed = 0, width = 512, height = 512, steps = 4, textLength = 512, onStep = null, onPhase = null, onPreview = null, schedule = null }) {
    this.assertUsable();
    this.sched.setSchedule(schedule);
    try {
      return await this.generateScheduled({ prompt, seed, width, height, steps, textLength, onStep, onPhase, onPreview });
    } catch (error) {
      await this.sched.discard();
      throw error;
    } finally {
      if (this.sched.cooperative) this.sched.setSchedule(null);
    }
  }

  async generateScheduled({ prompt, seed, width, height, steps, textLength = 512, onStep, onPhase, onPreview = null, dry = false }) {
    if (width % 16 || height % 16) throw new Error('width and height must be multiples of 16');
    if (!this.transformer) throw new Error('no transformer is loaded');
    const dev = this.device, t = {};
    const latH = height / 16, latW = width / 16, imgTokens = latH * latW;
    const requestedLength = this.requestedTextTokens(prompt, textLength);
    // Padding is capped where the device's buffer limits require it (better lettering on phones).
    const limits = this.sizeLimits(width, height);
    if (!limits.fits) throw new Error(`${width} × ${height} needs larger GPU buffers than this device allows (${Math.round(limits.cap / 2 ** 20)} MiB per buffer)`);
    const maxLength = Math.min(requestedLength, limits.maxTextTokens);
    if (this.framePrompt(prompt).length > maxLength) throw new Error(`the prompt is too long for this device's GPU buffers at ${width} × ${height}; shorten it or pick a smaller size`);
    if (maxLength < requestedLength) t.textPaddingRequested = requestedLength;
    const framed = this.framePrompt(prompt, maxLength);
    const txtTokens = framed.inputIds.length;
    // Sequential residency: transformer activations exist from here until the decoder's input is
    // prepared, decoder activations from then until the image is read back, so peak activation
    // memory is the larger stage rather than the sum (about 3 GB plus 5 GB at 1024²).
    this.transformer.allocate(imgTokens, txtTokens);
    // Per-row RoPE positions (when the model places its padding specially) depend on the prompt's length.
    const teKey = framed.positionIds ? `${txtTokens}:${framed.length}` : txtTokens;
    if (this.textEncoderTokens !== teKey) { this.textEncoder.allocate(txtTokens, framed.positionIds ?? null); this.textEncoderTokens = teKey; }
    const { imgIds, txtIds } = this.tokenIds(latH, latW, txtTokens);
    this.transformer.prepare({ latents: gaussianNoise(imgTokens * 128, seed), promptEmbeds: null, imgIds, txtIds });

    // The text encoding depends only on the prompt and its padding, so a re-roll with a new seed reuses
    // it from the last generation instead of running the text encoder again.
    let t0 = performance.now();
    const promptKey = `${maxLength}\u0000${prompt}`;
    const embedBytes = txtTokens * this.transformer.cfg.joint_attention_dim * 4;
    const lean = this.residency === 'lean';
    const cachedPrompt = !dry && this.promptCache?.key === promptKey;
    if (lean && !dry && !cachedPrompt) { onPhase?.('weights'); t.swapMs = (t.swapMs ?? 0) + await this.useWeights('textEncoder'); }
    onPhase?.('text');
    if (dry) {
      // Lean residency warms up with the transformer resident (the prompt input stays zero), but
      // the recording pass still walks the text encoder over its stub weights.
      if (this.collecting || this.textEncoder.weightsResident) await this.textEncoder.encode(new Float32Array(txtTokens * this.teManifest.config.hidden_size), framed.attentionMask, this.transformer.act.promptEmbeds);
    } else if (cachedPrompt) {
      this.sched.encoder().copyBufferToBuffer(this.promptCache.buffer, 0, this.transformer.act.promptEmbeds, 0, embedBytes);
      t.embeddingFetchMs = 0; t.textEncodeMs = 0; t.textCached = true;
    } else {
      const emb = await gatherEmbeddings([...framed.inputIds], this.teManifest.config.hidden_size, ids => this.fetchEmbeddingRows(ids));
      t.embeddingFetchMs = performance.now() - t0;
      t0 = performance.now();
      await this.textEncoder.encode(emb, framed.attentionMask, this.transformer.act.promptEmbeds);
      t.textEncodeMs = performance.now() - t0;
      if (this.promptCache?.buffer.size !== embedBytes) {
        this.promptCache?.buffer.destroy();
        this.promptCache = { key: null, buffer: dev.createBuffer({ size: embedBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST }) };
      }
      // The key is set only when this generation completes, so a failed run never leaves a key
      // pointing at a copy that was not submitted.
      this.promptCache.key = null;
      this.sched.encoder().copyBufferToBuffer(this.transformer.act.promptEmbeds, 0, this.promptCache.buffer, 0, embedBytes);
    }

    if (lean && !this.transformer.weightsResident) { onPhase?.('weights'); t.swapMs = (t.swapMs ?? 0) + await this.useWeights('transformer'); }
    const sched = this.denoiseSchedule(imgTokens, steps);
    onPhase?.('denoise');
    t.stepMs = [];
    for (let i = 0; i < steps; i++) {
      t0 = performance.now();
      await this.transformer.forward(sched.forwardArgs(i));
      if (onPreview || dry) await this.encodePreview(sched.sigmas[i], latH, latW, i + 1, steps, onPreview);
      await this.transformer.eulerStep(Math.fround(sched.sigmas[i + 1] - sched.sigmas[i]));
      t.stepMs.push(performance.now() - t0);
      onStep?.(i + 1, steps);
    }
    t0 = performance.now();
    onPhase?.('decode');
    this.vae.allocateInput(latH, latW);
    this.vae.prepLatents(this.vae.sched, this.transformer.act.latents);
    await this.sched.flush('vae.input');
    this.transformer.release();
    this.vae.allocate(latH, latW);
    await this.vae.decode(this.vae.prepped);
    if (dry) { this.vae.release(); return null; }
    let enc;
    const bytes = width * height * 3 * 4;
    const rb = dev.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    enc = dev.createCommandEncoder(); enc.copyBufferToBuffer(this.vae.out, 0, rb, 0, bytes); dev.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const rgb = new Float32Array(rb.getMappedRange().slice(0)); rb.unmap(); rb.destroy();
    this.vae.release();
    t.vaeDecodeMs = performance.now() - t0;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      for (let c = 0; c < 3; c++) rgba[i * 4 + c] = Math.round(Math.min(1, Math.max(0, rgb[i * 3 + c] / 2 + 0.5)) * 255);
      rgba[i * 4 + 3] = 255;
    }
    t.totalMs = t.embeddingFetchMs + t.textEncodeMs + (t.swapMs ?? 0) + t.stepMs.reduce((a, b) => a + b, 0) + t.vaeDecodeMs;
    const duties = this.sched.stats.history.splice(0);
    this.promptCache.key = promptKey;
    return { rgba, width, height, timings: t, promptTokens: framed.length, textTokens: txtTokens, duties };
  }
}
