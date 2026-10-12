// Solver witness: UniMate's full sampling ODE on WebGPU against the PyTorch
// trace (export-reference.py --mode trace → export-browser-trace.py).
// Modes (?modes=vector-field,forced,free):
// - vector-field: every reference drift evaluation's input through the browser
//   network. Gate: median relative L2 <= ?vfMedianGate (1e-5) and max <= ?vfGate
//   (5.1e-5 = 1.25 x PyTorch FP32's own distance from a float64 run at the worst
//   traced evaluation, 4.11e-5; the browser cannot be held tighter than the
//   reference's own FP32 rounding).
// - forced: the JS dopri5 replays the reference's first step, step sizes and
//   accept/reject decisions. Gate: every evaluation time matches except the
//   initial-step probe (its time comes from the controller's error norm, which
//   upstream takes over padded joints), and final-sample relative L2 <= ?forcedGate (1e-4).
// - free: the browser's own controller, whose error norm covers valid joints only.
//   It is a different controller from upstream's, so it is reported, not gated.
// The run passes only if at least one gated mode ran and every gated mode passed,
// and only if fixture and trace come from the same capture inputs.
// Publishes window.__unimateSolverWitness = { phase, progress, report }.
import { UniMateDenoiser } from './unimate-denoiser.js';
import { createCfgDrift } from './unimate-drift.js';
import { dopri5Solve } from './unimate-dopri5.js';
import { bundleArrays, compare, conditioningFor, createDevice, fetchBytes, fetchJson } from './witness-common.js';

const state = { phase: 'start', progress: 0, report: null };
window.__unimateSolverWitness = state;
const params = new URL(location.href).searchParams;
const modes = (params.get('modes') ?? 'vector-field,forced,free').split(',');
const VF_GATE = Number(params.get('vfGate') ?? '5.1e-5');
const VF_MEDIAN_GATE = Number(params.get('vfMedianGate') ?? '1e-5');
const FORCED_GATE = Number(params.get('forcedGate') ?? '1e-4');

function summarize(values) {
  const s = [...values].sort((a, b) => a - b);
  return { max: s[s.length - 1], median: s[Math.floor(s.length / 2)], min: s[0], count: s.length };
}

