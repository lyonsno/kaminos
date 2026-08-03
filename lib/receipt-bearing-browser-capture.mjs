import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  mkdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import {
  headlessBrowserRequest,
  resolveHeadlessBrowser,
} from './headless-browser-resolver.mjs';

export const RECEIPT_BEARING_CAPTURE_SCHEMA = 'kaminos.receipt-bearing-browser-capture.v0';
export const RECEIPT_BEARING_CAPTURE_ROUTE = 'independent-headless-screenshot-v0';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SIGNAL_EXIT_CODES = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 };
const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function validatePng(bytes, viewport) {
  if (bytes.length <= PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('browser capture did not produce a PNG primary output');
  }
  let offset = PNG_SIGNATURE.length;
  let chunkCount = 0;
  let ihdr = null;
  let idatBytes = 0;
  let sawIend = false;
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) throw new Error('PNG contains a truncated chunk header');
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) throw new Error('PNG contains a truncated chunk body');
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const expectedCrc = bytes.readUInt32BE(dataEnd);
    const effectiveCrc = crc32(Buffer.concat([typeBytes, bytes.subarray(dataStart, dataEnd)]));
    if (expectedCrc !== effectiveCrc) throw new Error(`PNG ${type} chunk CRC mismatch`);
    chunkCount += 1;

    if (chunkCount === 1 && type !== 'IHDR') throw new Error('PNG first chunk must be IHDR');
    if (type === 'IHDR') {
      if (ihdr || length !== 13) throw new Error('PNG must contain exactly one 13-byte IHDR');
      ihdr = {
        width: bytes.readUInt32BE(dataStart),
        height: bytes.readUInt32BE(dataStart + 4),
        bitDepth: bytes[dataStart + 8],
        colorType: bytes[dataStart + 9],
        compression: bytes[dataStart + 10],
        filter: bytes[dataStart + 11],
        interlace: bytes[dataStart + 12],
      };
      if (ihdr.width === 0 || ihdr.height === 0) throw new Error('PNG IHDR dimensions must be positive');
      if (ihdr.compression !== 0 || ihdr.filter !== 0 || ihdr.interlace > 1) {
        throw new Error('PNG IHDR uses unsupported structural values');
      }
    } else if (type === 'IDAT') {
      if (!ihdr || sawIend || length === 0) throw new Error('PNG IDAT placement or length is invalid');
      idatBytes += length;
    } else if (type === 'IEND') {
      if (length !== 0 || sawIend) throw new Error('PNG must contain one empty IEND');
      sawIend = true;
      if (dataEnd + 4 !== bytes.length) throw new Error('PNG IEND must be the terminal chunk');
    }
    offset = dataEnd + 4;
  }
  if (!ihdr) throw new Error('PNG is missing IHDR');
  if (idatBytes === 0) throw new Error('PNG is missing nonempty IDAT data');
  if (!sawIend) throw new Error('PNG is missing terminal IEND');
  if (ihdr.width !== viewport.width || ihdr.height !== viewport.height) {
    throw new Error(
      `PNG dimensions ${ihdr.width}x${ihdr.height} do not match requested viewport `
      + `${viewport.width}x${viewport.height}`,
    );
  }
  return { ...ihdr, chunkCount, idatBytes };
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function stderrLedger(limitBytes) {
  let retained = Buffer.alloc(0);
  let totalBytes = 0;
  return {
    append(chunk) {
      const bytes = Buffer.from(chunk);
      totalBytes += bytes.length;
      retained = Buffer.concat([retained, bytes]);
      if (retained.length > limitBytes) retained = retained.subarray(retained.length - limitBytes);
    },
    receipt() {
      return {
        limitBytes,
        totalBytes,
        retainedBytes: retained.length,
        truncated: totalBytes > retained.length,
        tail: retained.toString('utf8'),
      };
    },
  };
}

function existingRealPath(value) {
  try {
    return realpathSync(value);
  } catch {
    return null;
  }
}

function replaceAllLiteral(value, search, replacement) {
  return search ? value.split(search).join(replacement) : value;
}

