// SuperMat single-image graph over model-owned ops. Mirrors the pinned source
// (SD 2.1 AutoencoderKL + SuperMat UNet with duplicated last up block) in F32.
// `capture(name, tensor)` receives the same boundary names the CPU reference
// records; the caller owns copies it makes.

export const VAE_SCALING_FACTOR = 0.18215;
const UNET_CHANNELS = [320, 640, 1280, 1280];
const UNET_HEADS = [5, 10, 20, 20];
const VAE_CHANNELS = [128, 256, 512, 512];
const UNET_EPS = 1e-5, TRANSFORMER_NORM_EPS = 1e-6, LAYER_NORM_EPS = 1e-5, VAE_EPS = 1e-6;

export function createWeightAccessor(tensors) {
  const get = name => {
    const tensor = tensors[name];
    if (!tensor) throw new Error(`missing SuperMat weight ${name}`);
    return tensor;
  };
  get.has = name => Boolean(tensors[name]);
  return get;
}

async function linear(ops, x, rows, weight, bias, { residual, name }) {
  const [out, inner] = weight.shape;
  return await ops.gemm({ a: x, b: weight, M: rows, N: out, K: inner, aSM: inner, aSK: 1, bSK: 1, bSN: inner,
    cSM: out, cSN: 1, biasN: bias, residual, outShape: [rows, out], name });
}

function concatChannels(ops, a, b, name) {
  const [c1, h, w] = a.shape, [c2] = b.shape;
  if (a.storage !== b.storage) throw new Error(`${name}: concat inputs must share storage`);
  const out = ops.alloc([c1 + c2, h, w], name, { dtype: a.storage });
  ops.copy(a, out, { size: a.byteLength });
  ops.copy(b, out, { destinationOffset: a.byteLength, size: b.byteLength });
  return out;
}

// GroupNorm(+SiLU) followed by a 3x3 conv. With ops.fuseNorm the normalization
// runs inside the conv's input loader; otherwise the normed tensor is
// materialized. Both paths compute the same function. The caller keeps x.
async function normConv(ops, x, { gamma, beta, eps, silu = true, normName, ...conv }) {
  if (ops.fuseNorm) return ops.conv2d({ x, shape: x.shape, norm: { gamma, beta, eps, silu }, ...conv });
  const normed = ops.groupNorm({ x, shape: x.shape, gamma, beta, eps, silu, name: normName, dtype: 'f32' });
  const out = await ops.conv2d({ x: normed, shape: normed.shape, ...conv });
  ops.release(normed);
  return out;
}

async function resnet(ops, w, prefix, x, { eps, tembSilu = null }) {
  const [c, h, wd] = x.shape;
  const conv1 = w(`${prefix}.conv1.weight`);
  let temb = null;
  if (tembSilu) {
    const proj = w(`${prefix}.time_emb_proj.weight`);
    temb = await linear(ops, tembSilu, 1, proj, w(`${prefix}.time_emb_proj.bias`), { name: `${prefix}.temb` });
  }
  const h1 = await normConv(ops, x, { gamma: w(`${prefix}.norm1.weight`), beta: w(`${prefix}.norm1.bias`), eps,
    normName: `${prefix}.norm1`, weight: conv1, bias: w(`${prefix}.conv1.bias`), biasM2: temb, name: `${prefix}.conv1` });
  await ops.yieldPoint(`${prefix}.conv1`);
  ops.release(temb);
  let shortcut = x;
  if (w.has(`${prefix}.conv_shortcut.weight`)) {
    shortcut = await ops.conv2d({ x, shape: [c, h, wd], weight: w(`${prefix}.conv_shortcut.weight`),
      bias: w(`${prefix}.conv_shortcut.bias`), kernel: 1, pad: [0, 0, 0, 0], name: `${prefix}.shortcut` });
  }
  const out = await normConv(ops, h1, { gamma: w(`${prefix}.norm2.weight`), beta: w(`${prefix}.norm2.bias`), eps,
    normName: `${prefix}.norm2`, weight: w(`${prefix}.conv2.weight`), bias: w(`${prefix}.conv2.bias`), residual: shortcut,
    name: `${prefix}.out` });
  ops.release(h1);
  if (shortcut !== x) ops.release(shortcut);
  await ops.yieldPoint(`${prefix}.conv2`);
  return out;
}

