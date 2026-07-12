#!/usr/bin/env node
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);

const url = args.get('--url') || 'http://127.0.0.1:8095/?tab=generate';
const out = resolve(args.get('--out') || '/tmp/kaminos-foreground-kiln-heartbeat.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const settleMs = Number(args.get('--settle-ms') || 5000);
const chromePath = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sharpRepo = process.env.KAMINOS_SHARP_WEBGPU_REPO || '/Users/noahlyons/dev/sharp-webgpu';

let phase = 'initializing';
let primaryOutputWritten = false;
let lastTrustworthyEvidence = null;
const consoleEvents = [];

function writeReport(extra = {}) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify({
    schema: 'kaminos.foreground-kiln-heartbeat-witness.v0',
    requestedRoute: url,
    settleMs,
    phase,
    primaryOutputWritten,
    screenshot: primaryOutputWritten ? out : null,
    consoleEvents,
    lastTrustworthyEvidence,
    ...extra,
  }, null, 2)}\n`);
}

async function loadPuppeteer() {
  const require = createRequire(import.meta.url);
  const modulePath = require.resolve('puppeteer-core', { paths: [sharpRepo] });
  return import(pathToFileURL(modulePath).href);
}

let browser = null;
try {
  phase = 'launching-browser';
  const { default: puppeteer } = await loadPuppeteer();
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: ['--enable-unsafe-webgpu', '--disable-gpu-sandbox', '--no-sandbox', '--window-size=1440,1000'],
    defaultViewport: { width: 1440, height: 1000 },
  });
  const page = await browser.newPage();
  page.on('console', message => consoleEvents.push({ type: message.type(), text: message.text() }));
  page.on('pageerror', error => consoleEvents.push({ type: 'pageerror', text: error?.message || String(error) }));

  phase = 'loading-route';
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForFunction(() => window.kaminosSharpBreathingRoomKilnFireDebug?.begin, { timeout: 30000 });

  phase = 'starting-fire';
  await page.evaluate(async () => {
    await window.kaminosSharpBreathingRoomKilnFireDebug.begin({
      profileId: 'cooperative-spn-gaussian',
      pipelineId: 'sharp-image-to-splat-live-v0',
      source: { source: 'witness://foreground-kiln-heartbeat', label: 'Foreground heartbeat witness' },
    });
  });

  phase = 'recording-foreground';
  await new Promise(resolveDelay => setTimeout(resolveDelay, settleMs));
  lastTrustworthyEvidence = await page.evaluate(() => window.kaminosSharpBreathingRoomKilnFireDebug.state());
  if (lastTrustworthyEvidence?.fire?.phase !== 'burning') throw new Error('kiln fire did not enter burning phase');
  if (lastTrustworthyEvidence?.volume?.active !== true) throw new Error('live volume route is not active');
  await page.screenshot({ path: out, fullPage: true });
  primaryOutputWritten = true;

  phase = 'closing-episode';
  await page.evaluate(async () => {
    await window.kaminosSharpBreathingRoomKilnFireDebug.end('witness-complete', {
      forceInactive: true,
      sharpHeartbeat: {
        schema: 'sharp-webgpu.background-heartbeat.v0',
        status: 'fixture-pointer-only',
      },
    });
  });
  lastTrustworthyEvidence = await page.evaluate(() => window.kaminosSharpBreathingRoomKilnFireDebug.state());
  const foreground = lastTrustworthyEvidence?.fire?.foregroundHeartbeat || null;
  if (foreground?.schema !== 'kaminos.foreground-kiln-heartbeat.v0') throw new Error('foreground heartbeat report is missing');
  if (foreground.status !== 'verified') throw new Error(`foreground heartbeat is ${foreground.status}: ${(foreground.failures || []).join(', ')}`);
  if (foreground.effectiveFireBudget?.resolution !== 90
    || foreground.effectiveFireBudget?.renderScale !== 0.4
    || foreground.effectiveFireBudget?.adaptiveRays !== 1) {
    throw new Error(`effective kiln budget drifted: ${JSON.stringify(foreground.effectiveFireBudget)}`);
  }
  const fatalConsoleEvents = consoleEvents.filter(event => event.type === 'error' || event.type === 'pageerror');
  if (fatalConsoleEvents.length) throw new Error(`browser console errors: ${fatalConsoleEvents.map(event => event.text).join(' | ')}`);
  phase = 'complete';
  writeReport({ ok: true, foregroundHeartbeat: foreground });
  console.log(reportPath);
} catch (error) {
  writeReport({ ok: false, error: error?.stack || error?.message || String(error) });
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
} finally {
  await browser?.close();
}
