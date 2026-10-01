#!/usr/bin/env node

// Transport arm capture: loads one saved basin on the live Apple WebGPU route,
// applies a sequence of control arms through the cockpit DOM (persistent history,
// not paired resets), settles each arm, records the renderer receipt (transport,
// pressure solver, divergence residual, pass ledger, browser errors) and captures
// one frame per arm. Usage:
//   node volume-transport-arm-capture.mjs <url> <outDir> "<arm>;<arm>;..." [settleMs] \
//     --expected-repo-root <checkout> --expected-commit <sha> [--fault arm-error] \
//     [--settle-steps N] [--call-timeout-ms N]
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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { effectiveMismatches, resolveHeadlessBrowser } from './volume-arm-capture-checks.mjs';

const CAPTURE_IDENTITY = 'kaminos.volume.transport-arm-capture.v1';
const positional = [];
const flags = new Map();
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 1) {
  if (argv[index].startsWith('--')) { flags.set(argv[index], argv[index + 1]); index += 1; } else positional.push(argv[index]);
}
const [url, outDir, armsArg, settleArg] = positional;
const settleMs = Number(settleArg || flags.get('--settle-ms') || 12000);
// --settle-steps N settles each arm until the simulation has advanced N steps
// (equal simulated time across time-step modes when N is chosen as T / dt),
// with settleMs then acting as a wall-clock cap that fails the arm if reached.
const settleSteps = flags.has('--settle-steps') ? Number(flags.get('--settle-steps')) : null;
// --call-timeout-ms N bounds each devtools call (default 60 s). The report records
// the value in force, so a slow page is failed by a named caller input, never a
// hidden cap.
const callTimeoutMs = Number(flags.get('--call-timeout-ms') || 60000);
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
  requested: { url, outDir, arms: armsArg, settleMs, settleSteps, callTimeoutMs, expectedRepoRoot, expectedCommit, fault: fault || null },
  effective: { source: null, sourceVerified: false },
  // The browser this run spawned and drove; a capture must never attach to
  // another instance (2026-09-26: a fixed port let it attach to an orphan).
  browser: { executable: null, resolvedExecutable: null, executableSource: null, version: null, pid: null, port: null, profile: null, devtoolsUrl: null },
  cleanupWarning: null,
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

