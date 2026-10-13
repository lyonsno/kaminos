// Classifier-free-guided drift over a UniMateDenoiser configured with
// B = 2 * prompts rows: [conditional rows..., unconditional rows...].
// Returns async (t, y) => v with y, v as Float32Array [prompts, J, 12, T];
// v = uncond + cfgScale * (cond - uncond) in float32, as upstream's
// ClassifierFreeSampleModel computes it.

// A GPU validation or out-of-memory error during an evaluation must fail the
// evaluation; otherwise the readback is zeros and the solver integrates nothing.
export async function withGpuErrorScope(device, fn) {
  device.pushErrorScope('out-of-memory');
  device.pushErrorScope('validation');
  let result;
  try { result = await fn(); } finally {
    const validation = await device.popErrorScope();
    const oom = await device.popErrorScope();
    const err = validation ?? oom;
    if (err) throw new Error(`UniMate drift evaluation failed on the GPU: ${err.message}`);
  }
  return result;
}

// A readback that is entirely zero means the evaluation never ran (a failed
// dispatch leaves the output buffer untouched); a real drift is never all zero.
export function assertEvaluated(out) {
  for (let i = 0; i < out.length; i++) if (out[i] !== 0) return;
  throw new Error('UniMate drift evaluation produced an all-zero output: the GPU work did not run');
}

export function createCfgDrift(device, denoiser, { prompts, cfgScale = 3 }) {
  const n = prompts * denoiser.J * denoiser.Fe * denoiser.T;
  if (denoiser.B !== 2 * prompts) throw new Error(`denoiser has ${denoiser.B} rows, expected ${2 * prompts}`);
  const staging = device.createBuffer({ size: 2 * n * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const x = new Float32Array(2 * n);
  const ts = new Array(2 * prompts);
  const scale = Math.fround(cfgScale);
  const drift = async (t, y) => {
    if (y.length !== n) throw new RangeError(`state has ${y.length} values, expected ${n}`);
    x.set(y, 0);
    x.set(y, n);
    denoiser.writeMotion(x);
    denoiser.writeTimesteps(ts.fill(t));
    await withGpuErrorScope(device, async () => {
      const enc = device.createCommandEncoder();
      denoiser.encodeForward(enc);
      enc.copyBufferToBuffer(denoiser.io.out, 0, staging, 0, 2 * n * 4);
      device.queue.submit([enc.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
    });
    const out = new Float32Array(staging.getMappedRange());
    try { assertEvaluated(out); } catch (e) { staging.unmap(); throw e; }
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const c = out[i], u = out[n + i];
      v[i] = Math.fround(u + Math.fround(scale * Math.fround(c - u)));
    }
    staging.unmap();
    drift.evaluations += 1;
    return v;
  };
  drift.evaluations = 0;
  return drift;
}
