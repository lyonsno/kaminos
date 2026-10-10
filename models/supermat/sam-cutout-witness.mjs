// Cut an image out with SAM 3 through the Kaminos Masks tab (text prompt) and
// save the RGBA cutout into the image inbox, for SuperMat's cutout-first route.
// Serves the checkout itself, drives an independent headless Chrome, and
// writes a report on every path naming the phase and the effective package.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { launchChrome, openPage } from './chrome-cdp.mjs';

const { values } = parseArgs({ options: Object.fromEntries(
  ['repo-root', 'assets-dir', 'sam-packet-root', 'image-path', 'prompt', 'chrome', 'port', 'report', 'screenshot', 'timeout-ms']
    .map(name => [name, { type: 'string' }])) });
const output = path.resolve(values.report ?? 'sam-cutout-report.json');
const report = { schema: 'supermat.sam-cutout-witness.v0', status: 'failed', phase: 'arguments', command: process.argv };
const persist = async () => {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
};
let server, browser;
try {
  await persist();
  for (const name of ['repo-root', 'assets-dir', 'sam-packet-root', 'image-path', 'prompt', 'chrome', 'port']) {
    if (!values[name]) throw new Error(`--${name} is required`);
  }
  const root = values['repo-root'];
  report.source = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: execFileSync('git', ['status', '--porcelain', '--', 'sam-image-tools.js', 'index.html', 'webgpu-inference-kit/src'],
      { cwd: root, encoding: 'utf8' }) };
  report.packet = { root: values['sam-packet-root'],
    manifestBytes: (await fs.stat(path.join(values['sam-packet-root'], 'tensor-manifest.json'))).size };

  report.phase = 'server';
  server = spawn('python3', ['serve.py', values.port], { cwd: root, stdio: 'ignore',
    env: { ...process.env, KAMINOS_ASSETS_DIR: values['assets-dir'], KAMINOS_SAM3_PACKET_ROOT: values['sam-packet-root'] } });
  const base = `http://127.0.0.1:${values.port}`;
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null) throw new Error(`server exited with ${server.exitCode}`);
    try { const config = await (await fetch(`${base}/api/runtime-config`)).json(); report.runtimeConfig = config.sam3 ?? null; break; } catch {}
    if (attempt > 150) throw new Error('server did not answer');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!report.runtimeConfig?.mounted) throw new Error(`SAM 3 package not mounted: ${JSON.stringify(report.runtimeConfig)}`);

  report.phase = 'browser';
  browser = await launchChrome({ chrome: values.chrome, onExit: exit => { report.ownedBrowserExit = exit; } });
  report.browser = { executable: browser.executable, product: browser.version.product };
  const url = `${base}/?sam=1&image_root=image-inbox&image_path=${encodeURIComponent(values['image-path'])}`;
  report.requestedUrl = url;
  const session = await openPage(browser.cdp, url);
  const evaluate = async expression => {
    const result = await browser.cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
    if (result.exceptionDetails) throw new Error(`page exception: ${JSON.stringify(result.exceptionDetails).slice(0, 800)}`);
    return result.result.value;
  };
  const timeoutMs = Number(values['timeout-ms'] ?? 300000);
  const waitFor = async (label, expression) => {
    const started = Date.now();
    for (;;) {
      if (await evaluate(expression)) return;
      if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  };

  report.phase = 'image-load';
  await waitFor('SAM tools', `Boolean(window.kaminosSamImageTools)`);
  await waitFor('image', `(() => { const p = window.kaminosSamImageTools.progress(); return Boolean(p.source) && !p.busy; })()`);
  report.sourceImage = await evaluate(`(() => { const s = window.kaminosSamImageTools.progress().source;
    return { name: s.name, sha256: s.sha256, encodedResolution: s.encodedResolution }; })()`);

  report.phase = 'segmentation';
  const prompt = JSON.stringify(values.prompt);
  report.segmentation = await evaluate(`(async () => {
    document.getElementById('sam-image-prompt').value = ${prompt};
    const started = performance.now();
    const o = await window.kaminosSamImageTools.run();
    if (!o) return { error: document.getElementById('sam-image-status')?.innerText ?? 'no output' };
    return { promptText: o.promptText, outputAuthority: o.outputAuthority, width: o.width, height: o.height,
      imageCache: o.imageCache?.status, elapsedMs: performance.now() - started,
      instances: o.instances.map(i => ({ index: i.index, score: i.score, box: i.box, foregroundPixelCount: i.foregroundPixelCount })) };
  })()`);
  if (report.segmentation.error) throw new Error(`segmentation failed: ${report.segmentation.error}`);
  if (!report.segmentation.instances.length) throw new Error(`no instances for prompt ${values.prompt}`);

  report.phase = 'cutout';
  report.cutout = await evaluate(`(async () => { const e = await window.kaminosSamImageTools.save('cutout');
    return e ? { source: e.source, name: e.name ?? null, relativePath: e.relativePath ?? e.path ?? null } : null; })()`);
  if (!report.cutout) throw new Error('cutout was not saved');
  if (values.screenshot) {
    const shot = await browser.cdp.call('Page.captureScreenshot', { format: 'png' }, session);
    await fs.writeFile(path.resolve(values.screenshot), Buffer.from(shot.data, 'base64'));
    report.screenshot = path.resolve(values.screenshot);
  }
  report.phase = 'complete';
  report.status = 'passed';
} catch (error) {
  report.error = `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`;
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill();
  await persist();
  console.log(JSON.stringify({ status: report.status, phase: report.phase, error: report.error ?? null, report: output }));
}
