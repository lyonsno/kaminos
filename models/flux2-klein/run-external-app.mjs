// Run examples/external-app as an outside application would: pack the kit and Klein, install both
// tarballs into a fresh directory outside this checkout, copy the app in, serve it, and drive it in an
// independent Chrome for Testing against a weight server. Writes report.json (also on failure, naming
// the phase) and the first generated image.
// Usage: node run-external-app.mjs --chrome <exe> --weights-dir <dir with te/ dit/ vae/> --out <dir>
//        [--work <install dir; default a new temp dir>] [--size 256] [--steps 1]
import { execFileSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkExternalApp } from './external-app-checks.mjs';
import { startServer, launchChrome, sourceIdentity } from './cdp-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const outDir = path.resolve(opt('--out'));
const report = { schema: 'kaminos.flux2-klein.external-app.v0', host: os.hostname(), startedAt: new Date().toISOString(),
  source: sourceIdentity(here), phase: 'pack', size: Number(opt('--size', '256')), steps: Number(opt('--steps', '1')) };
let browser, appServer, weightServer;

try {
  const work = path.resolve(opt('--work') ?? fs.mkdtempSync(path.join(os.tmpdir(), 'klein-external-app-')));
  if (work.startsWith(repoRoot + path.sep)) throw new Error(`--work ${work} is inside the checkout; an outside app must live elsewhere`);
  report.work = work;
  const run = (cmd, argv, cwd) => execFileSync(cmd, argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const kitTarball = path.join(work, run('npm', ['pack', '--silent', '--pack-destination', work], path.join(repoRoot, 'webgpu-inference-kit')).trim().split('\n').pop());
  const klein = JSON.parse(run(process.execPath, [path.join(here, 'pack-klein.mjs'), '--out', path.join(work, 'klein-package'), '--json'], here));
  report.packages = { kit: path.basename(kitTarball), klein: path.basename(klein.tarball) };

  report.phase = 'install';
  const app = path.join(work, 'app');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'klein-external-app', private: true, type: 'module' }));
  run('npm', ['install', '--offline', '--no-audit', '--no-fund', kitTarball, klein.tarball], app);
  for (const file of ['index.html', 'app.js']) fs.copyFileSync(path.join(here, 'examples/external-app', file), path.join(app, file));
  report.installed = Object.fromEntries(['@kaminos/flux2-klein', '@kaminos/webgpu-inference-kit'].map(name =>
    [name, JSON.parse(fs.readFileSync(path.join(app, 'node_modules', name, 'package.json'), 'utf8')).version]));

  report.phase = 'serve';
  const weights = await startServer({ '/': path.resolve(opt('--weights-dir')) }, 0, { cors: true });
  weightServer = weights.server; report.weightsUrl = weights.origin;
  const served = await startServer({ '/': app });
  appServer = served.server;
  const query = new URLSearchParams({ weights: weights.origin, missing: `${weights.origin}/no-weights-here`, size: String(report.size), steps: String(report.steps) });
  report.pageUrl = `${served.origin}/index.html?${query}`;

  report.phase = 'run';
  browser = await launchChrome(opt('--chrome'), [], report);
  await browser.navigate(report.pageUrl, 'Boolean(window.kleinConsumer)');
  const record = await browser.evaluate('window.kleinConsumer');
  await fsp.mkdir(outDir, { recursive: true });
  await fsp.writeFile(path.join(outDir, 'first.png'), Buffer.from(record.first.png.split(',')[1], 'base64'));
  delete record.first.png;
  report.record = record;

  report.phase = 'check';
  const problems = checkExternalApp(record);
  report.problems = problems;
  report.phase = problems.length ? 'failed-checks' : 'done';
} catch (error) {
  report.error = String(error?.stack ?? error);
}
await browser?.close(); appServer?.close(); weightServer?.close();
report.finishedAt = new Date().toISOString();
await fsp.mkdir(outDir, { recursive: true });
await fsp.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ phase: report.phase, error: report.error?.split('\n')[0], problems: report.problems, installed: report.installed }));
process.exit(report.phase === 'done' ? 0 : 1);
