// FLUX.3 Klein transformer forward on WebGPU, text-to-image only.
// Mirrors diffusers Flux3Transformer2DModel (flow_map=True) without the reference-image mode:
// timestep and flow-map target embeddings, per-mode modulation, text and image per-mode blocks
// (each mode attends within itself), joint single blocks over [txt; img] with per-mode
// modulation, AdaLN output norm and projection. Every block is one LayerNorm feeding parallel
// attention and SwiGLU feed-forward, packed by pack-flux3-transformer.py as FLUX.2's single-stream
// layout: qkv_mlp [3D + 2F, D] and to_out [D, D + F]. The kernels and the GEMM/attention/duty
// machinery are FLUX.2 Klein's.
import { KleinTransformer, timestepProjection, ropeTable } from '../flux2-klein/klein-transformer.js';
import { LN_EPS, scoreHeads, qkvPrepShader, headsToRowsShader, siluShader, axpyShader } from '../flux2-klein/klein-kernels.js';

const HEAD = 128;
export const FLUX3_ROPE_THETA = 10000;
export const FLUX3_IMAGE_ROPE_SCALE = 0.5;

// (t=0, h*0.5, w*0.5, l=0) for each latent-grid token, row-major (Flux3 _prepare_image_ids).
export function flux3ImageIds(h, w) {
  const ids = new Float64Array(h * w * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; ids[i + 1] = y * FLUX3_IMAGE_ROPE_SCALE; ids[i + 2] = x * FLUX3_IMAGE_ROPE_SCALE;
  }
  return ids;
}

// (0, 0, 0, l) for each text token (Flux3 _prepare_text_ids).
export function flux3TextIds(n) {
  const ids = new Float64Array(n * 4);
  for (let l = 0; l < n; l++) ids[l * 4 + 3] = l;
  return ids;
}

export class Flux3Transformer extends KleinTransformer {
  allocate(imgTokens, txtTokens) {
    this.release();
    const D = this.D, F = this.F, H = this.H, L = imgTokens + txtTokens, W = 3 * D + 2 * F;
    const f = n => this.buffer(n * 4);
    // Attention runs over the text mode, the image mode and the joint sequence; the scores buffer
    // holds the largest head group any of them uses.
    const scores = Math.max(...[L, imgTokens, txtTokens].map(n => Math.min(H, scoreHeads(n)) * n * n));
    this.shape = { imgTokens, txtTokens, L };
    this.act = {
      latents: f(imgTokens * 128), promptEmbeds: f(txtTokens * this.cfg.joint_attention_dim),
      tproj: f(256), tmp: f(D), temb: f(D), target: f(D), tembImg: f(D), tembZero: f(D), siluImg: f(D), siluZero: f(D),
      mods: f(4 * 3 * D + 2 * D), // early img | early txt | single img | single txt | norm_out
      hs: f(L * D), norm: f(L * D), proj: f(L * W), rope: f(L * HEAD * 2),
      q: f(H * L * HEAD), k: f(H * L * HEAD), vt: f(H * L * HEAD), o: f(H * L * HEAD), scores: f(scores),
      cat: f(L * (D + F)), outNorm: f(imgTokens * D), velocity: f(imgTokens * 128),
    };
    this.modOff = { earlyImg: 0, earlyTxt: 3 * D, singleImg: 6 * D, singleTxt: 9 * D, out: 12 * D };
  }

  prepare({ latents, promptEmbeds, imgIds, txtIds }) {
    const dev = this.device, a = this.act;
    const { txtTokens: Lt, L } = this.shape;
    dev.queue.writeBuffer(a.latents, 0, latents);
    if (promptEmbeds) dev.queue.writeBuffer(a.promptEmbeds, 0, promptEmbeds);
    const allIds = new Float64Array(L * 4); allIds.set(txtIds, 0); allIds.set(imgIds, Lt * 4);
    dev.queue.writeBuffer(a.rope, 0, ropeTable(allIds, FLUX3_ROPE_THETA));
  }