// Token-major multi-head attention: streaming online softmax by default,
// materialized F32 scores when ops are created with attention: 'materialized'.
async function attention(ops, w, prefix, xNorm, rows, channels, heads, { context = null, residual }) {
  const dh = channels / heads;
  const q = await linear(ops, xNorm, rows, w(`${prefix}.to_q.weight`), null, { name: `${prefix}.q` });
  const source = context ?? { tensor: xNorm, rows };
  const k = await linear(ops, source.tensor, source.rows, w(`${prefix}.to_k.weight`), null, { name: `${prefix}.k` });
  const v = await linear(ops, source.tensor, source.rows, w(`${prefix}.to_v.weight`), null, { name: `${prefix}.v` });
  const keys = source.rows;
  let mixed;
  if (ops.attentionMode === 'streaming' && dh === 64) {
    mixed = await ops.flashAttention({ q, k, v, queries: rows, keys, heads, scale: 1 / Math.sqrt(dh), name: `${prefix}.mixed` });
    ops.release(q);
    ops.release(k);
    ops.release(v);
  } else {
    const scores = await ops.gemm({ a: q, b: k, M: rows, N: keys, K: dh, batch: heads, alpha: 1 / Math.sqrt(dh),
      aSM: channels, aSK: 1, aSB: dh, bSK: 1, bSN: channels, bSB: dh, cSM: keys, cSN: 1, cSB: rows * keys,
      outShape: [heads, rows, keys], dtype: 'f32', name: `${prefix}.scores` });
    ops.release(q);
    ops.release(k);
    ops.softmax({ s: scores, rows: heads * rows, cols: keys });
    await ops.yieldPoint(`${prefix}.scores`);
    mixed = await ops.gemm({ a: scores, b: v, M: rows, N: dh, K: keys, batch: heads,
      aSM: keys, aSK: 1, aSB: rows * keys, bSK: channels, bSN: 1, bSB: dh, cSM: channels, cSN: 1, cSB: dh,
      outShape: [rows, channels], name: `${prefix}.mixed` });
    ops.release(scores);
    ops.release(v);
  }
  const out = await linear(ops, mixed, rows, w(`${prefix}.to_out.0.weight`), w(`${prefix}.to_out.0.bias`),
    { residual, name: `${prefix}.out` });
  ops.release(mixed);
  await ops.yieldPoint(`${prefix}.out`);
  return out;
}

