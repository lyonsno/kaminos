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
const focus = args.get('--focus') || 'wide';

let phase = 'init';
let browser = null;
let stderr = '';
let counter = 0;
const browserEvents = [];
let cleanSidewallTopologyWitness = null;
let liveTerminalCapWitness = null;

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
    focus,
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
    if (focus === 'side-rim-return') {
      await evaluate(ws, 'window.__kaminosOrbShellCompositionWitness?.frameSideRimReturn?.()');
      await delay(500);
    }
    if (focus === 'live-macro-sidewall') {
      await evaluate(ws, 'window.__kaminosOrbShellCompositionWitness?.frameLiveMacroSideWall?.()');
      await delay(500);
    }
    if (focus === 'live-terminal-caps') {
      await evaluate(ws, 'window.__kaminosOrbShellCompositionWitness?.frameLiveMacroTerminalCaps?.()');
      liveTerminalCapWitness = await evaluate(ws, 'window.__kaminosOrbShellCompositionWitness?.enableLiveTerminalCapWitness?.()');
      await delay(500);
    }
    if (focus === 'side-rim-clean-topology') {
      cleanSidewallTopologyWitness = await evaluate(ws, 'window.__kaminosOrbShellCompositionWitness?.enableCleanSidewallTopologyWitness?.()');
      await delay(500);
    }

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
    assert.equal(state?.ChannelThroughLineAudit?.schema, 'ChannelThroughLineAudit', 'ChannelThroughLineAudit missing from debug state');
    assert.equal(state?.ChannelThroughLineAudit?.mode, 'channel-through-line-audit-v0', 'ChannelThroughLineAudit mode missing from debug state');
    assert.equal(state?.constantGapVerdict, 'not-yet-proven', 'channel audit must not claim solved constant-gap corridors');
    assert.ok(state?.channelCandidateCount >= 2, 'channel audit candidates missing from debug state');
    assert.equal(state?.ChannelThroughLinePlan?.schema, 'ChannelThroughLinePlan', 'ChannelThroughLinePlan missing from debug state');
    assert.equal(state?.ChannelThroughLinePlan?.mode, 'channel-through-line-descriptor-v0', 'ChannelThroughLinePlan mode missing from debug state');
    assert.ok(state?.channelThroughLineDescriptorCount >= 2, 'channel through-line descriptors missing from debug state');
    assert.ok(state?.ChannelThroughLineDescriptor?.every(descriptor => descriptor?.schema === 'ChannelThroughLineDescriptor'), 'ChannelThroughLineDescriptor records missing from debug state');
    assert.ok(state?.channelCorridorVerdict, 'channel corridor verdict missing from debug state');
    assert.equal(state?.LamellarChannelMeshPlan?.schema, 'LamellarChannelMeshPlan', 'LamellarChannelMeshPlan missing from debug state');
    assert.equal(state?.LamellarChannelMeshPlan?.mode, 'flat-lamellar-channel-strip-v0', 'LamellarChannelMeshPlan mode missing from debug state');
    assert.ok(state?.lamellarChannelStripMeshCount >= 1, 'flat lamellar channel strip mesh missing from debug state');
    assert.ok(state?.lamellarPlateLipCount >= 2, 'flat lamellar plate lips missing from debug state');
    assert.equal(state?.plateLipVisualLegibilityVerdict, 'raised-flat-lips-visible-plate-language', 'plate lip visual verdict missing from debug state');
    assert.equal(state?.roundDiagnosticRailFinalVisible, false, 'round channel rails must not be final-visible geometry');
    assert.ok(state?.LamellarChannelStripMesh?.every(strip => strip?.schema === 'LamellarChannelStripMesh'), 'LamellarChannelStripMesh records missing from debug state');
    assert.ok(state?.LamellarPlateLip?.every(lip => lip?.schema === 'LamellarPlateLip'), 'LamellarPlateLip records missing from debug state');
    assert.equal(state?.LamellarPlateBoundaryPlan?.schema, 'LamellarPlateBoundaryPlan', 'LamellarPlateBoundaryPlan missing from debug state');
    assert.equal(state?.LamellarPlateBoundaryPlan?.mode, 'plate-boundary-topology-v0', 'LamellarPlateBoundaryPlan mode missing from debug state');
    assert.ok(state?.plateBoundaryMeshCount >= 1, 'plate boundary mesh missing from debug state');
    assert.equal(state?.plateBoundaryTopologyVerdict, 'one-intentional-gap-boundary-meshed', 'plate boundary topology verdict missing from debug state');
    assert.ok(state?.targetPlateBoundaryIds?.includes('lower-cup-socket-join-gap'), 'lower cup target boundary missing from debug state');
    assert.equal(state?.decorativeSeamHintsFinalVisible, false, 'decorative seam hints must be suppressed in topology witness');
    assert.equal(state?.proxyPlateLipsFinalVisible, false, 'proxy plate lips must be suppressed in topology witness');
    assert.ok(state?.LamellarPlateBoundaryMesh?.every(mesh => mesh?.schema === 'LamellarPlateBoundaryMesh'), 'LamellarPlateBoundaryMesh records missing from debug state');
    assert.equal(state?.LamellarInnerReturnPlan?.schema, 'LamellarInnerReturnPlan', 'LamellarInnerReturnPlan missing from debug state');
    assert.equal(state?.LamellarInnerReturnPlan?.mode, 'inner-return-side-plane-v0', 'LamellarInnerReturnPlan mode missing from debug state');
    assert.ok(state?.innerReturnSidePlaneMeshCount >= 1, 'inner-return side-plane mesh missing from debug state');
    assert.equal(state?.innerReturnSidePlaneTopologyVerdict, 'one-visible-side-rim-return-side-plane-meshed', 'inner-return side-plane topology verdict missing from debug state');
    assert.equal(state?.innerReturnSideWallVisibilityVerdict, 'visible-sidewall-render-surface-required', 'inner-return sidewall visibility verdict missing from debug state');
    assert.ok(state?.visibleSideWallSurfaceCount >= 1, 'visible sidewall render surface missing from debug state');
    assert.equal(state?.cleanTopologyWitnessMode, 'clean-sidewall-topology-v0', 'clean sidewall topology witness mode missing from debug state');
    assert.equal(state?.cleanTopologyProxyClutterVisible, false, 'clean topology witness must suppress proxy clutter');
    if (focus === 'side-rim-clean-topology') {
      assert.equal(cleanSidewallTopologyWitness?.schema, 'CleanSidewallTopologyWitnessState', 'clean sidewall topology witness did not activate');
      assert.equal(cleanSidewallTopologyWitness?.materialMode, 'flat-diagnostic-no-metal', 'clean sidewall topology witness must use flat materials');
      assert.equal(cleanSidewallTopologyWitness?.surfaceDetailMode, 'disabled', 'clean sidewall topology witness must disable surface detail');
      assert.equal(cleanSidewallTopologyWitness?.proxyClutterVisible, false, 'clean sidewall topology witness must hide proxy clutter');
    }
    assert.equal(state?.declaredSecondLayer, false, 'inner-return side plane must not declare a full second layer');
    assert.ok(state?.targetInnerReturnBoundaryIds?.includes('right-side-rim-reveal-gap'), 'right-side rim target missing from debug state');
    assert.ok(state?.LamellarInnerReturnSidePlaneMesh?.every(mesh => mesh?.schema === 'LamellarInnerReturnSidePlaneMesh'), 'LamellarInnerReturnSidePlaneMesh records missing from debug state');
    const sideWallVisibilityProbe = await evaluate(ws, `
      window.__kaminosOrbShellCompositionWitness?.sideWallVisibilityProbe?.({
        width: window.innerWidth,
        height: window.innerHeight
      })
    `);
    assert.equal(sideWallVisibilityProbe?.schema, 'LamellarInnerReturnSideWallVisibilityProbe', 'sidewall visibility probe missing schema');
    assert.ok(sideWallVisibilityProbe?.meshCount >= 1, 'sidewall visibility probe found no sidewall meshes');
    assert.ok(sideWallVisibilityProbe?.visibleMeshCount >= 1, 'sidewall visibility probe found no visible sidewall footprint');
    assert.ok(sideWallVisibilityProbe?.probes?.some(probe => probe.projectedWidthPx >= probe.contract.minimumProjectedWidthPx), 'sidewall projected width below contract minimum');
    assert.equal(state?.CrossingSubSurgePlan?.schema, 'CrossingSubSurgePlan', 'CrossingSubSurgePlan missing from debug state');
    assert.equal(state?.CrossingSubSurgePlan?.mode, 'crossing-sub-surge-decomposition-v0', 'CrossingSubSurgePlan mode missing from debug state');
    assert.ok(state?.crossingSubSurgeCount >= 3, 'composition must expose crossing body plus subordinate sub-surges');
    assert.ok(state?.CrossingSubSurge?.every(surge => surge?.schema === 'CrossingSubSurge'), 'CrossingSubSurge descriptors missing from debug state');
    assert.equal(state?.CleanProxySurfacePolicy?.schema, 'CleanProxySurfacePolicy', 'CleanProxySurfacePolicy missing from debug state');
    assert.equal(state?.CleanProxySurfacePolicy?.mode, 'clean-proxy-surface-diagnostic-v0', 'clean proxy surface policy mode missing from debug state');
    assert.equal(state?.topologyOnlySurfaceRelief, true, 'topology-only surface relief missing from debug state');
    assert.equal(state?.MacroTorsionFieldPlan?.schema, 'MacroTorsionFieldPlan', 'MacroTorsionFieldPlan missing from debug state');
    assert.equal(state?.MacroTorsionFieldPlan?.mode, 'macro-torsion-field-v0', 'MacroTorsionFieldPlan mode missing from debug state');
    assert.equal(state?.torsionFieldCount, state.macroAssemblageCount, 'composition must expose one MacroTorsionField per macro assemblage');
    assert.ok(state?.MacroTorsionField?.every(field => field?.schema === 'MacroTorsionField'), 'MacroTorsionField descriptors missing from debug state');
    assert.ok(state?.effectiveTorsion?.every(field => typeof field?.effectiveTwist === 'number'), 'effective torsion missing from debug state');
    assert.equal(state?.MacroBodyPromotionPlan?.schema, 'MacroBodyPromotionPlan', 'MacroBodyPromotionPlan missing from debug state');
    assert.equal(state?.promotedBodyCount, state.macroAssemblageCount, 'composition must expose one MacroPromotedBody per macro assemblage');
    assert.ok(state?.MacroPromotedBody?.every(body => body?.schema === 'MacroPromotedBody'), 'MacroPromotedBody descriptors missing from debug state');
    assert.equal(state?.LiveMacroSideWallPlan?.schema, 'LiveMacroSideWallPlan', 'LiveMacroSideWallPlan missing from debug state');
    assert.ok(state?.liveMacroSideWallCount >= 1, 'live macro sidewall missing from debug state');
    assert.equal(state?.liveMacroSideWallMeshCount, state.liveMacroSideWallCount, 'rendered live macro sidewall mesh count must match live macro sidewall plan count');
    assert.equal(state?.liveMacroSideWallMeshIds?.length, state.liveMacroSideWallCount, 'rendered live macro sidewall mesh ids must match live macro sidewall plan count');
    assert.equal(state?.liveMacroSideWallVisibilityVerdict, 'visible-promoted-body-edge-sidewalls-rendered', 'live macro sidewall visibility verdict missing from debug state');
    assert.ok(state?.targetLiveMacroSideWallIds?.includes('north-west-dominant-thrust'), 'north-west live sidewall target missing from debug state');
    assert.ok(state?.LiveMacroSideWall?.every(wall => wall?.schema === 'LiveMacroSideWall'), 'LiveMacroSideWall records missing from debug state');
    assert.equal(state?.liveMacroTerminalCapCount, state.macroAssemblageCount * 2, 'live terminal cap coverage missing from debug state');
    assert.equal(state?.terminalCapClosureVerdict, 'live-promoted-body-termini-capped', 'terminal cap closure verdict missing from debug state');
    assert.ok(state?.LiveMacroTerminalCap?.every(cap => cap?.schema === 'LiveMacroTerminalCap'), 'LiveMacroTerminalCap records missing from debug state');
    assert.equal(state?.normalWitnessMaterialPolicy?.materialMode, 'neutral-semi-gloss-pbr-v0', 'normal witness material mode missing from debug state');
    assert.equal(state?.normalWitnessMaterialPolicy?.materialClass, 'MeshStandardMaterial', 'normal witness material must use MeshStandardMaterial');
    assert.equal(state?.normalWitnessMaterialPolicy?.environmentLit, true, 'normal witness material must use environment lighting');
    assert.equal(state?.legacyScaffoldSuppressionVerdict, 'covered-promoted-body-legacy-round-bands-suppressed', 'covered legacy round band scaffold suppression missing from debug state');
    assert.ok(state?.suppressedLegacyRoundBandIds?.includes('nw-body'), 'covered legacy round band ids missing from debug state');
    assert.ok(state?.suppressedLegacyRoundBandIds?.includes('cr-cover'), 'covered legacy round band ids missing crown cover from debug state');
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
    let captureOptions = { format: 'png', captureBeyondViewport: false };
    if (focus === 'side-rim-clean-topology' || focus === 'live-terminal-caps') {
      const canvasRect = await evaluate(ws, `
        (() => {
          const canvas = document.querySelector('canvas');
          if (!canvas) return null;
          const rect = canvas.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 };
        })()
      `);
      assert.ok(canvasRect?.width > 300 && canvasRect?.height > 300, 'clean topology witness could not find a captureable canvas');
      captureOptions = { ...captureOptions, clip: canvasRect };
    }
    const shot = await send(ws, 'Page.captureScreenshot', captureOptions);
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
      channelAuditVerdict: state.channelAuditVerdict,
      constantGapVerdict: state.constantGapVerdict,
      channelCandidateCount: state.channelCandidateCount,
      channelThroughLineDescriptorCount: state.channelThroughLineDescriptorCount,
      channelCorridorVerdict: state.channelCorridorVerdict,
      lamellarChannelStripMeshCount: state.lamellarChannelStripMeshCount,
      lamellarChannelMeshVerdict: state.lamellarChannelMeshVerdict,
      lamellarPlateLipCount: state.lamellarPlateLipCount,
      plateLipVisualLegibilityVerdict: state.plateLipVisualLegibilityVerdict,
      roundDiagnosticRailFinalVisible: state.roundDiagnosticRailFinalVisible,
      plateBoundaryMeshCount: state.plateBoundaryMeshCount,
      plateBoundaryTopologyVerdict: state.plateBoundaryTopologyVerdict,
      targetPlateBoundaryIds: state.targetPlateBoundaryIds,
      decorativeSeamHintsFinalVisible: state.decorativeSeamHintsFinalVisible,
      proxyPlateLipsFinalVisible: state.proxyPlateLipsFinalVisible,
      suppressedDecorativeHintCount: state.suppressedDecorativeHintCount,
      suppressedProxyFeatureCount: state.suppressedProxyFeatureCount,
      innerReturnSidePlaneMeshCount: state.innerReturnSidePlaneMeshCount,
      innerReturnSidePlaneTopologyVerdict: state.innerReturnSidePlaneTopologyVerdict,
      innerReturnSideWallVisibilityVerdict: state.innerReturnSideWallVisibilityVerdict,
      visibleSideWallSurfaceCount: state.visibleSideWallSurfaceCount,
      cleanTopologyWitnessMode: state.cleanTopologyWitnessMode,
      cleanTopologyProxyClutterVisible: state.cleanTopologyProxyClutterVisible,
      cleanSidewallTopologyWitness,
      sideWallVisibilityProbe,
      liveMacroSideWallCount: state.liveMacroSideWallCount,
      liveMacroSideWallMeshCount: state.liveMacroSideWallMeshCount,
      liveMacroSideWallMeshIds: state.liveMacroSideWallMeshIds,
      liveMacroSideWallVisibilityVerdict: state.liveMacroSideWallVisibilityVerdict,
      targetLiveMacroSideWallIds: state.targetLiveMacroSideWallIds,
      liveMacroTerminalCapCount: state.liveMacroTerminalCapCount,
      terminalCapClosureVerdict: state.terminalCapClosureVerdict,
      liveTerminalCapWitness,
      normalWitnessMaterialPolicy: state.normalWitnessMaterialPolicy,
      liveRenderMaterialPolicy: state.liveRenderMaterialPolicy,
      suppressedLegacyRoundBandIds: state.suppressedLegacyRoundBandIds,
      suppressedLegacyTerminationSocketIds: state.suppressedLegacyTerminationSocketIds,
      legacyScaffoldSuppressionVerdict: state.legacyScaffoldSuppressionVerdict,
      targetInnerReturnBoundaryIds: state.targetInnerReturnBoundaryIds,
      declaredSecondLayer: state.declaredSecondLayer,
      ChannelThroughLineAudit: state.ChannelThroughLineAudit,
      channelThroughLineAudit: state.channelThroughLineAudit,
      ChannelThroughLinePlan: state.ChannelThroughLinePlan,
      channelThroughLinePlan: state.channelThroughLinePlan,
      ChannelThroughLineDescriptor: state.ChannelThroughLineDescriptor,
      LamellarChannelMeshPlan: state.LamellarChannelMeshPlan,
      lamellarChannelMeshPlan: state.lamellarChannelMeshPlan,
      LamellarChannelStripMesh: state.LamellarChannelStripMesh,
      LamellarPlateLip: state.LamellarPlateLip,
      LamellarPlateBoundaryPlan: state.LamellarPlateBoundaryPlan,
      lamellarPlateBoundaryPlan: state.lamellarPlateBoundaryPlan,
      LamellarPlateBoundaryMesh: state.LamellarPlateBoundaryMesh,
      LamellarInnerReturnPlan: state.LamellarInnerReturnPlan,
      lamellarInnerReturnPlan: state.lamellarInnerReturnPlan,
      LamellarInnerReturnSidePlaneMesh: state.LamellarInnerReturnSidePlaneMesh,
      crossingSubSurgeCount: state.crossingSubSurgeCount,
      cleanProxySurfaceMode: state.cleanProxySurfaceMode,
      topologyOnlySurfaceRelief: state.topologyOnlySurfaceRelief,
      CrossingSubSurgePlan: state.CrossingSubSurgePlan,
      crossingSubSurgePlan: state.crossingSubSurgePlan,
      CrossingSubSurge: state.CrossingSubSurge,
      CleanProxySurfacePolicy: state.CleanProxySurfacePolicy,
      cleanProxySurfacePolicy: state.cleanProxySurfacePolicy,
      torsionFieldCount: state.torsionFieldCount,
      effectiveTorsion: state.effectiveTorsion,
      MacroTorsionFieldPlan: state.MacroTorsionFieldPlan,
      macroTorsionFieldPlan: state.macroTorsionFieldPlan,
      MacroTorsionField: state.MacroTorsionField,
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
      LiveMacroSideWallPlan: state.LiveMacroSideWallPlan,
      liveMacroSideWallPlan: state.liveMacroSideWallPlan,
      LiveMacroSideWall: state.LiveMacroSideWall,
      LiveMacroTerminalCap: state.LiveMacroTerminalCap,
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
