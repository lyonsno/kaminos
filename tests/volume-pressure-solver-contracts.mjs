import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as core from '../volume-core.js';

// Converged pressure solver: an opt-in red-black SOR projection that replaces the
// legacy 1-3 pass damped Jacobi with material-weighted partial projection. These
// contracts bind the JavaScript control resolution, the WGSL kernels, the cockpit
// plumbing, and the preset schema. They are source/CPU evidence only; whether a
// converged solve preserves the operator's basin is a live comparison.

const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url), 'utf8'));

function wgslFunction(name) {
  const match = source.match(new RegExp(`\\nfn ${name}\\([^]*?\\n\\}`));
  return match ? match[0] : null;
}

test('control resolution exposes legacy and converged solvers with requested/effective identity', () => {
  assert.equal(typeof core.resolvePressureSolverConfig, 'function', 'resolvePressureSolverConfig must be exported');
  const legacy = core.resolvePressureSolverConfig({});
  assert.equal(legacy.effective.solver, 'legacy');
  assert.equal(legacy.requested.solver, 'legacy');
  assert.equal(legacy.effective.projectionGain, null, 'legacy keeps its material-weighted gain and reports no scalar gain');

  const converged = core.resolvePressureSolverConfig({ pressureSolver: 'converged', pressureSolverIterations: 60, projection: 0.65 });
  assert.equal(converged.effective.solver, 'converged');
  assert.equal(converged.effective.openTop, false);
  assert.equal(converged.effective.iterations, 60);
  assert.equal(converged.effective.projectionGain, 0.65, 'Projection remains an operator gain, clamped to [0, 1]');
  assert.ok(converged.effective.omega > 1 && converged.effective.omega < 2, 'SOR relaxation stays inside the stable interval');

  const openTop = core.resolvePressureSolverConfig({ pressureSolver: 'converged-open-top', pressureSolverIterations: 96, projection: 1.3 });
  assert.equal(openTop.effective.solver, 'converged');
  assert.equal(openTop.effective.openTop, true);
  assert.equal(openTop.effective.projectionGain, 1);

  const clamped = core.resolvePressureSolverConfig({ pressureSolver: 'converged', pressureSolverIterations: 100000 });
  assert.ok(clamped.effective.iterations >= 240, 'route-requested sweep counts above the slider are not silently truncated to the slider');
  assert.ok(Number.isFinite(clamped.effective.iterations));

  const unknown = core.resolvePressureSolverConfig({ pressureSolver: 'quantum' });
  assert.equal(unknown.requested.solver, 'quantum');
  assert.equal(unknown.effective.solver, 'legacy');
  assert.equal(unknown.effective.reason, 'unknown-solver');
});