async function transformer(ops, w, prefix, x, heads, context) {
  const [c, h, wd] = x.shape, rows = h * wd;
  const normed = ops.groupNorm({ x, shape: [c, h, wd], gamma: w(`${prefix}.norm.weight`), beta: w(`${prefix}.norm.bias`),
    eps: TRANSFORMER_NORM_EPS, name: `${prefix}.norm` });
  const pin = w(`${prefix}.proj_in.weight`);
  let t = await ops.gemm({ a: normed, b: pin, M: rows, N: c, K: c, aSM: 1, aSK: rows, bSK: 1, bSN: c, cSM: c, cSN: 1,
    biasN: w(`${prefix}.proj_in.bias`), outShape: [rows, c], name: `${prefix}.proj_in` });
  ops.release(normed);
  const block = `${prefix}.transformer_blocks.0`;
  const layer = (name, input) => ops.layerNorm({ x: input, rows, channels: c, gamma: w(`${block}.${name}.weight`),
    beta: w(`${block}.${name}.bias`), eps: LAYER_NORM_EPS, name: `${block}.${name}` });
  let n = layer('norm1', t);
  let next = await attention(ops, w, `${block}.attn1`, n, rows, c, heads, { residual: t });
  ops.release(n); ops.release(t); t = next;
  n = layer('norm2', t);
  next = await attention(ops, w, `${block}.attn2`, n, rows, c, heads, { context, residual: t });
  ops.release(n); ops.release(t); t = next;
  n = layer('norm3', t);
  const proj = await linear(ops, n, rows, w(`${block}.ff.net.0.proj.weight`), w(`${block}.ff.net.0.proj.bias`),
    { name: `${block}.ff.proj` });
  ops.release(n);
  const gated = ops.geglu({ x: proj, rows, inner: proj.shape[1] / 2, name: `${block}.ff.geglu` });
  ops.release(proj);
  next = await linear(ops, gated, rows, w(`${block}.ff.net.2.weight`), w(`${block}.ff.net.2.bias`),
    { residual: t, name: `${block}.ff.out` });
  ops.release(gated); ops.release(t); t = next;
  await ops.yieldPoint(`${block}.ff`);
  const pout = w(`${prefix}.proj_out.weight`);
  const out = await ops.gemm({ a: pout, b: t, M: c, N: rows, K: c, aSM: c, aSK: 1, bSK: 1, bSN: c, cSM: rows, cSN: 1,
    biasM: w(`${prefix}.proj_out.bias`), residual: x, outShape: [c, h, wd], name: `${prefix}.proj_out` });
  ops.release(t);
  await ops.yieldPoint(`${prefix}.proj_out`);
  return out;
}

// Single-head VAE mid-block attention in channel-major layout.
async function vaeAttention(ops, w, prefix, x) {
  const [c, h, wd] = x.shape, n = h * wd;
  const normed = ops.groupNorm({ x, shape: [c, h, wd], gamma: w(`${prefix}.group_norm.weight`),
    beta: w(`${prefix}.group_norm.bias`), eps: VAE_EPS, name: `${prefix}.norm` });
  const project = async name => await ops.gemm({ a: w(`${prefix}.${name}.weight`), b: normed, M: c, N: n, K: c, aSM: c, aSK: 1,
    bSK: n, bSN: 1, cSM: n, cSN: 1, biasM: w(`${prefix}.${name}.bias`), outShape: [c, n], name: `${prefix}.${name}` });
  const q = await project('to_q'), k = await project('to_k'), v = await project('to_v');
  ops.release(normed);
  await ops.yieldPoint(`${prefix}.qkv`);
  const scores = await ops.gemm({ a: q, b: k, M: n, N: n, K: c, alpha: 1 / Math.sqrt(c), aSM: 1, aSK: n, bSK: n, bSN: 1,
    cSM: n, cSN: 1, outShape: [n, n], dtype: 'f32', name: `${prefix}.scores` });
  ops.release(q); ops.release(k);
  ops.softmax({ s: scores, rows: n, cols: n });
  await ops.yieldPoint(`${prefix}.scores`);
  const mixed = await ops.gemm({ a: v, b: scores, M: c, N: n, K: n, aSM: n, aSK: 1, bSK: 1, bSN: n, cSM: n, cSN: 1,
    outShape: [c, n], name: `${prefix}.mixed` });
  ops.release(scores); ops.release(v);
  const out = await ops.gemm({ a: w(`${prefix}.to_out.0.weight`), b: mixed, M: c, N: n, K: c, aSM: c, aSK: 1, bSK: n, bSN: 1,
    cSM: n, cSN: 1, biasM: w(`${prefix}.to_out.0.bias`), residual: x, outShape: [c, h, wd], name: `${prefix}.out` });
  ops.release(mixed);
  await ops.yieldPoint(`${prefix}.out`);
  return out;
}

function step(ops, previous, next) {
  ops.release(previous);
  return next;
}