  // QK-norm + RoPE + head split for `rows` rows of the projection starting at row `srcRow`;
  // `outRow` indexes the head-major Q/K/V^T of an attention over `L` tokens, `ropeRow` the RoPE table.
  qkvPrepAt(enc, srcRow, rows, outRow, ropeRow, L, normQ, normK, W) {
    const pipe = this.pipeline('qkvprep', qkvPrepShader());
    const u = this.uniform([rows, this.H, L, srcRow * W, W, outRow, ropeRow, this.f32bits(LN_EPS)]);
    const nq = { binding: 1, resource: { buffer: normQ.buf, offset: normQ.byteOff, size: normQ.bytes } };
    const nk = { binding: 2, resource: { buffer: normK.buf, offset: normK.byteOff, size: normK.bytes } };
    this.dispatch(enc, pipe, [{ binding: 0, resource: { buffer: this.act.proj } }, nq, nk,
      { binding: 3, resource: { buffer: this.act.rope } }, { binding: 4, resource: { buffer: this.act.q } },
      { binding: 5, resource: { buffer: this.act.k } }, { binding: 6, resource: { buffer: this.act.vt } },
      { binding: 7, resource: { buffer: u } }], rows, this.H);
  }

  // Attention output rows [0, rows) of an attention over L tokens into a.cat rows from dstRow.
  headsToCat(enc, L, rows, dstRow) {
    const pipe = this.pipeline('h2r', headsToRowsShader());
    this.dispatch(enc, pipe, [this.act.o, this.act.cat, this.uniform([L, this.H, this.D + this.F, 0, 0, rows, dstRow, 0])], rows, this.H);
  }

  // One block over hs rows [row0, row0 + rows) (one segment per mode, each with its own modulation
  // offset): modulated LayerNorm, fused qkv_mlp projection, attention over all the rows, SwiGLU,
  // fused output projection with a gated residual per segment.
  async block(enc, blk, segments, split) {
    const a = this.act, D = this.D, F = this.F, W = 3 * D + 2 * F;
    const row0 = segments[0].row, L = segments.reduce((n, s) => n + s.rows, 0);
    for (const s of segments) this.layerNormModulate(enc, a.hs, s.row * D, s.rows, a.norm, s.row * D, a.mods, s.mod, s.mod + D);
    await this.linear(enc, a.norm, L, this.w(blk, 'qkv_mlp'), a.proj, { aOff: row0 * D, cOff: row0 * W });
    this.qkvPrepAt(enc, row0, L, 0, row0, L, this.w(blk, 'norm_q'), this.w(blk, 'norm_k'), W);
    await split(`${blk}.qkv`);
    await this.attention(enc, L);
    this.headsToCat(enc, L, L, row0);
    this.swiglu(enc, a.proj, W, row0 * W + 3 * D, L, F, a.cat, D + F, row0 * (D + F) + D);
    for (const s of segments) {
      await this.linear(enc, a.cat, s.rows, this.w(blk, 'to_out'), a.hs,
        { aOff: s.row * (D + F), cOff: s.row * D, epilogue: 'gated-residual', gate: a.mods, gateOff: s.mod + 2 * D });
    }
  }

  // timestep embedding of t (in model units, sigma * 1000) through embedder `prefix` into `out`.
  async embedTime(enc, tModel, prefix, out) {
    const a = this.act, D = this.D;
    this.device.queue.writeBuffer(a.tproj, 0, timestepProjection(tModel));
    await this.linear(enc, a.tproj, 1, this.w('globals', `${prefix}_linear_1`), a.tmp);
    this.dispatch(enc, this.pipeline('silu', siluShader()), [a.tmp, a.siluImg], Math.ceil(D / 256));
    await this.linear(enc, a.siluImg, 1, this.w('globals', `${prefix}_linear_2`), out);
    // tproj is rewritten by the next call: submit what reads it first.
    await this.sched.flush(`temb.${prefix}`);
  }

