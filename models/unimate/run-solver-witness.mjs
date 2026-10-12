// Run the UniMate solver witness in an independent Chrome for Testing.
// Usage: node run-solver-witness.mjs --chrome <exe> --weights <dir> --fixture <dir> --trace <dir> --out <report.json>
//        [--modes vector-field,forced,free] [--vf-gate 1e-5] [--forced-gate 1e-4]
//        [--timeout-s 3600] [--stall-s 180] [--free-sample <path.f32>]
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
const chrome = opt('--chrome'), outPath = opt('--out'), freeSamplePath = opt('--free-sample');
const roots = { weights: path.resolve(opt('--weights', '')), fixture: path.resolve(opt('--fixture', '')), trace: path.resolve(opt('--trace', '')) };
const modes = opt('--modes', 'vector-field,forced,free'), vfGate = opt('--vf-gate', '1e-5'), forcedGate = opt('--forced-gate', '1e-4');
const timeoutS = Number(opt('--timeout-s', '3600')), stallS = Number(opt('--stall-s', '180'));

const report = { schema: 'kaminos.unimate.solver-witness-run.v0', requestedChrome: chrome, roots, modes, host: os.hostname(),
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
  for (const f of [path.join(roots.weights, 'manifest.json'), path.join(roots.fixture, 'fixture.json'), path.join(roots.trace, 'trace.json')]) await fsp.access(f);
  const started = await startServer({ '/weights/': roots.weights, '/fixture/': roots.fixture, '/trace/': roots.trace, '/': repoRoot });
  server = started.server;
  report.pageUrl = `${started.origin}/models/unimate/solver-witness.html?modes=${modes}&vfGate=${vfGate}&forcedGate=${forcedGate}`;
  browser = await launchChrome(chrome, [], report);
  report.phase = 'navigate';
  await browser.navigate(report.pageUrl, 'Boolean(window.__unimateSolverWitness)');
  report.phase = 'page';
  const t0 = Date.now();
  let last = null, lastChange = Date.now(), page;
  for (;;) {
    page = await browser.evaluate('JSON.parse(JSON.stringify(window.__unimateSolverWitness))', false);
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
  if (freeSamplePath && page.phase === 'done') {
    const sample = await browser.evaluate('window.__unimateFreeSample ?? null', false);
    if (sample) {
      await fsp.writeFile(freeSamplePath, Buffer.from(new Float32Array(sample).buffer));
      report.freeSample = { path: freeSamplePath, floats: sample.length };
    }
  }
  report.phase = 'finished';
  const ok = page.phase === 'done' && page.report?.pass === true;
  report.verdict ??= ok ? 'PASS' : (page.phase === 'done' ? 'FAIL' : 'ERROR');
  await finish(ok ? 0 : 1);
} catch (e) {
  report.error = String(e?.stack ?? e);
  report.verdict = 'ERROR';
  await finish(2);
}
