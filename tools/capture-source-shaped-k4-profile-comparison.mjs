#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPORT_SCHEMA = 'kaminos.source-shaped-k4-profile-comparison-capture.v0';
const CAPTURE_ROUTE = 'chromium-virtual-time-dom-verified-screenshot-v0';
const VIEWER_ROUTE = 'source-shaped-k4-packing-visual-v0';
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CONDITIONS = ['baseline', 'mild', 'moderate'];
const STATES = ['before', 'packed'];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function attribute(dom, name) {
  const match = dom.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match?.[1] ?? null;
}

export function validateWitnessDom(dom, {
  profile,
  condition,
  state,
  resultSha256,
}) {
  const expected = {
    'data-requested-route': VIEWER_ROUTE,
    'data-effective-route': VIEWER_ROUTE,
    'data-fallback-used': 'false',
    'data-profile': profile,
    'data-condition': condition,
    'data-state': state,
    'data-witness-loaded': 'true',
    'data-result-sha256': resultSha256,
  };
  for (const [name, value] of Object.entries(expected)) {
    const observed = attribute(dom, name);
    if (observed !== value) {
      throw new Error(`${name} mismatch: expected ${value}, observed ${observed ?? 'missing'}`);
    }
  }
  if (attribute(dom, 'data-witness-failed') !== null) {
    throw new Error('witness DOM declares a failed render');
  }
  return expected;
}

function validatePng(bytes, viewport) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('capture did not produce a structurally identifiable PNG');
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width !== viewport.width || height !== viewport.height) {
    throw new Error(
      `capture dimensions ${width}x${height} do not match ${viewport.width}x${viewport.height}`,
    );
  }
  return { width, height };
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return number;
}

function writeJsonAtomically(target, value) {
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, target);
}

function stderrReceipt(stderr, limitBytes = 65_536) {
  const bytes = Buffer.from(stderr || '');
  return {
    totalBytes: bytes.length,
    retainedBytes: Math.min(bytes.length, limitBytes),
    truncated: bytes.length > limitBytes,
    tail: bytes.subarray(Math.max(0, bytes.length - limitBytes)).toString('utf8'),
  };
}

