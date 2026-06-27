#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const args = new Map(process.argv.slice(2).map((arg, index, arr) => arg.startsWith('--') ? [arg, arr[index + 1]] : [arg, null]));
const baseUrl = args.get('--base-url') || 'http://127.0.0.1:8097/';
const variant = args.get('--variant') || 'wide-cup';
const seeds = String(args.get('--seeds') || '3,4,5,6,7,8,9')
  .split(',')
  .map(seed => Number(seed.trim()))
  .filter(seed => Number.isFinite(seed));
const outDir = resolve(args.get('--out-dir') || '/tmp/kaminos-orb-shell-seed-sweep');
const reportPath = resolve(args.get('--report') || `${outDir}/orb-shell-seed-sweep-report.json`);
const contactSheet = resolve(args.get('--contact-sheet') || `${outDir}/orb-shell-seed-sweep-contact-sheet.png`);
const focus = args.get('--focus') || 'wide';
const clipCanvas = args.get('--clip-canvas') !== 'false';
const settleMs = Number(args.get('--settle-ms') || 2500);
const startDebugPort = Number(args.get('--debug-port') || 9300);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const witnessScript = resolve(args.get('--witness-script') || './orb-shell-composition-witness.mjs');

function pngStats(path) {
  const data = readFileSync(path);
  assert.equal(data.toString('ascii', 1, 4), 'PNG', `${path} is not a PNG`);
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    bytes: data.length,
  };
}

function witnessUrl(seed) {
  const url = new URL(baseUrl);
  url.searchParams.set('kaminos_orb_shell_grounding', '1');
  url.searchParams.set('orb_shell_variant', variant);
  url.searchParams.set('orb_shell_variation_seed', String(seed));
  return url.toString();
}

function runSeedWitness(seed, index) {
  const imagePath = resolve(outDir, `seed-${String(seed).padStart(3, '0')}.png`);
  const childReportPath = resolve(outDir, `seed-${String(seed).padStart(3, '0')}.json`);
  const debugPort = startDebugPort + index;
  const command = [
    'node',
    witnessScript,
    '--url',
    witnessUrl(seed),
    '--out',
    imagePath,
    '--report',
    childReportPath,
    '--debug-port',
    String(debugPort),
    '--settle-ms',
    String(settleMs),
  ];
  if (focus !== 'wide') command.push('--focus', focus);
  if (clipCanvas) command.push('--clip-canvas', '1');
  const result = spawnSync(command[0], command.slice(1), {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 16,
  });
  if (result.status !== 0) {
    return {
      schema: 'OrbShellSeedSweepSeedResult',
      seed,
      ok: false,
      witnessCommand: command,
      imagePath,
      reportPath: childReportPath,
      stdoutTail: result.stdout?.slice(-4000) || '',
      stderrTail: result.stderr?.slice(-4000) || '',
    };
  }
  const childReport = JSON.parse(readFileSync(childReportPath, 'utf8'));
  return {
    schema: 'OrbShellSeedSweepSeedResult',
    seed,
    ok: true,
    witnessCommand: command,
    effectiveUrl: childReport.effectiveUrl,
    imagePath,
    reportPath: childReportPath,
    screenshot: childReport.screenshot,
    visualStats: childReport.visualStats,
    variantId: childReport.variantId,
    variationSeed: childReport.variationSeed,
    apertureTangencyVerdictCounts: childReport.apertureTangencyVerdictCounts,
    apertureTangencySampleCount: childReport.apertureTangencySampleCount,
    orbitCaptureFailures: (childReport.ApertureTangencySample || [])
      .filter(sample => sample.requestedTerminationClass === 'orbit-capture' && sample.classVerdict !== 'measured-orbit-capture-coupling')
      .map(sample => ({
        substripId: sample.substripId,
        siblingRole: sample.siblingRole,
        classVerdict: sample.classVerdict,
        tangentOrbitAlignment: sample.tangentOrbitAlignment,
        captureRadiusError: sample.captureRadiusError,
      })),
  };
}

async function fetchJson(port, path) {
  const deadline = Date.now() + 6000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      if (response.ok) return response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(120);
  }
  throw lastError || new Error('Chrome DevTools endpoint did not open for contact sheet');
}

async function send(ws, method, params = {}) {
  send.counter = (send.counter || 0) + 1;
  const id = send.counter;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const onMessage = message => {
      const payload = JSON.parse(message.data.toString());
      if (payload.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (payload.error) reject(new Error(`${method}: ${JSON.stringify(payload.error)}`));
      else resolve(payload.result);
    };
    ws.addEventListener('message', onMessage);
  });
}