test('converged kernels exist and drop the legacy damping and material-weighted gain', () => {
  for (const name of ['csDivergencePressureWarm', 'csPressureRedBlackEven', 'csPressureRedBlackOdd', 'csProjectPressureConverged', 'csPressureResidualBefore', 'csPressureResidualAfter']) {
    assert.ok(source.includes(`fn ${name}(`), `WGSL entry point ${name} must exist`);
  }
  const sweep = wgslFunction('pressureRedBlackSweep');
  assert.ok(sweep, 'red-black sweep helper must exist');
  assert.doesNotMatch(sweep, /0\.985/, 'converged sweep must not damp pressure');
  assert.match(sweep, /& 1u\) != parity/, 'sweep must gate on cell parity so in-place updates are race-free');
  const project = wgslFunction('csProjectPressureConverged');
  assert.ok(project, 'converged projection kernel must exist');
  assert.doesNotMatch(project, /activeMaterial/, 'converged projection must not weight the correction by material');
  assert.doesNotMatch(project, /mix\(0\.62, 0\.94/, 'converged projection must not use the legacy scene gain');
  assert.match(project, /pressureNeighborRead/, 'converged projection reads pressure through the boundary-aware helper');
  assert.match(project, /pressureNeighborRead\(c \+ vec3<i32>\(1, 0, 0\)\) - pressureHere/, 'converged projection uses the forward gradient, the adjoint of the compact divergence');
  assert.doesNotMatch(project, /\* 0\.5;/, 'converged projection must not use the legacy 2h central gradient');
  const warm = wgslFunction('csDivergencePressureWarm');
  assert.match(warm, /pressureDst\[idx\]\.y/, 'divergence refresh keeps the previous pressure as the warm start');
  assert.match(warm, /divergenceCompactAtCell/, 'converged solve targets the compact divergence its Laplacian can actually zero');
  const compact = wgslFunction('divergenceCompactAtCell');
  assert.match(compact, /compactFaceVelocity\(c, 0u\) - compactFaceVelocity\(c - vec3<i32>\(1, 0, 0\), 0u\)/, 'compact divergence is the backward face-flux difference per axis');
  const face = wgslFunction('compactFaceVelocity');
  assert.match(face, /if \(c\[axis\] < 0\) \{\s*return 0\.0;/, 'the ghost face below the first cell carries no flux');
  assert.match(face, /axis == 1u && pressureSolverOpenTop\(\)/, 'only the open top lets the last cell\'s upper face carry flux');
  assert.match(project, /if \(c\.y >= lastCell && !pressureSolverOpenTop\(\)\)/, 'closed top zeroes the top-face flux in the corrected field');
  const neighbor = wgslFunction('pressureNeighborInPlace');
  assert.match(neighbor, /c\.y >= i32\(GRID\)/, 'open-top boundary zeroes pressure above the top face');
});

test('the production sweep update converges a small Poisson problem far beyond the legacy pass count', () => {
  const update = wgslFunction('pressureRedBlackUpdate');
  assert.ok(update, 'pressureRedBlackUpdate must exist');
  const body = update.slice(update.indexOf('{') + 1, update.lastIndexOf('}'));
  const js = body.replaceAll('let ', 'const ');
  const f = Math.fround;
  const evaluate = new Function('previous', 'neighborPressure', 'div', 'omega', js);
  const N = 16;
  const cells = N * N * N;
  const idx = (x, y, z) => x + y * N + z * N * N;
  const clampI = v => Math.max(0, Math.min(N - 1, v));
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const makeField = () => [new Float32Array(cells), new Float32Array(cells), new Float32Array(cells)];
  const cloneField = field => field.map(component => new Float32Array(component));
  const vel = makeField();
  for (let z = 0; z < N; z += 1) for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) {
    const dx = (x + 0.5) / N - 0.5;
    const dy = (y + 0.5) / N - 0.35;
    const dz = (z + 0.5) / N - 0.5;
    vel[1][idx(x, y, z)] = 0.3 * Math.exp(-(dx * dx + dy * dy + dz * dz) / 0.02);
  }
  // Legacy wide-stencil divergence (divergenceAtCell) with clamped neighbors.
  const divergenceWide = field => {
    const out = new Float32Array(cells);
    for (let z = 0; z < N; z += 1) for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) {
      let sum = 0;
      axes.forEach(([ax, ay, az], a) => {
        sum += (field[a][idx(clampI(x + ax), clampI(y + ay), clampI(z + az))] - field[a][idx(clampI(x - ax), clampI(y - ay), clampI(z - az))]) * 0.5;
      });
      out[idx(x, y, z)] = sum;
    }
    return out;
  };
  // Compact backward divergence (divergenceCompactAtCell) in a closed box: the
  // stored component is the upper-face flux; wall faces carry none.
  const faceVelocity = (field, a, x, y, z) => {
    const coordinate = [x, y, z][a];
    if (coordinate < 0 || coordinate >= N - 1) return 0;
    return field[a][idx(x, y, z)];
  };
  const divergenceCompact = field => {
    const out = new Float32Array(cells);
    for (let z = 0; z < N; z += 1) for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) {
      let sum = 0;
      axes.forEach(([ax, ay, az], a) => {
        sum += faceVelocity(field, a, x, y, z) - faceVelocity(field, a, x - ax, y - ay, z - az);
      });
      out[idx(x, y, z)] = sum;
    }
    return out;
  };
  const l2 = a => Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const neighbors = (p, x, y, z) => p[idx(clampI(x - 1), y, z)] + p[idx(clampI(x + 1), y, z)]
    + p[idx(x, clampI(y - 1), z)] + p[idx(x, clampI(y + 1), z)]
    + p[idx(x, y, clampI(z - 1))] + p[idx(x, y, clampI(z + 1))];
  // Legacy projection: central gradient with clamped neighbors.
  const projectCentral = (field, p) => {
    const out = cloneField(field);
    for (let z = 0; z < N; z += 1) for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) {
      axes.forEach(([ax, ay, az], a) => {
        out[a][idx(x, y, z)] -= (p[idx(clampI(x + ax), clampI(y + ay), clampI(z + az))] - p[idx(clampI(x - ax), clampI(y - ay), clampI(z - az))]) * 0.5;
      });
    }
    return out;
  };
  // Converged projection: forward gradient (Neumann walls give zero correction
  // there) and closed wall faces zeroed, as csProjectPressureConverged does.
  const projectForward = (field, p) => {
    const out = cloneField(field);
    for (let z = 0; z < N; z += 1) for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) {
      axes.forEach(([ax, ay, az], a) => {
        const at = idx(x, y, z);
        out[a][at] -= p[idx(clampI(x + ax), clampI(y + ay), clampI(z + az))] - p[at];
        if ([x, y, z][a] >= N - 1) out[a][at] = 0;
      });
    }
    return out;
  };
  const divWide = divergenceWide(vel);
  const div = divergenceCompact(vel);
  const beforeWide = l2(divWide);
  const beforeCompact = l2(div);

  // Legacy: two damped Jacobi passes from zero pressure on the wide divergence.
  let pa = new Float32Array(cells);
  for (let pass = 0; pass < 2; pass += 1) {
    const pb = new Float32Array(cells);
    for (let z = 0; z < N; z += 1) for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) {
      pb[idx(x, y, z)] = f((neighbors(pa, x, y, z) - divWide[idx(x, y, z)]) / 6) * 0.985;
    }
    pa = pb;
  }
  const legacyProjected = projectCentral(vel, pa);
  const legacyWideRatio = l2(divergenceWide(legacyProjected)) / beforeWide;
  const legacyCompactRatio = l2(divergenceCompact(legacyProjected)) / beforeCompact;

  // Converged: red-black sweeps with the production update, warm start zero.
  const p = new Float32Array(cells);
  const omega = 1.9;
  const poissonResidual = () => {
    const r = new Float32Array(cells);
    for (let z = 0; z < N; z += 1) for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) {
      r[idx(x, y, z)] = neighbors(p, x, y, z) - 6 * p[idx(x, y, z)] - div[idx(x, y, z)];
    }
    return l2(r);
  };
  const initialResidual = poissonResidual();
  let previousResidual = initialResidual;
  for (let sweep = 0; sweep < 60; sweep += 1) {
    for (const parity of [0, 1]) {
      for (let z = 0; z < N; z += 1) for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) {
        if (((x + y + z) & 1) !== parity) continue;
        p[idx(x, y, z)] = evaluate(p[idx(x, y, z)], neighbors(p, x, y, z), div[idx(x, y, z)], omega);
      }
    }
    if (sweep % 10 === 9) {
      const residual = poissonResidual();
      assert.ok(residual < previousResidual, `residual must keep falling: sweep ${sweep} ${residual} >= ${previousResidual}`);
      previousResidual = residual;
    }
  }
  const finalResidual = poissonResidual();
  const convergedProjected = projectForward(vel, p);
  const convergedCompact = l2(divergenceCompact(convergedProjected));
  const convergedCompactRatio = convergedCompact / beforeCompact;
  const convergedWideRatio = l2(divergenceWide(convergedProjected)) / beforeWide;
  assert.ok(finalResidual < initialResidual / 100, `60 sweeps must cut the Poisson residual by more than 100x: ${initialResidual} -> ${finalResidual}`);
  // Consistency identity: with adjoint compact operators the post-projection
  // divergence equals the remaining Poisson residual.
  assert.ok(Math.abs(convergedCompact - finalResidual) <= 1e-5 * Math.max(1, initialResidual), `compact divergence after projection must equal the Poisson residual: ${convergedCompact} vs ${finalResidual}`);
  assert.ok(legacyWideRatio > 0.5, `two damped Jacobi passes leave most of the wide divergence: ratio ${legacyWideRatio}`);
  assert.ok(legacyCompactRatio > 0.5, `two damped Jacobi passes leave most of the compact divergence: ratio ${legacyCompactRatio}`);
  assert.ok(convergedCompactRatio < 0.01, `consistent compact projection must drive the compact divergence toward zero: ratio ${convergedCompactRatio}`);
  assert.ok(convergedWideRatio < legacyWideRatio, `converged projection must not leave more wide divergence than legacy: ${convergedWideRatio} vs ${legacyWideRatio}`);
});

