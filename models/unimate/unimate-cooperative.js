// Cooperative execution for the UniMate denoiser on a kit route.
//
// CooperativeUniMateDenoiser tags every op with an estimated FLOP count so the
// command-duty scheduler (shared with the FLUX.2 [klein] port) can split one
// network evaluation into duties sized to measured GPU throughput. Each duty
// passes the inference control's pause/stop gate and lets pending foreground
// frames submit first. Without a schedule the same code submits one evaluation
// at once, matching the plain path.
//
// createCooperativeCfgDrift returns the classifier-free-guided drift
// (uncond + scale * (cond - uncond), float32) the dopri5 solver calls.

import { tensorFloat32Bytes } from './unimate-weights.js';
import { UniMateDenoiser } from './unimate-denoiser.js';
import { WebGpuCommandDutyScheduler } from '../../webgpu-inference-kit/src/command-duty-scheduler.js';
import { assertEvaluated } from './unimate-drift.js';

const SU = GPUBufferUsage;
const STORAGE = SU.STORAGE | SU.COPY_SRC | SU.COPY_DST;

function estimateFlops(kernel, fields) {
  const v = fields.map(([, x]) => x);
  switch (kernel) {
    case 'LINEAR': return 2 * v[0] * v[1] * v[2];
    case 'ATTN_SPATIAL': return 4 * v[0] * v[1] * v[3] * v[2] * v[2] * v[4];
    case 'ATTN_TEMPORAL': return 4 * v[0] * v[2] * v[3] * v[1] * v[1] * v[4];
    case 'ATTN_CROSS': return 4 * v[0] * v[1] * v[2] * v[3] * v[4];
    case 'RMSNORM_MOD': return 6 * v[0] * v[1];
    case 'QK_PREP': return 12 * v[0] * v[1] * v[2];
    default: return 2 * v[0];
  }
}

export class CooperativeUniMateDenoiser extends UniMateDenoiser {
  static async create(device, manifest, bytes) {
    const weights = new Map();
    for (const t of manifest.tensors) {
      const data = tensorFloat32Bytes(bytes, t);
      const size = Math.max(256, Math.ceil(data.byteLength / 256) * 256);
      const buffer = device.createBuffer({ size, usage: STORAGE, mappedAtCreation: true });
      new Uint8Array(buffer.getMappedRange()).set(data);
      buffer.unmap();
      weights.set(t.name, { buffer, shape: t.shape, byteLength: data.byteLength });
    }
    return new CooperativeUniMateDenoiser(device, manifest, weights);
  }

  op(kernel, bindings, fields, workgroups, label) {
    const step = super.op(kernel, bindings, fields, workgroups, label);
    step.flops = estimateFlops(kernel, fields);
    return step;
  }

  get forwardFlops() { return this.forwardProgram.reduce((s, x) => s + (x.flops ?? 0), 0); }

  // Encode a program through the scheduler, one compute pass per op, offering a
  // duty boundary after each op.
  async encodeProgramCooperative(program, scheduler) {
    for (const step of program) {
      if (step.kind !== 'op') continue;
      const pass = scheduler.encoder().beginComputePass({ label: step.label });
      pass.setPipeline(step.pipeline);
      pass.setBindGroup(0, step.bindGroup);
      pass.dispatchWorkgroups(...step.workgroups);
      pass.end();
      scheduler.addFlops(step.flops);
      await scheduler.boundary(step.label);
    }
  }
}

export function createCooperativeCfgDrift(device, denoiser, scheduler, { prompts, cfgScale = 3, onEvaluation = null }) {
  const n = prompts * denoiser.J * denoiser.Fe * denoiser.T;
  if (denoiser.B !== 2 * prompts) throw new Error(`denoiser has ${denoiser.B} rows, expected ${2 * prompts}`);
  const staging = device.createBuffer({ size: 2 * n * 4, usage: SU.COPY_DST | SU.MAP_READ, label: 'unimate.drift.readback' });
  const x = new Float32Array(2 * n), ts = new Array(2 * prompts), scale = Math.fround(cfgScale);
  const drift = async (t, y) => {
    if (y.length !== n) throw new RangeError(`state has ${y.length} values, expected ${n}`);
    const started = performance.now();
    x.set(y, 0);
    x.set(y, n);
    denoiser.writeMotion(x);
    denoiser.writeTimesteps(ts.fill(t));
    // No error scope here: it would stay open across the duty boundaries where the
    // host's frames submit on the same device, and would capture (or mispair with)
    // the host's errors. An all-zero readback is the evidence that GPU work failed.
    await denoiser.encodeProgramCooperative(denoiser.forwardProgram, scheduler);
    scheduler.encoder().copyBufferToBuffer(denoiser.io.out, 0, staging, 0, 2 * n * 4);
    await scheduler.flush('unimate.drift.readback');
    await staging.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(staging.getMappedRange());
    try { assertEvaluated(out); } catch (e) { staging.unmap(); throw e; }
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) v[i] = Math.fround(out[n + i] + Math.fround(scale * Math.fround(out[i] - out[n + i])));
    staging.unmap();
    drift.evaluations += 1;
    onEvaluation?.({ t, ms: performance.now() - started, evaluations: drift.evaluations });
    return v;
  };
  drift.evaluations = 0;
  drift.dispose = () => staging.destroy();
  return drift;
}

export class UniMateDutyScheduler extends WebGpuCommandDutyScheduler {
  constructor(device, options = {}) {
    super(device, { label: 'unimate', model: 'unimate', ...options });
  }
}
