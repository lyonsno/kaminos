#!/usr/bin/env node
// Fire proxy cost sweep. Hold one fire state, then render it through a ladder of
// ray steps × render scale × stepping mode. Each arm records the effective
// controls, the fire canvas size, the fire frame's submit-to-completion time
// while presenting, and the held frame itself, so the cheapest arm that still
// reads as the same fire can be picked by eye with its cost beside it.
//
// Claim ceiling: fire-frame queue completion (the existing raf-and-queue proxy)
// in one browser, including any earlier work on the shared queue. It is not an
// isolated pass timing and not presented-frame latency.
//
// Usage: KAMINOS_CHROME=<Chrome for Testing> node scripts/fire-proxy-cost-sweep.mjs \
//   --out <dir> [--preset <vsp-id>] [--port 18731] [--debug-port 9731] [--settle-steps 200]
import { spawn, execFile, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireSweepArmAdmission } from '../proxy-evidence-admission.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(args.get('--out') || 'fire-proxy-sweep');
// testing-crazy-optimization-basin: 96 wide, 24 ray steps, render scale 1.
const presetId = args.get('--preset') || 'vsp-e3224475f5a15b75806eab5259e2d798d29419fc7c85601740007ed547e6fd47';
const port = Number(args.get('--port') || 18731);
const debugPort = Number(args.get('--debug-port') || 9731);
const settleSteps = Number(args.get('--settle-steps') || 200);
const smoke = args.get('--smoke') === '1';  // harness check only: three short arms
const armWindowMs = Number(args.get('--arm-ms') || (smoke ? 800 : 3000));
const renderSamples = Number(args.get('--render-samples') || (smoke ? 3 : 12));
const chrome = process.env.KAMINOS_CHROME;
const delay = ms => new Promise(r => setTimeout(r, ms));
// Ambient GPU load from every process on the box (ioreg IOAccelerator), so each
// arm is read against the load it ran under. Greenroom serializes queue jobs,
// not the operator's own browser work.
const utilization = [];
const utilizationTimer = setInterval(() => execFile('/usr/sbin/ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'], (error, stdout) => {
  const m = !error && /"Device Utilization %"=(\d+)/.exec(stdout || '');
  if (m) utilization.push([Date.now(), Number(m[1])]);
}), 500);
const utilizationBetween = (t0, t1) => { const v = utilization.filter(([t]) => t >= t0 && t <= t1).map(([, u]) => u).sort((a, b) => a - b);
  return v.length ? { n: v.length, p50: v[Math.floor(v.length / 2)], max: v.at(-1) } : { n: 0 }; };

mkdirSync(out, { recursive: true });
const report = { identity: 'kaminos.fire-proxy-cost-sweep.v0', status: 'running', phase: 'source', presetId, settleSteps, armWindowMs, renderSamples, smoke,
  claim: 'fire-frame queue completion in one uncontended browser; not isolated pass timing or presented latency', arms: [], errors: [] };
const save = () => writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
save();

let server = null, browser = null, profile = null;
async function cleanup() {
  for (const child of [browser, server]) {
    if (!child || child.exitCode !== null) continue;
    const exited = new Promise(r => child.once('exit', r));
    child.kill(); await Promise.race([exited, delay(5000)]);
  }
  if (profile) try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
}

