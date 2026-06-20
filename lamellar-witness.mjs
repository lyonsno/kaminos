#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
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
const cdpTimeoutMs = Number(args.get('--cdp-timeout-ms') || 15000);
const requested = new URL(url).searchParams;
const manualEnable = args.get('--manual-enable') === '1';
const recipeSmoke = args.get('--recipe-smoke') === '1' || requested.get('recipe_smoke') === '1';
const recipeComparisonSmoke = args.get('--recipe-comparison-smoke') === '1' || requested.get('recipe_comparison_smoke') === '1';
const multiEnvelopeSmoke = requested.get('multi_envelope_smoke') === '1';
const authoringRoundTripSmoke = requested.get('authoring_roundtrip_smoke') === '1';
const authoringSlotSmoke = requested.get('authoring_slot_smoke') === '1';
let requestPhase = 'startup';

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
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      rejectReq(new Error(`${method} timed out after ${cdpTimeoutMs}ms during ${requestPhase}`));
    }, cdpTimeoutMs);
    const onMessage = event => {
      const msg = JSON.parse(String(event.data));
      if (msg.id !== id) return;
      ws.removeEventListener('message', onMessage);
      clearTimeout(timer);
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

async function captureScreenshotWithFallback(ws, phaseBase) {
  requestPhase = `${phaseBase}-screenshot`;
  try {
    const screenshot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
    return {
      data: screenshot.data,
      screenshotFallbackReceipt: {
        mode: 'chrome-screenshot-fallback-v0',
        captureRoute: 'fromSurface',
        fallbackUsed: false,
        primaryPhase: requestPhase,
        primaryError: null,
      },
    };
  } catch (err) {
    const primaryPhase = requestPhase;
    const primaryError = String(err.stack || err);
    requestPhase = `${phaseBase}-screenshot-fallback`;
    try {
      const screenshot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: false });
      return {
        data: screenshot.data,
        screenshotFallbackReceipt: {
          mode: 'chrome-screenshot-fallback-v0',
          captureRoute: 'view',
          fallbackUsed: true,
          primaryPhase,
          primaryError,
          fallbackPhase: requestPhase,
          fallbackError: null,
        },
      };
    } catch (fallbackErr) {
      const fallbackPhase = requestPhase;
      const fallbackError = String(fallbackErr.stack || fallbackErr);
      requestPhase = `${phaseBase}-screenshot-mac-activate`;
      const activate = spawnSync('/usr/bin/osascript', ['-e', 'tell application "Google Chrome" to activate'], { encoding: 'utf8' });
      await delay(350);
      requestPhase = `${phaseBase}-screenshot-mac-screencapture`;
      const capture = spawnSync('/usr/sbin/screencapture', ['-x', out], { encoding: 'utf8' });
      if (capture.status !== 0) {
        throw new Error(`mac-screencapture-display failed after CDP screenshot routes; primary=${primaryError}; fallback=${fallbackError}; activateStatus=${activate.status}; activateStderr=${activate.stderr || ''}; stderr=${capture.stderr || ''}`);
      }
      return {
        data: readFileSync(out).toString('base64'),
        screenshotFallbackReceipt: {
          mode: 'chrome-screenshot-fallback-v0',
          captureRoute: 'mac-screencapture-display',
          fallbackUsed: true,
          primaryPhase,
          primaryError,
          fallbackPhase,
          fallbackError,
          macActivatePhase: `${phaseBase}-screenshot-mac-activate`,
          macActivateStatus: activate.status,
          macActivateStderr: activate.stderr || null,
          macPhase: requestPhase,
        },
      };
    }
  }
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
    requestPhase = 'websocket-open';
    await waitForWebSocketOpen(ws);
    requestPhase = 'runtime-enable';
    await wsRequest(ws, 'Runtime.enable');
    requestPhase = 'page-enable';
    await wsRequest(ws, 'Page.enable');
    requestPhase = 'page-bring-to-front';
    await wsRequest(ws, 'Page.bringToFront');
    requestPhase = 'settle';
    await delay(settleMs);
    if (manualEnable) {
      requestPhase = 'manual-enable';
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

    if (recipeComparisonSmoke) {
      requestPhase = 'recipe-comparison-smoke-evaluate';
      const comparisonResult = await wsRequest(ws, 'Runtime.evaluate', {
        expression: `(async () => {
          const recipes = Array.from(document.querySelectorAll('#lamellar-shell-recipe option'))
            .map(option => option.value)
            .filter(recipe => recipe && recipe !== 'custom');
          const settleFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const recipeQualityReceipts = [];
          const cards = [];
          for (const recipe of recipes) {
            const applied = window.__kaminosLamellarApplyShellRecipe?.(recipe);
            await settleFrame();
            const w = window.__kaminosLamellarWitness;
            const state = w ? w.debugState() : { active: false, missing: true };
            const grammar = window.__kaminosLamellarDescribeShellRecipeGrammar?.(recipe) || state.composerDescriptor?.recipeGrammar || null;
            const quality = window.__kaminosLamellarEvaluateShellRecipeQuality?.(recipe, state)
              || state.composerDescriptor?.recipeQualityReceipt
              || null;
            const populations = (state.stripPopulationDescriptors || []).filter(population => population.recipe === recipe);
            const receipt = {
              mode: 'shell-recipe-comparison-entry-v0',
              recipe,
              appliedRecipe: applied?.shellRecipe || null,
              composerRecipe: state.composerDescriptor?.shellRecipe || null,
              grammarMode: grammar?.mode || null,
              qualityStatus: quality?.status || 'missing',
              degradedReasons: quality?.degradedReasons || [],
              orientationFamilies: grammar?.orientationFamilies || [],
              primaryFamilies: grammar?.visibilityPriority?.primaryFamilies || [],
              populationRoles: populations.map(population => population.recipeRole).filter(Boolean),
              populationOrientations: [...new Set(populations.map(population => population.orientationFamily).filter(Boolean))],
              populationCount: populations.length,
              envelopeCount: (state.lamellarEnvelopeDescriptors || []).filter(envelope => populations.some(population => population.id === envelope.populationId)).length,
              segmentCount: (state.generatedSegmentDescriptors || state.sectionSegments || []).length,
              budgetMeasured: quality?.measured || null,
              budgets: quality?.budgets || null,
            };
            recipeQualityReceipts.push({ ...receipt, qualityReceipt: quality, grammar });
            cards.push(receipt);
          }
          const lastRecipe = recipes.includes('diagonal-cage') ? 'diagonal-cage' : recipes[0];
          if (lastRecipe) {
            window.__kaminosLamellarApplyShellRecipe?.(lastRecipe);
            await settleFrame();
            window.__kaminosLamellarWitness?.frameCamera?.();
          }
          let overlay = document.getElementById('lamellar-recipe-comparison-overlay');
          if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'lamellar-recipe-comparison-overlay';
            document.getElementById('viewport')?.appendChild(overlay);
          }
          overlay.style.cssText = [
            'position:absolute',
            'right:18px',
            'top:18px',
            'z-index:20',
            'width:360px',
            'max-width:calc(100% - 36px)',
            'padding:12px',
            'border:1px solid rgba(255,255,255,0.16)',
            'border-radius:8px',
            'background:rgba(8,8,8,0.72)',
            'backdrop-filter:blur(10px)',
            'box-shadow:0 12px 32px rgba(0,0,0,0.38)',
            'font:11px SFMono-Regular,Menlo,Consolas,monospace',
            'color:#d7d7d7'
          ].join(';');
          overlay.innerHTML = '<div style="font:700 13px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#fff;margin-bottom:8px">Lamellar Recipe Comparison</div>'
            + cards.map(card => {
              const ok = card.qualityStatus === 'pass';
              const families = card.populationOrientations.slice(0, 3).join(' / ') || 'none';
              return '<div style="display:grid;grid-template-columns:104px 1fr 44px;gap:7px;align-items:center;border-top:1px solid rgba(255,255,255,0.08);padding:7px 0">'
                + '<span style="color:#fff;font-weight:700">' + card.recipe + '</span>'
                + '<span style="color:#aaa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + families + ' · p' + card.populationCount + ' e' + card.envelopeCount + ' s' + card.segmentCount + '</span>'
                + '<span style="justify-self:end;color:' + (ok ? '#86d394' : '#f0b05d') + '">' + card.qualityStatus + '</span>'
                + '</div>';
            }).join('');
          const state = window.__kaminosLamellarWitness?.debugState?.() || {};
          return {
            ...state,
            recipeComparisonReceipt: {
              mode: 'locked-shell-recipe-comparison-smoke-v0',
              grammarMode: 'constrained-shell-recipe-grammar-v0',
              comparedRecipes: recipes,
              displayedRecipe: lastRecipe,
              recipeQualityReceipts,
              passCount: recipeQualityReceipts.filter(entry => entry.qualityStatus === 'pass').length,
              degradedCount: recipeQualityReceipts.filter(entry => entry.qualityStatus !== 'pass').length,
            },
          };
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      const state = comparisonResult.result.value;
      assert.equal(state.effectiveRoute, 'sphere-domain-section-segment-witness-v0', 'effective Lamellar route mismatch');
      assert.equal(state.witnessIdentity, 'kaminos-lamellar-witness-v0', 'Lamellar witness identity mismatch');
      assert.ok(state.active, 'Lamellar comparison route was not active');
      assert.ok((state.recipeComparisonReceipt?.comparedRecipes || []).length >= 5, 'Lamellar comparison smoke did not compare all shell recipes');
      assert.equal(state.recipeComparisonReceipt?.grammarMode, 'constrained-shell-recipe-grammar-v0', 'Lamellar comparison smoke did not record constrained grammar mode');
      assert.ok((state.recipeComparisonReceipt?.recipeQualityReceipts || []).every(entry => entry.qualityStatus === 'pass'), 'Lamellar comparison smoke found a degraded shell recipe');
      assert.ok((state.recipeComparisonReceipt?.recipeQualityReceipts || []).every(entry => (entry.populationOrientations || []).length >= 1), 'Lamellar comparison smoke found a recipe without orientation families');
      const { data: screenshotData, screenshotFallbackReceipt } = await captureScreenshotWithFallback(ws, 'recipe-comparison-smoke');
      const buffer = Buffer.from(screenshotData, 'base64');
      writeFileSync(out, buffer);
      const visualStats = assertVisualDiversity(buffer);
      const report = {
        schema: 'kaminos.lamellar-witness.v0',
        mode: 'locked-shell-recipe-comparison-smoke-v0',
        requestedUrl: url,
        requestPhase,
        cdpTimeoutMs,
        requestedView: requested.get('lamellar_view') || 'cap_profile',
        effectiveView: state.effectiveView,
        effectiveRoute: state.effectiveRoute,
        witnessIdentity: state.witnessIdentity,
        composerDescriptor: state.composerDescriptor,
        recipeComparisonReceipt: state.recipeComparisonReceipt,
        recipeQualityReceipts: state.recipeComparisonReceipt.recipeQualityReceipts,
        stripPopulationDescriptors: state.stripPopulationDescriptors,
        lamellarEnvelopeDescriptors: state.lamellarEnvelopeDescriptors,
        segmentDescriptorCount: state.segmentDescriptorCount,
        screenshotFallbackReceipt,
        screenshot: out,
        visualStats,
        stderrTail: stderr.slice(-2000),
      };
      writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
      ws.close();
      return;
    }

    if (recipeSmoke) {
      requestPhase = 'recipe-smoke-evaluate';
      const recipeResult = await wsRequest(ws, 'Runtime.evaluate', {
        expression: `(() => {
          const w = window.__kaminosLamellarWitness;
          const state = w ? w.debugState() : { active: false, missing: true };
          const initialRecipe = document.getElementById('lamellar-shell-recipe')?.value || 'custom';
          const recipePopulationDescriptors = (state.stripPopulationDescriptors || []).filter(population => population.recipe === initialRecipe);
          const shellRecipeReceipt = {
            mode: 'shell-recipe-composition-v0',
            selectedRecipe: initialRecipe,
            composerRecipe: state.composerDescriptor?.shellRecipe || null,
            composerRecipeMode: state.composerDescriptor?.shellRecipeMode || null,
            recipeLabel: state.composerDescriptor?.shellRecipeLabel || null,
            effectiveParameters: state.composerDescriptor?.recipeEffectiveParameters || null,
            populationRoles: recipePopulationDescriptors.map(population => population.recipeRole).filter(Boolean),
            populationCount: recipePopulationDescriptors.length,
            envelopeCount: (state.lamellarEnvelopeDescriptors || []).filter(envelope => recipePopulationDescriptors.some(population => population.id === envelope.populationId)).length,
            layerCountValue: Number(document.getElementById('lamellar-layer-count')?.value || 0),
            populationCountValue: Number(document.getElementById('lamellar-population-count')?.value || 0),
            cutterCountValue: Number(document.getElementById('lamellar-cutter-count')?.value || 0),
            enclosureValue: Number(document.getElementById('lamellar-shell-enclosure')?.value || 0),
            shellFamiliesValue: Number(document.getElementById('lamellar-strip-topology-count')?.value || 0),
          };
          return {
            ...state,
            shellRecipeReceipt,
            recipeSmokeReceipt: {
              mode: 'focused-shell-recipe-smoke-v0',
              requestedRecipe: new URL(location.href).searchParams.get('lamellar_shell_recipe') || null,
              selectedRecipe: initialRecipe,
              segmentCount: (state.sectionSegments || []).length,
              descriptorCount: state.segmentDescriptorCount || 0,
              populationCount: recipePopulationDescriptors.length,
              envelopeCount: shellRecipeReceipt.envelopeCount,
              populationRoles: shellRecipeReceipt.populationRoles,
            },
          };
        })()`,
        returnByValue: true,
      });
      const state = recipeResult.result.value;
      assert.equal(state.effectiveRoute, 'sphere-domain-section-segment-witness-v0', 'effective Lamellar route mismatch');
      assert.equal(state.witnessIdentity, 'kaminos-lamellar-witness-v0', 'Lamellar witness identity mismatch');
      assert.ok(state.active, 'Lamellar witness route was not active');
      assert.ok((state.sectionSegments || []).length >= 3, 'Lamellar recipe smoke did not build section segments');
      assert.ok((state.segmentDescriptorCount || 0) >= 3, 'Lamellar recipe smoke did not export generated section descriptors');
      assert.ok(state.composerDescriptor?.mode, 'Lamellar recipe smoke did not export composer descriptor');
      if (requested.has('lamellar_shell_recipe')) {
        const requestedRecipe = requested.get('lamellar_shell_recipe');
        assert.equal(state.shellRecipeReceipt?.selectedRecipe, requestedRecipe, 'Lamellar recipe smoke did not select requested shell recipe');
        assert.equal(state.shellRecipeReceipt?.composerRecipe, requestedRecipe, 'Lamellar recipe smoke composer descriptor did not record requested shell recipe');
        assert.equal(state.shellRecipeReceipt?.composerRecipeMode, 'shell-recipe-composition-v0', 'Lamellar recipe smoke did not record recipe mode');
        assert.ok((state.shellRecipeReceipt?.populationRoles || []).length >= 2, 'Lamellar recipe smoke did not emit named recipe population roles');
        assert.ok((state.shellRecipeReceipt?.populationCount || 0) >= 2, 'Lamellar recipe smoke did not create authored recipe populations');
        assert.ok((state.shellRecipeReceipt?.envelopeCount || 0) >= 1, 'Lamellar recipe smoke did not create envelope bodies from recipe populations');
        if (requestedRecipe === 'diagonal-cage') {
          assert.ok(
            (state.shellRecipeReceipt?.populationRoles || []).includes('primary-diagonal'),
            'Lamellar diagonal-cage recipe smoke did not emit the primary diagonal role'
          );
          assert.ok(
            (state.shellRecipeReceipt?.populationRoles || []).includes('counter-diagonal'),
            'Lamellar diagonal-cage recipe smoke did not emit the counter diagonal role'
          );
        }
      }
      const { data: screenshotData, screenshotFallbackReceipt } = await captureScreenshotWithFallback(ws, 'recipe-smoke');
      const buffer = Buffer.from(screenshotData, 'base64');
      writeFileSync(out, buffer);
      const visualStats = assertVisualDiversity(buffer);
      const report = {
        schema: 'kaminos.lamellar-witness.v0',
        mode: 'focused-shell-recipe-smoke-v0',
        requestedUrl: url,
        requestPhase,
        cdpTimeoutMs,
        requestedView: requested.get('lamellar_view') || 'cap_profile',
        effectiveView: state.effectiveView,
        requestedShellRecipe: requested.get('lamellar_shell_recipe') || null,
        effectiveRoute: state.effectiveRoute,
        witnessIdentity: state.witnessIdentity,
        composerDescriptor: state.composerDescriptor,
        shellRecipeReceipt: state.shellRecipeReceipt,
        recipeSmokeReceipt: state.recipeSmokeReceipt,
        screenshotFallbackReceipt,
        stripPopulationDescriptors: state.stripPopulationDescriptors,
        lamellarEnvelopeDescriptors: state.lamellarEnvelopeDescriptors,
        segmentDescriptorCount: state.segmentDescriptorCount,
        sectionSegments: state.sectionSegments,
        screenshot: out,
        visualStats,
        stderrTail: stderr.slice(-2000),
      };
      writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
      ws.close();
      return;
    }

    requestPhase = 'full-witness-evaluate';
    const evalResult = await wsRequest(ws, 'Runtime.evaluate', {
      expression: `(() => {
        const w = window.__kaminosLamellarWitness;
        const preState = w ? w.debugState() : { active: false, missing: true };
        const initialRecipe = document.getElementById('lamellar-shell-recipe')?.value || 'custom';
        const recipePopulationDescriptors = (preState.stripPopulationDescriptors || []).filter(population => population.recipe === initialRecipe);
        const shellRecipeReceipt = {
          mode: 'shell-recipe-composition-v0',
          selectedRecipe: initialRecipe,
          composerRecipe: preState.composerDescriptor?.shellRecipe || null,
          composerRecipeMode: preState.composerDescriptor?.shellRecipeMode || null,
          recipeLabel: preState.composerDescriptor?.shellRecipeLabel || null,
          effectiveParameters: preState.composerDescriptor?.recipeEffectiveParameters || null,
          populationRoles: recipePopulationDescriptors.map(population => population.recipeRole).filter(Boolean),
          populationCount: recipePopulationDescriptors.length,
          envelopeCount: (preState.lamellarEnvelopeDescriptors || []).filter(envelope => recipePopulationDescriptors.some(population => population.id === envelope.populationId)).length,
          layerCountValue: Number(document.getElementById('lamellar-layer-count')?.value || 0),
          populationCountValue: Number(document.getElementById('lamellar-population-count')?.value || 0),
          cutterCountValue: Number(document.getElementById('lamellar-cutter-count')?.value || 0),
          enclosureValue: Number(document.getElementById('lamellar-shell-enclosure')?.value || 0),
          shellFamiliesValue: Number(document.getElementById('lamellar-strip-topology-count')?.value || 0),
        };
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
          popoverShellSetValue: Number(document.getElementById('lamellar-popover-shell-set-count')?.value || 0),
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
          if (firstPopulationId) window.__kaminosLamellarApplyPopulationOverride?.(firstPopulationId, { bearingVariance, bearingOffset: 0.23, laneSpan: 0.5, phaseStagger: 0.2 });
          const sweepState = w ? w.debugState() : afterCountState;
          const sweepPopulation = (sweepState.stripPopulationDescriptors || []).find(population => population.id === firstPopulationId) || null;
          const sweepStrips = (sweepState.stripInstances || []).filter(strip => strip.populationId === firstPopulationId);
          sliderSweep.push({
            bearingVariance,
            coverageSpacing: sweepPopulation?.coverageSpacing ?? null,
            coverageSpan: sweepPopulation?.coverageSpan ?? null,
            laneSpan: sweepPopulation?.laneSpan ?? null,
            phaseStagger: sweepPopulation?.phaseStagger ?? null,
            shellLaneSpacing: sweepPopulation?.shellLaneSpacing ?? null,
            bearingPhaseRange: sweepStrips.length ? [
              Math.min(...sweepStrips.map(strip => strip.bearingPhase ?? 0)),
              Math.max(...sweepStrips.map(strip => strip.bearingPhase ?? 0)),
            ] : [],
            laneOffsetRange: sweepStrips.length ? [
              Math.min(...sweepStrips.map(strip => strip.shellLaneOffset ?? 0)),
              Math.max(...sweepStrips.map(strip => strip.shellLaneOffset ?? 0)),
            ] : [],
            phaseOffsetRange: sweepStrips.length ? [
              Math.min(...sweepStrips.map(strip => strip.phaseOffset ?? 0)),
              Math.max(...sweepStrips.map(strip => strip.phaseOffset ?? 0)),
            ] : [],
          });
        }
        const laneSpanSweep = [];
        for (const laneSpan of [0, 0.5, 1.2]) {
          if (firstPopulationId) window.__kaminosLamellarApplyPopulationOverride?.(firstPopulationId, { bearingVariance: 1, bearingOffset: 0.23, laneSpan, phaseStagger: 0.2 });
          const laneState = w ? w.debugState() : afterCountState;
          const lanePopulation = (laneState.stripPopulationDescriptors || []).find(population => population.id === firstPopulationId) || null;
          const laneStrips = (laneState.stripInstances || []).filter(strip => strip.populationId === firstPopulationId);
          laneSpanSweep.push({
            laneSpan,
            populationLaneSpan: lanePopulation?.laneSpan ?? null,
            coverageSpacing: lanePopulation?.coverageSpacing ?? null,
            laneOffsetRange: laneStrips.length ? [
              Math.min(...laneStrips.map(strip => strip.shellLaneOffset ?? 0)),
              Math.max(...laneStrips.map(strip => strip.shellLaneOffset ?? 0)),
            ] : [],
            phaseOffsetRange: laneStrips.length ? [
              Math.min(...laneStrips.map(strip => strip.phaseOffset ?? 0)),
              Math.max(...laneStrips.map(strip => strip.phaseOffset ?? 0)),
            ] : [],
          });
        }
        const phaseStaggerSweep = [];
        for (const phaseStagger of [0, 0.3, 0.75]) {
          if (firstPopulationId) window.__kaminosLamellarApplyPopulationOverride?.(firstPopulationId, { bearingVariance: 1, bearingOffset: 0.23, laneSpan: 0.5, phaseStagger });
          const phaseState = w ? w.debugState() : afterCountState;
          const phasePopulation = (phaseState.stripPopulationDescriptors || []).find(population => population.id === firstPopulationId) || null;
          const phaseStrips = (phaseState.stripInstances || []).filter(strip => strip.populationId === firstPopulationId);
          phaseStaggerSweep.push({
            phaseStagger,
            populationPhaseStagger: phasePopulation?.phaseStagger ?? null,
            laneSpan: phasePopulation?.laneSpan ?? null,
            laneOffsetRange: phaseStrips.length ? [
              Math.min(...phaseStrips.map(strip => strip.shellLaneOffset ?? 0)),
              Math.max(...phaseStrips.map(strip => strip.shellLaneOffset ?? 0)),
            ] : [],
            phaseOffsetRange: phaseStrips.length ? [
              Math.min(...phaseStrips.map(strip => strip.phaseOffset ?? 0)),
              Math.max(...phaseStrips.map(strip => strip.phaseOffset ?? 0)),
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
        if (firstPopulationId) window.__kaminosLamellarApplyPopulationOverride?.(firstPopulationId, { bearingVariance: 1, bearingOffset: 0.23, laneSpan: 0.52, phaseStagger: 0.31, radialSpacing: 0.07, radiusOffset: 0.05 });
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
          laneSpanValue: Number(document.getElementById('lamellar-population-lane-span')?.value || 0),
          phaseStaggerValue: Number(document.getElementById('lamellar-population-phase-stagger')?.value || 0),
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
          afterLaneSpan: afterPopulation?.laneSpan ?? null,
          afterPhaseStagger: afterPopulation?.phaseStagger ?? null,
          afterBearingOffset: afterPopulation?.bearingOffset ?? null,
          afterRadialSpacing: afterPopulation?.radialSpacing ?? null,
          afterRadiusOffset: afterPopulation?.radiusOffset ?? null,
          layoutPreset: afterPopulation?.layoutPreset || null,
          coverageSpacing: afterPopulation?.coverageSpacing ?? null,
          coverageSpan: afterPopulation?.coverageSpan ?? null,
          layoutControlMode: afterPopulation?.layoutControlMode ?? null,
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
        const populationLaneSpanReceipt = {
          mode: 'selected-population-lane-span-v0',
          populationId: firstPopulationId,
          samples: laneSpanSweep,
        };
        const populationPhaseStaggerReceipt = {
          mode: 'selected-population-phase-stagger-v0',
          populationId: firstPopulationId,
          samples: phaseStaggerSweep,
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
        const layerMassBeforeDescriptors = afterLayerDescriptors;
        const selectedLayerMassEl = document.getElementById('lamellar-popover-layer-thickness-scale');
        if (selectedLayerMassEl) {
          selectedLayerMassEl.value = '1.64';
          selectedLayerMassEl.dispatchEvent(new Event('input', { bubbles: true }));
          selectedLayerMassEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const layerMassAfterState = w ? w.debugState() : layerRadiusAfterState;
        const layerMassAfterDescriptors = (layerMassAfterState.generatedSegmentDescriptors || []).filter(descriptor => descriptor.layerIndex === selectedLayerIndexForRadius);
        const average = values => values.length
          ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4))
          : null;
        const selectedLayerMassReceipt = {
          mode: 'selected-layer-descendant-thickness-scale-before-curve-mesh-derivation-v0',
          layerIndex: selectedLayerIndexForRadius,
          beforeDescriptorThicknessAverage: average(layerMassBeforeDescriptors.map(descriptor => descriptor.thickness ?? 0)),
          afterDescriptorThicknessAverage: average(layerMassAfterDescriptors.map(descriptor => descriptor.thickness ?? 0)),
          afterLayerSpecThicknessScale: (layerMassAfterState.layerSpecs || []).find(layer => layer.layerIndex === selectedLayerIndexForRadius)?.thicknessScale ?? null,
          afterDescriptorLayerThicknessScales: Array.from(new Set(layerMassAfterDescriptors.map(descriptor => descriptor.layerThicknessScale ?? null))),
          afterDescriptorProfileSources: Array.from(new Set(layerMassAfterDescriptors.map(descriptor => descriptor.profileOverrideSource || descriptor.stripProfileDescriptor?.overrideSource || null))),
          missingSourceCurveIds: layerMassAfterDescriptors.filter(descriptor => !descriptor.sourceCurveId).length,
        };
        const layerShellSetBeforeState = layerMassAfterState;
        const beforeLayerShellFamilyIndexes = Array.from(new Set((layerShellSetBeforeState.shellTopologyFamilyDescriptors || [])
          .filter(descriptor => descriptor.layerIndex === selectedLayerIndexForRadius)
          .map(descriptor => descriptor.shellTopologyFamilyIndex))).sort((a, b) => a - b);
        const beforeGlobalStripTopologyCount = Number(layerShellSetBeforeState.composerDescriptor?.stripTopologyCount ?? NaN);
        const selectedLayerShellSetEl = document.getElementById('lamellar-popover-shell-set-count');
        if (selectedLayerShellSetEl) {
          selectedLayerShellSetEl.value = '5';
          selectedLayerShellSetEl.dispatchEvent(new Event('input', { bubbles: true }));
          selectedLayerShellSetEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const layerShellSetAfterState = w ? w.debugState() : layerShellSetBeforeState;
        const afterLayerShellFamilyIndexes = Array.from(new Set((layerShellSetAfterState.shellTopologyFamilyDescriptors || [])
          .filter(descriptor => descriptor.layerIndex === selectedLayerIndexForRadius)
          .map(descriptor => descriptor.shellTopologyFamilyIndex))).sort((a, b) => a - b);
        const afterLayerShellFamilyDescriptors = (layerShellSetAfterState.shellTopologyFamilyDescriptors || [])
          .filter(descriptor => descriptor.layerIndex === selectedLayerIndexForRadius);
        const selectedLayerShellSetReceipt = {
          mode: 'selected-layer-shell-family-set-count-v0',
          layerIndex: selectedLayerIndexForRadius,
          beforeVisibleShellSets: beforeLayerShellFamilyIndexes.length + 1,
          afterVisibleShellSets: afterLayerShellFamilyIndexes.length + 1,
          beforeFamilyIndexes: beforeLayerShellFamilyIndexes,
          afterFamilyIndexes: afterLayerShellFamilyIndexes,
          afterLayerSpecShellSetCount: (layerShellSetAfterState.layerSpecs || []).find(layer => layer.layerIndex === selectedLayerIndexForRadius)?.shellSetCount ?? null,
          afterDescriptorShellSetCounts: Array.from(new Set(afterLayerShellFamilyDescriptors.map(descriptor => descriptor.shellSetCount ?? null))),
          sidebarSelectedLayerShellSetValue: Number(document.getElementById('lamellar-selected-layer-shell-set-count')?.value || 0),
          popoverShellSetValue: Number(selectedLayerShellSetEl?.value || 0),
          beforeGlobalStripTopologyCount,
          afterGlobalStripTopologyCount: Number(layerShellSetAfterState.composerDescriptor?.stripTopologyCount ?? NaN),
          sidebarGlobalStripTopologyCount: Number(document.getElementById('lamellar-strip-topology-count')?.value || 0),
        };
        if (firstStrip) window.__kaminosLamellarDrillIntoStrip?.(firstStrip.stripInstanceId);
        let authoringRoundTripReceipt = null;
        if (${authoringRoundTripSmoke ? 'true' : 'false'}) {
          const saved = window.__kaminosLamellarSaveAuthoringState?.();
          const savedSeed = saved?.controls?.seed;
          const savedLayerCount = saved?.controls?.layerCount;
          const savedPopulationCount = saved?.controls?.populationCount;
          const savedLayerOverrides = JSON.stringify(saved?.controls?.layerOverrides || []);
          document.getElementById('lamellar-seed').value = String((Number(savedSeed) + 37) % 100000);
          document.getElementById('lamellar-layer-count').value = '1';
          document.getElementById('lamellar-population-count').value = '1';
          window.__kaminosLamellarLoadAuthoringState?.(saved);
          const restored = window.__kaminosLamellarSaveAuthoringState?.();
          authoringRoundTripReceipt = {
            schema: saved?.schema,
            mode: 'kaminos-lamellar-authoring-json-roundtrip-v0',
            savedSeed,
            restoredSeed: restored?.controls?.seed,
            savedLayerCount,
            restoredLayerCount: restored?.controls?.layerCount,
            savedPopulationCount,
            restoredPopulationCount: restored?.controls?.populationCount,
            savedLayerOverrides,
            restoredLayerOverrides: JSON.stringify(restored?.controls?.layerOverrides || []),
            statusText: document.getElementById('lamellar-authoring-status')?.textContent || '',
          };
        }
        let authoringSlotRoundTripReceipt = null;
        if (${authoringSlotSmoke ? 'true' : 'false'}) {
          localStorage.removeItem('kaminos.lamellar.saved-states.v0');
          const savedSlot = window.__kaminosLamellarSaveAuthoringSlot?.();
          const secondSavedSlot = window.__kaminosLamellarSaveAuthoringSlot?.();
          const renamedSlot = window.__kaminosLamellarRenameAuthoringSlot?.(secondSavedSlot?.id, 'Operator Index Alpha');
          const savedState = savedSlot?.payload;
          const savedSeed = savedState?.controls?.seed;
          const savedLayerCount = savedState?.controls?.layerCount;
          const savedPopulationCount = savedState?.controls?.populationCount;
          document.getElementById('lamellar-seed').value = String((Number(savedSeed) + 73) % 100000);
          document.getElementById('lamellar-layer-count').value = '1';
          document.getElementById('lamellar-population-count').value = '1';
          const loadReceipt = window.__kaminosLamellarLoadAuthoringSlot?.(secondSavedSlot?.id);
          const restored = window.__kaminosLamellarSaveAuthoringState?.();
          const savedStates = window.__kaminosLamellarSavedStates?.() || [];
          const loadedSlot = savedStates.find(slot => slot.id === secondSavedSlot?.id) || null;
          const thumbnailDataUrl = loadedSlot?.thumbnailDataUrl || '';
          const thumbnailStats = loadedSlot?.thumbnailStats || null;
          const renamedLabel = loadedSlot?.label || '';
          const thumbnailElement = document.querySelector('#lamellar-saved-state-list .lamellar-slot-thumbnail');
          const renameInput = document.querySelector('#lamellar-saved-state-list .lamellar-slot-name-input');
          const shelfInputText = Array.from(document.querySelectorAll('#lamellar-saved-state-list .lamellar-slot-name-input')).map(input => input.value).join(' ');
          authoringSlotRoundTripReceipt = {
            schema: savedSlot?.schema,
            mode: 'kaminos-lamellar-local-slot-roundtrip-v0',
            slotId: savedSlot?.id,
            secondSlotId: secondSavedSlot?.id,
            distinctPrimarySaveIds: savedSlot?.id !== secondSavedSlot?.id,
            listCount: savedStates.length,
            shelfText: ((document.getElementById('lamellar-saved-state-list')?.textContent || '') + ' ' + shelfInputText).trim(),
            thumbnailDataUrl,
            thumbnailLength: thumbnailDataUrl.length,
            thumbnailStats,
            thumbnailElementSrcPrefix: thumbnailElement?.getAttribute('src')?.slice(0, 22) || '',
            renamedLabel,
            renameInputValue: renameInput?.value || '',
            renameReceiptLabel: renamedSlot?.label || '',
            loadReceiptSeed: loadReceipt?.seed,
            savedSeed,
            restoredSeed: restored?.controls?.seed,
            savedLayerCount,
            restoredLayerCount: restored?.controls?.layerCount,
            savedPopulationCount,
            restoredPopulationCount: restored?.controls?.populationCount,
            statusText: document.getElementById('lamellar-authoring-status')?.textContent || '',
          };
        }
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
          shellRecipeReceipt,
          selectedPopulationObject: populationToolheadUi.selectedPopulationObject,
          populationControlReceipt,
          populationSliderSweepReceipt,
          populationLaneSpanReceipt,
          populationPhaseStaggerReceipt,
          populationRadialSpacingReceipt,
          populationRadiusOffsetReceipt,
          selectedLayerRadiusReceipt,
          selectedLayerMassReceipt,
          selectedLayerShellSetReceipt,
          authoringRoundTripReceipt,
          authoringSlotRoundTripReceipt,
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
            selectedLayerMassDisplay: getComputedStyle(document.getElementById('lamellar-selected-layer-thickness-scale')).display,
            selectedLayerShellSetDisplay: getComputedStyle(document.getElementById('lamellar-selected-layer-shell-set-count')).display,
            selectedLayerText: document.getElementById('lamellar-selected-layer-index')?.textContent || '',
            selectedStripCount: Number(document.getElementById('lamellar-selected-layer-strip-count')?.value || 0),
            selectedRadius: Number(document.getElementById('lamellar-selected-layer-radius')?.value || 0),
            selectedLayerMass: Number(document.getElementById('lamellar-selected-layer-thickness-scale')?.value || 0),
            selectedLayerShellSets: Number(document.getElementById('lamellar-selected-layer-shell-set-count')?.value || 0),
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
    if (requested.has('lamellar_shell_recipe')) {
      const requestedRecipe = requested.get('lamellar_shell_recipe');
      assert.equal(state.shellRecipeReceipt?.selectedRecipe, requestedRecipe, 'Lamellar route did not select requested shell recipe');
      assert.equal(state.shellRecipeReceipt?.composerRecipe, requestedRecipe, 'Lamellar composer descriptor did not record requested shell recipe');
      assert.equal(state.shellRecipeReceipt?.composerRecipeMode, 'shell-recipe-composition-v0', 'Lamellar shell recipe receipt did not record recipe mode');
      assert.equal(state.composerDescriptor?.shellRecipe, requestedRecipe, 'Lamellar debug composer recipe mismatch');
      assert.equal(state.composerDescriptor?.shellRecipeMode, 'shell-recipe-composition-v0', 'Lamellar debug composer recipe mode mismatch');
      assert.ok((state.shellRecipeReceipt?.populationRoles || []).length >= 2, 'Lamellar shell recipe did not emit named recipe population roles');
      assert.ok((state.shellRecipeReceipt?.populationCount || 0) >= 2, 'Lamellar shell recipe did not create authored recipe populations');
      assert.ok((state.shellRecipeReceipt?.envelopeCount || 0) >= 1, 'Lamellar shell recipe did not create envelope bodies from recipe populations');
      assert.equal(state.shellRecipeReceipt?.mode, 'shell-recipe-composition-v0', 'Lamellar shell recipe receipt mode mismatch');
      assert.equal(
        state.shellRecipeReceipt?.effectiveParameters?.authoredPopulationCount,
        state.shellRecipeReceipt?.populationCount,
        'Lamellar shell recipe effective parameters did not record authored populations'
      );
      if (requestedRecipe === 'diagonal-cage') {
        assert.ok(
          (state.shellRecipeReceipt?.populationRoles || []).includes('primary-diagonal'),
          'Lamellar diagonal-cage recipe did not emit the primary diagonal role'
        );
        assert.ok(
          (state.shellRecipeReceipt?.populationRoles || []).includes('counter-diagonal'),
          'Lamellar diagonal-cage recipe did not emit the counter diagonal role'
        );
      }
    }
    if (requested.has('lamellar_shell_enclosure')) {
      const requestedShellEnclosure = Number(requested.get('lamellar_shell_enclosure'));
      assert.equal(state.composerDescriptor?.shellEnclosure, requestedShellEnclosure, 'Lamellar witness effective shellEnclosure did not match requested route');
    }
    if (requested.has('lamellar_strip_topology_count')) {
      const requestedStripTopologyCount = Number(requested.get('lamellar_strip_topology_count'));
      assert.equal(state.composerDescriptor?.stripTopologyCount, requestedStripTopologyCount, 'Lamellar witness effective stripTopologyCount did not match requested route');
      if (requestedStripTopologyCount > 0) {
        assert.ok((state.stripTopologyDescriptors || []).length > 0, 'Lamellar witness did not export requested topology descriptors');
        assert.ok((state.shellTopologyFamilyDescriptors || []).length > 0, 'Lamellar witness did not export requested shell topology family descriptors');
        assert.ok(
          (state.generatedSegmentDescriptors || []).some(descriptor => descriptor.topologyRole === 'shell-family-member'),
          'Lamellar witness did not emit requested shell topology family members as section geometry'
        );
      }
    }
    assert.ok(state.layerStackDescriptor?.mode, 'Lamellar witness did not export layer-stack descriptor');
    assert.ok((state.layerSpecs || []).length >= 1, 'Lamellar witness did not export per-layer specs');
    assert.ok((state.stripInstances || []).length > (state.layerSpecs || []).length, 'Lamellar witness did not export layer-owned strip assemblages');
    assert.ok((state.sphereCurveDescriptors || []).length >= (state.stripInstances || []).length, 'Lamellar witness did not export sphere-curve descriptors before mesh descriptors');
    assert.ok((state.lamellarEnvelopeDescriptors || []).length >= 1, 'Lamellar witness did not export curve-family envelope descriptors');
    assert.equal(state.lamellarEnvelopeDescriptors?.[0]?.mode, 'curve-family-envelope-loft-v0', 'Lamellar envelope descriptor did not use the curve-family loft mode');
    assert.ok((state.lamellarEnvelopeDescriptors?.[0]?.sourceCurveIds || []).length >= 3, 'Lamellar envelope descriptor did not preserve source curve ancestry');
    assert.ok((state.sectionSegments || []).some(segment => segment.kind === 'LamellarEnvelopeDescriptor'), 'Lamellar witness did not emit an envelope body section segment');
    if (multiEnvelopeSmoke) {
      const envelopeLayers = new Set((state.lamellarEnvelopeDescriptors || []).map(descriptor => descriptor.layerIndex));
      assert.ok((state.lamellarEnvelopeDescriptors || []).length >= 3, 'multi-envelope smoke did not export multiple envelope bodies');
      assert.ok(envelopeLayers.has(0) && envelopeLayers.has(2) && envelopeLayers.has(3), 'multi-envelope smoke did not include the expected eligible lamella layers');
      assert.ok(!envelopeLayers.has(1), 'multi-envelope smoke incorrectly lofted the cutter layer as a lamella envelope');
      assert.ok(
        (state.sectionSegments || []).filter(segment => segment.kind === 'LamellarEnvelopeDescriptor').length >= 3,
        'multi-envelope smoke did not render multiple envelope body section segments'
      );
    }
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
    assert.notEqual(state.selectedLayerUi?.selectedLayerMassDisplay, 'none', 'Lamellar selected-layer mass slider is hidden in the sidebar');
    assert.notEqual(state.selectedLayerUi?.selectedLayerShellSetDisplay, 'none', 'Lamellar selected-layer shell-set slider is hidden in the sidebar');
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
    assert.equal(state.selectedLayerMassReceipt?.mode, 'selected-layer-descendant-thickness-scale-before-curve-mesh-derivation-v0', 'Lamellar witness did not record selected-layer descendant thickness mutation');
    assert.equal(state.selectedLayerMassReceipt?.afterLayerSpecThicknessScale, 1.64, 'Lamellar selected-layer mass control did not mutate layer thickness scale');
    assert.ok(
      (state.selectedLayerMassReceipt?.afterDescriptorThicknessAverage || 0) > (state.selectedLayerMassReceipt?.beforeDescriptorThicknessAverage || 0) * 1.2,
      'Lamellar selected-layer mass did not thicken descendant descriptors'
    );
    assert.deepEqual(
      state.selectedLayerMassReceipt?.afterDescriptorLayerThicknessScales,
      [1.64],
      'Lamellar selected-layer mass scale did not reach emitted descriptors'
    );
    assert.equal(state.selectedLayerMassReceipt?.missingSourceCurveIds, 0, 'Lamellar selected-layer mass descriptors lost source curve ancestry');
    assert.equal(state.selectedLayerShellSetReceipt?.mode, 'selected-layer-shell-family-set-count-v0', 'Lamellar witness did not record selected-layer shell-set mutation');
    assert.equal(state.selectedLayerShellSetReceipt?.afterVisibleShellSets, 5, 'Lamellar selected-layer shell-set control did not create five visible shell sets');
    assert.equal(state.selectedLayerShellSetReceipt?.afterLayerSpecShellSetCount, 5, 'Lamellar selected-layer shell-set control did not mutate the layer spec');
    assert.deepEqual(
      state.selectedLayerShellSetReceipt?.afterDescriptorShellSetCounts,
      [5],
      'Lamellar selected-layer shell-set count did not reach derived shell-family descriptors'
    );
    assert.equal(
      state.selectedLayerShellSetReceipt?.afterGlobalStripTopologyCount,
      state.selectedLayerShellSetReceipt?.beforeGlobalStripTopologyCount,
      'Lamellar selected-layer shell-set control mutated the global shell-family default'
    );
    if (requested.has('lamellar_strip_topology_count')) {
      assert.equal(
        state.selectedLayerShellSetReceipt?.sidebarGlobalStripTopologyCount,
        Number(requested.get('lamellar_strip_topology_count')),
        'Lamellar selected-layer shell-set control changed the sidebar global shell-family slider'
      );
    }
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
    assert.equal(state.populationControlReceipt?.afterLaneSpan, 0.52, 'Lamellar population lane span control did not mutate lane span');
    assert.equal(state.populationControlReceipt?.afterPhaseStagger, 0.31, 'Lamellar population stagger control did not mutate phase stagger');
    assert.equal(state.populationControlReceipt?.afterBearingOffset, 0.23, 'Lamellar population rotate control did not mutate bearing offset');
    assert.equal(state.populationControlReceipt?.afterRadialSpacing, 0.07, 'Lamellar population radius control did not mutate radial spacing');
    assert.equal(state.populationControlReceipt?.afterRadiusOffset, 0.05, 'Lamellar population set radius control did not mutate selected population radius offset');
    assert.equal(state.populationControlReceipt?.layoutPreset, 'coverage', 'Lamellar selected population did not preserve coverage layout');
    assert.equal(state.populationControlReceipt?.layoutControlMode, 'decoupled-population-layout-controls-v0', 'Lamellar selected population did not report decoupled layout controls');
    assert.ok((state.populationControlReceipt?.coverageSpacing || 0) > 0.6, 'Lamellar selected population did not preserve useful coverage spacing');
    assert.equal(state.populationControlReceipt?.coverageSpan, state.populationControlReceipt?.afterLaneSpan, 'Lamellar coverage span should now be the explicit lane span');
    assert.equal(state.populationSliderSweepReceipt?.samples?.length, 3, 'Lamellar population witness did not sweep spread endpoints and midpoint');
    assert.ok(
      state.populationSliderSweepReceipt.samples[2].coverageSpacing > state.populationSliderSweepReceipt.samples[0].coverageSpacing,
      'Lamellar spread slider sweep did not increase angular coverage spacing'
    );
    assert.equal(
      state.populationSliderSweepReceipt.samples[2].laneOffsetRange[1] - state.populationSliderSweepReceipt.samples[2].laneOffsetRange[0],
      state.populationSliderSweepReceipt.samples[0].laneOffsetRange[1] - state.populationSliderSweepReceipt.samples[0].laneOffsetRange[0],
      'Lamellar spread slider sweep should not change lane span'
    );
    assert.equal(
      state.populationSliderSweepReceipt.samples[2].phaseOffsetRange[1] - state.populationSliderSweepReceipt.samples[2].phaseOffsetRange[0],
      state.populationSliderSweepReceipt.samples[0].phaseOffsetRange[1] - state.populationSliderSweepReceipt.samples[0].phaseOffsetRange[0],
      'Lamellar spread slider sweep should not change phase staggering'
    );
    assert.equal(state.populationLaneSpanReceipt?.samples?.length, 3, 'Lamellar population witness did not sweep lane span');
    assert.ok(
      state.populationLaneSpanReceipt.samples[2].laneOffsetRange[1] - state.populationLaneSpanReceipt.samples[2].laneOffsetRange[0]
        > state.populationLaneSpanReceipt.samples[0].laneOffsetRange[1] - state.populationLaneSpanReceipt.samples[0].laneOffsetRange[0],
      'Lamellar lane span sweep did not increase shell-lane separation'
    );
    assert.equal(state.populationPhaseStaggerReceipt?.samples?.length, 3, 'Lamellar population witness did not sweep phase stagger');
    assert.ok(
      state.populationPhaseStaggerReceipt.samples[2].phaseOffsetRange[1] - state.populationPhaseStaggerReceipt.samples[2].phaseOffsetRange[0]
        > state.populationPhaseStaggerReceipt.samples[0].phaseOffsetRange[1] - state.populationPhaseStaggerReceipt.samples[0].phaseOffsetRange[0],
      'Lamellar phase stagger sweep did not increase per-strip curve phase separation'
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
    if (authoringRoundTripSmoke) {
      assert.equal(state.authoringRoundTripReceipt?.schema, 'kaminos.lamellar-authoring.v0', 'Lamellar authoring round trip used the wrong schema');
      assert.equal(state.authoringRoundTripReceipt?.restoredSeed, state.authoringRoundTripReceipt?.savedSeed, 'Lamellar authoring round trip did not restore seed');
      assert.equal(state.authoringRoundTripReceipt?.restoredLayerCount, state.authoringRoundTripReceipt?.savedLayerCount, 'Lamellar authoring round trip did not restore layer count');
      assert.equal(state.authoringRoundTripReceipt?.restoredPopulationCount, state.authoringRoundTripReceipt?.savedPopulationCount, 'Lamellar authoring round trip did not restore population count');
      assert.equal(state.authoringRoundTripReceipt?.restoredLayerOverrides, state.authoringRoundTripReceipt?.savedLayerOverrides, 'Lamellar authoring round trip did not restore layer overrides');
    }
    if (authoringSlotSmoke) {
      assert.equal(state.authoringSlotRoundTripReceipt?.schema, 'kaminos.lamellar-authoring.v0', 'Lamellar saved-state slot used the wrong schema');
      assert.equal(state.authoringSlotRoundTripReceipt?.mode, 'kaminos-lamellar-local-slot-roundtrip-v0', 'Lamellar saved-state slot did not report local slot round-trip mode');
      assert.equal(state.authoringSlotRoundTripReceipt?.restoredSeed, state.authoringSlotRoundTripReceipt?.savedSeed, 'Lamellar saved-state slot did not restore seed');
      assert.equal(state.authoringSlotRoundTripReceipt?.restoredLayerCount, state.authoringSlotRoundTripReceipt?.savedLayerCount, 'Lamellar saved-state slot did not restore layer count');
      assert.equal(state.authoringSlotRoundTripReceipt?.restoredPopulationCount, state.authoringSlotRoundTripReceipt?.savedPopulationCount, 'Lamellar saved-state slot did not restore population count');
      assert.equal(state.authoringSlotRoundTripReceipt?.distinctPrimarySaveIds, true, 'Lamellar primary Save slot did not create distinct saved slot ids');
      assert.ok((state.authoringSlotRoundTripReceipt?.listCount || 0) >= 2, 'Lamellar primary Save slot did not append a second visible shelf row');
      assert.match(state.authoringSlotRoundTripReceipt?.shelfText || '', /seed/, 'Lamellar saved-state shelf did not show a readable saved slot summary');
      assert.match(state.authoringSlotRoundTripReceipt?.thumbnailDataUrl || '', /^data:image\//, 'Lamellar saved-state slot did not capture a thumbnail data URL');
      assert.ok((state.authoringSlotRoundTripReceipt?.thumbnailLength || 0) > 200, 'Lamellar saved-state thumbnail data URL is too small to be useful');
      assert.ok((state.authoringSlotRoundTripReceipt?.thumbnailStats?.lumaRange || 0) >= 16, 'Lamellar saved-state thumbnail is visually blank');
      assert.ok((state.authoringSlotRoundTripReceipt?.thumbnailStats?.colorBuckets || 0) >= 4, 'Lamellar saved-state thumbnail lacks color diversity');
      assert.equal(state.authoringSlotRoundTripReceipt?.renamedLabel, 'Operator Index Alpha', 'Lamellar saved-state rename did not persist to storage');
      assert.equal(state.authoringSlotRoundTripReceipt?.renameInputValue, 'Operator Index Alpha', 'Lamellar saved-state rename did not render in the shelf input');
    }

    if (state.populationControlReceipt?.populationId) {
      requestPhase = 'full-witness-reselect-population';
      await wsRequest(ws, 'Runtime.evaluate', {
        expression: `window.__kaminosLamellarSelectPopulationById?.(${JSON.stringify(state.populationControlReceipt.populationId)})`,
      });
      await delay(250);
    }
    const { data: screenshotData, screenshotFallbackReceipt } = await captureScreenshotWithFallback(ws, 'full-witness');
    const buffer = Buffer.from(screenshotData, 'base64');
    writeFileSync(out, buffer);
    const visualStats = assertVisualDiversity(buffer);

    const report = {
      schema: 'kaminos.lamellar-witness.v0',
      requestedUrl: url,
      requestPhase,
      cdpTimeoutMs,
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
      shellEnclosure: state.composerDescriptor?.shellEnclosure ?? null,
      shellEnclosureMode: state.composerDescriptor?.shellEnclosureMode ?? null,
      layerStackDescriptor: state.layerStackDescriptor,
      layerSpecs: state.layerSpecs,
      stripInstances: state.stripInstances,
      sphereCurveDescriptors: state.sphereCurveDescriptors,
      stripTopologyDescriptors: state.stripTopologyDescriptors,
      shellTopologyFamilyDescriptors: state.shellTopologyFamilyDescriptors,
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
      populationLaneSpanReceipt: state.populationLaneSpanReceipt,
      populationPhaseStaggerReceipt: state.populationPhaseStaggerReceipt,
      populationRadialSpacingReceipt: state.populationRadialSpacingReceipt,
      populationRadiusOffsetReceipt: state.populationRadiusOffsetReceipt,
      selectedLayerRadiusReceipt: state.selectedLayerRadiusReceipt,
      selectedLayerMassReceipt: state.selectedLayerMassReceipt,
      selectedLayerShellSetReceipt: state.selectedLayerShellSetReceipt,
      authoringRoundTripReceipt: state.authoringRoundTripReceipt,
      authoringSlotRoundTripReceipt: state.authoringSlotRoundTripReceipt,
      popoverPinnedDuringSliderReceipt: state.popoverPinnedDuringSliderReceipt,
      stripDrilldownUi: state.stripDrilldownUi,
      selectionPopoverUi: state.selectionPopoverUi,
      selectionUi: state.selectionUi,
      screenshotFallbackReceipt,
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
    requestPhase,
    cdpTimeoutMs,
    error: String(err.stack || err),
  }, null, 2) + '\n');
  console.error(err);
  process.exit(1);
});
