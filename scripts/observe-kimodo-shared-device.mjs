#!/usr/bin/env node
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { emptyObservationReport, mergeObservation } from '../kimodo-shared-device-observation.mjs';

const { values } = parseArgs({
  options: {
    'browser-url': { type: 'string', default: 'http://127.0.0.1:9222' },
    url: { type: 'string', default: 'http://127.0.0.1:8096/kimodo-shared-device.html' },
    'output-dir': { type: 'string' },
    'poll-ms': { type: 'string', default: '1000' },
    'read-timeout-ms': { type: 'string', default: '60000' },
  },
  strict: true,
});

if (!values['output-dir']) throw new Error('Usage: observe-kimodo-shared-device.mjs --output-dir DIR [--browser-url URL] [--url URL]');
const pollMs = Number(values['poll-ms']);
if (!Number.isSafeInteger(pollMs) || pollMs < 1) throw new Error('--poll-ms must be a positive integer');
const readTimeoutMs = Number(values['read-timeout-ms']);
if (!Number.isSafeInteger(readTimeoutMs) || readTimeoutMs < 1000) throw new Error('--read-timeout-ms must be an integer of at least 1000 ms');

const outputDir = resolve(values['output-dir']);
mkdirSync(outputDir, { recursive: false });
const reportPath = join(outputDir, 'operator-telemetry.json');
const reportTempPath = `${reportPath}.tmp`;
const chunksPath = join(outputDir, 'operator-telemetry.ndjson');
const report = emptyObservationReport({ requestedUrl: values.url });
report.effective = { browserUrl: values['browser-url'], pageUrl: null, pollMs, readTimeoutMs, telemetryChunks: chunksPath };

function writeReport() {
  const { telemetry, ...summary } = report;
  summary.telemetryCounts = {
    samples: telemetry.samples.length,
    frameIntervals: telemetry.frameIntervalsMs.length,
    foregroundReceipts: telemetry.foregroundReceipts.length,
    runs: telemetry.runs.length,
    completedRuns: telemetry.completedRuns.length,
  };
  summary.runs = telemetry.runs;
  summary.partialFrameIntervalMs = ['stopped', 'failed'].includes(report.status)
    ? intervalSummary(telemetry.frameIntervalsMs, true)
    : intervalSummary(telemetry.frameIntervalsMs, false);
  writeFileSync(reportTempPath, `${JSON.stringify(summary, null, 2)}\n`);
  renameSync(reportTempPath, reportPath);
}

function intervalSummary(intervals, includeQuantiles) {
  if (!intervals.length) return null;
  let maxMs = -Infinity;
  for (const interval of intervals) maxMs = Math.max(maxMs, interval);
  const result = { count: intervals.length, maxMs };
  if (!includeQuantiles) return result;
  const sorted = [...intervals].sort((a, b) => a - b);
  const percentile = fraction => sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
  return { ...result, p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99) };
}

writeReport();
let browser = null;
let stopping = false;
let stopRequested = false;
let page = null;
const requestStop = signal => {
  if (stopRequested) return;
  stopRequested = true;
  report.stopSignal = signal;
  report.status = 'stopping';
};
process.on('SIGINT', () => requestStop('SIGINT'));
process.on('SIGTERM', () => requestStop('SIGTERM'));

async function boundedRead(promise, label) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`${label} exceeded ${readTimeoutMs} ms`)), readTimeoutMs); }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

