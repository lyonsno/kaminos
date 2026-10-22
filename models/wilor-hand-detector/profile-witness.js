// Diagnostic GPU profile of the hand detector and MobRecon networks: every
// dispatch timed with timestamp queries in its own pass (pass splitting adds
// overhead; totals are not end-to-end latency). Shared machine; not a benchmark.
import { createWebGpuInferenceSession } from '../../webgpu-inference-kit/src/core.js';
import { admitAdapter } from '../mobrecon/parity-checks.js';
import { HAND_DETECTOR_ROUTE_ID, loadHandDetector } from './detector-route.js';
import { createHandDetectorNetwork } from './detector-network.js';

export async function runParityWitness({ packageUrl, report, repeats = 5 }) {
  const adapter = await navigator.gpu.requestAdapter();
  report.adapter = admitAdapter(adapter.info);
  const device = await adapter.requestDevice({ requiredFeatures: ['timestamp-query'],
    requiredLimits: { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize } });
  const errors = [];
  device.addEventListener('uncapturederror', e => errors.push(String(e.error?.message ?? e.error)));
  const session = await createWebGpuInferenceSession({ sessionId: crypto.randomUUID(), device, adapterName: 'profile', effectiveFeatures: device.features });
  const route = await session.registerRoute({ routeId: HAND_DETECTOR_ROUTE_ID });
  const model = await loadHandDetector({ route, packageUrl });
  await model.network.run({ input: new Float32Array(3 * 512 * 512).fill(0.5) });
  const runs = [];
  for (let r = 0; r < repeats; r++) runs.push(await model.network.profile());
  const rows = runs[0].map((row, i) => ({ ...row, ms: runs.map(run => run[i].ms).sort((a, b) => a - b)[Math.floor(repeats / 2)] }));
  const byKind = {};
  for (const row of rows) { const k = byKind[row.kind] ??= { ms: 0, flops: 0, count: 0 }; k.ms += row.ms; k.flops += row.flops; k.count++; }
  report.totalMs = rows.reduce((a, r) => a + r.ms, 0);
  report.totalGflop = rows.reduce((a, r) => a + r.flops, 0) / 1e9;
  report.byKind = byKind;
  report.slowest = [...rows].sort((a, b) => b.ms - a.ms).slice(0, 25).map(r => ({ ...r, tflops: r.flops / r.ms / 1e9 }));
  report.rows = rows;
  const median = xs => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const wall = async fn => { const xs = []; for (let i = 0; i < 15; i++) { const t = performance.now(); await fn(); xs.push(performance.now() - t); } return median(xs); };
  report.wallMs = {
    runWithReadback: await wall(() => model.network.run({})),
    submitToDone: await wall(async () => { const e = device.createCommandEncoder(); model.network.encode(e); device.queue.submit([e.finish()]); await device.queue.onSubmittedWorkDone(); }),
    emptySubmitToDone: await wall(async () => { device.queue.submit([device.createCommandEncoder().finish()]); await device.queue.onSubmittedWorkDone(); }),
  };
  report.sweep = [];
  for (const minWorkgroups of [0, 64, 128, 256, 512, 1024]) {
    const net = createHandDetectorNetwork({ device, tensors: model.tensors, minWorkgroups });
    await net.run({ input: new Float32Array(3 * 512 * 512).fill(0.5) });
    const profiles = [];
    for (let r = 0; r < repeats; r++) profiles.push((await net.profile()).reduce((a, x) => a + x.ms, 0));
    const walls = [];
    for (let i = 0; i < 15; i++) { const t = performance.now(); const e = device.createCommandEncoder(); net.encode(e); device.queue.submit([e.finish()]); await device.queue.onSubmittedWorkDone(); walls.push(performance.now() - t); }
    report.sweep.push({ minWorkgroups, profiledMs: median(profiles), submitToDoneMs: median(walls) });
    net.dispose();
  }
  report.errors = errors;
  report.status = errors.length ? 'failed' : 'passed';
  model.release();
}
