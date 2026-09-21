import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { validateLinearKernelCase, validateLinearKernelInventory, validateLinearKernelSource } from './linear-kernel-witness-checks.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.LINEAR_KERNEL_REPORT;
if (!output) throw new Error('LINEAR_KERNEL_REPORT must name the caller-owned report');
const report = { status: 'failed', phase: 'setup', sourceSha256: {}, cases: [],
  expectedCommit: process.env.LINEAR_KERNEL_EXPECTED_COMMIT,
  requestedBackend: 'native-webgpu', expectedVendor: process.env.LINEAR_EXPECTED_VENDOR || 'apple' };
let browser, server;
const persist = async () => {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
};
try {
  await persist();
  report.phase = 'source-identity';
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  report.commit = git(['rev-parse', 'HEAD']);
  report.dirty = git(['status', '--porcelain']);
  validateLinearKernelSource(report);
  const { default: puppeteer } = await import(process.env.PUPPETEER_MODULE || 'puppeteer-core');
  const prefix = git(['rev-parse', '--show-prefix']);
  for (const file of ['src/linear-kernel.js', 'src/core.js', 'tests/linear-kernel-browser-cases.mjs',
    'tests/fixtures/linear-source-baselines.json', 'tests/linear-kernel-browser-smoke.mjs', 'tests/linear-kernel-witness-checks.mjs']) {
    report.sourceSha256[file] = createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex');
    const admitted = execFileSync('git', ['show', `${report.expectedCommit}:${prefix}${file}`], { cwd: root });
    assert.equal(report.sourceSha256[file], createHash('sha256').update(admitted).digest('hex'), `source differs from admitted commit: ${file}`);
  }
  server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/') return res.end('<!doctype html><title>Linear kernel numerical witness</title>');
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root)) return res.writeHead(403).end();
    try { res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : 'application/json'); res.end(await fs.readFile(file)); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  report.requestedRoute = `http://127.0.0.1:${server.address().port}/`;
  report.phase = 'browser-launch';
  report.browserPath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser = await puppeteer.launch({ executablePath: report.browserPath, headless: true,
    args: ['--enable-unsafe-webgpu'], protocolTimeout: 0 });
  report.browserVersion = await browser.version();
  const page = await browser.newPage();
  page.setDefaultTimeout(0);
  await page.goto(report.requestedRoute);
  report.effectiveRoute = page.url();
  assert.equal(report.effectiveRoute, report.requestedRoute);
  await page.exposeFunction('recordLinearCase', async value => {
    report.backend = value.backend;
    report.cases.push(value.result);
    await persist();
  });
  report.phase = 'native-execution';
  const result = await page.evaluate(async expectedHashes => {
    for (const [file, expected] of Object.entries(expectedHashes)) {
      const response = await fetch(file, { cache: 'no-store' });
      if (!response.ok) throw new Error(`missing source: ${file}`);
      const bytes = await response.arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
      if (hash !== expected) throw new Error(`served source mismatch: ${file}`);
    }
    const baseline = await (await fetch('tests/fixtures/linear-source-baselines.json')).json();
    const { runLinearKernelCases } = await import('/tests/linear-kernel-browser-cases.mjs');
    return runLinearKernelCases(baseline, window.recordLinearCase);
  }, report.sourceSha256);
  report.backend = result.backend;
  assert.equal(result.backend.vendor.toLowerCase(), report.expectedVendor.toLowerCase());
  validateLinearKernelInventory(report.cases);
  report.phase = 'comparison';
  for (const row of report.cases) validateLinearKernelCase(row);
  report.status = 'succeeded';
  report.phase = null;
} catch (error) {
  report.error = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  await persist();
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  console.log(JSON.stringify({ status: report.status, phase: report.phase, cases: report.cases.length, output, error: report.error?.message }));
}