// image: [3, H, W] in [0, 1] (gray-composited). Returns latent [4, H/8, W/8] scaled by 0.18215.
export async function encodeImage(ops, w, image, { capture = () => {} } = {}) {
  const input = ops.affine({ x: image, shape: image.shape, scale: 2, shift: -1, name: 'vae.input' });
  let x = await ops.conv2d({ x: input, shape: input.shape, weight: w('vae.encoder.conv_in.weight'),
    bias: w('vae.encoder.conv_in.bias'), name: 'vae.encoder.conv_in' });
  ops.release(input);
  capture('vae.encoder.conv_in#0', x);
  await ops.yieldPoint('vae.encoder.conv_in');
  for (let b = 0; b < VAE_CHANNELS.length; b++) {
    for (let r = 0; r < 2; r++) {
      x = step(ops, x, await resnet(ops, w, `vae.encoder.down_blocks.${b}.resnets.${r}`, x, { eps: VAE_EPS }));
    }
    if (b < VAE_CHANNELS.length - 1) {
      x = step(ops, x, await ops.conv2d({ x, shape: x.shape, weight: w(`vae.encoder.down_blocks.${b}.downsamplers.0.conv.weight`),
        bias: w(`vae.encoder.down_blocks.${b}.downsamplers.0.conv.bias`), stride: 2, pad: [0, 0, 1, 1],
        name: `vae.encoder.down.${b}` }));
    }
    capture(`vae.encoder.down.${b}#0`, x);
    await ops.yieldPoint(`vae.encoder.down.${b}`);
  }
  x = step(ops, x, await resnet(ops, w, 'vae.encoder.mid_block.resnets.0', x, { eps: VAE_EPS }));
  x = step(ops, x, await vaeAttention(ops, w, 'vae.encoder.mid_block.attentions.0', x));
  x = step(ops, x, await resnet(ops, w, 'vae.encoder.mid_block.resnets.1', x, { eps: VAE_EPS }));
  capture('vae.encoder.mid#0', x);
  x = step(ops, x, await normConv(ops, x, { gamma: w('vae.encoder.conv_norm_out.weight'),
    beta: w('vae.encoder.conv_norm_out.bias'), eps: VAE_EPS, normName: 'vae.encoder.norm_out',
    weight: w('vae.encoder.conv_out.weight'), bias: w('vae.encoder.conv_out.bias'), name: 'vae.encoder.out' }));
  capture('vae.encoder.out#0', x);
  const moments = await ops.conv2d({ x, shape: x.shape, weight: w('vae.quant_conv.weight'), bias: w('vae.quant_conv.bias'),
    kernel: 1, pad: [0, 0, 0, 0], name: 'vae.quant' });
  ops.release(x);
  capture('vae.quant#0', moments);
  const [, h, wd] = moments.shape;
  // First 4 of the 8 moment channels (the mean), in the moments' own storage type.
  const mean = { buffer: moments.buffer, offset: 0, byteLength: moments.byteLength / 2, shape: [4, h, wd], storage: moments.storage };
  const latent = ops.affine({ x: mean, shape: [4, h, wd], scale: VAE_SCALING_FACTOR, name: 'latent' });
  ops.release(moments);
  return latent;
}

// latent: [4, h, w] in model-latent space (x0). Returns image [3, 8h, 8w] in [0, 1].
export async function decodeLatent(ops, w, latent, { capture = () => {}, call = 0 } = {}) {
  const z = ops.affine({ x: latent, shape: latent.shape, scale: 1 / VAE_SCALING_FACTOR, name: 'vae.decode.in' });
  capture(`vae.decode.in#${call}`, z);
  const image = await decodeScaledLatent(ops, w, z, { capture, call });
  ops.release(z);
  return image;
}