function publicReceiptReport(report, { receiptRoot, profilePath }) {
  const rootVariants = [...new Set([
    receiptRoot,
    existingRealPath(receiptRoot),
  ].filter(Boolean))];
  const temporaryVariants = [...new Set([
    tmpdir(),
    existingRealPath(tmpdir()),
  ].filter(Boolean))];
  const replacements = [];
  for (const root of rootVariants) {
    replacements.push([`${root}${path.sep}`, 'repo://']);
    replacements.push([root, 'repo://.']);
  }
  if (profilePath) replacements.push([profilePath, 'tmp://independent-headless-profile']);
  for (const home of [...new Set([homedir(), existingRealPath(homedir())].filter(Boolean))]) {
    replacements.push([`${home}${path.sep}`, 'home://']);
    replacements.push([home, 'home://.']);
  }
  for (const temporary of temporaryVariants) {
    replacements.push([`${temporary}${path.sep}`, 'tmp://']);
    replacements.push([temporary, 'tmp://.']);
  }
  replacements.sort((left, right) => right[0].length - left[0].length);

  const sanitize = value => {
    if (typeof value === 'string') {
      return replacements.reduce(
        (current, [search, replacement]) => replaceAllLiteral(current, search, replacement),
        value,
      );
    }
    if (Array.isArray(value)) return value.map(sanitize);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitize(child)]));
    }
    return value;
  };
  return sanitize(report);
}

function processGroupPresent(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

function signalProcessGroup(processGroupId, signal) {
  try {
    process.kill(-processGroupId, signal);
    return { signal, result: 'sent' };
  } catch (error) {
    if (error.code === 'ESRCH') return { signal, result: 'already-absent' };
    return { signal, result: 'failed', error: error.message };
  }
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitForGroupAbsence(processGroupId, graceMs) {
  const deadline = Date.now() + graceMs;
  while (processGroupPresent(processGroupId) && Date.now() < deadline) {
    await sleep(Math.min(25, Math.max(1, deadline - Date.now())));
  }
  return !processGroupPresent(processGroupId);
}

async function cleanupProcessGroup(processGroupId, graceMs) {
  const receipt = {
    processGroupId,
    graceMs,
    groupPresentBefore: processGroupPresent(processGroupId),
    actions: [],
    groupPresentAfter: null,
    status: 'pending',
  };
  if (receipt.groupPresentBefore) {
    receipt.actions.push(signalProcessGroup(processGroupId, 'SIGTERM'));
    if (!await waitForGroupAbsence(processGroupId, graceMs)) {
      receipt.actions.push(signalProcessGroup(processGroupId, 'SIGKILL'));
      await waitForGroupAbsence(processGroupId, graceMs);
    }
  }
  receipt.groupPresentAfter = processGroupPresent(processGroupId);
  receipt.status = receipt.groupPresentAfter ? 'failed-process-group-survived' : 'complete-no-process-group-remains';
  return receipt;
}

function waitForBrowser(child, timeoutMs) {
  return new Promise(resolve => {
    let settled = false;
    const settle = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => settle({ timedOut: true, code: null, signal: null }), timeoutMs);
    child.once('error', error => settle({ timedOut: false, code: null, signal: null, spawnError: error.message }));
    child.once('close', (code, signal) => settle({ timedOut: false, code, signal, spawnError: null }));
  });
}

async function writeJsonAtomically(reportPath, report) {
  await mkdir(path.dirname(reportPath), { recursive: true });
  const temporaryPath = `${reportPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`);
  await rename(temporaryPath, reportPath);
}

function browserArguments({ outputPath, profilePath, url, viewport }) {
  return [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--hide-scrollbars',
    `--user-data-dir=${profilePath}`,
    `--window-size=${viewport.width},${viewport.height}`,
    `--screenshot=${outputPath}`,
    url,
  ];
}

