// Batch text-to-image through generate.html in an independent Chrome for Testing.
// Usage: node run-generate.mjs --chrome <exe> --te <dir> --dit <dir> --vae <dir> --prompts <dir of .txt>
//        --out <dir> [--seed-base 7000] [--size 512] [--only name,name]
// Prompt files are taken in sorted order; seed = seed-base + 1-based index. Writes <name>.png and report.json.
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, launchChrome } from './cdp-harness.mjs';
import { execFileSync } from 'node:child_process';
// Effective source identity of the code this run actually executed.
function sourceIdentity(dir) {
  try {
    const rev = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['-C', dir, 'status', '--porcelain', '--', '.'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    return { rev, dirtyFiles: dirty };
  } catch (e) { return { error: String(e) }; }
}


const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const outDir = path.resolve(opt('--out'));
const report = { schema: 'kaminos.flux2-klein.generate-run.v0', host: os.hostname(), startedAt: new Date().toISOString(), source: sourceIdentity(here), phase: 'setup',
  roots: { te: path.resolve(opt('--te')), dit: path.resolve(opt('--dit')), vae: path.resolve(opt('--vae')) } };
let browser, server;
async function finish(code) {
  report.finishedAt = new Date().toISOString();
  await fsp.mkdir(outDir, { recursive: true });
  await fsp.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  browser?.close(); server?.close();
  process.exit(code);
}
try {
  const promptDir = path.resolve(opt('--prompts'));
  const only = opt('--only') ? opt('--only').split(',') : null;
  const files = (await fsp.readdir(promptDir)).filter(f => f.endsWith('.txt')).sort();
  const seedBase = Number(opt('--seed-base', '7000')), size = Number(opt('--size', '512'));
  const jobs = [];
  for (const [i, f] of files.entries()) {
    const name = f.replace(/\.txt$/, '');
    if (only && !only.includes(name)) continue;
    jobs.push({ name, prompt: (await fsp.readFile(path.join(promptDir, f), 'utf8')).trim(), seed: seedBase + i + 1, size });
  }
  report.jobs = jobs.map(({ name, seed, size: s, prompt }) => ({ name, seed, size: s, prompt }));
  if (opt('--origin')) report.origin = opt('--origin');
  else ({ server } = await startServer({ '/te/': report.roots.te, '/dit/': report.roots.dit, '/vae/': report.roots.vae, '/': here }).then(s => { report.origin = s.origin; return s; }));
  browser = await launchChrome(opt('--chrome'), [], report);
  report.phase = 'load';
  const kq = `&gemm=${opt('--gemm-version', '2')}&shared=${opt('--shared-type', 'f16')}`;
  report.requestedKernels = { gemmVersion: Number(opt('--gemm-version', '2')), sharedType: opt('--shared-type', 'f16') };
  await browser.navigate(`${report.origin}/generate.html?te=/te&dit=/dit&vae=/vae${kq}`, 'window.kleinPageReady === true');
  await browser.evaluate('window.kleinReady');
  report.phase = 'generate';
  const res = await browser.evaluate(`window.kleinBatch(${JSON.stringify(jobs)})`);
  await fsp.mkdir(outDir, { recursive: true });
  for (const r of res.results) { await fsp.writeFile(path.join(outDir, `${r.name}.png`), Buffer.from(r.png, 'base64')); delete r.png; }
  report.results = res.results; report.residentBytes = res.residentBytes; report.loadMs = res.loadMs; report.effectiveKernels = res.kernels;
  report.phase = 'done';
  await finish(0);
} catch (e) {
  report.error = String(e?.stack || e);
  await finish(1);
}
