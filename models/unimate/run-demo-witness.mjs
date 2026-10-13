// Drive the UniMate demo page the way an operator would, in an independent Chrome for Testing.
// Usage: node run-demo-witness.mjs --chrome <exe> --weights <dir> --bundle <dir> --out <dir>
//        [--prompt 0] [--seed <n>] [--timeout-s 900] [--stall-s 180]
// Loads the page, waits for ready, presses Generate (prompt, reference noise unless --seed),
// captures the canvas before, during and after generation, exports the result as .glb, and writes report.json plus
// PNGs to --out. The report names the effective browser, page URL, source revision and the
// last phase reached, on success and failure.
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, sourceIdentity, startServer } from '../flux2-klein/cdp-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const chrome = opt('--chrome'), outDir = path.resolve(opt('--out', ''));
const roots = { weights: path.resolve(opt('--weights', '')), bundle: path.resolve(opt('--bundle', '')), t5: opt('--t5') ? path.resolve(opt('--t5')) : null };
const promptArg = opt('--prompt', '0'), prompt = /^\d+$/.test(promptArg) ? Number(promptArg) : promptArg, seed = opt('--seed', null);
const timeoutS = Number(opt('--timeout-s', '900')), stallS = Number(opt('--stall-s', '180'));
const report = { schema: 'kaminos.unimate.demo-witness.v0', requestedChrome: chrome, roots, prompt, seed, host: os.hostname(),
  startedAt: new Date().toISOString(), source: sourceIdentity(here), phase: 'launch', captures: [] };
let browser, server;
async function capture(name) {
  const shot = await browser.send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(outDir, `${name}.png`);
  await fsp.writeFile(file, Buffer.from(shot.result.data, 'base64'));
  report.captures.push({ name, file, at: new Date().toISOString() });
}
async function finish(code) {
  report.finishedAt = new Date().toISOString();
  await browser?.close().catch(e => { report.closeError = String(e); });
  server?.close();
  await fsp.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  process.exit(code);
}
try {
  if (!chrome || !opt('--out')) throw new Error('need --chrome and --out');
  await fsp.mkdir(outDir, { recursive: true });
  const started = await startServer({ '/weights/': roots.weights, '/demo/': roots.bundle, ...(roots.t5 ? { '/t5/': roots.t5 } : {}), '/': path.resolve(here, '../..') });
  server = started.server;
  report.pageUrl = `${started.origin}/models/unimate/index.html`;
  browser = await launchChrome(chrome, ['--window-size=1280,800'], report);
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  report.phase = 'navigate';
  await browser.navigate(report.pageUrl, 'Boolean(window.__unimateDemo)');
  report.phase = 'load';
  const read = () => browser.evaluate('JSON.parse(JSON.stringify(window.__unimateDemo))', false);
  const t0 = Date.now();
  let page;
  for (;;) {
    page = await read();
    if (page.phase === 'ready' || page.phase === 'failed') break;
    if (Date.now() - t0 > timeoutS * 1000) throw new Error('page did not become ready');
    await new Promise(r => setTimeout(r, 500));
  }
  if (page.phase === 'failed') throw new Error(`page failed to start: ${page.error}`);
  report.loadSeconds = (Date.now() - t0) / 1000;
  await new Promise(r => setTimeout(r, 800));
  await capture('01-ready-rest-pose');
  report.phase = 'generate';
  await browser.evaluate(`window.__unimateGenerate(${JSON.stringify(prompt)}, ${seed === null ? 'null' : Number(seed)}).catch(() => {}), true`, false);
  let last = null, lastChange = Date.now(), midShot = false;
  const g0 = Date.now();
  for (;;) {
    page = await read();
    const mark = `${page.phase}:${page.progress?.evaluations}`;
    if (mark !== last) { last = mark; lastChange = Date.now(); }
    if (!midShot && page.progress?.evaluations >= 20) { await capture('02-during-generation'); midShot = true; }
    if (['done', 'failed', 'stopped'].includes(page.phase)) break;
    if (Date.now() - g0 > timeoutS * 1000) { report.verdict = 'TIMEOUT'; break; }
    if (Date.now() - lastChange > stallS * 1000) { report.verdict = 'WEDGED'; break; }
    await new Promise(r => setTimeout(r, 500));
  }
  report.generateSeconds = (Date.now() - g0) / 1000;
  report.pagePhase = page.phase;
  report.pageError = page.error;
  report.result = page.result;
  if (page.phase === 'done') {
    for (const [i, delay] of [[3, 300], [4, 650], [5, 650]]) { await new Promise(r => setTimeout(r, delay)); await capture(`0${i}-playing`); }
    // The download: the animated .glb of this generation (read back in slices) and the joint positions it should play.
    report.phase = 'export';
    const size = await browser.evaluate('window.__unimateExportCurrent()', false);
    const parts = [];
    for (let at = 0; at < size; at += 1 << 20) parts.push(Buffer.from(await browser.evaluate(`window.__unimateExportSlice(${at}, ${at + (1 << 20)})`, false), 'base64'));
    await fsp.writeFile(path.join(outDir, 'export.glb'), Buffer.concat(parts));
    report.exportBytes = size;
    await fsp.writeFile(path.join(outDir, 'played-positions.json'), JSON.stringify(await browser.evaluate(`(() => { const d = window.__unimateDemoInstance, sk = d.bundle.skeleton;
      return { jointNames: sk.jointNames, parents: sk.parents, frames: d.view.motion.frames, positions: Array.from(d.view.motion.positions) }; })()`, false)));
  }
  report.phase = 'finished';
  report.verdict ??= page.phase === 'done' ? 'COMPLETED' : 'ERROR';
  await finish(page.phase === 'done' ? 0 : 1);
} catch (e) {
  report.error = String(e?.stack ?? e);
  report.verdict = 'ERROR';
  await finish(2);
}
