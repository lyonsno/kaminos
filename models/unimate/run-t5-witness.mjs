// Run the UniMate T5 encoder witness in an independent Chrome for Testing.
// Usage: node run-t5-witness.mjs --chrome <exe> --t5 <dir> --out <report.json> [--gate 1e-5] [--timeout-s 600] [--stall-s 120]
// The stall detector watches both the page phase and its evaluation counter, so a
// long but progressing solve is distinguished from a wedged one. Writes the report
// on success and failure, naming the last phase reached.
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
const roots = { t5: path.resolve(opt('--t5', '')) };
const gate = opt('--gate', '1e-5');
const timeoutS = Number(opt('--timeout-s', '600')), stallS = Number(opt('--stall-s', '120'));

const report = { schema: 'kaminos.unimate.t5-witness-run.v0', requestedChrome: chrome, roots, gate, host: os.hostname(),
  startedAt: new Date().toISOString(), source: sourceIdentity(here), phase: 'launch' };
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
  for (const f of ['t5-manifest.json', 't5-tokenizer.json', 't5-reference.json']) await fsp.access(path.join(roots.t5, f));
  const started = await startServer({ '/t5/': roots.t5, '/': repoRoot });
  server = started.server;
  report.pageUrl = `${started.origin}/models/unimate/t5-witness.html?gate=${gate}`;
  browser = await launchChrome(chrome, [], report);
  report.phase = 'navigate';
  await browser.navigate(report.pageUrl, 'Boolean(window.__unimateT5Witness)');
  report.phase = 'page';
  const t0 = Date.now();
  let last = null, lastChange = Date.now(), page;
  for (;;) {
    page = await browser.evaluate('JSON.parse(JSON.stringify(window.__unimateT5Witness))', false);
    const mark = `${page.phase}:${page.progress}`;
    if (mark !== last) { last = mark; lastChange = Date.now(); }
    if (page.phase === 'done' || page.phase === 'failed') break;
    if (Date.now() - t0 > timeoutS * 1000) { report.verdict = 'TIMEOUT'; break; }
    if (Date.now() - lastChange > stallS * 1000) { report.verdict = 'WEDGED'; break; }
    await new Promise(r => setTimeout(r, 1000));
  }
  report.pagePhase = page.phase;
  report.pageProgress = page.progress;
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
