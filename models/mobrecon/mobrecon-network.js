// MobRecon DenseStack + SpiralConv network on WebGPU: one normalized 128x128
// crop in, 778 mesh vertices and 21 crop-space landmarks out. The graph mirrors
// the pinned source module tree (cmr.models.mobrecon_densestack.MobRecon), with
// weights named by source module path and BatchNorm folded at packing time.
// Shapes are static, so every buffer, uniform and bind group is built once and
// a run is one compute pass of fixed dispatches.
import { createStaticGraph, product, runAndRead } from './static-graph.js';
import { KERNEL_PARAMS, SHADERS } from './mobrecon-kernels.js';

export const MOBRECON_INPUT_SIZE = 128;
export const MOBRECON_VERTICES = 778;
export const MOBRECON_LANDMARKS = 21;
const OUT_CHANNELS = [32, 64, 128, 256];
const LEVEL_VERTICES = [778, 389, 195, 98, 49];
const SPIRAL_LENGTH = 9;
const RELU = Object.freeze({ expression: 'max(value,0.0)' });
const HARDTANH_0_4 = Object.freeze({ expression: 'clamp(value,0.0,4.0)' });

// tensors: model-resource lease tensors by name ({ buffer, bufferOffset, byteLength, shape, dtype }).
export function createMobReconNetwork({ device, tensors, label = 'mobrecon' }) {
  const graph = createStaticGraph({ device, tensors, label, missing: key => `missing MobRecon tensor ${key}` });
  const { weight, weightResource, alloc, slice, name, whole, dummy, uniform, record, grid1, named, steps } = graph;
  const kernel = (kind, values, resources, threads, tag) => {
    const words = KERNEL_PARAMS[kind].map(field => values[field] ?? 0);
    record(kind, SHADERS[kind], [{ buffer: uniform(words, tag) }, ...resources], grid1(threads), tag);
  };
  // mobile_unit adds its residual after the ReLU.
  const gemm = args => graph.gemm({ ...args, residualAfterActivation: true });

  // 1x1 conv over [Cin, H, W] (plain GEMM: weight [Cout, Cin] x activation [Cin, HW]).
  function conv1x1(x, prefix, { activation = RELU, out = null, residual = null, bias = true } = {}) {
    const w = weight(`${prefix}.weight`), [cout, cin] = w.shape, [xc, h, wd] = x.shape;
    if (xc !== cin) throw new Error(`${prefix}: input has ${xc} channels, weight expects ${cin}`);
    const y = out ?? alloc([cout, h, wd], prefix);
    if (y.shape[0] !== cout) throw new Error(`${prefix}: output slot has ${y.shape[0]} channels, conv makes ${cout}`);
    const hw = h * wd;
    gemm({ M: cout, N: hw, K: cin, a: { resource: weightResource(w), offset: 0, sm: cin, sk: 1 },
      b: { resource: whole(x), offset: x.offset, sk: hw, sn: 1 }, c: { ...y, sm: hw, sn: 1 },
      biasM: bias ? weightResource(weight(`${prefix}.bias`)) : null, residual, activation, tag: prefix });
    return y;
  }

  // Linear over rows: x [rows, in] x W^T, W [out, in].
  function linear(x, prefix, { activation = null, bias = false } = {}) {
    const w = weight(`${prefix}.weight`), [out, inner] = w.shape, rows = x.shape[0];
    if (x.shape[1] !== inner) throw new Error(`${prefix}: input width ${x.shape[1]} vs weight ${inner}`);
    const y = alloc([rows, out], prefix);
    gemm({ M: rows, N: out, K: inner, a: { resource: whole(x), offset: x.offset, sm: inner, sk: 1 },
      b: { resource: weightResource(w), offset: 0, sk: 1, sn: inner }, c: { ...y, sm: out, sn: 1 },
      biasM: null, activation, bNContiguous: false, tag: prefix });
    if (bias) throw new Error(`${prefix}: row bias is not part of this graph`);
    return y;
  }

  function stemConv(x, prefix) {
    const w = weight(`${prefix}.weight`), [cout, cin, kh, kw] = w.shape, [, h, wd] = x.shape;
    const oh = h / 2, ow = wd / 2, y = alloc([cout, oh, ow], prefix);
    gemm({ M: cout, N: oh * ow, K: cin * kh * kw, a: { resource: weightResource(w), offset: 0, sm: cin * kh * kw, sk: 1 },
      b: { resource: whole(x), offset: x.offset, sk: h, sn: wd, sb: ow }, c: { ...y, sm: oh * ow, sn: 1 },
      biasM: weightResource(weight(`${prefix}.bias`)), activation: RELU, conv: { kh, kw, stride: 2 }, pad: 1, tag: prefix });
    return y;
  }

  function depthwise(x, prefix) {
    const [c, h, w] = x.shape, y = alloc([c, h, w], prefix);
    kernel('depthwise', { c, h, w, x_off: x.offset, y_off: y.offset },
      [whole(x), weightResource(weight(`${prefix}.weight`)), weightResource(weight(`${prefix}.bias`)), whole(y)], c * h * w, prefix);
    return y;
  }

  function mobileUnit(x, prefix, { cout, num3x3 = 1, out = null }) {
    let t = depthwise(x, `${prefix}.conv3x3.0`);
    if (num3x3 === 2) t = depthwise(t, `${prefix}.conv3x3.1`);
    const residual = x.shape[0] === cout ? x : null;
    return conv1x1(t, `${prefix}.conv1x1`, { out: out ?? alloc([cout, ...x.shape.slice(1)], prefix), residual });
  }

  // Dense blocks append unit outputs into one buffer whose prefix already holds x.
  function denseBlock(comb, cin, prefix, units) {
    let c = cin;
    units.forEach((cout, i) => {
      mobileUnit(slice(comb, 0, c), `${prefix}.conv${i + 1}`, { cout, out: slice(comb, c, cout) });
      c += cout;
    });
    return name(prefix, slice(comb, 0, c));
  }
  // DenseBlock2_noExpand: units cin -> 3cin/4 and 7cin/4 -> cin/4; output is [out1, out2].
  function denseNoExpand(comb, cin, prefix) {
    mobileUnit(slice(comb, 0, cin), `${prefix}.conv1`, { cout: (3 * cin) / 4, out: slice(comb, cin, (3 * cin) / 4) });
    mobileUnit(slice(comb, 0, (7 * cin) / 4), `${prefix}.conv2`, { cout: cin / 4, out: slice(comb, (7 * cin) / 4, cin / 4) });
    return name(prefix, slice(comb, cin, cin));
  }

  function senet(x, prefix) {
    const [c, h, w] = x.shape, r = weight(`${prefix}.fc1.weight`).shape[0];
    if (c > 1024 || r > 256) throw new Error(`${prefix}: SE gate sizes ${c}/${r} exceed the kernel`);
    const gate = alloc([c], `${prefix}:gate`);
    record('seSqueeze', SHADERS.seSqueeze, [{ buffer: uniform([c, h * w, r, x.offset], prefix) }, whole(x),
      weightResource(weight(`${prefix}.fc1.weight`)), weightResource(weight(`${prefix}.fc1.bias`)),
      weightResource(weight(`${prefix}.fc2.weight`)), weightResource(weight(`${prefix}.fc2.bias`)), whole(gate)], [1, 1, 1], `${prefix}:squeeze`);
    const y = alloc([c, h, w], prefix);
    kernel('channelScale', { c, hw: h * w, x_off: x.offset, y_off: y.offset }, [whole(x), whole(gate), whole(y)], c * h * w, prefix);
    return name(prefix, y);
  }

  function avgpool(x, prefix, out = null) {
    const [c, h, w] = x.shape, y = out ?? alloc([c, h / 2, w / 2], prefix);
    kernel('avgpool', { c, h, w, x_off: x.offset, y_off: y.offset, scaled: 0 }, [whole(x), { buffer: dummy }, whole(y)], c * (h / 2) * (w / 2), prefix);
    return name(prefix, y);
  }

  function upNearestAdd(x, skip, prefix) {
    const [c, h, w] = x.shape, y = alloc([c, 2 * h, 2 * w], prefix);
    kernel('upNearestAdd', { c, h, w, x_off: x.offset, skip_off: skip.offset, y_off: y.offset }, [whole(x), whole(skip), whole(y)], c * 4 * h * w, prefix);
    return y;
  }

  function upBilinear(x, prefix) {
    const [c, h, w] = x.shape, y = alloc([c, 2 * h, 2 * w], prefix);
    kernel('upBilinear', { c, h, w, x_off: x.offset, y_off: y.offset }, [whole(x), whole(y)], c * 4 * h * w, prefix);
    return name(prefix, y);
  }

  function copy(x, y, tag) {
    const count = product(x.shape);
    if (count !== product(y.shape)) throw new Error(`${tag}: copy size mismatch`);
    kernel('copy', { count, src_off: x.offset, dst_off: y.offset }, [whole(x), whole(y)], count, tag);
  }

  function denseStack(prefix, comb1, { second }) {
    const [, h] = comb1.shape;
    const B = alloc([512, h / 2, h / 2], `${prefix}.dense2:comb`), C = alloc([1024, h / 4, h / 4], `${prefix}.dense3:comb`);
    const d1 = avgpool(senet(denseBlock(comb1, 128, `${prefix}.dense1`, [64, 64]), `${prefix}.senet1`), `${prefix}.transition1`, slice(B, 0, 256));
    const d2 = avgpool(senet(denseBlock(B, 256, `${prefix}.dense2`, [64, 64, 64, 64]), `${prefix}.senet2`), `${prefix}.transition2`, slice(C, 0, 512));
    const dense3 = denseBlock(C, 512, `${prefix}.dense3`, [128, 128, 128, 128]);
    let deep;
    if (second) {
      const D = alloc([2048, h / 8, h / 8], `${prefix}.dense4:comb`), E = alloc([2048, h / 8, h / 8], `${prefix}.dense5:comb`);
      avgpool(senet(dense3, `${prefix}.senet3`), `${prefix}.transition3`, slice(D, 0, 1024));
      copy(denseNoExpand(D, 1024, `${prefix}.dense4`), slice(E, 0, 1024), `${prefix}.dense4:copy`);
      deep = denseNoExpand(E, 1024, `${prefix}.dense5`);
    } else {
      deep = avgpool(dense3, `${prefix}.transition3`);
    }
    let t = mobileUnit(deep, `${prefix}.thrink1.0`, { cout: 512 });
    t = name(`${prefix}.thrink1`, mobileUnit(t, `${prefix}.thrink1.1`, { cout: 512, num3x3: 2 }));
    const us1 = upNearestAdd(senet(t, `${prefix}.senet4`), d2, `${prefix}.us1`);
    t = mobileUnit(us1, `${prefix}.thrink2.0`, { cout: 256 });
    t = name(`${prefix}.thrink2`, mobileUnit(t, `${prefix}.thrink2.1`, { cout: 256, num3x3: 2 }));
    const us2 = upNearestAdd(senet(t, `${prefix}.senet5`), d1, `${prefix}.us2`);
    t = mobileUnit(us2, `${prefix}.thrink3.0`, { cout: 256 });
    t = name(`${prefix}.thrink3`, mobileUnit(t, `${prefix}.thrink3.1`, { cout: 24, num3x3: 2 }));
    const u3 = senet(t, `${prefix}.senet6`);
    if (second) return [name(`${prefix}#0`, u3), name(`${prefix}#1`, deep)];
    return name(prefix, upBilinear(u3, `${prefix}.upsample3`));
  }

  function gridSample(features, uv, tag) {
    const [c, h, w] = features.shape, points = uv.shape[0], y = alloc([points, c], tag);
    kernel('gridSample', { points, c, h, w, x_off: features.offset, uv_off: uv.offset, y_off: y.offset },
      [whole(features), whole(uv), whole(y)], points * c, tag);
    return name(tag, y);
  }

  function meshPool(x, level, tag) {
    const n = LEVEL_VERTICES[level], c = x.shape[1], y = alloc([n, c], tag);
    kernel('meshPool', { n, c, x_off: x.offset, y_off: y.offset }, [whole(x),
      weightResource(weight(`topology.up.${level}.index`)), weightResource(weight(`topology.up.${level}.weight`)), whole(y)], n * c, tag);
    return y;
  }

  function spiralConv(x, level, prefix, relu) {
    const w = weight(`${prefix}.weight`), [cout, k] = w.shape, [n, cin] = x.shape;
    if (k !== SPIRAL_LENGTH * cin || n !== LEVEL_VERTICES[level]) throw new Error(`${prefix}: spiral shape mismatch`);
    const y = alloc([n, cout], prefix);
    kernel('spiralConv', { n, cin, cout, seq: SPIRAL_LENGTH, x_off: x.offset, y_off: y.offset, relu: relu ? 1 : 0 },
      [whole(x), weightResource(weight(`topology.spiral.${level}`)), weightResource(w), weightResource(weight(`${prefix}.bias`)), whole(y)], n * cout, prefix);
    return y;
  }

  // ---- Graph ----
  const input = alloc([3, MOBRECON_INPUT_SIZE, MOBRECON_INPUT_SIZE], 'input');
  const stem = name('backbone.pre_layer.0', stemConv(input, 'backbone.pre_layer.0'));
  const pre = name('backbone.pre_layer', mobileUnit(stem, 'backbone.pre_layer.1', { cout: 128 }));
  const [pc, ph, pw] = pre.shape, reorg = alloc([pc * 4, ph / 2, pw / 2], 'backbone.reorg');
  kernel('reorg', { c: pc, h: ph, w: pw, x_off: pre.offset, y_off: reorg.offset }, [whole(pre), whole(reorg)], pc * ph * pw, 'backbone.reorg');
  name('backbone.reorg', reorg);
  const comb1 = alloc([256, ph / 2, pw / 2], 'backbone.dense_stack1.dense1:comb');
  const thrink = name('backbone.thrink', conv1x1(reorg, 'backbone.thrink', { out: slice(comb1, 0, 128) }));
  const stack1 = denseStack('backbone.dense_stack1', comb1, { second: false });
  const joined = alloc([152, ph / 2, pw / 2], 'backbone.input2');
  name('backbone.stack1_remap', conv1x1(stack1, 'backbone.stack1_remap', { out: slice(joined, 0, 24) }));
  copy(thrink, slice(joined, 24, 128), 'backbone.input2:thrink');
  const comb2 = alloc([256, ph / 2, pw / 2], 'backbone.dense_stack2.dense1:comb');
  name('backbone.thrink2', conv1x1(joined, 'backbone.thrink2', { out: slice(comb2, 0, 128) }));
  const [stack2Out, stack2Mid] = denseStack('backbone.dense_stack2', comb2, { second: true });
  const latent = name('backbone.mid_proj', conv1x1(stack2Mid, 'backbone.mid_proj', { activation: null, bias: false }));
  const heat = name('backbone.conv', conv1x1(stack2Out, 'backbone.conv', { activation: null, bias: false }));
  const rows = { ...heat, shape: [heat.shape[0], heat.shape[1] * heat.shape[2]] };
  const h1 = linear(rows, 'backbone.uv_reg.0', { activation: HARDTANH_0_4 });
  const h2 = linear(h1, 'backbone.uv_reg.1', { activation: HARDTANH_0_4 });
  const uv = name('backbone.uv_reg', linear(h2, 'backbone.uv_reg.2'));

  const sampled = gridSample(latent, uv, 'decoder3d.sampled');
  const up = weight('decoder3d.upsample'), [coarse, points] = up.shape, channels = OUT_CHANNELS[3];
  const lifted = alloc([coarse, channels], 'decoder3d.lifted');
  gemm({ M: coarse, N: channels, K: points, a: { resource: weightResource(up), offset: 0, sm: points, sk: 1 },
    b: { resource: whole(sampled), offset: sampled.offset, sk: channels, sn: 1 }, c: { ...lifted, sm: channels, sn: 1 }, tag: 'decoder3d.lifted' });
  name('decoder3d.lifted', lifted);
  let features = lifted;
  for (let i = 0; i < 4; i++) {
    const level = 3 - i;
    features = name(`decoder3d.de_layer.${i}`, spiralConv(meshPool(features, level, `decoder3d.de_layer.${i}:pool`), level, `decoder3d.de_layer.${i}.conv`, true));
  }
  const mesh = name('mesh_pred', spiralConv(features, 0, 'decoder3d.head', false));
  name('uv_pred', uv);

  let disposed = false;
  return Object.freeze({
    input, outputs: Object.freeze({ mesh, uv }), dispatchCount: steps.length,
    names: () => [...named.keys()],
    profile: () => graph.profile(),
    view: key => named.get(key) ?? null,
    faces: weight('topology.faces'),
    // Records the whole network into one compute pass of the caller's encoder.
    encode(encoder) {
      if (disposed) throw new Error('MobRecon network disposed');
      const pass = encoder.beginComputePass({ label: `${label}:network` });
      graph.encode(pass);
      pass.end();
    },
    // input: Float32Array [3, 128, 128] normalized as the source's base_transform;
    // omit it when a crop kernel has already written `input`. Returns mesh
    // [778 * 3], uv [21 * 2] and any captured named tensors.
    async run({ input: values = null, capture = [] } = {}) {
      if (disposed) throw new Error('MobRecon network disposed');
      if (values) {
        if (!(values instanceof Float32Array) || values.length !== product(input.shape)) throw new TypeError('Float32Array [3, 128, 128] input required');
        device.queue.writeBuffer(input.buffer, 0, values);
      }
      const reads = [['mesh', mesh], ['uv', uv], ...capture.map(key => {
        const view = named.get(key);
        if (!view) throw new Error(`no MobRecon tensor named ${key}`);
        return [key, view];
      })];
      const got = await runAndRead(graph, encoder => this.encode(encoder), reads);
      const captures = {};
      for (const key of capture) captures[key] = got[key];
      return { mesh: got.mesh.data, uv: got.uv.data, captures };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      graph.dispose();
    },
  });
}
