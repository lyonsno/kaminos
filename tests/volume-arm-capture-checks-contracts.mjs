import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, chmodSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { effectiveMismatches, resolveHeadlessBrowser } from '../volume-arm-capture-checks.mjs';

const capture = readFileSync(new URL('../volume-transport-arm-capture.mjs', import.meta.url), 'utf8');

test('swirl check: a missing or nonfinite effective swirl is a mismatch, not a pass', () => {
  const arm = { set: [['volume-emitter-swirl', '0.6']] };
  const at = swirl => effectiveMismatches(arm, { inflowBoundary: { effective: swirl === undefined ? {} : { swirl } } }, null);
  assert.equal(at(0.6).length, 0, 'a matching finite value passes');
  assert.equal(at(0).length, 1, 'a different value fails');
  assert.equal(at(undefined).length, 1, 'an absent value fails');
  assert.equal(at(Number.NaN).length, 1, 'a nonfinite value fails');
  assert.equal(effectiveMismatches(arm, {}, null).length, 1, 'no inflow receipt at all fails');
  assert.match(at(undefined)[0], /swirl requested 0\.6, effective undefined/);
});

test('heat release gain is checked against the receipt: absent, refused or different fails', () => {
  const arm = { set: [['volume-heat-release-expansion', '1.5']] };
  assert.deepEqual(effectiveMismatches(arm, { heatRelease: { effective: { admitted: true, expansion: 1.5, reason: null } } }, null), []);
  assert.equal(effectiveMismatches(arm, {}, null).length, 1, 'no receipt fails');
  assert.match(effectiveMismatches(arm, { heatRelease: { effective: { admitted: false, expansion: 0, reason: 'heat-release-requires-converged-open-top-pressure-solver' } } }, null)[0], /not admitted/);
  assert.equal(effectiveMismatches(arm, { heatRelease: { effective: { admitted: true, expansion: 1, reason: null } } }, null).length, 1, 'a different gain fails');
  // The zero-gain arm is the control: an active expansion receipt must fail it (review HR-01).
  const off = { set: [['volume-heat-release-expansion', '0']] };
  assert.deepEqual(effectiveMismatches(off, { heatRelease: { effective: { admitted: false, expansion: 0, reason: 'heat-release-expansion-is-zero' } } }, null), [], 'off with a refused-zero receipt passes');
  assert.equal(effectiveMismatches(off, { heatRelease: { effective: { admitted: true, expansion: 1, reason: null } } }, null).length, 1, 'requested off must reject an active gain-1 receipt');
  assert.equal(effectiveMismatches(off, { heatRelease: { effective: { admitted: false, expansion: 0.4, reason: null } } }, null).length, 1, 'requested off must reject a nonzero effective gain even when not admitted');
});

test('slice-3 inlet controls are checked against the receipt and fail when absent', () => {
  const arm = { set: [['volume-emitter-inlet-turbulence', '0.4'], ['volume-emitter-puff-period', '3'], ['volume-emitter-line-weight', '1.5']] };
  const good = { inflowBoundary: { effective: { pattern: { lineWeight: 1.5 }, inletDynamics: { turbulence: 0.4, puffPeriod: 3 } } } };
  assert.deepEqual(effectiveMismatches(arm, good, null), []);
  assert.equal(effectiveMismatches(arm, { inflowBoundary: { effective: { pattern: {}, inletDynamics: { turbulence: 0.4 } } } }, null).length, 2, 'missing line weight and puff period fail');
  assert.equal(effectiveMismatches(arm, { inflowBoundary: { effective: { pattern: { lineWeight: 1.5 }, inletDynamics: { turbulence: 0, puffPeriod: 3 } } } }, null).length, 1, 'a turbulence that did not take effect fails');
});

test('confinement epsilon faults reach the checks through the fault argument, not a module variable', () => {
  const arm = { set: [['@confinementEpsilon', '0.3']] };
  const end = { confinement: { mode: 'calibrated', confinementAmount: 0.3 }, confinementUniform: { mode: 1, confinementAmount: Math.fround(0.3) } };
  assert.deepEqual(effectiveMismatches(arm, end, 'calibrated'), [], 'a faithful receipt passes with no fault');
  assert.ok(effectiveMismatches(arm, end, 'calibrated', 'packed-epsilon').some(m => /packed epsilon/.test(m)), 'the packed-epsilon fault makes the comparison fail');
});

