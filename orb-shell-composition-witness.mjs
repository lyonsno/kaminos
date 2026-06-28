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
const clipCanvas = args.has('--clip-canvas');
const forceAoRaw = args.get('--force-ao');
const forceAo = forceAoRaw === undefined ? null : !['0', 'false', 'off', 'no'].includes(String(forceAoRaw).toLowerCase());
const uiSeedRaw = args.get('--ui-seed');
const uiLeafCountRaw = args.get('--ui-leaf-count');
const requestedUiControls = {
  seed: uiSeedRaw === undefined ? null : Number(uiSeedRaw),
  leafCount: uiLeafCountRaw === undefined ? null : Number(uiLeafCountRaw),
};
const shouldApplyUiControls = Number.isFinite(requestedUiControls.seed) || Number.isFinite(requestedUiControls.leafCount);

let phase = 'init';
let browser = null;
let stderr = '';
let counter = 0;
const browserEvents = [];
let cleanSidewallTopologyWitness = null;
let liveTerminalCapWitness = null;
let apertureTangencyWitness = null;
let macroContactMapWitness = null;

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

async function waitForCompositionWitness(ws) {
  const deadline = Date.now() + 8000;
  let lastState = null;
  while (Date.now() < deadline) {
    lastState = await evaluate(ws, `
      (() => ({
        hasWitness: !!window.__kaminosOrbShellCompositionWitness,
        hasDebugState: typeof window.__kaminosOrbShellCompositionWitness?.debugState === 'function',
        location: window.location.href,
        documentReadyState: document.readyState
      }))()
    `);
    if (lastState?.hasWitness && lastState?.hasDebugState) return lastState;
    await delay(120);
  }
  throw new Error(`composition witness route did not initialize: ${JSON.stringify(lastState)}`);
}

async function forceAmbientOcclusion(ws, enabled) {
  if (enabled === null) return null;
  return evaluate(ws, `
    (() => {
      const toggle = document.getElementById('ao-toggle');
      if (!toggle) return { applied: false, reason: 'ao-toggle-missing' };
      toggle.checked = ${JSON.stringify(enabled)};
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
      window._kaminosDirty?.();
      return {
        applied: true,
        requestedEnabled: ${JSON.stringify(enabled)},
        effectiveEnabled: toggle.checked,
        aoDebugState: window.kaminosAODebugState?.() || null,
      };
    })()
  `);
}

async function applyOrbShellCompositionUiControls(ws) {
  if (!shouldApplyUiControls) return null;
  return evaluate(ws, `
    (() => {
      const requestedUiControls = ${JSON.stringify(requestedUiControls)};
      const seedInput = document.getElementById('orb-shell-seed');
      const leafInput = document.getElementById('orb-shell-leaf-count');
      if (!seedInput || !leafInput) {
        return {
          applied: false,
          reason: 'orb-shell-seed-or-leaf-control-missing',
          requestedUiControls,
        };
      }
      if (Number.isFinite(requestedUiControls.seed)) {
        seedInput.value = String(Math.max(0, Math.min(99999, Math.round(requestedUiControls.seed))));
        seedInput.dispatchEvent(new Event('input', { bubbles: true }));
        seedInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (Number.isFinite(requestedUiControls.leafCount)) {
        leafInput.value = String(Math.max(8, Math.min(14, Math.round(requestedUiControls.leafCount))));
        leafInput.dispatchEvent(new Event('input', { bubbles: true }));
        leafInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      window._kaminosDirty?.();
      const state = window.__kaminosOrbShellCompositionWitness?.debugState?.();
      return {
        applied: true,
        requestedUiControls,
        appliedUiControls: {
          seed: Number(seedInput.value),
          leafCount: Number(leafInput.value),
        },
        effectiveVariation: {
          variantId: state?.variantId,
          variationSeed: state?.variationSeed,
          variationLeafCount: state?.variationLeafCount,
          uiControlSource: state?.uiControlSource,
        },
      };
    })()
  `);
}

