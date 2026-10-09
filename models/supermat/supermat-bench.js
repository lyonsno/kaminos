// Op microbenchmark for SuperMat kernel variants on representative shapes.
// Each variant's output is compared with the baseline F32 64x64 kernel on the
// same random inputs, so a faster variant cannot hide a wrong answer.
import { compareWebGpuParityArrays, requestBrowserWebGpuDevice } from '../../webgpu-inference-kit/src/core.js';
import { createSuperMatOps } from './supermat-ops.js';

// IEEE binary16 bits from float32, round to nearest even.
export function float32ToFloat16Bits(value) {
  const f32 = new Float32Array([value]), u32 = new Uint32Array(f32.buffer)[0];
  const sign = (u32 >>> 16) & 0x8000, exponent = (u32 >>> 23) & 0xff, mantissa = u32 & 0x7fffff;
  if (exponent === 0xff) return sign | 0x7c00 | (mantissa ? 0x200 : 0);
  let e = exponent - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    const m = (mantissa | 0x800000) >>> (1 - e);
    const round = (m & 0x1fff) > 0x1000 || ((m & 0x1fff) === 0x1000 && (m & 0x2000));
    return sign | ((m >>> 13) + (round ? 1 : 0));
  }
  let half = sign | (e << 10) | (mantissa >>> 13);
  const rest = mantissa & 0x1fff;
  if (rest > 0x1000 || (rest === 0x1000 && (half & 1))) half++;
  return half;
}

function random(count, seed, scale = 1) {
  const out = new Float32Array(count);
  let x = seed >>> 0;
  for (let i = 0; i < count; i++) {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    out[i] = ((x / 4294967296) * 2 - 1) * scale;
  }
  return out;
}

function upload(device, values, { f16 = false, shape }) {
  let bytes;
  if (f16) {
    const halves = new Uint16Array(values.length + (values.length & 1));
    for (let i = 0; i < values.length; i++) halves[i] = float32ToFloat16Bits(values[i]);
    bytes = new Uint8Array(halves.buffer);
  } else bytes = new Uint8Array(values.buffer);
  const buffer = device.createBuffer({ size: Math.ceil(bytes.byteLength / 4) * 4, usage: 0x80 | 0x08 | 0x04 });
  device.queue.writeBuffer(buffer, 0, bytes);
  return { buffer, bufferOffset: 0, byteLength: buffer.size, shape, dtype: f16 ? 'f16' : 'f32' };
}

const CASES = [
  { id: 'decoder-conv-256ch-256px', kind: 'conv', cin: 256, cout: 256, size: 256 },
  { id: 'decoder-conv-128ch-512px', kind: 'conv', cin: 128, cout: 128, size: 512 },
  { id: 'unet-conv-320ch-64px', kind: 'conv', cin: 320, cout: 320, size: 64 },
  { id: 'unet-conv-1280ch-16px', kind: 'conv', cin: 1280, cout: 1280, size: 16 },
  { id: 'unet-geglu-proj-4096x320-to-2560', kind: 'linear', rows: 4096, cin: 320, cout: 2560 },
  { id: 'unet-self-attention-4096-5h', kind: 'attention', tokens: 4096, heads: 5 },
  { id: 'unet-self-attention-1024-10h', kind: 'attention', tokens: 1024, heads: 10 },
];

export const BENCH_VARIANTS = [
  { id: 't64-f32', gemmTile: { tm: 4, tn: 4, bk: 16 }, f16: false },
  { id: 't64-bk32', gemmTile: { tm: 4, tn: 4, bk: 32 }, f16: false },
  { id: 't64x128', gemmTile: { tm: 4, tn: 8, bk: 16 }, f16: false },
  { id: 't32x64', gemmTile: { tm: 2, tn: 4, bk: 16 }, f16: false },
  { id: 'attn-vec4', gemmTile: { tm: 4, tn: 4, bk: 16 }, f16: false, attentionKernel: 'vec4', attentionOnly: true },
];

export async function runSuperMatBench({ iterations = 6, variants = BENCH_VARIANTS, cases = CASES } = {}) {
  const result = { schema: 'supermat.kernel-bench.v0', status: 'failed', rows: [], iterations };
  const { device, backendIdentity } = await requestBrowserWebGpuDevice(navigator.gpu, { adapterName: 'supermat-bench' });
  result.adapter = backendIdentity;
  try {
    device.pushErrorScope('validation');
    for (const testCase of cases) {
      let baseline = null;
      for (const variant of variants) {
        if (testCase.kind === 'attention' && variant.f16) continue;
        if (variant.attentionOnly && testCase.kind !== 'attention') continue;
        const ops = createSuperMatOps(device, { label: `bench.${variant.id}`, gemmTile: variant.gemmTile,
          attentionKernel: variant.attentionKernel ?? 'scalar' });
        const inputs = [];
        let flops, run;
        if (testCase.kind === 'conv') {
          const { cin, cout, size } = testCase;
          const x = upload(device, random(cin * size * size, 7), { shape: [cin, size, size] });
          const weight = upload(device, random(cout * cin * 9, 11, 1 / Math.sqrt(cin * 9)), { f16: variant.f16, shape: [cout, cin, 3, 3] });
          const bias = upload(device, random(cout, 13), { shape: [cout] });
          inputs.push(x, weight, bias);
          flops = 2 * cout * cin * 9 * size * size;
          run = () => ops.conv2d({ x, shape: [cin, size, size], weight, bias });
        } else if (testCase.kind === 'linear') {
          const { rows, cin, cout } = testCase;
          const x = upload(device, random(rows * cin, 17), { shape: [rows, cin] });
          const weight = upload(device, random(cout * cin, 19, 1 / Math.sqrt(cin)), { f16: variant.f16, shape: [cout, cin] });
          inputs.push(x, weight);
          flops = 2 * rows * cin * cout;
          run = () => ops.gemm({ a: x, b: weight, M: rows, N: cout, K: cin, aSM: cin, aSK: 1, bSK: 1, bSN: cin,
            cSM: cout, cSN: 1, outShape: [rows, cout] });
        } else {
          const { tokens, heads } = testCase, channels = heads * 64;
          const [q, k, v] = [23, 29, 31].map(seed => upload(device, random(tokens * channels, seed), { shape: [tokens, channels] }));
          inputs.push(q, k, v);
          flops = 4 * tokens * tokens * 64 * heads;
          run = () => ops.flashAttention({ q, k, v, queries: tokens, keys: tokens, heads, scale: 0.125 });
        }
        let output = await run();
        await ops.flush();
        const values = await ops.read(output);
        ops.release(output);
        for (let i = 0; i < 2; i++) { ops.release(await run()); }
        await ops.flush();
        const start = performance.now();
        for (let i = 0; i < iterations; i++) ops.release(await run());
        await ops.flush();
        const ms = (performance.now() - start) / iterations;
        const row = { case: testCase.id, variant: variant.id, ms, gflops: flops / 1e9, tflops: flops / ms / 1e9 };
        if (!baseline) baseline = values;
        else {
          const m = compareWebGpuParityArrays(values, baseline).metrics;
          row.versusBaseline = { relativeL2: m.relativeL2Error, maxAbs: m.maxAbsoluteError };
        }
        result.rows.push(row);
        ops.destroy();
        for (const input of inputs) input.buffer.destroy();
      }
    }
    const error = await device.popErrorScope();
    if (error) throw new Error(`WebGPU validation error: ${error.message}`);
    result.status = 'passed';
  } catch (error) {
    result.error = `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`;
  } finally {
    device.destroy();
  }
  return result;
}
