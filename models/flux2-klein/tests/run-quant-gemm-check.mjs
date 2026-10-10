// Run quant-gemm-check.html in an independent Chrome for Testing against a fixture directory and
// fail unless every case decodes to the CPU result (relL2 below --tolerance, no non-finite values).
// Usage: node run-quant-gemm-check.mjs --chrome <exe> --fixture <dir> --out <report.json> [--tolerance 1e-5]
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, launchChrome, sourceIdentity } from '../cdp-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const report = { schema: 'kaminos.flux2-klein.quant-gemm-check.v0', host: os.hostname(), startedAt: new Date().toISOString(),
  source: sourceIdentity(here), fixture: path.resolve(opt('--fixture')), tolerance: Number(opt('--tolerance', '1e-5')), phase: 'setup' };
let browser, server;
try {
  ({ server } = await startServer({ '/fixture/': report.fixture, '/': path.resolve(here, '..') }).then(s => { report.origin = s.origin; return s; }));
  browser = await launchChrome(opt('--chrome'), [], report);
  report.phase = 'check';
  await browser.navigate(`${report.origin}/tests/quant-gemm-check.html?fixture=/fixture`, 'window.quantGemmPageReady === true');
  const res = await browser.evaluate('window.quantGemmCheck');
  report.adapter = res.adapter; report.results = res.results;
  const bad = res.results.filter(r => r.nonFinite > 0 || !(r.relL2 <= report.tolerance));
  report.pass = bad.length === 0;
  report.phase = report.pass ? 'done' : 'mismatch';
  if (!report.pass) report.error = `decode mismatch: ${bad.map(r => `${r.case} v${r.version} relL2 ${r.relL2}`).join(', ')}`;
} catch (e) {
  report.error = String(e?.stack || e);
}
await browser?.close(); server?.close();
report.finishedAt = new Date().toISOString();
await fsp.mkdir(path.dirname(path.resolve(opt('--out'))), { recursive: true });
await fsp.writeFile(path.resolve(opt('--out')), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ phase: report.phase, pass: report.pass, error: report.error,
  results: report.results?.map(r => `${r.case} ${r.format} v${r.version} relL2 ${r.relL2.toExponential(2)}`) }, null, 1));
process.exit(report.pass ? 0 : 1);