test('headless browser: an independent executable is required; the installed GUI Chrome is never launched', () => {
  const root = mkdtempSync(join(tmpdir(), 'kaminos-browser-'));
  const pw = join(root, 'ms-playwright');
  const binary = join(pw, 'chromium-1243', 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
  mkdirSync(join(binary, '..'), { recursive: true }); writeFileSync(binary, ''); chmodSync(binary, 0o755);
  const older = binary.replace('chromium-1243', 'chromium-1200'); mkdirSync(join(older, '..'), { recursive: true }); writeFileSync(older, ''); chmodSync(older, 0o755);
  const found = resolveHeadlessBrowser({ env: {}, playwrightRoot: pw });
  assert.equal(found.executable, binary, 'the newest Playwright Chromium is chosen');
  assert.equal(found.source, 'playwright-chromium');
  const override = join(root, 'my-chrome'); writeFileSync(override, ''); chmodSync(override, 0o755);
  assert.deepEqual(resolveHeadlessBrowser({ env: { KAMINOS_HEADLESS_BROWSER: override }, playwrightRoot: pw }), { executable: override, resolvedExecutable: realpathSync(override), source: 'KAMINOS_HEADLESS_BROWSER' });
  // The refusal is by canonical identity, not by spelling: a dot segment or a
  // symlink alias of the GUI bundle is the same executable.
  const gui = join(root, 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome');
  mkdirSync(dirname(gui), { recursive: true }); writeFileSync(gui, ''); chmodSync(gui, 0o755);
  assert.throws(() => resolveHeadlessBrowser({ env: { KAMINOS_HEADLESS_BROWSER: gui }, playwrightRoot: pw }), /installed GUI Chrome/, 'the GUI app bundle is refused when named');
  assert.throws(() => resolveHeadlessBrowser({ env: { KAMINOS_HEADLESS_BROWSER: join(root, 'Applications', '.', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome') }, playwrightRoot: pw }), /installed GUI Chrome/, 'a dot-segment spelling of the bundle is refused');
  const alias = join(root, 'chrome-alias'); symlinkSync(gui, alias);
  assert.throws(() => resolveHeadlessBrowser({ env: { KAMINOS_HEADLESS_BROWSER: alias }, playwrightRoot: pw }), /installed GUI Chrome/, 'a symlink alias of the bundle is refused');
  assert.throws(() => resolveHeadlessBrowser({ env: { KAMINOS_HEADLESS_BROWSER: root }, playwrightRoot: pw }), /not an executable file/, 'a directory is refused');
  const plain = join(root, 'not-executable'); writeFileSync(plain, ''); chmodSync(plain, 0o644);
  assert.throws(() => resolveHeadlessBrowser({ env: { KAMINOS_HEADLESS_BROWSER: plain }, playwrightRoot: pw }), /not an executable file/, 'a non-executable file is refused');
  const viaLink = join(root, 'pw-alias'); symlinkSync(binary, viaLink);
  const resolvedAlias = resolveHeadlessBrowser({ env: { KAMINOS_HEADLESS_BROWSER: viaLink }, playwrightRoot: pw });
  assert.equal(resolvedAlias.resolvedExecutable, realpathSync(binary), 'the canonical identity is recorded');
  assert.throws(() => resolveHeadlessBrowser({ env: {}, playwrightRoot: join(root, 'nowhere') }), /no independent headless browser/, 'absence fails visibly');
  assert.doesNotMatch(capture, /Google Chrome\.app/, 'the capture no longer names the GUI app');
  assert.match(capture, /resolveHeadlessBrowser\(/, 'the capture resolves its executable through the shared resolver');
  assert.match(capture, /'--use-mock-keychain','--password-store=basic'/, 'the browser never raises the macOS keychain dialog on the operator screen');
  assert.match(capture, /executable: headlessBrowser\.executable/, 'the report records the effective executable');
  // The devtools socket is constructed only after the last await that precedes
  // its open listener, and the open wait is bounded by --call-timeout-ms.
  const versionFetch = capture.indexOf('/json/version'); const socket = capture.indexOf('ws = new WebSocket(page.webSocketDebuggerUrl)'); const openWait = capture.indexOf("ws.addEventListener('open'");
  assert.ok(versionFetch > 0 && versionFetch < socket && socket < openWait, 'version fetch, then socket construction, then the open listener, with no await between the last two');
  const between = capture.slice(socket, openWait); const awaits = between.match(/await/g) || [];
  assert.ok(awaits.length === 1 && /await new Promise\(\(res, rej\) => \{ const timer/.test(between), 'the only await between constructing the socket and listening for open is the bounded open wait itself');
  assert.match(capture.slice(openWait - 400, openWait + 400), /devtools socket did not open within \$\{callTimeoutMs\} ms/, 'the open wait is bounded');
});

// A launch that fails after validation (an executable script whose interpreter
// is a directory: the kernel's EACCES, which Node reports asynchronously on the
// child's 'error' event, unlike the synchronous ENOEXEC) must end in the
// capture's own failure path: a terminal
// report naming the phase and the error, nonzero exit, the owned profile gone.
// The runtime-config fetch is replaced by a preload so no server is contacted;
// its identity is synthetic test input, not source evidence.
test('capture: an asynchronous launch error is a terminal browser-launch failure with cleanup, not an unhandled exit', () => {
  const root = mkdtempSync(join(tmpdir(), 'kaminos-capture-launch-'));
  const bogus = join(root, 'bogus-browser'); writeFileSync(bogus, '#!/\n'); chmodSync(bogus, 0o755);
  const preload = join(root, 'preload.mjs');
  writeFileSync(preload, `globalThis.fetch = async (url) => { if (String(url).includes('/api/runtime-config')) return { ok: true, json: async () => ({ source: { repoRoot: ${JSON.stringify(root)}, commit: 'synthetic', dirty: false } }) }; throw new Error('no network in this test: ' + url); };\n`);
  const out = join(root, 'out');
  const run = spawnSync(process.execPath, ['--import', preload, new URL('../volume-transport-arm-capture.mjs', import.meta.url).pathname, 'http://127.0.0.1:1/volume-settings-preset.html?preset=x', out, 'arm,volume-speed=1', '5000', '--settle-steps', '1', '--expected-repo-root', root, '--expected-commit', 'synthetic'],
    { env: { ...process.env, KAMINOS_HEADLESS_BROWSER: bogus, TMPDIR: root }, encoding: 'utf8', timeout: 60000 });
  assert.notEqual(run.status, 0, 'nonzero exit');
  const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'browser-launch');
  assert.match(String(report.failure), /failed to launch: spawn .*EACCES/, `the launch error is recorded (${report.failure})`);
  assert.ok(report.finishedAt, 'the report is terminal');
  assert.equal(report.browser.executable, bogus, 'the attempted executable is recorded');
  assert.ok(report.browser.profile, 'the owned profile is recorded before launch');
  assert.ok(!existsSync(report.browser.profile), 'the owned profile is removed');
  assert.doesNotMatch(run.stderr, /Unhandled|triggerUncaughtException/, 'no unhandled error escaped');
});

// The launch-phase fetches, the socket wait and the devtools calls are bounded
// by --call-timeout-ms (the DevToolsActivePort poll keeps its own fixed 20 s
// bound), including the optional browser-version read: a pending /json/version response must not
// hold the capture. The browser is a shell script that publishes a
// DevToolsActivePort and sleeps; the preload answers runtime-config and
// /json synthetically and leaves /json/version pending forever. The capture
// must record the version as unavailable, go on to the socket (which fails at
// a closed port), and end in its own terminal failure with cleanup, without
// any external signal.
test('capture: a pending browser-version response is bounded by --call-timeout-ms and does not hold the capture', () => {
  const root = mkdtempSync(join(tmpdir(), 'kaminos-capture-version-'));
  const fake = join(root, 'fake-browser');
  writeFileSync(fake, '#!/bin/sh\nfor a in "$@"; do case "$a" in --user-data-dir=*) d="${a#--user-data-dir=}";; esac; done\nprintf "1\\n/devtools/browser/x\\n" > "$d/DevToolsActivePort"\nsleep 300\n'); chmodSync(fake, 0o755);
  const preload = join(root, 'preload.mjs');
  writeFileSync(preload, `globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('/api/runtime-config')) return { ok: true, json: async () => ({ source: { repoRoot: ${JSON.stringify(root)}, commit: 'synthetic', dirty: false } }) };
  if (u.endsWith('/json/version')) return new Promise((_, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('aborted by the capture')), { once: true }); });
  if (u.endsWith('/json')) return { ok: true, json: async () => ([{ type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/page/x' }]) };
  throw new Error('no network in this test: ' + u);
};\n`);
  const out = join(root, 'out');
  const started = Date.now();
  const run = spawnSync(process.execPath, ['--import', preload, new URL('../volume-transport-arm-capture.mjs', import.meta.url).pathname, 'http://127.0.0.1:1/volume-settings-preset.html?preset=x', out, 'arm,volume-speed=1', '5000', '--settle-steps', '1', '--call-timeout-ms', '1500', '--expected-repo-root', root, '--expected-commit', 'synthetic'],
    { env: { ...process.env, KAMINOS_HEADLESS_BROWSER: fake, TMPDIR: root }, encoding: 'utf8', timeout: 30000 });
  assert.notEqual(run.signal, 'SIGTERM', 'the capture ended on its own, not by the test timeout');
  assert.notEqual(run.status, 0, 'nonzero exit');
  assert.ok(Date.now() - started < 20000, 'ended within a few call timeouts');
  const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'browser-launch');
  assert.match(String(report.failure), /devtools socket/, `the capture reached the socket wait and failed there (${report.failure})`);
  assert.equal(report.browser.version, null, 'the version is recorded as unavailable');
  assert.match(String(report.browser.versionUnavailable), /--call-timeout-ms/, 'and says why');
  assert.ok(report.finishedAt, 'terminal');
  assert.ok(!existsSync(report.browser.profile), 'the owned profile is removed');
  assert.doesNotMatch(run.stderr, /Unhandled|triggerUncaughtException/, 'no unhandled error escaped');
});

// `@savePreset=<label>` saves the arm's current controls as a basin through the
// cockpit's own Save button (the cockpit builds the authoritative payload; the
// server content-addresses it), waits for the cockpit's own saved status, and
// records the label and preset id in the arm. A status that never names a
// `vsp-` id is a failure, not a pass.
test('capture: @savePreset saves through the cockpit and records the write receipt, failing when no id appears', () => {
  assert.match(capture, /cid === '@savePreset'/, 'the capture knows the debug action');
  assert.match(capture, /settings-preset-label/, 'it sets the cockpit label input');
  assert.match(capture, /settings-preset-save/, 'and presses the cockpit Save button');
  assert.match(capture, /volume-settings-preset-state/, 'it reads the cockpit status for the receipt');
  assert.match(capture, /presetSaves/, 'the arm records the saves');
  assert.match(capture, /@savePreset \$\{value\} did not produce a saved preset id/, 'a missing id fails the arm');
  assert.match(capture, /PRESET SAVE FAILED/, 'a cockpit-reported failure fails the arm');
});

// The devtools discovery must wait for a page target, not just for /json to
// answer: a browser that has not opened its first page yet lists no page and
// the capture died on an undefined webSocketDebuggerUrl (retired-save-a664da19).
test('capture: devtools discovery waits for a page target and names its absence', () => {
  assert.match(capture, /page = pages\?\.find\(p => p\.type === 'page'\);\s*\n\s*if \(!page\) await sleep\(100\);/, 'the page target is looked up inside the discovery loop and polled until present');
  assert.match(capture, /if \(!page\) fail\('browser-launch', `devtools endpoint on port \$\{port\} \(pid \$\{chrome\.pid\}\) never listed a page target/, 'absence of a page target is a named browser-launch failure');
  assert.doesNotMatch(capture, /const page = pages\.find\(p => p\.type === 'page'\); ws = new WebSocket/, 'the socket is never opened from an unchecked page lookup');
});
