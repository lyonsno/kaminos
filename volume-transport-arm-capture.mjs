#!/usr/bin/env node

// Transport arm capture: loads one saved basin on the live Apple WebGPU route,
// applies a sequence of control arms through the cockpit DOM (persistent history,
// not paired resets), settles each arm, records the renderer receipt (transport,
// pressure solver, divergence residual, pass ledger, browser errors) and captures
// one frame per arm. Usage:
//   node volume-transport-arm-capture.mjs <url> <outDir> "<arm>;<arm>;..." [settleMs] \
//     --expected-repo-root <checkout> --expected-commit <sha> [--fault arm-error]
// where an arm is name[,controlId=value,...]. Frames are admission and
// attribution evidence for the implementer; the operator judges motion live.
//
// The capture tries to lie and fails: it verifies the server's effective source
// (repo root, commit, clean tree) before admission, requires every requested
// control to take effect and the effective scheme/solver to match the arm, exits
// nonzero on a renderer error or an incomplete arm, and persists a report naming
// the failure phase and last trustworthy evidence whenever it stops early.
// `--fault arm-error` injects a synthetic renderer error into the first arm so the
// failure path itself can be exercised.

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
if (fault && fault !== 'arm-error') { report.failure = `unknown fault ${fault}`; writeReport(); console.error(report.failure); process.exit(1); }
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
function effectiveMismatches(arm, end) {
  const mismatches = [];
  for (const [cid, value] of arm.set) {
    if (cid === 'volume-advection-scheme' && end.transport?.scheme !== value) mismatches.push(`scheme requested ${value}, effective ${end.transport?.scheme}`);
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
  const stateExpr = op(`(() => { const s = w.__kaminosVolumePrototype?.debugState?.(); if (!s) return null; return { backend: s.backend, error: s.error, simStepCount: s.simStepCount, frameCount: s.frameCount, transport: s.transport?.effective ?? null, transportUniform: s.transport?.uniform ?? null, predictorPasses: s.transportPredictorPasses, predictorBufferBytes: s.transport?.predictorBufferBytes ?? null, predictorAllocated: s.transport?.predictorAllocated ?? null, breakdownTotal: s.fullGridPassBreakdown?.total, residual: s.pressureSolver?.residual ? { step: s.pressureSolver.residual.step, compactBefore: s.pressureSolver.residual.compact.before, compactAfter: s.pressureSolver.residual.compact.after } : null, solver: s.pressureSolver?.effective ?? null, forces: { fine: d.getElementById('volume-force-fine-breakup')?.checked, shred: d.getElementById('volume-force-interface-shred')?.checked, micro: d.getElementById('volume-force-micro-carrier')?.checked }, schemeDom: d.getElementById('volume-advection-scheme')?.value, schemeLabel: d.getElementById('volume-advection-scheme-val')?.textContent, commonLabel: d.getElementById('volume-common-gas-transport-val')?.textContent, projection: d.getElementById('volume-projection')?.value }; })()`);
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

  for (const arm of arms) {
    report.failurePhase = `arm-${arm.name}-switch`;
    const applied = [];
    for (const [cid, value] of arm.set) {
      const domValue = await setControl(cid, value);
      applied.push([cid, value, domValue]);
      if (domValue !== value) { report.lastTrustworthyEvidence.applied = applied; fail(report.failurePhase, `control ${cid} requested ${value} but the DOM holds ${JSON.stringify(domValue)}`); }
    }
    await sleep(1500);
    const after = await evaluate(stateExpr);
    if (!after) fail(report.failurePhase, 'renderer state unavailable after switch');
    report.failurePhase = `arm-${arm.name}-settle`;
    const t0 = Date.now(); const s0 = after.simStepCount;
    await sleep(settleMs);
    let end = await evaluate(stateExpr);
    if (!end) fail(report.failurePhase, 'renderer state unavailable after settle');
    if (fault === 'arm-error' && report.arms.length === 0) end = { ...end, error: 'synthetic-fault:arm-error' };
    const entry = { arm: arm.name, set: arm.set, applied, afterSwitch: after, end, stepsPerSecond: (end.simStepCount - s0) / ((Date.now() - t0) / 1000), screenshot: null, errorsSoFar: errors.length };
    report.arms.push(entry);
    report.lastTrustworthyEvidence.lastArm = arm.name;
    writeReport();
    if (end.error) fail(report.failurePhase, `renderer error during arm ${arm.name}: ${end.error}`);
    if (!(end.simStepCount > s0)) fail(report.failurePhase, `simulation did not advance during arm ${arm.name}`);
    const mismatches = effectiveMismatches(arm, end);
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
