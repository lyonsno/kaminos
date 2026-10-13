// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const witness = fileURLToPath(new URL('./sam-mask-host-layout-browser.mjs', import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sam-layout-report-contract-'));
try {
  for (const [name, supplied, phase, copied] of [
    ['missing-module', {}, 'environment', false],
    ['missing-browser', { PLAYWRIGHT_MODULE: 'unreached-module' }, 'environment', false],
    ['missing-source', { PLAYWRIGHT_MODULE: 'unreached-module', CHROME_PATH: '/independent-browser' }, 'source', true],
    ['bad-module', { PLAYWRIGHT_MODULE: '/missing-playwright.mjs', CHROME_PATH: process.execPath }, 'import-playwright', false],
  ]) {
    const out = path.join(root, name); fs.mkdirSync(out);
    const reportPath = path.join(out, 'report.json');
    fs.writeFileSync(reportPath, JSON.stringify({ status: 'passed', stale: true }));
    let script = witness;
    if (copied) {
      const tests = path.join(root, 'missing-source-root', 'tests'); fs.mkdirSync(tests, { recursive: true });
      script = path.join(tests, path.basename(witness)); fs.copyFileSync(witness, script);
    }
    const env = { ...process.env, KAMINOS_SAM_LAYOUT_OUTPUT: out };
    delete env.PLAYWRIGHT_MODULE; delete env.CHROME_PATH;
    const run = spawnSync(process.execPath, [script], { env: { ...env, ...supplied }, encoding: 'utf8' });
    assert.equal(run.status, 1, `${name} must fail before browser launch`);
    const report = JSON.parse(fs.readFileSync(reportPath));
    assert.equal(report.status, 'failed', `${name} left stale passing evidence`);
    assert.equal(report.phase, phase);
    assert.equal(report.stale, undefined);
    assert.equal(report.browserCleanup, 'not-launched');
    assert.ok(report.error);
    assert.deepEqual(report.cases, []);
  }
  console.log('SAM layout early-failure and stale-report contracts passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