export function captureSourceShapedK4ProfileComparison({
  browserExecutable,
  baseUrl,
  outputDirectory,
  reportPath = path.join(outputDirectory, 'capture-report.json'),
  tubeSha256,
  bellySha256,
  viewport = { width: 1400, height: 900 },
  virtualTimeBudgetMs = 5_000,
  captureTimeoutMs = 30_000,
  maxCaptureAttempts = 3,
  resumeReportPath = null,
}) {
  const requestedOutputDirectory = path.resolve(outputDirectory);
  const requestedReportPath = path.resolve(reportPath);
  const requestedProfiles = {
    tube: { resultSha256: tubeSha256 },
    belly: { resultSha256: bellySha256 },
  };
  let phase = 'validate-invocation';
  let lastTrustworthyEvidence = { phase: 'invocation-received' };
  let captures = [];
  let currentCapture = null;
  let report;

  const buildReport = ({ status, error = null }) => ({
    schema: REPORT_SCHEMA,
    status,
    route: {
      requested: CAPTURE_ROUTE,
      effective: status === 'failed' && captures.length === 0 ? null : CAPTURE_ROUTE,
      fallbackUsed: false,
    },
    viewerRoute: {
      requested: VIEWER_ROUTE,
      effective: captures.length > 0 ? VIEWER_ROUTE : null,
      fallbackUsed: false,
    },
    invocation: {
      baseUrl,
      outputDirectory: requestedOutputDirectory,
      reportPath: requestedReportPath,
      viewport,
      virtualTimeBudgetMs,
      captureTimeoutMs,
      maxCaptureAttempts,
      resumeReportPath: resumeReportPath ? path.resolve(resumeReportPath) : null,
    },
    requestedProfiles,
    captures,
    primaryOutput: status === 'complete'
      ? { kind: 'dom-verified-profile-comparison-capture-set', count: captures.length }
      : null,
    failurePhase: status === 'failed' ? phase : null,
    error,
    currentCapture,
    lastTrustworthyEvidence,
  });

  try {
    if (!browserExecutable) throw new Error('browser executable is required');
    if (!baseUrl) throw new Error('viewer URL is required');
    if (!outputDirectory) throw new Error('output directory is required');
    if (!HASH_PATTERN.test(tubeSha256 || '')) throw new Error('tube result SHA must be a SHA-256 identity');
    if (!HASH_PATTERN.test(bellySha256 || '')) throw new Error('belly result SHA must be a SHA-256 identity');
    viewport.width = positiveInteger(viewport.width, 'viewport width');
    viewport.height = positiveInteger(viewport.height, 'viewport height');
    virtualTimeBudgetMs = positiveInteger(virtualTimeBudgetMs, 'virtual time budget');
    captureTimeoutMs = positiveInteger(captureTimeoutMs, 'capture timeout');
    maxCaptureAttempts = positiveInteger(maxCaptureAttempts, 'maximum capture attempts');
    new URL(baseUrl);
    mkdirSync(requestedOutputDirectory, { recursive: true });

    phase = 'bind-browser-identity';
    const browserBytes = readFileSync(browserExecutable);
    const browserStats = statSync(browserExecutable);
    const browser = {
      executable: path.resolve(browserExecutable),
      sha256: sha256(browserBytes),
      sizeBytes: browserStats.size,
    };
    lastTrustworthyEvidence = { phase: 'browser-identity-bound', browser };
    if (resumeReportPath) {
      phase = 'validate-resume-report';
      const prior = JSON.parse(readFileSync(path.resolve(resumeReportPath), 'utf8'));
      if (prior.schema !== REPORT_SCHEMA) throw new Error(`resume report schema mismatch: ${prior.schema}`);
      if (JSON.stringify(prior.requestedProfiles) !== JSON.stringify(requestedProfiles)) {
        throw new Error('resume report result identities do not match the current request');
      }
      const resumed = [];
      for (const capture of prior.captures || []) {
        const profileIdentity = requestedProfiles[capture.profile];
        if (!profileIdentity) throw new Error(`resume report has unknown profile ${capture.profile}`);
        validateWitnessDom(
          `<html ${Object.entries(capture.domIdentity || {}).map(
            ([name, value]) => `${name}="${value}"`,
          ).join(' ')}></html>`,
          {
            profile: capture.profile,
            condition: capture.condition,
            state: capture.state,
            resultSha256: profileIdentity.resultSha256,
          },
        );
        const outputPath = path.join(requestedOutputDirectory, capture.output);
        const pngBytes = readFileSync(outputPath);
        validatePng(pngBytes, viewport);
        if (sha256(pngBytes) !== capture.sha256) {
          throw new Error(`resume capture SHA mismatch for ${capture.output}`);
        }
        resumed.push(capture);
      }
      captures = resumed;
      lastTrustworthyEvidence = {
        phase: 'resume-captures-revalidated',
        captureCount: captures.length,
        resumeReportPath: path.resolve(resumeReportPath),
      };
    }
    writeJsonAtomically(requestedReportPath, buildReport({ status: 'in-progress' }));

    for (const [profile, profileIdentity] of Object.entries(requestedProfiles)) {
      for (const condition of CONDITIONS) {
        for (const state of STATES) {
          if (captures.some(capture =>
            capture.profile === profile &&
            capture.condition === condition &&
            capture.state === state)) continue;
          phase = `capture-${profile}-${condition}-${state}`;
          const url = new URL(baseUrl);
          url.searchParams.set('profile', profile);
          url.searchParams.set('condition', condition);
          url.searchParams.set('state', state);
          const outputName = `${profile}-${condition}-${state}.png`;
          const outputPath = path.join(requestedOutputDirectory, outputName);
          const attempts = [];
          let validatedCapture = null;
          for (let attempt = 1; attempt <= maxCaptureAttempts; attempt += 1) {
            currentCapture = {
              profile,
              condition,
              state,
              url: url.href,
              outputPath,
              attempt,
              attempts,
            };
            const browserProfile = mkdtempSync(path.join(tmpdir(), 'kaminos-k4-profile-capture-'));
            let capture;
            try {
              capture = spawnSync(browser.executable, [
                '--headless=new',
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-extensions',
                '--disable-background-networking',
                '--hide-scrollbars',
                '--enable-unsafe-swiftshader',
                `--user-data-dir=${browserProfile}`,
                `--virtual-time-budget=${virtualTimeBudgetMs}`,
                `--window-size=${viewport.width},${viewport.height}`,
                `--screenshot=${outputPath}`,
                '--dump-dom',
                url.href,
              ], {
                encoding: 'utf8',
                maxBuffer: 32 * 1024 * 1024,
                timeout: captureTimeoutMs,
              });
              if (capture.error) throw new Error(`browser capture failed: ${capture.error.message}`);
              if (capture.status !== 0) {
                throw new Error(`browser capture exited with status ${capture.status}`);
              }
              const domIdentity = validateWitnessDom(capture.stdout, {
                profile,
                condition,
                state,
                resultSha256: profileIdentity.resultSha256,
              });
              const pngBytes = readFileSync(outputPath);
              const png = validatePng(pngBytes, viewport);
              attempts.push({ attempt, status: 'validated' });
              validatedCapture = { capture, domIdentity, pngBytes, png };
              break;
            } catch (attemptError) {
              attempts.push({
                attempt,
                status: 'failed',
                error: attemptError instanceof Error ? attemptError.message : String(attemptError),
                stderr: stderrReceipt(capture?.stderr),
              });
              currentCapture = { ...currentCapture, attempts };
              writeJsonAtomically(requestedReportPath, buildReport({ status: 'in-progress' }));
              if (attempt === maxCaptureAttempts) {
                throw new Error(
                  `${profile}/${condition}/${state} exhausted ${maxCaptureAttempts} capture attempts: ` +
                  `${attempts.at(-1).error}`,
                );
              }
            } finally {
              rmSync(browserProfile, { recursive: true, force: true });
            }
          }
          const { capture, domIdentity, pngBytes, png } = validatedCapture;
          captures = [...captures, {
            profile,
            condition,
            state,
            url: url.href,
            output: outputName,
            sha256: sha256(pngBytes),
            sizeBytes: pngBytes.length,
            png,
            domIdentity,
            attempts,
            stderr: stderrReceipt(capture.stderr),
          }];
          lastTrustworthyEvidence = {
            phase: 'capture-dom-and-png-validated',
            profile,
            condition,
            state,
            output: outputName,
            sha256: captures.at(-1).sha256,
          };
          currentCapture = null;
          writeJsonAtomically(requestedReportPath, buildReport({ status: 'in-progress' }));
        }
      }
    }
    if (captures.length !== 12) throw new Error(`expected 12 captures, produced ${captures.length}`);
    phase = 'complete';
    report = buildReport({ status: 'complete' });
    writeJsonAtomically(requestedReportPath, report);
    return report;
  } catch (error) {
    report = buildReport({
      status: 'failed',
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    writeJsonAtomically(requestedReportPath, report);
    const failure = error instanceof Error ? error : new Error(String(error));
    failure.captureReport = report;
    throw failure;
  }
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) throw new Error(`unexpected positional argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    values.set(argument.slice(2), value);
    index += 1;
  }
  for (const required of ['browser', 'url', 'output-dir', 'tube-sha', 'belly-sha']) {
    if (!values.get(required)) throw new Error(`--${required} is required`);
  }
  return {
    browserExecutable: values.get('browser'),
    baseUrl: values.get('url'),
    outputDirectory: values.get('output-dir'),
    reportPath: values.get('report') || undefined,
    tubeSha256: values.get('tube-sha'),
    bellySha256: values.get('belly-sha'),
    viewport: {
      width: Number(values.get('width') || 1400),
      height: Number(values.get('height') || 900),
    },
    virtualTimeBudgetMs: Number(values.get('virtual-time-budget-ms') || 5000),
    captureTimeoutMs: Number(values.get('capture-timeout-ms') || 30000),
    maxCaptureAttempts: Number(values.get('max-attempts') || 3),
    resumeReportPath: values.get('resume-report') || null,
  };
}

async function main() {
  const report = captureSourceShapedK4ProfileComparison(
    parseArguments(process.argv.slice(2)),
  );
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    route: report.route,
    viewerRoute: report.viewerRoute,
    captureCount: report.captures.length,
    reportPath: report.invocation.reportPath,
  })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
