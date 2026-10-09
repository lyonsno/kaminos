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

async function getJson(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); }
async function getBytes(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.arrayBuffer(); }

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
  constructor(device, { textEncoderUrl, transformerUrl, vaeUrl }) {
    this.device = device; this.urls = { textEncoderUrl, transformerUrl, vaeUrl };
    this.timings = {}; this.residentBytes = {};
  }

  async load(onProgress = () => {}) {
    const { textEncoderUrl: te, transformerUrl: dit, vaeUrl: vae } = this.urls;
    const t0 = performance.now();
    this.teManifest = await getJson(`${te}/manifest.json`);
    this.tokenizer = new QwenTokenizer(await getJson(`${te}/${this.teManifest.tokenizer.file}`));
    this.textEncoder = new KleinTextEncoder(this.device, this.teManifest);
    let bytes = 0;
    await this.textEncoder.loadBundles(f => getBytes(`${te}/${f}`), (n, b) => { bytes += b; onProgress('text-encoder', n); });
    this.residentBytes.textEncoder = bytes;
    this.ditManifest = await getJson(`${dit}/manifest.json`);
    this.transformer = new KleinTransformer(this.device, this.ditManifest);
    bytes = 0;
    await this.transformer.loadBundles(f => getBytes(`${dit}/${f}`), (n, b) => { bytes += b; onProgress('transformer', n); });
    this.residentBytes.transformer = bytes;
    this.vaeManifest = await getJson(`${vae}/manifest.json`);
    this.vae = new KleinVaeDecoder(this.device, this.vaeManifest);
    const vb = await getBytes(`${vae}/${this.vaeManifest.bundle.file}`);
    await this.vae.load(vb); this.residentBytes.vae = vb.byteLength;
    this.timings.loadMs = performance.now() - t0;
  }

  async fetchEmbeddingRows(ids) {
    const { textEncoderUrl: te } = this.urls; const { file, row_bytes: rb } = this.teManifest.embedding;
    return new Map(await Promise.all(ids.map(async id => {
      const r = await fetch(`${te}/${file}`, { headers: { Range: `bytes=${id * rb}-${(id + 1) * rb - 1}` } });
      if (r.status !== 206) throw new Error(`embedding range request returned ${r.status}`);
      const b = await r.arrayBuffer(); if (b.byteLength !== rb) throw new Error('short embedding row');
      return [id, b];
    })));
  }

  // Returns { rgba: Uint8ClampedArray, width, height, timings }.
  async generate({ prompt, seed = 0, width = 512, height = 512, steps = 4, onStep = null }) {
    if (width % 16 || height % 16) throw new Error('width and height must be multiples of 16');
    const dev = this.device, t = {};
    const latH = height / 16, latW = width / 16, imgTokens = latH * latW;
    const framed = this.tokenizer.kleinPromptIds(prompt);
    const txtTokens = framed.inputIds.length;
    if (this.shapeKey !== `${imgTokens}:${txtTokens}`) {
      this.transformer.allocate(imgTokens, txtTokens);
      this.textEncoder.allocate(txtTokens);
      this.vae.allocate(latH, latW);
      this.shapeKey = `${imgTokens}:${txtTokens}`;
    }
    const imgIds = new Float64Array(imgTokens * 4), txtIds = new Float64Array(txtTokens * 4);
    for (let h = 0; h < latH; h++) for (let w = 0; w < latW; w++) { const r = (h * latW + w) * 4; imgIds[r + 1] = h; imgIds[r + 2] = w; }
    for (let l = 0; l < txtTokens; l++) txtIds[l * 4 + 3] = l;
    this.transformer.prepare({ latents: gaussianNoise(imgTokens * 128, seed), promptEmbeds: null, imgIds, txtIds });

    let t0 = performance.now();
    const emb = await gatherEmbeddings([...framed.inputIds], this.teManifest.config.hidden_size, ids => this.fetchEmbeddingRows(ids));
    t.embeddingFetchMs = performance.now() - t0;
    t0 = performance.now();
    await this.textEncoder.encode(emb, framed.attentionMask, this.transformer.act.promptEmbeds);
    t.textEncodeMs = performance.now() - t0;

    const sched = kleinSchedule(imgTokens, steps);
    t.stepMs = [];
    for (let i = 0; i < steps; i++) {
      t0 = performance.now();
      await this.transformer.forward({ tModel: transformerTime(sched.timesteps[i]) });
      await this.transformer.eulerStep(Math.fround(sched.sigmas[i + 1] - sched.sigmas[i]));
      t.stepMs.push(performance.now() - t0);
      onStep?.(i + 1, steps);
    }
    t0 = performance.now();
    let enc = dev.createCommandEncoder();
    this.vae.prepLatents(enc, this.transformer.act.latents);
    this.vae.decode(enc, this.vae.prepped);
    dev.queue.submit([enc.finish()]);
    const bytes = width * height * 3 * 4;
    const rb = dev.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    enc = dev.createCommandEncoder(); enc.copyBufferToBuffer(this.vae.out, 0, rb, 0, bytes); dev.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const rgb = new Float32Array(rb.getMappedRange().slice(0)); rb.unmap(); rb.destroy();
    this.vae.releaseUniforms();
    t.vaeDecodeMs = performance.now() - t0;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      for (let c = 0; c < 3; c++) rgba[i * 4 + c] = Math.round(Math.min(1, Math.max(0, rgb[i * 3 + c] / 2 + 0.5)) * 255);
      rgba[i * 4 + 3] = 255;
    }
    t.totalMs = t.embeddingFetchMs + t.textEncodeMs + t.stepMs.reduce((a, b) => a + b, 0) + t.vaeDecodeMs;
    return { rgba, width, height, timings: t, promptTokens: framed.length };
  }
}
