// Run the UniMate forward-parity witness in an independent Chrome for Testing.
// Usage: node run-forward-witness.mjs --chrome <exe> --weights <dir> --fixture <dir> --out <report.json>
//        [--gate 1e-5] [--timeout-s 300] [--stall-s 120] [--negative-control swap-captions]
// Writes the report on success and failure, naming the last phase reached.
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, sourceIdentity, startServer } from '../flux2-klein/cdp-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const chrome = opt('--chrome'), outPath = opt('--out');
const weights = path.resolve(opt('--weights', '')), fixture = path.resolve(opt('--fixture', ''));
const negativeControl = opt('--negative-control', ''), depthProbe = args.includes('--depth-probe');
const gate = opt('--gate', '1e-5'), timeoutS = Number(opt('--timeout-s', '300')), stallS = Number(opt('--stall-s', '120'));

const report = { schema: 'kaminos.unimate.forward-witness-run.v0', requestedChrome: chrome, weights, fixture, gate,
  host: os.hostname(), startedAt: new Date().toISOString(), source: sourceIdentity(here), phase: 'launch' };
let browser, server;
async function finish(code) {
  report.finishedAt = new Date().toISOString();
  await browser?.close().catch(e => { report.closeError = String(e); });
  server?.close();
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  await fsp.writeFile(outPath, JSON.stringify(report, null, 2));
  process.exit(code);
}
try {
  if (!chrome || !outPath) throw new Error('need --chrome and --out');
  for (const f of [path.join(weights, 'manifest.json'), path.join(fixture, 'fixture.json')]) await fsp.access(f);
  const started = await startServer({ '/weights/': weights, '/fixture/': fixture, '/': repoRoot });
  server = started.server;
  report.pageUrl = `${started.origin}/models/unimate/forward-witness.html?gate=${gate}${negativeControl ? `&negativeControl=${negativeControl}` : ''}${depthProbe ? '&depthProbe=1' : ''}`;
  report.negativeControl = negativeControl || null;
  browser = await launchChrome(chrome, [], report);
  report.phase = 'navigate';
  await browser.navigate(report.pageUrl, 'Boolean(window.__unimateForwardWitness)');
  report.phase = 'page';
  const t0 = Date.now();
  let lastPhase = null, lastChange = Date.now(), page;
  for (;;) {
    page = await browser.evaluate('JSON.parse(JSON.stringify(window.__unimateForwardWitness))', false);
    if (page.phase !== lastPhase) { lastPhase = page.phase; lastChange = Date.now(); }
    if (page.phase === 'done' || page.phase === 'failed') break;
    if (Date.now() - t0 > timeoutS * 1000) { report.verdict = 'TIMEOUT'; break; }
    if (Date.now() - lastChange > stallS * 1000) { report.verdict = 'WEDGED'; break; }
    await new Promise(r => setTimeout(r, 500));
  }
  report.pagePhase = page.phase;
  report.pageError = page.error ?? null;
  report.result = page.report;
  report.phase = 'finished';
  const ok = page.phase === 'done' && page.report?.pass === true;
  report.verdict ??= ok ? 'PASS' : (page.phase === 'done' ? 'FAIL' : 'ERROR');
  await finish(ok ? 0 : 1);
} catch (e) {
  report.error = String(e?.stack ?? e);
  report.verdict = 'ERROR';
  await finish(2);
}
