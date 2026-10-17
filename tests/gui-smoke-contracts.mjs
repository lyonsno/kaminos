// kaminos-test: browser route — runs tests/gui-smoke.mjs with stub browsers, a forced runner timeout and a temporary HOME
// Contracts of the GUI smoke's harness: it never reaches the installed Google
// Chrome, it launches the browser with the mock keychain, the basic password
// store and a profile in its run directory, a runner timeout leaves no server or browser behind and a receipt
// naming the phase, and a full run leaves its HOME's stores untouched.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runSuite } from '../tools/test-runner.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const smoke = path.join(root, 'tests', 'gui-smoke.mjs');
const delay = ms => new Promise(r => setTimeout(r, ms));

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Answers the runner's --version probe at once, like a real browser, so only
// the smoke's own launch reaches the rest of a stub.
const VERSION_PROBE = 'for a in "$@"; do [ "$a" = --version ] && { echo "Stub Browser 1.0"; exit 0; }; done\n';

function writeExecutable(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { mode: 0o755 });
  fs.chmodSync(file, 0o755);
  return file;
}

// The receipt path is printed when the run starts.
function receiptOf(t, output) {
  const receiptPath = String(output).match(/gui smoke receipt: (\S+\.json)/)?.[1];
  assert.ok(receiptPath, `the smoke printed no receipt path:\n${String(output).slice(-2000)}`);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  t.after(() => {
    fs.rmSync(receiptPath, { force: true });
    if (receipt.isolation?.runDir) fs.rmSync(receipt.isolation.runDir, { recursive: true, force: true });
  });
  return receipt;
}

// A HOME holding what an operator's machine holds: saved cockpit layouts with
// an active pointer at a stale record, presets, splats and Greenroom state.
function seededHome(t) {
  const home = tempDir(t, 'kaminos-gui-smoke-home-');
  const files = {
    '.local/share/kaminos/volume-cockpit-layouts/layouts/operator-layout.json': JSON.stringify({ identity: 'kaminos.volume.cockpit-layout-artifact.v1', layoutId: 'operator-layout', contentHash: 'sha256:stale', layout: { groups: [{ controlIds: ['volume-control-that-no-longer-exists'] }] } }),
    '.local/share/kaminos/volume-cockpit-layouts/active.json': JSON.stringify({ identity: 'kaminos.volume.cockpit-layout-active.v1', layoutId: 'operator-layout', contentHash: 'sha256:stale', updatedAt: '2026-10-01T00:00:00Z' }),
    '.local/share/kaminos/volume-settings-presets/presets/operator.json': '{}',
    '.local/share/kaminos/volume-basin-drive-sessions/sessions/operator.json': '{}',
    '.local/share/kaminos/basins/operator.json': '{}',
    '.local/state/kaminos/assets/splats/inbox/operator.splat': 'splat',
    '.local/state/gpu-greenroom/done/operator-job.json': '{}',
  };
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
    fs.writeFileSync(path.join(home, rel), body);
  }
  return home;
}

// Every entry under a directory with its type, size and modification time.
function listing(dir) {
  const out = {};
  const walk = rel => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      const stat = fs.lstatSync(path.join(dir, child));
      out[child] = `${entry.isDirectory() ? 'dir' : 'file'} ${stat.size} ${stat.mtimeMs}`;
      if (entry.isDirectory()) walk(child);
    }
  };
  walk('');
  return out;
}

const realBrowser = process.env.KAMINOS_CHROME && !process.env.KAMINOS_CHROME.endsWith('browser-launch-stub.sh') ? process.env.KAMINOS_CHROME : null;

