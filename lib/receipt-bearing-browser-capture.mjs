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
import { createServer } from 'node:net';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

import {
  headlessBrowserRequest,
  resolveHeadlessBrowser,
} from './headless-browser-resolver.mjs';

export const RECEIPT_BEARING_CAPTURE_SCHEMA = 'kaminos.receipt-bearing-browser-capture.v0';
export const RECEIPT_BEARING_CAPTURE_ROUTE = 'independent-headless-screenshot-v0';
export const SAME_PAGE_CAPTURE_ROUTE = 'independent-headless-same-page-screenshot-v1';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
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

export function validateReceiptBearingPng(bytes, viewport) {
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

function stdoutPrefixLedger(limitBytes) {
  let retained = Buffer.alloc(0);
  let totalBytes = 0;
  return {
    append(chunk) {
      const bytes = Buffer.from(chunk);
      totalBytes += bytes.length;
      if (retained.length < limitBytes) {
        retained = Buffer.concat([retained, bytes]).subarray(0, limitBytes);
      }
    },
    receipt() {
      return {
        limitBytes,
        totalBytes,
        retainedBytes:retained.length,
        truncated:totalBytes > retained.length,
        prefix:retained.toString('utf8'),
      };
    },
  };
}

function dataAttributeName(key) {
  if (!/^[a-z][A-Za-z0-9]*$/.test(key)) {
    throw new Error(`DOM dataset key is invalid: ${key}`);
  }
  return `data-${key.replaceAll(/[A-Z]/g, match => `-${match.toLowerCase()}`)}`;
}

function effectiveDomDataset(stdoutReceipt, keys) {
  const htmlMatch = stdoutReceipt.prefix.match(/<html\b([^>]*)>/i);
  if (!htmlMatch) throw new Error('browser DOM probe did not return an HTML element');
  const attributes = htmlMatch[1];
  const dataset = {};
  for (const key of keys) {
    const attribute = dataAttributeName(key);
    const match = attributes.match(new RegExp(`(?:^|\\s)${attribute}="([^"]*)"`, 'i'));
    if (!match) throw new Error(`browser DOM probe is missing ${attribute}`);
    dataset[key] = match[1];
  }
  return dataset;
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

function browserArguments({ outputPath, profilePath, url, viewport, virtualTimeBudgetMs }) {
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
    ...(Number.isInteger(virtualTimeBudgetMs) && virtualTimeBudgetMs > 0
      ? [`--virtual-time-budget=${virtualTimeBudgetMs}`]
      : []),
    `--screenshot=${outputPath}`,
    url,
  ];
}

function browserDomArguments({ profilePath, url, viewport, virtualTimeBudgetMs }) {
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
    ...(Number.isInteger(virtualTimeBudgetMs) && virtualTimeBudgetMs > 0
      ? [`--virtual-time-budget=${virtualTimeBudgetMs}`]
      : []),
    '--dump-dom',
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
  virtualTimeBudgetMs = null,
  stderrLimitBytes = 65_536,
  domStdoutLimitBytes = 65_536,
  domDatasetKeys = [],
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
  let domChild = null;
  let exit = null;
  let domExit = null;
  let cleanup = null;
  let domCleanup = null;
  let profilePath = null;
  let profileCleanup = { status: 'not-created', path: null };
  let primaryOutput = null;
  let domReceipt = null;
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
  let domStdout = stdoutPrefixLedger(
    Number.isInteger(domStdoutLimitBytes) && domStdoutLimitBytes > 0 ? domStdoutLimitBytes : 1,
  );

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
      virtualTimeBudgetMs,
      domDatasetKeys,
      pathEncoding: requestedReceiptRoot ? 'public-locators-v0' : 'absolute-runtime-paths',
    },
    process: child ? {
      pid: Number.isInteger(child.pid) && child.pid > 0 ? child.pid : null,
      processGroupId: Number.isInteger(child.pid) && child.pid > 0 ? child.pid : null,
      detachedProcessGroup: true,
      exit,
      cleanup,
      profileCleanup,
      domProbe:domChild ? {
        pid:Number.isInteger(domChild.pid) && domChild.pid > 0 ? domChild.pid : null,
        processGroupId:Number.isInteger(domChild.pid) && domChild.pid > 0 ? domChild.pid : null,
        detachedProcessGroup:true,
        exit:domExit,
        cleanup:domCleanup,
      } : null,
    } : null,
    stderr: stderr.receipt(),
    primaryOutput,
    domReceipt,
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
      const activeChild = domChild || child;
      if (Number.isInteger(activeChild?.pid) && activeChild.pid > 0) {
        interruptionCleanupPromise ||= cleanupProcessGroup(activeChild.pid, cleanupGraceMs);
      }
    };
    for (const signal of Object.keys(SIGNAL_EXIT_CODES)) {
      const handler = () => handleSignal(signal);
      signalHandlers.set(signal, handler);
      process.once(signal, handler);
    }
    const exitHandler = code => {
      const activeChild = domChild || child;
      if (
        !interruptionHandlersActive ||
        !Number.isInteger(activeChild?.pid) ||
        activeChild.pid <= 0
      ) return;
      interruption ||= { signal: null, processExitCode: code, observedAt: new Date().toISOString() };
      phase = interruption.signal ? 'parent-interrupted' : 'parent-exit';
      failure ||= new Error(
        `capture parent exited while browser process group ${activeChild.pid} was active`,
      );
      const action = signalProcessGroup(activeChild.pid, 'SIGKILL');
      cleanup = {
        processGroupId: activeChild.pid,
        graceMs: 0,
        groupPresentBefore: true,
        actions: [action],
        groupPresentAfter: processGroupPresent(activeChild.pid),
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
    positiveInteger(domStdoutLimitBytes, 'domStdoutLimitBytes');
    if (!Array.isArray(domDatasetKeys) || domDatasetKeys.some(key => typeof key !== 'string')) {
      throw new Error('domDatasetKeys must be an array of strings');
    }
    for (const key of domDatasetKeys) dataAttributeName(key);

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
      browserArguments({
        outputPath: requestedOutputPath, profilePath, url, viewport,
        virtualTimeBudgetMs,
      }),
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
    const png = validateReceiptBearingPng(bytes, viewport);
    const outputStats = await stat(requestedOutputPath);
    primaryOutput = {
      path: requestedOutputPath,
      sizeBytes: outputStats.size,
      sha256: sha256(bytes),
      png,
    };
    lastTrustworthyEvidence = { phase: 'primary-output-validated', browser, primaryOutput };
    if (domDatasetKeys.length > 0) {
      phase = 'launch-browser-dom-probe';
      domChild = spawn(
        browser.effective.executable,
        browserDomArguments({ profilePath, url, viewport, virtualTimeBudgetMs }),
        {
          detached:true,
          env:{ ...process.env, ...environment },
          stdio:['ignore', 'pipe', 'pipe'],
        },
      );
      domChild.stdout?.on('data', chunk => domStdout.append(chunk));
      domChild.stderr?.on('data', chunk => stderr.append(chunk));
      phase = 'wait-for-browser-dom-probe';
      domExit = await waitForBrowser(domChild, captureTimeoutMs);
      if (interruption) throw failure;
      if (domExit.timedOut) throw new Error(`browser DOM probe exceeded ${captureTimeoutMs}ms`);
      if (domExit.spawnError) throw new Error(`browser DOM probe spawn failed: ${domExit.spawnError}`);
      if (!Number.isInteger(domChild.pid) || domChild.pid <= 0) {
        throw new Error('browser DOM probe spawn returned no process id');
      }
      if (domExit.code !== 0) {
        throw new Error(
          `browser DOM probe exited with code ${domExit.code}` +
          `${domExit.signal ? ` (${domExit.signal})` : ''}`,
        );
      }
      phase = 'validate-browser-dom-probe';
      const stdoutReceipt = domStdout.receipt();
      domReceipt = {
        status:'complete',
        url,
        dataset:effectiveDomDataset(stdoutReceipt, domDatasetKeys),
        stdout: {
          limitBytes:stdoutReceipt.limitBytes,
          totalBytes:stdoutReceipt.totalBytes,
          retainedBytes:stdoutReceipt.retainedBytes,
          truncated:stdoutReceipt.truncated,
          retention:'prefix-only-no-dom-body-in-report',
        },
      };
      lastTrustworthyEvidence = {
        phase:'effective-dom-validated',
        browser,
        primaryOutput,
        domReceipt,
      };
    }
  } catch (error) {
    failure = error;
    if (phase === 'resolve-browser') browser.resolutionError = error.message;
  } finally {
    if (domChild?.pid) {
      try {
        domCleanup = interruptionCleanupPromise
          ? await interruptionCleanupPromise
          : await cleanupProcessGroup(domChild.pid, cleanupGraceMs);
        if (domCleanup.groupPresentAfter && !failure) {
          phase = 'cleanup-dom-probe-process-group';
          failure = new Error(`browser DOM probe process group ${domChild.pid} survived cleanup`);
        }
      } catch (error) {
        domCleanup = {
          processGroupId:domChild.pid,
          status:'cleanup-check-failed',
          error:error.message,
          groupPresentAfter:null,
        };
        if (!failure) {
          phase = 'cleanup-dom-probe-process-group';
          failure = error;
        }
      }
    }
    if (child?.pid) {
      try {
        cleanup = await cleanupProcessGroup(child.pid, cleanupGraceMs);
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

function pngVisualSignal(bytes) {
  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = null;
  let colorType = null;
  let interlace = null;
  const idat = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    const start = offset + 8;
    const end = start + length;
    if (type === 'IHDR') {
      width = bytes.readUInt32BE(start);
      height = bytes.readUInt32BE(start + 4);
      bitDepth = bytes[start + 8];
      colorType = bytes[start + 9];
      interlace = bytes[start + 12];
    } else if (type === 'IDAT') idat.push(bytes.subarray(start, end));
    else if (type === 'IEND') break;
    offset = end + 4;
  }
  const bytesPerPixel = colorType === 6 ? 4 : colorType === 2 ? 3 : null;
  if (bitDepth !== 8 || interlace !== 0 || !bytesPerPixel) {
    throw new Error(
      `visual-signal analysis requires non-interlaced 8-bit RGB/RGBA PNG, got `
      + `bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`,
    );
  }
  const inflated = inflateSync(Buffer.concat(idat));
  const stride = width * bytesPerPixel;
  const expectedLength = height * (stride + 1);
  if (inflated.length !== expectedLength) {
    throw new Error(`PNG inflated length ${inflated.length} does not match ${expectedLength}`);
  }
  let sourceOffset = 0;
  let previous = Buffer.alloc(stride);
  let baseline = null;
  let nonUniformPixels = 0;
  let minimumChannel = 255;
  let maximumChannel = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset++];
    if (filter > 4) throw new Error(`PNG uses unsupported row filter ${filter}`);
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[sourceOffset++];
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const up = previous[x];
      const upLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const candidate = left + up - upLeft;
        const leftDistance = Math.abs(candidate - left);
        const upDistance = Math.abs(candidate - up);
        const diagonalDistance = Math.abs(candidate - upLeft);
        predictor = leftDistance <= upDistance && leftDistance <= diagonalDistance
          ? left : upDistance <= diagonalDistance ? up : upLeft;
      }
      row[x] = (raw + predictor) & 255;
    }
    for (let x = 0; x < width; x += 1) {
      const index = x * bytesPerPixel;
      const rgb = [row[index], row[index + 1], row[index + 2]];
      baseline ||= rgb;
      if (rgb.some((value, channel) => Math.abs(value - baseline[channel]) >= 4)) {
        nonUniformPixels += 1;
      }
      minimumChannel = Math.min(minimumChannel, ...rgb);
      maximumChannel = Math.max(maximumChannel, ...rgb);
    }
    previous = row;
  }
  return {
    width,
    height,
    pixelCount:width * height,
    nonUniformPixels,
    minimumChannel,
    maximumChannel,
    channelRange:maximumChannel - minimumChannel,
    admission:nonUniformPixels >= Math.max(64, Math.floor(width * height * 0.0005)) &&
      maximumChannel - minimumChannel >= 8
      ? 'nonblank-v0'
      : 'blank-or-near-uniform-v0',
  };
}