const profile = mkdtempSync(join(tmpdir(), 'kaminos-scheme-capture-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let chrome = null; let ws = null;
// A killed capture takes its browser with it and leaves a report naming the
// interruption, so no orphan keeps the GPU or a devtools port.
const shutdown = signal => {
  try { chrome?.kill('SIGKILL'); } catch { /* already gone */ }
  if (report.status !== 'complete') { report.status = 'failed'; report.failure = report.failure || `interrupted by ${signal} during ${report.failurePhase}`; report.finishedAt = new Date().toISOString(); }
  writeReport();
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* best effort on the way out */ }
  process.exit(130);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
const errors = report.browserErrors;

// Requested control value -> the effective receipt it must produce: see
// volume-arm-capture-checks.mjs (effectiveMismatches).

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
  // An independent executable, never the installed GUI Chrome (shared operator machine).
  let headlessBrowser;
  try { headlessBrowser = resolveHeadlessBrowser(); } catch (error) { fail('browser-launch', String(error?.message || error)); }
  report.browser.executable = headlessBrowser.executable; report.browser.resolvedExecutable = headlessBrowser.resolvedExecutable; report.browser.executableSource = headlessBrowser.source; report.browser.profile = profile; writeReport();
  // A launch error Node reports asynchronously (ENOENT, EACCES) must reach the
  // same failure and cleanup path as everything else, not end the process.
  let launchError = null;
  chrome = spawn(headlessBrowser.executable, ['--headless=new','--enable-unsafe-webgpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--window-size=1400,900','about:blank'], { stdio: ['ignore','pipe','pipe'] });
  chrome.on('error', error => { launchError = error; });
  chrome.stdout.on('data', () => {}); chrome.stderr.on('data', () => {});
  // Chrome publishes the port it actually bound in DevToolsActivePort inside this
  // run's own profile directory, so the capture can only attach to the browser it spawned.
  let port = null;
  for (let i = 0; i < 200 && port === null; i++) { if (launchError) fail('browser-launch', `${headlessBrowser.executable} failed to launch: ${String(launchError?.message || launchError)}`); try { const line = readFileSync(`${profile}/DevToolsActivePort`, 'utf8').split('\n')[0].trim(); if (/^\d+$/.test(line)) port = Number(line); } catch { /* not written yet */ } if (port === null) await sleep(100); }
  if (port === null) fail('browser-launch', `the spawned browser (pid ${chrome.pid}) never published DevToolsActivePort in ${profile}`);
  let pages = null; for (let i = 0; i < 100 && !pages; i++) { try { pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(100); } }
  if (!pages) fail('browser-launch', `devtools endpoint on port ${port} (pid ${chrome.pid}) never answered`);
  const page = pages.find(p => p.type === 'page');
  // The version is read before the socket is opened: an await between
  // constructing the socket and attaching the open listener can miss the open
  // event and wait forever (which is what happened at 5ec49992).
  let browserVersion = null; try { browserVersion = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json())?.Browser ?? null; } catch { /* recorded as null */ }
  report.browser = { executable: headlessBrowser.executable, resolvedExecutable: headlessBrowser.resolvedExecutable, executableSource: headlessBrowser.source, version: browserVersion, pid: chrome.pid, port, profile, devtoolsUrl: page.webSocketDebuggerUrl };
  writeReport();
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { const timer = setTimeout(() => rej(new PhaseFailure('browser-launch', `devtools socket did not open within ${callTimeoutMs} ms (--call-timeout-ms)`)), callTimeoutMs); ws.addEventListener('open', () => { clearTimeout(timer); res(); }, { once: true }); ws.addEventListener('error', () => { clearTimeout(timer); rej(new PhaseFailure('browser-launch', 'devtools socket error before open')); }, { once: true }); });
  let id = 0; const pending = new Map();
  const callTimeout = (ms, label) => new Error(`${label} after ${ms} ms (--call-timeout-ms)`);
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; } if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300)); if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300)); });
  const call = (method, params = {}) => new Promise((res, rej) => { const myId = ++id; pending.set(myId, res); setTimeout(() => { pending.delete(myId); rej(callTimeout(callTimeoutMs, 'timeout ' + method)); }, callTimeoutMs); ws.send(JSON.stringify({ id: myId, method, params })); });
  const evaluate = async expr => { const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluate failed'); return r.result?.result?.value; };
  const op = body => `(() => { const f = document.querySelector('#basin'); const w = f?.contentWindow || window; const d = w.document; return (${body}); })()`;
  const stateExpr = op(`(() => { const s = w.__kaminosVolumePrototype?.debugState?.(); if (!s) return null; return { backend: s.backend, error: s.error, simStepCount: s.simStepCount, frameCount: s.frameCount, transport: s.transport?.effective ?? null, transportUniform: s.transport?.uniform ?? null, predictorPasses: s.transportPredictorPasses, predictorBufferBytes: s.transport?.predictorBufferBytes ?? null, predictorAllocated: s.transport?.predictorAllocated ?? null, confinement: s.confinement?.effective ?? null, confinementUniform: s.confinement?.uniform ?? null, timeStep: s.timeStep?.effective ?? null, timeStepEmitter: s.timeStep?.emitterPacked ?? null, inflowBoundary: s.inflowBoundary ?? null, emitterSourceLaw: s.analyticEmitterSourceLaw ?? null, wind: s.wind ?? null, confinementOverride: s.confinement?.confinementEpsilonOverride ?? null, vorticity: s.pressureSolver?.residual?.vorticity ?? null, heightProfile: s.pressureSolver?.residual?.profile ?? null, breakdownTotal: s.fullGridPassBreakdown?.total, residual: s.pressureSolver?.residual ? { step: s.pressureSolver.residual.step, compactBefore: s.pressureSolver.residual.compact.before, compactAfter: s.pressureSolver.residual.compact.after } : null, solver: s.pressureSolver?.effective ?? null, forces: { fine: d.getElementById('volume-force-fine-breakup')?.checked, shred: d.getElementById('volume-force-interface-shred')?.checked, micro: d.getElementById('volume-force-micro-carrier')?.checked }, schemeDom: d.getElementById('volume-advection-scheme')?.value, schemeLabel: d.getElementById('volume-advection-scheme-val')?.textContent, commonLabel: d.getElementById('volume-common-gas-transport-val')?.textContent, projection: d.getElementById('volume-projection')?.value }; })()`);
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
    let settledBySteps = false;
    while (Date.now() - t0 < settleMs) {
      await sleep(Math.min(2000, Math.max(50, settleMs - (Date.now() - t0))));
      const probe = await evaluate(stateExpr);
      if (!probe) break;
      samples.push({ tMs: Date.now() - t0, simStepCount: probe.simStepCount, residualStep: probe.residual?.step ?? null, enstrophyMean: probe.vorticity?.enstrophyMean ?? null, vorticityMax: probe.vorticity?.maxAbs ?? null, compactAfterMeanAbs: probe.residual?.compactAfter?.meanAbs ?? null, error: probe.error ?? null });
      if (settleSteps !== null && probe.simStepCount - s0 >= settleSteps) { settledBySteps = true; break; }
    }
    if (settleSteps !== null && !settledBySteps) fail(report.failurePhase, `arm ${arm.name} did not reach ${settleSteps} settle steps within the ${settleMs} ms wall cap`);
    let end = await evaluate(stateExpr);
    if (!end) fail(report.failurePhase, 'renderer state unavailable after settle');
    if (fault === 'arm-error' && report.arms.length === 0) end = { ...end, error: 'synthetic-fault:arm-error' };
    const entry = { arm: arm.name, set: arm.set, applied, afterSwitch: after, samples, settledBySteps, settleStepsRequested: settleSteps, end, stepsPerSecond: (end.simStepCount - s0) / ((Date.now() - t0) / 1000), screenshot: null, errorsSoFar: errors.length };
    report.arms.push(entry);
    report.lastTrustworthyEvidence.lastArm = arm.name;
    writeReport();
    if (end.error) fail(report.failurePhase, `renderer error during arm ${arm.name}: ${end.error}`);
    if (!(end.simStepCount > s0)) fail(report.failurePhase, `simulation did not advance during arm ${arm.name}`);
    // An arm's enstrophy/divergence is its own measurement only if the probe ran
    // after the switch; `stale-residual` makes that impossible to prove the check.
    const freshnessFloor = fault === 'stale-residual' ? Number.POSITIVE_INFINITY : s0;
    if (!(end.residual?.step > freshnessFloor)) fail(report.failurePhase, `stale residual: probe step ${end.residual?.step ?? 'none'} is not newer than the required floor ${freshnessFloor} (arm switch at step ${s0}${fault === 'stale-residual' ? ', fault stale-residual' : ''}); the arm's enstrophy is not its own measurement`);
    const mismatches = effectiveMismatches(arm, end, expectedMode, fault);
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
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  catch (error) { report.cleanupWarning = `profile removal failed: ${String(error?.message || error)}`; writeReport(); console.error(report.cleanupWarning); }
}
process.exit(process.exitCode ?? 0);
