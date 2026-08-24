import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const modulePath = path.resolve('lib/receipt-bearing-browser-capture.mjs');
const carrierPresentAtStartup = existsSync(modulePath);
const VALID_ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function makeBrowser(root, body) {
  const executable = path.join(root, 'chrome-headless-shell');
  writeFileSync(executable, `#!/bin/sh\nset -eu\n${body}\n`);
  chmodSync(executable, 0o755);
  return executable;
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitUntil(predicate, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

function waitForClose(child, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`child did not close within ${timeoutMs}ms`)),
      timeoutMs,
    );
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

test('a receipt-bearing independent browser capture carrier exists', () => {
  assert.ok(
    carrierPresentAtStartup,
    'incident correction requires lib/receipt-bearing-browser-capture.mjs before operator capture resumes',
  );
});

test('the browser carrier exposes one-page DOM-and-pixel capture', async () => {
  const carrier = await import(pathToFileURL(modulePath));
  assert.equal(
    typeof carrier.captureSamePageBrowserScreenshot,
    'function',
    'identity-bearing screenshots must read DOM identity and pixels from one CDP page',
  );
});

test('successful capture kills surviving descendants and publishes exact identity', {
  skip: !carrierPresentAtStartup,
}, async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kaminos-browser-capture-success-'));
  try {
    const childPidPath = path.join(root, 'descendant.pid');
    const validPngPath = path.join(root, 'valid-1x1.png');
    writeFileSync(validPngPath, VALID_ONE_PIXEL_PNG);
    const executable = makeBrowser(root, String.raw`
out=''
for arg in "$@"; do
  case "$arg" in --screenshot=*) out="$(printf '%s' "$arg" | sed 's/^--screenshot=//')" ;; esac
done
sleep 600 </dev/null >/dev/null 2>/dev/null &
echo "$!" > "$KAMINOS_CAPTURE_CHILD_PID_FILE"
cp "$KAMINOS_CAPTURE_VALID_PNG" "$out"
echo 'capture complete' >&2
exit 0`);
    const outputPath = path.join(root, 'capture.png');
    const reportPath = path.join(root, 'capture-report.json');
    const result = await (await import(pathToFileURL(modulePath))).captureIndependentBrowserScreenshot({
      cliExecutable: executable,
      url: 'about:blank',
      outputPath,
      reportPath,
      environment: {
        KAMINOS_CAPTURE_CHILD_PID_FILE: childPidPath,
        KAMINOS_CAPTURE_VALID_PNG: validPngPath,
      },
      viewport: { width: 1, height: 1 },
      captureTimeoutMs: 2_000,
      cleanupGraceMs: 500,
    });

    const descendantPid = Number(readFileSync(childPidPath, 'utf8').trim());
    assert.equal(processExists(descendantPid), false, 'background browser descendant must not survive capture');
    assert.equal(result.report.status, 'complete');
    assert.equal(result.report.browser.request.source, 'cli');
    assert.equal(result.report.browser.effective.realPath, realpathSync(executable));
    assert.equal(result.report.browser.effective.kind, 'playwright-chromium-headless-shell');
    assert.equal(result.report.process.detachedProcessGroup, true);
    assert.equal(result.report.process.cleanup.groupPresentAfter, false);
    assert.equal(result.report.primaryOutput.path, outputPath);
    assert.match(result.report.primaryOutput.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(JSON.parse(readFileSync(reportPath, 'utf8')), result.report);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('public receipt mode preserves identity with locators and emits no host-private paths', {
  skip: !carrierPresentAtStartup,
}, async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'private-spicy-capture-root-'));
  try {
    const validPngPath = path.join(root, 'valid-1x1.png');
    writeFileSync(validPngPath, VALID_ONE_PIXEL_PNG);
    const executable = makeBrowser(root, String.raw`
out=''
for arg in "$@"; do
  case "$arg" in --screenshot=*) out="$(printf '%s' "$arg" | sed 's/^--screenshot=//')" ;; esac
done
cp "$KAMINOS_CAPTURE_VALID_PNG" "$out"
printf 'wrote %s\n' "$out" >&2
printf 'browser-cache %s\n' "$KAMINOS_CAPTURE_HOME_PATH" >&2
exit 0`);
    const outputPath = path.join(root, 'artifacts', 'capture.png');
    const reportPath = path.join(root, 'artifacts', 'capture-report.json');
    const result = await (await import(pathToFileURL(modulePath))).captureIndependentBrowserScreenshot({
      cliExecutable: executable,
      outputPath,
      reportPath,
      receiptRoot: root,
      environment: {
        KAMINOS_CAPTURE_VALID_PNG: validPngPath,
        KAMINOS_CAPTURE_HOME_PATH: path.join(homedir(), 'Library', 'Caches', 'browser'),
      },
      viewport: { width: 1, height: 1 },
    });

    const serialized = JSON.stringify(result.report);
    assert.doesNotMatch(serialized, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(serialized, new RegExp(homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(result.report.browser.effective.realPath, /^repo:\/\//);
    assert.equal(result.report.invocation.outputPath, 'repo://artifacts/capture.png');
    assert.equal(result.report.invocation.reportPath, 'repo://artifacts/capture-report.json');
    assert.equal(result.report.primaryOutput.path, 'repo://artifacts/capture.png');
    assert.equal(result.report.process.profileCleanup.path, 'tmp://independent-headless-profile');
    assert.match(result.report.stderr.tail, /repo:\/\/artifacts\/capture\.png/);
    assert.match(result.report.stderr.tail, /home:\/\/Library\/Caches\/browser/);
    assert.deepEqual(JSON.parse(readFileSync(reportPath, 'utf8')), result.report);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('structural PNG validation rejects wrong dimensions and chunk CRC corruption', {
  skip: !carrierPresentAtStartup,
}, async () => {
  const badCrcPng = Buffer.from(VALID_ONE_PIXEL_PNG);
  const idatTypeOffset = badCrcPng.indexOf(Buffer.from('IDAT'));
  assert.ok(idatTypeOffset > 0);
  badCrcPng[idatTypeOffset + 4] ^= 0x01;
  for (const scenario of [
    { name: 'wrong-dimensions', bytes: VALID_ONE_PIXEL_PNG, viewport: { width: 2, height: 1 }, error: /dimensions/i },
    { name: 'bad-crc', bytes: badCrcPng, viewport: { width: 1, height: 1 }, error: /CRC mismatch/i },
  ]) {
    const root = mkdtempSync(path.join(tmpdir(), `kaminos-browser-capture-${scenario.name}-`));
    try {
      const pngPath = path.join(root, 'candidate.png');
      writeFileSync(pngPath, scenario.bytes);
      const executable = makeBrowser(root, String.raw`
out=''
for arg in "$@"; do
  case "$arg" in --screenshot=*) out="$(printf '%s' "$arg" | sed 's/^--screenshot=//')" ;; esac
done
cp "$KAMINOS_CAPTURE_PNG" "$out"
exit 0`);
      const reportPath = path.join(root, 'capture-report.json');
      await assert.rejects(
        () => import(pathToFileURL(modulePath)).then(module => module.captureIndependentBrowserScreenshot({
          cliExecutable: executable,
          outputPath: path.join(root, 'capture.png'),
          reportPath,
          viewport: scenario.viewport,
          environment: { KAMINOS_CAPTURE_PNG: pngPath },
        })),
        scenario.error,
      );
      const report = JSON.parse(readFileSync(reportPath, 'utf8'));
      assert.equal(report.status, 'failed');
      assert.equal(report.failurePhase, 'validate-primary-output');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('signature-plus-text output fails structural PNG validation', {
  skip: !carrierPresentAtStartup,
}, async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kaminos-browser-capture-corrupt-png-'));
  try {
    const executable = makeBrowser(root, String.raw`
out=''
for arg in "$@"; do
  case "$arg" in --screenshot=*) out="$(printf '%s' "$arg" | sed 's/^--screenshot=//')" ;; esac
done
printf '\211PNG\r\n\032\nnot-a-decodable-png' > "$out"
exit 0`);
    const reportPath = path.join(root, 'capture-report.json');
    await assert.rejects(
      () => import(pathToFileURL(modulePath)).then(module => module.captureIndependentBrowserScreenshot({
        cliExecutable: executable,
        url: 'about:blank',
        outputPath: path.join(root, 'capture.png'),
        reportPath,
        viewport: { width: 1, height: 1 },
      })),
      /PNG|IHDR|chunk|structur/i,
    );
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.equal(report.status, 'failed');
    assert.equal(report.failurePhase, 'validate-primary-output');
    assert.equal(report.primaryOutput, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('failed capture bounds stderr, kills descendants, and leaves a phase-specific report', {
  skip: !carrierPresentAtStartup,
}, async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kaminos-browser-capture-failure-'));
  try {
    const childPidPath = path.join(root, 'descendant.pid');
    const executable = makeBrowser(root, String.raw`
sleep 600 </dev/null >/dev/null 2>/dev/null &
echo "$!" > "$KAMINOS_CAPTURE_CHILD_PID_FILE"
i=0
while [ "$i" -lt 200 ]; do printf 'oversized-stderr-%04d\n' "$i" >&2; i=$((i+1)); done
exit 7`);
    const reportPath = path.join(root, 'capture-report.json');
    await assert.rejects(
      () => import(pathToFileURL(modulePath)).then(module => module.captureIndependentBrowserScreenshot({
        cliExecutable: executable,
        url: 'about:blank',
        outputPath: path.join(root, 'capture.png'),
        reportPath,
        environment: { KAMINOS_CAPTURE_CHILD_PID_FILE: childPidPath },
        captureTimeoutMs: 2_000,
        cleanupGraceMs: 500,
        stderrLimitBytes: 256,
      })),
      /exited with code 7/i,
    );

    const descendantPid = Number(readFileSync(childPidPath, 'utf8').trim());
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.equal(processExists(descendantPid), false, 'failed capture descendant must not survive');
    assert.equal(report.status, 'failed');
    assert.equal(report.failurePhase, 'wait-for-browser-capture');
    assert.equal(report.process.exit.code, 7);
    assert.equal(report.process.cleanup.groupPresentAfter, false);
    assert.equal(report.stderr.limitBytes, 256);
    assert.equal(report.stderr.truncated, true);
    assert.ok(report.stderr.totalBytes > report.stderr.retainedBytes);
    assert.ok(report.lastTrustworthyEvidence.browser.effective.realPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('stable Chrome rejection still publishes a failure receipt before primary output', {
  skip: !carrierPresentAtStartup,
}, async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kaminos-browser-capture-stable-'));
  try {
    const executable = path.join(
      root,
      'Applications',
      'Google Chrome.app',
      'Contents',
      'MacOS',
      'Google Chrome',
    );
    const executableDirectory = path.dirname(executable);
    const { mkdirSync } = await import('node:fs');
    mkdirSync(executableDirectory, { recursive: true });
    writeFileSync(executable, '#!/bin/sh\nexit 0\n');
    chmodSync(executable, 0o755);
    const reportPath = path.join(root, 'capture-report.json');
    await assert.rejects(
      () => import(pathToFileURL(modulePath)).then(module => module.captureIndependentBrowserScreenshot({
        cliExecutable: executable,
        outputPath: path.join(root, 'capture.png'),
        reportPath,
      })),
      /installed stable Chrome.*forbidden/i,
    );
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.equal(report.status, 'failed');
    assert.equal(report.failurePhase, 'resolve-browser');
    assert.equal(report.browser.request.executable, executable);
    assert.equal(report.browser.effective, null);
    assert.equal(report.primaryOutput, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an executable with an unusable interpreter fails with a durable spawn-phase receipt', {
  skip: !carrierPresentAtStartup,
}, async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kaminos-browser-capture-spawn-failure-'));
  try {
    const executable = path.join(root, 'chrome-headless-shell');
    writeFileSync(executable, '#!/definitely/missing/browser-interpreter\n');
    chmodSync(executable, 0o755);
    const reportPath = path.join(root, 'capture-report.json');
    await assert.rejects(
      () => import(pathToFileURL(modulePath)).then(module => module.captureIndependentBrowserScreenshot({
        cliExecutable: executable,
        outputPath: path.join(root, 'capture.png'),
        reportPath,
      })),
      /spawn|process id|ENOENT/i,
    );
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.equal(report.status, 'failed');
    assert.match(report.failurePhase, /launch-browser-capture|wait-for-browser-capture/);
    assert.equal(report.primaryOutput, null);
    assert.equal(report.browser.effective.realPath, realpathSync(executable));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const parentSignal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  test(`${parentSignal} of the capture parent kills its detached browser group and writes an interruption report`, {
    skip: !carrierPresentAtStartup,
  }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kaminos-browser-capture-parent-signal-'));
  let browserProcessGroupId = null;
  try {
    const browserPidPath = path.join(root, 'browser-processes.pid');
    const executable = makeBrowser(root, String.raw`
sleep 600 </dev/null >/dev/null 2>/dev/null &
echo "$$ $!" > "$KAMINOS_CAPTURE_CHILD_PID_FILE"
wait`);
    const reportPath = path.join(root, 'capture-report.json');
    const captureParent = spawn(process.execPath, [
      path.resolve('muscle-compartment-packing-capture.mjs'),
      '--browser', executable,
      '--url', 'about:blank',
      '--state', 'packed',
      '--out', path.join(root, 'capture.png'),
      '--report', reportPath,
      '--timeout-ms', '60000',
      '--cleanup-grace-ms', '500',
    ], {
      env: { ...process.env, KAMINOS_CAPTURE_CHILD_PID_FILE: browserPidPath },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    await waitUntil(() => existsSync(browserPidPath));
    const [browserPid, descendantPid] = readFileSync(browserPidPath, 'utf8').trim().split(/\s+/).map(Number);
    browserProcessGroupId = browserPid;
    assert.equal(processExists(browserPid), true);
    assert.equal(processExists(descendantPid), true);

    captureParent.kill(parentSignal);
    const parentExit = await waitForClose(captureParent);
    await waitUntil(() => !processExists(browserPid) && !processExists(descendantPid));

    assert.notEqual(parentExit.code, 0);
    assert.ok(existsSync(reportPath), 'parent interruption must leave a durable report');
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.equal(report.status, 'failed');
    assert.equal(report.failurePhase, 'parent-interrupted');
    assert.equal(report.interruption.signal, parentSignal);
    assert.equal(report.process.processGroupId, browserPid);
    assert.equal(report.process.cleanup.groupPresentAfter, false);
    assert.ok(report.lastTrustworthyEvidence.browser.effective.realPath);
  } finally {
    if (browserProcessGroupId && processExists(browserProcessGroupId)) {
      try { process.kill(-browserProcessGroupId, 'SIGKILL'); } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
  });
}
