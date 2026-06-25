import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
const beforePath = args.get('before') || '/tmp/kaminos-pipeline-ui-witness-before.png';
const afterPath = args.get('after') || '/tmp/kaminos-pipeline-ui-witness-after.png';
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
    send(method, params = {}) {
      const id = ++seq;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method}: CDP request timed out`));
        }, 15000);
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

async function evalJson(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
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
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    schema: 'kaminos.pipeline-ui-witness.v0',
    url: appUrl,
    beforePath,
    afterPath,
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