  // `tModel`: this step's sigma * 1000; `targetModel`: the sigma this step jumps to, * 1000.
  async forward({ tModel, targetModel }, taps = null) {
    const a = this.act, D = this.D, enc = this.sched;
    const { imgTokens: Li, txtTokens: Lt, L } = this.shape;
    const silu = this.pipeline('silu', siluShader()), add = this.pipeline('axpy', axpyShader());
    const flush = async (name, buf, rows, cols, byteOffset = 0) => {
      if (taps) { await this.sched.flush(name); await taps(name, buf, rows, cols, byteOffset); return; }
      await this.sched.boundary(name, { force: !this.sched.cooperative });
    };
    const split = name => this.sched.boundary(name);
    const copy = (src, dst) => { const e = enc.encoder ? enc.encoder() : enc; e.copyBufferToBuffer(src, 0, dst, 0, D * 4); };

    // Per-mode conditioning: image tokens at t, text at 0, both plus the flow-map target embedding.
    await this.embedTime(enc, tModel, 'time', a.temb);
    copy(a.temb, a.tembImg);
    await this.embedTime(enc, 0, 'time', a.temb);
    copy(a.temb, a.tembZero);
    await this.embedTime(enc, targetModel, 'target', a.target);
    for (const t of [a.tembImg, a.tembZero]) this.dispatch(enc, add, [t, a.target, this.uniform([D, this.f32bits(1), 0, 0])], Math.ceil(D / 256));
    this.dispatch(enc, silu, [a.tembImg, a.siluImg], Math.ceil(D / 256));
    this.dispatch(enc, silu, [a.tembZero, a.siluZero], Math.ceil(D / 256));
    await flush('model/temb_img', a.tembImg, 1, D);
    await flush('model/temb_zero', a.tembZero, 1, D);
    const m = this.modOff;
    await this.linear(enc, a.siluImg, 1, this.w('globals', 'mod_early_img'), a.mods, { cOff: m.earlyImg });
    await this.linear(enc, a.siluZero, 1, this.w('globals', 'mod_early_txt'), a.mods, { cOff: m.earlyTxt });
    await this.linear(enc, a.siluImg, 1, this.w('globals', 'mod_single_img'), a.mods, { cOff: m.singleImg });
    await this.linear(enc, a.siluZero, 1, this.w('globals', 'mod_single_txt'), a.mods, { cOff: m.singleTxt });
    await this.linear(enc, a.siluImg, 1, this.w('globals', 'norm_out'), a.mods, { cOff: m.out });
    await flush('model/mods', a.mods, 1, 14 * D);

    // Embedders write the joint stream: text rows [0, Lt), image rows [Lt, L).
    await this.linear(enc, a.promptEmbeds, Lt, this.w('globals', 'context_embedder'), a.hs);
    await this.linear(enc, a.latents, Li, this.w('globals', 'x_embedder'), a.hs, { cOff: Lt * D });
    await flush('model/context_embedder', a.hs, Lt, D);
    await flush('model/x_embedder', a.hs, Li, D, Lt * D * 4);

    for (let i = 0; i < this.cfg.num_layers; i++) {
      const blk = `txt${String(i).padStart(2, '0')}`;
      await this.block(enc, blk, [{ row: 0, rows: Lt, mod: m.earlyTxt }], split);
      await flush(blk, a.hs, Lt, D);
    }
    for (let i = 0; i < this.cfg.num_layers; i++) {
      const blk = `img${String(i).padStart(2, '0')}`;
      await this.block(enc, blk, [{ row: Lt, rows: Li, mod: m.earlyImg }], split);
      await flush(blk, a.hs, Li, D, Lt * D * 4);
    }
    for (let i = 0; i < this.cfg.num_single_layers; i++) {
      const blk = `single${String(i).padStart(2, '0')}`;
      await this.block(enc, blk, [{ row: 0, rows: Lt, mod: m.singleTxt }, { row: Lt, rows: Li, mod: m.singleImg }], split);
      await flush(blk, a.hs, L, D);
    }

    // Flux3AdaLayerNorm: emb = [scale | shift] from silu(image temb); image rows only.
    this.layerNormModulate(enc, a.hs, Lt * D, Li, a.outNorm, 0, a.mods, m.out + D, m.out);
    await flush('model/norm_out', a.outNorm, Li, D);
    await this.linear(enc, a.outNorm, Li, this.w('globals', 'proj_out'), a.velocity);
    await this.sched.flush('epilogue');
    if (taps) await taps('velocity', a.velocity, Li, 128, 0);
  }
}
