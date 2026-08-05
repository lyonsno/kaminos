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
import { inflateSync } from 'node:zlib';

const REPORT_SCHEMA = 'kaminos.source-shaped-k4-profile-comparison-capture.v1';
const CAPTURE_ROUTE = 'chromium-virtual-time-dom-and-scene-pixel-verified-screenshot-v1';
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

function paethPredictor(left, above, upperLeft) {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}

function decodePngPixels(bytes, width, height) {
  const idatChunks = [];
  let offset = PNG_SIGNATURE.length;
  let header = null;
  let sawEnd = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) throw new Error('PNG chunk extends beyond capture bytes');
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    if (type === 'IHDR') header = bytes.subarray(dataStart, dataEnd);
    if (type === 'IDAT') idatChunks.push(bytes.subarray(dataStart, dataEnd));
    if (type === 'IEND') sawEnd = true;
    offset = dataEnd + 4;
  }
  if (!header || header.length !== 13 || idatChunks.length === 0 || !sawEnd) {
    throw new Error('capture PNG is missing required image chunks');
  }
  const bitDepth = header[8];
  const colorType = header[9];
  const compression = header[10];
  const filter = header[11];
  const interlace = header[12];
  if (bitDepth !== 8 || ![2, 6].includes(colorType) || compression !== 0 || filter !== 0 || interlace !== 0) {
    throw new Error(
      `capture PNG encoding is unsupported for pixel evidence: bitDepth=${bitDepth}, ` +
      `colorType=${colorType}, compression=${compression}, filter=${filter}, interlace=${interlace}`,
    );
  }
  const bytesPerPixel = colorType === 2 ? 3 : 4;
  const stride = width * bytesPerPixel;
  const filtered = inflateSync(Buffer.concat(idatChunks));
  const expectedLength = height * (stride + 1);
  if (filtered.length !== expectedLength) {
    throw new Error(`capture PNG pixel payload has ${filtered.length} bytes; expected ${expectedLength}`);
  }
  const pixels = Buffer.alloc(stride * height);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filterType = filtered[sourceOffset];
    sourceOffset += 1;
    if (filterType > 4) throw new Error(`capture PNG uses unknown row filter ${filterType}`);
    const rowOffset = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const encoded = filtered[sourceOffset];
      sourceOffset += 1;
      const left = x >= bytesPerPixel ? pixels[rowOffset + x - bytesPerPixel] : 0;
      const above = y > 0 ? pixels[rowOffset - stride + x] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel
        ? pixels[rowOffset - stride + x - bytesPerPixel]
        : 0;
      let predictor = 0;
      if (filterType === 1) predictor = left;
      if (filterType === 2) predictor = above;
      if (filterType === 3) predictor = Math.floor((left + above) / 2);
      if (filterType === 4) predictor = paethPredictor(left, above, upperLeft);
      pixels[rowOffset + x] = (encoded + predictor) & 0xff;
    }
  }
  return { pixels, bytesPerPixel };
}

export function validatePng(bytes, viewport) {
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
  const { pixels, bytesPerPixel } = decodePngPixels(bytes, width, height);
  const region = {
    x: Math.min(width - 1, Math.ceil(width * 0.34)),
    y: Math.min(height - 1, Math.ceil(height * 0.045)),
    width: Math.max(1, width - Math.ceil(width * 0.34) - Math.ceil(width * 0.015)),
    height: Math.max(1, height - Math.ceil(height * 0.045) - Math.ceil(height * 0.07)),
  };
  const sceneBytes = Buffer.alloc(region.width * region.height * 3);
  const colorFamilyCounts = { warm: 0, cyan: 0, purple: 0 };
  let occupiedPixelCount = 0;
  let chromaticPixelCount = 0;
  let sceneOffset = 0;
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      const pixelOffset = (y * width + x) * bytesPerPixel;
      const red = pixels[pixelOffset];
      const green = pixels[pixelOffset + 1];
      const blue = pixels[pixelOffset + 2];
      sceneBytes[sceneOffset] = red;
      sceneBytes[sceneOffset + 1] = green;
      sceneBytes[sceneOffset + 2] = blue;
      sceneOffset += 3;
      if (Math.abs(red - 8) + Math.abs(green - 11) + Math.abs(blue - 16) > 30) {
        occupiedPixelCount += 1;
      }
      const maximum = Math.max(red, green, blue);
      const minimum = Math.min(red, green, blue);
      if (maximum > 60 && maximum - minimum > 35) chromaticPixelCount += 1;
      if (
        red > 90 && red > blue * 1.15 &&
        (red > green * 1.12 || (green > 70 && blue < Math.min(red, green) * 0.75))
      ) colorFamilyCounts.warm += 1;
      if (green > 80 && green > red * 1.2 && green > blue * 0.82) {
        colorFamilyCounts.cyan += 1;
      }
      if (blue > 90 && blue > green * 1.18 && red > green * 0.75) {
        colorFamilyCounts.purple += 1;
      }
    }
  }
  const scenePixelCount = region.width * region.height;
  const minimumOccupiedPixels = Math.max(5_000, Math.ceil(scenePixelCount * 0.01));
  const minimumChromaticPixels = Math.max(2_500, Math.ceil(scenePixelCount * 0.005));
  const minimumFamilyPixels = Math.max(500, Math.ceil(scenePixelCount * 0.0007));
  const activeColorFamilies = Object.entries(colorFamilyCounts)
    .filter(([, count]) => count >= minimumFamilyPixels)
    .map(([family]) => family);
  if (
    occupiedPixelCount < minimumOccupiedPixels ||
    chromaticPixelCount < minimumChromaticPixels ||
    activeColorFamilies.length < 3
  ) {
    throw new Error(
      'capture scene pixels are blank, UI-only, or materially partial: ' +
      `occupied=${occupiedPixelCount}/${minimumOccupiedPixels}, ` +
      `chromatic=${chromaticPixelCount}/${minimumChromaticPixels}, ` +
      `activeColorFamilies=${activeColorFamilies.join(',') || 'none'}`,
    );
  }
  return {
    width,
    height,
    pixelEvidence: {
      region,
      sceneRegionSha256: sha256(sceneBytes),
      occupiedPixelCount,
      chromaticPixelCount,
      colorFamilyCounts,
      activeColorFamilies,
      thresholds: {
        minimumOccupiedPixels,
        minimumChromaticPixels,
        minimumFamilyPixels,
        minimumActiveColorFamilies: 3,
      },
    },
  };
}