async function run() {
  const report = { schema: 'kaminos.unimate.solver-witness.v0', modes, gates: { vectorFieldMaxRelativeL2: VF_GATE, vectorFieldMedianRelativeL2: VF_MEDIAN_GATE, forcedFinalRelativeL2: FORCED_GATE } };
  state.report = report;
  state.phase = 'load';
  const device = await createDevice(report);
  const manifest = await fetchJson('/weights/manifest.json');
  const weightBytes = await fetchBytes(`/weights/${manifest.file}`);
  const fxIndex = await fetchJson('/fixture/fixture.json');
  const fx = bundleArrays(fxIndex, await fetchBytes('/fixture/fixture.bin'));
  const trIndex = await fetchJson('/trace/trace.json');
  const tr = bundleArrays(trIndex, await fetchBytes('/trace/trace.bin'));
  report.weights = { sha256: manifest.sha256, source: manifest.source };
  report.fixture = { sha256: fxIndex.sha256, capture: fxIndex.capture };
  report.trace = { sha256: trIndex.sha256, trace: trIndex.trace, summary: trIndex.trace_summary, solver: trIndex.solver,
    interval: trIndex.interval };
  if (fxIndex.n_joints !== trIndex.n_joints) throw new Error('fixture and trace joint counts differ');
  // Fixture and trace must describe the same capture: same prompts, seed and checkpoint.
  const same = k => JSON.stringify(fxIndex.capture_inputs?.[k]) === JSON.stringify(trIndex.capture_inputs?.[k]);
  const mismatched = ['prompts', 'seed', 'model_sha256'].filter(k => !same(k));
  if (mismatched.length) throw new Error(`fixture and trace come from different captures: ${mismatched.join(', ')}`);

  const J = trIndex.n_joints, prompts = 2, per = J * 12 * 60;
  const den = await UniMateDenoiser.create(device, manifest, weightBytes);
  den.configure({ B: 2 * prompts, J });
  den.writeConditioning(conditioningFor(fx, [0, 1, 0, 1], [0, 1, -1, -1]));
  { const e = device.createCommandEncoder(); den.encodePrepare(e); device.queue.submit([e.finish()]); await device.queue.onSubmittedWorkDone(); }
  const drift = createCfgDrift(device, den, { prompts });

  const nEval = tr.eval_t.shape[0];
  const evalX = i => tr.eval_x.data.subarray(i * prompts * per, (i + 1) * prompts * per);
  const evalOut = i => tr.eval_out.data.subarray(i * prompts * per, (i + 1) * prompts * per);
  const evalT = trIndex.eval_t_float64;
  const refSamples = tr.samples.data;
  const outputTimes = trIndex.output_times;

  if (modes.includes('vector-field')) {
    state.phase = 'vector-field';
    const rel = [];
    let worst = { relativeL2Error: -1 };
    const t0 = performance.now();
    for (let i = 0; i < nEval; i++) {
      const v = await drift(Math.fround(evalT[i]), evalX(i));
      const c = compare(`eval ${i}`, v, evalOut(i));
      rel.push(c.relativeL2Error);
      if (c.relativeL2Error > worst.relativeL2Error) worst = { ...c, t: evalT[i] };
      state.progress = i + 1;
    }
    const s = summarize(rel);
    report.vectorField = { evaluations: nEval, relativeL2: s, worst, msPerEvaluation: (performance.now() - t0) / nEval,
      pass: !report.gpuErrors && s.max <= VF_GATE && s.median <= VF_MEDIAN_GATE };
  }

  const solveAndCompare = async (label, opts) => {
    state.phase = label;
    const seen = [];
    const t0 = performance.now();
    const res = await dopri5Solve({
      y0: tr.noise.data.slice(), outputTimes, rtol: trIndex.solver.rtol, atol: trIndex.solver.atol, ...opts,
      drift: async (t, y) => { seen.push({ t, y: y.slice() }); state.progress = seen.length; return drift(t, y); },
      onEval: e => { seen[seen.length - 1].kind = e.kind; },
    });
    const final = res.solution[res.solution.length - 1];
    const out = { controllerNorm: 'valid-joints', evaluations: seen.length, referenceEvaluations: nEval, steps: res.steps.length,
      referenceSteps: trIndex.steps.length, accepted: res.steps.filter(s => s.accepted).length,
      referenceAccepted: trIndex.steps.filter(s => s.accepted).length, firstStep: res.firstStep,
      selectedFirstStep: res.selectedFirstStep, referenceFirstStep: trIndex.solver.first_step,
      final: compare(`${label} final`, final, refSamples), seconds: (performance.now() - t0) / 1000,
      errorRatios: res.steps.map(s => s.errorRatio), referenceErrorRatios: trIndex.steps.map(s => s.error_ratio) };
    return { out, seen, final };
  };

  if (modes.includes('forced')) {
    const { out, seen } = await solveAndCompare('forced', {
      forcedSteps: trIndex.steps.map(s => ({ dt: s.dt, accepted: s.accepted })), forcedFirstStep: trIndex.solver.first_step,
    });
    const n = Math.min(seen.length, nEval);
    const compared = seen.slice(0, n).map((e, i) => ({ ...e, i })).filter(e => e.kind !== 'initial-step');
    out.excludedEvaluations = seen.slice(0, n).map((e, i) => ({ i, kind: e.kind })).filter(e => e.kind === 'initial-step');
    out.timeMismatches = compared.map(e => (e.t === Math.fround(evalT[e.i]) ? null : { i: e.i, kind: e.kind, ours: e.t, ref: evalT[e.i] })).filter(Boolean);
    out.stateRelativeL2 = summarize(compared.map(e => compare(`state ${e.i}`, e.y, evalX(e.i)).relativeL2Error));
    out.pass = !report.gpuErrors && out.evaluations === nEval && out.excludedEvaluations.length === 1
      && out.timeMismatches.length === 0 && out.final.relativeL2Error <= FORCED_GATE;
    report.forced = out;
  }

  if (modes.includes('free')) {
    const { out, final } = await solveAndCompare('free', {});
    report.free = out;
    window.__unimateFreeSample = Array.from(final);
  }
  const gated = ['vectorField', 'forced'].filter(k => report[k]);
  report.gatedModes = gated;
  report.pass = gated.length > 0 && gated.every(k => report[k].pass);
  state.phase = 'done';
}

run().catch(e => { state.error = String(e?.stack ?? e); state.phase = 'failed'; });
