import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith('--')) continue;
  const [key, inline] = arg.slice(2).split('=', 2);
  const value = inline ?? (process.argv[i + 1]?.startsWith('--') ? 'true' : process.argv[++i]);
  args.set(key, value);
}

const chrome = args.get('chrome') || process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const appUrl = args.get('url') || `http://localhost:60105/?pipeline_ui_witness=${Date.now()}`;
const port = Number(args.get('port') || process.env.KAMINOS_UI_WITNESS_CDP_PORT || 63112);
const assetNeedle = args.get('asset') || 'evil_orb_outer_shell_source_image';
const secondAssetNeedle = args.get('second-asset') || 'pipeline-test-image-alt.png';
const scenario = args.get('scenario') || 'image-import';
const generatorId = args.get('generator-id') || 'sharp';
const pipelineId = args.get('pipeline-id') || 'sharp-image-to-splat-live-v0';
const expectedArtifactRole = args.get('artifact-role') || (pipelineId === 'sharp-image-to-splat-live-v0' ? 'splat-candidate' : 'splat');
const expectsLoadableArtifact = expectedArtifactRole.includes('splat');
const expectsFixture = args.get('expect-fixture') === '1' || pipelineId.includes('fixture');
const graphExecuteTimeoutMs = Number(args.get('graph-execute-timeout-ms') || (pipelineId === 'sharp-image-to-splat-live-v0' ? 240000 : 90000));
const beforePath = args.get('before') || '/tmp/kaminos-pipeline-ui-witness-before.png';
const afterPath = args.get('after') || '/tmp/kaminos-pipeline-ui-witness-after.png';
const historyPath = args.get('history') || '/tmp/kaminos-pipeline-ui-witness-history.png';
const userDataDir = await mkdtemp(join(tmpdir(), 'kaminos-pipeline-ui-witness-'));
let stderr = '';

async function wait(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function cdpFetch(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed ${response.status}`);
  return response.json();
}

async function waitForCdp() {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      return await cdpFetch('/json/version');
    } catch {}
    await wait(100);
  }
  throw new Error('Timed out waiting for CDP');
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(`${message.error.message}: ${message.error.data || ''}`));
    else resolve(message.result || {});
  });
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return {
    opened,
    send(method, params = {}, timeoutMs = 15000) {
      const id = ++seq;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method}: CDP request timed out`));
        }, timeoutMs);
        pending.set(id, {
          resolve: result => {
            clearTimeout(timer);
            resolve(result);
          },
          reject: error => {
            clearTimeout(timer);
            reject(error);
          },
        });
      });
    },
    close() {
      ws.close();
    },
  };
}

async function evalJson(cdp, expression, timeoutMs = 15000) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, timeoutMs);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result?.value;
}

async function dispatchMouse(cdp, type, point, buttons) {
  await cdp.send('Input.dispatchMouseEvent', {
    type,
    x: Math.round(point.x),
    y: Math.round(point.y),
    button: 'left',
    buttons,
    clickCount: 1,
  });
}

async function click(cdp, point) {
  await dispatchMouse(cdp, 'mouseMoved', point, 0);
  await wait(40);
  await dispatchMouse(cdp, 'mousePressed', point, 1);
  await wait(40);
  await dispatchMouse(cdp, 'mouseReleased', point, 0);
  await wait(500);
}

async function drag(cdp, from, to) {
  await dispatchMouse(cdp, 'mouseMoved', from, 0);
  await dispatchMouse(cdp, 'mousePressed', from, 1);
  for (let i = 1; i <= 12; i += 1) {
    await dispatchMouse(cdp, 'mouseMoved', {
      x: from.x + ((to.x - from.x) * i) / 12,
      y: from.y + ((to.y - from.y) * i) / 12,
    }, 1);
    await wait(25);
  }
  await dispatchMouse(cdp, 'mouseReleased', to, 0);
  await wait(500);
}

function assertWitness(condition, message, detail = {}) {
  if (condition) return;
  const error = new Error(message);
  error.detail = detail;
  throw error;
}

async function capture(cdp, path) {
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  await writeFile(path, Buffer.from(shot.data, 'base64'));
}

function parsePngRgba(buffer) {
  const signature = '89504e470d0a1a0a';
  if (buffer.subarray(0, 8).toString('hex') !== signature) throw new Error('not a PNG screenshot');
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = null;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : null;
  if (!width || !height || !bpp) throw new Error(`unsupported PNG screenshot color type: ${colorType}`);
  const inflated = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const rgba = new Uint8Array(width * height * 4);
  let sourceOffset = 0;
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset++];
    const row = new Uint8Array(stride);
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[sourceOffset++];
      const left = x >= bpp ? row[x - bpp] : 0;
      const up = previous[x] || 0;
      const upLeft = x >= bpp ? previous[x - bpp] || 0 : 0;
      const paeth = (() => {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        if (pa <= pb && pa <= pc) return left;
        return pb <= pc ? up : upLeft;
      })();
      row[x] = (raw + [0, left, up, Math.floor((left + up) / 2), paeth][filter]) & 255;
    }
    for (let x = 0; x < width; x += 1) {
      const src = x * bpp;
      const dst = (y * width + x) * 4;
      rgba[dst + 0] = row[src + 0];
      rgba[dst + 1] = row[src + 1];
      rgba[dst + 2] = row[src + 2];
      rgba[dst + 3] = bpp === 4 ? row[src + 3] : 255;
    }
    previous = row;
  }
  return { width, height, rgba };
}

async function screenshotVisibleProbe(path, rect = null) {
  const parsed = parsePngRgba(await readFile(path));
  const x0 = Math.max(0, Math.floor(rect?.x || 0));
  const y0 = Math.max(0, Math.floor(rect?.y || 0));
  const x1 = Math.min(parsed.width, Math.ceil((rect?.x || 0) + (rect?.width || parsed.width)));
  const y1 = Math.min(parsed.height, Math.ceil((rect?.y || 0) + (rect?.height || parsed.height)));
  let visiblePixels = 0;
  let saturatedPixels = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * parsed.width + x) * 4;
      const r = parsed.rgba[offset + 0];
      const g = parsed.rgba[offset + 1];
      const b = parsed.rgba[offset + 2];
      const a = parsed.rgba[offset + 3];
      if (a <= 8 || r + g + b <= 24) continue;
      visiblePixels += 1;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 45) saturatedPixels += 1;
    }
  }
  return {
    sampled: true,
    width: parsed.width,
    height: parsed.height,
    rect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
    visiblePixels,
    saturatedPixels,
  };
}

async function waitFor(cdp, expression, label, timeoutMs = 90000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    try {
      last = await evalJson(cdp, expression);
      if (last?.ok) return last;
    } catch (error) {
      last = { error: error.message };
    }
    await wait(500);
  }
  throw new Error(`${label} timed out: ${JSON.stringify(last)}`);
}

