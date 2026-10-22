// WiLoR hand detector (YOLOv8m-pose, classes left/right, 21 keypoints) on
// WebGPU, mirroring WiLoR-MLX's HandDetector: a 512x512 letterboxed RGB input
// in, the decoded (69, 5376) head out (cx, cy, w, h, two class scores, 21
// keypoints x/y/visibility per anchor, letterbox pixels). Convolutions use the
// kit's tiled GEMM with folded BatchNorm and SiLU; concatenations are channel
// slices of shared buffers, so C2f and SPPF never copy.
import { createStaticGraph, product, runAndRead } from '../mobrecon/static-graph.js';
import { DECODE, DETECTOR_SIZE, MAXPOOL5, UP_NEAREST } from './detector-kernels.js';

export const DETECTOR_ANCHORS = (DETECTOR_SIZE / 8) ** 2 + (DETECTOR_SIZE / 16) ** 2 + (DETECTOR_SIZE / 32) ** 2;
export const DETECTOR_OUTPUTS = 69;
const SILU = Object.freeze({ expression: 'value/(1.0+exp(-value))' });
// Downsampling Conv blocks (3x3, stride 2); every other convolution has stride 1.
const STRIDE_2 = new Set(['b0', 'b1', 'b3', 'b5', 'b7', 'h16', 'h19']);
// GEMM tiles from largest to smallest; each layer takes the largest that still
// launches `minWorkgroups` workgroups, so small 16x16 and 32x32 layers spread
// over the GPU instead of running on a handful of workgroups.
const TILES = [{ tm: 4, tn: 4, bk: 16 }, { tm: 2, tn: 4, bk: 16 }, { tm: 2, tn: 2, bk: 16 }, { tm: 1, tn: 2, bk: 16 }, { tm: 1, tn: 1, bk: 16 }];
// Provisional: best of a 0-1024 sweep on a contended shared GPU (diagnostic, not a benchmark).
export const DEFAULT_MIN_WORKGROUPS = 128;
export function chooseDetectorTile(M, N, minWorkgroups = DEFAULT_MIN_WORKGROUPS) {
  return TILES.find(t => Math.ceil(N / (16 * t.tn)) * Math.ceil(M / (16 * t.tm)) >= minWorkgroups) ?? TILES[TILES.length - 1];
}