// z: decoder input (latent / 0.18215), [4, h, w]. The caller keeps ownership of z.
export async function decodeScaledLatent(ops, w, z, { capture = () => {}, call = 0 } = {}) {
  let x = await ops.conv2d({ x: z, shape: z.shape, weight: w('vae.post_quant_conv.weight'), bias: w('vae.post_quant_conv.bias'),
    kernel: 1, pad: [0, 0, 0, 0], name: 'vae.post_quant' });
  capture(`vae.post_quant#${call}`, x);
  x = step(ops, x, await ops.conv2d({ x, shape: x.shape, weight: w('vae.decoder.conv_in.weight'),
    bias: w('vae.decoder.conv_in.bias'), name: 'vae.decoder.conv_in' }));
  capture(`vae.decoder.conv_in#${call}`, x);
  x = step(ops, x, await resnet(ops, w, 'vae.decoder.mid_block.resnets.0', x, { eps: VAE_EPS }));
  x = step(ops, x, await vaeAttention(ops, w, 'vae.decoder.mid_block.attentions.0', x));
  x = step(ops, x, await resnet(ops, w, 'vae.decoder.mid_block.resnets.1', x, { eps: VAE_EPS }));
  capture(`vae.decoder.mid#${call}`, x);
  for (let b = 0; b < VAE_CHANNELS.length; b++) {
    for (let r = 0; r < 3; r++) {
      x = step(ops, x, await resnet(ops, w, `vae.decoder.up_blocks.${b}.resnets.${r}`, x, { eps: VAE_EPS }));
    }
    if (b < VAE_CHANNELS.length - 1) {
      x = step(ops, x, await ops.conv2d({ x, shape: x.shape, weight: w(`vae.decoder.up_blocks.${b}.upsamplers.0.conv.weight`),
        bias: w(`vae.decoder.up_blocks.${b}.upsamplers.0.conv.bias`), upsample: true, name: `vae.decoder.up.${b}` }));
    }
    capture(`vae.decoder.up.${b}#${call}`, x);
    await ops.yieldPoint(`vae.decoder.up.${b}`);
  }
  x = step(ops, x, await normConv(ops, x, { gamma: w('vae.decoder.conv_norm_out.weight'),
    beta: w('vae.decoder.conv_norm_out.bias'), eps: VAE_EPS, normName: 'vae.decoder.norm_out',
    weight: w('vae.decoder.conv_out.weight'), bias: w('vae.decoder.conv_out.bias'), name: 'vae.decoder.out' }));
  capture(`vae.decoder.out#${call}`, x);
  await ops.yieldPoint('vae.decoder.out');
  const image = ops.affine({ x, shape: x.shape, scale: 0.5, shift: 0.5, clamp01: true, name: 'vae.image', dtype: 'f32' });
  ops.release(x);
  return image;
}

// The t=999 sinusoid is a packaged source constant (`conditioning.time_proj`):
// re-deriving it in JS differs from torch's F32 exp by an ulp that t amplifies.
export async function timeEmbedding(ops, w, { capture = () => {} } = {}) {
  const sinusoid = w('conditioning.time_proj');
  const hidden = await linear(ops, sinusoid, 1, w('unet.time_embedding.linear_1.weight'), w('unet.time_embedding.linear_1.bias'),
    { name: 'unet.time.linear_1' });
  const activated = ops.affine({ x: hidden, shape: hidden.shape, silu: true, name: 'unet.time.silu' });
  ops.release(hidden);
  const temb = await linear(ops, activated, 1, w('unet.time_embedding.linear_2.weight'), w('unet.time_embedding.linear_2.bias'),
    { name: 'unet.temb' });
  ops.release(activated);
  capture('unet.temb#0', temb);
  const tembSilu = ops.affine({ x: temb, shape: temb.shape, silu: true, name: 'unet.temb.silu' });
  ops.release(temb);
  return tembSilu;
}