async function readRenderEffectPolicy(ws, forcedAoState) {
  return evaluate(ws, `
    (() => {
      const aoToggle = document.getElementById('ao-toggle');
      const dofToggle = document.getElementById('dof-toggle');
      const aoDebugState = window.kaminosAODebugState?.() || null;
      return {
        schema: 'OrbShellRenderEffectPolicy',
        mode: 'material-truth-smoke-render-effects-v0',
        routePolicy: window.__kaminosOrbShellRenderEffectPolicy || null,
        forcedAmbientOcclusion: ${JSON.stringify(forcedAoState)},
        ambientOcclusionEnabled: !!aoToggle?.checked,
        effectiveAoIntensity: aoDebugState?.intensity ?? null,
        gtaoState: aoDebugState,
        depthOfFieldEnabled: !!dofToggle?.checked,
        diagnosisRole: 'separate-pbr-material-read-from-screen-space-ao-ghosting',
      };
    })()
  `);
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
    const compositionWitnessReadyState = await waitForCompositionWitness(ws);
    const appliedUiControls = await applyOrbShellCompositionUiControls(ws);
    if (appliedUiControls) {
      assert.equal(appliedUiControls.applied, true, 'requested UI controls did not apply');
      if (Number.isFinite(requestedUiControls.seed)) {
        assert.equal(appliedUiControls.appliedUiControls.seed, Math.round(requestedUiControls.seed), 'UI seed control did not retain requested value');
      }
      if (Number.isFinite(requestedUiControls.leafCount)) {
        assert.equal(appliedUiControls.appliedUiControls.leafCount, Math.max(8, Math.min(14, Math.round(requestedUiControls.leafCount))), 'UI leaf control did not retain requested value');
      }
      await delay(500);
    }
    const forcedAoState = await forceAmbientOcclusion(ws, forceAo);
    if (forcedAoState) await delay(300);
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
    if (focus === 'aperture-tangency') {
      await evaluate(ws, 'window.__kaminosOrbShellCompositionWitness?.frameApertureTangencyWitness?.()');
      apertureTangencyWitness = await evaluate(ws, 'window.__kaminosOrbShellCompositionWitness?.enableApertureTangencyWitness?.()');
      await delay(500);
    }
    if (focus === 'macro-contact-map') {
      await evaluate(ws, 'window.__kaminosOrbShellCompositionWitness?.frameMacroContactMap?.()');
      macroContactMapWitness = await evaluate(ws, 'window.__kaminosOrbShellCompositionWitness?.enableMacroContactMapWitness?.()');
      await delay(500);
    }

    phase = 'state';
    const renderEffectPolicy = await readRenderEffectPolicy(ws, forcedAoState);
    assert.equal(renderEffectPolicy?.schema, 'OrbShellRenderEffectPolicy', 'render-effect policy missing from witness');
    if (forceAo !== null) {
      assert.equal(renderEffectPolicy?.ambientOcclusionEnabled, forceAo, 'forced AO state did not take effect');
    }
    const state = await evaluate(ws, 'window.__kaminosOrbShellCompositionWitness?.debugState?.()');
    assert.equal(state?.identity, 'orb-shell-macro-grammar-grounding-v0', 'wrong composition witness identity');
    assert.equal(state?.active, true, 'composition witness inactive');
    assert.equal(state?.baselineDisposition, 'coherent-but-wrong-model-baseline', 'v0 baseline disposition missing');
    assert.ok(state?.macroAssemblageCount >= 3 && state.macroAssemblageCount <= 5, 'composition must expose 3-5 macro assemblages');
    assert.equal(state?.MacroAssemblageCountLaw?.schema, 'MacroAssemblageCountLaw', 'MacroAssemblageCountLaw missing from debug state');
    assert.deepEqual(state?.selectedMacroAssemblageIds, state?.macroAssemblageIds, 'selected macro ids must match rendered macro ids');
    assert.ok(state?.selectedMacroAssemblageIds?.includes('north-west-dominant-thrust'), 'north-west anchor macro missing from selected ids');
    assert.ok(state?.selectedMacroAssemblageIds?.includes('north-east-counter-thrust'), 'north-east anchor macro missing from selected ids');
    assert.equal(state?.MacroInterlockGraph?.schema, 'MacroInterlockGraph', 'MacroInterlockGraph missing from debug state');
    assert.ok(Array.isArray(state?.MacroInterlockGraph?.activeRelations), 'MacroInterlockGraph active relations missing from debug state');
    assert.equal(state?.MacroContactMap?.schema, 'MacroContactMap', 'MacroContactMap missing from debug state');
    assert.equal(state?.macroContactCount, (state.macroAssemblageCount * (state.macroAssemblageCount - 1)) / 2, 'MacroContactMap must account for every unordered live macro pair');
    assert.ok(state?.MacroContactSample?.every(sample => sample?.schema === 'MacroContactSample'), 'MacroContactSample records missing from debug state');
    assert.ok(state?.macroClosestContactIds?.length >= 1, 'closest contact ids missing from debug state');
    assert.ok(state?.macroGeometryCoherenceWatchCount >= 1, 'geometry coherence watch must preserve diagnostic trust caveats');
    if (state?.selectedMacroAssemblageIds?.includes('lower-socket-keel')) {
      assert.equal(state?.LowerSocketKeelAnatomyLaw?.schema, 'LowerSocketKeelAnatomyLaw', 'selected lower socket must preserve anatomy law in witness state');
      assert.equal(state?.lowerSocketKeelAnatomyVerdict, 'procedural-lower-socket-anatomy-law-applied', 'selected lower socket must record applied anatomy-law verdict');
      if (state?.selectedMacroAssemblageIds?.includes('equatorial-cupping-whorl')) {
        assert.equal(state?.LowerSocketEquatorialSocketJointLaw?.schema, 'LowerSocketEquatorialSocketJointLaw', 'selected lower/equatorial pair must preserve shared socket joint law in witness state');
        assert.equal(state?.lowerSocketEquatorialSocketJointVerdict, 'shared-seam-law-applied', 'selected lower/equatorial pair must record shared seam-law verdict');
      }
    } else {
      assert.equal(state?.LowerSocketKeelAnatomyLaw, null, 'retired lower socket must not expose stale anatomy law');
      assert.equal(state?.LowerSocketEquatorialSocketJointLaw, null, 'retired lower socket must not expose stale lower/equatorial seam law');
    }
    if (focus === 'macro-contact-map') {
      assert.equal(macroContactMapWitness?.schema, 'MacroContactMapWitnessState', 'macro contact map witness did not activate');
      assert.equal(macroContactMapWitness?.visualOverlayMode, 'ranked-closest-contact-segments', 'macro contact map witness did not enable closest-contact overlay');
      assert.ok(macroContactMapWitness?.visibleOverlayIds?.length >= Math.min(3, state.macroClosestContactIds.length), 'macro contact map overlay meshes not visible');
    }
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
    assert.equal(state?.MacroFamilySubstripPlan?.schema, 'MacroFamilySubstripPlan', 'MacroFamilySubstripPlan missing from debug state');
    assert.equal(state?.MacroFamilySubstripPlan?.mode, 'parent-owned-lamellar-substrip-decomposition-v0', 'MacroFamilySubstripPlan mode missing from debug state');
    assert.ok(state?.macroFamilySubstripParentIds?.length >= 1, 'macro family substrip parent ids missing from debug state');
    assert.ok(state?.macroFamilySubstripCount >= 2, 'parent-owned substrips missing from debug state');
    assert.equal(state?.macroFamilySubstripMeshCount, state.macroFamilySubstripCount, 'rendered parent-owned substrip mesh count must match plan count');
    assert.equal(state?.macroFamilySubstripSideWallMeshCount, state.macroFamilySubstripCount * 2, 'rendered parent-owned substrip sidewall mesh count must match plan sidewalls');
    assert.equal(state?.macroFamilySubstripTerminalCapMeshCount, state.macroFamilySubstripCount * 2, 'rendered parent-owned substrip terminal cap mesh count must match plan terminal caps');
    assert.equal(state?.visibleParentRetirementPolicy?.schema, 'VisibleParentRetirementPolicy', 'visible parent retirement policy missing from debug state');
    assert.equal(state?.apertureRelativeTerminationPlan?.schema, 'ApertureRelativeTerminationPlan', 'aperture-relative termination plan missing from debug state');
    assert.equal(state?.apertureTerminationField?.schema, 'ApertureTerminationField', 'aperture termination field missing from debug state');
    assert.ok(state?.apertureTerminationClassCounts?.['orbit-capture'] >= 1, 'orbit-capture termination class missing from debug state');
    assert.ok(state?.apertureTerminationClassCounts?.['counter-curve-blade'] >= 1, 'counter-curve blade termination class missing from debug state');
    assert.equal(state?.apertureTangencyWitnessPlan?.schema, 'ApertureTangencyWitnessPlan', 'aperture tangency witness plan missing from debug state');
    assert.equal(state?.apertureTangencyWitnessPlan?.measuredApertureFieldId, state.apertureRelativeTerminationPlan.apertureField.id, 'aperture tangency witness must measure active termination field');
    assert.equal(state?.apertureTangencyMeasuredApertureSourceId, 'primary-front-teardrop-void', 'aperture tangency witness must measure visible blue aperture source');
    assert.equal(state?.apertureTangencySampleCount, state.macroFamilySubstripCount, 'aperture tangency sample count must match visible substrip count');
    assert.ok(state?.ApertureTangencySample?.every(sample => sample?.schema === 'ApertureTangencySample'), 'ApertureTangencySample records missing from debug state');
    assert.ok(state?.ApertureTangencySample?.every(sample => Number.isFinite(sample.tangentOrbitAlignment)), 'ApertureTangencySample alignment measurements missing');
    assert.ok(state?.apertureTangencyOverlayGeometryIds?.some(id => id.includes('terminal-tangent')), 'terminal tangent overlay ids missing');
    assert.ok(state?.apertureTangencyOverlayGeometryIds?.some(id => id.includes('aperture-orbit-tangent')), 'aperture orbit tangent overlay ids missing');
    if (focus === 'aperture-tangency') {
      assert.equal(apertureTangencyWitness?.schema, 'ApertureTangencyWitnessState', 'aperture tangency witness did not activate');
      assert.equal(apertureTangencyWitness?.visualOverlayMode, 'terminal-and-orbit-tangent-rays', 'aperture tangency witness did not enable vector overlay');
      assert.ok(apertureTangencyWitness?.visibleOverlayIds?.length >= state.apertureTangencySampleCount * 2, 'aperture tangency overlay meshes not visible');
    }
    assert.equal(state?.selectedParentPromotedBodyMeshCount, 0, 'selected parent promoted body slabs must be absent from normal render');
    assert.equal(state?.selectedParentSideWallMeshCount, 0, 'selected parent sidewalls must be absent from normal render');
    assert.equal(state?.selectedParentTerminalCapMeshCount, 0, 'selected parent terminal caps must be absent from normal render');
    assert.equal(state?.macroFamilyObjecthoodVerdict, 'parent-families-remain-nameable-after-subdivision', 'macro family objecthood verdict missing from debug state');
    assert.ok(state?.MacroFamilySubstrip?.every(strip => strip?.schema === 'MacroFamilySubstrip'), 'MacroFamilySubstrip records missing from debug state');
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
    assert.ok(state?.liveMacroSideWallMeshCount <= state.liveMacroSideWallCount, 'rendered live macro sidewall mesh count cannot exceed plan count');
    assert.equal(state?.liveMacroSideWallMeshIds?.length, state.liveMacroSideWallMeshCount, 'rendered live macro sidewall mesh ids must match rendered count');
    if (state?.selectedMacroAssemblageIds?.includes('lower-socket-keel') && state?.selectedMacroAssemblageIds?.includes('equatorial-cupping-whorl')) {
      assert.ok(state?.macroInterlockActiveRelationCount >= 1, 'five-macro lower/equatorial case must expose an active interlock relation');
      assert.ok(state?.macroInterlockAffectedMacroIds?.includes('lower-socket-keel'), 'interlock affected macro ids must include lower socket keel');
      assert.ok(state?.interlockAffectedSideWallCount >= 2, 'interlock affected lower socket sidewalls must be accounted in debug state');
    }
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
    if (state?.selectedMacroAssemblageIds?.includes('polar-crown-lock')) {
      assert.ok(state?.suppressedLegacyRoundBandIds?.includes('cr-cover'), 'covered legacy round band ids missing crown cover from debug state');
    }
    if (state?.selectedMacroAssemblageIds?.includes('equatorial-cupping-whorl')) {
      assert.equal(state?.lowerCupClosure?.mode, 'lower-cup-socket-contiguous', 'lower cup closure descriptor missing from debug state');
    } else {
      assert.ok(state?.retiredMacroAssemblageIds?.includes('equatorial-cupping-whorl'), 'retired equatorial macro must be named when lower cup closure is absent');
    }
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
    if (clipCanvas || focus === 'side-rim-clean-topology' || focus === 'live-terminal-caps' || focus === 'aperture-tangency') {
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
      compositionWitnessReadyState,
      requestedUiControls: shouldApplyUiControls ? requestedUiControls : null,
      appliedUiControls,
      phase,
      screenshot: { path: out, bytes: stats.bytes },
      visualStats: stats,
      macroAssemblageCount: state.macroAssemblageCount,
      MacroAssemblageCountLaw: state.MacroAssemblageCountLaw,
      macroAssemblageCountLaw: state.macroAssemblageCountLaw,
      macroAssemblageIds: state.macroAssemblageIds,
      selectedMacroAssemblageIds: state.selectedMacroAssemblageIds,
      retiredMacroAssemblageIds: state.retiredMacroAssemblageIds,
      MacroInterlockGraph: state.MacroInterlockGraph,
      macroInterlockGraph: state.macroInterlockGraph,
      macroInterlockActiveRelationCount: state.macroInterlockActiveRelationCount,
      macroInterlockAffectedMacroIds: state.macroInterlockAffectedMacroIds,
      LowerSocketEquatorialSocketJointLaw: state.LowerSocketEquatorialSocketJointLaw,
      lowerSocketEquatorialSocketJointLaw: state.lowerSocketEquatorialSocketJointLaw,
      lowerSocketEquatorialSocketJointVerdict: state.lowerSocketEquatorialSocketJointVerdict,
      MacroContactMap: state.MacroContactMap,
      macroContactMap: state.macroContactMap,
      MacroContactSample: state.MacroContactSample,
      macroContactCount: state.macroContactCount,
      macroClosestContactIds: state.macroClosestContactIds,
      macroGeometryCoherenceWatch: state.macroGeometryCoherenceWatch,
      macroGeometryCoherenceWatchCount: state.macroGeometryCoherenceWatchCount,
      LowerSocketKeelAnatomyLaw: state.LowerSocketKeelAnatomyLaw,
      lowerSocketKeelAnatomyLaw: state.lowerSocketKeelAnatomyLaw,
      lowerSocketKeelAnatomyVerdict: state.lowerSocketKeelAnatomyVerdict,
      macroContactMapWitness,
      MacroFamilySubstripPlan: state.MacroFamilySubstripPlan,
      macroFamilySubstripPlan: state.macroFamilySubstripPlan,
      MacroFamilySubstrip: state.MacroFamilySubstrip,
      macroFamilySubstripParentIds: state.macroFamilySubstripParentIds,
      macroFamilySubstripCount: state.macroFamilySubstripCount,
      macroFamilySubstripMeshCount: state.macroFamilySubstripMeshCount,
      macroFamilySubstripMeshIds: state.macroFamilySubstripMeshIds,
      macroFamilySubstripSideWallMeshCount: state.macroFamilySubstripSideWallMeshCount,
      macroFamilySubstripSideWallMeshIds: state.macroFamilySubstripSideWallMeshIds,
      macroFamilySubstripTerminalCapMeshCount: state.macroFamilySubstripTerminalCapMeshCount,
      macroFamilySubstripTerminalCapMeshIds: state.macroFamilySubstripTerminalCapMeshIds,
      macroFamilySubstripGapContracts: state.macroFamilySubstripGapContracts,
      visibleParentRetirementPolicy: state.visibleParentRetirementPolicy,
      apertureRelativeTerminationPlan: state.apertureRelativeTerminationPlan,
      apertureTerminationField: state.apertureTerminationField,
      apertureTerminationClassCounts: state.apertureTerminationClassCounts,
      ApertureTangencyWitnessPlan: state.ApertureTangencyWitnessPlan,
      apertureTangencyWitnessPlan: state.apertureTangencyWitnessPlan,
      ApertureTangencySample: state.ApertureTangencySample,
      apertureTangencySampleCount: state.apertureTangencySampleCount,
      apertureTangencyVerdictCounts: state.apertureTangencyVerdictCounts,
      apertureTangencyMeasuredApertureSourceId: state.apertureTangencyMeasuredApertureSourceId,
      apertureTangencyOverlayGeometryIds: state.apertureTangencyOverlayGeometryIds,
      apertureTangencyWitness,
      selectedParentPromotedBodyMeshCount: state.selectedParentPromotedBodyMeshCount,
      selectedParentPromotedBodyMeshIds: state.selectedParentPromotedBodyMeshIds,
      selectedParentSideWallMeshCount: state.selectedParentSideWallMeshCount,
      selectedParentSideWallMeshIds: state.selectedParentSideWallMeshIds,
      selectedParentTerminalCapMeshCount: state.selectedParentTerminalCapMeshCount,
      selectedParentTerminalCapMeshIds: state.selectedParentTerminalCapMeshIds,
      macroFamilyObjecthoodVerdict: state.macroFamilyObjecthoodVerdict,
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
      interlockAffectedSideWallCount: state.interlockAffectedSideWallCount,
      liveMacroSideWallVisibilityVerdict: state.liveMacroSideWallVisibilityVerdict,
      targetLiveMacroSideWallIds: state.targetLiveMacroSideWallIds,
      liveMacroTerminalCapCount: state.liveMacroTerminalCapCount,
      terminalCapClosureVerdict: state.terminalCapClosureVerdict,
      liveTerminalCapWitness,
      normalWitnessMaterialPolicy: state.normalWitnessMaterialPolicy,
      renderEffectPolicy,
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
      variationLeafCount: state.variationLeafCount,
      uiControlSource: state.uiControlSource,
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
