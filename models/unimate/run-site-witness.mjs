// Drive the published UniMate page the way a visitor would, with weights from Hugging Face.
// Usage: node run-site-witness.mjs --chrome <exe> --out <dir> [--url <page url>]
//        [--skeletons dog,cat] [--prompts "A dog runs forward.|A cat walks forward."] [--seed 1]
// Without --url, assembles the Pages site (scripts/assemble-pages-site.mjs) and serves it under
// /kaminos/ as GitHub Pages does, opening the page with ?weights=hub. Loads the page, waits for
// the model, generates once per skeleton (switching skeletons in the page), then reloads to time
// a load from the browser cache. report.json names the effective browser, page URL, the weight
// URLs the page actually fetched, and the last phase reached, on success and failure.
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, sourceIdentity, startServer } from '../flux2-klein/cdp-harness.mjs';
import { assemblePagesSite } from '../../scripts/assemble-pages-site.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const chrome = opt('--chrome'), outDir = path.resolve(opt('--out', ''));
const skeletons = opt('--skeletons', 'dog,cat').split(',');
const prompts = opt('--prompts', 'A dog runs forward.|A cat walks forward.').split('|');
const seed = Number(opt('--seed', '1'));
const report = { schema: 'kaminos.unimate.site-witness.v0', requestedChrome: chrome, host: os.hostname(), startedAt: new Date().toISOString(),
  source: sourceIdentity(here), phase: 'launch', runs: [], captures: [] };
let browser, server;
const wait = ms => new Promise(r => setTimeout(r, ms));
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
const read = () => browser.evaluate('JSON.parse(JSON.stringify(window.__unimateDemo))', false);
async function until(test, timeoutS, what) {
  const t0 = Date.now();
  for (;;) {
    const page = await read();
    if (page.phase === 'failed') throw new Error(`${what}: page failed: ${page.error}`);
    if (await test(page)) return (Date.now() - t0) / 1000;
    if (Date.now() - t0 > timeoutS * 1000) throw new Error(`${what}: timed out after ${timeoutS} s`);
    await wait(500);
  }
}
async function weightFetches() {
  return browser.evaluate(`performance.getEntriesByType('resource').map(e => e.name).filter(n => /huggingface|\\/weights\\/|\\/t5\\/|\\/demo\\//.test(n))`, false);
}
try {
  if (!chrome || !opt('--out')) throw new Error('need --chrome and --out');
  await fsp.mkdir(outDir, { recursive: true });
  if (opt('--url')) report.pageUrl = opt('--url');
  else {
    const site = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'unimate-site-')), '_site');
    assemblePagesSite(site);
    report.site = site;
    const started = await startServer({ '/kaminos/': site });
    server = started.server;
    report.pageUrl = `${started.origin}/kaminos/inference-kit/unimate/index.html?weights=hub&skeleton=${skeletons[0]}`;
  }
  browser = await launchChrome(chrome, ['--window-size=1280,800'], report, { profileDir: path.join(outDir, 'profile') });
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  report.phase = 'first-load';
  await browser.navigate(report.pageUrl, 'Boolean(window.__unimateDemo)');
  await wait(1500);
  await capture('01-gallery-while-downloading');
  report.firstLoadSeconds = await until(p => p.phase === 'ready', 1800, 'first load');
  report.firstLoadFetches = await weightFetches();
  for (let i = 0; i < skeletons.length; i++) {
    if (i > 0) {
      report.phase = `skeleton:${skeletons[i]}`;
      await browser.evaluate(`window.__unimateUseSkeleton(${JSON.stringify(skeletons[i])})`, false);
      await until(async () => (await browser.evaluate(`document.getElementById('status').textContent`, false)).startsWith('Ready'), 120, 'skeleton switch');
    }
    report.phase = `generate:${skeletons[i]}`;
    await browser.evaluate(`window.__unimateGenerate(${JSON.stringify(prompts[i] ?? prompts[0])}, ${seed}).catch(() => {}), true`, false);
    const seconds = await until(p => ['done', 'failed', 'stopped'].includes(p.phase), 900, 'generation');
    const page = await read();
    report.runs.push({ skeleton: skeletons[i], prompt: prompts[i] ?? prompts[0], seed, seconds, phase: page.phase, error: page.error, result: page.result,
      label: await browser.evaluate(`document.getElementById('now-text').textContent`, false) });
    if (page.phase !== 'done') throw new Error(`generation on ${skeletons[i]} ended ${page.phase}: ${page.error}`);
    await wait(900);
    await capture(`0${i + 2}-${skeletons[i]}-generated`);
  }
  report.phase = 'cached-load';
  await browser.navigate('about:blank', 'location.href === "about:blank"');
  await browser.navigate(report.pageUrl, 'Boolean(window.__unimateDemo)');
  report.cachedLoadSeconds = await until(p => p.phase === 'ready', 600, 'cached load');
  report.phase = 'finished';
  report.verdict = 'COMPLETED';
  await finish(0);
} catch (e) {
  report.error = String(e?.stack ?? e);
  report.verdict = 'ERROR';
  await finish(2);
}
