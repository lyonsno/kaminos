// Run probes/attention-bench.html in an independent Chrome for Testing and write its report.
// Usage: node run-attention-bench.mjs --chrome <exe> --out <report.json> [--kit <kit dir>] [--tokens 1128,4200] [--reps 5]
// Writes the report on success and failure (with the failing phase). Fails when the two paths disagree
// (relative L2 above 1e-3), produce non-finite values, or raise WebGPU errors.
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, launchChrome, sourceIdentity } from '../cdp-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const report = { schema: 'kaminos.flux2-klein.causal-attention-bench.v1', host: os.hostname(), startedAt: new Date().toISOString(),
  source: sourceIdentity(here), phase: 'setup' };
let browser, server;
try {
  ({ server } = await startServer({ '/webgpu-inference-kit/': path.resolve(opt('--kit', path.join(here, '../../../webgpu-inference-kit'))), '/': path.resolve(here, '..') })
    .then(s => { report.origin = s.origin; return s; }));
  browser = await launchChrome(opt('--chrome'), [], report);
  report.phase = 'bench';
  const query = new URLSearchParams({ reps: opt('--reps', '3'), tokens: opt('--tokens', '80,512,2048,257') });
  await browser.navigate(`${report.origin}/probes/causal-attention-bench.html?${query}`, 'window.attentionBenchReady === true');
  Object.assign(report, await browser.evaluate('window.attentionBench'));
  if (report.route !== 'KleinTextEncoder.attention' || report.rows?.length !== query.get('tokens').split(',').length) throw Error('missing or wrong attention route/rows');
  const bad = report.rows.filter(r => r.errors.length || r.nonFinite || !(r.relL2 < 1e-4) || !(r.oracleMaxAbs < 0.002) || r.outputElements.some(n=>n !== r.tokens*32*128) || r.variants[1].mode !== 'causal-blocked' || !r.variants[1].pipelineKeys.includes('masked-softmax-causal-block')); 
  report.phase = bad.length ? 'mismatch' : 'done';
  if (bad.length) report.error = bad.map(r => `${r.tokens}: relL2 ${r.relL2} nonFinite ${r.nonFinite} ${r.errors[0] ?? ''}`).join('; ');
} catch (e) {
  report.error = String(e?.stack || e);
}
await browser?.close(); server?.close();
report.finishedAt = new Date().toISOString();
await fsp.mkdir(path.dirname(path.resolve(opt('--out'))), { recursive: true });
await fsp.writeFile(path.resolve(opt('--out')), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ phase: report.phase, error: report.error, rows: report.rows?.map(r => ({ tokens: r.tokens, variants: r.variants.map(v=>({mode:v.mode,ms:v.medianMs,scoreBytes:v.scoreBytes})), relL2:r.relL2, oracleMaxAbs:r.oracleMaxAbs })) }, null, 1));
process.exit(report.phase === 'done' ? 0 : 1);
