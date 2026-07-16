import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const witnessPath = path.join(repoRoot, 'crucible-asset-composition-witness.mjs');
const witnessSource = readFileSync(witnessPath, 'utf8');

assert.match(witnessSource, /args\.get\('expected-server-root'\)/);
assert.match(witnessSource, /phase\s*=\s*'checking-server-root'/);
assert.match(witnessSource, /new URL\('\/api\/roots',\s*baseUrl\)/);
assert.match(witnessSource, /effectiveServerRoot/);

const fraudulentRoot = path.join(tmpdir(), 'fraudulent-kaminos-root');
const server = createServer((request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({
    scenes: {
      path: path.join(fraudulentRoot, 'scenes'),
      exists: true,
    },
  }));
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'kaminos-root-contract-'));
const reportPath = path.join(temporaryDirectory, 'report.json');
const screenshotPath = path.join(temporaryDirectory, 'screenshot.png');
const address = server.address();

try {
  const missingRootReportPath = path.join(temporaryDirectory, 'missing-root-report.json');
  const missingRootResult = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      witnessPath,
      '--url', `http://127.0.0.1:${address.port}/`,
      '--report', missingRootReportPath,
      '--out', screenshotPath,
      '--chrome', '/definitely-not-a-browser',
    ], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    child.once('error', reject);
    child.once('exit', code => resolve({ code }));
  });
  assert.notEqual(missingRootResult.code, 0, 'missing expected root must fail');
  const missingRootReport = JSON.parse(readFileSync(missingRootReportPath, 'utf8'));
  assert.equal(missingRootReport.phase, 'validating-arguments');
  assert.equal(missingRootReport.primaryOutputWritten, false);
  assert.match(missingRootReport.error, /--expected-server-root is required/);

  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      witnessPath,
      '--url', `http://127.0.0.1:${address.port}/`,
      '--expected-server-root', repoRoot,
      '--report', reportPath,
      '--out', screenshotPath,
      '--chrome', '/definitely-not-a-browser',
    ], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', code => resolve({ code, stdout, stderr }));
  });

  assert.notEqual(result.code, 0, 'wrong-root witness must fail');
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.phase, 'checking-server-root');
  assert.equal(report.expectedServerRoot, repoRoot);
  assert.equal(report.effectiveServerRoot, fraudulentRoot);
  assert.equal(report.primaryOutputWritten, false);
  assert.equal(report.screenshot, null);
  assert.match(report.error, /effective server root mismatch/);
} finally {
  await new Promise(resolve => server.close(resolve));
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log('crucible asset composition witness server-root contracts passed');