function contactSheetHtml(seedResults) {
  const cards = seedResults.map(result => {
    const src = pathToFileURL(result.imagePath).toString();
    const verdicts = Object.entries(result.apertureTangencyVerdictCounts || {})
      .map(([key, value]) => `${key}: ${value}`)
      .join(' | ');
    const failures = result.orbitCaptureFailures?.length
      ? `orbit failures: ${result.orbitCaptureFailures.length}`
      : 'orbit capture ok';
    return `
      <figure>
        <img src="${src}" alt="Seed ${result.seed}">
        <figcaption>
          <strong>${variant}:${result.seed}</strong>
          <span>${failures}</span>
          <small>${verdicts}</small>
        </figcaption>
      </figure>
    `;
  }).join('\n');
  return `<!doctype html>
  <meta charset="utf-8">
  <title>Orb Shell Seed Sweep</title>
  <style>
    body { margin: 0; background: #080a0b; color: #dfe7ea; font: 16px/1.35 system-ui, sans-serif; }
    header { padding: 22px 26px 12px; }
    h1 { margin: 0 0 6px; font-size: 24px; font-weight: 700; letter-spacing: 0; }
    p { margin: 0; color: #9fb1b9; }
    main { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; padding: 14px 26px 28px; }
    figure { margin: 0; background: #101517; border: 1px solid #273238; border-radius: 6px; overflow: hidden; }
    img { display: block; width: 100%; aspect-ratio: 1.32; object-fit: cover; background: #000; }
    figcaption { display: grid; gap: 3px; padding: 9px 10px 10px; min-height: 62px; }
    strong { font-size: 15px; }
    span { color: #9ee5ff; font-size: 13px; }
    small { color: #94a5ab; font-size: 11px; overflow-wrap: anywhere; }
  </style>
  <header>
    <h1>Orb Shell Seed Sweep</h1>
    <p>${variant} | seeds ${seedResults.map(result => result.seed).join(', ')} | focus ${focus} | ${clipCanvas ? 'canvas-only' : 'full-page'}</p>
  </header>
  <main>${cards}</main>`;
}

async function captureContactSheet(seedResults) {
  const htmlPath = resolve(outDir, 'orb-shell-seed-sweep-contact-sheet.html');
  writeFileSync(htmlPath, contactSheetHtml(seedResults));
  const contactPort = startDebugPort + seeds.length + 20;
  const userDataDir = resolve(outDir, `contact-sheet-profile-${contactPort}`);
  rmSync(userDataDir, { recursive: true, force: true });
  let stderr = '';
  const browser = spawn(chrome, [
    `--remote-debugging-port=${contactPort}`,
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--disable-gpu-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1800,1500',
    pathToFileURL(htmlPath).toString(),
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  browser.stderr.on('data', chunk => { stderr += chunk.toString(); });
  try {
    const targets = await fetchJson(contactPort, '/json');
    const page = targets.find(target => target.type === 'page') || targets[0];
    if (!page?.webSocketDebuggerUrl) throw new Error('No CDP page websocket for contact sheet');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolveWs, rejectWs) => {
      ws.addEventListener('open', resolveWs, { once: true });
      ws.addEventListener('error', rejectWs, { once: true });
    });
    await send(ws, 'Runtime.enable');
    await send(ws, 'Page.enable');
    await delay(700);
    const shot = await send(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    mkdirSync(dirname(contactSheet), { recursive: true });
    writeFileSync(contactSheet, Buffer.from(shot.data, 'base64'));
    ws.close();
    return {
      path: contactSheet,
      htmlPath,
      stats: pngStats(contactSheet),
      stderrTail: stderr.slice(-2000),
    };
  } finally {
    browser.kill('SIGTERM');
  }
}

async function main() {
  assert.ok(seeds.length >= 1, 'at least one seed is required');
  mkdirSync(outDir, { recursive: true });
  const seedResults = seeds.map((seed, index) => runSeedWitness(seed, index));
  const failed = seedResults.filter(result => !result.ok);
  if (failed.length) {
    const report = {
      schema: 'OrbShellSeedSweepWitness',
      mode: 'orb-shell-seed-sweep-witness-v0',
      variant,
      seeds,
      focus,
      clipCanvas,
      outDir,
      seedResults,
      failedSeedCount: failed.length,
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    throw new Error(`seed sweep child witness failed for seeds: ${failed.map(result => result.seed).join(', ')}`);
  }
  const contact = await captureContactSheet(seedResults);
  const report = {
    schema: 'OrbShellSeedSweepWitness',
    mode: 'orb-shell-seed-sweep-witness-v0',
    variant,
    seeds,
    focus,
    clipCanvas,
    outDir,
    contactSheet: contact,
    seedResults,
    seedCount: seedResults.length,
    orbitCaptureFailureCount: seedResults.reduce((sum, result) => sum + (result.orbitCaptureFailures?.length || 0), 0),
    apertureTangencyVerdictCounts: seedResults.reduce((counts, result) => {
      for (const [key, value] of Object.entries(result.apertureTangencyVerdictCounts || {})) {
        counts[key] = (counts[key] || 0) + value;
      }
      return counts;
    }, {}),
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    schema: report.schema,
    variant,
    seeds,
    reportPath,
    contactSheet: contact.path,
    orbitCaptureFailureCount: report.orbitCaptureFailureCount,
    apertureTangencyVerdictCounts: report.apertureTangencyVerdictCounts,
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
