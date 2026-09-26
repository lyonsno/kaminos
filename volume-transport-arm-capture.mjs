#!/usr/bin/env node

// Transport arm capture: loads one saved basin on the live Apple WebGPU route,
// applies a sequence of control arms through the cockpit DOM (persistent history,
// not paired resets), settles each arm, records the renderer receipt (transport,
// pressure solver, divergence residual, pass ledger, browser errors) and captures
// one frame per arm. Usage:
//   node volume-transport-arm-capture.mjs <url> <outDir> "<arm>;<arm>;..." [settleMs] \
//     --expected-repo-root <checkout> --expected-commit <sha> [--fault arm-error]
// where an arm is name[,controlId=value,...]. A control id starting with `@` is
// a debug-API request instead of a DOM control: `@confinementEpsilon=<value|null>`
// calls setConfinementEpsilonOverride so a calibration sweep can vary the
// calibrated epsilon without a persisted knob; the receipt names the override.
// During each settle the capture samples the renderer receipt every 2 s
// (steps, enstrophy, divergence) so a trend is visible, not just an endpoint.
// Frames are admission and attribution evidence for the implementer; the
// operator judges motion live.
//
// The capture tries to lie and fails: it verifies the server's effective source
// (repo root, commit, clean tree) before admission, requires every requested
// control to take effect and the effective scheme/solver to match the arm, exits
// nonzero on a renderer error or an incomplete arm, and persists a report naming
// the failure phase and last trustworthy evidence whenever it stops early.
// Faults exercise the failure paths on a live route: `--fault arm-error` injects a
// synthetic renderer error into the first arm; `--fault packed-epsilon` perturbs
// the observed packed epsilon so the shader-facing comparison must fail;
// `--fault stale-residual` demands a residual probe newer than any step so the
// freshness check must fail; `--fault null-mode-drift` makes a null-override arm
// observe `off` so the expected-mode check must fail.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CAPTURE_IDENTITY = 'kaminos.volume.transport-arm-capture.v1';
const positional = [];
const flags = new Map();
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 1) {
  if (argv[index].startsWith('--')) { flags.set(argv[index], argv[index + 1]); index += 1; } else positional.push(argv[index]);
}
const [url, outDir, armsArg, settleArg] = positional;
const settleMs = Number(settleArg || flags.get('--settle-ms') || 12000);
const expectedRepoRoot = flags.has('--expected-repo-root') ? resolve(String(flags.get('--expected-repo-root'))) : null;
const expectedCommit = flags.has('--expected-commit') ? String(flags.get('--expected-commit')) : null;
const fault = String(flags.get('--fault') || '');
const reportPath = `${outDir || '.'}/report.json`;
const report = {
  identity: CAPTURE_IDENTITY,
  startedAt: new Date().toISOString(),
  status: 'running',
  failurePhase: 'argument-validation',
  failure: null,
  requested: { url, outDir, arms: armsArg, settleMs, expectedRepoRoot, expectedCommit, fault: fault || null },
  effective: { source: null, sourceVerified: false },
  admitted: null,
  arms: [],
  browserErrors: [],
  lastTrustworthyEvidence: {},
  finishedAt: null,
};
const writeReport = () => { try { mkdirSync(outDir, { recursive: true }); writeFileSync(reportPath, JSON.stringify(report, null, 2)); } catch { /* the failure itself is reported on stderr */ } };
class PhaseFailure extends Error { constructor(phase, message) { super(message); this.phase = phase; } }
const fail = (phase, message) => { throw new PhaseFailure(phase, message); };

if (!url || !outDir || !armsArg) fail('argument-validation', 'usage: <url> <outDir> "<arm>;<arm>" [settleMs] --expected-repo-root <dir> --expected-commit <sha>');
if (!expectedRepoRoot || !expectedCommit) { report.failure = 'expected repo root and commit are required so the capture cannot pass on an unintended server'; writeReport(); console.error(report.failure); process.exit(1); }
const FAULTS = ['arm-error', 'packed-epsilon', 'stale-residual', 'null-mode-drift'];
if (fault && !FAULTS.includes(fault)) { report.failure = `unknown fault ${fault}; known: ${FAULTS.join(', ')}`; writeReport(); console.error(report.failure); process.exit(1); }
const arms = armsArg.split(';').map(a => { const [name, ...pairs] = a.split(','); return { name, set: pairs.map(p => p.split('=')) }; });
mkdirSync(outDir, { recursive: true });
writeReport();

