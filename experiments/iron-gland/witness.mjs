// Real model replay in the ordinary Workbench. Run under Greenroom; no live camera is acquired.
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { launchChrome } from '../../models/supermat/chrome-cdp.mjs';
import { verifyVideoResponse } from '../../demos/hand-mesh/witness-input.js';
import { verifyFrame } from './witness-checks.mjs';

const { values: args } = parseArgs({ options: Object.fromEntries(['out', 'base', 'chrome', 'models', 'fixture-file', 'expected-root'].map(k => [k, { type: 'string' }])) });
if (!args.out) throw Error('--out required');
const out = path.resolve(args.out); await fs.mkdir(out, { recursive: true });
const report = { status: 'failed', phase: 'setup', requested: args, steps: [] };
const save = () => fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let browser, server, call, evaluate;
await save();
try {
  for (const key of ['base', 'chrome', 'models', 'fixture-file', 'expected-root']) if (!args[key]) throw Error(`--${key} required`);
  const root = path.resolve(args['expected-root']);
  const url = new URL(args.base);
  if (url.hostname !== '127.0.0.1' || !url.port) throw Error('base must name a loopback server port');
  try { await fetch(`${args.base}/api/runtime-config`); throw Error('requested server port is already occupied'); }
  catch (error) { if (error.message === 'requested server port is already occupied') throw error; }
  const local = path.join(root, 'scratch/iron-gland'); await fs.mkdir(local, { recursive: true });
  for (const [name, target] of [['models', args.models], ['camera.webm', args['fixture-file']]]) {
    const dest = path.join(local, name), real = await fs.realpath(target);
    try { await fs.symlink(real, dest); }
    catch (error) { if (error.code !== 'EEXIST' || await fs.realpath(dest) !== real) throw error; }
  }
  report.input = { file: await fs.realpath(args['fixture-file']), kind: 'retained-camera-video', sha256: createHash('sha256').update(await fs.readFile(args['fixture-file'])).digest('hex') };
  const log = await fs.open(path.join(out, 'server.log'), 'a');
  server = spawn('python3', ['-u', 'serve.py', url.port], { cwd: root, stdio: ['ignore', log.fd, log.fd] });
  await log.close();
  let serverError; server.on('error', e => { serverError = e; });
  while (!report.runtime) {
    if (serverError) throw serverError;
    if (server.exitCode !== null) throw Error(`server exited ${server.exitCode}`);
    try { report.runtime = await fetch(`${args.base}/api/runtime-config`).then(r => r.json()); } catch { await sleep(100); }
  }
  if (report.runtime.source?.repoRoot !== root) throw Error('effective source checkout mismatch');
  report.phase = 'browser'; await save();
  browser = await launchChrome({ chrome: args.chrome, windowSize: '1440,1000' });
  report.browser = { executable: browser.executable, version: browser.version, pid: browser.child.pid };
  const { targetId } = await browser.cdp.call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.cdp.call('Target.attachToTarget', { targetId, flatten: true });
  call = (method, params) => browser.cdp.call(method, params, sessionId);
  await call('Page.enable'); await call('Runtime.enable');
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__ironWitness = {errors:[], tracks:[], videos:[]};
    addEventListener('error', e => __ironWitness.errors.push(e.message));
    addEventListener('unhandledrejection', e => __ironWitness.errors.push(String(e.reason)));
    const requestDevice = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function(...a) { const d=await requestDevice.apply(this,a);d.addEventListener('uncapturederror',e=>__ironWitness.errors.push(e.error.message));return d; };
    const verifyVideoResponse = ${verifyVideoResponse.toString()};
    navigator.mediaDevices.getUserMedia = async () => {
      if (__ironWitness.deny) throw Error('injected camera denial');
      if (__ironWitness.delay) await new Promise(resolve=>__ironWitness.grant=resolve);
      const verified = await verifyVideoResponse({response:await fetch('/scratch/iron-gland/camera.webm'),expectedSha256:${JSON.stringify(report.input.sha256)},sourceUrl:'/scratch/iron-gland/camera.webm'});
      __ironWitness.playback = verified.identity;
      const v=document.createElement('video');v.muted=true;v.loop=true;v.src=URL.createObjectURL(verified.blob);
      __ironWitness.videos.push(v);
      await new Promise((resolve,reject)=>{v.onloadeddata=resolve;v.onerror=()=>reject(Error('retained video failed'));v.load();});
      v.currentTime=10;await v.play();const s=v.captureStream();__ironWitness.tracks.push(...s.getTracks());return s;
    };` });
  evaluate = async expression => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const read = () => evaluate('window.kaminosWorkbenchExperiments.read()');
  const wait = async condition => {
    while (!await evaluate(condition)) {
      const errors = await evaluate('window.__ironWitness?.errors ?? []');
      if (errors.length) throw Error(errors.join('\n'));
      await sleep(100);
    }
  };
  const shot = async name => { const { data } = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(out, `${name}.png`), Buffer.from(data, 'base64')); };
  const step = async (name, fn) => { report.phase = name; await save(); await fn(); report.steps.push({ name, state: await read() }); await save(); };
  const inputs = { models: '/scratch/iron-gland/models/', threshold: .18 };
  report.url = `${args.base}/?workspace=workbench&experiment=iron-gland&experiment_inputs=${encodeURIComponent(JSON.stringify(inputs))}`;
  await call('Page.navigate', { url: report.url });
  await wait(`window.kaminosWorkbenchExperiments?.state().id === 'iron-gland'`);
  await step('models', async () => {
    await wait(`(async()=>{const s=await kaminosWorkbenchExperiments.read();return !!s.identity || (!!s.error && !s.loading)})()`);
    if ((await read()).error) throw Error((await read()).error);
  });
  await step('visible', async () => {
    await evaluate(`kaminosWorkbenchExperiments.invoke('start')`);
    await wait(`(async()=>{const s=await kaminosWorkbenchExperiments.read();if(s.error)throw Error(s.error);return s.frameCount>=3 && s.interaction.visible})()`);
    verifyFrame(await read(), { threshold: .18 }); await shot('desktop');
  });
  await step('moving', async () => {
    const before = (await read()).frameCount;
    await wait(`(async()=>{const s=await kaminosWorkbenchExperiments.read();if(s.error)throw Error(s.error);return s.frameCount>${before + 4} && s.interaction.visible})()`);
    verifyFrame(await read(), { after: before, threshold: .18 }); await shot('moving');
  });
  await step('mobile', async () => {
    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate(`kaminosWorkbenchExperiments.invoke('frame')`); await sleep(200); await shot('mobile');
    await call('Emulation.clearDeviceMetricsOverride');
  });
  await step('miss', async () => {
    await evaluate(`kaminosWorkbenchExperiments.invoke('setOptions', {threshold:1})`);
    await wait(`(async()=>{const s=await kaminosWorkbenchExperiments.read();return s.frameCount>0 && !s.interaction.visible && s.lastAcquisition?.source==='no_detection'})()`);
    await shot('no-hand');
  });
  await step('stop', async () => {
    await evaluate(`kaminosWorkbenchExperiments.invoke('stop')`);
    if (await evaluate(`__ironWitness.tracks.some(t=>t.readyState!=='ended')`)) throw Error('Stop left camera tracks live');
    const s = await read(); if (s.running || s.cameraVisible || s.interaction.visible) throw Error('Stop left live presentation');
  });
  const clickCamera = `Array.from(document.querySelectorAll('button')).find(b=>/^(Start|Stop|Cancel) camera$/.test(b.textContent)).click()`;
  await step('denied', async () => {
    await evaluate(`__ironWitness.deny=true;${clickCamera}`);
    await wait(`(async()=>!!(await kaminosWorkbenchExperiments.read()).error)()`);
    if ((await read()).running) throw Error('Denied camera is running');
    await evaluate('__ironWitness.deny=false');
  });
  await step('cancel', async () => {
    await evaluate(`__ironWitness.delay=true;${clickCamera}`);
    await wait('Boolean(__ironWitness.grant)');
    const count = await evaluate('__ironWitness.tracks.length');
    await evaluate(`${clickCamera};__ironWitness.grant()`);
    await wait(`__ironWitness.tracks.length>${count} && __ironWitness.tracks.every(t=>t.readyState==='ended')`);
    if ((await read()).running) throw Error('late permission resurrected camera');
  });
  report.playback = await evaluate('__ironWitness.playback');
  report.errors = await evaluate('__ironWitness.errors');
  if (report.errors.length) throw Error(report.errors.join('\n'));
  report.scene = await evaluate('window.kaminosWorkbenchSceneState()');
  await evaluate('kaminosWorkbenchExperiments.close()');
  report.closedScene = await evaluate('window.kaminosWorkbenchSceneState()');
  report.status = 'passed'; report.phase = 'complete';
} catch (error) {
  report.error = String(error.stack ?? error);
  if (evaluate) report.failureState = await evaluate(`(async()=>({state:await window.kaminosWorkbenchExperiments?.read(),errors:window.__ironWitness?.errors,body:document.body.innerText}))()`).catch(String);
  if (call) { const r = await call('Page.captureScreenshot', { format: 'png' }).catch(() => null); if (r) await fs.writeFile(path.join(out, 'failure.png'), Buffer.from(r.data, 'base64')); }
} finally {
  await save();
  try { await browser?.close(); } catch (e) { report.status = 'failed'; report.cleanupError = String(e); }
  if (server?.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  report.browserClosed = !browser || browser.child.exitCode !== null || browser.child.signalCode !== null;
  await save(); console.log(JSON.stringify({ status: report.status, phase: report.phase, out }));
  process.exitCode = report.status === 'passed' ? 0 : 1;
}
