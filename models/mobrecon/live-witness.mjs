// Live witness for the hand-mesh-webgpu Workbench experiment. Serves this
// checkout with serve.py (temporary HOME and stores, no KAMINOS_* overrides),
// opens the experiment in an independent Chrome for Testing whose camera is a
// retained recording played through getUserMedia, and exercises the real
// controls: automatic crop, manual crop, a forced detector miss with manual
// fallback, reacquisition, stop/start and close/reopen. Captures screenshots;
// fails on page exceptions, console errors or WebGPU device errors. Always
// writes report.json with the phase reached.
//
// node models/mobrecon/live-witness.mjs --chrome <Chrome for Testing> --fixture <video under scratch/> --out <dir> [--base <served origin>]
// With --base, the witness exercises an already-served page (the link handed to
// the operator) instead of starting its own isolated serve.py.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from '../supermat/chrome-cdp.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
for (const k of ['--chrome', '--fixture', '--out']) if (!args.get(k)) throw new Error(`${k} required`);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(args.get('--out'));
fs.mkdirSync(out, { recursive: true });
const fixture = args.get('--fixture');
const report = { status: 'failed', phase: 'setup', root, fixture, input: 'retained_camera_recording_not_operator_live', steps: [], errors: [] };
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
save();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(resolve => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

let server, browser, temp, diagnose = async () => {};
try {
  let base = args.get('--base');
  if (!base) {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hand-mesh-webgpu-witness-'));
    for (const d of ['home', 'scenes', 'lerms', 'stores']) fs.mkdirSync(path.join(temp, d));
    const port = await freePort();
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^KAMINOS_/.test(k) && k !== 'GPU_GREENROOM_DIR'));
    server = spawn('python3', ['-u', 'serve.py', String(port), '--volume-settings-store', path.join(temp, 'stores/volume-settings.json'),
      '--no-shared-basin-store', '--volume-basin-session-store', path.join(temp, 'stores/basin-session.json'),
      '--volume-cockpit-layout-store', path.join(temp, 'stores/cockpit-layout.json')],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...env, HOME: path.join(temp, 'home'), KAMINOS_BIND_HOST: '127.0.0.1',
      KAMINOS_SCENES_DIR: path.join(temp, 'scenes'), KAMINOS_LERMS_PREVIEW_ROOT: path.join(temp, 'lerms') } });
    base = `http://127.0.0.1:${port}`;
  }
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${base}/index.html`)).ok) break; } catch {}
    if (i > 200) throw new Error('serve.py did not answer');
    await sleep(100);
  }
  report.server = { base, ownServerPid: server?.pid ?? null, runtimeConfig: await fetch(`${base}/api/runtime-config`).then(r => r.json()).catch(error => ({ error: String(error) })) };
  report.phase = 'browser'; save();
  browser = await launchChrome({ chrome: args.get('--chrome'), windowSize: '1600,1000' });
  report.browser = { executable: browser.executable, version: browser.version.product, pid: browser.child.pid };
  const { cdp } = browser;
  const { targetId } = await cdp.call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.call('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => cdp.call(method, params, sessionId);
  await call('Runtime.enable'); await call('Page.enable'); await call('Log.enable');
  const ws = cdp; // events arrive on the shared socket; collect via a polling evaluation below
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__witness = { errors: [] };
    addEventListener('error', e => window.__witness.errors.push('error: ' + (e.message || e)));
    addEventListener('unhandledrejection', e => window.__witness.errors.push('rejection: ' + (e.reason?.stack || e.reason)));
    const origError = console.error.bind(console);
    console.error = (...a) => { window.__witness.errors.push('console.error: ' + a.map(String).join(' ')); origError(...a); };
    navigator.mediaDevices.getUserMedia = async () => {
      const video = document.createElement('video'); video.muted = true; video.loop = true; video.src = ${JSON.stringify(fixture)};
      await new Promise((res, rej) => { video.onloadeddata = res; video.onerror = rej; video.load(); });
      video.currentTime = 10; await video.play(); window.__witness.fixture = video;
      return video.captureStream();
    };
    const requestDevice = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (...a) {
      const device = await requestDevice.apply(this, a);
      device.addEventListener('uncapturederror', e => window.__witness.errors.push('webgpu: ' + (e.error?.message || e.error)));
      return device;
    };` });
  const evaluate = async expression => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  // read() is async: conditions are written over r = await read().
  const when = condition => `(async () => { const r = await window.kaminosWorkbenchExperiments.read(); return Boolean(${condition}); })()`;
  const waitFor = async (expression, what, timeoutMs = 60000) => {
    const t = Date.now();
    for (;;) {
      const v = await evaluate(expression).catch(() => false);
      if (v) return v;
      const errors = await evaluate('window.__witness?.errors ?? []').catch(() => []);
      if (errors.length) throw new Error(`while waiting for ${what}: ${errors[0]}`);
      if (Date.now() - t > timeoutMs) throw new Error(`timed out waiting for ${what}`);
      await sleep(100);
    }
  };
  const shot = async name => {
    const { data } = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(data, 'base64'));
    return `${name}.png`;
  };
  const read = () => evaluate('window.kaminosWorkbenchExperiments.read()');
  diagnose = async () => {
    report.failureState = await evaluate(`({ state: window.kaminosWorkbenchExperiments?.state?.() ?? null, list: window.kaminosWorkbenchExperiments?.list?.() ?? null,
      errors: window.__witness?.errors ?? null, status: document.querySelector('[data-hand-mesh-status]')?.textContent ?? null,
      appGpu: typeof window.kaminosAppGpu })`).catch(e => String(e));
    report.failureScreenshot = await shot('failure').catch(() => null);
  };
  const step = async (name, fn) => { report.phase = name; save(); const value = await fn(); report.steps.push({ name, value }); save(); return value; };
  const url = `${base}/index.html?experiment=hand-mesh-webgpu&workspace=workbench`;
  report.url = url;
  await call('Page.navigate', { url });
  await step('open', async () => { await waitFor(`window.kaminosWorkbenchExperiments?.state?.().id === 'hand-mesh-webgpu'`, 'experiment selected', 120000); await waitFor(when('r?.identity'), 'experiment open', 120000); return read(); });
  const initial = report.steps.at(-1).value;
  if (initial.running || initial.interactionAuthority !== false || initial.identity.detector.backend !== 'webgpu-local') throw new Error('unexpected initial state');
  await step('start-control', async () => {
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Start camera').click(), true`);
    await waitFor(when('r.received >= 8'), 'eight live meshes', 120000);
    const r = await read();
    if (!r.visible || r.acquisition !== 'wilor_yolo_detector_bbox_only' || r.cropPadding !== 1.4) throw new Error(`automatic crop not effective: ${r.acquisition}`);
    return { ...r, screenshot: await shot('automatic') };
  });
  await step('mesh-changes', async () => {
    const first = (await call('Page.captureScreenshot', { format: 'png' })).data;
    const count = (await read()).received;
    await waitFor(when(`r.received >= ${count + 10}`), 'ten more meshes');
    const second = (await call('Page.captureScreenshot', { format: 'png' })).data;
    if (first === second) throw new Error('page pixels did not change across ten live meshes');
    return { changed: true, screenshot: await shot('automatic-later') };
  });
  await step('manual-control', async () => {
    await evaluate(`(() => { const s = document.querySelector('select[aria-label="Crop mode"]'); s.value = 'manual'; s.dispatchEvent(new Event('change')); return true; })()`);
    const count = (await read()).received;
    await waitFor(when(`r.received >= ${count + 3} && r.acquisition === 'operator_selected_crop_no_detector'`), 'manual crop meshes');
    return { ...(await read()), screenshot: await shot('manual') };
  });
  await step('forced-miss', async () => {
    await evaluate(`window.kaminosWorkbenchExperiments.invoke('setAcquisition', { mode: 'detector', threshold: 1 })`);
    if (await evaluate(`document.querySelector('select[aria-label="Crop mode"]').value`) !== 'detector') throw new Error('crop mode control did not follow the operation');
    if (await evaluate(`document.querySelector('input[aria-label="Detector threshold"]').value`) !== '1') throw new Error('threshold control did not follow the operation');
    await waitFor(when(`r.fallback === true && r.acquisition === 'manual_crop_fallback_no_detection' && r.detectorThreshold === 1`), 'fallback');
    const r = await read();
    if (!r.visible) throw new Error('mesh hidden on fallback');
    return { ...r, screenshot: await shot('miss') };
  });
  await step('reacquire', async () => {
    await evaluate(`window.kaminosWorkbenchExperiments.invoke('setAcquisition', { threshold: 0.18 })`);
    await waitFor(when(`r.fallback === false && r.acquisition === 'wilor_yolo_detector_bbox_only'`), 'reacquisition');
    return read();
  });
  await step('left-hand', async () => {
    await evaluate(`window.kaminosWorkbenchExperiments.invoke('setHandedness', 'left')`);
    const count = (await read()).received;
    await waitFor(when(`r.received >= ${count + 3}`), 'left-hand meshes');
    const r = await read();
    if (r.handedness !== 'left' || await evaluate(`document.querySelector('select[aria-label="Hand"]').value`) !== 'left') throw new Error('handedness not applied');
    const screenshot = await shot('left');
    await evaluate(`window.kaminosWorkbenchExperiments.invoke('setHandedness', 'right')`);
    return { ...r, screenshot };
  });
  await step('stop-start', async () => {
    const stopped = await evaluate(`window.kaminosWorkbenchExperiments.invoke('stop')`);
    if (stopped.running) throw new Error('still running after stop');
    await evaluate(`window.kaminosWorkbenchExperiments.invoke('start')`);
    await waitFor(when('r.running && r.received >= 3'), 'restart meshes');
    return read();
  });
  await step('close-reopen', async () => {
    await evaluate(`window.kaminosWorkbenchExperiments.close()`);
    await evaluate(`window.kaminosWorkbenchExperiments.open('hand-mesh-webgpu')`);
    await waitFor(when('r?.identity && r.running === false'), 'reopened experiment', 120000);
    await evaluate(`window.kaminosWorkbenchExperiments.invoke('start')`);
    await waitFor(when('r.received >= 5'), 'meshes after reopen', 120000);
    const r = await read();
    await evaluate(`window.kaminosWorkbenchExperiments.invoke('stop')`);
    return { ...r, screenshot: await shot('reopened') };
  });
  const errors = await evaluate('window.__witness.errors');
  report.errors.push(...errors);
  if (errors.length) throw new Error(`${errors.length} page errors: ${errors[0]}`);
  report.status = 'passed';
  report.phase = null;
} catch (error) {
  report.error = String(error?.stack ?? error);
  await diagnose().catch(() => {});
} finally {
  save();
  await browser?.close().catch(() => {});
  server?.kill('SIGTERM');
  if (temp) fs.rmSync(temp, { recursive: true, force: true });
  report.browserClosed = browser ? browser.child.exitCode !== null || browser.child.signalCode !== null : null;
  save();
  console.log(JSON.stringify({ status: report.status, phase: report.phase, error: report.error?.split('\n')[0], out }));
  process.exitCode = report.status === 'passed' ? 0 : 1;
}