const port = 45141; const profile = `/tmp/kaminos-scheme-capture-${port}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let chrome = null; let ws = null;
const errors = report.browserErrors;

// Requested control value -> the effective receipt it must produce. Controls
// without an effective receipt are checked at the DOM only.
const solverExpectation = { legacy: { solver: 'legacy' }, converged: { solver: 'converged', openTop: false }, 'converged-open-top': { solver: 'converged', openTop: true } };
// `expectedMode` is the last requested confinement mode (or the admitted one), so
// an arm that only changes the override cannot complete in a different mode.
function effectiveMismatches(arm, end, expectedMode) {
  const mismatches = [];
  for (const [cid, value] of arm.set) {
    if (cid === 'volume-advection-scheme' && end.transport?.scheme !== value) mismatches.push(`scheme requested ${value}, effective ${end.transport?.scheme}`);
    if (cid === 'volume-time-step' && end.timeStep?.mode !== value) mismatches.push(`time step requested ${value}, effective ${end.timeStep?.mode}${end.timeStep?.reason ? ` (${end.timeStep.reason})` : ''}`);
    if (cid === 'volume-confinement') {
      if (end.confinement?.mode !== value) mismatches.push(`confinement requested ${value}, effective ${end.confinement?.mode}`);
      const packedMode = { 'curl-slider': 0, calibrated: 1, off: 2 }[value];
      if (end.confinementUniform?.mode !== packedMode) mismatches.push(`confinement ${value} requested but uniform slot 345 holds mode ${end.confinementUniform?.mode}`);
    }
    if (cid === '@confinementEpsilon') {
      // The shader reads uniform slot 346 (a Float32Array element), so the packed
      // value must equal the float32 rounding of the request, not just the
      // resolver's double. `packed-epsilon` perturbs the observation to prove
      // this comparison can fail.
      const packed = end.confinementUniform?.confinementAmount;
      const observed = fault === 'packed-epsilon' ? (Number(packed) || 0) + 1 : packed;
      // The drift fault targets the null-override arm specifically, the case the
      // confirmation review constructed (override-only arm ending in `off`).
      const observedMode = fault === 'null-mode-drift' && value === 'null' ? 'off' : end.confinement?.mode;
      const packedMode = { 'curl-slider': 0, calibrated: 1, off: 2 }[expectedMode];
      if (!expectedMode) mismatches.push('override requested but no confinement mode has been requested or admitted');
      else if (observedMode !== expectedMode) mismatches.push(`confinement mode drifted: expected ${expectedMode} (last requested or admitted), observed ${observedMode}`);
      else if (!(fault === 'null-mode-drift' && value === 'null') && end.confinementUniform?.mode !== packedMode) mismatches.push(`confinement mode ${expectedMode} expected but uniform slot 345 holds ${end.confinementUniform?.mode}`);
      if (value === 'null') {
        if (expectedMode === 'calibrated') {
          if (end.confinement?.calibration?.source !== 'table') mismatches.push(`null override requested but calibration source is ${end.confinement?.calibration?.source}`);
          if (observed !== Math.fround(Number(end.confinement?.calibration?.epsilon))) mismatches.push(`null override: packed epsilon ${observed} is not the table value ${end.confinement?.calibration?.epsilon}`);
        }
      } else {
        if (end.confinement?.confinementAmount !== Number(value)) mismatches.push(`confinement epsilon override ${value} requested, effective amount ${end.confinement?.confinementAmount} (mode ${end.confinement?.mode})`);
        if (observed !== Math.fround(Number(value))) mismatches.push(`packed epsilon ${observed} is not the float32 of the requested ${value} (${Math.fround(Number(value))})`);
      }
    }
    if (cid === 'volume-pressure-solver') {
      const expected = solverExpectation[value];
      if (!expected) mismatches.push(`unknown solver request ${value}`);
      else if (end.solver?.solver !== expected.solver || (expected.openTop !== undefined && Boolean(end.solver?.openTop) !== expected.openTop)) mismatches.push(`solver requested ${value}, effective ${end.solver?.solver}${end.solver?.openTop ? ' open top' : ''}`);
    }
  }
  return mismatches;
}

try {
  report.failurePhase = 'runtime-config';
  const runtimeResponse = await fetch(new URL('/api/runtime-config', url));
  if (!runtimeResponse.ok) fail('runtime-config', `runtime-config ${runtimeResponse.status}`);
  const runtimeConfig = await runtimeResponse.json();
  report.effective.source = runtimeConfig.source ?? null;
  if (resolve(String(runtimeConfig.source?.repoRoot || '')) !== expectedRepoRoot) fail('runtime-config', `effective server repo root mismatch: ${runtimeConfig.source?.repoRoot} != ${expectedRepoRoot}`);
  if (runtimeConfig.source?.commit !== expectedCommit) fail('runtime-config', `effective server commit mismatch: ${runtimeConfig.source?.commit} != ${expectedCommit}`);
  if (runtimeConfig.source?.dirty !== false) fail('runtime-config', `effective server tree is not clean (dirty=${runtimeConfig.source?.dirty})`);
  report.effective.sourceVerified = true;
  writeReport();

  report.failurePhase = 'browser-launch';
  chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new','--enable-unsafe-webgpu','--no-first-run','--no-default-browser-check',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--window-size=1400,900','about:blank'], { stdio: ['ignore','pipe','pipe'] });
  chrome.stdout.on('data', () => {}); chrome.stderr.on('data', () => {});
  let pages = null; for (let i = 0; i < 100 && !pages; i++) { try { pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(100); } }
  if (!pages) fail('browser-launch', 'devtools endpoint never answered');
  const page = pages.find(p => p.type === 'page'); ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(res => ws.addEventListener('open', res, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; } if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300)); if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300)); });
  const call = (method, params = {}) => new Promise((res, rej) => { const myId = ++id; pending.set(myId, res); setTimeout(() => { pending.delete(myId); rej(new Error('timeout ' + method)); }, 60000); ws.send(JSON.stringify({ id: myId, method, params })); });
  const evaluate = async expr => { const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluate failed'); return r.result?.result?.value; };
  const op = body => `(() => { const f = document.querySelector('#basin'); const w = f?.contentWindow || window; const d = w.document; return (${body}); })()`;
  const stateExpr = op(`(() => { const s = w.__kaminosVolumePrototype?.debugState?.(); if (!s) return null; return { backend: s.backend, error: s.error, simStepCount: s.simStepCount, frameCount: s.frameCount, transport: s.transport?.effective ?? null, transportUniform: s.transport?.uniform ?? null, predictorPasses: s.transportPredictorPasses, predictorBufferBytes: s.transport?.predictorBufferBytes ?? null, predictorAllocated: s.transport?.predictorAllocated ?? null, confinement: s.confinement?.effective ?? null, confinementUniform: s.confinement?.uniform ?? null, timeStep: s.timeStep?.effective ?? null, timeStepEmitter: s.timeStep?.emitterPacked ?? null, confinementOverride: s.confinement?.confinementEpsilonOverride ?? null, vorticity: s.pressureSolver?.residual?.vorticity ?? null, heightProfile: s.pressureSolver?.residual?.profile ?? null, breakdownTotal: s.fullGridPassBreakdown?.total, residual: s.pressureSolver?.residual ? { step: s.pressureSolver.residual.step, compactBefore: s.pressureSolver.residual.compact.before, compactAfter: s.pressureSolver.residual.compact.after } : null, solver: s.pressureSolver?.effective ?? null, forces: { fine: d.getElementById('volume-force-fine-breakup')?.checked, shred: d.getElementById('volume-force-interface-shred')?.checked, micro: d.getElementById('volume-force-micro-carrier')?.checked }, schemeDom: d.getElementById('volume-advection-scheme')?.value, schemeLabel: d.getElementById('volume-advection-scheme-val')?.textContent, commonLabel: d.getElementById('volume-common-gas-transport-val')?.textContent, projection: d.getElementById('volume-projection')?.value }; })()`);
  const setControl = (cid, value) => evaluate(op(`(() => { const e = d.getElementById(${JSON.stringify(cid)}); if (!e) throw new Error('missing ' + ${JSON.stringify(cid)}); if (e.type === 'checkbox') { e.checked = ${JSON.stringify(value)} === 'true'; } else { e.value = ${JSON.stringify(value)}; } e.dispatchEvent(new w.Event('input', { bubbles: true })); e.dispatchEvent(new w.Event('change', { bubbles: true })); return e.type === 'checkbox' ? String(e.checked) : e.value; })()`));
  await call('Page.enable'); await call('Runtime.enable'); await call('Log.enable'); await call('Page.navigate', { url });

  report.failurePhase = 'renderer-admission';
  let admitted = null; let lastProbe = null;
  for (let i = 0; i < 60 && !admitted; i++) { await sleep(1000); const s = await evaluate(stateExpr); lastProbe = s; if (s && (s.error || (s.backend && /^WebGPU:/.test(s.backend) && s.simStepCount > 10))) admitted = s; }
  report.lastTrustworthyEvidence.admissionProbe = lastProbe;
  if (!admitted) fail('renderer-admission', 'renderer never reached a WebGPU backend with more than 10 sim steps');
  if (admitted.error) fail('renderer-admission', `renderer error at admission: ${admitted.error}`);
  report.admitted = admitted;
  writeReport();

  let expectedMode = admitted.confinement?.mode ?? null;
  for (const arm of arms) {
    report.failurePhase = `arm-${arm.name}-switch`;
    const applied = [];
    for (const [cid, value] of arm.set) {
      if (cid === '@confinementEpsilon') {
        const literal = value === 'null' ? 'null' : String(Number(value));
        if (literal === 'NaN') fail(report.failurePhase, `@confinementEpsilon needs a number or null, got ${value}`);
        const applied_ = await evaluate(op(`(() => { const r = w.__kaminosVolumePrototype?.setConfinementEpsilonOverride?.(${literal}); return r ? String(r.confinementEpsilonOverride) : 'missing-api'; })()`));
        applied.push([cid, value, applied_]);
        if (applied_ !== (value === 'null' ? 'null' : String(Number(value)))) { report.lastTrustworthyEvidence.applied = applied; fail(report.failurePhase, `${cid} requested ${value} but the receipt holds ${JSON.stringify(applied_)}`); }
        continue;
      }
      if (cid.startsWith('@')) fail(report.failurePhase, `unknown debug-API control ${cid}`);
      if (cid === 'volume-confinement') expectedMode = value;
      const domValue = await setControl(cid, value);
      applied.push([cid, value, domValue]);
      if (domValue !== value) { report.lastTrustworthyEvidence.applied = applied; fail(report.failurePhase, `control ${cid} requested ${value} but the DOM holds ${JSON.stringify(domValue)}`); }
    }
    await sleep(1500);
    const after = await evaluate(stateExpr);
    if (!after) fail(report.failurePhase, 'renderer state unavailable after switch');
    report.failurePhase = `arm-${arm.name}-settle`;
    const t0 = Date.now(); const s0 = after.simStepCount;
    const samples = [];
    while (Date.now() - t0 < settleMs) {
      await sleep(Math.min(2000, Math.max(50, settleMs - (Date.now() - t0))));
      const probe = await evaluate(stateExpr);
      if (!probe) break;
      samples.push({ tMs: Date.now() - t0, simStepCount: probe.simStepCount, residualStep: probe.residual?.step ?? null, enstrophyMean: probe.vorticity?.enstrophyMean ?? null, vorticityMax: probe.vorticity?.maxAbs ?? null, compactAfterMeanAbs: probe.residual?.compactAfter?.meanAbs ?? null, error: probe.error ?? null });
    }
    let end = await evaluate(stateExpr);
    if (!end) fail(report.failurePhase, 'renderer state unavailable after settle');
    if (fault === 'arm-error' && report.arms.length === 0) end = { ...end, error: 'synthetic-fault:arm-error' };
    const entry = { arm: arm.name, set: arm.set, applied, afterSwitch: after, samples, end, stepsPerSecond: (end.simStepCount - s0) / ((Date.now() - t0) / 1000), screenshot: null, errorsSoFar: errors.length };
    report.arms.push(entry);
    report.lastTrustworthyEvidence.lastArm = arm.name;
    writeReport();
    if (end.error) fail(report.failurePhase, `renderer error during arm ${arm.name}: ${end.error}`);
    if (!(end.simStepCount > s0)) fail(report.failurePhase, `simulation did not advance during arm ${arm.name}`);
    // An arm's enstrophy/divergence is its own measurement only if the probe ran
    // after the switch; `stale-residual` makes that impossible to prove the check.
    const freshnessFloor = fault === 'stale-residual' ? Number.POSITIVE_INFINITY : s0;
    if (!(end.residual?.step > freshnessFloor)) fail(report.failurePhase, `stale residual: probe step ${end.residual?.step ?? 'none'} is not newer than the required floor ${freshnessFloor} (arm switch at step ${s0}${fault === 'stale-residual' ? ', fault stale-residual' : ''}); the arm's enstrophy is not its own measurement`);
    const mismatches = effectiveMismatches(arm, end, expectedMode);
    if (mismatches.length) fail(report.failurePhase, `effective state does not match arm ${arm.name}: ${mismatches.join('; ')}`);
    report.failurePhase = `arm-${arm.name}-capture`;
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    const file = `${outDir}/${arm.name}.png`; writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
    entry.screenshot = file;
    writeReport();
  }
  report.status = 'complete';
  report.failurePhase = 'complete';
  report.finishedAt = new Date().toISOString();
  writeReport();
  console.log(JSON.stringify(report.arms.map(a => ({ arm: a.arm, scheme: a.end.transport?.scheme, predictor: a.end.transport?.predictorPass, predictorBytes: a.end.predictorBufferBytes, backend: a.end.backend, error: a.end.error, steps: a.end.simStepCount, sps: Number(a.stepsPerSecond.toFixed(1)), label: a.end.schemeLabel, forces: a.end.forces, total: a.end.breakdownTotal })), null, 1));
  console.log('errors:', errors.slice(0, 5));
} catch (error) {
  report.status = 'failed';
  if (error instanceof PhaseFailure) report.failurePhase = error.phase;
  report.failure = String(error?.message || error);
  report.finishedAt = new Date().toISOString();
  writeReport();
  console.error(JSON.stringify({ status: 'failed', failurePhase: report.failurePhase, failure: report.failure, report: reportPath }, null, 2));
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* closing */ }
  chrome?.kill('SIGKILL');
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}
process.exit(process.exitCode ?? 0);
