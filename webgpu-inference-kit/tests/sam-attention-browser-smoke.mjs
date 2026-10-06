import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { validateAttentionWitness, validateAttentionBrowser } from './sam-attention-witness-checks.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.SAM_ATTENTION_REPORT || process.env.EPISTAXIS_JOB_PRIMARY_OUTPUT;
if (!output) throw new Error('SAM_ATTENTION_REPORT must name the caller-owned report');
const report = { status: 'failed', phase: 'setup', sourceSha256: {}, cases: [],
  expectedCommit: process.env.SAM_ATTENTION_EXPECTED_COMMIT,
  baselineCommit: process.env.SAM_ATTENTION_BASELINE_COMMIT,
  expectedVendor: process.env.SAM_ATTENTION_EXPECTED_VENDOR || 'apple', repoRoot: root };
let browser, server;
const persist = async () => {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
};
try {
  await persist();
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  report.commit = git(['rev-parse', 'HEAD']);
  assert.equal(report.commit, report.expectedCommit, 'exact candidate commit required');
  assert.ok(report.baselineCommit, 'baseline source revision required');
  report.phase = 'source-identity';
  const sourceFiles = ['src/sam-online-attention-wgsl.js', 'tests/sam-attention-browser-cases.mjs', 'tests/sam-attention-browser-smoke.mjs', 'tests/sam-attention-witness-checks.mjs'];
  const prefix = git(['rev-parse', '--show-prefix']);
  const served = new Map();
  for (const file of sourceFiles) {
    const bytes = await fs.readFile(path.join(root, file));
    const admitted = execFileSync('git', ['show', `${report.expectedCommit}:${prefix}${file}`], { cwd: root });
    assert.ok(bytes.equals(admitted), `working source differs from candidate commit: ${file}`);
    served.set(`/${file}`, bytes);
    report.sourceSha256[file] = createHash('sha256').update(bytes).digest('hex');
  }
  const baseline = execFileSync('git', ['show', `${report.baselineCommit}:${prefix}src/sam-online-attention-wgsl.js`], { cwd: root });
  served.set('/baseline.mjs', baseline);
  report.sourceSha256['baseline.mjs'] = createHash('sha256').update(baseline).digest('hex');
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/') return res.end('<!doctype html><title>SAM attention numerical comparison</title>');
    if (!served.has(pathname)) return res.writeHead(404).end();
    res.setHeader('Content-Type', 'text/javascript'); res.end(served.get(pathname));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  report.requestedRoute = `http://127.0.0.1:${server.address().port}/`;
  report.phase = 'browser-launch';
  assert.ok(process.env.CHROME_PATH && process.env.PLAYWRIGHT_MODULE, 'explicit independent browser and installed Playwright module required');
  report.browserPath = await fs.realpath(process.env.CHROME_PATH);
  validateAttentionBrowser(report.browserPath);
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  browser = await chromium.launch({ executablePath: report.browserPath, headless: true, args: ['--enable-unsafe-webgpu'], timeout: 0 });
  report.browserVersion = browser.version();
  browser.on('disconnected', () => { report.browserDisconnected = true; });
  const page = await browser.newPage();
  page.setDefaultTimeout(0);
  await page.goto(report.requestedRoute, { timeout: 0 });
  report.effectiveRoute = page.url();
  await page.exposeFunction('recordAttentionCase', async value => {
    report.backend = value.backend; report.cases.push(value.result); await persist();
  });
  report.phase = 'native-execution';
  await persist();
  report.backend = await page.evaluate(async expectedHashes => {
    for (const [file, expected] of Object.entries(expectedHashes)) {
      const response = await fetch(`/${file}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`missing source: ${file}`);
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await response.arrayBuffer())), x => x.toString(16).padStart(2, '0')).join('');
      if (hash !== expected) throw new Error(`served source mismatch: ${file}`);
    }
    const baseline = await import('/baseline.mjs');
    const candidate = await import('/src/sam-online-attention-wgsl.js');
    const { runAttentionCases } = await import('/tests/sam-attention-browser-cases.mjs');
    return runAttentionCases(baseline, candidate, window.recordAttentionCase);
  }, report.sourceSha256);
  report.phase = 'comparison';
  validateAttentionWitness(report);
  report.status = 'succeeded'; report.phase = null;
} catch (error) {
  report.error = { message: error.message, stack: error.stack }; process.exitCode = 1;
} finally {
  await persist();
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  report.cleanup = { browserClosed: browser ? !browser.isConnected() : null, serverClosed: server ? !server.listening : null };
  await persist();
  console.log(JSON.stringify({ status: report.status, phase: report.phase, cases: report.cases.length, output, error: report.error?.message }));
}