try {
  writeFileSync(chunksPath, '', { flag: 'wx' });
  const kimodoCheckout = process.env.KIMODO_WEBGPU_CHECKOUT;
  if (!kimodoCheckout) throw new Error('KIMODO_WEBGPU_CHECKOUT must name the exact Kimodo checkout containing puppeteer-core');
  const requireFromKimodo = createRequire(join(resolve(kimodoCheckout), 'package.json'));
  const puppeteer = requireFromKimodo('puppeteer-core');
  report.failurePhase = 'browser-connect';
  browser = await boundedRead(puppeteer.connect({ browserURL: values['browser-url'] }), 'browser connection');
  report.effective.browserVersion = await boundedRead(browser.version(), 'browser version read');
  report.failurePhase = 'page-discovery';
  const expected = new URL(values.url);
  const pages = await boundedRead(browser.pages(), 'browser page discovery');
  page = pages.find(candidate => {
    try {
      const actual = new URL(candidate.url());
      return actual.origin === expected.origin && actual.pathname === expected.pathname;
    } catch { return false; }
  });
  if (!page) throw new Error(`No open browser tab matches ${values.url}`);
  report.effective.pageUrl = page.url();
  report.failurePhase = null;
  report.status = 'capturing';
  writeReport();

  let sampleOffset = 0;
  let frameIntervalOffset = 0;
  let foregroundReceiptOffset = 0;
  let pageRuntimeId = null;
  const completedRunIds = new Set();
  while (!stopping) {
    if (page.isClosed()) throw new Error('Observed operator page closed before capture ended');
    const observation = await boundedRead(page.evaluate(({ sampleOffset, frameIntervalOffset, foregroundReceiptOffset, completedRunIds }) => {
      const state = window.__kimodoSharedDevice;
      if (!state) return {
        at: new Date().toISOString(), url: location.href, pageRuntimeId: performance.timeOrigin, pageStatePresent: false, state: null,
        sampleOffset, samples: [], frameIntervalOffset, frameIntervals: [],
        foregroundReceiptOffset, foregroundReceipts: [], runs: [], completedRuns: [],
      };
      const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
      if (!Array.isArray(state.samples) || !Array.isArray(state.frameIntervals) || !Array.isArray(state.foregroundReceipts)) {
        throw new Error('page telemetry arrays are missing or retyped');
      }
      if (state.samples.length < sampleOffset || state.frameIntervals.length < frameIntervalOffset || state.foregroundReceipts.length < foregroundReceiptOffset) {
        throw new Error('page telemetry arrays reset below the observer cursor');
      }
      const runSummary = record => ({
        runId: record.runId, generationId: record.generationId, status: record.status, prompt: record.prompt,
        steps: record.steps, duration: record.duration, scheduling: clone(record.scheduling),
        startedAtMs: record.startedAtMs, endedAtMs: record.endedAtMs ?? null, wallMs: record.wallMs ?? null,
        frameIntervalStart: record.frameIntervalStart, pageP95Ms: record.pageP95Ms ?? null,
        pageP99Ms: record.pageP99Ms ?? null, pageMaxMs: record.pageMaxMs ?? null,
        frameIntervalsOver33Ms: record.frameIntervalsOver33Ms ?? null,
        frameIntervalsOver100Ms: record.frameIntervalsOver100Ms ?? null,
        sampleCount: record.samples?.length ?? null, foregroundReceiptCount: record.foregroundReceipts?.length ?? null,
        flameBefore: clone(record.flameBefore), flameAfter: clone(record.flameAfter ?? null),
        modelStatus: record.modelStatus ?? null, error: clone(record.error ?? null),
      });
      const completedRuns = state.runs.filter(record =>
        !completedRunIds.includes(record.runId) && !['running', 'finishing', 'finalizing'].includes(record.status),
      ).map(record => {
        const { samples, frameIntervals, foregroundReceipts, ...terminal } = record;
        return clone(terminal);
      });
      return {
        at: new Date().toISOString(), url: location.href, pageRuntimeId: performance.timeOrigin, pageStatePresent: true,
        state: {
          schema: state.schema, status: state.status, progressSequence: state.progressSequence,
          progress: clone(state.progress), source: clone(state.source), deviceReceipt: clone(state.deviceReceipt),
          deviceTopology: state.deviceTopology, queueTopology: state.queueTopology,
          teardown: clone(state.teardown), lastError: clone(state.lastError),
        },
        sampleOffset, samples: clone(state.samples.slice(sampleOffset)),
        frameIntervalOffset, frameIntervals: clone(state.frameIntervals.slice(frameIntervalOffset)),
        foregroundReceiptOffset, foregroundReceipts: clone(state.foregroundReceipts.slice(foregroundReceiptOffset)),
        runs: state.runs.map(runSummary), completedRuns,
      };
    }, { sampleOffset, frameIntervalOffset, foregroundReceiptOffset, completedRunIds: [...completedRunIds] }), 'page telemetry read');
    observation.sampleOffset = sampleOffset;
    observation.frameIntervalOffset = frameIntervalOffset;
    observation.foregroundReceiptOffset = foregroundReceiptOffset;
    if (pageRuntimeId != null && observation.pageRuntimeId !== pageRuntimeId) {
      throw new Error(`page runtime changed from ${pageRuntimeId} to ${observation.pageRuntimeId ?? 'unknown'}`);
    }
    if (observation.sampleOffset !== report.telemetry.samples.length || observation.frameIntervalOffset !== report.telemetry.frameIntervalsMs.length || observation.foregroundReceiptOffset !== report.telemetry.foregroundReceipts.length) {
      throw new Error('page telemetry offsets do not match the last durable chunk');
    }
    const chunk = { schema: 'kaminos.kimodo-shared-device-telemetry-chunk.v1', sequence: report.observations.length + 1, ...observation };
    appendFileSync(chunksPath, `${JSON.stringify(chunk)}\n`);
    mergeObservation(report, observation);
    pageRuntimeId = observation.pageRuntimeId;
    for (const completedRun of observation.completedRuns ?? []) completedRunIds.add(completedRun.runId);
    sampleOffset = report.telemetry.samples.length;
    frameIntervalOffset = report.telemetry.frameIntervalsMs.length;
    foregroundReceiptOffset = report.telemetry.foregroundReceipts.length;
    report.failurePhase = null;
    report.status = stopping ? 'stopping' : 'capturing';
    writeReport();
    if (stopRequested) stopping = true;
    else await new Promise(resolveDelay => setTimeout(resolveDelay, pollMs));
  }
  report.status = 'stopped';
  report.finishedAt = new Date().toISOString();
} catch (error) {
  report.status = 'failed';
  report.finishedAt = new Date().toISOString();
  report.error = { name: error?.name || 'Error', message: error?.message || String(error) };
  report.failurePhase ||= 'observation';
  process.exitCode = 1;
} finally {
  if (browser) browser.disconnect();
  try { writeReport(); } catch (error) {
    process.stderr.write(`Unable to write telemetry report: ${error?.message || error}\n`);
    process.exitCode = 1;
  }
}
