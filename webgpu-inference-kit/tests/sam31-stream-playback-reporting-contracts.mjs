// kaminos-test: node
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const directory = await mkdtemp(join(tmpdir(), 'sam-playback-reporting-'));
try {
  const clip = join(directory, 'not-decoded.mp4'); await writeFile(clip, 'setup-only fixture; never decoded');
  const playwright = join(directory, 'fake-playwright.mjs');
  await writeFile(playwright, `export const chromium={async launchPersistentContext(){return {async newPage(){throw new Error('page-fixture-failed')},async close(){throw new Error('cleanup-fixture-failed')}}}};`);
  for (const mode of ['bind', 'cleanup']) {
    const preload = join(directory, `${mode}.mjs`), primary = join(directory, `${mode}-primary.json`), output = join(directory, mode);
    await writeFile(preload, `import http from 'node:http';import {EventEmitter} from 'node:events';import {syncBuiltinESMExports} from 'node:module';
      http.createServer=()=>Object.assign(new EventEmitter(),{listen(_port,_host,done){queueMicrotask(()=>${mode === 'bind' ? "this.emit('error',new Error('bind-fixture-failed'))" : 'done()'});return this},address(){return {port:32123}},close(done){done()}});syncBuiltinESMExports();`);
    const run = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href,
      fileURLToPath(new URL('./sam-video-playback-browser.mjs', import.meta.url)), '--out', output,
      '--chrome', process.execPath, '--playwright', playwright, '--clip', clip],
    { encoding: 'utf8', env: { ...process.env, EPISTAXIS_JOB_PRIMARY_OUTPUT: primary } });
    assert.ifError(run.error); assert.notEqual(run.status, 0);
    const report = JSON.parse(await readFile(primary, 'utf8'));
    assert.equal(report.status, 'failed');
    assert.match(report.error, mode === 'bind' ? /bind-fixture-failed/ : /page-fixture-failed/);
    if (mode === 'cleanup') assert.ok(report.cleanupErrors.some(error => /cleanup-fixture-failed/.test(error)));
    assert.deepEqual(JSON.parse(await readFile(join(output, 'report.json'), 'utf8')), report);
    assert.deepEqual(report.cases, [], 'setup failures cannot claim a completed browser comparison');
  }
  console.log('Playback witness reports mocked bind and cleanup failures locally and to independent primary output');
} finally { await rm(directory, { recursive: true, force: true }); }