export async function captureIndependentBrowserScreenshot({
  cliExecutable = null,
  envExecutable = null,
  url = 'about:blank',
  outputPath,
  reportPath,
  viewport = { width: 1400, height: 900 },
  captureTimeoutMs = 15_000,
  cleanupGraceMs = 1_000,
  stderrLimitBytes = 65_536,
  environment = {},
  cacheRoot,
  platform,
  arch,
  receiptRoot = null,
} = {}) {
  const requestedOutputPath = path.resolve(String(outputPath || ''));
  const requestedReportPath = path.resolve(String(reportPath || ''));
  const requestedReceiptRoot = receiptRoot ? path.resolve(String(receiptRoot)) : null;
  const request = headlessBrowserRequest({ cliExecutable, envExecutable });
  let phase = 'validate-invocation';
  let browser = { request, effective: null, resolutionError: null };
  let child = null;
  let exit = null;
  let cleanup = null;
  let profilePath = null;
  let profileCleanup = { status: 'not-created', path: null };
  let primaryOutput = null;
  let failure = null;
  let interruption = null;
  let interruptionCleanupPromise = null;
  let interruptionHandlersActive = false;
  let removeInterruptionHandlers = () => {};
  let lastTrustworthyEvidence = {
    phase: 'request-received',
    requested: {
      route: RECEIPT_BEARING_CAPTURE_ROUTE,
      url,
      outputPath: requestedOutputPath,
      reportPath: requestedReportPath,
      browser: request,
    },
  };
  let stderr = stderrLedger(Number.isInteger(stderrLimitBytes) && stderrLimitBytes > 0 ? stderrLimitBytes : 1);

  const buildReport = () => {
    const report = {
    schema: RECEIPT_BEARING_CAPTURE_SCHEMA,
    status: failure ? 'failed' : 'complete',
    route: {
      requested: RECEIPT_BEARING_CAPTURE_ROUTE,
      effective: Number.isInteger(child?.pid) && child.pid > 0 ? RECEIPT_BEARING_CAPTURE_ROUTE : null,
      fallbackUsed: false,
    },
    browser,
    invocation: {
      url,
      outputPath: requestedOutputPath,
      reportPath: requestedReportPath,
      viewport,
      captureTimeoutMs,
      cleanupGraceMs,
      pathEncoding: requestedReceiptRoot ? 'public-locators-v0' : 'absolute-runtime-paths',
    },
    process: child ? {
      pid: Number.isInteger(child.pid) && child.pid > 0 ? child.pid : null,
      processGroupId: Number.isInteger(child.pid) && child.pid > 0 ? child.pid : null,
      detachedProcessGroup: true,
      exit,
      cleanup,
      profileCleanup,
    } : null,
    stderr: stderr.receipt(),
    primaryOutput,
    interruption,
    failurePhase: failure ? phase : null,
    error: failure ? failure.message : null,
    lastTrustworthyEvidence,
    };
    return requestedReceiptRoot
      ? publicReceiptReport(report, { receiptRoot: requestedReceiptRoot, profilePath })
      : report;
  };

  function installInterruptionHandlers() {
    const signalHandlers = new Map();
    const handleSignal = signal => {
      if (interruption) return;
      interruption = { signal, observedAt: new Date().toISOString() };
      phase = 'parent-interrupted';
      failure ||= new Error(`capture parent interrupted by ${signal}`);
      process.exitCode = SIGNAL_EXIT_CODES[signal];
      if (Number.isInteger(child?.pid) && child.pid > 0) {
        interruptionCleanupPromise ||= cleanupProcessGroup(child.pid, cleanupGraceMs);
      }
    };
    for (const signal of Object.keys(SIGNAL_EXIT_CODES)) {
      const handler = () => handleSignal(signal);
      signalHandlers.set(signal, handler);
      process.once(signal, handler);
    }
    const exitHandler = code => {
      if (!interruptionHandlersActive || !Number.isInteger(child?.pid) || child.pid <= 0) return;
      interruption ||= { signal: null, processExitCode: code, observedAt: new Date().toISOString() };
      phase = interruption.signal ? 'parent-interrupted' : 'parent-exit';
      failure ||= new Error(`capture parent exited while browser process group ${child.pid} was active`);
      const action = signalProcessGroup(child.pid, 'SIGKILL');
      cleanup = {
        processGroupId: child.pid,
        graceMs: 0,
        groupPresentBefore: true,
        actions: [action],
        groupPresentAfter: processGroupPresent(child.pid),
        status: 'emergency-parent-exit-cleanup',
      };
      try {
        mkdirSync(path.dirname(requestedReportPath), { recursive: true });
        const temporaryPath = `${requestedReportPath}.tmp-exit-${process.pid}`;
        writeFileSync(temporaryPath, `${JSON.stringify(buildReport(), null, 2)}\n`);
        renameSync(temporaryPath, requestedReportPath);
      } catch {
        // The exit handler cannot recover from an unwritable caller-owned report path.
      }
    };
    process.once('exit', exitHandler);
    interruptionHandlersActive = true;
    removeInterruptionHandlers = () => {
      for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
      process.removeListener('exit', exitHandler);
      interruptionHandlersActive = false;
    };
  }

  try {
    if (!outputPath) throw new Error('outputPath is required');
    if (!reportPath) throw new Error('reportPath is required');
    if (receiptRoot !== null && !String(receiptRoot).trim()) throw new Error('receiptRoot must be non-empty');
    if (!url || typeof url !== 'string') throw new Error('url must be a non-empty string');
    positiveInteger(viewport?.width, 'viewport.width');
    positiveInteger(viewport?.height, 'viewport.height');
    positiveInteger(captureTimeoutMs, 'captureTimeoutMs');
    positiveInteger(cleanupGraceMs, 'cleanupGraceMs');
    positiveInteger(stderrLimitBytes, 'stderrLimitBytes');

    phase = 'resolve-browser';
    browser = resolveHeadlessBrowser({
      cliExecutable,
      envExecutable,
      cacheRoot,
      platform,
      arch,
    });
    lastTrustworthyEvidence = { phase: 'browser-resolved', browser };

    phase = 'prepare-capture';
    await mkdir(path.dirname(requestedOutputPath), { recursive: true });
    await rm(requestedOutputPath, { force: true });
    profilePath = await mkdtemp(path.join(tmpdir(), 'kaminos-independent-headless-'));
    profileCleanup = { status: 'pending', path: profilePath };

    phase = 'launch-browser-capture';
    child = spawn(
      browser.effective.executable,
      browserArguments({ outputPath: requestedOutputPath, profilePath, url, viewport }),
      {
        detached: true,
        env: { ...process.env, ...environment },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    child.stderr?.on('data', chunk => stderr.append(chunk));
    installInterruptionHandlers();
    lastTrustworthyEvidence = {
      phase: 'browser-spawn-attempted',
      browser,
      process: {
        pid: Number.isInteger(child.pid) && child.pid > 0 ? child.pid : null,
        processGroupId: Number.isInteger(child.pid) && child.pid > 0 ? child.pid : null,
        detachedProcessGroup: true,
      },
    };

    phase = 'wait-for-browser-capture';
    exit = await waitForBrowser(child, captureTimeoutMs);
    if (interruption) throw failure;
    if (exit.timedOut) throw new Error(`browser capture exceeded ${captureTimeoutMs}ms`);
    if (exit.spawnError) throw new Error(`browser capture spawn failed: ${exit.spawnError}`);
    if (!Number.isInteger(child.pid) || child.pid <= 0) throw new Error('browser spawn returned no process id');
    if (exit.code !== 0) throw new Error(`browser capture exited with code ${exit.code}${exit.signal ? ` (${exit.signal})` : ''}`);

    phase = 'validate-primary-output';
    const bytes = await readFile(requestedOutputPath);
    const png = validatePng(bytes, viewport);
    const outputStats = await stat(requestedOutputPath);
    primaryOutput = {
      path: requestedOutputPath,
      sizeBytes: outputStats.size,
      sha256: sha256(bytes),
      png,
    };
    lastTrustworthyEvidence = { phase: 'primary-output-validated', browser, primaryOutput };
  } catch (error) {
    failure = error;
    if (phase === 'resolve-browser') browser.resolutionError = error.message;
  } finally {
    if (child?.pid) {
      try {
        cleanup = interruptionCleanupPromise
          ? await interruptionCleanupPromise
          : await cleanupProcessGroup(child.pid, cleanupGraceMs);
        if (cleanup.groupPresentAfter && !failure) {
          phase = 'cleanup-process-group';
          failure = new Error(`browser process group ${child.pid} survived cleanup`);
        }
      } catch (error) {
        cleanup = {
          processGroupId: child.pid,
          status: 'cleanup-check-failed',
          error: error.message,
          groupPresentAfter: null,
        };
        if (!failure) {
          phase = 'cleanup-process-group';
          failure = error;
        }
      }
    }
    if (profilePath) {
      try {
        await rm(profilePath, { recursive: true, force: true });
        profileCleanup = { status: 'complete-removed', path: profilePath };
      } catch (error) {
        profileCleanup = { status: 'failed', path: profilePath, error: error.message };
        if (!failure) {
          phase = 'cleanup-profile';
          failure = error;
        }
      }
    }
  }

  let report = buildReport();

  try {
    try {
      await writeJsonAtomically(requestedReportPath, report);
      if (interruption && report.status !== 'failed') {
        phase = 'parent-interrupted';
        failure ||= new Error(`capture parent interrupted by ${interruption.signal}`);
        report = buildReport();
        await writeJsonAtomically(requestedReportPath, report);
      }
    } catch (reportError) {
      if (failure) failure.failureReportError = reportError;
      else throw reportError;
    }
  } finally {
    removeInterruptionHandlers();
  }
  if (failure) {
    failure.captureReport = report;
    throw failure;
  }
  return { outputPath: requestedOutputPath, reportPath: requestedReportPath, report };
}
