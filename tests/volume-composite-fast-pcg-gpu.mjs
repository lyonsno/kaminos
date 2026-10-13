// kaminos-test: manual — native Dawn WebGPU script; takes the webgpu module path and an output directory
// Small native numerical conformance for the fast composite solve, in both
// preconditioner modes, against the CPU reference and against the PCG
// candidate on the same inputs. Not a benchmark or a live flame witness.
// Usage: node tests/volume-composite-fast-pcg-gpu.mjs <webgpu module> <output>
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createCompositeGrid, projectComposite } from '../volume-composite-grid.mjs';
import { createCompositePCGGPU } from '../volume-composite-pcg-gpu.mjs';
import { createCompositeFastPCGGPU } from '../volume-composite-fast-pcg-gpu.mjs';
const [dawnPath, out] = process.argv.slice(2);
assert.ok(dawnPath && out, 'usage: node tests/volume-composite-fast-pcg-gpu.mjs <webgpu module> <output>');
mkdirSync(out, { recursive: true });
const report = { schema: 'composite-fast-pcg-conformance-v0', phase: 'source', passed: false, cases: [] }; let device;
try {
  report.source = { root: resolve(new URL('..', import.meta.url).pathname), revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    files: Object.fromEntries(['volume-composite-fast-pcg-gpu.mjs', 'volume-composite-pcg-gpu.mjs', 'volume-composite-grid.mjs', 'tests/volume-composite-fast-pcg-gpu.mjs'].map(f => [f, createHash('sha256').update(readFileSync(new URL('../' + f, import.meta.url))).digest('hex')])) };
  report.phase = 'adapter'; const { create, globals } = await import(pathToFileURL(resolve(dawnPath))); Object.assign(globalThis, globals);
  const gpu = create(['backend=metal']), adapter = await gpu.requestAdapter(); assert.ok(adapter, 'native Metal adapter required');
  report.route = { backend: 'metal', vendor: adapter.info.vendor, architecture: adapter.info.architecture, dawnPath: resolve(dawnPath), liveFlame: false };
  device = await adapter.requestDevice(); const errors = []; device.addEventListener('uncapturederror', e => errors.push(e.error.message));
  const fixtures = [
    { name: 'open-152', tolerance: 1e-5, fluxBound: 2e-6, grid: () => createCompositeGrid({ shape: [4, 6, 4], cellWidth: 1, fine: { min: [1, 1, 1], max: [3, 3, 3], ratio: 2 }, boundary: axis => axis === 1 ? 'open' : 'wall' }) },
    { name: 'closed-136', tolerance: 1e-5, fluxBound: 2e-6, grid: () => createCompositeGrid({ shape: [4, 6, 4], cellWidth: 1, fine: { min: [1, 1, 1], max: [3, 3, 3], ratio: 2 }, boundary: axis => axis === 1 ? 'open' : 'wall', solid: p => p[1] > 4 && p[1] < 5 }) },
    // Cell volumes of 3e-5 put a 1e-5 divergence tolerance at the float32 floor; 1e-4 is
    // above it and ten times tighter than the live gate (1e-3 per tick).
    { name: 'ratio4-16', tolerance: 1e-4, fluxBound: 1e-5, grid: () => createCompositeGrid({ shape: [16, 32, 16], cellWidth: 1 / 8, fine: { min: [4 / 8, 1 / 8, 4 / 8], max: [12 / 8, 9 / 8, 12 / 8], ratio: 4 }, boundary: axis => axis === 1 ? 'open' : 'wall' }) },
  ];
  for (const fixture of fixtures) {
    const grid = fixture.grid();
    const q = Float32Array.from(grid.faces, f => f.axis === 1 && f.b >= 0 && grid.cells[f.a].level === 1 && grid.cells[f.b].level === 1 ? .1 * f.area : 0);
    const target = Float32Array.from(grid.cells, c => c.level === 1 ? .001 : 0);
    report.phase = `${fixture.name}-reference`;
    const ref = projectComposite(grid, q, { target, tolerance: 1e-9, maxIterations: 20000 }); assert.ok(ref.converged, 'CPU reference converged');
    const candidate = createCompositePCGGPU(device, grid, { tolerance: fixture.tolerance });
    const runCandidate = async iterations => { candidate.setInput(q, target); const e = device.createCommandEncoder(); candidate.encode(e, { iterations, reset: true }); device.queue.submit([e.finish()]); return candidate.readback(); };
    const theirs = await runCandidate(1024);
    const row = { fixture: fixture.name, tolerance: fixture.tolerance, cells: grid.cells.length, faces: grid.faces.length, candidate: { converged: theirs.converged, iterations: theirs.receipt.iterations, error: theirs.flux.reduce((s, v, i) => Math.max(s, Math.abs(v - ref.flux[i])), 0) }, modes: {} };
    candidate.destroy();
    for (const [mode, options, budget] of [['diagonal', { preconditioner: 'diagonal' }, 1024], ['multigrid', { preconditioner: 'multigrid' }, 64], ['multigrid-oc1.6', { preconditioner: 'multigrid', overcorrect: 1.6 }, 64]]) {
      const preconditioner = mode;
      report.phase = `${fixture.name}-${preconditioner}`;
      const solver = createCompositeFastPCGGPU(device, grid, { tolerance: fixture.tolerance, ...options });
      const run = async (iterations, reset = false) => { solver.setInput(q, target); const e = device.createCommandEncoder(); solver.encode(e, { iterations, reset }); device.queue.submit([e.finish()]); return solver.readback(); };
      try {
        for (const shader of solver.shaders) { const messages = [...(await shader.getCompilationInfo()).messages].filter(m => m.type === 'error'); assert.deepEqual(messages, [], `${shader.label}: ${JSON.stringify(messages)}`); }
        const incomplete = await run(0, true); assert.equal(incomplete.converged, false, 'zero budget may not hide unsolved divergence');
        const cold = await run(budget, true); assert.ok(cold.converged, JSON.stringify(cold.receipt)); assert.ok(cold.receipt.iterations > 0 && cold.receipt.iterations < budget);
        const error = cold.flux.reduce((s, v, i) => Math.max(s, Math.abs(v - ref.flux[i])), 0); assert.ok(error < fixture.fluxBound, `CPU flux discrepancy ${error}`);
        const warm = await run(budget); assert.ok(warm.converged, JSON.stringify(warm.receipt)); assert.equal(warm.receipt.iterations, 0, 'same input must reuse converged pressure');
        const reset = await run(0, true); assert.equal(reset.converged, false, 'reset must discard previous pressure');
        const targetBuffer = device.createBuffer({ size: target.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        let joined, invalid;
        try {
          device.queue.writeBuffer(solver.fluxBuffer, 0, q); device.queue.writeBuffer(targetBuffer, 0, target);
          let e = device.createCommandEncoder(); solver.encodeGPU(e, { targetBuffer, iterations: budget }); device.queue.submit([e.finish()]);
          joined = await solver.readback(); assert.ok(joined.converged, JSON.stringify(joined.receipt)); assert.deepEqual(joined.target, target); assert.equal(joined.receipt.inputRoute, 'gpu-buffers');
          device.queue.writeBuffer(targetBuffer, 0, new Float32Array(target.length).fill(.5)); assert.deepEqual((await solver.readback()).target, target, 'upstream mutation cannot rewrite solve identity');
          assert.throws(() => solver.encodeGPU(device.createCommandEncoder(), { targetBuffer: solver.fluxBuffer, iterations: 1 }), /target/);
          device.queue.writeBuffer(targetBuffer, 0, new Float32Array(target.length).fill(NaN)); device.queue.writeBuffer(solver.fluxBuffer, 0, q);
          e = device.createCommandEncoder(); solver.encodeGPU(e, { targetBuffer, iterations: 4 }); device.queue.submit([e.finish()]);
          invalid = await solver.readback(); assert.equal(invalid.converged, false); assert.equal(invalid.receipt.targetFinite, false);
          assert.ok((await run(budget)).converged, 'bad input must not permanently poison warm state');
        } finally { targetBuffer.destroy(); }
        row.modes[preconditioner] = { error, cold: cold.receipt, warm: warm.receipt, joined: joined.receipt, invalid: invalid.receipt, dispatchesPerSolve: cold.receipt.dispatches };
        for (const [name, raw] of Object.entries({ flux: cold.flux, pressure: cold.pressure })) writeFileSync(resolve(out, `${fixture.name}-${preconditioner}-${name}.f32`), new Uint8Array(raw.buffer));
      } finally { solver.destroy(); }
    }
    for (const [name, raw] of Object.entries({ input: q, target, reference: Float32Array.from(ref.flux) })) writeFileSync(resolve(out, `${fixture.name}-${name}.f32`), new Uint8Array(raw.buffer));
    report.cases.push(row);
  }
  assert.deepEqual(errors, []);
  report.phase = 'complete'; report.passed = true;
} catch (e) { report.error = e.stack; process.exitCode = 1; }
finally { device?.destroy(); writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ phase: report.phase, passed: report.passed, error: report.error, cases: report.cases.map(c => ({ fixture: c.fixture, cells: c.cells, candidate: c.candidate, modes: Object.fromEntries(Object.entries(c.modes).map(([k, v]) => [k, { error: v.error, iterations: v.cold.iterations, dispatches: v.dispatchesPerSolve, trueResidual: v.cold.gpuTrueResidual }])) })) })); }
