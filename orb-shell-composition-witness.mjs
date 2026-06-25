#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const args = new Map(process.argv.slice(2).map((arg, index, arr) => arg.startsWith('--') ? [arg, arr[index + 1]] : [arg, null]));
const url = args.get('--url') || 'http://127.0.0.1:8097/?kaminos_orb_shell_grounding=1';
const out = resolve(args.get('--out') || '/tmp/kaminos-orb-shell-composition-witness.png');
const reportPath = resolve(args.get('--report') || '/tmp/kaminos-orb-shell-composition-witness.json');
const port = Number(args.get('--debug-port') || 9230);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-orb-shell-composition-witness-profile-${port}`;
const settleMs = Number(args.get('--settle-ms') || 2500);

let phase = 'init';
let browser = null;
let stderr = '';
let counter = 0;
const browserEvents = [];

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

async function fetchJson(path) {
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
  throw lastError || new Error('Chrome DevTools endpoint did not open');
}

function pngStats(path) {
  const data = readFileSync(path);
  assert.equal(data.toString('ascii', 1, 4), 'PNG', 'screenshot is not a PNG');
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  return { width, height, bytes: data.length };
}

async function send(ws, method, params = {}) {
  const id = ++counter;
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

async function evaluate(ws, expression) {
  const result = await send(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function main() {
  const report = {
    requestedUrl: url,
    routeGate: 'kaminos_orb_shell_grounding=1',
    expectedIdentity: 'orb-shell-macro-grammar-grounding-v0',
    phase,
  };
  try {
    rmSync(userDataDir, { recursive: true, force: true });
    phase = 'launch-chrome';
    browser = spawn(chrome, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--headless=new',
      '--disable-gpu-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1600,1100',
      url,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    browser.stderr.on('data', chunk => { stderr += chunk.toString(); });

    phase = 'connect';
    const targets = await fetchJson('/json');
    const page = targets.find(target => target.type === 'page' && target.url.includes('kaminos_orb_shell_grounding=1')) || targets.find(target => target.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error('No CDP page websocket for orb shell composition witness');

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolveWs, rejectWs) => {
      ws.addEventListener('open', resolveWs, { once: true });
      ws.addEventListener('error', rejectWs, { once: true });
    });
    ws.addEventListener('message', message => {
      const payload = JSON.parse(message.data.toString());
      if (payload.method === 'Runtime.exceptionThrown') {
        browserEvents.push({ method: payload.method, exception: payload.params?.exceptionDetails });
      }
      if (payload.method === 'Runtime.consoleAPICalled') {
        browserEvents.push({
          method: payload.method,
          type: payload.params?.type,
          args: (payload.params?.args || []).map(arg => arg.value ?? arg.description ?? arg.type),
        });
      }
    });
    await send(ws, 'Runtime.enable');
    await send(ws, 'Page.enable');
    await delay(settleMs);

    phase = 'state';
    const state = await evaluate(ws, 'window.__kaminosOrbShellCompositionWitness?.debugState?.()');
    assert.equal(state?.identity, 'orb-shell-macro-grammar-grounding-v0', 'wrong composition witness identity');
    assert.equal(state?.active, true, 'composition witness inactive');
    assert.equal(state?.baselineDisposition, 'coherent-but-wrong-model-baseline', 'v0 baseline disposition missing');
    assert.ok(state?.macroAssemblageCount >= 3 && state.macroAssemblageCount <= 5, 'composition must expose 3-5 macro assemblages');
    assert.ok(state?.bandMemberCount >= state.macroAssemblageCount * 2, 'composition must expose child band families');
    assert.equal(state?.territoryBodyCount, state.macroAssemblageCount, 'composition must expose one MacroTerritoryBody per macro assemblage');
    assert.ok(state?.closureAnchorCount >= 4, 'composition must expose spherical closure anchors');
    assert.ok(state?.MacroTerritoryBody?.every(body => body?.schema === 'MacroTerritoryBody'), 'MacroTerritoryBody descriptors missing from debug state');
    assert.equal(state?.shapedBoundaryCount, state.macroAssemblageCount, 'composition must expose one shaped boundary per macro assemblage');
    assert.ok(state?.BoundaryPressureField?.every(field => field?.schema === 'BoundaryPressureField'), 'BoundaryPressureField descriptors missing from debug state');
    assert.ok(state?.frontApertureOwnershipCount >= 4, 'primary aperture ownership descriptors missing from debug state');
    assert.equal(state?.PrimaryApertureFrame?.schema, 'PrimaryApertureFrame', 'PrimaryApertureFrame missing from debug state');
    assert.ok(state?.frontApertureOwnership?.frontCompositionBias?.includes('break-open-horseshoe-symmetry'), 'front composition bias missing from debug state');
    assert.equal(state?.controlledVariation?.schema, 'OrbShellVariationDescriptor', 'controlled variation descriptor missing from debug state');
    assert.equal(state?.effectiveVariation?.mode, 'orb-shell-controlled-variation-assay-v0', 'effective variation mode missing from debug state');
    assert.ok(state?.variantId, 'variantId missing from debug state');
    assert.equal(state?.MacroBodyPromotionPlan?.schema, 'MacroBodyPromotionPlan', 'MacroBodyPromotionPlan missing from debug state');
    assert.equal(state?.promotedBodyCount, state.macroAssemblageCount, 'composition must expose one MacroPromotedBody per macro assemblage');
    assert.ok(state?.MacroPromotedBody?.every(body => body?.schema === 'MacroPromotedBody'), 'MacroPromotedBody descriptors missing from debug state');
    assert.equal(state?.lowerCupClosure?.mode, 'lower-cup-socket-contiguous', 'lower cup closure descriptor missing from debug state');
    assert.equal(state?.crossingTuckIntegration?.mode, 'crossing-tuck-macro-body', 'crossing tuck integration descriptor missing from debug state');
    assert.equal(state?.ExpandedMacroRegionProxyPlan?.schema, 'ExpandedMacroRegionProxyPlan', 'ExpandedMacroRegionProxyPlan missing from debug state');
    assert.equal(state?.expandedRegionCount, state.macroAssemblageCount, 'composition must expose one ExpandedMacroRegionProxy per macro assemblage');
    assert.ok(state?.ExpandedMacroRegionProxy?.every(region => region?.schema === 'ExpandedMacroRegionProxy'), 'ExpandedMacroRegionProxy descriptors missing from debug state');
    assert.ok(state?.seamGapCount >= 5, 'composition must expose seam/gap descriptors');
    assert.ok(state?.MacroRegionSeamGapDescriptor?.every(gap => gap?.schema === 'MacroRegionSeamGapDescriptor'), 'MacroRegionSeamGapDescriptor records missing from debug state');
    assert.ok(state?.sphericalClosureAnchors?.some(anchor => anchor.id === 'crown-closure-anchor'), 'crown closure anchor missing');
    assert.ok(state?.OrbShellComposition?.inverseProceduralHypotheses, 'OrbShellComposition lacks inverseProceduralHypotheses');
    assert.ok(state?.OrbShellComposition?.AperturePressure?.forbiddenFailureClasses?.includes('strip-soup'), 'failure class evidence missing');

    phase = 'screenshot';
    const shot = await send(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(shot.data, 'base64'));
    const stats = pngStats(out);
    assert.ok(stats.bytes > 15000, 'blank frame or tiny screenshot');
    assert.ok(stats.width > 300 && stats.height > 300, 'blank frame dimensions');
    ws.close();

    writeReport({
      ...report,
      effectiveUrl: page.url,
      phase,
      screenshot: { path: out, bytes: stats.bytes },
      visualStats: stats,
      macroAssemblageCount: state.macroAssemblageCount,
      promotedBodyCount: state.promotedBodyCount,
      expandedRegionCount: state.expandedRegionCount,
      seamGapCount: state.seamGapCount,
      bandMemberCount: state.bandMemberCount,
      territoryBodyCount: state.territoryBodyCount,
      closureAnchorCount: state.closureAnchorCount,
      shapedBoundaryCount: state.shapedBoundaryCount,
      frontApertureOwnershipCount: state.frontApertureOwnershipCount,
      variantId: state.variantId,
      variationSeed: state.variationSeed,
      controlledVariation: state.controlledVariation,
      effectiveVariation: state.effectiveVariation,
      MacroBodyPromotionPlan: state.MacroBodyPromotionPlan,
      macroBodyPromotion: state.macroBodyPromotion,
      MacroPromotedBody: state.MacroPromotedBody,
      lowerCupClosure: state.lowerCupClosure,
      crossingTuckIntegration: state.crossingTuckIntegration,
      ExpandedMacroRegionProxyPlan: state.ExpandedMacroRegionProxyPlan,
      expandedMacroRegionProxyPlan: state.expandedMacroRegionProxyPlan,
      ExpandedMacroRegionProxy: state.ExpandedMacroRegionProxy,
      MacroRegionSeamGapDescriptor: state.MacroRegionSeamGapDescriptor,
      inverseProceduralHypotheses: state.inverseProceduralHypotheses,
      PrimaryApertureFrame: state.PrimaryApertureFrame,
      frontApertureOwnership: state.frontApertureOwnership,
      MacroTerritoryBody: state.MacroTerritoryBody,
      BoundaryPressureField: state.BoundaryPressureField,
      boundaryPressureFields: state.boundaryPressureFields,
      sphericalClosureAnchors: state.sphericalClosureAnchors,
      OrbShellComposition: state.OrbShellComposition,
      browserEvents,
      stderrTail: stderr.slice(-2000),
    });
  } catch (error) {
    writeReport({
      ...report,
      phase,
      error: error.message,
      browserEvents,
      stderrTail: stderr.slice(-2000),
    });
    throw error;
  } finally {
    browser?.kill('SIGTERM');
  }
}

main();
