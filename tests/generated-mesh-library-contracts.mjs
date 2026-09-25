import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const app = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../sf3d-kiln-save-reopen-witness.mjs', import.meta.url), 'utf8');
assert.ok(/const GR_OUTPUT_ROOTS = \[[^\]]*'generated-meshes'/.test(app),
  'the cockpit must browse persisted generated meshes for later scene import');
assert.ok(/function addGreenroomMeshActions[\s\S]*?greenroomImportMesh\(url, fileName, display\)/.test(app),
  'the generated-mesh root must retain the existing explicit Import action');
assert.ok(!witness.includes('ordinaryForeground?.completedFrames'),
  'the no-producer save/reopen route cannot wait for producer-serviced frames');
assert.ok(witness.includes('debugState().frameCount >= 3'),
  'the save/reopen route must settle on its own ordinary flame frames');
const out = mkdtempSync(join(tmpdir(), 'sf3d-reopen-failure-'));
const prior = join(out, 'malformed.json');
writeFileSync(prior, '{broken');
const failed = spawnSync(process.execPath, [new URL('../sf3d-kiln-save-reopen-witness.mjs', import.meta.url).pathname,
  '--url', 'http://127.0.0.1:1/#scene=kiln.kaminos.json', '--out', out,
  '--puppeteer', '/absent/puppeteer.mjs', '--inference-report', prior], { encoding: 'utf8' });
assert.notEqual(failed.status, 0, 'malformed prior receipt must fail');
assert.ok(existsSync(join(out, 'report.json')), 'failure before browser launch must leave a report');
const failure = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
assert.equal(failure.failurePhase, 'prior-report');
console.log('Generated mesh library route is exposed to the cockpit');
