// Replay a retained camera recording through the real demo and local file input.
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { launchChrome } from '../../models/supermat/chrome-cdp.mjs';
import { verifyHandDemoReport } from './witness-checks.js';
import { verifyVideoResponse } from './witness-input.js';

const { values: args } = parseArgs({ options: Object.fromEntries(['out', 'base', 'chrome', 'models', 'fixture', 'fixture-file', 'expected-root', 'page', 'setup-state-file'].map(key => [key, { type: 'string' }])) });
if (!args.out) throw Error('--out required');
const out = path.resolve(args.out); await fs.mkdir(out, { recursive: true });
const report = { status: 'failed', phase: 'setup', steps: [], errors: [], requested: args };
const save = () => fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
await save(); let browser, call, evaluate;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  for (const key of ['base', 'chrome', 'models', 'fixture', 'fixture-file', 'expected-root']) if (!args[key]) throw Error(`--${key} required`);
  report.runtime = await fetch(`${args.base}/api/runtime-config`).then(r => r.json());
  if (args['setup-state-file']) report.setup = JSON.parse(await fs.readFile(args['setup-state-file'], 'utf8'));
  if (report.runtime.source?.repoRoot !== args['expected-root']) throw Error('served root differs from expected root');
  report.input = { kind: 'retained-camera-video', file: path.resolve(args['fixture-file']), sha256: createHash('sha256').update(await fs.readFile(args['fixture-file'])).digest('hex') };
  report.phase = 'browser'; await save();
  browser = await launchChrome({ chrome: args.chrome, windowSize: '1440,1100' });
  report.browser = { executable: browser.executable, version: browser.version.product, pid: browser.child.pid };
  const { targetId } = await browser.cdp.call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.cdp.call('Target.attachToTarget', { targetId, flatten: true });
  call = (method, params) => browser.cdp.call(method, params, sessionId);
  await call('Page.enable'); await call('Runtime.enable'); await call('DOM.enable');
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__handWitness = { errors: [], tracks: [], failCamera: false, delayCamera: false };
    const verifyVideoResponse = ${verifyVideoResponse.toString()};
    let verifiedFixture;
    window.__loadHandFixture = async () => {
      verifiedFixture ??= verifyVideoResponse({response: await fetch(${JSON.stringify(args.fixture)}),expectedSha256:${JSON.stringify(report.input.sha256)},sourceUrl:${JSON.stringify(args.fixture)}});
      const result=await verifiedFixture;
      __handWitness.playback=result.identity;
      __handWitness.fixtureObjectURL ??= URL.createObjectURL(result.blob);
      return result.identity;
    };
    addEventListener('error', e => __handWitness.errors.push(e.message));
    addEventListener('unhandledrejection', e => __handWitness.errors.push(String(e.reason)));
    const original = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function(...a) { const d = await original.apply(this,a); d.addEventListener('uncapturederror',e=>__handWitness.errors.push(e.error.message)); return d; };
    navigator.mediaDevices.getUserMedia = async () => {
      if (__handWitness.failCamera) throw Error('injected camera failure');
      if (__handWitness.delayCamera) await new Promise(resolve=>__handWitness.resolveCamera=resolve);
      await __loadHandFixture();
      const video = document.createElement('video'); video.muted=true;video.loop=true;video.src=__handWitness.fixtureObjectURL;
      await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(Error('fixture failed'));video.load();});
      video.currentTime=10;await video.play();
      const stream=video.captureStream();__handWitness.tracks.push(...stream.getTracks());return stream;
    };` });
  evaluate = async expression => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const wait = async expression => {
    const start = Date.now();
    while (!(await evaluate(expression))) {
      const errors = await evaluate('window.__handWitness?.errors || []');
      if (errors.length) throw Error(errors.join('\n'));
      if (Date.now() - start > 120000) throw Error(`timeout: ${expression}`);
      await sleep(100);
    }
  };
  const read = () => evaluate('window.handMeshDemo.read()');
  const shot = async name => {
    const { data } = await call('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(path.join(out, `${name}.png`), Buffer.from(data, 'base64'));
  };
  const step = async (name, fn) => { report.phase = name; await save(); await fn(); report.steps.push({ name, state: await read() }); await save(); };
  const files = await fs.readdir(args.models);
  const importFolder = async (directory, asFiles = false) => {
    if (asFiles) await evaluate(`document.getElementById('files').removeAttribute('webkitdirectory');document.getElementById('files').value=''`);
    const { root } = await call('DOM.getDocument');
    const { nodeId } = await call('DOM.querySelector', { nodeId: root.nodeId, selector: '#files' });
    await call('DOM.setFileInputFiles', { nodeId, files: asFiles ? (await fs.readdir(directory)).map(file => path.resolve(directory, file)) : [path.resolve(directory)] });
  };
  report.url = `${args.base}${args.page || '/demos/hand-mesh/'}`;
  await call('Page.navigate', { url: report.url });
  await step('open', async () => { await wait('Boolean(window.handMeshDemo)'); await shot('before-import'); });
  report.phase = 'verify-input'; await save();
  report.playback = await evaluate('__loadHandFixture()'); await save();
  await step('import', async () => { if (!report.setup) await importFolder(args.models); await wait('Boolean(window.handMeshDemo.read().error) || (Boolean(window.handMeshDemo.read().identity) && !window.handMeshDemo.read().loading && !window.handMeshDemo.read().importing)'); if ((await read()).error) throw Error((await read()).error); await shot('loaded'); });
  await step('live', async () => {
    // The deterministic fixture has accepted real detections at 0.18; this
    // exercises the user's confidence control without selecting a calibration.
    await evaluate(`document.getElementById('threshold').value='0.18';document.getElementById('threshold').dispatchEvent(new Event('input'));document.getElementById('start').click()`);
    await wait('window.handMeshDemo.read().received >= 5 && window.handMeshDemo.read().visible'); await shot('live');
  });
  await step('miss', async () => { await evaluate(`document.getElementById('threshold').value='1';document.getElementById('threshold').dispatchEvent(new Event('input'))`); await wait(`window.handMeshDemo.read().presentation === 'no-hand'`); await shot('no-hand'); });
  await step('reacquire', async () => { await evaluate(`document.getElementById('threshold').value='0.18';document.getElementById('threshold').dispatchEvent(new Event('input'))`); await wait('window.handMeshDemo.read().visible'); });
  await step('mobile', async () => { await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await shot('mobile'); await call('Emulation.clearDeviceMetricsOverride'); });
  await step('stop', async () => { await evaluate(`document.getElementById('start').click()`); await wait(`window.handMeshDemo.read().cameraState === 'off'`); if (await evaluate(`__handWitness.tracks.some(t=>t.readyState!=='ended')`)) throw Error('tracks survive Stop'); });
  await step('invalid-import', async () => { const invalid=path.join(out,'invalid-models');await fs.mkdir(invalid);await fs.copyFile(path.join(args.models,'mobrecon.package.json'),path.join(invalid,'mobrecon.package.json'));await importFolder(invalid, true); await wait(`document.getElementById('models-status').textContent.includes('missing') || document.getElementById('models-status').textContent.includes('Missing')`); if (!(await read()).identity) throw Error('invalid import discarded loaded models'); });
  await step('corrupt-import', async () => {
    const corrupt=path.join(out,'corrupt-models');await fs.mkdir(corrupt);
    for(const file of files)await fs.copyFile(path.join(args.models,file),path.join(corrupt,file));
    const handle=await fs.open(path.join(corrupt,'mobrecon.bin'),'r+');try{const b=Buffer.alloc(1);await handle.read(b,0,1,0);b[0]^=255;await handle.write(b,0,1,0);}finally{await handle.close();}
    await importFolder(corrupt, true);
    await wait(`document.getElementById('models-status').textContent.toLowerCase().includes('sha256') || document.getElementById('models-status').textContent.toLowerCase().includes('sha-256') || document.getElementById('models-status').textContent.toLowerCase().includes('digest')`);
    if (!(await read()).identity) throw Error('corrupt import discarded loaded models');
  });
  await step('reload', async () => { await call('Page.reload'); await wait(`window.handMeshDemo?.read().source === '${report.setup ? 'local-server' : 'browser-storage'}' && !window.handMeshDemo.read().loading`); });
  await step('camera-failure', async () => { await evaluate(`__handWitness.failCamera=true;document.getElementById('start').click()`); await wait(`Boolean(window.handMeshDemo.read().error)`); const r=await read(); if(r.running || r.cameraState!=='off')throw Error('camera failure left camera running'); await evaluate('__handWitness.failCamera=false'); });
  await step('cancel-pending', async () => {
    await evaluate(`__handWitness.delayCamera=true;document.getElementById('start').click()`); await wait('window.handMeshDemo.read().starting');
    await evaluate(`document.getElementById('start').click();__handWitness.resolveCamera()`);
    await wait(`__handWitness.tracks.length > 0 && __handWitness.tracks.every(t=>t.readyState==='ended')`);
    const r=await read();if(r.running||r.cameraState!=='off')throw Error('late camera grant restarted cancelled camera');await evaluate('__handWitness.delayCamera=false');
  });
  await step('restart', async () => { await evaluate(`document.getElementById('threshold').value='0.18';document.getElementById('start').click()`); await wait('window.handMeshDemo.read().received >= 3'); await shot('restarted'); await evaluate(`document.getElementById('start').click()`); await wait(`window.handMeshDemo.read().cameraState === 'off'`); });
  report.errors = await evaluate('__handWitness.errors');
} catch (cause) {
  report.error = String(cause.stack || cause);
  if (evaluate) report.failureState = await evaluate(`({state:window.handMeshDemo?.read(),status:document.getElementById('status')?.textContent,models:document.getElementById('models-status')?.textContent,errors:window.__handWitness?.errors})`).catch(String);
  if (call) { const result = await call('Page.captureScreenshot', { format: 'png' }).catch(() => null); if (result) await fs.writeFile(path.join(out, 'failure.png'), Buffer.from(result.data,'base64')); }
} finally {
  await browser?.close();
  report.browserClosed = !!browser && (browser.child.exitCode !== null || browser.child.signalCode !== null);
  report.failures = verifyHandDemoReport(report, args['expected-root']);
  if (!report.failures.length) { report.status = 'passed'; report.phase = 'complete'; }
  await save(); console.log(JSON.stringify({ status: report.status, phase: report.phase, failures: report.failures, out }));
  process.exitCode = report.status === 'passed' ? 0 : 1;
}