// latent: image latent [4, 64, 64]; context: {tensor [77, 1024], rows: 77}.
// Returns the two v predictions [albedo, orm], each [4, 64, 64].
export async function runUnet(ops, w, latent, context, tembSilu, { capture = () => {} } = {}) {
  let x = await ops.conv2d({ x: latent, shape: latent.shape, weight: w('unet.conv_in.weight'), bias: w('unet.conv_in.bias'),
    name: 'unet.conv_in' });
  capture('unet.conv_in#0', x);
  const skips = [x];
  for (let b = 0; b < 4; b++) {
    for (let r = 0; r < 2; r++) {
      let y = await resnet(ops, w, `unet.down_blocks.${b}.resnets.${r}`, x, { eps: UNET_EPS, tembSilu });
      if (b < 3) y = step(ops, y, await transformer(ops, w, `unet.down_blocks.${b}.attentions.${r}`, y, UNET_HEADS[b], context));
      skips.push(y);
      x = y;
    }
    if (b < 3) {
      x = await ops.conv2d({ x, shape: x.shape, weight: w(`unet.down_blocks.${b}.downsamplers.0.conv.weight`),
        bias: w(`unet.down_blocks.${b}.downsamplers.0.conv.bias`), stride: 2, name: `unet.down.${b}` });
      skips.push(x);
    }
    capture(`unet.down.${b}#0`, x);
    await ops.yieldPoint(`unet.down.${b}`);
  }
  x = await resnet(ops, w, 'unet.mid_block.resnets.0', x, { eps: UNET_EPS, tembSilu });
  x = step(ops, x, await transformer(ops, w, 'unet.mid_block.attentions.0', x, UNET_HEADS[3], context));
  x = step(ops, x, await resnet(ops, w, 'unet.mid_block.resnets.1', x, { eps: UNET_EPS, tembSilu }));
  capture('unet.mid#0', x);
  for (let b = 0; b < 3; b++) {
    for (let r = 0; r < 3; r++) {
      const skip = skips.pop();
      const joined = concatChannels(ops, x, skip, `unet.up.${b}.${r}.concat`);
      ops.release(x);
      ops.release(skip);
      x = await resnet(ops, w, `unet.up_blocks.${b}.resnets.${r}`, joined, { eps: UNET_EPS, tembSilu });
      ops.release(joined);
      if (b > 0) x = step(ops, x, await transformer(ops, w, `unet.up_blocks.${b}.attentions.${r}`, x, UNET_HEADS[3 - b], context));
    }
    x = step(ops, x, await ops.conv2d({ x, shape: x.shape, weight: w(`unet.up_blocks.${b}.upsamplers.0.conv.weight`),
      bias: w(`unet.up_blocks.${b}.upsamplers.0.conv.bias`), upsample: true, name: `unet.up.${b}` }));
    capture(`unet.up.${b}#0`, x);
    await ops.yieldPoint(`unet.up.${b}`);
  }
  const heads = [];
  for (let head = 0; head < 2; head++) {
    let y = x;
    for (let r = 0; r < 3; r++) {
      const joined = concatChannels(ops, y, skips[skips.length - 1 - r], `unet.last_up.${head}.${r}.concat`);
      if (y !== x) ops.release(y);
      y = await resnet(ops, w, `unet.last_up_blocks.${head}.resnets.${r}`, joined, { eps: UNET_EPS, tembSilu });
      ops.release(joined);
      y = step(ops, y, await transformer(ops, w, `unet.last_up_blocks.${head}.attentions.${r}`, y, UNET_HEADS[0], context));
    }
    capture(`unet.last_up.${head}#0`, y);
    const v = await normConv(ops, y, { gamma: w('unet.conv_norm_out.weight'), beta: w('unet.conv_norm_out.bias'),
      eps: UNET_EPS, normName: `unet.norm_out.${head}`, weight: w(`unet.rep_conv_out.${head}.weight`),
      bias: w(`unet.rep_conv_out.${head}.bias`), name: `unet.conv_out.${head}` });
    ops.release(y);
    capture(`unet.conv_out.${head}#0`, v);
    heads.push(v);
  }
  ops.release(x);
  for (const skip of skips) ops.release(skip);
  return heads;
}
