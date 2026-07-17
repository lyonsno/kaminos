#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEFAULT_ROUTE = 'http://127.0.0.1:18223/artifacts/pyro-gaussian-footprint-kneecapper-0716/deposition-subcell-oracle-state120-r2/index.html';

function parseArgs(argv) {
  const values = { route: DEFAULT_ROUTE, outDir: null };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--route') values.route = argv[++index];
    else if (key === '--out-dir') values.outDir = argv[++index];
    else throw new Error(`unknown argument: ${key}`);
  }
  if (!values.outDir) throw new Error('--out-dir is required');
  return values;
}

const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));

async function waitForDevtools(profile, child) {
  const portFile = join(profile, 'DevToolsActivePort');
  while (child.exitCode === null) {
    try {
      const [port] = (await readFile(portFile, 'utf8')).trim().split('\n');
      if (port) return Number(port);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await delay(50);
  }
  throw new Error(`Chrome exited before DevTools became available: ${child.exitCode}`);
}

class CdpSession {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    await new Promise((resolveOpen, rejectOpen) => {
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', rejectOpen, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolveRequest, rejectRequest } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) rejectRequest(new Error(message.error.message));
      else resolveRequest(message.result || {});
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolveRequest, rejectRequest) => {
      this.pending.set(id, { resolveRequest, rejectRequest });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(session, expression) {
  const result = await session.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'browser evaluation failed');
  return result.result?.value;
}

const browserStateExpression = `(() => {
  const images = [...document.images];
  return {
    documentState: document.readyState,
    imageCount: images.length,
    imagesComplete: images.every(image => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  };
})()`;

async function waitForVerifiedPage(session) {
  while (true) {
    const state = await evaluate(session, browserStateExpression);
    if (state.documentState === 'complete' && state.imageCount === 2 && state.imagesComplete) return state;
    await delay(100);
  }
}

async function capture(session, path) {
  const result = await session.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true,
  });
  await writeFile(path, Buffer.from(result.data, 'base64'));
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.outDir);
  const reportPath = join(outDir, 'page-witness-report.json');
  await mkdir(outDir, { recursive: true });
  const profile = await mkdtemp(join(tmpdir(), 'kaminos-deposition-subcell-page-'));
  let failurePhase = 'browser-launch';
  let chrome = null;
  let session = null;
  const report = {
    schema: 'kaminos.volume.deposition-subcell-page-witness.v0',
    status: 'running',
    failurePhase,
    requestedRoute: args.route,
    effectiveRoute: null,
    browser: { executable: CHROME, backend: 'chrome-headless-cdp', fallback: null },
    captures: [],
  };

  try {
    chrome = spawn(CHROME, [
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    const port = await waitForDevtools(profile, chrome);
    failurePhase = 'cdp-connect';
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
    const pageTarget = targets.find(target => target.type === 'page');
    if (!pageTarget?.webSocketDebuggerUrl) throw new Error('Chrome exposed no page target');
    session = new CdpSession(pageTarget.webSocketDebuggerUrl);
    await session.open();
    await session.send('Page.enable');
    await session.send('Runtime.enable');

    failurePhase = 'desktop-route-load';
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false,
    });
    await session.send('Page.navigate', { url: args.route });
    const desktopInitial = await waitForVerifiedPage(session);
    report.effectiveRoute = await evaluate(session, 'location.href');
    if (desktopInitial.horizontalOverflow) throw new Error('desktop page has horizontal overflow');

    failurePhase = 'interactive-treatment-selection';
    await evaluate(session, `(() => {
      const set = (id, value, type) => {
        const control = document.getElementById(id);
        control.value = value;
        control.dispatchEvent(new Event(type, { bubbles: true }));
      };
      set('camera', '18', 'input');
      set('left', 'bilinear', 'input');
      set('right', 'selective', 'input');
      set('split', '55', 'input');
      set('mode', 'residual', 'input');
    })()`);
    const desktopState = await waitForVerifiedPage(session);
    const selectedState = await evaluate(session, `({
      camera: document.getElementById('camera').value,
      left: document.getElementById('left').value,
      right: document.getElementById('right').value,
      split: document.getElementById('split').value,
      mode: document.getElementById('mode').value,
      leftImage: document.getElementById('leftImage').getAttribute('src'),
      rightImage: document.getElementById('rightImage').getAttribute('src'),
    })`);
    if (selectedState.camera !== '18' || selectedState.left !== 'bilinear' || selectedState.right !== 'selective' || selectedState.mode !== 'residual') {
      throw new Error(`interactive controls did not apply: ${JSON.stringify(selectedState)}`);
    }
    const desktopPath = join(outDir, 'desktop-camera18-residual.png');
    await capture(session, desktopPath);
    report.captures.push({ viewport: [1440, 1050], path: basename(desktopPath), state: desktopState, selectedState });

    failurePhase = 'mobile-responsive-capture';
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
    });
    await delay(100);
    const mobileState = await waitForVerifiedPage(session);
    if (mobileState.horizontalOverflow) throw new Error('mobile page has horizontal overflow');
    const mobilePath = join(outDir, 'mobile-camera18-residual.png');
    await capture(session, mobilePath);
    report.captures.push({ viewport: [390, 844], path: basename(mobilePath), state: mobileState, selectedState });

    failurePhase = null;
    report.status = 'complete';
    report.failurePhase = null;
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ ok: true, report: reportPath, captures: report.captures.map(row => row.path) }, null, 2));
  } catch (error) {
    report.status = 'failed';
    report.failurePhase = failurePhase;
    report.error = error.message;
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.error(JSON.stringify({ ok: false, report: reportPath, failurePhase, error: error.message }, null, 2));
    process.exitCode = 1;
  } finally {
    try {
      session?.close();
      if (chrome?.exitCode === null) {
        chrome.kill('SIGTERM');
        await once(chrome, 'exit');
      }
      await rm(profile, { recursive: true, force: true });
    } catch (cleanupError) {
      if (report.status === 'complete') {
        report.status = 'failed';
        report.failurePhase = 'browser-cleanup';
        report.error = cleanupError.message;
        await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
        console.error(JSON.stringify({
          ok: false,
          report: reportPath,
          failurePhase: report.failurePhase,
          error: report.error,
        }, null, 2));
        process.exitCode = 1;
      }
    }
  }
}

await run();
