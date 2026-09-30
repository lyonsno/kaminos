import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fluidBrowserLaunch } from '../finger-fluid-browser-launch.mjs';

const input = { executable: '/isolated/Chrome for Testing', debugPort: 19302,
  userDataDir: '/isolated/profile', width: 1440, height: 900,
  realpath: path => path };
const launch = fluidBrowserLaunch(input);
assert.ok(launch.args.includes('--use-mock-keychain'), 'disposable capture must avoid real macOS Keychain access');
assert.ok(launch.args.includes('--password-store=basic'), 'automation uses a profile-local password store');
assert.equal(launch.executable, input.executable);
assert.ok(launch.args.includes('--remote-debugging-port=19302'));
assert.ok(launch.args.includes('--user-data-dir=/isolated/profile'));
assert.throws(() => fluidBrowserLaunch({ ...input, executable: undefined }), /KAMINOS_CHROME/, 'missing independent browser fails before launch');
assert.throws(() => fluidBrowserLaunch({ ...input, executable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }), /independent/, 'operator Chrome cannot become the test browser');
assert.throws(() => fluidBrowserLaunch({ ...input, realpath: () => '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }), /independent/, 'symlink cannot hide operator Chrome');
assert.throws(() => fluidBrowserLaunch({ ...input, realpath: () => { throw new Error('ENOENT'); } }), /ENOENT/, 'missing executable fails before spawn');
console.log('Fluid browser launcher policy passed');

const badExecutable = mkdtempSync(join(tmpdir(), 'fluid-browser-launch-error-'));
try {
  const reportPath = join(badExecutable, 'report.json');
  const child = spawnSync(process.execPath, [new URL('../finger-fluid-bench-witness.mjs', import.meta.url).pathname,
    '--report', reportPath, '--out', join(badExecutable, 'frame.png')],
    { env: { ...process.env, KAMINOS_CHROME: badExecutable }, encoding: 'utf8' });
  assert.equal(child.status, 1, 'unlaunchable executable fails the maintained witness');
  assert.ok(existsSync(reportPath), 'spawn failure must preserve a durable failure report');
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(report.ok, false);
  assert.equal(report.failure_phase, 'launch_browser');
  assert.equal(report.chrome, realpathSync(badExecutable));
  assert.match(report.error, /EACCES/);
  assert.equal(existsSync(join(badExecutable, 'frame.png')), false);
} finally { rmSync(badExecutable, { recursive: true, force: true }); }
console.log('Fluid browser spawn failure reporting passed');
