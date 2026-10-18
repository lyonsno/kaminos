// Drive the UniMate consumer (unimate-consumer.js) from a minimal host page, as the Kaminos app would.
// Usage: node run-consumer-witness.mjs --chrome <exe> --out <dir> [--weights <dir> --t5 <dir>] [--rig <file.glb>]
//        [--rest x180] [--skeleton dog] [--prompt "An object walks forward."] [--seed 1] [--budget <bytes>]
//        [--page-root <dir> --page <file>]  (serve another host page, e.g. built from the installed package)
// The host page owns the device, kit session and foreground service and keeps drawing frames. The
// witness runs the consumer on a rig (or a published skeleton), saves the .glb it returns and
// report.json: stages seen, frame gaps during the run, the consumer's read(), the effective browser,
// page URL and source revision, and the last phase reached on failure too.
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, sourceIdentity, startServer } from '../flux2-klein/cdp-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const chrome = opt('--chrome'), outDir = path.resolve(opt('--out', ''));
const rig = opt('--rig') ? path.resolve(opt('--rig')) : null;
const report = { schema: 'kaminos.unimate.consumer-witness.v0', requestedChrome: chrome, rig, skeleton: opt('--skeleton') ?? null, prompt: opt('--prompt', 'An object walks forward.'),
  seed: Number(opt('--seed', '1')), budget: opt('--budget') ?? null, host: os.hostname(), startedAt: new Date().toISOString(), source: sourceIdentity(here), phase: 'launch' };
let browser, server;
const wait = ms => new Promise(r => setTimeout(r, ms));
async function finish(code) {
  report.finishedAt = new Date().toISOString();
  await browser?.close().catch(() => {});
  server?.close();
  await fsp.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  process.exit(code);
}
try {
  if (!chrome || !opt('--out')) throw new Error('need --chrome and --out');
  await fsp.mkdir(outDir, { recursive: true });
  // --page-root <dir> --page <file>: serve another host page (e.g. one built from the installed npm package).
  const pageRoot = opt('--page-root') ? path.resolve(opt('--page-root')) : null;
  const roots = pageRoot ? { '/app/': pageRoot } : { '/': path.resolve(here, '../..') };
  if (opt('--weights')) Object.assign(roots, { '/weights/': path.resolve(opt('--weights')), '/t5/': path.resolve(opt('--t5')) });
  if (rig) roots['/rig/'] = path.dirname(rig);
  const started = await startServer(roots);
  server = started.server;
  const q = new URLSearchParams({ ...(opt('--weights') ? { weights: '/weights/', t5: '/t5/' } : {}), ...(opt('--budget') ? { budget: opt('--budget') } : {}) });
  report.pageUrl = pageRoot ? `${started.origin}/app/${opt('--page', 'consumer-witness.html')}?${q}` : `${started.origin}/models/unimate/consumer-witness.html?${q}`;
  browser = await launchChrome(chrome, ['--window-size=800,600'], report);
  report.phase = 'host';
  await browser.navigate(report.pageUrl, "window.__consumerWitness && window.__consumerWitness.phase !== 'start'");
  const st0 = await browser.evaluate('JSON.parse(JSON.stringify(window.__consumerWitness))', false);
  if (st0.phase !== 'ready') throw new Error(`host failed: ${st0.error}`);
  report.phase = 'run';
  const asset = rig ? { url: `/rig/${encodeURIComponent(path.basename(rig))}`, name: path.basename(rig, '.glb'), restRotation: opt('--rest') ?? null } : { skeleton: opt('--skeleton', 'dog') };
  await browser.evaluate(`window.__runConsumer(${JSON.stringify(asset)}, ${JSON.stringify(report.prompt)}, ${report.seed}), true`, false);
  for (const t0 = Date.now(); ;) {
    const st = await browser.evaluate('JSON.parse(JSON.stringify({ phase: window.__consumerWitness.phase, error: window.__consumerWitness.error, result: window.__consumerWitness.result, frames: window.__consumerWitness.frames }))', false);
    if (['done', 'failed', 'refused'].includes(st.phase)) { Object.assign(report, { consumerPhase: st.phase, consumerError: st.error, result: st.result, hostFrames: st.frames }); break; }
    if (Date.now() - t0 > 1200000) throw new Error('consumer run timed out');
    await wait(1000);
  }
  if (report.consumerPhase === 'done') {
    const size = report.result.glbBytes, parts = [];
    for (let at = 0; at < size; at += 1 << 20) parts.push(Buffer.from(await browser.evaluate(`window.__consumerSlice(${at}, ${at + (1 << 20)})`, false), 'base64'));
    await fsp.writeFile(path.join(outDir, 'result.glb'), Buffer.concat(parts));
  }
  report.phase = 'finished';
  report.verdict = report.consumerPhase === 'done' ? 'COMPLETED' : report.consumerPhase.toUpperCase();
  await finish(report.consumerPhase === 'done' || report.consumerPhase === 'refused' ? 0 : 1);
} catch (e) {
  report.error = String(e?.stack ?? e);
  report.verdict = 'ERROR';
  await finish(2);
}