const chromeProcess = spawn(chrome, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`,
  '--headless=new',
  '--disable-gpu-sandbox',
  '--window-size=2048,1180',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
chromeProcess.stderr.on('data', chunk => {
  stderr += chunk.toString();
});

let cdp = null;
try {
  await waitForCdp();
  const targets = await cdpFetch('/json/list');
  const target = targets.find(item => item.type === 'page') || targets[0];
  assertWitness(target?.webSocketDebuggerUrl, 'No debuggable page target');
  cdp = connect(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 2048,
    height: 1180,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send('Page.navigate', { url: appUrl });
  await wait(2500);

  const pipelineTab = await evalJson(cdp, `(() => {
    const element = document.querySelector('[data-tab="pipeline"]');
    const rect = element?.getBoundingClientRect();
    if (!rect) throw new Error('Pipeline tab missing');
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await click(cdp, pipelineTab);

  const imagePaletteTab = await evalJson(cdp, `(() => {
    const element = document.querySelector('[data-pipeline-asset-palette="image"]');
    const rect = element?.getBoundingClientRect();
    if (!rect) throw new Error('Images palette tab missing');
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await click(cdp, imagePaletteTab);
  await wait(1000);

  if (scenario === 'kiln-activity-tray') {
    const trayTab = await evalJson(cdp, `(() => {
      const tab = document.querySelector('[data-tab="tray"]');
      if (!tab) throw new Error('Tray tab not found');
      const rect = tab.getBoundingClientRect();
      return { text: tab.textContent, point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
    })()`);
    await click(cdp, trayTab.point);
    await wait(500);

    await evalJson(cdp, `(() => {
      window.kaminosLoadRouteCompositionFixtureTray?.();
      return { ok: true };
    })()`);
    await wait(500);

    const kilnState = await waitFor(cdp, `(() => {
      const witness = window.kaminosRouteCompositionTrayKilnWitness?.();
      const panel = document.getElementById('route-composition-tray-panel');
      const kilnTiles = [...(panel?.querySelectorAll('.route-composition-tray-kiln-tile') || [])];
      const firstTileRect = kilnTiles[0]?.getBoundingClientRect();
      const runRows = [...(panel?.querySelectorAll('[data-tray-run-id]') || [])];
      const hasFixtureTile = kilnTiles.some(tile =>
        tile.dataset.kilnActivityState === 'fixture'
        && tile.dataset.kilnTruthMode === 'fixture'
        && tile.dataset.kilnFullBurn === 'false'
        && tile.getAttribute('data-fire-visual-authority') === 'fixture'
        && tile.getAttribute('data-fire-heat-class') === 'pilot'
      );
      const hasUnavailableTile = kilnTiles.some(tile =>
        tile.dataset.kilnActivityState === 'unavailable'
        && tile.dataset.kilnTruthMode === 'unavailable'
        && tile.dataset.kilnFullBurn === 'false'
        && tile.getAttribute('data-fire-visual-authority') === 'none'
        && tile.getAttribute('data-fire-heat-class') === 'cold'
      );
      const noFalseFullBurn = kilnTiles.every(tile =>
        tile.dataset.kilnActivityState === 'burning'
          ? tile.dataset.kilnFullBurn === 'true'
          : tile.dataset.kilnFullBurn === 'false'
      );
      const routeActivitySchemas = kilnTiles.map(tile => tile.getAttribute('data-route-activity-schema'));
      const falseAuthorityViolations = witness?.falseAuthorityViolations || [];
      return {
        ok: Boolean(
          witness
          && witness.schema === 'kaminos.kiln.activity-tray-witness.v0'
          && witness.kilnActivityStateCounts?.fixture >= 1
          && witness.kilnActivityStateCounts?.unavailable >= 1
          && witness.visualAuthorityCounts?.fixture >= 1
          && witness.visualAuthorityCounts?.none >= 1
          && falseAuthorityViolations.length === 0
          && hasFixtureTile
          && hasUnavailableTile
          && noFalseFullBurn
          && routeActivitySchemas.every(schema => schema === 'kaminos.kiln.route-activity.v0')
          && runRows.length >= 2
        ),
        witness,
        dom: {
          kilnTiles: kilnTiles.length,
          runRows: runRows.length,
          hasFixtureTile,
          hasUnavailableTile,
          noFalseFullBurn,
          routeActivitySchemas,
          falseAuthorityViolations,
          tileTexts: kilnTiles.map(tile => tile.innerText),
        },
        firstTileRect: firstTileRect ? { x: firstTileRect.x, y: firstTileRect.y, width: firstTileRect.width, height: firstTileRect.height } : null,
      };
    })()`, 'Kiln activity tray fixture', 12000);

    await capture(cdp, afterPath);
    const screenshotProbe = kilnState.firstTileRect
      ? await screenshotVisibleProbe(afterPath, kilnState.firstTileRect)
      : { sampled: false, visiblePixels: 0, saturatedPixels: 0 };
    assertWitness(screenshotProbe.visiblePixels >= 50 && screenshotProbe.saturatedPixels >= 10, 'Kiln activity tile was not visibly inspectable', {
      kilnState,
      screenshotProbe,
    });

    console.log(JSON.stringify({
      ok: true,
      schema: 'kaminos.pipeline-ui-witness.v0',
      scenario,
      url: appUrl,
      afterPath,
      kilnState,
      screenshotProbe,
    }, null, 2));
  } else if (scenario === 'sharp-kiln-lifecycle') {
    const trayTab = await evalJson(cdp, `(() => {
      const tab = document.querySelector('[data-tab="tray"]');
      if (!tab) throw new Error('Tray tab not found');
      const rect = tab.getBoundingClientRect();
      return { text: tab.textContent, point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
    })()`);
    await click(cdp, trayTab.point);
    await wait(500);

    const simulated = await evalJson(cdp, `(() => {
      return window.kaminosSimulateSharpKilnLifecycleForWitness?.('running');
    })()`);
    assertWitness(simulated?.simulatedRouteExecution === true, 'SHARP kiln lifecycle witness must be explicitly marked simulated', simulated);
    await wait(500);

    const lifecycleState = await waitFor(cdp, `(() => {
      const witness = window.kaminosRouteCompositionTrayKilnWitness?.();
      const panel = document.getElementById('route-composition-tray-panel');
      const run = window.kaminosRouteCompositionTrayState?.()?.routeRuns?.find(item => item.runId === 'witness-sharp-kiln-lifecycle') || null;
      const tile = panel?.querySelector('[data-tray-run-id="witness-sharp-kiln-lifecycle"] .route-composition-tray-kiln-tile');
      const rect = tile?.getBoundingClientRect();
      return {
        ok: Boolean(
          witness
          && witness.schema === 'kaminos.kiln.activity-tray-witness.v0'
          && witness.fullBurnRunIds?.includes('witness-sharp-kiln-lifecycle')
          && run?.requestedRoute === 'adapter.sharp-image-to-splat-live.v0'
          && run?.effectiveRoute === 'adapter.sharp-image-to-splat-live.v0'
          && run?.backendClass === 'browser-webgpu'
          && run?.displayStatus === 'Running'
          && run?.kilnActivity?.activityState === 'burning'
          && run?.kilnActivity?.truthMode === 'live'
          && run?.kilnActivity?.allowsFullBurn === true
          && run?.routeActivity?.schema === 'kaminos.kiln.route-activity.v0'
          && run?.routeActivity?.visualAuthority === 'live-compute'
          && run?.routeActivity?.fire?.heatClass === 'burn'
          && run?.routeActivity?.falseAuthorityViolations?.length === 0
          && witness.falseAuthorityViolations?.length === 0
          && tile?.dataset.kilnActivityState === 'burning'
          && tile?.dataset.kilnTruthMode === 'live'
          && tile?.dataset.kilnFullBurn === 'true'
          && tile?.getAttribute('data-route-activity-schema') === 'kaminos.kiln.route-activity.v0'
          && tile?.getAttribute('data-fire-visual-authority') === 'live-compute'
          && tile?.getAttribute('data-fire-heat-class') === 'burn'
          && tile?.getAttribute('data-fire-truth-class') === 'live'
        ),
        simulatedRouteExecution: true,
        witness,
        run,
        dom: {
          tileText: tile?.innerText || '',
          tileDataset: tile ? { ...tile.dataset } : null,
        },
        tileRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      };
    })()`, 'SHARP kiln lifecycle tray simulation', 12000);

    await capture(cdp, afterPath);
    const screenshotProbe = lifecycleState.tileRect
      ? await screenshotVisibleProbe(afterPath, lifecycleState.tileRect)
      : { sampled: false, visiblePixels: 0, saturatedPixels: 0 };
    assertWitness(screenshotProbe.visiblePixels >= 50 && screenshotProbe.saturatedPixels >= 10, 'SHARP lifecycle kiln tile was not visibly inspectable', {
      lifecycleState,
      screenshotProbe,
    });

    console.log(JSON.stringify({
      ok: true,
      schema: 'kaminos.pipeline-ui-witness.v0',
      scenario,
      url: appUrl,
      afterPath,
      simulatedRouteExecution: true,
      lifecycleState,
      screenshotProbe,
    }, null, 2));
  } else if (scenario === 'specimen-packet-cockpit') {
    const trayTab = await evalJson(cdp, `(() => {
      const tab = document.querySelector('[data-tab="tray"]');
      if (!tab) throw new Error('Tray tab not found');
      const rect = tab.getBoundingClientRect();
      return { text: tab.textContent, point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
    })()`);
    await click(cdp, trayTab.point);
    await wait(500);

    await evalJson(cdp, `(() => {
      const packet = window.kaminosLoadFixtureSpecimenPacketCockpit?.();
      return { ok: Boolean(packet?.schema === 'kaminos.kiln.specimen-packet-cockpit.v0'), packetId: packet?.packetId || null };
    })()`);
    await wait(500);

    const failureButton = await waitFor(cdp, `(() => {
      const button = document.querySelector('[data-specimen-failure-tag="added_face"]');
      const rect = button?.getBoundingClientRect();
      return {
        ok: Boolean(rect?.width > 0 && rect?.height > 0),
        text: button?.textContent || '',
        point: rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null,
      };
    })()`, 'Specimen packet failure tag button', 12000);
    await click(cdp, failureButton.point);
    await wait(500);

    const packetState = await waitFor(cdp, `(() => {
      const witness = window.kaminosSpecimenPacketCockpitWitness?.();
      const panel = document.querySelector('[data-specimen-packet-cockpit]');
      const patch = panel?.querySelector('[data-specimen-packet-negative-law-patch]');
      const next = panel?.querySelector('[data-specimen-packet-next-request]');
      const rect = panel?.getBoundingClientRect();
      return {
        ok: Boolean(
          witness?.ok === true
          && witness?.packet?.schema === 'kaminos.kiln.specimen-packet-cockpit.v0'
          && witness?.packet?.truthLayers?.length >= 5
          && witness?.packet?.failureTags?.some(tag => tag.tag === 'added_face')
          && witness?.nextRequestCarriesFailureLaw === true
          && witness?.nextRouteRequest?.negativeLawPatch?.added?.includes('do_not_install_face')
          && patch?.dataset.specimenPacketNegativeLawPatch?.includes('do_not_install_face')
          && next?.dataset.specimenPacketNextRequest
        ),
        witness,
        dom: {
          panelDataset: panel ? { ...panel.dataset } : null,
          panelText: panel?.innerText || '',
          patchText: patch?.innerText || '',
          nextText: next?.innerText || '',
        },
        panelRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      };
    })()`, 'Specimen packet cockpit failure-to-next-request loop', 12000);

    await capture(cdp, afterPath);
    const screenshotProbe = packetState.panelRect
      ? await screenshotVisibleProbe(afterPath, packetState.panelRect)
      : { sampled: false, visiblePixels: 0, saturatedPixels: 0 };
    assertWitness(screenshotProbe.visiblePixels >= 200 && screenshotProbe.saturatedPixels >= 20, 'Specimen packet cockpit was not visibly inspectable', {
      packetState,
      screenshotProbe,
    });

    console.log(JSON.stringify({
      ok: true,
      schema: 'kaminos.pipeline-ui-witness.v0',
      scenario,
      url: appUrl,
      afterPath,
      failureButton,
      packetState,
      screenshotProbe,
    }, null, 2));
  } else if (scenario === 'specimen-packet-live-route') {
    const trayTab = await evalJson(cdp, `(() => {
      const tab = document.querySelector('[data-tab="tray"]');
      if (!tab) throw new Error('Tray tab not found');
      const rect = tab.getBoundingClientRect();
      return { text: tab.textContent, point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
    })()`);
    await click(cdp, trayTab.point);
    await wait(500);

    await evalJson(cdp, `(() => {
      const packet = window.kaminosLoadFixtureSpecimenPacketCockpit?.();
      window.kaminosTagSpecimenPacketFailure?.('added_face', null, 'Operator marked candidate failure before live retry.');
      const refreshed = window.kaminosSimulateSpecimenPacketLiveRouteEvidence?.();
      return {
        packetOk: packet?.schema === 'kaminos.kiln.specimen-packet-cockpit.v0',
        refreshedOk: refreshed?.schema === 'kaminos.kiln.specimen-packet-cockpit.v0',
        packetId: refreshed?.packetId || packet?.packetId || null,
      };
    })()`);
    await wait(500);

    const packetState = await waitFor(cdp, `(() => {
      const witness = window.kaminosSpecimenPacketCockpitWitness?.();
      const panel = document.querySelector('[data-specimen-packet-cockpit]');
      const evidence = panel?.querySelector('[data-specimen-packet-route-evidence]');
      const patch = panel?.querySelector('[data-specimen-packet-negative-law-patch]');
      const next = panel?.querySelector('[data-specimen-packet-next-request]');
      const rect = panel?.getBoundingClientRect();
      const liveRun = witness?.packet?.routeRuns?.find(run => run.runId === 'packet-sharp-live-route-001') || null;
      const candidate = witness?.packet?.candidateArtifacts?.find(item => item.candidateArtifactId === 'packet-sharp-live-route-001-splat') || null;
      return {
        ok: Boolean(
          witness?.ok === true
          && liveRun?.statusBadge === 'fixture'
          && liveRun?.kilnActivity?.truthMode === 'fixture'
          && liveRun?.kilnActivity?.sourceTruthWarnings?.includes('fixture_kiln_not_live_compute')
          && liveRun?.sourceTruthWarnings?.includes('fixture_route_not_live_execution')
          && candidate?.sourceKind === 'fixture'
          && candidate?.sourceTruthWarnings?.includes('fixture_not_live_generated_output')
          && witness?.packet?.failureTags?.some(tag => tag.tag === 'added_face')
          && witness?.nextRequestCarriesFailureLaw === true
          && patch?.dataset.specimenPacketNegativeLawPatch?.includes('do_not_install_face')
          && evidence?.dataset.specimenPacketRouteEvidence === 'packet-sharp-live-route-001-splat'
          && next?.dataset.specimenPacketNextRequest
        ),
        witness,
        liveRun,
        candidate,
        dom: {
          panelDataset: panel ? { ...panel.dataset } : null,
          panelText: panel?.innerText || '',
          evidenceText: evidence?.innerText || '',
          evidenceDataset: evidence ? { ...evidence.dataset } : null,
          patchText: patch?.innerText || '',
          nextText: next?.innerText || '',
        },
        panelRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      };
    })()`, 'Specimen packet live route evidence loop', 12000);

    await capture(cdp, afterPath);
    const screenshotProbe = packetState.panelRect
      ? await screenshotVisibleProbe(afterPath, packetState.panelRect)
      : { sampled: false, visiblePixels: 0, saturatedPixels: 0 };
    assertWitness(screenshotProbe.visiblePixels >= 200 && screenshotProbe.saturatedPixels >= 20, 'Specimen packet live route cockpit was not visibly inspectable', {
      packetState,
      screenshotProbe,
    });

    console.log(JSON.stringify({
      ok: true,
      schema: 'kaminos.pipeline-ui-witness.v0',
      scenario,
      url: appUrl,
      afterPath,
      packetState,
      screenshotProbe,
    }, null, 2));
  } else if (scenario === 'specimen-packet-api-route') {
    const trayTab = await evalJson(cdp, `(() => {
      const tab = document.querySelector('[data-tab="tray"]');
      if (!tab) throw new Error('Tray tab not found');
      const rect = tab.getBoundingClientRect();
      return { text: tab.textContent, point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
    })()`);
    await click(cdp, trayTab.point);
    await wait(500);

    const apiEvidence = await evalJson(cdp, `(async () => {
      const packet = window.kaminosLoadFixtureSpecimenPacketCockpit?.();
      window.kaminosTagSpecimenPacketFailure?.('added_face', null, 'Operator marked face failure before API retry.');
      const evidence = await window.kaminosRunSpecimenPacketApiRouteEvidence?.({
        pipelineId: ${JSON.stringify(pipelineId)},
        assetNeedle: ${JSON.stringify(assetNeedle)},
      });
      return {
        packetOk: packet?.schema === 'kaminos.kiln.specimen-packet-cockpit.v0',
        evidence,
      };
    })()`, graphExecuteTimeoutMs);
    assertWitness(apiEvidence?.evidence?.schema === 'kaminos.kiln.specimen-packet-api-route-evidence.v0', 'API route evidence function did not return packet evidence', apiEvidence);
    assertWitness(apiEvidence.evidence.run?.schema === 'kaminos.pipeline-run-result.v0', 'API route evidence did not preserve pipeline-run-result schema', apiEvidence);
    assertWitness(apiEvidence.evidence.run?.report?.path, 'API route evidence did not preserve a report path', apiEvidence);
    await wait(500);

    const packetState = await waitFor(cdp, `(() => {
      const witness = window.kaminosSpecimenPacketCockpitWitness?.();
      const panel = document.querySelector('[data-specimen-packet-cockpit]');
      const evidence = panel?.querySelector('[data-specimen-packet-route-evidence]');
      const patch = panel?.querySelector('[data-specimen-packet-negative-law-patch]');
      const next = panel?.querySelector('[data-specimen-packet-next-request]');
      const rect = panel?.getBoundingClientRect();
      const state = window.kaminosPipelineDockDebugState?.();
      const run = state?.lastRun || null;
      const routeRun = witness?.packet?.routeRuns?.find(item => item.runId === run?.runId) || null;
      const candidate = routeRun?.outputArtifactIds?.length
        ? witness?.packet?.candidateArtifacts?.find(item => routeRun.outputArtifactIds.includes(item.candidateArtifactId)) || null
        : null;
      return {
        ok: Boolean(
          witness?.ok === true
          && run?.schema === 'kaminos.pipeline-run-result.v0'
          && run?.report?.path
          && routeRun
          && routeRun.receiptId === run.report.path
          && witness?.packet?.lineageReceipts?.some(receipt => receipt.receiptId === run.report.path)
          && witness?.packet?.failureTags?.some(tag => tag.tag === 'added_face')
          && witness?.nextRequestCarriesFailureLaw === true
          && patch?.dataset.specimenPacketNegativeLawPatch?.includes('do_not_install_face')
          && evidence?.dataset.specimenPacketRouteEvidence
          && next?.dataset.specimenPacketNextRequest
        ),
        witness,
        run,
        routeRun,
        candidate,
        dom: {
          panelDataset: panel ? { ...panel.dataset } : null,
          panelText: panel?.innerText || '',
          evidenceText: evidence?.innerText || '',
          evidenceDataset: evidence ? { ...evidence.dataset } : null,
          patchText: patch?.innerText || '',
          nextText: next?.innerText || '',
        },
        panelRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      };
    })()`, 'Specimen packet real API route evidence loop', graphExecuteTimeoutMs);

    await capture(cdp, afterPath);
    const screenshotProbe = packetState.panelRect
      ? await screenshotVisibleProbe(afterPath, packetState.panelRect)
      : { sampled: false, visiblePixels: 0, saturatedPixels: 0 };
    assertWitness(screenshotProbe.visiblePixels >= 200 && screenshotProbe.saturatedPixels >= 20, 'Specimen packet API route cockpit was not visibly inspectable', {
      apiEvidence,
      packetState,
      screenshotProbe,
    });

    console.log(JSON.stringify({
      ok: true,
      schema: 'kaminos.pipeline-ui-witness.v0',
      scenario,
      url: appUrl,
      afterPath,
      apiEvidence,
      packetState,
      screenshotProbe,
    }, null, 2));
  } else if (scenario === 'specimen-packet-moge-route') {
    const trayTab = await evalJson(cdp, `(() => {
      const tab = document.querySelector('[data-tab="tray"]');
      if (!tab) throw new Error('Tray tab not found');
      const rect = tab.getBoundingClientRect();
      return { text: tab.textContent, point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
    })()`);
    await click(cdp, trayTab.point);
    await wait(500);

    const mogeEvidence = await evalJson(cdp, `(() => {
      const packet = window.kaminosLoadFixtureSpecimenPacketCockpit?.();
      window.kaminosTagSpecimenPacketFailure?.('added_face', null, 'Operator marked face failure before MoGE truth-layer pass.');
      const evidence = window.kaminosSimulateSpecimenPacketMogeRouteEvidence?.();
      return {
        packetOk: packet?.schema === 'kaminos.kiln.specimen-packet-cockpit.v0',
        evidence,
      };
    })()`);
    assertWitness(mogeEvidence?.evidence?.schema === 'kaminos.kiln.specimen-packet-moge-route-evidence.v0', 'MoGE route evidence function did not return packet evidence', mogeEvidence);

    const packetState = await waitFor(cdp, `(() => {
      const witness = window.kaminosSpecimenPacketCockpitWitness?.();
      const panel = document.querySelector('[data-specimen-packet-cockpit]');
      const evidence = panel?.querySelector('[data-specimen-packet-route-evidence]');
      const patch = panel?.querySelector('[data-specimen-packet-negative-law-patch]');
      const rect = panel?.getBoundingClientRect();
      const packet = witness?.packet;
      const hasMogeRun = packet?.routeRuns?.some(run => run.requestedRoute === 'moge.depth-normal.webgpu-local.v0' && run.backendClass === 'webgpu-local');
      const hasDepth = packet?.truthLayers?.some(layer => layer.viewKind === 'depth' && layer.artifactId === 'packet-moge-depth-001');
      const hasNormal = packet?.truthLayers?.some(layer => layer.viewKind === 'normal' && layer.artifactId === 'packet-moge-normal-001');
      const hasPointmap = packet?.truthLayers?.some(layer => layer.viewKind === 'pointmap' && layer.artifactId === 'packet-moge-pointmap-001');
      const depthCandidate = packet?.candidateArtifacts?.some(candidate => candidate.candidateArtifactId === 'packet-moge-depth-001');
      const hasWebGpuReceipt = packet?.lineageReceipts?.some(receipt => receipt.schema === 'kaminos.webgpu-route-receipt.v0' && receipt.requestedRoute === 'moge.depth-normal.webgpu-local.v0');
      const lineageHasMissingIdentity = packet?.lineageReceipts?.some(receipt => !receipt.receiptId || receipt.receiptId === 'undefined');
      return {
        ok: Boolean(
          witness?.ok === true
          && hasMogeRun
          && hasDepth
          && hasNormal
          && hasPointmap
          && !depthCandidate
          && hasWebGpuReceipt
          && !lineageHasMissingIdentity
          && packet?.sourceTruthWarnings?.includes('anonymous_imagedata_receipt_partial')
          && patch?.dataset.specimenPacketNegativeLawPatch?.includes('do_not_install_face')
          && evidence?.dataset.specimenPacketRouteEvidence
        ),
        witness,
        hasMogeRun,
        hasDepth,
        hasNormal,
        hasPointmap,
        depthCandidate,
        hasWebGpuReceipt,
        lineageHasMissingIdentity,
        dom: {
          panelDataset: panel ? { ...panel.dataset } : null,
          panelText: panel?.innerText || '',
          evidenceText: evidence?.innerText || '',
          evidenceDataset: evidence ? { ...evidence.dataset } : null,
          patchText: patch?.innerText || '',
        },
        panelRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      };
    })()`, 'Specimen packet MoGE WebGPU truth-layer route loop', graphExecuteTimeoutMs);

    await capture(cdp, afterPath);
    const screenshotProbe = packetState.panelRect
      ? await screenshotVisibleProbe(afterPath, packetState.panelRect)
      : { sampled: false, visiblePixels: 0, saturatedPixels: 0 };
    assertWitness(screenshotProbe.visiblePixels >= 200 && screenshotProbe.saturatedPixels >= 20, 'Specimen packet MoGE route cockpit was not visibly inspectable', {
      mogeEvidence,
      packetState,
      screenshotProbe,
    });

    console.log(JSON.stringify({
      ok: true,
      schema: 'kaminos.pipeline-ui-witness.v0',
      scenario,
      url: appUrl,
      afterPath,
      mogeEvidence,
      packetState,
      screenshotProbe,
    }, null, 2));
  } else if (scenario === 'specimen-intake') {
    const fixtureButton = await evalJson(cdp, `(() => {
      const button = document.querySelector('#pipeline-specimen-fixture-button');
      const intake = document.querySelector('#pipeline-specimen-intake');
      const rect = button?.getBoundingClientRect();
      const intakeRect = intake?.getBoundingClientRect();
      if (!rect) throw new Error('Specimen Fixture button missing');
      return {
        text: button.textContent,
        disabled: button.disabled,
        intakeText: intake?.innerText || '',
        point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        intakeRect: intakeRect ? { x: intakeRect.x, y: intakeRect.y, width: intakeRect.width, height: intakeRect.height } : null,
      };
    })()`);
    assertWitness(!fixtureButton.disabled, 'Specimen fixture button was disabled', fixtureButton);
    await capture(cdp, beforePath);
    await click(cdp, fixtureButton.point);
    const specimen = await waitFor(cdp, `(() => {
      const debug = window.kaminosPipelineSpecimenIntakeDebugState?.();
      const state = window.kaminosPipelineDockDebugState?.();
      const warning = document.querySelector('[data-pipeline-source-warning="fallback_artifact_not_requested_route_truth"]');
      const graphNode = document.querySelector('[data-pipeline-graph-image-node-id]');
      const inspector = document.querySelector('#pipeline-graph-inspector')?.innerText || '';
      const stateLine = document.querySelector('#pipeline-specimen-intake-state')?.textContent || '';
      const warningRect = warning?.getBoundingClientRect();
      return {
        ok: Boolean(
          debug?.artifactSchema === 'kaminos.kiln.image-artifact.v0'
          && debug?.routeReceiptSchema === 'kaminos.kiln.image-route-receipt.v0'
          && debug?.artifacts?.[0]?.artifactId === 'fixture-red-lerm-fallback-001'
          && debug?.artifacts?.[0]?.sourceKind === 'fallback'
          && debug?.artifacts?.[0]?.routeReceipt?.requestedRoute === 'openai_api'
          && debug?.artifacts?.[0]?.routeReceipt?.effectiveRoute === 'fixture'
          && debug?.artifacts?.[0]?.sourceTruthWarnings?.includes('fallback_artifact_not_requested_route_truth')
          && state?.graphImageNodes?.some(node => node.artifactId === 'fixture-red-lerm-fallback-001')
          && warning
          && graphNode
          && inspector.includes('openai_api -> fixture')
        ),
        debug,
        selectedGraphNodeId: state?.selectedGraphNodeId || null,
        graphImageNodes: state?.graphImageNodes || [],
        stateLine,
        graphNodeText: graphNode?.innerText || '',
        inspectorText: inspector,
        warningText: warning?.textContent || '',
        warningRect: warningRect ? { x: warningRect.x, y: warningRect.y, width: warningRect.width, height: warningRect.height } : null,
      };
    })()`, 'Specimen intake fixture import', 12000);
    await capture(cdp, afterPath);
    const screenshotProbe = await screenshotVisibleProbe(afterPath, specimen.warningRect);
    assertWitness(screenshotProbe.visiblePixels >= 50 && screenshotProbe.saturatedPixels >= 10, 'Specimen source warning chip was not visibly inspectable', {
      specimen,
      screenshotProbe,
    });
    console.log(JSON.stringify({
      ok: true,
      schema: 'kaminos.pipeline-ui-witness.v0',
      scenario,
      url: appUrl,
      beforePath,
      afterPath,
      fixtureButton,
      specimen,
      screenshotProbe,
    }, null, 2));
  } else if (scenario === 'first-vertical-specimens') {
    const specimenButtons = await evalJson(cdp, `(() => {
      const ids = ['pipeline-specimen-goin-button', 'pipeline-specimen-glove-wealth-button'];
      return ids.map(id => {
        const button = document.querySelector(\`#\${id}\`);
        const rect = button?.getBoundingClientRect();
        if (!rect) throw new Error(\`Specimen button missing: \${id}\`);
        return {
          id,
          text: button.textContent,
          disabled: button.disabled,
          point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        };
      });
    })()`);
    assertWitness(specimenButtons.every(button => !button.disabled), 'First-vertical specimen buttons were not all clickable', specimenButtons);
    await capture(cdp, beforePath);
    for (const button of specimenButtons) {
      await click(cdp, button.point);
    }
    const specimens = await waitFor(cdp, `(() => {
      const debug = window.kaminosPipelineSpecimenIntakeDebugState?.();
      const state = window.kaminosPipelineDockDebugState?.();
      const roles = [...document.querySelectorAll('[data-pipeline-specimen-role]')].map(item => item.dataset.pipelineSpecimenRole);
      const roleChip = document.querySelector('[data-pipeline-specimen-role="theft_object"]');
      const warning = document.querySelector('[data-pipeline-source-warning="fallback_artifact_not_requested_route_truth"]');
      const goin = debug?.artifacts?.find(item => item.firstVerticalRole === 'theft_object') || null;
      const hoard = debug?.artifacts?.find(item => item.firstVerticalRole === 'hoard_source') || null;
      const goinNode = state?.graphImageNodes?.find(node => node.firstVerticalRole === 'theft_object') || null;
      const hoardNode = state?.graphImageNodes?.find(node => node.firstVerticalRole === 'hoard_source') || null;
      const graphTexts = [...document.querySelectorAll('[data-pipeline-graph-image-node-id]')].map(node => node.innerText);
      const roleRect = roleChip?.getBoundingClientRect();
      return {
        ok: Boolean(
          debug?.artifactSchema === 'kaminos.kiln.image-artifact.v0'
          && goin?.specimenKind === 'goin'
          && goin?.firstVerticalRole === 'theft_object'
          && goin?.conditioningRoles?.includes('mask')
          && goin?.sourceKind === 'fallback'
          && hoard?.specimenKind === 'glove_wealth'
          && hoard?.firstVerticalRole === 'hoard_source'
          && hoard?.conditioningRoles?.includes('layout_anchor')
          && hoard?.sourceKind === 'fallback'
          && goinNode?.artifactId === 'fixture-goin-object-of-desire-001'
          && hoardNode?.artifactId === 'fixture-glove-wealth-hoard-001'
          && roles.includes('theft_object')
          && roles.includes('hoard_source')
          && warning
        ),
        debug,
        graphImageNodes: state?.graphImageNodes || [],
        roles,
        graphTexts,
        goin,
        hoard,
        goinNode,
        hoardNode,
        roleRect: roleRect ? { x: roleRect.x, y: roleRect.y, width: roleRect.width, height: roleRect.height } : null,
      };
    })()`, 'First vertical specimen role imports', 12000);
    await capture(cdp, afterPath);
    const screenshotProbe = await screenshotVisibleProbe(afterPath, specimens.roleRect);
    assertWitness(screenshotProbe.visiblePixels >= 50 && screenshotProbe.saturatedPixels >= 10, 'First-vertical specimen role chip was not visibly inspectable', {
      specimens,
      screenshotProbe,
    });
    console.log(JSON.stringify({
      ok: true,
      schema: 'kaminos.pipeline-ui-witness.v0',
      scenario,
      url: appUrl,
      beforePath,
      afterPath,
      specimenButtons,
      specimens,
      screenshotProbe,
    }, null, 2));
  } else if (scenario === 'specimen-checkpoint') {
    const checkpointButton = await evalJson(cdp, `(() => {
      const button = document.querySelector('#pipeline-specimen-checkpoint-button');
      const rect = button?.getBoundingClientRect();
      if (!rect) throw new Error('Primitive checkpoint button missing');
      return {
        text: button.textContent,
        disabled: button.disabled,
        point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      };
    })()`);
    assertWitness(!checkpointButton.disabled, 'Primitive checkpoint button was disabled', checkpointButton);
    await capture(cdp, beforePath);
    await click(cdp, checkpointButton.point);
    const checkpoint = await waitFor(cdp, `(() => {
      const debug = window.kaminosPipelineSpecimenIntakeDebugState?.();
      const state = window.kaminosPipelineDockDebugState?.();
      const roles = [...document.querySelectorAll('[data-pipeline-specimen-role]')].map(item => item.dataset.pipelineSpecimenRole);
      const normalChip = document.querySelector('[data-pipeline-specimen-role="normal_source"]');
      const normalRect = normalChip?.getBoundingClientRect();
      const checkpointRecord = debug?.specimenCheckpoints?.find(item => item.schema === 'kaminos.specimen-checkpoint.v0') || null;
      const viewArtifacts = (debug?.artifacts || []).filter(item => item.specimenCheckpointId === checkpointRecord?.specimenId);
      const graphImageNodes = (state?.graphImageNodes || []).filter(node => node.specimenCheckpointId === checkpointRecord?.specimenId);
      const viewKinds = viewArtifacts.map(item => item.viewKind).sort();
      return {
        ok: Boolean(
          debug?.checkpointSchema === 'kaminos.specimen-checkpoint.v0'
          && debug?.viewArtifactSchema === 'kaminos.specimen-view-artifact.v0'
          && checkpointRecord?.specimenId === 'fixture-red-lerm-primitive-001'
          && checkpointRecord?.negativeLaw?.includes('no_visible_eyes')
          && viewArtifacts.length === 5
          && graphImageNodes.length === 5
          && viewKinds.join(',') === 'beauty,depth,mask,normal,silhouette'
          && viewArtifacts.some(item => item.viewKind === 'depth' && item.conditioningRoles?.includes('depth_source'))
          && viewArtifacts.some(item => item.viewKind === 'normal' && item.conditioningRoles?.includes('normal_source'))
          && viewArtifacts.every(item => item.routeReceipt?.requestedRoute === 'primitive_specimen_export')
          && viewArtifacts.every(item => item.routeReceipt?.effectiveRoute === 'fixture_primitive_export')
          && roles.includes('depth_source')
          && roles.includes('normal_source')
          && roles.includes('mask_source')
        ),
        debug,
        checkpointRecord,
        viewArtifacts,
        graphImageNodes,
        roles,
        normalRect: normalRect ? { x: normalRect.x, y: normalRect.y, width: normalRect.width, height: normalRect.height } : null,
      };
    })()`, 'Specimen checkpoint primitive export', 12000);
    await capture(cdp, afterPath);
    const screenshotProbe = await screenshotVisibleProbe(afterPath, checkpoint.normalRect);
    assertWitness(screenshotProbe.visiblePixels >= 50 && screenshotProbe.saturatedPixels >= 10, 'Specimen checkpoint normal-source chip was not visibly inspectable', {
      checkpoint,
      screenshotProbe,
    });
    console.log(JSON.stringify({
      ok: true,
      schema: 'kaminos.pipeline-ui-witness.v0',
      scenario,
      url: appUrl,
      beforePath,
      afterPath,
      checkpointButton,
      checkpoint,
      screenshotProbe,
    }, null, 2));
  } else if (scenario === 'conditioning-route-request') {
    const routeRequestButton = await evalJson(cdp, `(() => {
      const button = document.querySelector('#pipeline-conditioning-route-request-button');
      const rect = button?.getBoundingClientRect();
      if (!rect) throw new Error('Conditioning route request button missing');
      return {
        text: button.textContent,
        disabled: button.disabled,
        point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      };
    })()`);
    assertWitness(!routeRequestButton.disabled, 'Conditioning route request button was disabled', routeRequestButton);
    await capture(cdp, beforePath);
    await click(cdp, routeRequestButton.point);
    const routeRequest = await waitFor(cdp, `(() => {
      const debug = window.kaminosPipelineSpecimenIntakeDebugState?.();
      const state = window.kaminosPipelineDockDebugState?.();
      const request = debug?.conditioningRouteRequests?.find(item => item.schema === 'kaminos.conditioning-route-request.v0') || null;
      const buttonText = document.querySelector('#pipeline-conditioning-route-request-button')?.textContent?.trim() || '';
      const normalChip = document.querySelector('[data-pipeline-specimen-role="normal_source"]');
      const stateLineElement = document.querySelector('#pipeline-specimen-intake-state');
      const stateLine = stateLineElement?.textContent || '';
      const normalRect = normalChip?.getBoundingClientRect();
      const stateRect = stateLineElement?.getBoundingClientRect();
      return {
        ok: Boolean(
          debug?.conditioningRouteRequestSchema === 'kaminos.conditioning-route-request.v0'
          && buttonText === 'Stage Bake'
          && request?.requestId === 'fixture-red-lerm-primitive-001-conditioning-request-001'
          && request?.requestedRoute === 'image_conditioned_generation'
          && request?.intendedEffectiveRoute === 'request_only'
          && request?.routeReceipt?.effectiveRoute === 'request_only'
          && request?.inputArtifactIds?.includes('fixture-red-lerm-primitive-001-beauty')
          && request?.conditioningArtifactIds?.depth === 'fixture-red-lerm-primitive-001-depth'
          && request?.conditioningArtifactIds?.normal === 'fixture-red-lerm-primitive-001-normal'
          && request?.conditioningArtifactIds?.mask === 'fixture-red-lerm-primitive-001-mask'
          && request?.conditioningRoles?.includes('depth_source')
          && request?.conditioningRoles?.includes('normal_source')
          && request?.conditioningRoles?.includes('mask_source')
          && request?.sourceTruthWarnings?.includes('route_request_not_generator_execution_truth')
          && stateLine.includes('Bake staged from')
          && stateLine.includes('No image generated yet')
          && !stateLine.includes('route_request_')
          && !stateLine.includes('fixture_primitive_')
          && normalChip
          && (state?.graphImageNodes || []).some(node => node.viewKind === 'normal' && node.conditioningRoles?.includes('normal_source'))
        ),
        debug,
        request,
        buttonText,
        stateLine,
        graphImageNodes: state?.graphImageNodes || [],
        normalRect: normalRect ? { x: normalRect.x, y: normalRect.y, width: normalRect.width, height: normalRect.height } : null,
        stateRect: stateRect ? { x: stateRect.x, y: stateRect.y, width: stateRect.width, height: stateRect.height } : null,
      };
    })()`, 'Conditioning route request export', 12000);
    await capture(cdp, afterPath);
    const screenshotProbe = await screenshotVisibleProbe(afterPath, routeRequest.normalRect);
    assertWitness(screenshotProbe.visiblePixels >= 50 && screenshotProbe.saturatedPixels >= 10, 'Conditioning route request normal-source chip was not visibly inspectable', {
      routeRequest,
      screenshotProbe,
    });
    console.log(JSON.stringify({
      ok: true,
      schema: 'kaminos.pipeline-ui-witness.v0',
      scenario,
      url: appUrl,
      beforePath,
      afterPath,
      routeRequestButton,
      routeRequest,
      screenshotProbe,
    }, null, 2));
  } else if (scenario === 'stage-bake-tray') {
    // Click Pipeline tab first to access Stage Bake
    const pipelineTab = await evalJson(cdp, `(() => {
      const tab = document.querySelector('[data-tab="pipeline"]');
      if (!tab) throw new Error('Pipeline tab not found');
      const rect = tab.getBoundingClientRect();
      return { text: tab.textContent, point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
    })()`);
    await click(cdp, pipelineTab.point);
    await wait(1000);

    // Click Stage Bake button
    const bakeBtnResult = await waitFor(cdp, `(() => {
      const btn = document.getElementById('pipeline-conditioning-route-request-button');
      if (!btn) return { ok: false, reason: 'no Stage Bake button' };
      const rect = btn.getBoundingClientRect();
      return {
        ok: rect.width > 0 && rect.height > 0,
        text: btn.textContent,
        point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      };
    })()`, 'Stage Bake button', 12000);
    await click(cdp, bakeBtnResult.point);
    await wait(800);

    await capture(cdp, beforePath);

    // Switch to Tray tab
    const trayTab = await evalJson(cdp, `(() => {
      const tab = document.querySelector('[data-tab="tray"]');
      if (!tab) throw new Error('Tray tab not found');
      const rect = tab.getBoundingClientRect();
      return { text: tab.textContent, point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
    })()`);
    await click(cdp, trayTab.point);
    await wait(500);

    // Verify tray was populated from Stage Bake
    const trayState = await waitFor(cdp, `(() => {
      const tray = window.kaminosRouteCompositionTrayState?.();
      if (!tray || !tray.sourceArtifacts?.length) return { ok: false, reason: 'tray not populated' };
      const panel = document.getElementById('route-composition-tray-panel');
      const sourceRows = panel?.querySelectorAll('[data-tray-artifact-id]') || [];
      const conditioningRows = panel?.querySelectorAll('[data-tray-conditioning-role]') || [];
      const runRows = panel?.querySelectorAll('[data-tray-run-id]') || [];

      // The beauty input should appear as a source artifact
      const hasBeautySource = tray.sourceArtifacts.some(a => a.artifactId.includes('beauty'));

      // Conditioning links should include depth, normal, mask from the view artifacts
      const condRoles = tray.conditioningLinks.map(l => l.role);
      const hasDepth = condRoles.includes('depth');
      const hasNormal = condRoles.includes('normal');
      const hasMask = condRoles.includes('mask');

      // Route run should exist with request-only effective route
      const hasRequestOnlyRun = tray.routeRuns.some(r =>
        r.effectiveRoute === 'request_only' && r.statusBadge === 'fixture'
      );

      // No output artifacts yet (no generator ran)
      const noOutputs = tray.outputArtifacts.length === 0;

      // FALSE-CLOSURE: route run must not claim live execution
      const noLiveClaim = tray.routeRuns.every(r => r.statusBadge !== 'real');

      // FALSE-CLOSURE: source kind on source artifact must be fixture (it came from fixture primitive)
      const sourceIsFixture = tray.sourceArtifacts.every(a => a.sourceKind === 'fixture');

      const firstRunRect = runRows.length > 0 ? runRows[0].getBoundingClientRect() : null;

      return {
        ok: Boolean(
          hasBeautySource
          && hasDepth && hasNormal && hasMask
          && hasRequestOnlyRun
          && noOutputs
          && noLiveClaim
          && sourceIsFixture
          && sourceRows.length >= 1
          && conditioningRows.length >= 3
          && runRows.length >= 1
        ),
        tray,
        dom: {
          sourceRows: sourceRows.length,
          conditioningRows: conditioningRows.length,
          runRows: runRows.length,
          hasBeautySource,
          hasDepth, hasNormal, hasMask,
          hasRequestOnlyRun,
          noOutputs,
          noLiveClaim,
          sourceIsFixture,
        },
        firstRunRect: firstRunRect ? { x: firstRunRect.x, y: firstRunRect.y, width: firstRunRect.width, height: firstRunRect.height } : null,
      };
    })()`, 'Stage Bake tray population', 12000);

    await capture(cdp, afterPath);
    const screenshotProbe = trayState.firstRunRect
      ? await screenshotVisibleProbe(afterPath, trayState.firstRunRect)
      : { sampled: false, visiblePixels: 0, saturatedPixels: 0 };

    console.log(JSON.stringify({
      ok: true,
      schema: 'kaminos.pipeline-ui-witness.v0',
      scenario,
      url: appUrl,
      beforePath,
      afterPath,
      trayState,
      screenshotProbe,
    }, null, 2));
  } else if (scenario === 'tray-milestone') {
    // Comprehensive milestone witness:
    // 1. Stage Bake populates tray
    // 2. Probe route adds missing-backend run
    // 3. Use output as conditioning creates reuse link
    // All in one flow

    // Step 1: Pipeline → Stage Bake
    const pipelineTab = await evalJson(cdp, `(() => {
      const tab = document.querySelector('[data-tab="pipeline"]');
      const rect = tab?.getBoundingClientRect();
      return { point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
    })()`);
    await click(cdp, pipelineTab.point);
    await wait(1000);

    const bakeBtn = await waitFor(cdp, `(() => {
      const btn = document.getElementById('pipeline-conditioning-route-request-button');
      const rect = btn?.getBoundingClientRect();
      return { ok: rect?.width > 0, point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
    })()`, 'Stage Bake button', 12000);
    await click(cdp, bakeBtn.point);
    await wait(800);

    // Step 2: Switch to Tray tab
    const trayTab = await evalJson(cdp, `(() => {
      const tab = document.querySelector('[data-tab="tray"]');
      const rect = tab.getBoundingClientRect();
      return { point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
    })()`);
    await click(cdp, trayTab.point);
    await wait(500);

    // Step 3: Probe route
    const probeBtn = await evalJson(cdp, `(() => {
      const btn = document.getElementById('route-composition-tray-probe-route-button');
      const rect = btn?.getBoundingClientRect();
      return { point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
    })()`);
    await click(cdp, probeBtn.point);
    await wait(500);

    // Step 4: Use source as reference conditioning (click "Use as reference" on first source)
    const reuseBtn = await waitFor(cdp, `(() => {
      const btn = document.querySelector('[data-tray-reuse-role="reference"]');
      if (!btn) return { ok: false };
      const rect = btn.getBoundingClientRect();
      return { ok: rect.width > 0, point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
    })()`, 'Use as reference button', 8000);
    await click(cdp, reuseBtn.point);
    await wait(500);

    await capture(cdp, beforePath);

    // Step 5: Verify full milestone state
    const milestone = await waitFor(cdp, `(() => {
      const tray = window.kaminosRouteCompositionTrayState?.();
      if (!tray) return { ok: false, reason: 'no tray' };
      const panel = document.getElementById('route-composition-tray-panel');
      const sourceRows = panel?.querySelectorAll('[data-tray-artifact-id]') || [];
      const condRows = panel?.querySelectorAll('[data-tray-conditioning-role]') || [];
      const runRows = panel?.querySelectorAll('[data-tray-run-id]') || [];
      const reuseButtons = panel?.querySelectorAll('[data-tray-reuse-buttons]') || [];
      const dropZone = document.getElementById('route-composition-tray-drop-zone');

      // Stage Bake created source + conditioning + fixture run
      const hasBakeSource = tray.sourceArtifacts.some(a => a.artifactId.includes('beauty'));
      const hasDepthCond = tray.conditioningLinks.some(l => l.role === 'depth');
      const hasNormalCond = tray.conditioningLinks.some(l => l.role === 'normal');
      const hasMaskCond = tray.conditioningLinks.some(l => l.role === 'mask');
      const hasBakeRun = tray.routeRuns.some(r => r.effectiveRoute === 'request_only');

      // Route probe created missing-backend run
      const hasProbeRun = tray.routeRuns.some(r => r.requestedRoute === 'sharp_image_to_splat' && r.statusBadge === 'missing-backend');

      // Reuse created a reference conditioning link
      const hasReuse = tray.conditioningLinks.some(l => l.role === 'reference');

      // No false live claims
      const noLive = tray.routeRuns.every(r => r.statusBadge !== 'real');
      const noOutputs = tray.outputArtifacts.length === 0;

      // Import surface exists
      const hasDropZone = Boolean(dropZone);
      const hasReuseButtons = reuseButtons.length > 0;

      // Missing-backend run visible with correct display
      const missingBackendEl = [...runRows].find(el => el.getAttribute('data-tray-run-status') === 'missing-backend');

      const trayIdField = document.getElementById('route-composition-tray-id')?.textContent || '';

      return {
        ok: Boolean(
          hasBakeSource && hasDepthCond && hasNormalCond && hasMaskCond && hasBakeRun
          && hasProbeRun && hasReuse
          && noLive && noOutputs
          && hasDropZone && hasReuseButtons
          && missingBackendEl
          && trayIdField !== 'empty'
          && sourceRows.length >= 1
          && condRows.length >= 6
          && runRows.length >= 2
        ),
        tray: {
          trayId: tray.trayId,
          sourceCount: tray.sourceArtifacts.length,
          conditioningCount: tray.conditioningLinks.length,
          runCount: tray.routeRuns.length,
          outputCount: tray.outputArtifacts.length,
          conditioningRoles: tray.conditioningLinks.map(l => l.role),
          runBadges: tray.routeRuns.map(r => r.statusBadge),
          runRoutes: tray.routeRuns.map(r => r.requestedRoute),
        },
        dom: {
          sourceRows: sourceRows.length,
          condRows: condRows.length,
          runRows: runRows.length,
          reuseButtons: reuseButtons.length,
          hasDropZone,
          missingBackendVisible: Boolean(missingBackendEl),
        },
        checks: {
          hasBakeSource, hasDepthCond, hasNormalCond, hasMaskCond, hasBakeRun,
          hasProbeRun, hasReuse, noLive, noOutputs,
        },
      };
    })()`, 'Tray milestone verification', 12000);

    await capture(cdp, afterPath);

    console.log(JSON.stringify({
      ok: true,
      schema: 'kaminos.pipeline-ui-witness.v0',
      scenario,
      url: appUrl,
      beforePath,
      afterPath,
      milestone,
    }, null, 2));
  } else if (scenario === 'route-composition-tray') {
    // Click the Tray tab
    const trayTab = await evalJson(cdp, `(() => {
      const tab = document.querySelector('[data-tab="tray"]');
      if (!tab) throw new Error('Tray tab not found');
      const rect = tab.getBoundingClientRect();
      return { text: tab.textContent, point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
    })()`);
    await click(cdp, trayTab.point);
    await wait(300);

    // Click the fixture button
    const fixtureButton = await evalJson(cdp, `(() => {
      const btn = document.getElementById('route-composition-tray-fixture-button');
      if (!btn) throw new Error('Fixture tray button not found');
      const rect = btn.getBoundingClientRect();
      return { text: btn.textContent, point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
    })()`);
    await capture(cdp, beforePath);
    await click(cdp, fixtureButton.point);
    await wait(500);

    // Wait for tray to render
    const trayState = await waitFor(cdp, `(() => {
      const tray = window.kaminosRouteCompositionTrayState?.();
      if (!tray) return { ok: false, reason: 'no tray state' };
      const panel = document.getElementById('route-composition-tray-panel');
      const sourceRows = panel?.querySelectorAll('[data-tray-artifact-id]') || [];
      const conditioningRows = panel?.querySelectorAll('[data-tray-conditioning-role]') || [];
      const runRows = panel?.querySelectorAll('[data-tray-run-id]') || [];
      const outputRows = panel?.querySelectorAll('[data-tray-output-id]') || [];
      const trayIdField = document.getElementById('route-composition-tray-id')?.textContent || '';
      const sourceCountField = document.getElementById('route-composition-tray-source-count')?.textContent || '';
      const condCountField = document.getElementById('route-composition-tray-conditioning-count')?.textContent || '';
      const runCountField = document.getElementById('route-composition-tray-run-count')?.textContent || '';
      const outputCountField = document.getElementById('route-composition-tray-output-count')?.textContent || '';

      // FALSE-CLOSURE checks in browser:
      // 1. Fixture output carries fixture source kind (not generated)
      const fixtureOutput = outputRows.length > 0 ? outputRows[0] : null;
      const fixtureOutputSourceKind = fixtureOutput?.getAttribute('data-tray-output-source-kind') || '';
      const fixtureIsNotGenerated = fixtureOutputSourceKind === 'fixture';

      // 2. Missing-backend run has visible status badge
      const missingBackendRun = [...runRows].find(el => el.getAttribute('data-tray-run-status') === 'missing-backend');
      const missingBackendVisible = Boolean(missingBackendRun);

      // 3. Source rows preserved after output append
      const sourcePreserved = sourceRows.length >= 1;

      // 4. displayRoute is human-legible (no underscores in visible run text)
      const runTexts = [...runRows].map(el => el.textContent);
      const noRawIds = runTexts.every(t => !t.includes('image_conditioned_generation') && !t.includes('fixture_generator'));

      // 5. External import badge visible
      const externalImportVisible = [...sourceRows].some(el => el.textContent.includes('External import'));

      // Check the first output row area for screenshot verification
      const firstOutputRect = fixtureOutput?.getBoundingClientRect();

      return {
        ok: Boolean(
          tray.schema === 'kaminos.kiln.route-composition-tray.v0'
          && tray.sourceArtifacts.length >= 1
          && tray.conditioningLinks.length >= 2
          && tray.routeRuns.length >= 1
          && tray.outputArtifacts.length >= 1
          && sourceRows.length >= 1
          && conditioningRows.length >= 2
          && runRows.length >= 1
          && outputRows.length >= 1
          && fixtureIsNotGenerated
          && missingBackendVisible
          && sourcePreserved
          && noRawIds
          && externalImportVisible
          && trayIdField !== 'empty'
        ),
        tray,
        dom: {
          sourceRows: sourceRows.length,
          conditioningRows: conditioningRows.length,
          runRows: runRows.length,
          outputRows: outputRows.length,
          trayIdField,
          sourceCountField,
          condCountField,
          runCountField,
          outputCountField,
          fixtureOutputSourceKind,
          missingBackendVisible,
          sourcePreserved,
          noRawIds,
          externalImportVisible,
        },
        firstOutputRect: firstOutputRect ? { x: firstOutputRect.x, y: firstOutputRect.y, width: firstOutputRect.width, height: firstOutputRect.height } : null,
      };
    })()`, 'Route composition tray fixture', 12000);

    await capture(cdp, afterPath);
    const screenshotProbe = trayState.firstOutputRect
      ? await screenshotVisibleProbe(afterPath, trayState.firstOutputRect)
      : { sampled: false, visiblePixels: 0, saturatedPixels: 0 };

    console.log(JSON.stringify({
      ok: true,
      schema: 'kaminos.pipeline-ui-witness.v0',
      scenario,
      url: appUrl,
      beforePath,
      afterPath,
      trayTab,
      fixtureButton,
      trayState,
      screenshotProbe,
    }, null, 2));
  } else if (scenario === 'graph-execute-sharp' || scenario === 'graph-execute-sharp-repeat' || scenario === 'graph-execute-artifact') {
    const generatorCard = await evalJson(cdp, `(() => {
      const element = [...document.querySelectorAll('[data-pipeline-generator-id]')]
        .find(item => item.dataset.pipelineGeneratorId === ${JSON.stringify(generatorId)});
      const canvas = document.querySelector('#pipeline-graph-canvas');
      element?.scrollIntoView({ block: 'center', inline: 'nearest' });
      const rect = element?.getBoundingClientRect();
      const canvasRect = canvas?.getBoundingClientRect();
      if (!rect) throw new Error('Pipeline generator card missing');
      if (!canvasRect) throw new Error('Pipeline graph canvas missing for generator drop');
      return {
        cardText: element.innerText,
        pipelineGeneratorId: element.dataset.pipelineGeneratorId,
        backendPipelineId: element.dataset.pipelineGeneratorPipelineId || null,
        visible: rect.width > 20 && rect.height > 20 && rect.bottom > 0 && rect.top < window.innerHeight,
        point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        drop: { x: canvasRect.left + canvasRect.width * 0.34, y: canvasRect.top + canvasRect.height * 0.40 },
      };
    })()`);
    assertWitness(generatorCard.pipelineGeneratorId === generatorId && generatorCard.backendPipelineId === pipelineId, 'Generator card did not preserve generic id plus backend route binding', generatorCard);
    assertWitness(generatorCard.visible, 'Requested generator card was not visible before drag', generatorCard);
    await drag(cdp, generatorCard.point, generatorCard.drop);
    const generatorSelected = await evalJson(cdp, `(() => {
      const state = window.kaminosPipelineDockDebugState?.();
      return {
        selectedGeneratorId: state?.selectedGeneratorId || null,
        selectedPipelineId: state?.selectedPipelineId || null,
        routeTexts: [...document.querySelectorAll('[data-pipeline-graph-node-id]')].map(item => item.innerText),
      };
    })()`);
    if (generatorSelected.selectedGeneratorId !== generatorId || generatorSelected.selectedPipelineId !== pipelineId) {
      await click(cdp, generatorCard.point);
      await wait(300);
    }
    const imageCard = await evalJson(cdp, `(() => {
      const cards = [...document.querySelectorAll('.pipeline-asset-card')];
      const card = cards.find(element => element.innerText.includes(${JSON.stringify(assetNeedle)}));
      const canvas = document.querySelector('#pipeline-graph-canvas');
      if (!card) throw new Error('Requested visible image asset card missing');
      if (!canvas) throw new Error('Pipeline graph canvas missing for image drop');
      const rect = card.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      return {
        cardText: card.innerText,
        point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        drop: { x: canvasRect.left + canvasRect.width * 0.73, y: canvasRect.top + canvasRect.height * 0.32 },
      };
    })()`);
    await drag(cdp, imageCard.point, imageCard.drop);

    const routeNode = await waitFor(cdp, `(() => {
      const state = window.kaminosPipelineDockDebugState?.();
      const routeRecord = state?.graphRouteNodes?.at(-1) || state?.graphRouteNodes?.[0] || null;
      const nodes = [...document.querySelectorAll('[data-pipeline-graph-node-id]')];
      const element = (routeRecord ? document.querySelector(\`[data-pipeline-graph-node-id="\${routeRecord.id}"]\`) : null)
        || nodes.find(item => item.innerText.includes(${JSON.stringify(pipelineId)}))
        || nodes.find(item => item.innerText.toLowerCase().includes(${JSON.stringify(generatorId)}))
        || nodes.find(item => item.dataset.pipelineGraphNodeId === 'route');
      const rect = element?.getBoundingClientRect();
      return {
        ok: Boolean(rect),
        routeNodeId: element?.dataset?.pipelineGraphNodeId || null,
        nodeText: element?.innerText || '',
        selectedGeneratorId: state?.selectedGeneratorId || null,
        selectedPipelineId: state?.selectedPipelineId || null,
        selectedGraphNodeId: state?.selectedGraphNodeId || null,
        graphEdges: state?.graphEdges || [],
        graphRouteNodes: state?.graphRouteNodes || [],
        point: rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null,
      };
    })()`, 'Route graph node selection');

    const imageHook = await evalJson(cdp, `(() => {
      const node = [...document.querySelectorAll('[data-pipeline-graph-image-node-id]')]
        .find(element => element.innerText.includes(${JSON.stringify(assetNeedle)}));
      const routeInput = document.querySelector(\`[data-pipeline-graph-port-node-id="${routeNode.routeNodeId}"][data-pipeline-graph-port="input"]\`);
      const output = node?.querySelector('[data-pipeline-graph-port="output"]');
      const nodeRect = node?.getBoundingClientRect();
      const outputRect = output?.getBoundingClientRect();
      const routeRect = routeInput?.getBoundingClientRect();
      if (!nodeRect || !outputRect || !routeRect) throw new Error('Graph image hook ports missing');
      return {
        graphImageNodeId: node.dataset.pipelineGraphImageNodeId,
        nodeText: node.innerText,
        outputPoint: { x: outputRect.left + outputRect.width / 2, y: outputRect.top + outputRect.height / 2 },
        routeInputPoint: { x: routeRect.left + routeRect.width / 2, y: routeRect.top + routeRect.height / 2 },
      };
    })()`);
    await drag(cdp, imageHook.outputPoint, imageHook.routeInputPoint);

    const hookedRouteNode = await evalJson(cdp, `(() => {
      const element = document.querySelector(\`[data-pipeline-graph-node-id="${routeNode.routeNodeId}"]\`);
      const rect = element?.getBoundingClientRect();
      const state = window.kaminosPipelineDockDebugState?.();
      return {
        routeNodeId: ${JSON.stringify(routeNode.routeNodeId)},
        nodeText: element.innerText,
        selectedGeneratorId: state?.selectedGeneratorId || null,
        selectedPipelineId: state?.selectedPipelineId || null,
        selectedGraphNodeId: state?.selectedGraphNodeId || null,
        graphEdges: state?.graphEdges || [],
        point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      };
    })()`);
    assertWitness(hookedRouteNode.selectedGeneratorId === generatorId && hookedRouteNode.selectedPipelineId === pipelineId && hookedRouteNode.graphEdges.some(edge => edge.from === imageHook.graphImageNodeId && edge.to === routeNode.routeNodeId), 'Generator/image drag did not place the requested route node and image hook', { routeNode: hookedRouteNode, imageHook });
    await click(cdp, hookedRouteNode.point);

    const executeButton = await evalJson(cdp, `(() => {
      const button = document.querySelector(\`[data-pipeline-graph-node-action="execute"][data-pipeline-graph-node-action-node-id="${routeNode.routeNodeId}"]\`);
      const route = document.querySelector(\`[data-pipeline-graph-node-id="${routeNode.routeNodeId}"]\`);
      const rect = button?.getBoundingClientRect();
      if (!rect) throw new Error('Route node Execute button missing');
      return {
        text: button.textContent,
        disabled: button.disabled,
        nodeText: route?.innerText || '',
        inspectorText: document.querySelector('#pipeline-graph-inspector')?.innerText || '',
        point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      };
    })()`);
    assertWitness(!executeButton.disabled, 'Execute button was disabled', executeButton);
    assertWitness(executeButton.inspectorText.includes('graph-connected input record'), 'Route inspector did not say Execute uses the graph-connected input record', executeButton);
    if (expectsFixture) {
      assertWitness(executeButton.inspectorText.includes('input provenance only; output fixed fixture'), 'Fixture-backed route inspector did not warn that graph input is provenance-only', executeButton);
    } else {
      assertWitness(!executeButton.inspectorText.includes('input provenance only; output fixed fixture'), 'Live SHARP route still looked fixture-backed in the inspector', executeButton);
    }
    await click(cdp, executeButton.point);
    const pendingGeneratedOutput = await waitFor(cdp, `(() => {
      const state = window.kaminosPipelineDockDebugState?.();
      const generatedOutputNodes = state?.generatedOutputNodes || [];
      const pendingRecord = generatedOutputNodes.find(item =>
        item.routeNodeId === ${JSON.stringify(routeNode.routeNodeId)}
        && item.sourceGraphNodeId === ${JSON.stringify(imageHook.graphImageNodeId)}
        && (
          ['pending', 'running'].includes(item.status)
          || (item.status === 'complete' && item.runTimeline?.some(event => event.phase === 'queued') && item.runTimeline?.some(event => event.kind === 'running'))
        )
      ) || null;
      const outputContainer = document.querySelector(\`[data-pipeline-output-container-route-id="${routeNode.routeNodeId}"]\`);
      const statusNode = pendingRecord ? document.querySelector(\`[data-pipeline-generated-output-node-id="\${pendingRecord.id}"][data-pipeline-generated-output-status]\`) : null;
      const statusPill = pendingRecord ? document.querySelector(\`[data-pipeline-route-output-id="\${pendingRecord.id}"][data-pipeline-generated-output-status]\`) : null;
      return {
        ok: Boolean(
          pendingRecord
          && (!pendingRecord.artifact?.path || pendingRecord.status === 'complete')
          && pendingRecord.runTimeline?.length >= 1
          && pendingRecord.routeSnapshot?.schema === 'kaminos.pipeline-route-snapshot.v0'
          && pendingRecord.graphSnapshot?.schema === 'kaminos.pipeline-graph-run-snapshot.v0'
          && outputContainer
          && statusNode
          && statusPill
        ),
        pendingRecord,
        generatedOutputNodes,
        outputContainerText: outputContainer?.innerText || '',
        statusNodeText: statusNode?.innerText || '',
        statusPillText: statusPill?.innerText || '',
      };
    })()`, 'Graph Execute pending generated output', 12000);
    const executed = await waitFor(cdp, `(() => {
      const state = window.kaminosPipelineDockDebugState?.();
      const run = state?.lastRun;
      const outputRecord = state?.generatedOutputNodes?.find(item => item.runId === run?.runId) || null;
      const primaryArtifact = outputRecord?.artifact || null;
      const roleLabel = artifact => String(artifact?.role || artifact?.type || artifact?.id || 'artifact')
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .replace(/_/g, '-')
        .toLowerCase();
      const primaryArtifactRole = outputRecord?.artifactRole || roleLabel(primaryArtifact);
      const primaryLoadable = outputRecord?.loadable === true || (primaryArtifactRole.includes('splat') && Boolean(primaryArtifact?.path));
      const runUsesFixture = Boolean(run?.report?.document?.stages?.some(stage => stage.status === 'fixture'));
      const splat = primaryLoadable ? primaryArtifact : null;
      const outputNode = outputRecord ? document.querySelector(\`[data-pipeline-generated-output-node-id="\${outputRecord.id}"]\`) : null;
      const outputActionName = primaryLoadable ? 'load-output' : 'open-artifact';
      const outputActionButton = outputRecord ? document.querySelector(\`[data-pipeline-graph-node-action="\${outputActionName}"][data-pipeline-graph-node-action-node-id="\${outputRecord.id}"]\`) : null;
      const outputContainer = document.querySelector(\`[data-pipeline-output-container-route-id="${routeNode.routeNodeId}"]\`);
      const outputStatus = outputRecord ? outputNode?.dataset?.pipelineGeneratedOutputStatus || null : null;
      const adapterFixture = Boolean(
        run?.report?.document?.stages?.some(stage => stage.effectiveRoute?.fixtureMode === 'mock-adapter')
        || primaryArtifact?.fixtureSource?.mode === 'mock-adapter'
      );
      const expectedRole = ${JSON.stringify(expectedArtifactRole)};
      const expectedTruth = primaryArtifactRole === 'normal-map'
        ? (runUsesFixture ? 'fixture / normal-map artifact' : 'real normal-map artifact')
        : primaryArtifactRole === 'pbr-material-bundle'
          ? (runUsesFixture ? 'fixture / PBR material bundle' : 'real PBR material bundle')
          : adapterFixture ? 'adapter fixture / point-cloud preview' : ${JSON.stringify(expectsFixture)} ? 'fixture / point-cloud preview' : 'real SHARP / point-cloud preview';
      const artifactTruthOk = primaryArtifactRole === expectedRole
        && (primaryLoadable
          ? (adapterFixture
              ? primaryArtifact?.status === 'fixture' && primaryArtifact?.fixtureSource?.mode === 'mock-adapter'
              : (${JSON.stringify(expectsFixture)} ? primaryArtifact?.fixtureSource : primaryArtifact?.status === 'real' && !primaryArtifact?.fixtureSource))
          : Boolean(primaryArtifact?.path && primaryArtifact?.status));
      return {
        ok: Boolean(run?.ok && run?.pipelineId === ${JSON.stringify(pipelineId)} && run?.graphExecution?.nodeId === ${JSON.stringify(routeNode.routeNodeId)} && run?.graphExecution?.sourceGraphNodeId === ${JSON.stringify(imageHook.graphImageNodeId)} && run?.source?.graphNodeId === ${JSON.stringify(imageHook.graphImageNodeId)} && state?.selectedGraphNodeId === outputRecord?.id && primaryArtifact?.path && outputNode && outputNode.innerText.includes(expectedTruth) && outputActionButton && outputContainer && outputStatus === 'complete' && outputRecord?.status === 'complete' && outputRecord?.artifactRole === expectedRole && outputRecord?.runTimeline?.length >= 3 && outputRecord?.routeSnapshot?.schema === 'kaminos.pipeline-route-snapshot.v0' && outputRecord?.graphSnapshot?.schema === 'kaminos.pipeline-graph-run-snapshot.v0' && artifactTruthOk),
        selectedGraphNodeId: state?.selectedGraphNodeId || null,
        runId: run?.runId || null,
        pipelineId: run?.pipelineId || null,
        graphExecution: run?.graphExecution || null,
        source: run?.source || null,
        statusText: document.querySelector('#pipeline-graph-inspector-status')?.innerText || '',
        resultText: document.querySelector('#pipeline-run-result-panel')?.innerText || '',
        generatedOutputId: outputRecord?.id || null,
        outputStatus,
        generatedOutputNodes: state?.generatedOutputNodes || [],
        routeSnapshot: outputRecord?.routeSnapshot || null,
        graphSnapshot: outputRecord?.graphSnapshot || null,
        runTimeline: outputRecord?.runTimeline || [],
        outputContainerText: outputContainer?.innerText || '',
        generatedOutputNodeText: outputNode?.innerText || '',
        generatedOutputAction: outputActionName,
        generatedOutputActionVisible: Boolean(outputActionButton),
        primaryArtifact,
        primaryArtifactRole,
        primaryLoadable,
        adapterFixture,
        expectedTruth,
        splat,
      };
    })()`, 'Graph Execute SHARP route', graphExecuteTimeoutMs);
    if (expectsFixture) {
      assertWitness(executed.resultText.includes('input provenance only; output fixed fixture'), 'Run result did not preserve fixture input truth warning', executed);
    } else if (executed.adapterFixture) {
      assertWitness(executed.resultText.includes('mock adapter fixture output'), 'Mock adapter result did not preserve adapter-fixture truth warning', executed);
      assertWitness(executed.primaryArtifact?.status === 'fixture' && executed.primaryArtifact?.fixtureSource?.mode === 'mock-adapter', 'Mock adapter result did not expose fixture provenance', executed);
    } else {
      assertWitness(!executed.resultText.includes('input provenance only; output fixed fixture'), 'Live SHARP result still looked fixture-backed', executed);
      assertWitness(executed.primaryArtifact?.status === 'real' && !executed.primaryArtifact?.fixtureSource, 'Live result did not expose a real non-fixture primary artifact', executed);
    }
    await capture(cdp, beforePath);

    let loadOutputButton = null;
    let after = null;
    let screenshotProbe = null;
    if (expectsLoadableArtifact) {
      loadOutputButton = await evalJson(cdp, `(() => {
        const state = window.kaminosPipelineDockDebugState?.();
        const outputRecord = state?.generatedOutputNodes?.find(item => item.runId === ${JSON.stringify(executed.runId)}) || null;
        const button = outputRecord ? document.querySelector(\`[data-pipeline-graph-node-action="load-output"][data-pipeline-graph-node-action-node-id="\${outputRecord.id}"]\`) : null;
        const outputNode = outputRecord ? document.querySelector(\`[data-pipeline-generated-output-node-id="\${outputRecord.id}"]\`) : null;
        const rect = button?.getBoundingClientRect();
        if (!rect) throw new Error('Generated output node Load button missing');
        return {
          generatedOutputId: outputRecord?.id || null,
          text: button.textContent,
          disabled: button.disabled,
          nodeText: outputNode?.innerText || '',
          point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        };
      })()`);
      assertWitness(!loadOutputButton.disabled, 'Load Output button was disabled', loadOutputButton);
      await click(cdp, loadOutputButton.point);
      const expectsPipelineFixture = expectsFixture || Boolean(executed.adapterFixture);
      after = await waitFor(cdp, `(() => {
        const scene = window.kaminosSceneObjectDebugState?.() || [];
        const loaded = scene.find(entry => entry.type === 'splat' && entry.splat?.pipelineArtifact?.path && (${JSON.stringify(expectsPipelineFixture)} ? entry.splat?.pipelineArtifact?.fixtureSource : !entry.splat?.pipelineArtifact?.fixtureSource));
        const previewDebug = loaded ? window.kaminosSplatPreviewDebugState?.(loaded.id) : null;
        const state = window.kaminosPipelineDockDebugState?.();
        const loadedArtifactPath = loaded?.splat?.pipelineArtifact?.path || null;
        const viewportRect = document.querySelector('#viewport')?.getBoundingClientRect();
        const minimumIncluded = ${JSON.stringify(expectsPipelineFixture)} ? 1 : 700;
        return {
          ok: document.querySelector('.tab.active')?.dataset.tab === 'assets'
            && loaded?.splat?.previewKind === 'point-cloud'
            && Boolean(loaded?.splat?.pointCount)
            && previewDebug?.previewKind === 'point-cloud'
            && previewDebug?.includedVisible === true
            && Number(previewDebug?.includedPointCount || 0) >= minimumIncluded
            && Boolean(loadedArtifactPath && state?.loadedPipelineArtifactPaths?.[loadedArtifactPath]),
          activeTab: document.querySelector('.tab.active')?.dataset.tab || null,
          objectRows: [...document.querySelectorAll('[data-scene-object-id]')].map(row => row.innerText),
          pointCount: loaded?.splat?.pointCount || 0,
          previewKind: loaded?.splat?.previewKind || null,
          previewDebug,
          loadedArtifactPath,
          loadedPipelineArtifactPaths: state?.loadedPipelineArtifactPaths || {},
          viewportRect: viewportRect ? { x: viewportRect.x, y: viewportRect.y, width: viewportRect.width, height: viewportRect.height } : null,
          source: loaded?.source || null,
          statusText: document.querySelector('#pipeline-result-action-status')?.textContent || document.querySelector('#info-bar')?.textContent || '',
        };
      })()`, 'Graph Execute Load Output');
      assertWitness(after.previewKind === 'point-cloud' && after.previewDebug?.includedVisible, 'Loaded pipeline output did not produce point-cloud preview evidence', after);
      await capture(cdp, afterPath);
      screenshotProbe = await screenshotVisibleProbe(afterPath, after.viewportRect);
      const minimumSaturatedPixels = expectsFixture ? 150 : 1500;
      assertWitness(screenshotProbe.saturatedPixels >= minimumSaturatedPixels, 'Loaded pipeline output screenshot did not contain visible colored point-cloud pixels', {
        after,
        screenshotProbe,
        minimumSaturatedPixels,
      });
    } else {
      const openArtifactButton = await evalJson(cdp, `(() => {
        const state = window.kaminosPipelineDockDebugState?.();
        const outputRecord = state?.generatedOutputNodes?.find(item => item.runId === ${JSON.stringify(executed.runId)}) || null;
        const button = outputRecord ? document.querySelector(\`[data-pipeline-graph-node-action="open-artifact"][data-pipeline-graph-node-action-node-id="\${outputRecord.id}"]\`) : null;
        const outputNode = outputRecord ? document.querySelector(\`[data-pipeline-generated-output-node-id="\${outputRecord.id}"]\`) : null;
        const rect = button?.getBoundingClientRect();
        if (!rect) throw new Error('Generated output node Open Artifact button missing');
        return {
          generatedOutputId: outputRecord?.id || null,
          text: button.textContent,
          disabled: button.disabled,
          nodeText: outputNode?.innerText || '',
          point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        };
      })()`);
      assertWitness(!openArtifactButton.disabled, 'Open Artifact button was disabled', openArtifactButton);
      await click(cdp, openArtifactButton.point);
      after = await waitFor(cdp, `(() => {
        const status = document.querySelector('#pipeline-result-action-status')?.textContent || document.querySelector('#info-bar')?.textContent || '';
        const inspector = document.querySelector('#pipeline-graph-inspector')?.innerText || '';
        return {
          ok: status.includes('Open Artifact opened') || status.includes('opened as image') || inspector.includes(${JSON.stringify(expectedArtifactRole)}),
          statusText: status,
          inspectorText: inspector,
          activeTab: document.querySelector('.tab.active')?.dataset.tab || null,
        };
      })()`, 'Graph Execute Open Artifact');
      loadOutputButton = openArtifactButton;
      await capture(cdp, afterPath);
    }

    let repeated = null;
    let historySelection = null;
    if (scenario === 'graph-execute-sharp-repeat') {
      await click(cdp, pipelineTab);
      await wait(500);
      await click(cdp, imagePaletteTab);
      await wait(500);
      await evalJson(cdp, `(() => {
        document.querySelector('#pipeline-main-browser')?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        return true;
      })()`);
      await wait(250);
      const firstImageNode = await evalJson(cdp, `(() => {
        const node = document.querySelector(\`[data-pipeline-graph-image-node-id="${imageHook.graphImageNodeId}"]\`);
        const rect = node?.getBoundingClientRect();
        if (!rect) throw new Error('Existing graph image node missing before second input selection');
        return {
          nodeText: node.innerText,
          point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        };
      })()`);
      await click(cdp, firstImageNode.point);
      await wait(250);
      const secondImageCard = await evalJson(cdp, `(() => {
        const cards = [...document.querySelectorAll('.pipeline-asset-card')];
        const card = cards.find(element => element.innerText.includes(${JSON.stringify(secondAssetNeedle)}));
        if (!card) throw new Error('Requested second visible image asset card missing');
        const rect = card.getBoundingClientRect();
        return {
          cardText: card.innerText,
          point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
          visible: rect.width > 20 && rect.height > 20 && rect.bottom > 0 && rect.top < window.innerHeight,
        };
      })()`);
      assertWitness(secondImageCard.visible, 'Second visible image asset card was not clickable', secondImageCard);
      await click(cdp, secondImageCard.point);
      await wait(500);
      const secondImageHook = await waitFor(cdp, `(() => {
        const state = window.kaminosPipelineDockDebugState?.();
        const imageNode = (state?.graphImageNodes || []).find(item => item.id === ${JSON.stringify(imageHook.graphImageNodeId)});
        const routeInputEdge = (state?.graphEdges || [])
          .find(edge => edge.to === ${JSON.stringify(routeNode.routeNodeId)} && edge.from === ${JSON.stringify(imageHook.graphImageNodeId)});
        const graphImageNodes = [...document.querySelectorAll('[data-pipeline-graph-image-node-id]')];
        const node = document.querySelector(\`[data-pipeline-graph-image-node-id="${imageHook.graphImageNodeId}"]\`);
        const routeInput = document.querySelector(\`[data-pipeline-graph-port-node-id="${routeNode.routeNodeId}"][data-pipeline-graph-port="input"]\`);
        const output = node?.querySelector('[data-pipeline-graph-port="output"]');
        const outputRect = output?.getBoundingClientRect();
        const routeRect = routeInput?.getBoundingClientRect();
        return {
          ok: Boolean(routeInputEdge && imageNode?.source?.includes(${JSON.stringify(secondAssetNeedle)}) && outputRect && routeRect),
          graphImageNodeId: node?.dataset?.pipelineGraphImageNodeId || null,
          nodeText: node?.innerText || '',
          source: imageNode?.source || null,
          routeInputEdge,
          graphImageNodeTexts: graphImageNodes.map(element => element.innerText),
          activeTab: document.querySelector('.tab.active')?.dataset.tab || null,
          outputPoint: outputRect ? { x: outputRect.left + outputRect.width / 2, y: outputRect.top + outputRect.height / 2 } : null,
          routeInputPoint: routeRect ? { x: routeRect.left + routeRect.width / 2, y: routeRect.top + routeRect.height / 2 } : null,
        };
      })()`, 'Existing graph image node source replacement');
      const secondExecuteButton = await evalJson(cdp, `(() => {
        const button = document.querySelector(\`[data-pipeline-graph-node-action="execute"][data-pipeline-graph-node-action-node-id="${routeNode.routeNodeId}"]\`);
        const rect = button?.getBoundingClientRect();
        if (!rect) throw new Error('Second Execute button missing');
        return { point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, disabled: button.disabled };
      })()`);
      assertWitness(!secondExecuteButton.disabled, 'Second Execute button was disabled', secondExecuteButton);
      await click(cdp, secondExecuteButton.point);
      repeated = await waitFor(cdp, `(() => {
        const state = window.kaminosPipelineDockDebugState?.();
        const runs = state?.runHistory || [];
        const generatedOutputNodes = state?.generatedOutputNodes || [];
        const routeOutputs = generatedOutputNodes.filter(item => item.routeNodeId === ${JSON.stringify(routeNode.routeNodeId)});
        const distinctGeneratedOutputs = new Set(routeOutputs.map(item => item.id)).size;
        const distinctArtifactPaths = new Set(routeOutputs.map(item => item.artifact?.path).filter(Boolean)).size;
        const latestRun = state?.lastRun || null;
        const latestOutput = routeOutputs.find(item => item.runId === latestRun?.runId) || null;
        return {
          ok: runs.length >= 2
            && routeOutputs.length >= 2
            && distinctGeneratedOutputs >= 2
            && distinctArtifactPaths >= 2
            && routeOutputs.some(item => item.runId === ${JSON.stringify(executed.runId)})
            && routeOutputs.every(item => item.status === 'complete' && item.runTimeline?.length >= 3 && item.routeSnapshot?.schema && item.graphSnapshot?.schema)
            && latestOutput?.status === 'complete'
            && latestRun?.graphExecution?.sourceGraphNodeId === ${JSON.stringify(secondImageHook.graphImageNodeId)}
            && latestRun?.graphExecution?.source?.includes(${JSON.stringify(secondAssetNeedle)})
            && latestRun?.graphExecution?.nodeId === ${JSON.stringify(routeNode.routeNodeId)},
          runIds: runs.map(run => run.runId),
          generatedOutputNodes,
          distinctGeneratedOutputs,
          distinctArtifactPaths,
          latestRun: latestRun ? {
            runId: latestRun.runId,
            graphExecution: latestRun.graphExecution,
            source: latestRun.source,
          } : null,
          latestOutput,
          firstGeneratedOutputId: ${JSON.stringify(executed.generatedOutputId)},
          secondImageHook: ${JSON.stringify(secondImageHook)},
        };
      })()`, 'Graph Execute repeated SHARP route');

      await click(cdp, hookedRouteNode.point);
      const historyButtons = await evalJson(cdp, `(() => {
        const routeInputEdge = (window.kaminosPipelineDockDebugState?.()?.graphEdges || [])
          .find(edge => edge.to === ${JSON.stringify(routeNode.routeNodeId)} && edge.from === ${JSON.stringify(secondImageHook.graphImageNodeId)});
        const buttons = [...document.querySelectorAll('[data-pipeline-output-history-id]')].map(button => {
          const rect = button.getBoundingClientRect();
          return {
            id: button.dataset.pipelineOutputHistoryId,
            routeId: button.dataset.pipelineOutputHistoryRouteId,
            text: button.innerText,
            point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
          };
        });
        const inspectorText = document.querySelector('#pipeline-graph-inspector')?.innerText || '';
        return {
          ok: Boolean(routeInputEdge && buttons.length >= 2 && inspectorText.includes('produced from current graph') && inspectorText.includes('produced from previous graph state')),
          buttons,
          inspectorText,
          routeInputEdge,
        };
      })()`);
      const olderHistoryButton = historyButtons.buttons.find(button => button.id === executed.generatedOutputId);
      const latestHistoryButton = historyButtons.buttons.find(button => button.id === repeated.latestOutput?.id);
      assertWitness(historyButtons.ok && olderHistoryButton && latestHistoryButton, 'Route inspector output history did not expose both current and prior outputs', historyButtons);
      await capture(cdp, historyPath);
      await click(cdp, olderHistoryButton.point);
      const olderSelection = await waitFor(cdp, `(() => {
        const state = window.kaminosPipelineDockDebugState?.();
        const inspectorText = document.querySelector('#pipeline-graph-inspector')?.innerText || '';
        const routeInputEdge = (state?.graphEdges || [])
          .find(edge => edge.to === ${JSON.stringify(routeNode.routeNodeId)} && edge.from === ${JSON.stringify(secondImageHook.graphImageNodeId)});
        return {
          ok: state?.selectedGraphNodeId === ${JSON.stringify(executed.generatedOutputId)}
            && Boolean(routeInputEdge)
            && inspectorText.includes('produced from previous graph state')
            && !inspectorText.includes('Restore This Run'),
          selectedGraphNodeId: state?.selectedGraphNodeId || null,
          graphEdges: state?.graphEdges || [],
          inspectorText,
          routeInputEdge,
        };
      })()`, 'Output history older selection');
      await click(cdp, hookedRouteNode.point);
      await click(cdp, latestHistoryButton.point);
      const latestSelection = await waitFor(cdp, `(() => {
        const state = window.kaminosPipelineDockDebugState?.();
        const inspectorText = document.querySelector('#pipeline-graph-inspector')?.innerText || '';
        const routeInputEdge = (state?.graphEdges || [])
          .find(edge => edge.to === ${JSON.stringify(routeNode.routeNodeId)} && edge.from === ${JSON.stringify(secondImageHook.graphImageNodeId)});
        return {
          ok: state?.selectedGraphNodeId === ${JSON.stringify(repeated.latestOutput?.id)}
            && Boolean(routeInputEdge)
            && inspectorText.includes('produced from current graph')
            && !inspectorText.includes('Restore This Run'),
          selectedGraphNodeId: state?.selectedGraphNodeId || null,
          graphEdges: state?.graphEdges || [],
          inspectorText,
          routeInputEdge,
        };
      })()`, 'Output history latest selection');
      historySelection = {
        ok: true,
        historyButtons,
        olderSelection,
        latestSelection,
      };
    }

    console.log(JSON.stringify({
      ok: true,
      schema: 'kaminos.pipeline-ui-witness.v0',
      scenario,
      url: appUrl,
      beforePath,
      afterPath,
      historyPath: scenario === 'graph-execute-sharp-repeat' ? historyPath : null,
      imageCard,
      routeNode: hookedRouteNode,
      executeButton,
      pendingGeneratedOutput,
      executed,
      loadOutputButton,
      after,
      repeated,
      historySelection,
      screenshotProbe,
    }, null, 2));
  } else {
  const dragPoints = await evalJson(cdp, `(() => {
    const cards = [...document.querySelectorAll('.pipeline-asset-card')];
    const card = cards.find(element => element.innerText.includes(${JSON.stringify(assetNeedle)}));
    const canvas = document.querySelector('#pipeline-graph-canvas');
    if (!card) throw new Error('Requested visible image asset card missing');
    if (!canvas) throw new Error('Pipeline graph canvas missing');
    const cardRect = card.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    return {
      cardText: card.innerText,
      from: { x: cardRect.left + cardRect.width / 2, y: cardRect.top + cardRect.height / 2 },
      to: { x: canvasRect.left + canvasRect.width * 0.78, y: canvasRect.top + canvasRect.height * 0.34 },
      activeTab: document.querySelector('.tab.active')?.dataset.tab || null,
      paletteText: document.querySelector('#pipeline-browser-count')?.textContent || '',
    };
  })()`);
  await drag(cdp, dragPoints.from, dragPoints.to);

  const before = await evalJson(cdp, `(() => {
    const status = document.querySelector('#pipeline-graph-inspector-status');
    const button = [...document.querySelectorAll('#pipeline-graph-inspector-actions button')]
      .find(item => item.textContent.includes('Import Image'));
    const rect = button?.getBoundingClientRect();
    return {
      activeTab: document.querySelector('.tab.active')?.dataset.tab || null,
      graphImageNodes: [...document.querySelectorAll('[data-pipeline-graph-image-node-id]')].length,
      statusText: status?.innerText || '',
      statusVisible: !!status && status.getBoundingClientRect().width > 20 && status.getBoundingClientRect().height > 20,
      importButton: rect ? {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        text: button.textContent,
        disabled: button.disabled,
      } : null,
    };
  })()`);
  await capture(cdp, beforePath);
  assertWitness(before.activeTab === 'pipeline', 'Pipeline tab was not active before import', before);
  assertWitness(before.graphImageNodes > 0, 'Visible drag did not create an image graph node', before);
  assertWitness(before.statusVisible && before.statusText.includes('ACTION STATUS'), 'Graph action status was not visibly rendered before import', before);
  assertWitness(before.importButton && !before.importButton.disabled, 'Import Image to Scene button was not clickable', before);

  await click(cdp, before.importButton);
  await wait(3500);
  const after = await evalJson(cdp, `(() => ({
    activeTab: document.querySelector('.tab.active')?.dataset.tab || null,
    sceneImportText: document.querySelector('#scene-import-status')?.innerText || '',
    sceneImportHidden: document.querySelector('#scene-import-status')?.hidden ?? null,
    objectRows: [...document.querySelectorAll('[data-scene-object-id]')].map(row => row.innerText),
    infoText: document.querySelector('#info-bar')?.textContent || '',
    debug: window.kaminosPipelineLastImportDebug || null,
  }))()`);
  await capture(cdp, afterPath);

  assertWitness(after.activeTab === 'assets', 'Visible import did not switch to the scene Assets tab', after);
  assertWitness(after.sceneImportHidden === false && after.sceneImportText.includes('SCENE IMPORT'), 'Scene Import receipt was not visible after import', after);
  assertWitness(after.objectRows.some(row => row.includes('reloadable')), 'Reloadable image scene row was not visible after import', after);
  assertWitness(after.debug?.phase === 'visible-scene-row', 'Import did not record visible-scene-row phase', after);

  console.log(JSON.stringify({
    ok: true,
    schema: 'kaminos.pipeline-ui-witness.v0',
    url: appUrl,
    beforePath,
    afterPath,
    drag: {
      cardText: dragPoints.cardText,
      activeTab: dragPoints.activeTab,
      paletteText: dragPoints.paletteText,
    },
    before,
    after,
  }, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    schema: 'kaminos.pipeline-ui-witness.v0',
    url: appUrl,
    beforePath,
    afterPath,
    historyPath: scenario === 'graph-execute-sharp-repeat' ? historyPath : null,
    error: error.message,
    detail: error.detail || null,
  }, null, 2));
  process.exitCode = 1;
} finally {
  cdp?.close();
  chromeProcess.kill('SIGTERM');
  setTimeout(() => chromeProcess.kill('SIGKILL'), 1000).unref();
  if (stderr) console.error(stderr.split('\n').slice(0, 8).join('\n'));
}
