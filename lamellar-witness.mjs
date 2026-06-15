#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { inflateSync } from 'node:zlib';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);

const url = args.get('--url') || 'http://127.0.0.1:8095/?kaminos_lamellar_witness=1&lamellar_view=cap_profile&lamellar_cut_radius=0.04';
const out = resolve(args.get('--out') || '/tmp/kaminos-lamellar-witness.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const port = Number(args.get('--debug-port') || 9441);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-lamellar-witness-profile-${port}`;
const settleMs = Number(args.get('--settle-ms') || 1000);
const requested = new URL(url).searchParams;
const manualEnable = args.get('--manual-enable') === '1';

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

async function cdpFetch(path, options) {
  const resp = await fetch(`http://127.0.0.1:${port}${path}`, options);
  if (!resp.ok) throw new Error(`CDP ${path} failed ${resp.status}`);
  return resp.json();
}

async function waitForCdp() {
  for (let i = 0; i < 80; i++) {
    try {
      return await cdpFetch('/json/version');
    } catch {
      await delay(125);
    }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

function wsRequest(ws, method, params = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveReq, rejectReq) => {
    const onMessage = event => {
      const msg = JSON.parse(String(event.data));
      if (msg.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (msg.error) rejectReq(new Error(`${method}: ${msg.error.message}`));
      else resolveReq(msg.result);
    };
    ws.addEventListener('message', onMessage);
  });
}

function waitForWebSocketOpen(ws) {
  return new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
  });
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function unfilterPngRow(row, prev, filter, bytesPerPixel) {
  for (let i = 0; i < row.length; i++) {
    const left = i >= bytesPerPixel ? row[i - bytesPerPixel] : 0;
    const up = prev[i] || 0;
    const upLeft = i >= bytesPerPixel ? prev[i - bytesPerPixel] || 0 : 0;
    if (filter === 1) row[i] = (row[i] + left) & 255;
    else if (filter === 2) row[i] = (row[i] + up) & 255;
    else if (filter === 3) row[i] = (row[i] + Math.floor((left + up) / 2)) & 255;
    else if (filter === 4) row[i] = (row[i] + paethPredictor(left, up, upLeft)) & 255;
    else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}`);
  }
}

function pngVisualStats(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'blank frame or missing PNG output');
  let offset = 8;
  let ihdr = null;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') ihdr = data;
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  assert.ok(ihdr && idat.length, 'blank frame or missing PNG output');
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  assert.equal(bitDepth, 8, 'Lamellar witness only supports 8-bit PNG screenshots');
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  assert.ok(channels, `Lamellar witness unsupported PNG color type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  let rawOffset = 0;
  let prev = Buffer.alloc(stride);
  let minLuma = 255;
  let maxLuma = 0;
  let sampledPixels = 0;
  const buckets = new Set();
  for (let y = 0; y < height; y++) {
    const filter = raw[rawOffset++];
    const row = Buffer.from(raw.subarray(rawOffset, rawOffset + stride));
    rawOffset += stride;
    unfilterPngRow(row, prev, filter, channels);
    for (let x = 0; x < width; x += 8) {
      const i = x * channels;
      const r = row[i];
      const g = row[i + 1];
      const b = row[i + 2];
      const luma = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
      minLuma = Math.min(minLuma, luma);
      maxLuma = Math.max(maxLuma, luma);
      buckets.add(`${r >> 4}:${g >> 4}:${b >> 4}`);
      sampledPixels += 1;
    }
    prev = row;
  }
  return {
    width,
    height,
    sampledPixels,
    lumaRange: maxLuma - minLuma,
    colorBuckets: buckets.size,
  };
}

function assertVisualDiversity(buffer) {
  assert.ok(buffer.length > 10000, 'blank frame or missing PNG output');
  const stats = pngVisualStats(buffer);
  assert.ok(stats.width >= 640 && stats.height >= 480, 'blank frame or missing PNG output');
  assert.ok(stats.lumaRange >= 24, 'blank frame lacks luminance diversity');
  assert.ok(stats.colorBuckets >= 16, 'blank frame lacks color diversity');
  return stats;
}

async function main() {
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });
  const proc = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--window-size=1280,960',
    url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let stderr = '';
  proc.stderr.on('data', chunk => { stderr += chunk.toString(); });

  try {
    await waitForCdp();
    const pages = await cdpFetch('/json');
    const page = pages.find(p => p.type === 'page') || pages[0];
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    await wsRequest(ws, 'Runtime.enable');
    await wsRequest(ws, 'Page.enable');
    await wsRequest(ws, 'Page.bringToFront');
    await delay(settleMs);
    if (manualEnable) {
      await wsRequest(ws, 'Runtime.evaluate', {
        expression: `(() => {
          document.querySelector('[data-tab="lamellar"]')?.click();
          if (document.getElementById('lamellar-toggle')?.textContent !== 'Disable') {
            document.getElementById('lamellar-toggle')?.click();
          }
        })()`,
      });
      await delay(600);
    }

    const evalResult = await wsRequest(ws, 'Runtime.evaluate', {
      expression: `(() => {
        const w = window.__kaminosLamellarWitness;
        const preState = w ? w.debugState() : { active: false, missing: true };
        const firstStrip = (preState.sectionSegments || []).find(segment => segment.stripInstanceId);
        if (firstStrip) window.__kaminosLamellarSelectLayerByStripInstanceId?.(firstStrip.stripInstanceId);
        const layerState = w ? w.debugState() : preState;
        const layerPopover = document.getElementById('lamellar-selection-popover');
        const layerSelectionUi = {
          selectionLevel: layerState.selectionLevel,
          selectedLayerSpecId: layerState.selectedLayerSpecId,
          selectedStripInstanceId: layerState.selectedStripInstanceId,
          selectedPopulationId: layerState.selectedPopulationId,
          selectedObjectKind: layerState.selectedLamellarObject?.objectKind || '',
          selectedLayerStripIds: layerState.selectedLamellarObject?.stripIds || [],
          contextProfileDisplay: getComputedStyle(document.getElementById('lamellar-context-profile')).display,
          popoverTitle: document.getElementById('lamellar-popover-title')?.textContent || '',
          popoverDisplay: getComputedStyle(layerPopover).display,
          layerToolheadDisplay: getComputedStyle(document.getElementById('lamellar-layer-toolhead')).display,
          popoverLayerRadiusValue: Number(document.getElementById('lamellar-popover-layer-radius')?.value || 0),
          populationChipCount: document.querySelectorAll('#lamellar-popover-populations [data-population-id]').length,
        };
        const firstPopulationId = document.querySelector('#lamellar-popover-populations [data-population-id]')?.dataset.populationId || '';
        const beforePopulation = (layerState.stripPopulationDescriptors || []).find(population => population.id === firstPopulationId) || null;
        if (firstPopulationId) window.__kaminosLamellarSelectPopulationById?.(firstPopulationId);
        const selectedPopulationState = w ? w.debugState() : layerState;
        if (firstPopulationId) window.__kaminosLamellarNudgeSelectedPopulationCount?.(1);
        const afterCountState = w ? w.debugState() : selectedPopulationState;
        const flipButton = document.querySelector('#lamellar-popover-actions [data-action="population-flip-chirality"]');
        if (firstPopulationId && flipButton) flipButton.click();
        const afterFlipState = w ? w.debugState() : afterCountState;
        const afterFlipPopulation = (afterFlipState.stripPopulationDescriptors || []).find(population => population.id === firstPopulationId) || null;
        const afterFlipStrips = (afterFlipState.stripInstances || []).filter(strip => strip.populationId === firstPopulationId);
        const afterFlipDescriptors = (afterFlipState.generatedSegmentDescriptors || []).filter(descriptor => descriptor.populationId === firstPopulationId);
        const pinPopover = document.getElementById('lamellar-selection-popover');
        const beforePinnedRect = pinPopover?.getBoundingClientRect();
        const beforePinnedTransform = pinPopover?.style.transform || '';
        if (firstPopulationId) window.__kaminosLamellarPinSelectionPopover?.();
        if (firstPopulationId) window.__kaminosLamellarApplyPopulationOverride?.(firstPopulationId, { bearingVariance: 1.73, bearingOffset: -1.1 });
        const afterPinnedRect = pinPopover?.getBoundingClientRect();
        const afterPinnedTransform = pinPopover?.style.transform || '';
        const popoverPinnedDuringSliderReceipt = {
          mode: 'selected-population-toolhead-position-pinned-during-slider-v0',
          pinned: pinPopover?.dataset.popoverPinned === '1',
          beforeTransform: beforePinnedTransform,
          afterTransform: afterPinnedTransform,
          leftDelta: Number(((afterPinnedRect?.left || 0) - (beforePinnedRect?.left || 0)).toFixed(3)),
          topDelta: Number(((afterPinnedRect?.top || 0) - (beforePinnedRect?.top || 0)).toFixed(3)),
        };
        const sliderSweep = [];
        for (const bearingVariance of [0.15, 1, 2]) {
          if (firstPopulationId) window.__kaminosLamellarApplyPopulationOverride?.(firstPopulationId, { bearingVariance, bearingOffset: 0.23 });
          const sweepState = w ? w.debugState() : afterCountState;
          const sweepPopulation = (sweepState.stripPopulationDescriptors || []).find(population => population.id === firstPopulationId) || null;
          const sweepStrips = (sweepState.stripInstances || []).filter(strip => strip.populationId === firstPopulationId);
          sliderSweep.push({
            bearingVariance,
            coverageSpan: sweepPopulation?.coverageSpan ?? null,
            shellLaneSpacing: sweepPopulation?.shellLaneSpacing ?? null,
            laneOffsetRange: sweepStrips.length ? [
              Math.min(...sweepStrips.map(strip => strip.shellLaneOffset ?? 0)),
              Math.max(...sweepStrips.map(strip => strip.shellLaneOffset ?? 0)),
            ] : [],
          });
        }
        const radialSweep = [];
        for (const radialSpacing of [0, 0.04, 0.1]) {
          if (firstPopulationId) window.__kaminosLamellarApplyPopulationOverride?.(firstPopulationId, { radialSpacing });
          const radialState = w ? w.debugState() : afterCountState;
          const radialPopulation = (radialState.stripPopulationDescriptors || []).find(population => population.id === firstPopulationId) || null;
          const radialStrips = (radialState.stripInstances || []).filter(strip => strip.populationId === firstPopulationId);
          const radialDescriptors = (radialState.generatedSegmentDescriptors || []).filter(descriptor => descriptor.populationId === firstPopulationId);
          radialSweep.push({
            radialSpacing,
            populationRadialSpacing: radialPopulation?.radialSpacing ?? null,
            radialOffsetRange: radialStrips.length ? [
              Math.min(...radialStrips.map(strip => strip.radialOffset ?? 0)),
              Math.max(...radialStrips.map(strip => strip.radialOffset ?? 0)),
            ] : [],
            radiusRange: radialDescriptors.length ? [
              Math.min(...radialDescriptors.map(descriptor => descriptor.radius ?? 0)),
              Math.max(...radialDescriptors.map(descriptor => descriptor.radius ?? 0)),
            ] : [],
          });
        }
        const populationRadiusSweep = [];
        for (const radiusOffset of [-0.06, 0.09]) {
          if (firstPopulationId) window.__kaminosLamellarApplyPopulationOverride?.(firstPopulationId, { radiusOffset, radialSpacing: 0.04 });
          const radiusState = w ? w.debugState() : afterCountState;
          const radiusPopulation = (radiusState.stripPopulationDescriptors || []).find(population => population.id === firstPopulationId) || null;
          const radiusDescriptors = (radiusState.generatedSegmentDescriptors || []).filter(descriptor => descriptor.populationId === firstPopulationId);
          populationRadiusSweep.push({
            radiusOffset,
            populationRadiusOffset: radiusPopulation?.radiusOffset ?? null,
            descriptorRadiusAverage: radiusDescriptors.length
              ? Number((radiusDescriptors.reduce((sum, descriptor) => sum + (descriptor.radius ?? 0), 0) / radiusDescriptors.length).toFixed(4))
              : null,
            descriptorPopulationRadiusOffsets: Array.from(new Set(radiusDescriptors.map(descriptor => descriptor.populationRadiusOffset ?? null))),
          });
        }
        if (firstPopulationId) window.__kaminosLamellarApplyPopulationOverride?.(firstPopulationId, { bearingVariance: 1, bearingOffset: 0.23, radialSpacing: 0.07, radiusOffset: 0.05 });
        const populationState = w ? w.debugState() : afterCountState;
        const afterPopulation = (populationState.stripPopulationDescriptors || []).find(population => population.id === firstPopulationId) || null;
        const populationToolhead = document.getElementById('lamellar-population-toolhead');
        const populationToolheadUi = {
          selectionLevel: populationState.selectionLevel,
          selectedPopulationId: populationState.selectedPopulationId,
          selectedPopulationObject: populationState.selectedLamellarObject,
          populationChipCount: document.querySelectorAll('#lamellar-popover-populations [data-population-id]').length,
          actionLabels: Array.from(document.querySelectorAll('#lamellar-popover-actions .btn')).map(button => button.textContent.trim()),
          toolheadDisplay: populationToolhead ? getComputedStyle(populationToolhead).display : 'missing',
          popoverPinned: document.getElementById('lamellar-selection-popover')?.dataset.popoverPinned === '1',
          popoverTitle: document.getElementById('lamellar-popover-title')?.textContent || '',
          spreadValue: Number(document.getElementById('lamellar-population-bearing-spread')?.value || 0),
          offsetValue: Number(document.getElementById('lamellar-population-bearing-offset')?.value || 0),
          radialSpacingValue: Number(document.getElementById('lamellar-population-radial-spacing')?.value || 0),
          radiusOffsetValue: Number(document.getElementById('lamellar-population-radius-offset')?.value || 0),
        };
        const populationControlReceipt = {
          populationId: firstPopulationId,
          beforeCount: beforePopulation?.count ?? null,
          afterCount: afterPopulation?.count ?? null,
          beforeChirality: beforePopulation?.chirality ?? null,
          afterChirality: afterPopulation?.chirality ?? null,
          flipButtonClicked: Boolean(flipButton),
          afterFlipChirality: afterFlipPopulation?.chirality ?? null,
          afterFlipStripChiralities: Array.from(new Set(afterFlipStrips.map(strip => strip.chirality))),
          afterFlipThetaTwistSigns: Array.from(new Set(afterFlipDescriptors.map(descriptor => Math.sign(descriptor.thetaTwist || 0)))),
          afterBearingVariance: afterPopulation?.bearingVariance ?? null,
          afterBearingOffset: afterPopulation?.bearingOffset ?? null,
          afterRadialSpacing: afterPopulation?.radialSpacing ?? null,
          afterRadiusOffset: afterPopulation?.radiusOffset ?? null,
          layoutPreset: afterPopulation?.layoutPreset || null,
          coverageSpacing: afterPopulation?.coverageSpacing ?? null,
          coverageSpan: afterPopulation?.coverageSpan ?? null,
          shellLaneSpacing: afterPopulation?.shellLaneSpacing ?? null,
        };
        const populationRadialSpacingReceipt = {
          mode: 'selected-population-radial-shell-spacing-v0',
          populationId: firstPopulationId,
          samples: radialSweep,
        };
        const populationRadiusOffsetReceipt = {
          mode: 'selected-population-set-radius-offset-v0',
          populationId: firstPopulationId,
          samples: populationRadiusSweep,
        };
        const populationSliderSweepReceipt = {
          mode: 'selected-population-toolhead-slider-sweep-v0',
          populationId: firstPopulationId,
          samples: sliderSweep,
        };
        if (firstStrip) window.__kaminosLamellarSelectLayerByStripInstanceId?.(firstStrip.stripInstanceId);
        const layerRadiusBeforeState = w ? w.debugState() : populationState;
        const selectedLayerIndexForRadius = layerRadiusBeforeState.selectedLayerSpecId
          ? (layerRadiusBeforeState.layerSpecs || []).find(layer => layer.id === layerRadiusBeforeState.selectedLayerSpecId)?.layerIndex ?? 0
          : 0;
        const beforeLayerCurves = (layerRadiusBeforeState.sphereCurveDescriptors || []).filter(curve => curve.layerIndex === selectedLayerIndexForRadius);
        const selectedLayerRadiusEl = document.getElementById('lamellar-popover-layer-radius');
        if (selectedLayerRadiusEl) {
          selectedLayerRadiusEl.value = '0.11';
          selectedLayerRadiusEl.dispatchEvent(new Event('input', { bubbles: true }));
          selectedLayerRadiusEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const layerRadiusAfterState = w ? w.debugState() : layerRadiusBeforeState;
        const afterLayerCurves = (layerRadiusAfterState.sphereCurveDescriptors || []).filter(curve => curve.layerIndex === selectedLayerIndexForRadius);
        const afterLayerDescriptors = (layerRadiusAfterState.generatedSegmentDescriptors || []).filter(descriptor => descriptor.layerIndex === selectedLayerIndexForRadius);
        const radiusRange = values => values.length ? [
          Number(Math.min(...values).toFixed(4)),
          Number(Math.max(...values).toFixed(4)),
        ] : [];
        const selectedLayerRadiusReceipt = {
          mode: 'selected-layer-shell-radius-before-curve-mesh-derivation-v0',
          layerIndex: selectedLayerIndexForRadius,
          beforeCurveRadiusRange: radiusRange(beforeLayerCurves.map(curve => curve.radius ?? 0)),
          afterCurveRadiusRange: radiusRange(afterLayerCurves.map(curve => curve.radius ?? 0)),
          afterDescriptorRadiusRange: radiusRange(afterLayerDescriptors.map(descriptor => descriptor.radius ?? 0)),
          afterLayerSpecRadiusOffset: (layerRadiusAfterState.layerSpecs || []).find(layer => layer.layerIndex === selectedLayerIndexForRadius)?.radiusOffset ?? null,
          missingSourceCurveIds: afterLayerDescriptors.filter(descriptor => !descriptor.sourceCurveId).length,
        };
        if (firstStrip) window.__kaminosLamellarDrillIntoStrip?.(firstStrip.stripInstanceId);
        const state = w ? w.debugState() : preState;
        const activeLayerButton = document.querySelector('#lamellar-layer-selectors .btn.active');
        const popover = document.getElementById('lamellar-selection-popover');
        const popoverRect = popover?.getBoundingClientRect();
        const manualEnableUi = {
          mode: 'plain-load-tab-enable',
          activeTab: document.querySelector('.tab.active')?.dataset.tab || '',
          toggleText: document.getElementById('lamellar-toggle')?.textContent || '',
          cameraPosition: state.cameraPosition || [],
          cameraTarget: state.cameraTarget || [],
          childCount: state.childCount || 0,
        };
        return {
          ...state,
          manualEnableUi,
          layerSelectionUi,
          populationToolheadUi,
          selectedPopulationObject: populationToolheadUi.selectedPopulationObject,
          populationControlReceipt,
          populationSliderSweepReceipt,
          populationRadialSpacingReceipt,
          populationRadiusOffsetReceipt,
          selectedLayerRadiusReceipt,
          popoverPinnedDuringSliderReceipt,
          stripDrilldownUi: {
            selectionLevel: state.selectionLevel,
            selectedLayerSpecId: state.selectedLayerSpecId,
            selectedStripInstanceId: state.selectedStripInstanceId,
            selectedObjectKind: state.selectedLamellarObject?.objectKind || '',
            contextProfileDisplay: getComputedStyle(document.getElementById('lamellar-context-profile')).display,
          },
          selectionPopoverUi: {
            display: popover ? getComputedStyle(popover).display : 'missing',
            title: document.getElementById('lamellar-popover-title')?.textContent || '',
            meta: document.getElementById('lamellar-popover-meta')?.textContent || '',
            actionCount: document.querySelectorAll('#lamellar-popover-actions .btn').length,
            actionLabels: Array.from(document.querySelectorAll('#lamellar-popover-actions .btn')).map(button => button.textContent.trim()),
            popoverPinned: popover?.dataset.popoverPinned === '1',
            left: Number(popoverRect?.left?.toFixed(1) || 0),
            top: Number(popoverRect?.top?.toFixed(1) || 0),
          },
          selectedLayerUi: {
            activeLayer: Number(activeLayerButton?.dataset.layer ?? -1),
            layerDetailDisplay: getComputedStyle(document.getElementById('lamellar-layer-detail')).display,
            layerSelectorsDisplay: getComputedStyle(document.getElementById('lamellar-layer-selectors')).display,
            selectedRadiusDisplay: getComputedStyle(document.getElementById('lamellar-selected-layer-radius')).display,
            selectedLayerText: document.getElementById('lamellar-selected-layer-index')?.textContent || '',
            selectedStripCount: Number(document.getElementById('lamellar-selected-layer-strip-count')?.value || 0),
            selectedRadius: Number(document.getElementById('lamellar-selected-layer-radius')?.value || 0),
            selectedStripReadout: document.getElementById('lamellar-selected-layer-strips')?.textContent || '',
            selectedStripIds: Array.from(document.querySelectorAll('#lamellar-selected-layer-strips [data-strip-id]')).map(el => el.dataset.stripId),
          },
          selectedStripUi: {
            selectedStripText: document.getElementById('lamellar-selected-strip-index')?.textContent || '',
            selectedStripIndex: Number(state.selectedLamellarObject?.stripIndex ?? 0),
            width: Number(document.getElementById('lamellar-selected-strip-width')?.value || 0),
            thickness: Number(document.getElementById('lamellar-selected-strip-thickness')?.value || 0),
            widthVariance: Number(document.getElementById('lamellar-selected-strip-width-variance')?.value || 0),
            thicknessVariance: Number(document.getElementById('lamellar-selected-strip-thickness-variance')?.value || 0),
            gapPattern: document.getElementById('lamellar-selected-strip-gap-pattern')?.value || '',
          },
          selectionUi: {
            kind: document.getElementById('lamellar-selected-object-kind')?.textContent || '',
            objectId: document.getElementById('lamellar-selected-object-id')?.textContent || '',
            role: document.getElementById('lamellar-selected-object-role')?.textContent || '',
            contextProfileDisplay: getComputedStyle(document.getElementById('lamellar-context-profile')).display,
          },
        };
      })()`,
      returnByValue: true,
    });
    const state = evalResult.result.value;
    assert.equal(state.effectiveRoute, 'sphere-domain-section-segment-witness-v0', 'effective Lamellar route mismatch');
    assert.equal(state.witnessIdentity, 'kaminos-lamellar-witness-v0', 'Lamellar witness identity mismatch');
    assert.ok(state.active, 'Lamellar witness route was not active');
    if (manualEnable) {
      assert.equal(state.manualEnableUi?.activeTab, 'lamellar', 'manual Enable witness did not activate the Lamellar tab');
      assert.equal(state.manualEnableUi?.toggleText, 'Disable', 'manual Enable witness did not activate the Lamellar toggle');
      assert.ok((state.manualEnableUi?.childCount || 0) > 0, 'manual Enable built no Lamellar children');
      assert.notDeepEqual(state.manualEnableUi?.cameraPosition, [0, 0.6, 3], 'manual Enable from untouched camera stayed on the blank default view');
    }
    assert.ok((state.sectionSegments || []).length >= 3, 'Lamellar witness did not build section segments');
    assert.ok((state.segmentDescriptorCount || 0) >= 3, 'Lamellar witness did not export generated section descriptors');
    assert.ok(state.composerDescriptor?.mode, 'Lamellar witness did not export composer descriptor');
    assert.ok(state.layerStackDescriptor?.mode, 'Lamellar witness did not export layer-stack descriptor');
    assert.ok((state.layerSpecs || []).length >= 1, 'Lamellar witness did not export per-layer specs');
    assert.ok((state.stripInstances || []).length > (state.layerSpecs || []).length, 'Lamellar witness did not export layer-owned strip assemblages');
    assert.ok((state.sphereCurveDescriptors || []).length >= (state.stripInstances || []).length, 'Lamellar witness did not export sphere-curve descriptors before mesh descriptors');
    assert.ok((state.lamellarEnvelopeDescriptors || []).length >= 1, 'Lamellar witness did not export curve-family envelope descriptors');
    assert.equal(state.lamellarEnvelopeDescriptors?.[0]?.mode, 'curve-family-envelope-loft-v0', 'Lamellar envelope descriptor did not use the curve-family loft mode');
    assert.ok((state.lamellarEnvelopeDescriptors?.[0]?.sourceCurveIds || []).length >= 3, 'Lamellar envelope descriptor did not preserve source curve ancestry');
    assert.ok((state.sectionSegments || []).some(segment => segment.kind === 'LamellarEnvelopeDescriptor'), 'Lamellar witness did not emit an envelope body section segment');
    assert.equal(state.curveInteractionReceipt?.mode, 'sphere-curve-proximity-interaction-v0', 'Lamellar witness did not export curve interaction receipt');
    assert.ok(
      (state.generatedSegmentDescriptors || []).every(descriptor => descriptor.sourceCurveId),
      'Lamellar generated segment descriptors did not cite source sphere curves'
    );
    assert.ok(state.sliceToolDescriptor?.mode, 'Lamellar witness did not export slice tool descriptor');
    assert.ok(state.sliceApplicationReceipt?.mode, 'Lamellar witness did not export slice application receipt');
    assert.ok(state.cutAuthorEnvelopeDescriptor?.mode, 'Lamellar witness did not export cut-author envelope descriptor');
    assert.equal(state.channelCutReceipt?.mode, 'neighbor-offset-envelope-terminal-channel-cut', 'Lamellar witness did not export neighbor envelope channel-cut receipt');
    assert.equal(state.selectedLayerUi?.activeLayer, 0, 'Lamellar witness did not expose selected layer UI');
    assert.notEqual(state.selectedLayerUi?.layerDetailDisplay, 'none', 'Lamellar selected-layer authoring panel is hidden in the sidebar');
    assert.notEqual(state.selectedLayerUi?.layerSelectorsDisplay, 'none', 'Lamellar layer selectors are hidden in the sidebar');
    assert.notEqual(state.selectedLayerUi?.selectedRadiusDisplay, 'none', 'Lamellar selected-layer radius slider is hidden in the sidebar');
    assert.ok((state.selectedLayerUi?.selectedStripIds || []).length >= 1, 'Lamellar selected-layer UI did not render strip ids');
    assert.equal(state.selectedLayerRadiusReceipt?.mode, 'selected-layer-shell-radius-before-curve-mesh-derivation-v0', 'Lamellar witness did not record selected-layer radius mutation');
    assert.equal(state.selectedLayerRadiusReceipt?.afterLayerSpecRadiusOffset, 0.11, 'Lamellar selected-layer radius control did not mutate layer shell radius');
    assert.equal(state.selectedLayerRadiusReceipt?.missingSourceCurveIds, 0, 'Lamellar selected-layer radius descriptors lost source curve ancestry');
    assert.ok(
      (state.selectedLayerRadiusReceipt?.afterCurveRadiusRange?.[0] || 0) > (state.selectedLayerRadiusReceipt?.beforeCurveRadiusRange?.[0] || 0),
      'Lamellar selected-layer radius did not shift source sphere curve radii'
    );
    assert.deepEqual(
      state.selectedLayerRadiusReceipt?.afterDescriptorRadiusRange,
      state.selectedLayerRadiusReceipt?.afterCurveRadiusRange,
      'Lamellar selected-layer radius descriptors were not re-derived from shifted source curves'
    );
    assert.equal(state.layerSelectionUi?.selectionLevel, 'layer', 'Lamellar single-click selection did not select the layer first');
    assert.ok((state.layerSelectionUi?.selectedLayerStripIds || []).length >= 1, 'Lamellar layer selection did not carry same-shell strip ids');
    assert.equal(state.layerSelectionUi?.selectedStripInstanceId, null, 'Lamellar layer selection should not immediately select a strip');
    assert.equal(state.layerSelectionUi?.contextProfileDisplay, 'none', 'Lamellar strip profile controls should stay hidden for layer selection');
    assert.notEqual(state.layerSelectionUi?.layerToolheadDisplay, 'none', 'Lamellar layer selection did not expose the popup layer toolhead');
    assert.ok((state.layerSelectionUi?.populationChipCount || 0) >= 1, 'Lamellar layer toolhead did not render population chips');
    assert.equal(state.populationToolheadUi?.selectionLevel, 'population', 'Lamellar population chip did not select population level');
    assert.ok(state.populationToolheadUi?.selectedPopulationId, 'Lamellar population selection did not carry a population id');
    assert.notEqual(state.populationToolheadUi?.toolheadDisplay, 'none', 'Lamellar population toolhead controls did not render');
    assert.ok((state.populationToolheadUi?.actionLabels || []).includes('Add strip'), 'Lamellar population toolhead did not expose readable Add strip label');
    assert.ok((state.populationToolheadUi?.actionLabels || []).includes('Remove strip'), 'Lamellar population toolhead did not expose readable Remove strip label');
    assert.ok((state.populationToolheadUi?.actionLabels || []).includes('Flip chirality'), 'Lamellar population toolhead did not expose readable Flip chirality label');
    assert.ok((state.selectedPopulationObject?.populationStripIds || []).length >= 1, 'Lamellar selected population did not carry strip ids');
    assert.equal(state.popoverPinnedDuringSliderReceipt?.pinned, true, 'Lamellar population slider manipulation did not pin the floating toolhead');
    assert.ok(Math.abs(state.popoverPinnedDuringSliderReceipt?.leftDelta || 0) < 0.75, 'Lamellar floating toolhead moved horizontally while a slider manipulated geometry');
    assert.ok(Math.abs(state.popoverPinnedDuringSliderReceipt?.topDelta || 0) < 0.75, 'Lamellar floating toolhead moved vertically while a slider manipulated geometry');
    assert.equal(
      state.populationControlReceipt?.afterCount,
      (state.populationControlReceipt?.beforeCount || 0) + 1,
      'Lamellar population count control did not mutate selected population count'
    );
    assert.equal(
      state.populationControlReceipt?.afterChirality,
      -(state.populationControlReceipt?.beforeChirality || 1),
      'Lamellar population chirality control did not mutate selected population chirality'
    );
    assert.equal(state.populationControlReceipt?.flipButtonClicked, true, 'Lamellar population chirality witness did not click the visible Flip chirality button');
    assert.equal(
      state.populationControlReceipt?.afterFlipChirality,
      -(state.populationControlReceipt?.beforeChirality || 1),
      'Lamellar visible Flip chirality button did not mutate population chirality'
    );
    assert.deepEqual(
      state.populationControlReceipt?.afterFlipStripChiralities,
      [state.populationControlReceipt?.afterFlipChirality],
      'Lamellar visible Flip chirality button did not propagate chirality to strip instances'
    );
    assert.deepEqual(
      state.populationControlReceipt?.afterFlipThetaTwistSigns,
      [state.populationControlReceipt?.afterFlipChirality],
      'Lamellar visible Flip chirality button did not change emitted curve twist direction'
    );
    assert.equal(state.populationControlReceipt?.afterBearingVariance, 1, 'Lamellar population spread control did not mutate bearing variance');
    assert.equal(state.populationControlReceipt?.afterBearingOffset, 0.23, 'Lamellar population rotate control did not mutate bearing offset');
    assert.equal(state.populationControlReceipt?.afterRadialSpacing, 0.07, 'Lamellar population radius control did not mutate radial spacing');
    assert.equal(state.populationControlReceipt?.afterRadiusOffset, 0.05, 'Lamellar population set radius control did not mutate selected population radius offset');
    assert.equal(state.populationControlReceipt?.layoutPreset, 'coverage', 'Lamellar selected population did not preserve coverage layout');
    assert.ok((state.populationControlReceipt?.coverageSpacing || 0) > 0.6, 'Lamellar selected population did not preserve useful coverage spacing');
    assert.ok((state.populationControlReceipt?.coverageSpan || 0) >= 0.66, 'Lamellar selected population did not preserve visible shell coverage span');
    assert.equal(state.populationSliderSweepReceipt?.samples?.length, 3, 'Lamellar population witness did not sweep spread endpoints and midpoint');
    assert.ok(
      state.populationSliderSweepReceipt.samples[2].coverageSpan > state.populationSliderSweepReceipt.samples[0].coverageSpan,
      'Lamellar spread slider sweep did not increase visible coverage span'
    );
    assert.equal(state.populationRadialSpacingReceipt?.samples?.length, 3, 'Lamellar population witness did not sweep radial spacing');
    assert.ok(
      state.populationRadialSpacingReceipt.samples[2].radiusRange[1] - state.populationRadialSpacingReceipt.samples[2].radiusRange[0]
        > state.populationRadialSpacingReceipt.samples[0].radiusRange[1] - state.populationRadialSpacingReceipt.samples[0].radiusRange[0],
      'Lamellar radial spacing sweep did not increase emitted radius separation'
    );
    assert.equal(state.populationRadiusOffsetReceipt?.samples?.length, 2, 'Lamellar population witness did not sweep set radius offset');
    assert.ok(
      state.populationRadiusOffsetReceipt.samples[1].descriptorRadiusAverage - state.populationRadiusOffsetReceipt.samples[0].descriptorRadiusAverage > 0.12,
      'Lamellar set radius offset sweep did not move the selected population as a coherent radial band'
    );
    assert.deepEqual(
      state.populationRadiusOffsetReceipt.samples[1].descriptorPopulationRadiusOffsets,
      [state.populationRadiusOffsetReceipt.samples[1].radiusOffset],
      'Lamellar set radius offset did not reach emitted descriptors'
    );
    assert.equal(state.stripDrilldownUi?.selectionLevel, 'strip', 'Lamellar drilldown did not select a strip');
    assert.ok(state.stripDrilldownUi?.selectedStripInstanceId, 'Lamellar strip drilldown did not carry a strip instance id');
    assert.notEqual(state.stripDrilldownUi?.contextProfileDisplay, 'none', 'Lamellar strip profile controls did not appear after strip drilldown');
    assert.notEqual(state.selectionPopoverUi?.display, 'none', 'Lamellar selection popover did not render');
    assert.ok(state.selectionPopoverUi?.title, 'Lamellar selection popover did not carry a title');
    assert.ok((state.selectionPopoverUi?.actionCount || 0) >= 1, 'Lamellar selection popover did not carry contextual actions');
    assert.ok(state.selectedStripUi?.selectedStripText, 'Lamellar witness did not expose selected strip UI');
    assert.ok((state.selectedStripUi?.width || 0) > 0, 'Lamellar selected-strip width control did not carry a positive value');
    assert.ok(state.selectedLamellarObject?.stripInstanceId, 'Lamellar witness did not select a viewport/context object');
    assert.notEqual(state.selectionUi?.kind, 'none', 'Lamellar context inspector did not reflect selected object kind');
    assert.notEqual(state.selectionUi?.contextProfileDisplay, 'none', 'Lamellar context inspector did not reveal profile controls for selected strip');
    assert.ok((state.stripProfileDescriptors || []).length >= (state.stripInstances || []).length, 'Lamellar witness did not export strip profile descriptors');
    assert.ok((state.stripPopulationDescriptors || []).some(population => population.role === 'cutter'), 'Lamellar witness did not export cutter population descriptors');
    assert.ok((state.lightHookCount || 0) >= 2, 'Lamellar witness did not export light hooks');

    if (state.populationControlReceipt?.populationId) {
      await wsRequest(ws, 'Runtime.evaluate', {
        expression: `window.__kaminosLamellarSelectPopulationById?.(${JSON.stringify(state.populationControlReceipt.populationId)})`,
      });
      await delay(250);
    }
    const screenshot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
    const buffer = Buffer.from(screenshot.data, 'base64');
    writeFileSync(out, buffer);
    const visualStats = assertVisualDiversity(buffer);

    const report = {
      schema: 'kaminos.lamellar-witness.v0',
      requestedUrl: url,
      requestedView: requested.get('lamellar_view') || 'cap_profile',
      effectiveView: state.effectiveView,
      requestedCutRadius: requested.get('lamellar_cut_radius') || null,
      effectiveCutRadius: state.cutRadius,
      effectiveRoute: state.effectiveRoute,
      witnessIdentity: state.witnessIdentity,
      capTValues: state.capTValues,
      openEdgeCount: state.openEdgeCount,
      cuttingEdgeDescriptor: state.cuttingEdgeDescriptor,
      composerDescriptor: state.composerDescriptor,
      layerStackDescriptor: state.layerStackDescriptor,
      layerSpecs: state.layerSpecs,
      stripInstances: state.stripInstances,
      sphereCurveDescriptors: state.sphereCurveDescriptors,
      lamellarEnvelopeDescriptors: state.lamellarEnvelopeDescriptors,
      curveInteractionReceipt: state.curveInteractionReceipt,
      selectedLayerUi: state.selectedLayerUi,
      selectedStripUi: state.selectedStripUi,
      manualEnableUi: state.manualEnableUi,
      layerSelectionUi: state.layerSelectionUi,
      populationToolheadUi: state.populationToolheadUi,
      selectedPopulationObject: state.selectedPopulationObject,
      populationControlReceipt: state.populationControlReceipt,
      populationSliderSweepReceipt: state.populationSliderSweepReceipt,
      populationRadialSpacingReceipt: state.populationRadialSpacingReceipt,
      populationRadiusOffsetReceipt: state.populationRadiusOffsetReceipt,
      selectedLayerRadiusReceipt: state.selectedLayerRadiusReceipt,
      popoverPinnedDuringSliderReceipt: state.popoverPinnedDuringSliderReceipt,
      stripDrilldownUi: state.stripDrilldownUi,
      selectionPopoverUi: state.selectionPopoverUi,
      selectionUi: state.selectionUi,
      selectedLamellarObject: state.selectedLamellarObject,
      viewportPickReceipt: state.viewportPickReceipt,
      stripProfileOverrides: state.stripProfileOverrides,
      stripProfileDescriptors: state.stripProfileDescriptors,
      stripPopulationDescriptors: state.stripPopulationDescriptors,
      layerOverrides: state.layerOverrides,
      sliceToolDescriptor: state.sliceToolDescriptor,
      sliceApplicationReceipt: state.sliceApplicationReceipt,
      cutAuthorEnvelopeDescriptor: state.cutAuthorEnvelopeDescriptor,
      channelCutReceipt: state.channelCutReceipt,
      segmentDescriptorCount: state.segmentDescriptorCount,
      generatedSegmentDescriptors: state.generatedSegmentDescriptors,
      lightHookCount: state.lightHookCount,
      sectionSegments: state.sectionSegments,
      screenshot: out,
      visualStats,
      stderrTail: stderr.slice(-2000),
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    ws.close();
  } finally {
    proc.kill('SIGTERM');
  }
}

main().catch(err => {
  writeFileSync(reportPath, JSON.stringify({
    schema: 'kaminos.lamellar-witness.v0',
    requestedUrl: url,
    failurePhase: 'lamellar-witness',
    error: String(err.stack || err),
  }, null, 2) + '\n');
  console.error(err);
  process.exit(1);
});
