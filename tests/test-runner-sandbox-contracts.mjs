// kaminos-test: node
// Contracts for the runner's test sandbox. A test must not reach the
// operator's real machine state: each run gives child tests a private HOME
// and puts stubs for the shop's own tools first on their PATH. A stub records
// the call and refuses it; the run lists the attempt as a warning naming the
// test (warnings never fail a run on their own).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture, manifestOf, run, readReport, scopedEnv, CLI, cliEnv } from './test-runner-fixtures.mjs';

const node = (name, body) => ({ files: { [name]: body }, manifest: manifestOf({ [`tests/${name}`]: { kind: 'node' } }) });

// A stand-in for the operator's real home and real shop tools: if the sandbox
// fails, the test reaches these and leaves a mark.
async function realMachine(t) {
  const real = await fs.mkdtemp(path.join(os.tmpdir(), 'kaminos-real-home-'));
  t.after(() => fs.rm(real, { recursive: true, force: true }));
  const bin = path.join(real, 'bin');
  await fs.mkdir(bin);
  for (const name of ['shoptool', 'gpu-greenroom', 'wezterm', 'claude']) {
    await fs.writeFile(path.join(bin, name), `#!/bin/sh\necho "$0 $*" >> '${path.join(real, 'reached')}'\nexit 0\n`, { mode: 0o755 });
  }
  scopedEnv(t, 'HOME', real);
  scopedEnv(t, 'PATH', `${bin}${path.delimiter}${process.env.PATH}`);
  return real;
}

test('a test writing to $HOME writes into the run sandbox, never the real home', async t => {
  const real = await realMachine(t);
  const f = await fixture(t, node('w.mjs', "import fs from 'node:fs'; import path from 'node:path'; fs.writeFileSync(path.join(process.env.HOME, 'marker'), 'x'); process.exit(0);\n"));
  await run(f);
  const report = await readReport(f);
  assert.equal(report.ok, true);
  assert.equal(report.effective.sandbox.enabled, true);
  await assert.rejects(fs.access(path.join(real, 'marker')), 'the real home is untouched');
  assert.ok(report.effective.sandbox.home.startsWith(path.join(f.root, 'out')), report.effective.sandbox.home);
  await fs.access(path.join(report.effective.sandbox.home, 'marker'));
});

test('a test calling a machine tool hits a stub that refuses it, and the run lists the attempt as a warning', async t => {
  const real = await realMachine(t);
  const f = await fixture(t, node('e.mjs', "import { spawnSync } from 'node:child_process'; const r = spawnSync('gpu-greenroom', ['submit', 'x'], { encoding: 'utf8' }); process.exit(r.status === 97 ? 0 : 1);\n"));
  await run(f);
  const report = await readReport(f);
  await assert.rejects(fs.access(path.join(real, 'reached')), 'the real tool was not reached');
  assert.deepEqual(report.sandboxAttempts.map(a => [a.file, a.tool, a.args]), [['tests/e.mjs', 'gpu-greenroom', 'submit x']]);
  assert.ok(report.warnings.some(w => w.source === 'sandbox' && w.test === 'tests/e.mjs' && /gpu-greenroom submit x/.test(w.message)), JSON.stringify(report.warnings));
  assert.equal(report.ok, true, 'an attempt is a warning, not a failure of the run');
});

test('KAMINOS_TEST_SANDBOX_STUBS adds tools only some machines have', async t => {
  const real = await realMachine(t);
  scopedEnv(t, 'KAMINOS_TEST_SANDBOX_STUBS', 'shoptool other-tool');
  const f = await fixture(t, node('s.mjs', "import { spawnSync } from 'node:child_process'; process.exit(spawnSync('shoptool', ['go']).status === 97 ? 0 : 1);\n"));
  await run(f);
  const report = await readReport(f);
  await assert.rejects(fs.access(path.join(real, 'reached')), 'the real tool was not reached');
  assert.ok(report.effective.sandbox.shims.includes('shoptool') && report.effective.sandbox.shims.includes('other-tool'));
  assert.deepEqual(report.sandboxAttempts.map(a => a.tool), ['shoptool']);
});

test('git works in the sandbox with a fixture identity, main as the default branch, and no global hooks', async t => {
  await realMachine(t);
  const body = "import { execFileSync } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';\n"
    + "const d = fs.mkdtempSync(path.join(os.tmpdir(), 'g-')); execFileSync('git', ['init', '-q', d]); fs.writeFileSync(path.join(d, 'a'), 'a');\n"
    + "execFileSync('git', ['-C', d, 'add', 'a']); execFileSync('git', ['-C', d, 'commit', '-q', '-m', 'a']);\n"
    + "const branch = execFileSync('git', ['-C', d, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();\n"
    + "const hooks = execFileSync('git', ['-C', d, 'config', '--get', 'core.hooksPath'], { encoding: 'utf8' }).trim();\n"
    + "fs.rmSync(d, { recursive: true, force: true }); process.exit(branch === 'main' && hooks === '/dev/null' ? 0 : 1);\n";
  const f = await fixture(t, node('g.mjs', body));
  await run(f);
  assert.equal((await readReport(f)).ok, true);
});

test('agent-pane variables are scrubbed and every browser override, KAMINOS_HEADLESS_BROWSER included, is stubbed', async t => {
  await realMachine(t);
  scopedEnv(t, 'SHOP_PTY_BROKER_SOCKET', '/tmp/shop-pty/live.sock');
  scopedEnv(t, 'WEZTERM_UNIX_SOCKET', '/tmp/wezterm-live.sock');
  scopedEnv(t, 'KAMINOS_HEADLESS_BROWSER', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  const body = "const e = process.env; process.exit(!e.SHOP_PTY_BROKER_SOCKET && !e.WEZTERM_UNIX_SOCKET && /browser-launch-stub/.test(e.KAMINOS_HEADLESS_BROWSER || '') ? 0 : 1);\n";
  const f = await fixture(t, node('v.mjs', body));
  await run(f);
  assert.equal((await readReport(f)).ok, true);
});

test('the sandbox can be turned off, which the report records and the summary prints', async t => {
  const real = await realMachine(t);
  const f = await fixture(t, node('o.mjs', "process.exit(process.env.HOME === process.env.EXPECT_HOME ? 0 : 1);\n"));
  scopedEnv(t, 'EXPECT_HOME', real);
  await run(f, { sandbox: false });
  const report = await readReport(f);
  assert.equal(report.ok, true);
  assert.equal(report.effective.sandbox.enabled, false);
  const cli = spawnSync(process.execPath, [CLI, '--root', f.root, '--report', f.reportPath], { env: cliEnv(f, { KAMINOS_TEST_SANDBOX: 'off', EXPECT_HOME: path.join(f.root, 'home') }), encoding: 'utf8' });
  assert.match(cli.stdout, /^sandbox: off \(KAMINOS_TEST_SANDBOX=off\); tests see the real HOME and the shop's tools$/m);
});