try {
  report.source = { root, head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0 };
  if (!chrome) throw Error('Set KAMINOS_CHROME to an independent Chrome for Testing executable');
  report.chrome = realpathSync(chrome);
  if (report.chrome.includes('/Applications/Google Chrome.app/')) throw Error('installed operator Chrome is not admitted');

  report.phase = 'server'; save();
  server = spawn('python3', ['serve.py', String(port)], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
  let serverErr = ''; server.stderr.on('data', d => { serverErr = (serverErr + d).slice(-4000); });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try { report.runtime = await (await fetch(`${base}/api/runtime-config`)).json(); break; }
    catch { if (i > 120 || server.exitCode !== null) throw Error(`server did not start: ${serverErr}`); await delay(250); }
  }
  if (report.runtime?.source?.repoRoot && realpathSync(report.runtime.source.repoRoot) !== realpathSync(root)) throw Error(`server serves ${report.runtime.source.repoRoot}, not ${root}`);

  report.phase = 'browser'; save();
  profile = `/private/tmp/fire-proxy-sweep-profile-${process.pid}`;
  rmSync(profile, { recursive: true, force: true }); mkdirSync(profile, { recursive: true });
  browser = spawn(report.chrome, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--headless=new', '--use-mock-keychain',
    '--password-store=basic', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 120 && !target; i++) {
    try { report.browserVersion = (await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json()).Browser;
      target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(t => t.type === 'page'); }
    catch { await delay(125); }
  }
  if (!target) throw Error('DevTools did not open');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(Error('DevTools socket failed')); });
  let nextId = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); } };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression, timeoutMs = 120000) => {
    const result = await Promise.race([send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
      delay(timeoutMs).then(() => { throw Error(`evaluate timed out: ${expression.slice(0, 80)}`); })]);
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await send('Runtime.enable');
  ws.addEventListener('message', e => { const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') report.errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') report.errors.push(m.params.args.map(a => a.value ?? a.description).join(' ')); });

  report.phase = 'load'; save();
  report.url = `${base}/index.html`;
  await send('Page.navigate', { url: report.url });
  for (let i = 0; i < 240; i++) { if (await evaluate('!!window.kaminosSceneAuthoring && !!window.kaminosViewportSettings').catch(() => false)) break; await delay(250); }

  report.phase = 'add-flame'; save();
  await evaluate(`window.kaminosSceneAuthoring.addFlameEmitter(${JSON.stringify(presetId)}).then(() => true)`, 180000);
  report.phase = 'settle'; save();
  let state = null;
  for (let i = 0; i < 1200; i++) {
    state = await evaluate(`(() => { const d = window.__kaminosVolumePrototype?.debugState(); return d ? { active: d.active, error: d.error, simStepCount: d.simStepCount } : null; })()`);
    if (state?.error) throw Error(`volume error: ${state.error}`);
    if (state?.active && state.simStepCount >= settleSteps) break;
    await delay(250);
  }
  if (!(state?.active && state.simStepCount >= settleSteps)) throw Error(`fire did not settle: ${JSON.stringify(state)}`);

  // Frame the simulation domain and hide editor overlays so frames show only the scene and fire.
  report.camera = await evaluate(`(() => {
    window.kaminosViewportSettings.set({ overlays: false, gizmos: false });
    window.kaminosSelection?.clear?.();
    // Same box as the viewport's simulation-bounds guide: translation + scale × [-1,1] × [-1,topY] × [-1,1].
    const domain = window.kaminosFlameDomain?.read();
    const dims = window.__kaminosVolumeGridDimensions;
    if (!domain) throw Error('flame domain is not readable');
    const topY = Array.isArray(dims) && dims.length === 3 && dims[0] > 0 ? -1 + 2 * dims[1] / dims[0] : 3;
    const t = domain.translation, k = domain.scale;
    const min = [t[0] - k, t[1] - k, t[2] - k], max = [t[0] + k, t[1] + topY * k, t[2] + k], b = { min, max, dims };
    const target = min.map((v, i) => (v + max[i]) / 2), size = max.map((v, i) => v - min[i]);
    const distance = Math.max(size[1], size[0]) * 1.55;
    window.kaminosSetCameraDebugPose({ position: [target[0] + distance * 0.35, target[1] + size[1] * 0.12, target[2] + distance], target });
    return { framed: 'domain', domainBounds: b, camera: window.kaminosCameraDebugState() };
  })()`);

  const controls = await evaluate(`(() => { const d = window.__kaminosVolumePrototype.debugState(); return { raySteps: d.controls?.raySteps, renderScale: d.controls?.renderScale, adaptiveRays: d.controls?.adaptiveRays, runtimeQuality: d.runtimeQuality ?? null }; })()`);
  report.basinControls = controls;
  const productionSteps = Number(controls.raySteps) || 24, productionScale = Number(controls.renderScale) || 1;

  // Configure one arm through the operator controls, let it present, then hold
  // its frame. Queue samples are collected from the live loop during the window.
  const runArm = async arm => {
    report.phase = `arm:${arm.label}`; save();
    const armStartedAt = Date.now();
    const result = await evaluate(`(async () => {
      const arm = ${JSON.stringify(arm)};
      const r = window.__kaminosVolumePrototype;
      const setSlider = (id, value) => { const el = document.getElementById(id); el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return Number(el.value); };
      // Drive Look freeze through its slider: a slider sync re-reads every cockpit control.
      if (arm.live) { setSlider('volume-look-freeze', 0); r.setSimulationPaused(false); } else { r.setSimulationPaused(true); setSlider('volume-look-freeze', 1); }
      let steppingError = null;
      try { r.setDebugOpticalStepping({ mode: arm.mode, tolerance: arm.tolerance ?? 0.001 }); } catch (error) { steppingError = String(error.message || error); }
      const requested = { steps: setSlider('volume-steps', arm.steps), scale: setSlider('volume-render-scale', arm.scale) };
      await new Promise(resolve => setTimeout(resolve, 900));
      const samples = []; let lastCount = -1, lastValue = null;
      const startStep = r.debugState().simStepCount, t0 = performance.now();
      while (performance.now() - t0 < ${armWindowMs}) {
        const t = r.debugState().timing;
        if (t.queueDoneMs != null && (t.queueSamples !== lastCount || t.queueDoneMs !== lastValue)) { samples.push(t.queueDoneMs); lastCount = t.queueSamples; lastValue = t.queueDoneMs; }
        await new Promise(resolve => setTimeout(resolve, 60));
      }
      const d = r.debugState();
      const stepsAdvanced = d.simStepCount - startStep, windowS = (performance.now() - t0) / 1000;
      const sorted = [...samples].sort((a, b) => a - b), at = p => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null;
      // Ambient load from other processes only ever adds time, so the minimum of
      // back-to-back held-frame renders (render + readback) estimates the arm's
      // own cost; the median shows what the load did to it.
      const renders = []; let failedRenders = 0, lastFailure = null;
      for (let i = 0; i < ${renderSamples}; i++) {
        const t = performance.now(); const sample = await r.sampleFrame({ advanceSim: false, includeRgba: false, now: 4000 });
        if (sample?.ok) renders.push(performance.now() - t); else { failedRenders++; lastFailure = sample?.reason ?? 'unknown'; }
      }
      renders.sort((a, b) => a - b);
      const heldRenderMs = { n: renders.length, failed: failedRenders, lastFailure, min: renders[0] ?? null, p50: renders[renders.length >> 1] ?? null, max: renders.at(-1) ?? null };
      const primary = await r.sampleFrame({ advanceSim: false, includeRgba: true, now: 4000 });
      const frame = primary?.ok ? primary.image : null;
      const frameCheck = { ok: !!(primary?.ok && frame?.rgba?.length), reason: primary?.ok ? null : (primary?.reason ?? 'no sample'), width: frame?.width ?? null, height: frame?.height ?? null, bytes: frame?.rgba?.length ?? 0 };
      let png = null, sha256 = null;
      if (frame?.rgba?.length) {
        const canvas = document.createElement('canvas'); canvas.width = frame.width; canvas.height = frame.height;
        canvas.getContext('2d').putImageData(new ImageData(Uint8ClampedArray.from(frame.rgba), frame.width, frame.height), 0, 0);
        png = canvas.toDataURL('image/png');
        const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(frame.rgba));
        sha256 = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
      }
      return { requested, steppingError,
        effective: { raySteps: d.controls?.raySteps, renderScale: d.controls?.renderScale, adaptiveRays: d.controls?.adaptiveRays,
          opticalStepping: d.opticalStepping?.effective ?? null, tolerance: d.opticalStepping?.tolerance ?? null,
          shader: d.raymarchShaderSpecialization?.effective ?? null, physicalColor: d.physicalColor?.effective ?? null,
          runtimeQuality: d.runtimeQuality?.effective ?? null, canvas: [d.width, d.height], lookFreeze: d.controls?.lookFreeze ?? null,
          simulationPaused: d.simulationPaused ?? null, backend: d.backend },
        queueDoneMs: { n: samples.length, p50: at(0.5), p95: at(0.95), max: sorted.at(-1) ?? null }, heldRenderMs,
        simStepsPerSecond: stepsAdvanced / windowS, frameP95Ms: d.timing.frameP95Ms, cpuFrameP95Ms: d.timing.cpuFrameP95Ms,
        frame: frame ? { width: frame.width, height: frame.height } : null, frameCheck, sha256, png };
    })()`, 180000);
    if (result.png) writeFileSync(resolve(out, `${arm.label}.png`), Buffer.from(result.png.split(',')[1], 'base64'));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(resolve(out, `${arm.label}-page.png`), Buffer.from(shot.data, 'base64'));
    const admission = fireSweepArmAdmission({ steps: arm.steps, scale: arm.scale, mode: arm.mode }, result.effective, result.steppingError,
      { frame: result.frameCheck, renders: { ok: result.heldRenderMs.n, failed: result.heldRenderMs.failed } });
    const entry = { ...arm, ...result, admission, png: undefined, file: result.png ? `${arm.label}.png` : null, page: `${arm.label}-page.png`, gpuUtilization: utilizationBetween(armStartedAt, Date.now()) };
    report.arms.push(entry); save();
    return entry;
  };

  // The live arm runs the sim; every other arm holds the same frozen state. The
  // frozen ladder runs forward then reversed, so drift in ambient load shows up
  // as disagreement between the two passes instead of as a trend across arms.
  const ladder = [
    { label: 'production', steps: productionSteps, scale: productionScale, mode: 'current' },
    { label: 'reference-160', steps: 160, scale: 1, mode: 'current' },
    { label: 'production-numerical', steps: productionSteps, scale: productionScale, mode: 'numerical', tolerance: 0.001 },
  ];
  for (const steps of [12, 6]) for (const scale of [1, 0.5, 0.25]) for (const mode of ['current', 'numerical'])
    ladder.push({ label: `s${steps}-r${scale}-${mode}`, steps, scale, mode, tolerance: 0.001 });
  ladder.push({ label: 'floor-s6-r0.1', steps: 6, scale: 0.1, mode: 'current' });
  const live = { label: 'production-live', steps: productionSteps, scale: productionScale, mode: 'current', live: true };
  const arms = smoke
    ? [ladder[0], { label: 's6-r0.5-numerical', steps: 6, scale: 0.5, mode: 'numerical', tolerance: 0.001 }, { ...ladder[0], label: 'production-again' }]
    : [live, ...ladder.map(a => ({ ...a, label: `${a.label}-a` })), ...[...ladder].reverse().map(a => ({ ...a, label: `${a.label}-b` }))];
  for (const arm of arms) await runArm(arm);

  const first = report.arms.find(a => a.label === (smoke ? 'production' : 'production-a')), again = report.arms.find(a => a.label === (smoke ? 'production-again' : 'production-b'));
  report.heldStateReproduced = !!first?.sha256 && first.sha256 === again?.sha256;
  report.excludedArms = report.arms.filter(a => !a.admission.admitted).map(a => ({ label: a.label, reasons: a.admission.reasons }));
  report.status = smoke ? 'harness-smoke'
    : !report.heldStateReproduced ? 'observed-with-unreproduced-held-state'
    : report.excludedArms.length ? 'observed-with-excluded-arms' : 'observed';
  report.phase = 'complete';
} catch (error) {
  report.status = 'failed';
  report.error = String(error?.stack || error);
  process.exitCode = 1;
} finally {
  clearInterval(utilizationTimer);
  save();
  await cleanup();
}
