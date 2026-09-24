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
    'poll-ms': { type: 'string', default: '500' },
  },
  strict: true,
});

if (!values['output-dir']) throw new Error('Usage: observe-kimodo-shared-device.mjs --output-dir DIR [--browser-url URL] [--url URL]');
const pollMs = Number(values['poll-ms']);
if (!Number.isSafeInteger(pollMs) || pollMs < 1) throw new Error('--poll-ms must be a positive integer');

const outputDir = resolve(values['output-dir']);
mkdirSync(outputDir, { recursive: true });
const reportPath = join(outputDir, 'operator-telemetry.json');
const reportTempPath = `${reportPath}.tmp`;
const chunksPath = join(outputDir, 'operator-telemetry.ndjson');
const report = emptyObservationReport({ requestedUrl: values.url });
report.effective = { browserUrl: values['browser-url'], pageUrl: null, pollMs, telemetryChunks: chunksPath };

function writeReport() {
  const { telemetry, ...summary } = report;
  summary.telemetryCounts = {
    samples: telemetry.samples.length,
    frameIntervals: telemetry.frameIntervalsMs.length,
    foregroundReceipts: telemetry.foregroundReceipts.length,
    runs: telemetry.runs.length,
  };
  summary.runs = telemetry.runs;
  summary.partialFrameIntervalMs = intervalSummary(telemetry.frameIntervalsMs);
  writeFileSync(reportTempPath, `${JSON.stringify(summary, null, 2)}\n`);
  renameSync(reportTempPath, reportPath);
}

function intervalSummary(intervals) {
  if (!intervals.length) return null;
  const sorted = [...intervals].sort((a, b) => a - b);
  const percentile = fraction => sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
  return { count: sorted.length, p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99), maxMs: sorted.at(-1) };
}

writeReport();
let browser = null;
let stopping = false;
let page = null;
let timer = null;
const requestStop = signal => {
  if (stopping) return;
  stopping = true;
  report.stopSignal = signal;
  report.status = 'stopping';
};
process.on('SIGINT', () => requestStop('SIGINT'));
process.on('SIGTERM', () => requestStop('SIGTERM'));

try {
  const kimodoCheckout = process.env.KIMODO_WEBGPU_CHECKOUT;
  if (!kimodoCheckout) throw new Error('KIMODO_WEBGPU_CHECKOUT must name the exact Kimodo checkout containing puppeteer-core');
  const requireFromKimodo = createRequire(join(resolve(kimodoCheckout), 'package.json'));
  const puppeteer = requireFromKimodo('puppeteer-core');
  report.failurePhase = 'browser-connect';
  browser = await puppeteer.connect({ browserURL: values['browser-url'] });
  report.effective.browserVersion = await browser.version();
  report.failurePhase = 'page-discovery';
  const expected = new URL(values.url);
  const pages = await browser.pages();
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
  while (!stopping) {
    if (page.isClosed()) throw new Error('Observed operator page closed before capture ended');
    const observation = await page.evaluate(({ sampleOffset, frameIntervalOffset, foregroundReceiptOffset }) => {
      const state = window.__kimodoSharedDevice;
      if (!state) return {
        at: new Date().toISOString(), url: location.href, pageStatePresent: false, state: null,
        sampleOffset, samples: [], frameIntervalOffset, frameIntervals: [],
        foregroundReceiptOffset, foregroundReceipts: [], runs: [],
      };
      const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
      return {
        at: new Date().toISOString(), url: location.href, pageStatePresent: true,
        state: {
          schema: state.schema, status: state.status, progressSequence: state.progressSequence,
          progress: clone(state.progress), source: clone(state.source), deviceReceipt: clone(state.deviceReceipt),
          deviceTopology: state.deviceTopology, queueTopology: state.queueTopology,
          teardown: clone(state.teardown), lastError: clone(state.lastError),
        },
        sampleOffset, samples: clone(state.samples.slice(sampleOffset)),
        frameIntervalOffset, frameIntervals: clone(state.frameIntervals.slice(frameIntervalOffset)),
        foregroundReceiptOffset, foregroundReceipts: clone(state.foregroundReceipts.slice(foregroundReceiptOffset)),
        runs: clone(state.runs),
      };
    }, { sampleOffset, frameIntervalOffset, foregroundReceiptOffset });
    observation.sampleOffset = sampleOffset;
    observation.frameIntervalOffset = frameIntervalOffset;
    observation.foregroundReceiptOffset = foregroundReceiptOffset;
    const chunk = { schema: 'kaminos.kimodo-shared-device-telemetry-chunk.v1', sequence: report.observations.length + 1, ...observation };
    mergeObservation(report, observation);
    sampleOffset = report.telemetry.samples.length;
    frameIntervalOffset = report.telemetry.frameIntervalsMs.length;
    foregroundReceiptOffset = report.telemetry.foregroundReceipts.length;
    appendFileSync(chunksPath, `${JSON.stringify(chunk)}\n`);
    report.failurePhase = null;
    report.status = stopping ? 'stopping' : 'capturing';
    writeReport();
    await new Promise(resolveDelay => { timer = setTimeout(resolveDelay, pollMs); });
    timer = null;
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