test('cockpit plumbing carries the solver selection through DOM, route, controls, labels, and listeners', () => {
  assert.match(index, /id="volume-pressure-solver"[^>]*data-volume-settings-param="volume_pressure_solver"/, 'solver select is a settings control');
  assert.match(index, /id="volume-pressure-solver-iterations"[^>]*data-volume-settings-param="volume_pressure_solver_iterations"/, 'sweep count is a settings control');
  assert.match(index, /<option value="legacy" selected>/, 'legacy remains the default so saved basins do not change');
  assert.match(index, /<option value="converged-open-top">/, 'open-top converged solve is selectable');
  assert.match(index, /\['pressureSolver', 'volume_pressure_solver'\]/, 'route field carries the solver');
  assert.match(index, /\['pressureSolverIterations', 'volume_pressure_solver_iterations'\]/, 'route field carries the sweep count');
  assert.match(index, /pressureSolver: document\.getElementById\('volume-pressure-solver'\)\.value/, 'controls read the solver');
  assert.match(index, /pressureSolverIterations: parseFloat\(document\.getElementById\('volume-pressure-solver-iterations'\)\.value\)/, 'controls read the sweep count');
  assert.match(index, /volume-pressure-solver-val'\)\.textContent/, 'solver label renders the effective solver');
  assert.match(index, /'volume-pressure-solver',\s*\n\s*'volume-pressure-solver-iterations',/, 'both controls register live listeners');
  assert.match(index, /\['volume-pressure-solver', 'volume_pressure_solver'\]/, 'route params apply the solver');
});

test('preset schema declares both controls additively so historical basins project to legacy', () => {
  const solver = schema.controls.find(control => control.key === 'volume-pressure-solver');
  const sweeps = schema.controls.find(control => control.key === 'volume-pressure-solver-iterations');
  assert.ok(solver, 'schema must declare volume-pressure-solver');
  assert.ok(sweeps, 'schema must declare volume-pressure-solver-iterations');
  assert.equal(solver.additiveDefault, 'legacy');
  assert.deepEqual(solver.allowedValues, ['legacy', 'converged', 'converged-open-top']);
  assert.equal(solver.type, 'select-one');
  assert.equal(sweeps.type, 'range');
  assert.equal(sweeps.additiveDefault, 60);
  assert.equal(schema.controlCount, schema.controls.length);
});

test('runtime receipt and cost ledger name the converged strategy', () => {
  assert.match(source, /pressureSolver: state\.pressureSolver/, 'debug state exports the pressure solver receipt');
  assert.match(source, /PRESSURE_SOURCE_STRATEGY_RED_BLACK_SOR = 'red-black-sor-warm-start-v0'/, 'cost ledger has a named converged source strategy');
  assert.match(source, /pressureRedBlackHalfPasses/, 'cost ledger counts red-black half passes');
  assert.match(source, /pressureResidualPartials/, 'residual probe reduces divergence on the GPU');
  assert.match(source, /compact: reduceOperator\(0\),\s*wide: reduceOperator\(4\)/, 'residual receipt reports both the compact and the legacy wide operator');
  // The compact divergence reads the solver uniform, so every kernel that calls
  // it must be created with a layout that carries the uniform at group 0.
  assert.match(source, /layout: pressureRedBlackPipelineLayout,\s*compute: \{ module: shader, entryPoint: 'csDivergencePressureWarm'/, 'warm divergence pipeline uses the uniform-bearing layout');
  assert.match(source, /pressureRedBlackPipelineLayout = device\.createPipelineLayout\(\{[^}]*bindGroupLayouts: \[bindGroupLayout, emptyBindGroupLayout, pressureWriteBindGroupLayout\]/, 'red-black layout carries the fluid uniform');
  assert.match(source, /pressureResidualPipelineLayout = device\.createPipelineLayout\(\{[^}]*bindGroupLayouts: \[bindGroupLayout, emptyBindGroupLayout, pressureResidualBindGroupLayout\]/, 'residual probe layout carries the fluid uniform');
  assert.doesNotMatch(source, /setPipeline\(pressureResidual(Before|After)Pipeline\);\s*pass\.setBindGroup\(0, fluidFrontReadBindGroups/, 'residual probes bind the full fluid bind group, not the uniform-less read group');
});

// --- Review repairs for eda557c5 (M1 gain/clamp identity, M2 map freshness, M3 Bonfire ablation) ---

test('converged mode reports partial versus full projection and folds Bonfire ablation into its gain', () => {
  const partial = core.resolvePressureSolverConfig({ pressureSolver: 'converged', projection: 0.65 });
  assert.equal(partial.effective.projectionGain, 0.65);
  assert.equal(partial.effective.projection, 'partial', 'gain below 1 is reported as partial projection');
  const full = core.resolvePressureSolverConfig({ pressureSolver: 'converged', projection: 1 });
  assert.equal(full.effective.projection, 'full');
  const bonfireHalf = core.resolvePressureSolverConfig({ pressureSolver: 'converged', projection: 1, volumeScene: 'bonfire_plume', bonfireProjection: 0.5 });
  assert.equal(bonfireHalf.effective.projectionGain, 0.5, 'Bonfire ablation scales the converged gain');
  assert.equal(bonfireHalf.effective.projection, 'partial');
  const bonfireZero = core.resolvePressureSolverConfig({ pressureSolver: 'converged', projection: 1, volumeScene: 'bonfire_plume', bonfireProjection: 0 });
  assert.equal(bonfireZero.effective.projectionGain, 0);
  const tallIgnoresAblation = core.resolvePressureSolverConfig({ pressureSolver: 'converged', projection: 1, volumeScene: 'tall_plume', bonfireProjection: 0.5 });
  assert.equal(tallIgnoresAblation.effective.projectionGain, 1, 'ablation applies only to the Bonfire scene');
  const legacy = core.resolvePressureSolverConfig({ projection: 0.65 });
  assert.equal(legacy.effective.projection, null);
  assert.match(index, /partial/, 'cockpit label vocabulary names partial projection');
  assert.doesNotMatch(index, /Converged runs red-black SOR to a small divergence residual/, 'cockpit help must not claim a divergence-free result independent of gain');
  assert.match(index, /leaves \(1 − Projection\) of the divergence/, 'cockpit help states the partial-projection consequence');
});

test('post-correction divergence follows the effective gain and the velocity bound, not the Poisson residual alone', () => {
  // Same CPU model as the production kernel: correction = gain * forward
  // gradient, then the retained per-component bound. Shader constants are
  // pinned so this model cannot drift silently from csProjectPressureConverged.
  const project = wgslFunction('csProjectPressureConverged');
  assert.match(project, /clamp\(u\.pressure_solver_controls\.w, 0\.0, 1\.0\)/, 'gain is read from the solver uniform and clamped to [0, 1]');
  assert.match(project, /clamp\(correctedVelocity, vec3<f32>\(-0\.34\), vec3<f32>\(0\.52\)\)/, 'legacy velocity bound is retained after correction');
  const bound = v => Math.max(-0.34, Math.min(0.52, v));
  // One closed 1-D column of two cells: the stored component of cell 0 is the
  // flux through the shared face; both outer faces are walls.
  const column = (flux, gain, clampVelocity) => {
    const div0 = flux;
    const div1 = -flux;
    // Exact compact Poisson solution: p1 - p0 = flux zeroes both divergences.
    const p0 = 0;
    const p1 = flux;
    let corrected = flux - gain * (p1 - p0);
    if (clampVelocity) corrected = bound(corrected);
    return { before: [div0, div1], after: [corrected, -corrected] };
  };
  const partial = column(1, 0.65, false);
  assert.ok(Math.abs(partial.after[0] - 0.35) < 1e-12 && Math.abs(partial.after[1] + 0.35) < 1e-12, `gain 0.65 leaves (1 - 0.65) of the divergence: ${partial.after}`);
  const full = column(1, 1, false);
  assert.deepEqual(full.after, [0, -0], 'gain 1 with an exact solve is divergence-free before the bound');
  const clamped = column(0.9, 1, true);
  assert.equal(clamped.after[0], 0, 'an exact full correction of a saturating flux lands inside the bound');
  const saturating = { ...column(-0.9, 1, false) };
  const boundedFlux = bound(-0.9);
  assert.notEqual(boundedFlux, -0.9, 'the bound clips the stored flux itself when the flow saturates');
  // The receipt must say which regime the operator is in.
  assert.equal(core.resolvePressureSolverConfig({ pressureSolver: 'converged', projection: 0.65 }).effective.projection, 'partial');
  assert.equal(core.resolvePressureSolverConfig({ pressureSolver: 'converged', projection: 1.5 }).effective.projection, 'full');
});

test('residual probe freshness bounds the pending map as well as the pending copy', () => {
  const disposition = core.pressureResidualProbeDisposition;
  assert.equal(typeof disposition, 'function', 'pressureResidualProbeDisposition must be exported');
  const base = { copyPending: false, mapPending: false, frameCount: 500, copyFrame: 0, mapStartedFrame: 0, limitFrames: 120 };
  assert.equal(disposition({ ...base }), 'probe');
  assert.equal(disposition({ ...base, copyPending: true, copyFrame: 450 }), 'wait');
  assert.equal(disposition({ ...base, copyPending: true, copyFrame: 300 }), 'drop-copy');
  assert.equal(disposition({ ...base, mapPending: true, mapStartedFrame: 450 }), 'wait');
  assert.equal(disposition({ ...base, mapPending: true, mapStartedFrame: 300 }), 'reset-map', 'an unresolved map past the freshness limit must be reset, not waited on forever');
  assert.equal(disposition({ ...base, copyPending: true, mapPending: true, copyFrame: 300, mapStartedFrame: 490 }), 'wait', 'a fresh map outranks a stale copy flag');
  assert.match(source, /case 'reset-map':[^]*?pressureResidualMapGeneration \+= 1;[^]*?pressureResidualReadbackBuffer\.destroy\(\);[^]*?pressureResidualReadbackBuffer = device\.createBuffer\(/, 'reset path retires the stuck readback buffer, bumps the map generation, and recreates the buffer');
  assert.match(source, /residualError: 'residual-map-unresolved-reset'/, 'reset path publishes a visible error');
  assert.match(source, /if \(generation !== pressureResidualMapGeneration\)/, 'a late resolve from a retired generation cannot publish or clear the current pending state');
  assert.match(source, /pressureResidualMapStartedFrame = state\.frameCount;/, 'map start frame is recorded when the map begins');
});