export function createHandDetectorNetwork({ device, tensors, label = 'hand-detector', minWorkgroups = DEFAULT_MIN_WORKGROUPS }) {
  const graph = createStaticGraph({ device, tensors, label, missing: key => `missing hand detector tensor ${key}` });
  const { weight, weightResource, alloc, slice, name, whole, uniform, record, grid1, named, steps } = graph;

  // Conv block (k x k, stride s, same padding, folded BN, SiLU unless `act` is null).
  function conv(x, prefix, { out = null, act = SILU, residual = null } = {}) {
    const w = weight(`${prefix}.weight`), [cout, cin, kh, kw] = w.shape, [xc, h, wd] = x.shape;
    if (xc !== cin) throw new Error(`${prefix}: input has ${xc} channels, weight expects ${cin}`);
    const stride = STRIDE_2.has(prefix) ? 2 : 1;
    const oh = Math.ceil(h / stride), ow = Math.ceil(wd / stride);
    const y = out ?? alloc([cout, oh, ow], prefix);
    if (y.shape[0] !== cout || y.shape[1] !== oh || y.shape[2] !== ow) throw new Error(`${prefix}: output slot ${y.shape} vs ${[cout, oh, ow]}`);
    const tile = chooseDetectorTile(cout, oh * ow, minWorkgroups);
    const common = { M: cout, N: oh * ow, K: cin * kh * kw, a: { resource: weightResource(w), offset: 0, sm: cin * kh * kw, sk: 1 },
      c: { ...y, sm: oh * ow, sn: 1 }, biasM: weightResource(weight(`${prefix}.bias`)), activation: act, tile, tag: prefix,
      residual, residualAfterActivation: Boolean(residual) };
    if (kh === 1 && stride === 1) graph.gemm({ ...common, b: { resource: whole(x), offset: x.offset, sk: h * wd, sn: 1 } });
    else graph.gemm({ ...common, b: { resource: whole(x), offset: x.offset, sk: h, sn: wd, sb: ow }, conv: { kh, kw, stride }, pad: (kh - 1) / 2 });
    return y;
  }

  // C2f: cv1 into the head of one concat buffer, each bottleneck appends the
  // next chunk (residual from the previous chunk of the same buffer when
  // shortcut), cv2 over the whole buffer.
  function c2f(x, prefix, n, { shortcut, out = null }) {
    const [, h, wd] = x.shape, c = weight(`${prefix}.cv1.weight`).shape[0] / 2;
    const cat = alloc([(2 + n) * c, h, wd], `${prefix}:cat`);
    conv(x, `${prefix}.cv1`, { out: slice(cat, 0, 2 * c) });
    for (let i = 0; i < n; i++) {
      const input = slice(cat, (1 + i) * c, c);
      const mid = conv(input, `${prefix}.m.${i}.cv1`);
      conv(mid, `${prefix}.m.${i}.cv2`, { out: slice(cat, (2 + i) * c, c), residual: shortcut ? input : null });
    }
    return name(prefix, conv(cat, `${prefix}.cv2`, { out }));
  }

  function sppf(x, prefix, { out }) {
    const [, h, wd] = x.shape, c = weight(`${prefix}.cv1.weight`).shape[0];
    const cat = alloc([4 * c, h, wd], `${prefix}:cat`);
    conv(x, `${prefix}.cv1`, { out: slice(cat, 0, c) });
    for (let i = 0; i < 3; i++) {
      const words = [c, h, wd, slice(cat, i * c, c).offset, slice(cat, (i + 1) * c, c).offset, 0, 0, 0];
      record('maxpool5', MAXPOOL5, [{ buffer: uniform(words, `${prefix}:pool${i}`) }, whole(cat)], grid1(c * h * wd), `${prefix}:pool${i}`);
    }
    return name(prefix, conv(cat, `${prefix}.cv2`, { out }));
  }

  function upsample(x, out, tag) {
    const [c, h, wd] = x.shape;
    record('upNearest', UP_NEAREST, [{ buffer: uniform([c, h, wd, x.offset, out.offset, 0, 0, 0], tag) }, whole(x), whole(out)], grid1(c * 4 * h * wd), tag);
  }

  // ---- Graph ----
  const S = DETECTOR_SIZE;
  const input = alloc([3, S, S], 'input');
  const block = (x, key, options) => name(key, conv(x, key, options));
  const x2 = c2f(block(block(input, 'b0'), 'b1'), 'b2', 2, { shortcut: true });
  const catB = alloc([576, S / 8, S / 8], 'h15:input');      // [up(f12) 384, p3 192]
  const p3 = c2f(block(x2, 'b3'), 'b4', 4, { shortcut: true, out: slice(catB, 384, 192) });
  const catA = alloc([960, S / 16, S / 16], 'h12:input');    // [up(p5) 576, p4 384]
  const p4 = c2f(block(p3, 'b5'), 'b6', 4, { shortcut: true, out: slice(catA, 576, 384) });
  const catD = alloc([960, S / 32, S / 32], 'h21:input');    // [f19 384, p5 576]
  const p5 = sppf(c2f(block(p4, 'b7'), 'b8', 2, { shortcut: true }), 'b9', { out: slice(catD, 384, 576) });
  upsample(p5, slice(catA, 0, 576), 'up1');
  const catC = alloc([576, S / 16, S / 16], 'h18:input');    // [f16 192, f12 384]
  const f12 = c2f(catA, 'h12', 2, { shortcut: false, out: slice(catC, 192, 384) });
  upsample(f12, slice(catB, 0, 384), 'up2');
  const f15 = c2f(catB, 'h15', 2, { shortcut: false });
  name('h16', conv(f15, 'h16', { out: slice(catC, 0, 192) }));
  const f18 = c2f(catC, 'h18', 2, { shortcut: false });
  name('h19', conv(f18, 'h19', { out: slice(catD, 0, 384) }));
  const f21 = c2f(catD, 'h21', 2, { shortcut: false });

  const output = alloc([DETECTOR_OUTPUTS, DETECTOR_ANCHORS], 'output');
  let anchorOffset = 0;
  [f15, f18, f21].forEach((feature, level) => {
    const [, h, wd] = feature.shape;
    const head = alloc([129, h, wd], `pose.${level}`);
    const branch = (b, first, count) => {
      const t = conv(conv(feature, `pose.${b}.${level}.0`), `pose.${b}.${level}.1`);
      name(`pose.${b}.${level}`, conv(t, `pose.${b}.${level}.2`, { out: slice(head, first, count), act: null }));
    };
    branch('cv2', 0, 64);
    branch('cv3', 64, 2);
    branch('cv4', 66, 63);
    const stride = S / h;
    const params = uniform([h, wd, DETECTOR_ANCHORS, anchorOffset, 0, 0, 0, 0], `decode.${level}`, { 4: stride });
    record('decode', DECODE, [{ buffer: params }, whole(head), whole(output)], [Math.ceil((h * wd) / 64), 1, 1], `decode.${level}`);
    anchorOffset += h * wd;
  });
  name('output', output);

  let disposed = false;
  return Object.freeze({
    input, output, dispatchCount: steps.length,
    names: () => [...named.keys()],
    profile: () => graph.profile(),
    view: key => named.get(key) ?? null,
    encode(encoder) {
      if (disposed) throw new Error('hand detector network disposed');
      const pass = encoder.beginComputePass({ label: `${label}:network` });
      graph.encode(pass);
      pass.end();
    },
    // input: Float32Array [3, 512, 512] in [0, 1]; omit when a letterbox
    // kernel has already written `input`. Returns the decoded head output.
    async run({ input: values = null, capture = [] } = {}) {
      if (disposed) throw new Error('hand detector network disposed');
      if (values) {
        if (!(values instanceof Float32Array) || values.length !== product(input.shape)) throw new TypeError('Float32Array [3, 512, 512] input required');
        device.queue.writeBuffer(input.buffer, 0, values);
      }
      const reads = [['output', output], ...capture.map(key => {
        const view = named.get(key);
        if (!view) throw new Error(`no hand detector tensor named ${key}`);
        return [key, view];
      })];
      const got = await runAndRead(graph, encoder => this.encode(encoder), reads);
      const captures = {};
      for (const key of capture) captures[key] = got[key];
      return { output: got.output.data, captures };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      graph.dispose();
    },
  });
}