function exactRouteIdentity(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} mismatch: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(actual)}`);
  }
}

function captureUrl(baseUrl, profile, condition, state) {
  const url = new URL(baseUrl);
  url.searchParams.set('profile', profile);
  url.searchParams.set('condition', condition);
  url.searchParams.set('state', state);
  return url;
}

export function validateBrowserCompletion(capture) {
  if (capture.error) {
    if (
      capture.error.code === 'ETIMEDOUT' &&
      capture.status === 0 &&
      capture.signal === null
    ) {
      return {
        kind: 'post-output-timeout-candidate',
        exitStatus: capture.status,
        signal: capture.signal,
        errorCode: capture.error.code,
        error: capture.error.message,
      };
    }
    throw new Error(`browser capture failed: ${capture.error.message}`);
  }
  if (capture.status !== 0) {
    throw new Error(`browser capture exited with status ${capture.status}`);
  }
  return {
    kind: 'clean-exit',
    exitStatus: capture.status,
    signal: capture.signal,
    errorCode: null,
    error: null,
  };
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
      ? { kind: 'dom-and-scene-pixel-verified-profile-comparison-capture-set', count: captures.length }
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
    const normalizedBaseUrl = new URL(baseUrl).href;
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
      if (new URL(prior.invocation?.baseUrl).href !== normalizedBaseUrl) {
        throw new Error(
          `resume report base URL mismatch: expected ${normalizedBaseUrl}, ` +
          `observed ${prior.invocation?.baseUrl ?? 'missing'}`,
        );
      }
      exactRouteIdentity(prior.route, {
        requested: CAPTURE_ROUTE,
        effective: CAPTURE_ROUTE,
        fallbackUsed: false,
      }, 'resume report capture route');
      exactRouteIdentity(prior.viewerRoute, {
        requested: VIEWER_ROUTE,
        effective: VIEWER_ROUTE,
        fallbackUsed: false,
      }, 'resume report viewer route');
      if (JSON.stringify(prior.invocation?.viewport) !== JSON.stringify(viewport)) {
        throw new Error('resume report viewport does not match the current request');
      }
      const resumed = [];
      for (const capture of prior.captures || []) {
        const profileIdentity = requestedProfiles[capture.profile];
        if (!profileIdentity) throw new Error(`resume report has unknown profile ${capture.profile}`);
        if (!CONDITIONS.includes(capture.condition) || !STATES.includes(capture.state)) {
          throw new Error(`resume report has unknown capture slot ${capture.condition}/${capture.state}`);
        }
        const expectedUrl = captureUrl(
          normalizedBaseUrl,
          capture.profile,
          capture.condition,
          capture.state,
        ).href;
        if (capture.url !== expectedUrl) {
          throw new Error(
            `resume capture URL mismatch for ${capture.profile}/${capture.condition}/${capture.state}: ` +
            `expected ${expectedUrl}, observed ${capture.url ?? 'missing'}`,
          );
        }
        const expectedOutput = `${capture.profile}-${capture.condition}-${capture.state}.png`;
        if (capture.output !== expectedOutput) {
          throw new Error(`resume capture output mismatch: expected ${expectedOutput}, observed ${capture.output}`);
        }
        if (resumed.some(existing =>
          existing.profile === capture.profile &&
          existing.condition === capture.condition &&
          existing.state === capture.state)) {
          throw new Error(`resume report duplicates capture slot ${capture.profile}/${capture.condition}/${capture.state}`);
        }
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
        const png = validatePng(pngBytes, viewport);
        if (sha256(pngBytes) !== capture.sha256) {
          throw new Error(`resume capture SHA mismatch for ${capture.output}`);
        }
        resumed.push({ ...capture, png });
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
          const url = captureUrl(normalizedBaseUrl, profile, condition, state);
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
              rmSync(outputPath, { force: true });
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
              const browserCompletion = validateBrowserCompletion(capture);
              const domIdentity = validateWitnessDom(capture.stdout, {
                profile,
                condition,
                state,
                resultSha256: profileIdentity.resultSha256,
              });
              const pngBytes = readFileSync(outputPath);
              const png = validatePng(pngBytes, viewport);
              const attemptStatus = browserCompletion.kind === 'clean-exit'
                ? 'validated'
                : 'validated-post-output-timeout';
              attempts.push({ attempt, status: attemptStatus, browserCompletion });
              validatedCapture = { capture, browserCompletion, domIdentity, pngBytes, png };
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
          const { capture, browserCompletion, domIdentity, pngBytes, png } = validatedCapture;
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
            browserCompletion,
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
