// Run probes/gemm-bench.html in an independent Chrome for Testing and write its report.
// Usage: node run-gemm-bench.mjs --chrome <exe> --out <report.json> [--kernels v2,v3-4x4,...] [--reps 7]
// Writes the report on success and failure (with the failing phase).
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, launchChrome, sourceIdentity } from '../cdp-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const report = { schema: 'kaminos.flux2-klein.gemm-bench.v0', host: os.hostname(), startedAt: new Date().toISOString(),
  source: sourceIdentity(here), phase: 'setup' };
let browser, server;
try {
  ({ server } = await startServer({ '/': path.resolve(here, '..') }).then(s => { report.origin = s.origin; return s; }));
  browser = await launchChrome(opt('--chrome'), [], report);
  report.phase = 'bench';
  const query = new URLSearchParams({ reps: opt('--reps', '7'), ...(opt('--kernels') ? { kernels: opt('--kernels') } : {}) });
  await browser.navigate(`${report.origin}/probes/gemm-bench.html?${query}`, 'window.gemmBenchReady === true');
  Object.assign(report, await browser.evaluate('window.gemmBench'));
  const invalid = report.rows.filter(r => r.validationError || (r.relL2VsV2 !== null && !(r.relL2VsV2 < 5e-3)));
  report.phase = invalid.length ? 'invalid-rows' : 'done';
  if (invalid.length) report.error = invalid.map(r => `${r.shape} ${r.kernel}: ${r.validationError ?? `relL2 ${r.relL2VsV2}`}`).join('; ');
} catch (e) {
  report.error = String(e?.stack || e);
}
await browser?.close(); server?.close();
report.finishedAt = new Date().toISOString();
await fsp.mkdir(path.dirname(path.resolve(opt('--out'))), { recursive: true });
await fsp.writeFile(path.resolve(opt('--out')), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ phase: report.phase, error: report.error, adapter: report.adapter?.description, linearSecondsPerStep: report.linearSecondsPerStep }, null, 1));
process.exit(report.phase === 'done' ? 0 : 1);
