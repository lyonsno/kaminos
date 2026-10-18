// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tool = path.resolve('tools/prepare-lod-tiers.mjs');
const run = (args, env = {}) => { try { execFileSync(process.execPath, [tool, ...args], {env: {...process.env, ...env}, stdio: 'pipe'}); return 0; } catch (e) { return e.status; } };

test('a dependency that cannot load still ends in a failure report naming the phase', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-report-')), report = path.join(dir, 'report.json');
  const status = run(['--input', dir, '--source', 'a'.repeat(64), '--server', 'http://127.0.0.1:9', '--report', report],
    {KAMINOS_LOD_THREE_MODULE: 'kaminos-missing-module-for-test'});
  assert.notEqual(status, 0);
  const r = JSON.parse(fs.readFileSync(report, 'utf8'));
  assert.equal(r.phase, 'load-modules');
  assert.match(r.error.message, /kaminos-missing-module-for-test/);
  assert.ok(r.finishedAt);
});

test('bad arguments end in a failure report, not a silent exit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-report-')), report = path.join(dir, 'report.json');
  assert.notEqual(run(['--input', dir, '--source', 'nothex', '--server', 'http://127.0.0.1:9', '--report', report]), 0);
  const r = JSON.parse(fs.readFileSync(report, 'utf8'));
  assert.equal(r.phase, 'admission');
  assert.match(r.error.message, /required/);
});