test('a KAMINOS_CHROME that resolves into the installed Google Chrome is refused before anything starts, through a link or spelled in lowercase', t => {
  const dir = tempDir(t, 'kaminos-gui-smoke-guard-');
  const marker = path.join(dir, 'launched');
  const installed = writeExecutable(path.join(dir, 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
    `#!/bin/sh\necho launched > '${marker}'\nexec sleep 30\n`);
  const link = path.join(dir, 'chrome-for-testing');
  fs.symlinkSync(installed, link);
  // On a case-insensitive volume the lowercase spelling names the same file.
  const lower = path.join(dir, 'applications', 'google chrome.app', 'contents', 'macos', 'google chrome');
  const spellings = [link, ...(fs.existsSync(lower) ? [lower] : [])];
  if (spellings.length === 1) t.diagnostic('case-sensitive volume: the lowercase spelling is a different, missing path here');
  const home = seededHome(t);
  for (const chrome of spellings) {
    const res = spawnSync(process.execPath, [smoke], { cwd: root, encoding: 'utf8', timeout: 120000, env: { ...process.env, HOME: home, KAMINOS_CHROME: chrome } });
    const receipt = receiptOf(t, res.stdout);
    assert.equal(res.status, 1, `${chrome}\n${res.stdout}${res.stderr}`);
    assert.equal(receipt.failurePhase, 'browser-executable', chrome);
    assert.match(receipt.error, /resolves to the installed Google Chrome/, chrome);
    assert.equal(receipt.executableRealpath, fs.realpathSync.native(installed), chrome);
    assert.equal(receipt.server, null, `no server was started for ${chrome}`);
    assert.equal(fs.existsSync(marker), false, `the installed-Chrome stand-in never ran for ${chrome}`);
  }
});

test('the browser is launched with the mock keychain, the basic password store and a private profile in the run directory, so macOS raises no Keychain dialog', async t => {
  const dir = tempDir(t, 'kaminos-gui-smoke-argv-');
  // A browser that records its arguments and exits at once, so the smoke
  // fails in its browser-launch phase without waiting for a timeout.
  const argvFile = path.join(dir, 'argv');
  const recording = writeExecutable(path.join(dir, 'recording-browser'), `#!/bin/sh\n${VERSION_PROBE}printf '%s\\n' "$@" > '${argvFile}'\nexit 3\n`);
  const home = seededHome(t);
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  t.after(() => { process.env.HOME = previousHome; });
  const reportPath = path.join(dir, 'report.json');
  await runSuite({ root, only: ['tests/gui-smoke.mjs'], browser: recording, timeoutMs: 120000, parallel: 1, reportPath, logsDir: path.join(dir, 'logs'), lateLaunchSettleMs: 0 });
  process.env.HOME = previousHome;
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const result = report.results.find(r => r.file === 'tests/gui-smoke.mjs');
  assert.ok(result?.log, JSON.stringify(report.results));
  const receipt = receiptOf(t, fs.readFileSync(result.log, 'utf8'));
  assert.ok(fs.existsSync(argvFile), `the browser was launched (the run reached ${receipt.phase}: ${receipt.error})`);
  assert.equal(receipt.failurePhase, 'browser-launch', receipt.error);
  const argv = fs.readFileSync(argvFile, 'utf8').split('\n').filter(Boolean);
  assert.ok(argv.includes('--use-mock-keychain'), `--use-mock-keychain in ${argv.join(' ')}`);
  assert.ok(argv.includes('--password-store=basic'), `--password-store=basic in ${argv.join(' ')}`);
  const profiles = argv.filter(a => a.startsWith('--user-data-dir='));
  assert.deepEqual(profiles, [`--user-data-dir=${receipt.isolation.browserProfile}`], argv.join(' '));
  assert.ok(receipt.isolation.browserProfile.startsWith(`${receipt.isolation.runDir}${path.sep}`), receipt.isolation.browserProfile);
});

test('a runner timeout stops the server and the browser with the test, and leaves a receipt naming the phase it reached', async t => {
  const dir = tempDir(t, 'kaminos-gui-smoke-timeout-');
  // A browser that never opens its DevTools port, so the run waits until the
  // runner's timeout kills it.
  const hanging = writeExecutable(path.join(dir, 'hanging-browser'), `#!/bin/sh\n${VERSION_PROBE}exec sleep 600\n`);
  const home = seededHome(t);
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  t.after(() => { process.env.HOME = previousHome; });
  const reportPath = path.join(dir, 'report.json');
  await runSuite({ root, only: ['tests/gui-smoke.mjs'], browser: hanging, timeoutMs: 9000, parallel: 1, reportPath, logsDir: path.join(dir, 'logs'), lateLaunchSettleMs: 0 });
  process.env.HOME = previousHome;
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const result = report.results.find(r => r.file === 'tests/gui-smoke.mjs');
  assert.equal(result?.outcome, 'timeout', JSON.stringify(report.results));
  const receipt = receiptOf(t, fs.readFileSync(result.log, 'utf8'));
  assert.equal(receipt.finishedAt, null, 'the run was killed before it finished');
  assert.ok(['server', 'browser-launch'].includes(receipt.phase), `the receipt names the phase it reached: ${receipt.phase}`);
  assert.ok(receipt.server?.pid, 'the receipt records the server pid');
  await delay(500);
  for (const pid of [receipt.server.pid, receipt.browserPid].filter(Boolean)) {
    assert.throws(() => process.kill(pid, 0), /ESRCH/, `process ${pid} outlived the killed test`);
  }
  const ps = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).stdout;
  const leftovers = ps.split('\n').filter(line => receipt.isolation?.runDir && line.includes(receipt.isolation.runDir));
  assert.deepEqual(leftovers, [], 'no process still uses the run directory');
});

test('a full run leaves the stores of its HOME untouched and keeps every path it writes inside its run directory',
  { skip: realBrowser ? false : 'needs KAMINOS_CHROME naming a Chrome for Testing executable (the runner sets it under KAMINOS_BROWSER)' }, async t => {
    const home = seededHome(t);
    const before = listing(home);
    const child = spawn(process.execPath, [smoke], { cwd: root, env: { ...process.env, HOME: home, KAMINOS_CHROME: realBrowser }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });
    const [code] = await new Promise(resolve => child.on('close', (...args) => resolve(args)));
    assert.deepEqual(listing(home), before, 'nothing under HOME changed');
    const receipt = receiptOf(t, output);
    // For checking the system log for this browser afterwards.
    t.diagnostic(`browser pid ${receipt.browserPid}, ${receipt.browserVersion}, started ${receipt.startedAt}`);
    assert.equal(code, 0, output.slice(-3000));
    const { isolation } = receipt;
    const bases = [isolation.runDir, isolation.runDirReal];
    const inside = p => bases.some(base => path.resolve(p).startsWith(`${base}${path.sep}`));
    for (const key of ['home', 'volumeSettingsStore', 'volumeBasinSessionStore', 'volumeCockpitLayoutStore', 'scenes', 'lermsPreview', 'browserProfile']) {
      assert.ok(inside(isolation[key]), `${key} ${isolation[key]} is inside ${isolation.runDir}`);
    }
    for (const [key, value] of Object.entries(isolation.effective)) {
      if (key === 'sharedBasinStore') { assert.equal(value, null); continue; }
      assert.ok(inside(value), `serve.py's ${key} ${value} is inside ${isolation.runDir}`);
    }
    assert.equal(isolation.removed, true, 'the run directory was removed');
  });
