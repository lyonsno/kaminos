// kaminos-test: manual — native Dawn WebGPU benchmark; takes the webgpu module path and an output directory
// Pressure-only cost comparison on the same composite grid, inputs and route
// as Sexy's cost runner (`tests/volume-composite-pressure-cost.mjs`): the PCG
// candidate against the fast solve in both preconditioner modes, each solve
// timed by GPU timestamps around its single compute pass (no wall-time
// fallback). Convergence is adjudicated on the CPU from the corrected flux.
// Usage: node tests/volume-composite-fast-pressure-cost.mjs <webgpu module> <output> [outer width=32] [repetitions=3]
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createCompositeGrid, compositeDivergence } from '../volume-composite-grid.mjs';
import { createCompositePCGGPU } from '../volume-composite-pcg-gpu.mjs';
import { createCompositeFastPCGGPU } from '../volume-composite-fast-pcg-gpu.mjs';
import { pressureTimestampScope } from './helpers/volume-pressure-timing.mjs';
const [dawnPath, out, scaleArg = '32', repeatArg = '3'] = process.argv.slice(2);
assert.ok(dawnPath && out, 'usage: <dawn module> <output> [outer width=32] [repetitions=3]');
const width = Number(scaleArg), repetitions = Number(repeatArg);
assert.ok(Number.isInteger(width) && width >= 8 && width % 8 === 0 && Number.isInteger(repetitions) && repetitions > 0);
mkdirSync(out, { recursive: true });
// Two tolerances: the live gate (1e-3 per reference tick, Sexy's report §822)
// and one decade tighter. 1e-5 sits at the float32 floor for these cell volumes.
const TOLERANCES = [1e-3, 1e-4];
const report = { schema: 'composite-fast-pressure-cost-v0', phase: 'source', passed: false, cases: [], requested: { width, repetitions, tolerances: TOLERANCES }, claim: 'pressure-only synthetic forcing; GPU time of the solve pass; no full-frame or live flame claim' }; let device;
const persist = () => writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
try {
  report.source = { root: resolve(new URL('..', import.meta.url).pathname), revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
    files: Object.fromEntries(['volume-composite-grid.mjs', 'volume-composite-pcg-gpu.mjs', 'volume-composite-fast-pcg-gpu.mjs', 'tests/volume-composite-fast-pressure-cost.mjs', 'tests/helpers/volume-pressure-timing.mjs'].map(f => [f, createHash('sha256').update(readFileSync(new URL('../' + f, import.meta.url))).digest('hex')])) };
  report.phase = 'adapter'; persist(); const { create, globals } = await import(pathToFileURL(resolve(dawnPath))); Object.assign(globalThis, globals);
  const gpu = create(['backend=metal']), adapter = await gpu.requestAdapter(); assert.ok(adapter, 'native Metal adapter required');
  assert.ok(adapter.features.has('timestamp-query'), 'native timestamp-query required; no wall-time fallback');
  report.route = { backend: 'metal', vendor: adapter.info.vendor, architecture: adapter.info.architecture, dawnPath: resolve(dawnPath), queue: process.env.GPU_GREENROOM_QUEUE_DIR ?? null, timing: 'gpu-timestamp-query:compute-pass' };
  device = await adapter.requestDevice({ requiredFeatures: ['timestamp-query'] });
  const errors = []; device.addEventListener('uncapturederror', e => errors.push(e.error.message));
  const h = 1 / 8, fineMin = [width / 2 - width / 8, 1, width / 2 - width / 8].map(v => v * h), fineMax = fineMin.map(v => v + width * h / 4);
  report.phase = 'topology'; persist(); const buildStart = performance.now();
  const grid = createCompositeGrid({ shape: [width, 2 * width, width], cellWidth: h, fine: { min: fineMin, max: fineMax, ratio: 4 }, boundary: axis => axis === 1 ? 'open' : 'wall' });
  report.grid = { cells: grid.cells.length, faces: grid.faces.length, geometry: grid.geometry, buildMs: performance.now() - buildStart };
  const q = Float32Array.from(grid.faces, f => f.axis === 1 && f.b >= 0 && grid.cells[f.a].level === 1 && grid.cells[f.b].level === 1 ? .1 * f.area : 0);
  const perturbed = Float32Array.from(q, (v, i) => v * (1 + .01 * Math.sin(i * .013))), target = Float32Array.from(grid.cells, c => c.level === 1 ? .001 : 0);
  for (const [name, raw] of Object.entries({ input: q, perturbed, target })) writeFileSync(resolve(out, `${name}.f32`), new Uint8Array(raw.buffer));
  const measure = async (solver, name, tolerance, iterations, input, reset, label) => {
    solver.setInput(input, target); await device.queue.onSubmittedWorkDone();
    const e = device.createCommandEncoder(), scope = pressureTimestampScope(device, e);
    const t0 = performance.now(); solver.encode(scope.encoder, { iterations, reset }); scope.resolve(); const cb = e.finish(), t1 = performance.now();
    device.queue.submit([cb]); await device.queue.onSubmittedWorkDone(); const t2 = performance.now();
    let timing; try { timing = await scope.read(); } finally { scope.destroy(); }
    const result = await solver.readback(); assert.deepEqual(errors, []);
    // Independent CPU adjudication, the same for every solver.
    const d = compositeDivergence(grid, result.flux); const maxDivergenceError = d.reduce((s, v, i) => Math.max(s, Math.abs(v - target[i])), 0);
    const row = { solver: name, tolerance, label, iterationBudget: iterations, iterations: result.receipt.iterations, gpuMs: timing.gpuMs, dispatches: timing.dispatches, encodeMs: t1 - t0, submitAndCompletionMs: t2 - t1, maxDivergenceError, meetsTolerance: maxDivergenceError <= tolerance, receipt: result.receipt };
    report.cases.push(row); persist(); console.log(JSON.stringify({ solver: name, tolerance, label, iterations: row.iterations, gpuMs: Number(row.gpuMs.toFixed(3)), dispatches: row.dispatches, maxDivergenceError, meets: row.meetsTolerance }));
    return result;
  };
  report.phase = 'comparison'; persist();
  for (const tolerance of TOLERANCES) {
    const solvers = {
      pcg: createCompositePCGGPU(device, grid, { tolerance }),
      'fast-diagonal': createCompositeFastPCGGPU(device, grid, { tolerance, preconditioner: 'diagonal' }),
      'fast-multigrid': createCompositeFastPCGGPU(device, grid, { tolerance, preconditioner: 'multigrid' }),
    };
    // Budgets are generous so that convergence, not the budget, ends each solve;
    // the iteration count in the row is the solver's own.
    const budgets = { pcg: 2048, 'fast-diagonal': 2048, 'fast-multigrid': 256 };
    try {
      for (const [name, solver] of Object.entries(solvers)) await measure(solver, name, tolerance, 0, q, true, 'first-use-zero-budget');
      for (let repetition = 0; repetition < repetitions; repetition++) for (const [name, solver] of Object.entries(solvers)) {
        await measure(solver, name, tolerance, budgets[name], q, true, `cold-${repetition}`);
        await measure(solver, name, tolerance, budgets[name], perturbed, false, `changed-input-warm-${repetition}`);
        await measure(solver, name, tolerance, budgets[name], perturbed, false, `same-input-warm-${repetition}`);
      }
    } finally { for (const s of Object.values(solvers)) s.destroy(); }
  }
  report.phase = 'complete'; report.passed = true;
} catch (e) { report.error = e.stack; process.exitCode = 1; }
finally { device?.destroy(); persist(); console.log(JSON.stringify({ phase: report.phase, passed: report.passed, error: report.error, report: resolve(out, 'report.json') })); }