export function analyzeReceiptBearingPngVisualSignal(bytes, viewport) {
  validateReceiptBearingPng(bytes, viewport);
  const signal = pngVisualSignal(bytes);
  if (signal.admission !== 'nonblank-v0') {
    throw new Error(
      `browser capture is blank or near-uniform: range=${signal.channelRange} `
      + `nonUniformPixels=${signal.nonUniformPixels}`,
    );
  }
  return signal;
}

function openLocalPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

class SamePageCdpSocket {
  constructor(url, timeoutMs) {
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.socket = null;
  }

  open() {
    return new Promise((resolve, reject) => {
      this.socket = new WebSocket(this.url);
      this.socket.addEventListener('open', resolve, { once:true });
      this.socket.addEventListener('error', reject, { once:true });
      this.socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (!message.id || !this.pending.has(message.id)) return;
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(`${message.error.message}: ${message.error.data || ''}`));
        else pending.resolve(message.result || {});
      });
    });
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: CDP request timed out`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket?.close();
  }
}

async function cdpJson(port, pathname) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
  if (!response.ok) throw new Error(`CDP ${pathname} returned HTTP ${response.status}`);
  return response.json();
}

async function waitForCdpPage(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await cdpJson(port, '/json/list');
      const page = targets.find(target => target.type === 'page' &&
        !String(target.url || '').startsWith('chrome-extension://'));
      if (page?.webSocketDebuggerUrl) return page;
    } catch {}
    await sleep(50);
  }
  throw new Error(`CDP page target did not appear within ${timeoutMs}ms`);
}

async function cdpEvaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', {
    expression,
    awaitPromise:true,
    returnByValue:true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text || 'browser evaluation failed');
  }
  return result.result?.value;
}

async function waitForSamePageDataset(cdp, keys, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  const expression = `(() => {
    const keys=${JSON.stringify(keys)};
    const dataset=Object.fromEntries(keys.map(key=>[key,document.documentElement.dataset[key]??null]));
    return {dataset,documentReadyState:document.readyState};
  })()`;
  while (Date.now() < deadline) {
    try {
      last = await cdpEvaluate(cdp, expression);
      if (keys.every(key => typeof last?.dataset?.[key] === 'string' &&
        last.dataset[key].length > 0) && last.dataset.witnessRenderComplete === 'true') {
        return last;
      }
    } catch (error) {
      last = { error:error.message };
    }
    await sleep(50);
  }
  throw new Error(`same-page render receipt did not settle: ${JSON.stringify(last)}`);
}

export async function captureSamePageBrowserScreenshot({
  cliExecutable = null,
  envExecutable = null,
  url = 'about:blank',
  outputPath,
  reportPath,
  viewport = { width:1400, height:900 },
  captureTimeoutMs = 30_000,
  cleanupGraceMs = 1_000,
  stderrLimitBytes = 65_536,
  domDatasetKeys = [],
  captureBatchIdentity = null,
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
  let browser = { request, effective:null, resolutionError:null };
  let child = null;
  let cdp = null;
  let pageTarget = null;
  let profilePath = null;
  let cleanup = null;
  let profileCleanup = { status:'not-created', path:null };
  let exit = null;
  let primaryOutput = null;
  let frameReceipt = null;
  let failure = null;
  let interruption = null;
  const stderr = stderrLedger(Number.isInteger(stderrLimitBytes) && stderrLimitBytes > 0
    ? stderrLimitBytes : 1);
  let removeInterruptionHandlers = () => {};
  let lastTrustworthyEvidence = { phase:'request-received' };

  const buildReport = () => {
    const report = {
      schema:RECEIPT_BEARING_CAPTURE_SCHEMA,
      status:failure ? 'failed' : 'complete',
      route:{
        requested:SAME_PAGE_CAPTURE_ROUTE,
        effective:Number.isInteger(child?.pid) && child.pid > 0 ? SAME_PAGE_CAPTURE_ROUTE : null,
        fallbackUsed:false,
      },
      browser,
      invocation:{
        url,
        outputPath:requestedOutputPath,
        reportPath:requestedReportPath,
        viewport,
        captureTimeoutMs,
        cleanupGraceMs,
        domDatasetKeys,
        captureBatchIdentity,
        pathEncoding:requestedReceiptRoot ? 'public-locators-v0' : 'absolute-runtime-paths',
      },
      process:child ? {
        pid:Number.isInteger(child.pid) && child.pid > 0 ? child.pid : null,
        processGroupId:Number.isInteger(child.pid) && child.pid > 0 ? child.pid : null,
        detachedProcessGroup:true,
        exit,
        cleanup,
        profileCleanup,
      } : null,
      stderr:stderr.receipt(),
      primaryOutput,
      frameReceipt,
      domReceipt:null,
      interruption,
      failurePhase:failure ? phase : null,
      error:failure ? failure.message : null,
      lastTrustworthyEvidence,
    };
    return requestedReceiptRoot
      ? publicReceiptReport(report, { receiptRoot:requestedReceiptRoot, profilePath })
      : report;
  };

  const signalHandlers = new Map();
  const installInterruptionHandlers = () => {
    for (const signal of Object.keys(SIGNAL_EXIT_CODES)) {
      const handler = () => {
        if (interruption) return;
        interruption = { signal, observedAt:new Date().toISOString() };
        phase = 'parent-interrupted';
        failure ||= new Error(`capture parent interrupted by ${signal}`);
        process.exitCode = SIGNAL_EXIT_CODES[signal];
        if (Number.isInteger(child?.pid) && child.pid > 0) signalProcessGroup(child.pid, 'SIGKILL');
      };
      signalHandlers.set(signal, handler);
      process.once(signal, handler);
    }
    removeInterruptionHandlers = () => {
      for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
    };
  };

  try {
    if (!outputPath) throw new Error('outputPath is required');
    if (!reportPath) throw new Error('reportPath is required');
    if (!url || typeof url !== 'string') throw new Error('url must be a non-empty string');
    positiveInteger(viewport?.width, 'viewport.width');
    positiveInteger(viewport?.height, 'viewport.height');
    positiveInteger(captureTimeoutMs, 'captureTimeoutMs');
    positiveInteger(cleanupGraceMs, 'cleanupGraceMs');
    if (!Array.isArray(domDatasetKeys) || domDatasetKeys.some(key => typeof key !== 'string')) {
      throw new Error('domDatasetKeys must be an array of strings');
    }
    if (!domDatasetKeys.includes('witnessRenderComplete') ||
        !domDatasetKeys.includes('witnessRenderFrame')) {
      throw new Error('same-page capture requires witnessRenderComplete and witnessRenderFrame');
    }
    if (!captureBatchIdentity?.sha256 || !SHA256_PATTERN.test(captureBatchIdentity.sha256)) {
      throw new Error('same-page capture requires a SHA-256 batch identity');
    }
    for (const key of domDatasetKeys) dataAttributeName(key);

    phase = 'resolve-browser';
    browser = resolveHeadlessBrowser({ cliExecutable, envExecutable, cacheRoot, platform, arch });
    lastTrustworthyEvidence = { phase:'browser-resolved', browser };

    phase = 'prepare-capture';
    await mkdir(path.dirname(requestedOutputPath), { recursive:true });
    await rm(requestedOutputPath, { force:true });
    profilePath = await mkdtemp(path.join(tmpdir(), 'kaminos-same-page-headless-'));
    profileCleanup = { status:'pending', path:profilePath };
    const port = await openLocalPort();
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error('failed to reserve a local CDP port');
    }

    phase = 'launch-browser-capture';
    child = spawn(browser.effective.executable, [
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
      `--remote-debugging-port=${port}`,
      'about:blank',
    ], {
      detached:true,
      env:{ ...process.env, ...environment },
      stdio:['ignore', 'ignore', 'pipe'],
    });
    child.stderr?.on('data', chunk => stderr.append(chunk));
    installInterruptionHandlers();

    phase = 'connect-same-page';
    pageTarget = await waitForCdpPage(port, captureTimeoutMs);
    cdp = new SamePageCdpSocket(pageTarget.webSocketDebuggerUrl, captureTimeoutMs);
    await cdp.open();
    await cdp.call('Page.enable');
    await cdp.call('Runtime.enable');
    await cdp.call('Emulation.setDeviceMetricsOverride', {
      width:viewport.width,
      height:viewport.height,
      deviceScaleFactor:1,
      mobile:false,
    });
    await cdp.call('Page.navigate', { url });

    phase = 'wait-for-same-page-render';
    await waitForSamePageDataset(cdp, domDatasetKeys, captureTimeoutMs);
    const frameState = await cdpEvaluate(cdp, `(async()=>{
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const keys=${JSON.stringify(domDatasetKeys)};
      return Object.fromEntries(keys.map(key=>[key,document.documentElement.dataset[key]??null]));
    })()`);
    if (frameState.witnessCaptureBatch !== captureBatchIdentity.sha256) {
      throw new Error('same-page frame carries the wrong capture batch identity');
    }

    phase = 'capture-same-page-pixels';
    const screenshot = await cdp.call('Page.captureScreenshot', {
      format:'png',
      fromSurface:true,
      captureBeyondViewport:false,
    });
    const bytes = Buffer.from(screenshot.data || '', 'base64');
    await writeFile(requestedOutputPath, bytes);
    const png = validateReceiptBearingPng(bytes, viewport);
    const visualSignal = analyzeReceiptBearingPngVisualSignal(bytes, viewport);
    const outputStats = await stat(requestedOutputPath);
    primaryOutput = {
      path:requestedOutputPath,
      sizeBytes:outputStats.size,
      sha256:sha256(bytes),
      png,
      visualSignal,
    };
    frameReceipt = {
      status:'complete',
      route:'same-cdp-page-frame-v0',
      targetId:pageTarget.id,
      targetType:pageTarget.type,
      requestedUrl:url,
      dataset:frameState,
      renderComplete:frameState.witnessRenderComplete,
      renderFrame:frameState.witnessRenderFrame,
      captureBatchIdentitySha256:captureBatchIdentity.sha256,
      ordering:'dataset-after-two-animation-frames-then-page-capture-screenshot',
    };
    lastTrustworthyEvidence = { phase:'same-page-frame-captured', browser, primaryOutput, frameReceipt };
  } catch (error) {
    failure = error;
    if (phase === 'resolve-browser') browser.resolutionError = error.message;
  } finally {
    try { cdp?.close(); } catch {}
    if (child?.pid) {
      try {
        cleanup = await cleanupProcessGroup(child.pid, cleanupGraceMs);
        if (cleanup.groupPresentAfter && !failure) {
          phase = 'cleanup-process-group';
          failure = new Error(`browser process group ${child.pid} survived cleanup`);
        }
      } catch (error) {
        cleanup = { processGroupId:child.pid, status:'cleanup-check-failed', error:error.message };
        if (!failure) { phase = 'cleanup-process-group'; failure = error; }
      }
    }
    if (profilePath) {
      try {
        await rm(profilePath, { recursive:true, force:true });
        profileCleanup = { status:'complete-removed', path:profilePath };
      } catch (error) {
        profileCleanup = { status:'failed', path:profilePath, error:error.message };
        if (!failure) { phase = 'cleanup-profile'; failure = error; }
      }
    }
  }

  exit = child ? { code:child.exitCode, signal:child.signalCode } : null;
  let report = buildReport();
  try {
    await writeJsonAtomically(requestedReportPath, report);
  } finally {
    removeInterruptionHandlers();
  }
  if (failure) {
    failure.captureReport = report;
    throw failure;
  }
  return { outputPath:requestedOutputPath, reportPath:requestedReportPath, report };
}
