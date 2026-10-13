// Look at the demo page's clip gallery in an independent Chrome for Testing.
// Usage: node run-gallery-witness.mjs --chrome <exe> --weights <dir> --t5 <dir> --bundle <dir> --out <dir>
//        [--frames 0,20,40] [--width 1280 --height 800]
// Captures the page while the model is still downloading, then each gallery clip paused at
// the given frames (clip-<i>-f<frame>.png). report.json names the effective browser, page
// URL, source revision, the clips the page listed and the last phase reached.
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, sourceIdentity, startServer } from '../flux2-klein/cdp-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const chrome = opt('--chrome'), outDir = path.resolve(opt('--out', ''));
const roots = { weights: path.resolve(opt('--weights', '')), t5: path.resolve(opt('--t5', '')), bundle: path.resolve(opt('--bundle', '')) };
const frames = opt('--frames', '0,20,40').split(',').map(Number);
const width = Number(opt('--width', '1280')), height = Number(opt('--height', '800'));
const report = { schema: 'kaminos.unimate.gallery-witness.v0', requestedChrome: chrome, roots, viewport: [width, height], host: os.hostname(),
  startedAt: new Date().toISOString(), source: sourceIdentity(here), phase: 'launch', captures: [] };
let browser, server;
async function capture(name) {
  const shot = await browser.send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(outDir, `${name}.png`);
  await fsp.writeFile(file, Buffer.from(shot.result.data, 'base64'));
  report.captures.push({ name, file });
}
async function finish(code) {
  report.finishedAt = new Date().toISOString();
  await browser?.close().catch(e => { report.closeError = String(e); });
  server?.close();
  await fsp.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  process.exit(code);
}
const wait = ms => new Promise(r => setTimeout(r, ms));
try {
  if (!chrome || !opt('--out')) throw new Error('need --chrome and --out');
  await fsp.mkdir(outDir, { recursive: true });
  const started = await startServer({ '/weights/': roots.weights, '/t5/': roots.t5, '/demo/': roots.bundle, '/': path.resolve(here, '../..') });
  server = started.server;
  report.pageUrl = `${started.origin}/models/unimate/index.html`;
  browser = await launchChrome(chrome, [`--window-size=${width},${height}`], report);
  await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 });
  report.phase = 'navigate';
  await browser.navigate(report.pageUrl, 'Boolean(window.__unimateDemo?.clip)');
  await wait(600);
  report.loadingState = await browser.evaluate(`({ phase: window.__unimateDemo.phase, status: document.getElementById('status').textContent })`, false);
  await capture('00-first-clip-while-loading');
  report.clips = await browser.evaluate(`[...document.querySelectorAll('#strip .chip')].map(c => c.title)`, false);
  report.phase = 'clips';
  for (let i = 0; i < report.clips.length; i++) {
    await browser.evaluate(`window.__unimatePlayClip(${i})`, true);
    for (const f of frames) {
      await browser.evaluate(`window.__unimateDemoInstance.seek(${f})`, false);
      await wait(250);
      await capture(`clip-${String(i).padStart(2, '0')}-f${String(f).padStart(2, '0')}`);
    }
  }
  report.phase = 'finished';
  report.verdict = 'COMPLETED';
  await finish(0);
} catch (e) {
  report.error = String(e?.stack ?? e);
  report.verdict = 'ERROR';
  await finish(2);
}
