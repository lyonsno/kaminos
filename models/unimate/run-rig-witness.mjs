// Import a rigged .glb in the demo page the way a visitor would, then generate on it.
// Usage: node run-rig-witness.mjs --chrome <exe> --weights <dir> --t5 <dir> --bundle <dir> --rig <file.glb> --out <dir>
//        [--rest x180] [--labels <fixture.json>] [--prompt "An object walks forward."] [--seed 1] [--labeler <zip url>]
// Serves the page with the local weights, imports the rig through the page's own path (rule
// labeller in Pyodide, conditioning, T5 label embeddings), optionally applies the labels and
// facing pair of an upstream fixture (tests/export-rig-fixtures.py) through the review panel,
// writes the conditioning the page built to conditioning.json, generates, and captures the
// result. report.json names the browser, page URL, source revision and last phase reached.
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, sourceIdentity, startServer } from '../flux2-klein/cdp-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const chrome = opt('--chrome'), outDir = path.resolve(opt('--out', '')), rigPath = path.resolve(opt('--rig', ''));
const prompt = opt('--prompt', 'An object walks forward.'), seed = Number(opt('--seed', '1'));
const report = { schema: 'kaminos.unimate.rig-witness.v0', requestedChrome: chrome, rig: rigPath, labels: opt('--labels') ?? null, prompt, seed,
  host: os.hostname(), startedAt: new Date().toISOString(), source: sourceIdentity(here), phase: 'launch', captures: [] };
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
const status = () => browser.evaluate(`document.getElementById('status').textContent`, false);
async function untilStatus(test, timeoutS, what) {
  const t0 = Date.now();
  for (;;) {
    const s = await status();
    if (s.startsWith('Could not')) throw new Error(`${what}: ${s}`);
    if (test(s)) return (Date.now() - t0) / 1000;
    if (Date.now() - t0 > timeoutS * 1000) throw new Error(`${what}: timed out (${s})`);
    await wait(400);
  }
}
try {
  if (!chrome || !opt('--out') || !opt('--rig')) throw new Error('need --chrome, --rig and --out');
  await fsp.mkdir(outDir, { recursive: true });
  const started = await startServer({ '/weights/': path.resolve(opt('--weights', '')), '/t5/': path.resolve(opt('--t5', '')),
    '/demo/': path.resolve(opt('--bundle', '')), '/rig/': path.dirname(rigPath), '/': path.resolve(here, '../..') });
  server = started.server;
  report.pageUrl = `${started.origin}/models/unimate/index.html${opt('--labeler') ? `?labeler=${encodeURIComponent(opt('--labeler'))}` : ''}`;
  browser = await launchChrome(chrome, ['--window-size=1280,800'], report);
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  report.phase = 'load';
  await browser.navigate(report.pageUrl, 'Boolean(window.__unimateDemo)');
  for (const t0 = Date.now(); (await browser.evaluate('window.__unimateDemo.phase', false)) !== 'ready';) {
    if (Date.now() - t0 > 900000) throw new Error('page did not become ready');
    await wait(500);
  }
  report.phase = 'import';
  const file = path.basename(rigPath);
  // The page records the imported rig (window.__unimateDemo.rig) or the failure (rigError).
  const rigState = async (what, timeoutS) => {
    const t0 = Date.now();
    for (;;) {
      const st = await browser.evaluate('JSON.parse(JSON.stringify({ rig: window.__unimateDemo.rig ?? null, error: window.__unimateDemo.rigError ?? null }))', false);
      if (st.error) throw new Error(`${what}: ${st.error}`);
      if (st.rig) return (Date.now() - t0) / 1000;
      if (Date.now() - t0 > timeoutS * 1000) throw new Error(`${what}: timed out (${await status()})`);
      await wait(400);
    }
  };
  await browser.evaluate('window.__unimateDemo.rig = null; window.__unimateDemo.rigError = null; true', false);
  await browser.evaluate(`fetch('/rig/${encodeURIComponent(file)}').then(r => r.arrayBuffer()).then(b => window.__unimateImportRig(b, ${JSON.stringify(file)})), true`, false);
  report.importSeconds = await rigState('import', 600);
  report.autoLabels = await browser.evaluate('JSON.parse(JSON.stringify(window.__unimateDemo.rig))', false);
  if (opt('--rest')) {
    report.phase = 'rest-rotation';
    await browser.evaluate('window.__unimateDemo.rig = null; true', false);
    await browser.evaluate(`window.__unimateSetRigRest(${JSON.stringify(opt('--rest'))})`, true);
    await rigState('rest rotation', 300);
    report.turnedLabels = await browser.evaluate('JSON.parse(JSON.stringify(window.__unimateDemo.rig))', false);
  }
  if (opt('--labels')) {
    report.phase = 'apply-labels';
    const fx = JSON.parse(await fsp.readFile(opt('--labels'), 'utf8'));
    const names = report.autoLabels ? await browser.evaluate('window.__unimateDemoInstance.bundle.skeleton.jointNames', false) : [];
    // Fixture labels are in export order, the page's table in rig order (the same order: both are the export's).
    const face = fx.annotation.face?.r_hip?.raw ? { right: fx.annotation.face.r_hip.raw, left: fx.annotation.face.l_hip.raw, bodyAxis: Boolean(fx.annotation.face.body_axis) } : null;
    await browser.evaluate('window.__unimateDemo.rig = null; true', false);
    await browser.evaluate(`window.__unimateApplyRigLabels(${JSON.stringify({ clean: fx.annotation.clean, face })})`, true);
    await rigState('apply labels', 300);
    report.appliedLabels = await browser.evaluate('JSON.parse(JSON.stringify(window.__unimateDemo.rig))', false);
    report.bfsNames = names;
  }
  await wait(800);
  await capture('01-imported-rest-pose');
  report.phase = 'conditioning';
  const cond = await browser.evaluate(`(() => { const d = window.__unimateDemoInstance, a = d.arrays;
    const o = { skeleton: d.bundle.skeleton, imported: d.bundle.imported };
    for (const k of ['tpos', 'tposParents', 'depths', 'jointNamesEmb', 'spectral', 'graphDist', 'jointRelations', 'mean', 'std', 'restPositions']) o[k] = Array.from(a[k]);
    return o; })()`, false);
  await fsp.writeFile(path.join(outDir, 'conditioning.json'), JSON.stringify(cond));
  report.phase = 'generate';
  await browser.evaluate(`window.__unimateGenerate(${JSON.stringify(prompt)}, ${seed}).catch(() => {}), true`, false);
  for (const t0 = Date.now(); ;) {
    const p = await browser.evaluate('JSON.parse(JSON.stringify(window.__unimateDemo))', false);
    if (p.phase === 'done') { report.result = p.result; break; }
    if (p.phase === 'failed' || p.phase === 'stopped') throw new Error(`generation ${p.phase}: ${p.error}`);
    if (Date.now() - t0 > 900000) throw new Error('generation timed out');
    await wait(500);
  }
  for (const [i, f] of [[2, 10], [3, 30], [4, 50]]) {
    await browser.evaluate(`window.__unimateDemoInstance.seek(${f})`, false);
    await wait(300);
    await capture(`0${i}-generated-f${f}`);
  }
  report.phase = 'finished';
  report.verdict = 'COMPLETED';
  await finish(0);
} catch (e) {
  report.error = String(e?.stack ?? e);
  report.verdict = 'ERROR';
  await finish(2);
}
